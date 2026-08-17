// 「赛博公司」client-v9 右栏：公司状态 / 任务流 / 成长动态 / 技能队列 / 插件市场 / 线程。
// 全部消费真实会话数据，无数据时展示空态文案，禁止假 KPI。
import { createElement as h } from 'react'
import type { CompanyMessage, Delegation, GrowthEvent, LegacyStatus, MarketPluginItem, SkillQueueItem, StaffDef } from '../types'
import { staffPortrait } from '../asset-map'
import { clip, formatAgo, formatClock, formatDuration, staffOf } from '../selectors'

export type RailStats = { total: number; online: number; running: number; done: number; wait: number; idle: number }

function staffAvatar(staffId: string | undefined, staff: StaffDef[]) {
  const employee = staffId ? staffOf(staffId, staff) : undefined
  return h('div', { className: 'cy9-taskflow-avatar' },
    h('img', { src: staffPortrait(employee?.id || 'developer'), alt: employee?.name || '员工' }))
}

export function RightRail(props: {
  staff: StaffDef[]
  stats: RailStats
  delegations: Delegation[]
  growth: GrowthEvent[]
  skills: SkillQueueItem[]
  plugins: MarketPluginItem[]
  thread: CompanyMessage | null
  sessionRunning: boolean
  now: number
  open: boolean
  onClose: () => void
  onCloseThread: () => void
  onDraft: (text: string) => void
}) {
  const { staff, stats, delegations, growth, skills, plugins, thread, sessionRunning, now, open, onClose, onCloseThread, onDraft } = props

  const activeTasks = delegations
    .filter((d) => d.running || d.endTime)
    .sort((a, b) => Number(b.running) - Number(a.running) || (b.startTime || 0) - (a.startTime || 0))
    .slice(0, 5)

  return h('aside', { className: `cy9-rail${open ? ' open' : ''}` },

    thread ? h('section', { className: 'cy9-card' },
      h('div', { className: 'cy9-card-head' },
        h('b', null, thread.kind === 'tool' ? '工具详情' : '讨论线程'),
        h('span', null, formatClock(thread.createdAt)),
        h('button', { type: 'button', onClick: onCloseThread }, '✕ 关闭'),
      ),
      h('div', { className: 'cy9-thread-body' },
        h('div', { className: 'cy9-thread-meta' },
          thread.sender.type === 'boss' ? '老板' : thread.sender.type === 'employee' ? (staffOf(thread.sender.staffId, staff)?.name || '员工') : '秘书',
          thread.toolName ? ` · ${thread.toolName}` : '',
        ),
        h('pre', null, thread.content),
        thread.reasoning ? h('pre', null, thread.reasoning) : null,
      ),
    ) : null,

    h('section', { className: 'cy9-card' },
      h('div', { className: 'cy9-card-head' }, h('b', null, '公司状态'), h('span', null, 'LIVE'),
        h('button', { type: 'button', onClick: onClose, title: '收起面板' }, '✕')),
      h('div', { className: 'cy9-status-grid' },
        h('div', { className: 'cy9-status-cell violet' }, h('b', null, `${stats.online}`, h('i', null, ` / ${stats.total}`)), h('span', null, '在线员工')),
        h('div', { className: 'cy9-status-cell green' }, h('b', null, String(stats.running)), h('span', null, '正在干活')),
        h('div', { className: 'cy9-status-cell blue' }, h('b', null, String(stats.done)), h('span', null, '已交付')),
        h('div', { className: 'cy9-status-cell red' }, h('b', null, String(stats.wait)), h('span', null, '等待处理')),
      ),
      h('div', { className: `cy9-session-line${sessionRunning ? ' live' : ''}` },
        h('i', null), sessionRunning ? '会话执行中：员工正在处理真实任务' : '会话空闲：等待老板下达指令'),
    ),

    h('section', { className: 'cy9-card' },
      h('div', { className: 'cy9-card-head' }, h('b', null, '当前任务流'), h('span', null, 'REAL-TIME')),
      activeTasks.length === 0
        ? h('div', { className: 'cy9-empty' }, '暂无任务。@任意员工派活后，这里会实时显示任务进度。')
        : activeTasks.map((task) => {
          const employee = staffOf(task.staffId, staff)
          const state = task.running ? 'running' : task.isError ? 'wait' : 'done'
          return h('div', { key: task.callId, className: 'cy9-taskflow-row' },
            staffAvatar(task.staffId, staff),
            h('div', { className: 'cy9-taskflow-main' },
              h('b', null, clip(task.desc, 22)),
              h('span', null, `${employee?.name || '员工'} · ${task.running ? formatDuration(now - (task.startTime || now)) || '刚开始' : formatDuration(task.duration)}`),
            ),
            h('span', { className: `cy9-taskflow-state ${state}` }, task.running ? '进行中' : task.isError ? '卡住' : '已交付'),
          )
        }),
    ),

    h('section', { className: 'cy9-card' },
      h('div', { className: 'cy9-card-head' }, h('b', null, '员工成长动态'), h('span', null, 'MEMORY · XP')),
      growth.length === 0
        ? h('div', { className: 'cy9-empty' }, '暂无成长记录。员工完成真实任务并调用复盘 / 技能学习 / 记忆沉淀后会出现在这里。')
        : growth.map((event) => {
          const employee = event.staffId ? staffOf(event.staffId, staff) : undefined
          return h('div', { key: event.id, className: 'cy9-feed-row' },
            h('img', { src: staffPortrait(employee?.id || 'developer'), alt: employee?.name || '员工' }),
            h('div', { className: 'cy9-feed-main' },
              h('em', null, formatAgo(event.time)),
              h('b', null, employee?.name || '员工'),
              h('p', null, event.text),
            ),
          )
        }),
    ),

    h('section', { className: 'cy9-card' },
      h('div', { className: 'cy9-card-head' }, h('b', null, '技能学习队列'), h('span', null, 'SKILLS')),
      skills.length === 0
        ? h('div', { className: 'cy9-empty' }, '暂无学习中的技能。员工通过 staff_skill_learn 学习新能力时会在这里排队展示。')
        : skills.map((item) => {
          const employee = item.staffId ? staffOf(item.staffId, staff) : undefined
          return h('div', { key: item.callId, className: 'cy9-skill-row' },
            h('b', null, item.skill),
            h('span', null, employee ? `${employee.name}${item.running ? ' · 学习中' : ' · 已完成'}` : item.running ? '学习中' : '已完成'),
            h('div', { className: 'cy9-skill-bar' },
              h('i', { className: item.running ? 'indet' : '', style: item.running ? undefined : { width: '100%' } })),
          )
        }),
    ),

    h('section', { className: 'cy9-card' },
      h('div', { className: 'cy9-card-head' }, h('b', null, '插件市场精选'), h('span', null, 'DSH MARKET')),
      plugins.length === 0
        ? h('div', { className: 'cy9-empty' }, '尚未检索过插件市场。员工能力不足时，会从 awesome-dsh-plugin 与 GitHub dsh-plugin 生态发现真实插件。')
        : plugins.map((plugin) => h('div', { key: plugin.name, className: 'cy9-plugin-row' },
          h('div', { className: 'cy9-plugin-line' },
            h('b', null, plugin.name),
            plugin.owner ? h('span', null, plugin.owner) : null,
            typeof plugin.stars === 'number' ? h('span', { className: 'stars' }, `★ ${plugin.stars}`) : null,
          ),
          plugin.description ? h('p', { className: 'cy9-plugin-desc' }, plugin.description) : null,
          h('button', {
            type: 'button',
            className: 'cy9-plugin-install',
            onClick: () => onDraft(`@大壮 请评估 DSH 社区插件「${plugin.name}」${plugin.install ? `（安装命令：${plugin.install}）` : ''}：列出用途、风险与适配岗位。先不要安装，等我批准。`),
          }, '申请安装'),
        )),
      h('button', {
        type: 'button',
        className: 'cy9-card-action',
        onClick: () => onDraft('@大壮 去 DSH 社区插件市场搜索适合当前公司和各岗位的新插件。列出插件用途、stars、风险、仓库与安装命令；不要安装，等我批准。'),
      }, '🔍 去市场搜索新能力'),
    ),
  )
}
