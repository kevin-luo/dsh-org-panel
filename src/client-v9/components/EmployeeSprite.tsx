import { createElement as h } from 'react'
import type { Delegation, EmployeeStatus, OfficePlacement, StaffDef } from '../types'
import { EMPLOYEE_STATUS_LABEL } from '../types'
import { staffSprite } from '../asset-map'
import { clip } from '../selectors'
import type { EmployeeRuntimeState } from '../../runtime/company-events'
import { EMPLOYEE_RUNTIME_LABEL, STATION_LABEL } from '../../runtime/company-events'
import { AssetImage } from './AssetImage'

const BADGE: Partial<Record<EmployeeStatus, string>> = { thinking: '•••', blocked: '!', done: '✓' }

/** 呼吸灯亮度：tick 唯一被允许的用途——纯装饰，不参与位置与业务状态（需求文档三十四条）。 */
function glowOpacity(pulse: number): number {
  const phase = ((pulse % 4) + 4) % 4
  return 0.55 + 0.35 * (phase === 3 ? 1 : phase / 3)
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
  /** 事件驱动状态：有就以它为准显示工具名 / 识图 / 装插件，没有就退回任务卡文案。 */
  runtime?: EmployeeRuntimeState | null
  /** 装饰用节拍。 */
  pulse?: number
}) {
  const { staff, status, placement, task, active, onSelect, onTalk, onOpenProfile, runtime } = props
  const pulse = props.pulse || 0
  const eventLabel = runtime && runtime.status !== 'idle' ? EMPLOYEE_RUNTIME_LABEL[runtime.status] : ''
  const statusText = eventLabel || EMPLOYEE_STATUS_LABEL[status]
  // 行内文案优先级：当前工具 > 当前活动（会议/识图/装插件）> 任务卡 > 落位文案。
  const shortText = runtime?.tool
    ? clip(runtime.tool.label, 12)
    : runtime && runtime.status !== 'idle'
      ? clip(runtime.activity, 12)
      : status === 'working' && task
        ? clip(task.desc, 10)
        : placement.activity
  const cardText = runtime && runtime.status !== 'idle'
    ? clip(runtime.activity, 34)
    : task
      ? clip(task.desc, 34)
      : placement.activity
  const station = runtime && runtime.station !== 'desk' ? STATION_LABEL[runtime.station] : ''

  return h('button', {
    type: 'button', className: `cy9-sprite ${status}${active ? ' active' : ''}`,
    style: { left: placement.x, top: placement.y },
    onClick: () => onSelect(staff.id), onDoubleClick: () => onTalk(staff),
    title: `${staff.name} · ${statusText}${station ? ` · ${station}` : ''} · 双击直接 @ 本人`,
  },
    h('span', { className: 'cy9-sprite-img' },
      BADGE[status] ? h('span', { className: 'cy9-sprite-badge' }, BADGE[status]) : null,
      h(AssetImage, { src: staffSprite(staff.id), alt: staff.name, fallback: staff.name }),
      status === 'working' ? h('i', { className: 'cy9-monitor-glow', style: { opacity: glowOpacity(pulse) } }) : null,
    ),
    h('span', { className: 'cy9-sprite-label' }, h('b', null, staff.name), h('small', null, shortText || statusText)),
    h('span', { className: 'cy9-sprite-card' },
      h('b', null, staff.name), h('em', null, `${staff.role} · ${statusText}${station ? ` · ${station}` : ''}`),
      h('span', null, cardText),
      h('span', { className: 'cy9-sprite-actions' },
        h('span', { role: 'button', tabIndex: 0, onClick: (event: any) => { event.stopPropagation(); onOpenProfile(staff.id) } }, '打开档案'),
        h('span', { role: 'button', tabIndex: 0, onClick: (event: any) => { event.stopPropagation(); onTalk(staff) } }, '@ 本人'),
      ),
    ),
  )
}
