import { createElement as h, useMemo } from 'react'
import type { Delegation, LegacyStatus, OfficePlacement, StaffDef } from '../types'
import { legacyToEmployeeStatus, OFFICE_HEIGHT, OFFICE_WIDTH } from '../types'
import { officeBase } from '../asset-map'
import { OFFICE_ZONES, OFFICE_ZOOM_LEVELS } from '../office-layout'
import { officePlacement } from '../selectors'
import { EmployeeSprite } from './EmployeeSprite'

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
}) {
  const { staff, statuses, tasksMap, tick, activeStaffId, zoomIdx, onZoom, onSelect, onTalk, onOpenProfile } = props
  const zoom = OFFICE_ZOOM_LEVELS[Math.min(zoomIdx, OFFICE_ZOOM_LEVELS.length - 1)]
  const placements = useMemo(() => Object.fromEntries(staff.map((item) => {
    const tasks = tasksMap[item.id] || []
    const task = tasks.find((entry) => entry.running) || tasks[tasks.length - 1]
    return [item.id, { placement: officePlacement(item, statuses[item.id] || 'idle', tick, task), task }]
  })) as Record<string, { placement: OfficePlacement; task?: Delegation }>, [staff, statuses, tasksMap, tick])
  const meetingLive = staff.some((item) => (tasksMap[item.id] || []).some((task) => task.running && task.tool === 'staff_meeting'))
  const base = officeBase()

  return h('section', { className: 'cy9-office-shell' },
    h('div', { className: 'cy9-office-head' },
      h('div', null, h('b', null, '赛博公司总部'), h('span', null, '员工状态与真实任务同步')),
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
            key: zone.id, className: `cy9-zone-hotspot${meetingLive && zone.id === 'meeting' ? ' meeting-glow' : ''}`,
            style: { left: zone.x, top: zone.y, width: zone.width, height: zone.height },
          }, h('span', null, zone.title))),
          staff.map((item) => {
            const entry = placements[item.id]
            return entry ? h(EmployeeSprite, {
              key: item.id, staff: item, status: legacyToEmployeeStatus(statuses[item.id] || 'idle', entry.task?.tool),
              placement: entry.placement, task: entry.task, active: activeStaffId === item.id,
              onSelect, onTalk, onOpenProfile,
            }) : null
          }),
        ),
      ),
    ),
  )
}
