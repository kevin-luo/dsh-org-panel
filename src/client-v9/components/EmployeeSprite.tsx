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
  // staff_chat 的 desc 是**老板刚说的那句话**（selectors 取的是 message 参数），不是员工在干的事。
  // 行内也好、悬浮卡也好都不复述它：34 字的小泡里挂一句具体的话，扫一眼就成了「他正在做这件事」，
  // 前缀根本来不及看。原话不删，只是留在右栏任务卡那个本来就标着「派活」的位置。
  const bossChat = task && task.tool === 'staff_chat' ? task : undefined
  const taskLine = task && !bossChat ? task.desc : ''
  // 只报事实：面板收没收到回传。「面板没收到」不等于「员工没干活」，这两件事不许混成一句。
  const bossLine = bossChat ? `老板交办：${bossChat.running ? '面板暂未收到进展回传' : '结果见右栏任务卡'}` : ''
  // 行内文案优先级：当前工具名 > 当前活动（会议/识图/装插件）> 真实任务描述 > 诚实的状态词。
  // 子代理内部的工具调用不进父会话 node 流，所以经常什么细节都拿不到 ——
  // 那种时候就老老实实显示「正在工作」，不拿老板自己的话冒充一个具体活动。
  const shortText = runtime?.tool
    ? clip(runtime.tool.label, 12)
    : runtime && runtime.status !== 'idle'
      ? clip(runtime.activity, 12)
      : taskLine
        ? clip(taskLine, 10)
        : status === 'working' ? statusText : placement.activity
  const cardText = runtime && runtime.status !== 'idle'
    ? clip(runtime.activity, 34)
    : taskLine
      ? clip(taskLine, 34)
      : bossLine || placement.activity
  const station = runtime && runtime.station !== 'desk' ? STATION_LABEL[runtime.station] : ''

  return h('button', {
    type: 'button', className: `cy9-sprite ${status}${active ? ' active' : ''}`,
    'data-status': status,
    style: { left: placement.x, top: placement.y },
    onClick: () => onSelect(staff.id), onDoubleClick: () => onTalk(staff),
    // 文案按真实事件处理对齐：单击 onSelect（选中并在办公室顶部展开操作栏），双击 onTalk（写 @ 草稿）。
    // 小人只有几十像素、还可能被工作群面板压住一半，双击不一定两下都落在同一个元素上；
    // 所以这里必须把「单击也能 @」的那条路一起说清楚，别让老板以为双击是唯一入口。
    title: `${staff.name} · ${statusText}${station ? ` · ${station}` : ''} · 单击选中（办公室底部出现「@ ${staff.name}」按钮），双击直接 @ 本人`,
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
