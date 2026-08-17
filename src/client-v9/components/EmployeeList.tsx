import { createElement as h, useMemo, useState } from 'react'
import type { Delegation, LegacyStatus, StaffDef } from '../types'
import { STATUS_LABEL } from '../types'
import { staffThumb } from '../asset-map'
import { clip, lineOf } from '../selectors'
import { AssetImage } from './AssetImage'

type Filter = 'all' | LegacyStatus
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: '全部' }, { id: 'running', label: '工作中' },
  { id: 'done', label: '已交付' }, { id: 'wait', label: '卡住' }, { id: 'idle', label: '待命' },
]

function currentTask(tasks: Delegation[] | undefined): Delegation | undefined {
  return tasks?.find((task) => task.running) || tasks?.[tasks.length - 1]
}

export function EmployeeList(props: {
  staff: StaffDef[]
  statuses: Record<string, LegacyStatus>
  tasksMap: Record<string, Delegation[]>
  activeStaffId: string | null
  tick: number
  onSelect: (staffId: string) => void
  onMention: (staff: StaffDef) => void
}) {
  const { staff, statuses, tasksMap, activeStaffId, tick, onSelect, onMention } = props
  const [filter, setFilter] = useState<Filter>('all')
  const groups = useMemo(() => {
    const map = new Map<string, StaffDef[]>()
    for (const item of staff) {
      const status = statuses[item.id] || 'idle'
      if (filter !== 'all' && status !== filter) continue
      const department = item.department || '其他部门'
      map.set(department, [...(map.get(department) || []), item])
    }
    return [...map.entries()]
  }, [staff, statuses, filter])

  return h('aside', { className: 'cy9-left' },
    h('div', { className: 'cy9-left-head' }, h('b', null, '员工通讯录'), h('span', null, `${staff.length} 位真实子代理`)),
    h('div', { className: 'cy9-left-filters' }, FILTERS.map((item) => h('button', {
      key: item.id, type: 'button', className: filter === item.id ? 'on' : '', onClick: () => setFilter(item.id),
    }, item.label))),
    h('div', { className: 'cy9-left-list' },
      groups.map(([department, employees]) => h('section', { key: department, className: 'cy9-department' },
        h('div', { className: 'cy9-department-title' }, department, h('span', null, employees.length)),
        employees.map((item) => {
          const status = statuses[item.id] || 'idle'
          const task = currentTask(tasksMap[item.id])
          const taskLine = task ? clip(task.desc, 20) : lineOf(item, status, tick)
          return h('button', {
            key: item.id, type: 'button',
            className: `cy9-emp${activeStaffId === item.id ? ' active' : ''}`,
            onClick: () => onSelect(item.id), onDoubleClick: () => onMention(item), title: '单击定位，双击直接 @ 本人',
          },
            h('div', { className: 'cy9-emp-avatar' }, h(AssetImage, { src: staffThumb(item.id), alt: item.name, fallback: item.name })),
            h('div', { className: 'cy9-emp-copy' },
              h('div', { className: 'cy9-emp-line' }, h('span', { className: 'cy9-emp-name' }, item.name), h('span', { className: 'cy9-emp-role' }, item.role)),
              h('div', { className: 'cy9-emp-task' }, h('i', { className: status }), `${STATUS_LABEL[status]} · ${taskLine}`),
            ),
          )
        }),
      )),
    ),
  )
}
