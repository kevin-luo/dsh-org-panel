import { createElement as h, useMemo, useSyncExternalStore } from 'react'
import type { Delegation, LegacyStatus, OfficePlacement, StaffDef } from '../types'
import { legacyToEmployeeStatus, OFFICE_HEIGHT, OFFICE_WIDTH } from '../types'
import { officeBase } from '../asset-map'
import { OFFICE_ZONES, OFFICE_ZOOM_LEVELS, RECEPTION_DESK } from '../office-layout'
import { officePlacement, officePlacementFromRuntime, runtimeToEmployeeStatus } from '../selectors'
import type { CompanyRuntime, EmployeeRuntimeState } from '../../runtime/company-events'
import { companyEventBus } from '../../runtime/event-bus'
import { EmployeeSprite } from './EmployeeSprite'

// 事件总线接线：模块级常量保证引用稳定，满足 useSyncExternalStore 的要求。
const subscribeBus = (listener: () => void) => companyEventBus.subscribe(listener)
const readBus = () => companyEventBus.snapshot()

/** 事件目标位被占用时高亮的区域（需求文档三十三条）。 */
const STATION_ZONE: Record<string, string> = { 'media-lab': 'media-lab', 'server-room': 'server-room', meeting: 'meeting' }

export function OfficeWorld(props: {
  staff: StaffDef[]
  statuses: Record<string, LegacyStatus>
  tasksMap: Record<string, Delegation[]>
  tick: number
  activeStaffId: string | null
  zoomIdx: number
  onZoom: (idx: number) => void
  onSelect: (staffId: string) => void
  onTalk: (staff: StaffDef) => void
  onOpenProfile: (staffId: string) => void
  /** 事件驱动状态。不传时自动读全局 Company Event Bus，两者都空则退回旧的派活推导。 */
  runtime?: CompanyRuntime | null
}) {
  const { staff, statuses, tasksMap, tick, activeStaffId, zoomIdx, onZoom, onSelect, onTalk, onOpenProfile } = props
  const busRuntime = useSyncExternalStore(subscribeBus, readBus, readBus)
  const runtime = props.runtime || busRuntime
  const zoom = OFFICE_ZOOM_LEVELS[Math.min(zoomIdx, OFFICE_ZOOM_LEVELS.length - 1)]
  const eventDriven = !!runtime && runtime.eventCount > 0

  // 位置只来自「事件 → reducer → station」。tick 不在依赖里，也不在计算里：
  // 没有新事件就不会重算，员工放 10 分钟位置完全不变（需求文档三十四 / 五十三条）。
  const placements = useMemo(() => Object.fromEntries(staff.map((item) => {
    const tasks = tasksMap[item.id] || []
    const task = tasks.find((entry) => entry.running) || tasks[tasks.length - 1]
    const state = eventDriven ? runtime.employees[item.id] : undefined
    if (state && state.status !== 'idle') {
      return [item.id, { placement: officePlacementFromRuntime(item, state), task, state, status: runtimeToEmployeeStatus(state.status) }]
    }
    const legacy = statuses[item.id] || 'idle'
    return [item.id, {
      placement: officePlacement(item, legacy, 0, task),
      task, state,
      status: legacyToEmployeeStatus(legacy, task?.tool),
    }]
  })) as Record<string, { placement: OfficePlacement; task?: Delegation; state?: EmployeeRuntimeState; status: ReturnType<typeof runtimeToEmployeeStatus> }>,
  [staff, statuses, tasksMap, runtime, eventDriven])

  // 哪些事件目标位当前真的有人，用于点亮区域；没人就保持安静。
  const busyZones = useMemo(() => {
    const zones = new Set<string>()
    for (const item of staff) {
      const entry = placements[item.id]
      const station = entry?.state && entry.status !== 'idle' ? entry.state.station : null
      const zone = station ? STATION_ZONE[station] : null
      if (zone) zones.add(zone)
    }
    if (!eventDriven && staff.some((item) => (tasksMap[item.id] || []).some((task) => task.running && task.tool === 'staff_meeting'))) zones.add('meeting')
    return zones
  }, [staff, placements, tasksMap, eventDriven])

  const notices = runtime?.reception.notices || []
  const base = officeBase()

  return h('section', { className: 'cy9-office-shell' },
    h('div', { className: 'cy9-office-head' },
      h('div', null, h('b', null, '赛博公司总部'), h('span', null, '员工位置只由真实事件驱动')),
      h('div', { className: 'cy9-office-legend' },
        h('span', { className: 'working' }, '工作中'), h('span', { className: 'meeting' }, '会议中'), h('span', { className: 'blocked' }, '卡住'),
      ),
      h('div', { className: 'cy9-office-toolbar' }, OFFICE_ZOOM_LEVELS.map((level, index) => h('button', {
        key: level, type: 'button', className: zoomIdx === index ? 'on' : '', onClick: () => onZoom(index),
      }, `${Math.round(level * 100)}%`))),
    ),
    h('div', { className: 'cy9-office-viewport' },
      h('div', { className: 'cy9-office-scroll', style: { width: OFFICE_WIDTH * zoom, height: OFFICE_HEIGHT * zoom } },
        h('div', {
          className: `cy9-office-world${base ? '' : ' no-asset'}`,
          style: { transform: `scale(${zoom})`, backgroundImage: base ? `linear-gradient(180deg, rgba(3,8,20,.04), rgba(3,8,20,.22)), url(${base})` : undefined },
        },
          OFFICE_ZONES.map((zone) => h('div', {
            key: zone.id, className: `cy9-zone-hotspot${busyZones.has(zone.id) ? ' meeting-glow' : ''}`,
            style: { left: zone.x, top: zone.y, width: zone.width, height: zone.height },
          }, h('span', null, zone.title))),
          notices.length ? h('div', {
            className: 'cy9-reception-notice',
            title: notices.map((notice) => `${notice.senderName || '外部消息'}：${notice.preview}`).join('\n'),
            style: {
              position: 'absolute', left: RECEPTION_DESK.x, top: RECEPTION_DESK.y, transform: 'translate(-50%, -50%)',
              padding: '2px 8px', borderRadius: 999, fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap',
              background: 'rgba(255,176,32,.92)', color: '#20160a', fontWeight: 600, pointerEvents: 'none', zIndex: 6,
            },
          }, `🔔 ${platformLabel(notices[notices.length - 1].platform)}新消息${notices.length > 1 ? ` ×${notices.length}` : ''}`) : null,
          staff.map((item) => {
            const entry = placements[item.id]
            return entry ? h(EmployeeSprite, {
              key: item.id, staff: item, status: entry.status,
              placement: entry.placement, task: entry.task, runtime: entry.state, pulse: tick,
              active: activeStaffId === item.id,
              onSelect, onTalk, onOpenProfile,
            }) : null
          }),
        ),
      ),
    ),
  )
}

function platformLabel(platform: string): string {
  if (platform === 'feishu') return '飞书'
  if (platform === 'qq') return 'QQ'
  if (platform === 'wechat') return '微信'
  return '外部'
}
