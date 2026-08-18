// 员工通讯录（需求文档四十八条：状态必须来自真实 Runtime）。
// 这里以前调 selectors.lineOf(staff, status, tick)：tick 每 2.4 秒 +1，于是每位员工的
// 「当前活动」在几句预置台词之间轮播 —— 那是编造的活动描述，看上去像员工在忙，其实什么都没发生。
// 现在只有两种来源：① 真实派活记录里的任务描述；② 没有任务时的一句静态事实。
import { createElement as h, useMemo, useState } from 'react'
import type { Delegation, LegacyStatus, StaffDef } from '../types'
import { STATUS_LABEL } from '../types'
import { staffThumb } from '../asset-map'
import { clip } from '../selectors'
import { AssetImage } from './AssetImage'

type Filter = 'all' | LegacyStatus

/** 没有真实任务时显示什么：只陈述「面板知道什么」，不描述员工在干什么。 */
const NO_TASK_LINE: Record<LegacyStatus, string> = {
  idle: '待命中，等真实派活',
  running: '暂无任务详情',
  done: '暂无任务详情',
  wait: '暂无原因说明',
}

/** 员工卡片第二行。task 为空时绝不编活动描述。 */
export function employeeLine(task: Delegation | undefined, status: LegacyStatus): string {
  const desc = task ? clip(task.desc, 20) : ''
  return desc || NO_TASK_LINE[status] || NO_TASK_LINE.idle
}
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
  /** 只用来驱动父组件重渲染（时钟等）；本组件不再拿它轮播任何文案。 */
  tick?: number
  onSelect: (staffId: string) => void
  onMention: (staff: StaffDef) => void
}) {
  const { staff, statuses, tasksMap, activeStaffId, onSelect, onMention } = props
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
          const taskLine = employeeLine(task, status)
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
