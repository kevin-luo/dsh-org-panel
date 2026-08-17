import type { OfficeZone } from './types'
import { OFFICE_HEIGHT, OFFICE_WIDTH } from './types'

export const OFFICE_ZOOM_LEVELS = [1, 0.9, 0.8] as const

// Hotspots align with the single illustrated office background; furniture lives in the image.
export const OFFICE_ZONES: OfficeZone[] = [
  { id: 'reception', title: '总裁办 / 前台', x: 40, y: 70, width: 280, height: 210, staff: ['secretary', 'recruiter'] },
  { id: 'engineering', title: '产品研发中心', x: 330, y: 70, width: 510, height: 340, staff: ['tech-lead', 'developer', 'pm', 'platform'] },
  { id: 'meeting', title: '会议室', x: 870, y: 60, width: 290, height: 250, staff: [] },
  { id: 'content', title: '内容创意部', x: 40, y: 360, width: 300, height: 290, staff: ['doc', 'novelist', 'social-editor', 'image-creator', 'video-producer'] },
  { id: 'data', title: '数据与增长', x: 350, y: 430, width: 470, height: 240, staff: ['data-analyst', 'growth'] },
  { id: 'breakroom', title: '茶水间 / 放风区', x: 870, y: 360, width: 290, height: 290, staff: ['researcher', 'search-specialist'] },
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

export const MEETING_CENTER = { x: 950, y: 170, zone: 'meeting' }
export const BREAKROOM_CENTER = { x: 1020, y: 560, zone: 'breakroom' }
export { OFFICE_WIDTH, OFFICE_HEIGHT }
