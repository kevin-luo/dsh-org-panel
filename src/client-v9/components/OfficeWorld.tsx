// 「赛博公司」client-v9 办公室主场景：真实 PNG 资产 + DOM 定位。
// 固定逻辑尺寸 1200x720，只允许 100/90/80 三档 zoom，禁止随窗口缩放。
import { createElement as h, useMemo } from 'react'
import type { Delegation, LegacyStatus, OfficePlacement, StaffDef } from '../types'
import { legacyToEmployeeStatus, OFFICE_HEIGHT, OFFICE_WIDTH } from '../types'
import { officeAsset, OFFICE_ASSETS } from '../asset-map'
import { OFFICE_FURNITURE, OFFICE_ZONES, OFFICE_ZOOM_LEVELS } from '../office-layout'
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

  const placements = useMemo(() => {
    const map: Record<string, { placement: OfficePlacement; task?: Delegation }> = {}
    for (const item of staff) {
      const tasks = tasksMap[item.id] || []
      const task = tasks.find((t) => t.running) || tasks[tasks.length - 1]
      map[item.id] = { placement: officePlacement(item, statuses[item.id] || 'idle', tick, task), task }
    }
    return map
  }, [staff, statuses, tasksMap, tick])

  const zoneCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const item of staff) {
      const zone = placements[item.id]?.placement.zone
      if (zone) counts[zone] = (counts[zone] || 0) + 1
    }
    return counts
  }, [staff, placements])

  const meetingLive = useMemo(() => staff.some((item) =>
    (tasksMap[item.id] || []).some((t) => t.running && t.tool === 'staff_meeting')), [staff, tasksMap])

  return h('section', { className: 'cy9-office-shell' },
    h('div', { className: 'cy9-office-toolbar' },
      OFFICE_ZOOM_LEVELS.map((level, index) => h('button', {
        key: level,
        type: 'button',
        className: zoomIdx === index ? 'on' : '',
        onClick: () => onZoom(index),
      }, `${Math.round(level * 100)}%`)),
    ),
    h('div', { className: 'cy9-office-viewport' },
      h('div', { className: 'cy9-office-scroll', style: { width: OFFICE_WIDTH * zoom, height: OFFICE_HEIGHT * zoom } },
        h('div', { className: 'cy9-office-world', style: { transform: `scale(${zoom})` } },
          h('img', { className: 'cy9-office-base', src: officeAsset('floorDark'), alt: '' }),
          OFFICE_ZONES.map((zone) => h('div', {
            key: zone.id,
            className: `cy9-zone${meetingLive && zone.id === 'meeting' ? ' meeting-glow' : ''}`,
            style: { left: zone.x, top: zone.y, width: zone.width, height: zone.height },
          },
            zone.floor ? h('img', { className: 'cy9-zone-floor', src: officeAsset(zone.floor as keyof typeof OFFICE_ASSETS), alt: '' }) : null,
            zone.sign ? h('img', {
              className: 'cy9-zone-sign',
              src: officeAsset(zone.sign as keyof typeof OFFICE_ASSETS),
              style: { left: 10, top: 12 },
              alt: zone.title,
            }) : null,
            h('div', { className: 'cy9-zone-banner' },
              zone.title,
              (zoneCounts[zone.id] || 0) > 0 ? h('b', null, `· ${zoneCounts[zone.id]}人`) : null,
            ),
          )),
          OFFICE_FURNITURE.map((item) => h('div', {
            key: item.id,
            className: `cy9-furniture${item.asset === 'dashboardScreen' ? ' flicker' : ''}`,
            style: { left: item.x, top: item.y, width: item.width, height: item.height, zIndex: item.z },
          }, h('img', { src: officeAsset(item.asset), alt: '' }))),
          staff.map((item) => {
            const entry = placements[item.id]
            if (!entry) return null
            return h(EmployeeSprite, {
              key: item.id,
              staff: item,
              status: legacyToEmployeeStatus(statuses[item.id] || 'idle', entry.task?.tool),
              placement: entry.placement,
              task: entry.task,
              active: activeStaffId === item.id,
              onSelect, onTalk, onOpenProfile,
            })
          }),
        ),
      ),
    ),
  )
}
