export type SkillDef = { name: string; desc?: string }

export type RoleDef = {
  id: string
  tools: string[]
  skills: SkillDef[]
  keywords?: string[]
}

export type StaffDef = {
  id: string
  name: string
  role: string
  emoji: string
  intro: string
  roleId: string
  department?: string
  reportsTo?: string
  aliases?: string[]
  lines?: Record<string, string[] | undefined>
}

export type OrgPanelConfig = {
  tabLabel?: string
  companyName?: string
  chatEnabled?: boolean
  /** @deprecated v1.4 起运行时资产已内联，保留该字段只为兼容旧配置。 */
  assetBase?: string
  roles?: RoleDef[]
  staff?: StaffDef[]
}

export type EmployeeStatus = 'idle' | 'working' | 'thinking' | 'meeting' | 'blocked' | 'done'

export type LegacyStatus = 'idle' | 'running' | 'done' | 'wait'

export type FlowMode = 'all' | 'chat' | 'trace'

export type Delegation = {
  callId: string
  tool: string
  desc: string
  running: boolean
  isError: boolean
  lead: string
  points: string[]
  startTime: number | null
  endTime: number | null
  duration: number | null
  roleId: string
  staffId: string
}

export type StaffMarker = { staffId: string; childId: string; state: string }

export type StaffMeeting = {
  kind: 'meeting'
  topic: string
  turns: Array<{ staffId: string; staffName: string; reply: string }>
}

export type Channel = {
  id: string
  name: string
  departments: string[]
}

export type CompanyMessageKind = 'message' | 'thinking' | 'tool' | 'task' | 'meeting' | 'system'

export type CompanyMessage = {
  id: string
  channelId: string
  sender: { type: 'boss' } | { type: 'employee'; staffId: string } | { type: 'secretary' }
  content: string
  mentions: string[]
  kind: CompanyMessageKind
  createdAt: number
  reasoning?: string
  toolName?: string
  node?: any
}

export type GrowthEvent = {
  id: string
  staffId?: string
  tool: string
  text: string
  time: number | null
}

export type SkillQueueItem = {
  callId: string
  staffId?: string
  skill: string
  running: boolean
  time: number | null
}

export type MarketPluginItem = {
  name: string
  owner?: string
  description: string
  stars?: number
  url?: string
  install?: string
}

export type OfficePlacement = {
  x: number
  y: number
  zone: string
  activity: string
}

export type OfficeZone = {
  id: string
  title: string
  x: number
  y: number
  width: number
  height: number
  staff: string[]
  floor?: string
  sign?: string
}

export type EmployeeState = {
  id: string
  status: EmployeeStatus
  task?: string
  officePosition?: OfficePlacement
  xp?: number
  level?: number
}

export const STATUS_LABEL: Record<LegacyStatus, string> = {
  running: '干活中',
  done: '已交付',
  wait: '卡住了',
  idle: '待命中',
}

export const EMPLOYEE_STATUS_LABEL: Record<EmployeeStatus, string> = {
  idle: '待命中',
  working: '正在工作',
  thinking: '思考中',
  meeting: '会议中',
  blocked: '卡住了',
  done: '已交付',
}

export const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'running', label: '干活中' },
  { id: 'done', label: '已交付' },
  { id: 'wait', label: '卡住' },
  { id: 'idle', label: '待命' },
]

export const DEFAULT_CHANNELS: Channel[] = [
  { id: 'general', name: '团队总览', departments: [] },
  { id: 'engineering', name: '研发部频道', departments: ['产品研发部', '管理层', '平台与自动化'] },
  { id: 'product', name: '产品部频道', departments: ['产品研发部'] },
  { id: 'content', name: '内容创作频道', departments: ['知识与内容部', '创意工作室'] },
  { id: 'growth', name: '运营推广频道', departments: ['增长运营部'] },
  { id: 'data', name: '数据分析频道', departments: ['数据智能部', '市场与情报部'] },
  { id: 'random', name: '随便聊聊', departments: [] },
]

export const OFFICE_WIDTH = 1200
export const OFFICE_HEIGHT = 720

export function legacyToEmployeeStatus(status: LegacyStatus, tool?: string): EmployeeStatus {
  if (status === 'running') return tool === 'staff_meeting' ? 'meeting' : 'working'
  if (status === 'wait') return 'blocked'
  if (status === 'done') return 'done'
  return 'idle'
}
