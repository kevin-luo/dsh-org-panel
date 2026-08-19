import { createElement as h } from 'react'
import type { Delegation, EmployeeStatus, OfficePlacement, StaffDef } from '../types'
import { EMPLOYEE_STATUS_LABEL } from '../types'
import { staffSprite } from '../asset-map'
import { clip } from '../selectors'
import type { EmployeeRuntimeState } from '../../runtime/company-events'
import { EMPLOYEE_RUNTIME_LABEL, STATION_LABEL } from '../../runtime/company-events'
import type { EmployeeGameState } from '../game/company-game'
import { AssetImage } from './AssetImage'

const BADGE: Partial<Record<EmployeeStatus, string>> = { thinking: '•••', blocked: '!', done: '✓' }

/** 呼吸灯亮度：tick 唯一被允许的用途——纯装饰，不参与位置与业务状态。 */
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
  /** 持久化成长投影：XP / 等级 / 技能都来自 evolution.json 快照，绝不由动画自己生成。 */
  growth?: EmployeeGameState | null
  /** 装饰用节拍。 */
  pulse?: number
}) {
  const { staff, status, placement, task, active, onSelect, onTalk, onOpenProfile, runtime, growth } = props
  const pulse = props.pulse || 0
  const eventLabel = runtime && runtime.status !== 'idle' ? EMPLOYEE_RUNTIME_LABEL[runtime.status] : ''
  const statusText = eventLabel || EMPLOYEE_STATUS_LABEL[status]
  const bossChat = task && task.tool === 'staff_chat' ? task : undefined
  const taskLine = task && !bossChat ? task.desc : ''
  const bossLine = bossChat ? `老板交办：${bossChat.running ? '面板暂未收到进展回传' : '结果见右栏任务卡'}` : ''
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
  const growthLine = growth
    ? `Lv.${growth.level} ${growth.title} · ${growth.workspaceTier}${growth.topSkill ? ` · ${growth.topSkill.name} Lv.${growth.topSkill.level}` : ''}`
    : '成长档案尚未从 Host 读取'
  // 只有 reducer 的最后真实事件就是 skill.updated 时才亮“技能↑”，tick 不参与判断。
  const skillUp = !!runtime?.lastSkill && runtime.lastSkill.at === runtime.updatedAt

  return h('button', {
    type: 'button', className: `cy9-sprite ${status}${active ? ' active' : ''}`,
    'data-status': status,
    style: { left: placement.x, top: placement.y },
    onClick: () => onSelect(staff.id), onDoubleClick: () => onTalk(staff),
    title: `${staff.name} · ${statusText}${station ? ` · ${station}` : ''}${growth ? ` · Lv.${growth.level} ${growth.title}` : ''} · 单击选中，双击直接 @ 本人`,
  },
    h('span', { className: 'cy9-sprite-img' },
      BADGE[status] ? h('span', { className: 'cy9-sprite-badge' }, BADGE[status]) : null,
      growth ? h('span', {
        title: `${growth.xp} XP · ${Math.round(growth.progress * 100)}% 到下一等级`,
        style: {
          position: 'absolute', left: -5, top: -8, zIndex: 5, minWidth: 28, padding: '1px 5px',
          borderRadius: 999, border: '1px solid rgba(80,220,255,.55)', background: 'rgba(4,15,27,.94)',
          color: '#a9efff', fontSize: 9, fontWeight: 800, lineHeight: '14px', textAlign: 'center',
        },
      }, `L${growth.level}`) : null,
      skillUp ? h('span', {
        title: `真实技能证据触发：${runtime!.lastSkill!.name}${runtime!.lastSkill!.level ? ` Lv.${runtime!.lastSkill!.level}` : ''}`,
        style: {
          position: 'absolute', right: -18, top: -10, zIndex: 5, padding: '1px 5px', borderRadius: 999,
          border: '1px solid rgba(126,255,170,.65)', background: 'rgba(14,52,31,.94)', color: '#bfffd1',
          fontSize: 8, fontWeight: 800, lineHeight: '14px', whiteSpace: 'nowrap',
        },
      }, '技能↑') : null,
      h(AssetImage, { src: staffSprite(staff.id), alt: staff.name, fallback: staff.name }),
      status === 'working' ? h('i', { className: 'cy9-monitor-glow', style: { opacity: glowOpacity(pulse) } }) : null,
    ),
    h('span', { className: 'cy9-sprite-label' }, h('b', null, staff.name), h('small', null, shortText || statusText)),
    h('span', { className: 'cy9-sprite-card' },
      h('b', null, staff.name), h('em', null, `${staff.role} · ${statusText}${station ? ` · ${station}` : ''}`),
      h('span', null, cardText),
      h('span', { style: { color: '#78dff7', fontSize: 9 } }, growthLine),
      growth ? h('span', { style: { display: 'flex', gap: 5, alignItems: 'center' } },
        h('span', { style: { width: 86, height: 4, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,.1)' } },
          h('i', { style: { display: 'block', width: `${Math.round(growth.progress * 100)}%`, height: '100%', background: 'currentColor' } }),
        ),
        h('small', null, `${growth.xp} XP`),
      ) : null,
      h('span', { className: 'cy9-sprite-actions' },
        h('span', { role: 'button', tabIndex: 0, onClick: (event: any) => { event.stopPropagation(); onOpenProfile(staff.id) } }, '成长档案'),
        h('span', { role: 'button', tabIndex: 0, onClick: (event: any) => { event.stopPropagation(); onTalk(staff) } }, '@ 本人'),
      ),
    ),
  )
}
