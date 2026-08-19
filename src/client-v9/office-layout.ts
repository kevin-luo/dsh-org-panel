import type { OfficeZone } from './types'
import { OFFICE_HEIGHT, OFFICE_WIDTH } from './types'
import type { EmployeeStation } from '../runtime/company-events'

export const OFFICE_ZOOM_LEVELS = [1, 0.9, 0.8] as const

// Hotspots align with the single illustrated office background; furniture lives in the image.
export const OFFICE_ZONES: OfficeZone[] = [
  { id: 'reception', title: '总裁办 / 前台', x: 40, y: 70, width: 280, height: 210, staff: ['secretary', 'recruiter'] },
  { id: 'engineering', title: '产品研发中心', x: 330, y: 70, width: 510, height: 340, staff: ['tech-lead', 'developer', 'pm', 'platform'] },
  { id: 'meeting', title: '会议室', x: 870, y: 60, width: 290, height: 250, staff: [] },
  { id: 'content', title: '内容创意部', x: 40, y: 360, width: 300, height: 290, staff: ['doc', 'novelist', 'social-editor', 'image-creator', 'video-producer'] },
  { id: 'data', title: '数据与增长', x: 350, y: 430, width: 470, height: 240, staff: ['data-analyst', 'growth'] },
  { id: 'breakroom', title: '茶水间 / 放风区', x: 870, y: 360, width: 290, height: 290, staff: ['researcher', 'search-specialist'] },
  // 事件目标位（需求文档三十三条）：只有真实 vision.* / plugin.install.* 事件才会有人进来，
  // 没有事件时这两块永远是空的，不许拿来当「随便走走」的目的地。
  { id: 'media-lab', title: '多媒体工作台', x: 40, y: 660, width: 300, height: 54, staff: [] },
  { id: 'server-room', title: '服务器机房', x: 850, y: 660, width: 310, height: 54, staff: [] },
]

export const STAFF_HOME: Record<string, { x: number; y: number; zone: string }> = {
  secretary: { x: 132, y: 170, zone: 'reception' }, recruiter: { x: 228, y: 198, zone: 'reception' },
  'tech-lead': { x: 430, y: 175, zone: 'engineering' }, developer: { x: 560, y: 190, zone: 'engineering' },
  pm: { x: 675, y: 185, zone: 'engineering' }, platform: { x: 490, y: 330, zone: 'engineering' },
  doc: { x: 100, y: 480, zone: 'content' }, novelist: { x: 190, y: 520, zone: 'content' },
  'social-editor': { x: 270, y: 445, zone: 'content' }, 'image-creator': { x: 120, y: 600, zone: 'content' },
  'video-producer': { x: 250, y: 600, zone: 'content' }, 'data-analyst': { x: 455, y: 545, zone: 'data' },
  growth: { x: 650, y: 545, zone: 'data' }, researcher: { x: 930, y: 500, zone: 'breakroom' },
  'search-specialist': { x: 1060, y: 530, zone: 'breakroom' },
}

/** 工位兜底位：名册里没配 STAFF_HOME 的员工也必须有一个固定工位，绝不能靠随机落点。 */
export const DEFAULT_HOME = { x: 600, y: 400, zone: 'rd' }

export const MEETING_CENTER = { x: 950, y: 170, zone: 'meeting' }
/** 保留导出：茶水间仍是背景图上的真实区域，但已不再是任何自动位移的目的地（三十四条）。 */
export const BREAKROOM_CENTER = { x: 1020, y: 560, zone: 'breakroom' }
/** 多媒体工作台：vision.started 的落位。 */
export const MEDIA_LAB_CENTER = { x: 150, y: 682, zone: 'media-lab' }
/** 服务器机房：plugin.install.started 的落位。 */
export const SERVER_ROOM_CENTER = { x: 950, y: 682, zone: 'server-room' }
/** 前台：external.message.received 的飞书新消息提示挂在这里。 */
export const RECEPTION_DESK = { x: 148, y: 96, zone: 'reception' }

/** 事件目标位总表：办公室按 EmployeeStation 直接查坐标，不做任何额外推理。 */
export const STATION_CENTER: Record<EmployeeStation, { x: number; y: number; zone: string }> = {
  desk: DEFAULT_HOME,
  meeting: MEETING_CENTER,
  'media-lab': MEDIA_LAB_CENTER,
  'server-room': SERVER_ROOM_CENTER,
  reception: RECEPTION_DESK,
}

/** 同一目标位上多人时的固定席位偏移。索引来自事件里的参会人顺序，与 tick 无关。 */
export const STATION_SEAT_STEP = { x: 40, y: 34, perRow: 3 }

export function stationSeat(center: { x: number; y: number; zone: string }, index: number): { x: number; y: number; zone: string } {
  const slot = Math.max(0, index)
  const column = slot % STATION_SEAT_STEP.perRow
  const row = Math.floor(slot / STATION_SEAT_STEP.perRow)
  return {
    x: center.x + (column - 1) * STATION_SEAT_STEP.x,
    y: center.y + row * STATION_SEAT_STEP.y,
    zone: center.zone,
  }
}

export { OFFICE_WIDTH, OFFICE_HEIGHT }
