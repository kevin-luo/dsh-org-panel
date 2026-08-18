// 员工档案 · 履历（需求文档四十四条）：按天分组，带来源标签（飞书 / Web / QQ / 微信 / 系统）。
// 数据是 TaskHistory 原样回放：完成与否只看 completedAt，结果只看 outcome，不在前端补任何一条任务。
import { createElement as h } from 'react'
import { formatClock, formatDuration } from '../selectors'
import type { EmployeeSnapshot, TaskHistory } from '../../persistence/types'

const SOURCE_LABEL: Record<TaskHistory['source'], string> = { web: 'Web', feishu: '飞书', qq: 'QQ', wechat: '微信', system: '系统' }
const OUTCOME_LABEL: Record<TaskHistory['outcome'], string> = { success: '✓ success', partial: '◐ partial', blocked: '⚠ blocked', failed: '✕ failed' }

/** 任务落在哪一天：以完成时间为准，未完成的按开始时间归档。 */
function taskTime(task: TaskHistory): number { return task.completedAt || task.startedAt }

function dayKey(time: number): string {
  const date = new Date(time)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function dayLabel(time: number): string {
  const key = dayKey(time)
  const today = new Date()
  if (key === dayKey(today.getTime())) return '今天'
  if (key === dayKey(today.getTime() - 86_400_000)) return '昨天'
  const date = new Date(time)
  const sameYear = date.getFullYear() === today.getFullYear()
  return sameYear ? `${date.getMonth() + 1} 月 ${date.getDate()} 日` : `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

export function HistoryTab(props: { snapshot: EmployeeSnapshot | null }) {
  const { snapshot } = props
  if (!snapshot) return h('div', { className: 'cy9-ep-empty' }, '尚未取到持久化档案（CompanySnapshot）。', h('br'), '工作履历存在本机 evolution.json，由 host 下发后自动恢复。')

  const tasks = snapshot.recentTasks.slice().sort((a, b) => taskTime(b) - taskTime(a))
  if (!tasks.length) return h('div', { className: 'cy9-ep-empty' }, '暂无工作履历。', h('br'), `${snapshot.name} 真实接下第一个任务后，这里会按天记录来源、内容和结果。`)

  const groups: Array<{ key: string; label: string; items: TaskHistory[] }> = []
  for (const task of tasks) {
    const key = dayKey(taskTime(task))
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(task)
    else groups.push({ key, label: dayLabel(taskTime(task)), items: [task] })
  }

  return h('div', null,
    groups.map((group) => h('div', { key: group.key },
      h('div', { className: 'cy9-ep-day' }, group.label),
      group.items.map((task) => {
        const done = !!task.completedAt
        const duration = done ? formatDuration(task.completedAt! - task.startedAt) : ''
        const detail = [task.summary || task.description || '', task.tools.length ? `工具 ${task.tools.slice(0, 4).join(' / ')}` : '', duration ? `耗时 ${duration}` : '']
          .filter(Boolean).join(' · ')
        return h('div', { key: task.id, className: 'cy9-ep-task' },
          h('time', null, formatClock(taskTime(task))),
          h('div', null,
            h('b', null, h('span', { className: 'cy9-ep-src' }, SOURCE_LABEL[task.source] || task.source), task.title || '未命名任务'),
            detail ? h('q', null, detail) : null,
          ),
          h('span', { className: `cy9-ep-out ${done ? task.outcome : ''}` }, done ? OUTCOME_LABEL[task.outcome] : '进行中'),
        )
      }),
    )),
    snapshot.statistics.totalTasks > tasks.length
      ? h('p', { className: 'cy9-ep-note' }, `累计 ${snapshot.statistics.totalTasks} 个任务，这里只展示最近 ${tasks.length} 条。`)
      : null,
  )
}
