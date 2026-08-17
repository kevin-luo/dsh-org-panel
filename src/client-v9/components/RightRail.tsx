import { createElement as h, useState } from 'react'
import type { Delegation, GrowthEvent, MarketPluginItem, SkillQueueItem, StaffDef } from '../types'
import { staffThumb } from '../asset-map'
import { clip, formatAgo, formatDuration, staffOf } from '../selectors'
import { AssetImage } from './AssetImage'

export type RailStats = { total: number; online: number; running: number; done: number; wait: number; idle: number }
type RailTab = 'growth' | 'skills' | 'plugins'

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
}) {
  const { staff, stats, delegations, growth, skills, plugins, sessionRunning, now, open, onClose, onDraft } = props
  const [tab, setTab] = useState<RailTab>('growth')
  const activeTasks = delegations.filter((item) => item.running || item.endTime).sort((a, b) => Number(b.running) - Number(a.running) || (b.startTime || 0) - (a.startTime || 0)).slice(0, 5)
  const tabLabels: Array<[RailTab, string]> = [['growth', '成长'], ['skills', '技能'], ['plugins', '插件']]

  return h('aside', {
    className: `cy9-rail${open ? ' open' : ''}`,
    style: open ? { transform: 'translateX(0)' } : undefined,
  },
    h('section', { className: 'cy9-card cy9-status-card' },
      h('div', { className: 'cy9-card-head' }, h('b', null, '公司状态'), h('span', { className: sessionRunning ? 'live' : '' }, sessionRunning ? 'LIVE' : 'STANDBY'), h('button', { type: 'button', onClick: onClose }, '收起')),
      h('div', { className: 'cy9-status-grid' },
        h('div', null, h('b', null, `${stats.online}/${stats.total}`), h('span', null, '在线')),
        h('div', null, h('b', null, String(stats.running)), h('span', null, '工作中')),
        h('div', null, h('b', null, String(stats.done)), h('span', null, '已交付')),
        h('div', null, h('b', null, String(stats.wait)), h('span', null, '卡住')),
      ),
      h('div', { className: `cy9-session-line${sessionRunning ? ' live' : ''}` }, h('i'), sessionRunning ? '会话执行中，员工状态实时同步' : '会话空闲，等待老板指令'),
    ),
    h('section', { className: 'cy9-card cy9-task-card' },
      h('div', { className: 'cy9-card-head' }, h('b', null, '当前任务'), h('span', null, 'REAL-TIME')),
      activeTasks.length ? activeTasks.map((task) => {
        const employee = staffOf(task.staffId, staff)
        const state = task.running ? 'running' : task.isError ? 'wait' : 'done'
        return h('div', { key: task.callId, className: 'cy9-taskflow-row' },
          h('div', { className: 'cy9-taskflow-avatar' }, h(AssetImage, { src: staffThumb(employee?.id || 'developer'), alt: employee?.name || '员工', fallback: employee?.name || '员工' })),
          h('div', { className: 'cy9-taskflow-main' }, h('b', null, clip(task.desc, 24)), h('span', null, `${employee?.name || '员工'} · ${task.running ? formatDuration(now - (task.startTime || now)) || '刚开始' : formatDuration(task.duration)}`)),
          h('span', { className: `cy9-taskflow-state ${state}` }, task.running ? '进行中' : task.isError ? '卡住' : '已交付'),
        )
      }) : h('div', { className: 'cy9-empty' }, '暂无任务。直接 @ 任意员工即可派活。'),
    ),
    h('section', { className: 'cy9-card cy9-insight-card' },
      h('div', { className: 'cy9-rail-tabs' }, tabLabels.map(([id, label]) => h('button', { key: id, type: 'button', className: tab === id ? 'on' : '', onClick: () => setTab(id) }, label))),
      tab === 'growth' ? (growth.length ? growth.map((event) => {
        const employee = event.staffId ? staffOf(event.staffId, staff) : undefined
        return h('div', { key: event.id, className: 'cy9-feed-row' }, h(AssetImage, { src: staffThumb(employee?.id || 'developer'), alt: employee?.name || '员工', fallback: employee?.name || '员工' }), h('div', null, h('em', null, formatAgo(event.time)), h('b', null, employee?.name || '员工'), h('p', null, event.text)))
      }) : h('div', { className: 'cy9-empty' }, '暂无成长记录。真实复盘、学习与记忆沉淀后会显示。')) : null,
      tab === 'skills' ? (skills.length ? skills.map((item) => h('div', { key: item.callId, className: 'cy9-skill-row' }, h('b', null, item.skill), h('span', null, `${item.staffId ? staffOf(item.staffId, staff)?.name || '员工' : '员工'} · ${item.running ? '学习中' : '已完成'}`), h('div', null, h('i', { className: item.running ? 'indet' : '' })))) : h('div', { className: 'cy9-empty' }, '暂无学习队列。')) : null,
      tab === 'plugins' ? h('div', null,
        plugins.length ? plugins.map((plugin) => h('div', { key: plugin.name, className: 'cy9-plugin-row' }, h('b', null, plugin.name), h('span', null, plugin.description), h('button', { type: 'button', onClick: () => onDraft(`@大壮 请评估 DSH 插件「${plugin.name}」的用途、风险与适配岗位；先不要安装。`) }, '申请评估'))) : h('div', { className: 'cy9-empty' }, '尚未检索插件市场。'),
        h('button', { type: 'button', className: 'cy9-card-action', onClick: () => onDraft('@大壮 去 DSH 插件市场搜索适合当前团队的新能力，列出用途、风险、仓库和安装命令；不要安装。') }, '搜索真实插件'),
      ) : null,
    ),
  )
}
