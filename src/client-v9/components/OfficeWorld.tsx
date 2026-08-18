import { createElement as h, useMemo, useSyncExternalStore } from 'react'
import type { Delegation, LegacyStatus, OfficePlacement, StaffDef } from '../types'
import { EMPLOYEE_STATUS_LABEL, OFFICE_HEIGHT, OFFICE_WIDTH } from '../types'
import { officeBase } from '../asset-map'
import { OFFICE_ZONES, OFFICE_ZOOM_LEVELS, RECEPTION_DESK } from '../office-layout'
import type { CompanyPresence, PresenceFallback } from '../selectors'
import { companyPresence, officePlacement, officePlacementFromRuntime, runtimeToEmployeeStatus } from '../selectors'
import type { CompanyRuntime, EmployeeRuntimeState } from '../../runtime/company-events'
import { EMPLOYEE_RUNTIME_LABEL } from '../../runtime/company-events'
import { companyEventBus } from '../../runtime/event-bus'
import { EmployeeSprite } from './EmployeeSprite'

// 事件总线接线：模块级常量保证引用稳定，满足 useSyncExternalStore 的要求。
const subscribeBus = (listener: () => void) => companyEventBus.subscribe(listener)
const readBus = () => companyEventBus.snapshot()

/** 事件目标位被占用时高亮的区域（需求文档三十三条）。 */
const STATION_ZONE: Record<string, string> = { 'media-lab': 'media-lab', 'server-room': 'server-room', meeting: 'meeting' }

// 「现在」那一行的样式。styles.ts 属于布局 agent，这里用内联样式，不去动公共样式表。
const NOW_ROW: any = {
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  padding: '5px 12px', borderBottom: '1px solid rgba(67,217,255,.18)',
  background: 'rgba(9,16,29,.9)', fontSize: 11, lineHeight: '18px',
}
const NOW_CHIP: any = { border: 0, background: 'transparent', color: '#9eafc7', font: 'inherit', padding: 0, cursor: 'pointer' }
const NOW_ALERT: any = {
  padding: '1px 8px', border: '1px solid rgba(255,86,86,.55)', borderRadius: 999,
  background: 'rgba(255,86,86,.14)', color: '#ffd9d9', font: 'inherit', fontWeight: 700, cursor: 'pointer',
}
const NOW_NAME: any = {
  padding: '1px 7px', border: '1px solid rgba(255,86,86,.4)', borderRadius: 999,
  background: 'transparent', color: '#ffc9c9', font: 'inherit', cursor: 'pointer',
}

/**
 * 办公室顶部「现在」那一行：全公司此刻的单一答案位。
 * 数字只来自 companyPresence（与办公室画出来的小人是同一份状态），点一下就定位到人。
 */
function NowRow(props: { presence: CompanyPresence; staff: StaffDef[]; onSelect: (staffId: string) => void }) {
  const { presence, staff, onSelect } = props
  const { counts } = presence
  const nameOf = (id: string) => staff.find((item) => item.id === id)?.name || id
  const focus = (ids: string[]) => { if (ids.length) onSelect(ids[0]) }
  return h('div', { className: 'cy9-office-now', style: NOW_ROW },
    h('b', { style: { color: '#dff8ff' } }, '现在'),
    h('button', { type: 'button', style: NOW_CHIP, onClick: () => focus(presence.working), title: '定位到第一位工作中的员工' }, `${counts.working} 人工作中`),
    h('span', { style: { color: '#41506a' } }, '·'),
    h('button', { type: 'button', style: NOW_CHIP, onClick: () => focus(presence.meeting), title: '定位到会议室' }, `${counts.meeting} 人在会议`),
    h('span', { style: { color: '#41506a' } }, '·'),
    h('button', {
      type: 'button', style: counts.blocked > 0 ? NOW_ALERT : NOW_CHIP, onClick: () => focus(presence.blocked),
      title: counts.blocked > 0 ? '定位到第一位卡住的员工' : '当前没有人卡住',
    }, `${counts.blocked} 人卡住`),
    presence.blocked.map((id) => h('button', {
      key: id, type: 'button', style: NOW_NAME, onClick: () => onSelect(id),
      title: presence.reasons[id] ? `${nameOf(id)}：${presence.reasons[id]}` : `${nameOf(id)}：面板没拿到卡住原因`,
    }, nameOf(id))),
    presence.eventDriven ? null : h('span', { style: { marginLeft: 'auto', color: '#5b6b86', fontSize: 10 } }, '来自本会话派活记录'),
  )
}

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

  // 全公司「现在」的唯一口径。办公室画的小人、顶部那一行、左右两栏读的都是这一份。
  const presence = useMemo(() => {
    const fallback: Record<string, PresenceFallback> = {}
    for (const item of staff) {
      const tasks = tasksMap[item.id] || []
      const task = tasks.find((entry) => entry.running) || tasks[tasks.length - 1]
      fallback[item.id] = { status: statuses[item.id] || 'idle', tool: task?.tool }
    }
    return companyPresence(staff.map((item) => item.id), runtime, fallback)
  }, [staff, statuses, tasksMap, runtime])
  const eventDriven = presence.eventDriven

  // 位置只来自「事件 → reducer → station」。tick 不在依赖里，也不在计算里：
  // 没有新事件就不会重算，员工放 10 分钟位置完全不变（需求文档三十四 / 五十三条）。
  const placements = useMemo(() => Object.fromEntries(staff.map((item) => {
    const tasks = tasksMap[item.id] || []
    const task = tasks.find((entry) => entry.running) || tasks[tasks.length - 1]
    const state = eventDriven ? runtime.employees[item.id] : undefined
    const status = runtimeToEmployeeStatus(presence.status[item.id])
    if (state && state.status !== 'idle') {
      return [item.id, { placement: officePlacementFromRuntime(item, state), task, state, status }]
    }
    return [item.id, { placement: officePlacement(item, presence.legacy[item.id], 0, task), task, state, status }]
  })) as Record<string, { placement: OfficePlacement; task?: Delegation; state?: EmployeeRuntimeState; status: ReturnType<typeof runtimeToEmployeeStatus> }>,
  [staff, tasksMap, runtime, eventDriven, presence])

  // 哪些事件目标位当前真的有人，用于点亮区域；没人就保持安静。
  const busyZones = useMemo(() => {
    const zones = new Set<string>()
    for (const item of staff) {
      const entry = placements[item.id]
      const station = entry?.state && entry.status !== 'idle' ? entry.state.station : null
      const zone = station ? STATION_ZONE[station] : null
      if (zone) zones.add(zone)
    }
    if (!eventDriven && presence.meeting.length) zones.add('meeting')
    return zones
  }, [staff, placements, presence, eventDriven])

  const notices = runtime?.reception.notices || []
  const base = officeBase()
  // 选中的人 + 他此刻的一句实话。文案口径与小人身上完全一致，不另起一套说法。
  const activeStaff = activeStaffId ? staff.find((item) => item.id === activeStaffId) || null : null
  const activeEntry = activeStaff ? placements[activeStaff.id] : undefined
  const activeState = activeEntry?.state
  const activeStaffLine = activeStaff
    ? (activeState && activeState.status !== 'idle'
      ? (activeState.tool ? activeState.tool.label : EMPLOYEE_RUNTIME_LABEL[activeState.status])
      : EMPLOYEE_STATUS_LABEL[activeEntry ? activeEntry.status : 'idle'])
    : ''

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
    h(NowRow, { presence, staff, onSelect }),
    // 选中一个人就在这里给出一条**必定点得到**的操作栏。
    // 小人身上那张悬浮卡永远够不着：它绝对定位在 1200×720 的办公室世界里，
    // 而 .cy9-office-viewport 通常只有一百多像素高（工作群面板占掉了中栏大半），
    // 卡片连同「@ 本人」整个落在可视区外，鼠标点下去命中的是下面的聊天面板 —— 实测 5 个可见小人全中。
    // 这一行是办公室外壳的普通 flex 子项，不进滚动区、不被裁，所以一定可点。
    activeStaff ? h('div', { className: 'cy9-office-dock' },
      h('b', null, activeStaff.name),
      h('span', null, activeStaffLine),
      h('button', { type: 'button', onClick: () => onOpenProfile(activeStaff.id), title: `打开 ${activeStaff.name} 的员工档案` }, '打开档案'),
      h('button', {
        type: 'button', className: 'primary',
        onClick: () => onTalk(activeStaff), title: `把 @${activeStaff.name} 写进下方输入框（不会替你发送）`,
      }, `@ ${activeStaff.name}`),
      h('button', { type: 'button', className: 'quiet', onClick: () => onSelect(activeStaff.id), title: '取消选中' }, '收起'),
    ) : null,
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
