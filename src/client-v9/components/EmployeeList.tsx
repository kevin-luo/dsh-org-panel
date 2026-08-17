// 「赛博公司」client-v9 左栏：员工列表。
// 员工资料只来自 org-blueprints（经 config 注入），不维护第二份。
import { createElement as h } from 'react'
import type { Delegation, LegacyStatus, StaffDef } from '../types'
import { STATUS_LABEL } from '../types'
import { staffPortrait } from '../asset-map'
import { clip, lineOf } from '../selectors'

function currentTask(tasks: Delegation[] | undefined): Delegation | undefined {
  if (!tasks || tasks.length === 0) return undefined
  return tasks.find((t) => t.running) || tasks[tasks.length - 1]
}

export function EmployeeList(props: {
  staff: StaffDef[]
  statuses: Record<string, LegacyStatus>
  tasksMap: Record<string, Delegation[]>
  activeStaffId: string | null
  tick: number
  onSelect: (staffId: string) => void
}) {
  const { staff, statuses, tasksMap, activeStaffId, tick, onSelect } = props
  return h('aside', { className: 'cy9-left' },
    h('div', { className: 'cy9-left-head' },
      h('b', null, `员工列表 (${staff.length})`),
      h('span', null, '真实子代理'),
    ),
    h('div', { className: 'cy9-left-list' },
      staff.map((item) => {
        const status = statuses[item.id] || 'idle'
        const task = currentTask(tasksMap[item.id])
        const taskLine = task ? clip(task.desc, 22) : lineOf(item, status, tick)
        return h('button', {
          key: item.id,
          type: 'button',
          className: `cy9-emp${activeStaffId === item.id ? ' active' : ''}`,
          onClick: () => onSelect(item.id),
          title: item.intro,
        },
          h('div', { className: 'cy9-emp-avatar' }, h('img', { src: staffPortrait(item.id), alt: item.name })),
          h('div', { className: 'cy9-emp-line' },
            h('span', { className: 'cy9-emp-name' }, item.name),
            h('span', { className: 'cy9-emp-role' }, item.role),
          ),
          h('span', { className: `cy9-emp-state ${status}` }, h('i', null), STATUS_LABEL[status]),
          h('div', { className: 'cy9-emp-task' }, taskLine),
        )
      }),
    ),
  )
}
