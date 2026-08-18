// 「赛博公司」右栏（需求文档四十七条）：收敛成 公司状态 / 当前任务 / 成长|技能|插件 单 Tab Panel，
// 不再堆五六张大卡。四十八条：所有数字必须来自真实 Runtime 或持久化快照，
// 空数据就显示 0 / — / 暂无，绝不写死「在线员工 15」这种假 KPI。
import { createElement as h, useMemo, useState } from 'react'
import type { Delegation, GrowthEvent, MarketPluginItem, SkillQueueItem, StaffDef } from '../types'
import { staffThumb } from '../asset-map'
import { clip, formatAgo, formatDuration, staffOf } from '../selectors'
import { EMPLOYEE_RUNTIME_LABEL, type CompanyRuntime } from '../../runtime/company-events'
import type { CompanySnapshot, PluginStatus } from '../../persistence/types'
import { installProfileStyles, useCompanyRuntime, useCompanySnapshot } from '../employee-profile/EmployeeProfile'
import { AssetImage } from './AssetImage'

// online 已从这里删掉：右栏从来没用过它，而「在线」这个概念在本插件里根本不存在
// （没有员工心跳，拿不到谁在线）。留着一个没人读的假字段迟早会被谁拿去渲染成绿灯。
export type RailStats = { total: number; running: number; done: number; wait: number; idle: number }
type RailTab = 'growth' | 'skills' | 'plugins'
type RailTask = { key: string; staffId: string; title: string; meta: string; state: 'running' | 'done' | 'wait' }

const PLUGIN_STATUS_LABEL: Record<PluginStatus, string> = { available: 'Available', degraded: 'Degraded', missing: 'Missing', disabled: 'Disabled' }
const PLUGIN_STATUS_RANK: Record<PluginStatus, number> = { missing: 0, degraded: 1, disabled: 2, available: 3 }
const TAB_LABELS: Array<[RailTab, string]> = [['growth', '成长'], ['skills', '技能'], ['plugins', '插件']]

/** 真实事件驱动的当前任务；没有事件就退回本会话的派活记录，两者都空就是「暂无」。 */
function runtimeTasks(runtime: CompanyRuntime | null): RailTask[] {
  if (!runtime || runtime.eventCount <= 0) return []
  const rows: RailTask[] = []
  for (const state of Object.values(runtime.employees)) {
    const busy = state.task || state.tool || state.meeting || state.vision || state.pluginInstall
    if (state.block) rows.push({ key: `${state.employeeId}-blocked`, staffId: state.employeeId, title: state.task?.title || '任务卡住', meta: state.block.reason, state: 'wait' })
    else if (busy) rows.push({ key: `${state.employeeId}-busy`, staffId: state.employeeId, title: state.task?.title || state.meeting?.topic || state.tool?.label || state.activity, meta: EMPLOYEE_RUNTIME_LABEL[state.status], state: 'running' })
    else if (state.status === 'done' && state.task) rows.push({ key: `${state.employeeId}-done`, staffId: state.employeeId, title: state.task.title, meta: '已交付', state: 'done' })
  }
  return rows.sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running')).slice(0, 6)
}

function delegationTasks(delegations: Delegation[], now: number): RailTask[] {
  return delegations
    .filter((item) => item.running || item.endTime)
    .sort((a, b) => Number(b.running) - Number(a.running) || (b.startTime || 0) - (a.startTime || 0))
    .slice(0, 5)
    .map((task) => ({
      key: task.callId,
      staffId: task.staffId,
      title: clip(task.desc, 24),
      meta: task.running ? formatDuration(now - (task.startTime || now)) || '刚开始' : formatDuration(task.duration),
      state: task.running ? 'running' : task.isError ? 'wait' : 'done',
    }))
}

export function RightRail(props: {
  staff: StaffDef[]
  stats: RailStats
  delegations: Delegation[]
  growth: GrowthEvent[]
  skills: SkillQueueItem[]
  plugins: MarketPluginItem[]
  sessionRunning: boolean
  now: number
  open: boolean
  onClose: () => void
  onDraft: (text: string) => void
  /** 不传则自动取全局 CompanySnapshot；传 null 表示调用方明确知道没有快照。 */
  snapshot?: CompanySnapshot | null
  /** 不传则自动读 Company Event Bus。 */
  runtime?: CompanyRuntime | null
  onOpenProfile?: (staffId: string) => void
}) {
  const { staff, stats, delegations, growth, skills, plugins, sessionRunning, now, open, onClose, onDraft, onOpenProfile } = props
  installProfileStyles()
  const [tab, setTab] = useState<RailTab>('growth')
  const company = useCompanySnapshot()
  const busRuntime = useCompanyRuntime()
  const snapshot = props.snapshot !== undefined ? props.snapshot : company
  const runtime = props.runtime !== undefined ? props.runtime : busRuntime
  const totals = snapshot?.totals

  const tasks = useMemo(() => {
    const live = runtimeTasks(runtime)
    return live.length ? live : delegationTasks(delegations, now)
  }, [runtime, delegations, now])

  // 成长：先是持久化的等级榜（空 Session 也有），再接本次会话真实发生的成长事件。
  const ranking = useMemo(() => (snapshot ? snapshot.employees.slice().sort((a, b) => b.xp - a.xp).slice(0, 8) : []), [snapshot])
  // 技能：跨员工汇总真实技能等级，只排序不重算等级。
  const learned = useMemo(() => {
    if (!snapshot) return []
    return snapshot.employees
      .flatMap((employee) => employee.skills.map((skill) => ({ employeeId: employee.employeeId, name: employee.name, skill })))
      .sort((a, b) => b.skill.level - a.skill.level || b.skill.updatedAt - a.skill.updatedAt)
      .slice(0, 10)
  }, [snapshot])
  // 插件：按包名聚合真实绑定状态，取最差的一个状态显示，避免「有人坏了但显示可用」。
  const bindings = useMemo(() => {
    if (!snapshot) return []
    const map = new Map<string, { name: string; status: PluginStatus; owners: number; tools: number }>()
    for (const employee of snapshot.employees) {
      for (const plugin of employee.plugins) {
        const key = plugin.packageName || plugin.pluginId
        const current = map.get(key)
        if (!current) map.set(key, { name: key, status: plugin.status, owners: 1, tools: plugin.tools.length })
        else {
          current.owners += 1
          current.tools = Math.max(current.tools, plugin.tools.length)
          if (PLUGIN_STATUS_RANK[plugin.status] < PLUGIN_STATUS_RANK[current.status]) current.status = plugin.status
        }
      }
    }
    return [...map.values()].sort((a, b) => PLUGIN_STATUS_RANK[a.status] - PLUGIN_STATUS_RANK[b.status] || b.owners - a.owners)
  }, [snapshot])

  // 「真实插件」不用 totals.plugins：company-store 把它加成了 statistics.pluginCount 之和，
  // 而那个字段在 migrations 里是 available + degraded 合并计数。degraded = 声明的工具已经少了一部分，
  // 不能算「真实可用」。这里按上面同一份 bindings 现算，保证这个数和插件 Tab 里那张表对得上。
  const pluginTally = useMemo(() => ({
    available: bindings.filter((item) => item.status === 'available').length,
    degraded: bindings.filter((item) => item.status === 'degraded').length,
    missing: bindings.filter((item) => item.status === 'missing').length,
    total: bindings.length,
  }), [bindings])

  const openProfile = (staffId: string) => { if (onOpenProfile) onOpenProfile(staffId) }

  return h('aside', {
    className: `cy9-rail${open ? ' open' : ''}`,
    style: open ? { transform: 'translateX(0)' } : undefined,
  },
    h('section', { className: 'cy9-card cy9-status-card' },
      h('div', { className: 'cy9-card-head' }, h('b', null, '公司状态'), h('span', { className: sessionRunning ? 'live' : '' }, sessionRunning ? 'LIVE' : 'STANDBY'), h('button', { type: 'button', onClick: onClose }, '收起')),
      h('div', { className: 'cy9-status-grid' },
        h('div', null, h('b', null, String(stats.running)), h('span', null, '工作中')),
        h('div', null, h('b', null, String(stats.done)), h('span', null, '已交付')),
        h('div', null, h('b', null, String(stats.wait)), h('span', null, '卡住')),
        h('div', null, h('b', null, String(stats.idle)), h('span', null, '待命')),
      ),
      h('div', { className: 'cy9-rail-sub' },
        h('div', null, h('b', null, totals ? String(totals.tasks) : '—'), h('span', null, '累计任务')),
        h('div', null, h('b', null, totals ? String(totals.memories) : '—'), h('span', null, '长期记忆')),
        h('div', {
          title: snapshot
            ? `按包聚合、取该包在所有员工里最差的状态：可用 ${pluginTally.available} · 降级 ${pluginTally.degraded}（部分工具已消失，不计入可用）· 缺失 ${pluginTally.missing} · 共 ${pluginTally.total}`
            : '尚未取到持久化快照',
        }, h('b', null, snapshot ? String(pluginTally.available) : '—'), h('span', null, '可用插件')),
      ),
      h('div', { className: `cy9-session-line${sessionRunning ? ' live' : ''}` }, h('i'),
        `在册 ${stats.total} 人 · ${sessionRunning ? '会话执行中，员工状态实时同步' : '会话空闲，等待老板指令'}`),
    ),

    h('section', { className: 'cy9-card cy9-task-card' },
      h('div', { className: 'cy9-card-head' }, h('b', null, '当前任务'), h('span', null, 'REAL-TIME')),
      tasks.length ? tasks.map((task) => {
        const employee = staffOf(task.staffId, staff)
        return h('div', { key: task.key, className: 'cy9-taskflow-row' },
          h('div', { className: 'cy9-taskflow-avatar' }, h(AssetImage, { src: staffThumb(employee?.id || task.staffId), alt: employee?.name || '员工', fallback: employee?.name || '员工' })),
          h('div', { className: 'cy9-taskflow-main' }, h('b', null, clip(task.title, 24)), h('span', null, `${employee?.name || task.staffId} · ${task.meta || ''}`)),
          h('span', { className: `cy9-taskflow-state ${task.state}` }, task.state === 'running' ? '进行中' : task.state === 'wait' ? '卡住' : '已交付'),
        )
      }) : h('div', { className: 'cy9-empty' }, '暂无任务。直接 @ 任意员工即可派活。'),
    ),

    h('section', { className: 'cy9-card cy9-insight-card' },
      h('div', { className: 'cy9-rail-tabs' }, TAB_LABELS.map(([id, label]) => h('button', { key: id, type: 'button', className: tab === id ? 'on' : '', onClick: () => setTab(id) }, label))),

      tab === 'growth' ? h('div', null,
        ranking.map((employee) => h('button', {
          key: employee.employeeId, type: 'button', className: 'cy9-rail-emp', onClick: () => openProfile(employee.employeeId),
        },
          h(AssetImage, { src: staffThumb(employee.employeeId), alt: employee.name, fallback: employee.name }),
          h('div', null,
            h('b', null, `${employee.name} · ${employee.level.title}`),
            h('div', { className: 'cy9-ep-bar' }, h('i', { style: { width: `${Math.round(employee.level.progress * 100)}%` } })),
            h('em', null, `任务 ${employee.statistics.totalTasks} · 记忆 ${employee.statistics.memoryCount} · XP ${employee.xp}`),
          ),
          h('span', { className: 'lv' }, `Lv.${employee.level.level}`),
        )),
        growth.length ? growth.map((event) => {
          const employee = event.staffId ? staffOf(event.staffId, staff) : undefined
          return h('div', { key: event.id, className: 'cy9-feed-row' },
            h(AssetImage, { src: staffThumb(employee?.id || 'developer'), alt: employee?.name || '员工', fallback: employee?.name || '员工' }),
            h('div', null, h('em', null, formatAgo(event.time)), h('b', null, employee?.name || '员工'), h('p', null, event.text)),
          )
        }) : null,
        !ranking.length && !growth.length ? h('div', { className: 'cy9-empty' }, '暂无成长记录。真实复盘、学习与记忆沉淀后会显示。') : null,
      ) : null,

      tab === 'skills' ? h('div', null,
        learned.map((item) => h('button', {
          key: `${item.employeeId}-${item.skill.id}`, type: 'button', className: 'cy9-rail-emp', onClick: () => openProfile(item.employeeId),
        },
          h(AssetImage, { src: staffThumb(item.employeeId), alt: item.name, fallback: item.name }),
          h('div', null,
            h('b', null, item.skill.name),
            h('div', { className: 'cy9-ep-bar' }, h('i', { style: { width: `${Math.min(item.skill.level, 10) * 10}%` } })),
            h('em', null, `${item.name} · 成功 ${item.skill.successes} · 证据 ${item.skill.evidenceCount}`),
          ),
          h('span', { className: 'lv' }, `Lv.${item.skill.level}`),
        )),
        skills.length ? skills.map((item) => h('div', { key: item.callId, className: 'cy9-skill-row' },
          h('b', null, item.skill),
          h('span', null, `${item.staffId ? staffOf(item.staffId, staff)?.name || '员工' : '员工'} · ${item.running ? '学习中' : '已完成'}`),
          h('div', null, h('i', { className: item.running ? 'indet' : '' })),
        )) : null,
        !learned.length && !skills.length ? h('div', { className: 'cy9-empty' }, '暂无技能记录。技能等级由真实成功/失败证据推导，不由模型自评。') : null,
      ) : null,

      tab === 'plugins' ? h('div', null,
        bindings.map((plugin) => h('div', { key: plugin.name, className: 'cy9-plugin-row' },
          h('b', null, h('i', { className: `cy9-ep-dot ${plugin.status}` }), ` ${plugin.name}`),
          h('span', null, `${PLUGIN_STATUS_LABEL[plugin.status]} · ${plugin.owners} 名员工 · ${plugin.tools} 个工具`),
        )),
        plugins.length ? plugins.map((plugin) => h('div', { key: plugin.name, className: 'cy9-plugin-row' },
          h('b', null, plugin.name),
          h('span', null, plugin.description),
          h('button', { type: 'button', onClick: () => onDraft(`@大壮 请评估 DSH 插件「${plugin.name}」的用途、风险与适配岗位；先不要安装。`) }, '申请评估'),
        )) : null,
        !bindings.length && !plugins.length ? h('div', { className: 'cy9-empty' }, '暂无已安装插件，也尚未检索插件市场。') : null,
        h('button', { type: 'button', className: 'cy9-card-action', onClick: () => onDraft('@大壮 去 DSH 插件市场搜索适合当前团队的新能力，列出用途、风险、仓库和安装命令；不要安装。') }, '搜索真实插件'),
      ) : null,
    ),
  )
}
