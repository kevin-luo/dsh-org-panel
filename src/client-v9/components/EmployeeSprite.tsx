// 「赛博公司」client-v9 员工小人：PNG sprite + 状态视觉 + hover 档案卡。
// 移动仅用 CSS left/top transition，不做寻路。
import { createElement as h } from 'react'
import type { Delegation, EmployeeStatus, OfficePlacement, StaffDef } from '../types'
import { EMPLOYEE_STATUS_LABEL } from '../types'
import { staffSprite } from '../asset-map'
import { clip } from '../selectors'

const BADGE: Partial<Record<EmployeeStatus, { className: string; glyph: string }>> = {
  thinking: { className: 'think', glyph: '…' },
  blocked: { className: 'alert', glyph: '!' },
  done: { className: 'ok', glyph: '✓' },
}

export function EmployeeSprite(props: {
  staff: StaffDef
  status: EmployeeStatus
  placement: OfficePlacement
  task?: Delegation
  active: boolean
  onSelect: (staffId: string) => void
  onTalk: (staff: StaffDef) => void
  onOpenProfile: (staffId: string) => void
}) {
  const { staff, status, placement, task, active, onSelect, onTalk, onOpenProfile } = props
  const badge = BADGE[status]
  const taskText = status === 'working' && task ? clip(task.desc, 11) : placement.activity
  return h('div', {
    className: `cy9-sprite ${status}${active ? ' active' : ''}`,
    style: { left: `${placement.x}px`, top: `${placement.y}px` },
    onClick: () => onSelect(staff.id),
    onDoubleClick: () => onTalk(staff),
  },
    h('div', { className: 'cy9-sprite-img' },
      badge ? h('span', { className: `cy9-sprite-badge ${badge.className}` }, badge.glyph) : null,
      h('img', { src: staffSprite(staff.id), alt: staff.name }),
    ),
    h('div', { className: 'cy9-sprite-name' }, staff.name),
    taskText ? h('div', { className: 'cy9-sprite-task' }, taskText) : null,
    h('div', { className: 'cy9-sprite-card', onClick: (event: any) => event.stopPropagation() },
      h('b', null, staff.name),
      h('span', null, staff.role),
      h('p', null,
        h('i', null, `● ${EMPLOYEE_STATUS_LABEL[status]}`),
        '　', placement.activity || '在岗',
        task ? `：${clip(task.desc, 26)}` : '',
      ),
      h('div', { className: 'cy9-sprite-card-actions' },
        h('button', { type: 'button', onClick: () => onOpenProfile(staff.id) }, '打开档案'),
        h('button', { type: 'button', onClick: () => onTalk(staff) }, '@TA'),
      ),
    ),
  )
}
