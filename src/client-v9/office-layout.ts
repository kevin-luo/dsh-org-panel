import type { OfficeZone } from './types'
import { OFFICE_HEIGHT, OFFICE_WIDTH } from './types'

export const OFFICE_ZOOM_LEVELS = [1, 0.9, 0.8] as const

export const OFFICE_ZONES: OfficeZone[] = [
  {
    id: 'rd',
    title: '研发部',
    x: 24,
    y: 72,
    width: 360,
    height: 200,
    staff: ['developer', 'platform'],
    floor: 'floorDark',
    sign: 'signRd',
  },
  {
    id: 'product',
    title: '产品部',
    x: 400,
    y: 72,
    width: 360,
    height: 200,
    staff: ['pm', 'tech-lead'],
    floor: 'floorWood',
    sign: 'signProduct',
  },
  {
    id: 'meeting',
    title: '会议室',
    x: 816,
    y: 72,
    width: 360,
    height: 200,
    staff: [],
    floor: 'floorCarpet',
    sign: 'signMeeting',
  },
  {
    id: 'reception',
    title: '前台',
    x: 24,
    y: 292,
    width: 240,
    height: 180,
    staff: ['secretary', 'recruiter'],
    floor: 'floorWood',
    sign: 'signReception',
  },
  {
    id: 'content',
    title: '内容创作部',
    x: 280,
    y: 292,
    width: 300,
    height: 180,
    staff: ['doc', 'novelist', 'social-editor'],
    floor: 'floorDark',
    sign: 'signContent',
  },
  {
    id: 'media',
    title: '多媒体部',
    x: 596,
    y: 292,
    width: 280,
    height: 180,
    staff: ['image-creator', 'video-producer'],
    floor: 'floorWood',
    sign: 'signMedia',
  },
  {
    id: 'research',
    title: '灵感区',
    x: 896,
    y: 292,
    width: 280,
    height: 180,
    staff: ['researcher', 'search-specialist'],
    floor: 'floorCarpet',
    sign: 'signGrowth',
  },
  {
    id: 'data',
    title: '数据分析部',
    x: 24,
    y: 492,
    width: 380,
    height: 200,
    staff: ['data-analyst'],
    floor: 'floorDark',
    sign: 'signData',
  },
  {
    id: 'growth',
    title: '运营推广部',
    x: 420,
    y: 492,
    width: 380,
    height: 200,
    staff: ['growth'],
    floor: 'floorWood',
    sign: 'signGrowth',
  },
  {
    id: 'breakroom',
    title: '茶水间',
    x: 816,
    y: 492,
    width: 360,
    height: 200,
    staff: [],
    floor: 'floorCarpet',
    sign: 'signBreakroom',
  },
]

export type FurnitureItem = {
  id: string
  asset: keyof typeof import('./asset-map').OFFICE_ASSETS
  x: number
  y: number
  width?: number
  height?: number
  z?: number
}

export const OFFICE_FURNITURE: FurnitureItem[] = [
  { id: 'window', asset: 'windowCity', x: 420, y: 8, width: 360, height: 56, z: 1 },
  { id: 'glass-wall', asset: 'glassWall', x: 0, y: 0, width: OFFICE_WIDTH, height: 64, z: 2 },
  { id: 'neon', asset: 'neonLogo', x: 48, y: 12, width: 120, height: 40, z: 3 },
  { id: 'desk-rd-1', asset: 'deskDual', x: 48, y: 130, width: 140, height: 90, z: 4 },
  { id: 'desk-rd-2', asset: 'deskSingle', x: 220, y: 140, width: 110, height: 80, z: 4 },
  { id: 'desk-product-1', asset: 'deskDual', x: 430, y: 130, width: 140, height: 90, z: 4 },
  { id: 'desk-product-2', asset: 'deskSingle', x: 620, y: 140, width: 110, height: 80, z: 4 },
  { id: 'meeting-table', asset: 'meetingTable', x: 880, y: 120, width: 220, height: 120, z: 4 },
  { id: 'reception-desk', asset: 'reception', x: 36, y: 340, width: 180, height: 100, z: 4 },
  { id: 'desk-content-1', asset: 'deskSingle', x: 300, y: 350, width: 100, height: 75, z: 4 },
  { id: 'desk-content-2', asset: 'deskSingle', x: 420, y: 350, width: 100, height: 75, z: 4 },
  { id: 'desk-media-1', asset: 'deskDual', x: 620, y: 340, width: 130, height: 85, z: 4 },
  { id: 'desk-data-1', asset: 'deskDual', x: 48, y: 550, width: 140, height: 90, z: 4 },
  { id: 'desk-growth-1', asset: 'deskSingle', x: 460, y: 560, width: 110, height: 80, z: 4 },
  { id: 'sofa', asset: 'sofaSet', x: 860, y: 540, width: 160, height: 100, z: 4 },
  { id: 'coffee-table', asset: 'coffeeTable', x: 1040, y: 580, width: 80, height: 60, z: 4 },
  { id: 'coffee-machine', asset: 'coffeeMachine', x: 840, y: 520, width: 60, height: 70, z: 5 },
  { id: 'vending', asset: 'vendingMachine', x: 1120, y: 510, width: 55, height: 90, z: 5 },
  { id: 'server-rack', asset: 'serverRack', x: 780, y: 130, width: 50, height: 100, z: 3 },
  { id: 'dashboard', asset: 'dashboardScreen', x: 300, y: 520, width: 80, height: 60, z: 5 },
  { id: 'bookshelf', asset: 'bookshelf', x: 720, y: 350, width: 70, height: 100, z: 3 },
  { id: 'plant-1', asset: 'plantLarge', x: 180, y: 250, width: 48, height: 64, z: 6 },
  { id: 'plant-2', asset: 'plantMedium', x: 560, y: 250, width: 40, height: 52, z: 6 },
  { id: 'plant-3', asset: 'plantSmall', x: 950, y: 470, width: 32, height: 40, z: 6 },
  { id: 'chair-1', asset: 'officeChair', x: 100, y: 200, width: 36, height: 36, z: 7 },
  { id: 'chair-2', asset: 'officeChair', x: 480, y: 200, width: 36, height: 36, z: 7 },
  { id: 'glass-door', asset: 'glassDoor', x: 1150, y: 280, width: 40, height: 120, z: 3 },
]

/** Per-staff home desk positions within the 1200×720 world */
export const STAFF_HOME: Record<string, { x: number; y: number; zone: string }> = {
  secretary: { x: 120, y: 380, zone: 'reception' },
  recruiter: { x: 180, y: 400, zone: 'reception' },
  'tech-lead': { x: 520, y: 200, zone: 'product' },
  developer: { x: 120, y: 200, zone: 'rd' },
  pm: { x: 680, y: 200, zone: 'product' },
  platform: { x: 280, y: 200, zone: 'rd' },
  researcher: { x: 980, y: 380, zone: 'research' },
  'search-specialist': { x: 1040, y: 400, zone: 'research' },
  doc: { x: 340, y: 400, zone: 'content' },
  novelist: { x: 460, y: 400, zone: 'content' },
  'social-editor': { x: 520, y: 420, zone: 'content' },
  'image-creator': { x: 680, y: 390, zone: 'media' },
  'video-producer': { x: 740, y: 410, zone: 'media' },
  'data-analyst': { x: 120, y: 600, zone: 'data' },
  growth: { x: 520, y: 610, zone: 'growth' },
}

export const MEETING_CENTER = { x: 980, y: 180, zone: 'meeting' }
export const BREAKROOM_CENTER = { x: 940, y: 580, zone: 'breakroom' }

export { OFFICE_WIDTH, OFFICE_HEIGHT }
