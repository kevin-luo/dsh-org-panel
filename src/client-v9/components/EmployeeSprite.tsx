import { createElement as h } from 'react'
import type { Delegation, EmployeeStatus, OfficePlacement, StaffDef } from '../types'
import { EMPLOYEE_STATUS_LABEL } from '../types'
import { staffSprite } from '../asset-map'
import { clip } from '../selectors'
import { AssetImage } from './AssetImage'

const BADGE: Partial<Record<EmployeeStatus, string>> = { thinking: '•••', blocked: '!', done: '✓' }

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
  const taskText = status === 'working' && task ? clip(task.desc, 10) : placement.activity
  return h('button', {
    type: 'button', className: `cy9-sprite ${status}${active ? ' active' : ''}`,
    style: { left: placement.x, top: placement.y },
    onClick: () => onSelect(staff.id), onDoubleClick: () => onTalk(staff),
    title: `${staff.name} · ${EMPLOYEE_STATUS_LABEL[status]} · 双击直接 @ 本人`,
  },
    h('span', { className: 'cy9-sprite-img' },
      BADGE[status] ? h('span', { className: 'cy9-sprite-badge' }, BADGE[status]) : null,
      h(AssetImage, { src: staffSprite(staff.id), alt: staff.name, fallback: staff.name }),
      status === 'working' ? h('i', { className: 'cy9-monitor-glow' }) : null,
    ),
    h('span', { className: 'cy9-sprite-label' }, h('b', null, staff.name), h('small', null, taskText || EMPLOYEE_STATUS_LABEL[status])),
    h('span', { className: 'cy9-sprite-card' },
      h('b', null, staff.name), h('em', null, `${staff.role} · ${EMPLOYEE_STATUS_LABEL[status]}`),
      h('span', null, task ? clip(task.desc, 34) : placement.activity),
      h('span', { className: 'cy9-sprite-actions' },
        h('span', { role: 'button', tabIndex: 0, onClick: (event: any) => { event.stopPropagation(); onOpenProfile(staff.id) } }, '打开档案'),
        h('span', { role: 'button', tabIndex: 0, onClick: (event: any) => { event.stopPropagation(); onTalk(staff) } }, '@ 本人'),
      ),
    ),
  )
}
