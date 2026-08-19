// 「赛博公司」Company Event Bus 事件模型 + 纯函数 reducer（需求文档三十二 / 三十三 / 三十四）。
//
// 硬约束：
//   1. 本文件必须保持「纯类型 + 纯函数」：禁止 import node:*、禁止访问 window/document、
//      禁止调用 Date.now()。所有时间一律从事件的 at 字段读取，reducer 因此可被 node:test 直接单测。
//   2. 办公室只允许消费这里产出的状态，不得自己制造业务状态（三十三条）。
//   3. idle 员工永远待在工位。任何「随机走动 / 茶水间 / 上厕所」逻辑都不得进入本文件（三十四条），
//      tick 更是绝对不允许出现在这里。
import type { TaskOutcome, TaskSource } from '../persistence/types'

/** 事件来源平台。复用持久化层的 TaskSource，避免重复定义同一套渠道枚举。 */
export type EventPlatform = TaskSource

export type CompanyEventType =
  | 'task.assigned' | 'task.started' | 'task.completed' | 'task.blocked'
  | 'tool.started' | 'tool.completed'
  | 'meeting.started' | 'meeting.finished'
  | 'message.received' | 'message.sent'
  | 'vision.started' | 'vision.completed'
  | 'plugin.discovered' | 'plugin.install.started' | 'plugin.installed'
  | 'skill.updated'

export const COMPANY_EVENT_TYPES: CompanyEventType[] = [
  'task.assigned', 'task.started', 'task.completed', 'task.blocked',
  'tool.started', 'tool.completed',
  'meeting.started', 'meeting.finished',
  'message.received', 'message.sent',
  'vision.started', 'vision.completed',
  'plugin.discovered', 'plugin.install.started', 'plugin.installed',
  'skill.updated',
]

type EventBase<K extends CompanyEventType> = {
  /** 事件唯一 id：同 id 视为同一条事件，重复投递会被去重。 */
  id: string
  type: K
  /** 事件发生时间（毫秒）。reducer 只信这个字段，永不读系统时钟。 */
  at: number
  /** 事件来源通道，便于按来源做幂等全量替换（如 'session' / 'feishu' / 'host'）。 */
  origin?: string
}

// ---------------------------------------------------------------------------
// 任务
// ---------------------------------------------------------------------------

export type TaskAssignedEvent = EventBase<'task.assigned'> & {
  employeeId: string
  taskId: string
  title: string
  tool?: string
  source?: EventPlatform
  channelId?: string
}

export type TaskStartedEvent = EventBase<'task.started'> & {
  employeeId: string
  taskId: string
  title: string
  tool?: string
}

export type TaskCompletedEvent = EventBase<'task.completed'> & {
  employeeId: string
  taskId: string
  outcome: TaskOutcome
  summary?: string
}

export type TaskBlockedEvent = EventBase<'task.blocked'> & {
  employeeId: string
  taskId: string
  reason: string
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

export type ToolStartedEvent = EventBase<'tool.started'> & {
  employeeId: string
  callId: string
  tool: string
  /** 展示用文案，缺省时由 toolActivityLabel(tool) 推导。 */
  label?: string
  taskId?: string
}

export type ToolCompletedEvent = EventBase<'tool.completed'> & {
  employeeId: string
  callId: string
  tool: string
  ok: boolean
  taskId?: string
}

// ---------------------------------------------------------------------------
// 会议
// ---------------------------------------------------------------------------

export type MeetingStartedEvent = EventBase<'meeting.started'> & {
  meetingId: string
  participants: string[]
  topic: string
}

export type MeetingFinishedEvent = EventBase<'meeting.finished'> & {
  meetingId: string
  /** 缺省时用 meeting.started 记录的参会人。 */
  participants?: string[]
  summary?: string
}

// ---------------------------------------------------------------------------
// 外部通讯（需求文档二十六：ExternalMessage 统一结构）
// ---------------------------------------------------------------------------

export type MessageReceivedEvent = EventBase<'message.received'> & {
  platform: EventPlatform
  conversationId: string
  preview: string
  senderName?: string
  /** 明确 @ 到某位员工时填写；缺省进前台（秘书）。 */
  targetEmployeeId?: string
  mentions?: string[]
}

export type MessageSentEvent = EventBase<'message.sent'> & {
  platform: EventPlatform
  conversationId: string
  employeeId: string
  preview?: string
}

// ---------------------------------------------------------------------------
// 视觉能力（需求文档十三：vision_analyze）
// ---------------------------------------------------------------------------

export type VisionStartedEvent = EventBase<'vision.started'> & {
  employeeId: string
  callId: string
  mode?: string
  images?: number
}

export type VisionCompletedEvent = EventBase<'vision.completed'> & {
  employeeId: string
  callId: string
  ok: boolean
  description?: string
}

// ---------------------------------------------------------------------------
// 插件（需求文档 Phase 5）
// ---------------------------------------------------------------------------

export type PluginDiscoveredEvent = EventBase<'plugin.discovered'> & {
  employeeId?: string
  pluginName: string
  pluginId?: string
  source?: string
}

export type PluginInstallStartedEvent = EventBase<'plugin.install.started'> & {
  employeeId: string
  pluginName: string
  pluginId?: string
}

export type PluginInstalledEvent = EventBase<'plugin.installed'> & {
  employeeId: string
  pluginName: string
  pluginId?: string
  ok: boolean
}

// ---------------------------------------------------------------------------
// 技能
// ---------------------------------------------------------------------------

export type SkillUpdatedEvent = EventBase<'skill.updated'> & {
  employeeId: string
  skillName: string
  skillId?: string
  level?: number
  source?: string
}

export type CompanyEvent =
  | TaskAssignedEvent
  | TaskStartedEvent
  | TaskCompletedEvent
  | TaskBlockedEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | MeetingStartedEvent
  | MeetingFinishedEvent
  | MessageReceivedEvent
  | MessageSentEvent
  | VisionStartedEvent
  | VisionCompletedEvent
  | PluginDiscoveredEvent
  | PluginInstallStartedEvent
  | PluginInstalledEvent
  | SkillUpdatedEvent

// ---------------------------------------------------------------------------
// 运行时状态（办公室唯一可消费的数据）
// ---------------------------------------------------------------------------

/** 事件目标位。工位之外的每一个都必须由真实事件触发，没有事件就永远待在工位。 */
export type EmployeeStation = 'desk' | 'meeting' | 'media-lab' | 'server-room' | 'reception'

export type EmployeeRuntimeStatus = 'idle' | 'working' | 'meeting' | 'blocked' | 'done' | 'vision' | 'installing'

export const EMPLOYEE_RUNTIME_LABEL: Record<EmployeeRuntimeStatus, string> = {
  idle: '待命中',
  working: '正在工作',
  meeting: '会议中',
  blocked: '卡住了',
  done: '已交付',
  vision: '识图中',
  installing: '安装插件',
}

export const STATION_LABEL: Record<EmployeeStation, string> = {
  desk: '工位',
  meeting: '会议室',
  'media-lab': '多媒体工作台',
  'server-room': '服务器机房',
  reception: '前台',
}

export type RuntimeTask = { id: string; title: string; startedAt: number; tool?: string }
export type RuntimeTool = { callId: string; name: string; label: string; startedAt: number }
export type RuntimeMeeting = { id: string; topic: string; participants: string[]; startedAt: number }
export type RuntimeVision = { callId: string; mode?: string; images?: number; startedAt: number }
export type RuntimePluginInstall = { pluginName: string; pluginId?: string; startedAt: number }
export type RuntimeBlock = { taskId: string; reason: string; at: number }
export type RuntimeSkill = { name: string; level?: number; at: number }

export type ReceptionNotice = {
  id: string
  platform: EventPlatform
  conversationId: string
  preview: string
  senderName?: string
  targetEmployeeId?: string
  at: number
}

export type EmployeeRuntimeState = {
  employeeId: string
  status: EmployeeRuntimeStatus
  station: EmployeeStation
  /** 展示文案，已按优先级挑好，UI 直接用即可，不要再自己编。 */
  activity: string
  task: RuntimeTask | null
  tool: RuntimeTool | null
  meeting: RuntimeMeeting | null
  vision: RuntimeVision | null
  pluginInstall: RuntimePluginInstall | null
  block: RuntimeBlock | null
  lastSkill: RuntimeSkill | null
  lastOutcome: TaskOutcome | null
  /** 已派但尚未开工的任务数。 */
  pending: number
  /** 该员工被点名的外部消息提示。 */
  notices: ReceptionNotice[]
  /** 最后一条与该员工相关的事件时间；纯展示用，不参与位置。 */
  updatedAt: number
}

export type ReceptionState = {
  /** 尚未被对应会话回复的外部消息提示。 */
  notices: ReceptionNotice[]
  unread: number
  lastAt: number
}

export type CompanyRuntime = {
  employees: Record<string, EmployeeRuntimeState>
  reception: ReceptionState
  meetings: Record<string, RuntimeMeeting>
  /** 已发现但尚未安装的插件（真实 discovered 事件，没有就是空）。 */
  discoveredPlugins: Array<{ pluginName: string; pluginId?: string; source?: string; at: number }>
  eventCount: number
  updatedAt: number
}

// ---------------------------------------------------------------------------
// 工具文案
// ---------------------------------------------------------------------------

const TOOL_LABEL: Record<string, string> = {
  build: '构建中', test: '跑测试中', lint: '静态检查中', bash: '执行命令中', shell: '执行命令中',
  read: '读代码中', write: '写文件中', edit: '改代码中', patch: '改代码中',
  grep: '检索代码中', glob: '查找文件中', ls: '翻目录中',
  web_search: '联网检索中', fetch: '抓取网页中', browse: '看网页中',
  vision_analyze: '识图中',
  staff_chat: '沟通中', staff_meeting: '开会中',
  staff_memory_recall: '回忆中', staff_memory_remember: '记笔记中',
  staff_skill_learn: '学新技能中', staff_reflect: '复盘中',
  staff_profile: '查档案中', staff_capability_scan: '盘点能力中',
  staff_plugin_market_search: '逛插件市场中',
}

/** 工具名 → 中文进行时文案。没有映射时退化成「xxx 执行中」，绝不编造别的业务含义。 */
export function toolActivityLabel(tool: string): string {
  const name = String(tool || '').trim()
  if (!name) return '执行工具中'
  return TOOL_LABEL[name] || TOOL_LABEL[name.toLowerCase()] || `${name} 执行中`
}

// ---------------------------------------------------------------------------
// 事件规整（纯函数）
// ---------------------------------------------------------------------------

/** 按 id 去重，先到先得。 */
export function dedupeCompanyEvents(events: readonly CompanyEvent[]): CompanyEvent[] {
  const seen = new Set<string>()
  const out: CompanyEvent[] = []
  for (const event of events || []) {
    if (!event || !event.id || seen.has(event.id)) continue
    seen.add(event.id)
    out.push(event)
  }
  return out
}

/** 按 at 稳定排序；at 相同时保持投递顺序，保证 reducer 结果可复现。 */
export function sortCompanyEvents(events: readonly CompanyEvent[]): CompanyEvent[] {
  return (events || [])
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (a.event.at - b.event.at) || (a.index - b.index))
    .map((item) => item.event)
}

// ---------------------------------------------------------------------------
// reducer
// ---------------------------------------------------------------------------

type Draft = {
  employeeId: string
  tasks: Map<string, RuntimeTask>
  pending: Map<string, RuntimeTask>
  tools: Map<string, RuntimeTool>
  meetings: Map<string, RuntimeMeeting>
  visions: Map<string, RuntimeVision>
  installs: Map<string, RuntimePluginInstall>
  notices: ReceptionNotice[]
  block: RuntimeBlock | null
  lastSkill: RuntimeSkill | null
  lastOutcome: TaskOutcome | null
  lastTitle: string
  updatedAt: number
}

function newDraft(employeeId: string): Draft {
  return {
    employeeId,
    tasks: new Map(), pending: new Map(), tools: new Map(),
    meetings: new Map(), visions: new Map(), installs: new Map(),
    notices: [], block: null, lastSkill: null, lastOutcome: null, lastTitle: '', updatedAt: 0,
  }
}

function last<T>(map: Map<string, T>): T | null {
  let value: T | null = null
  for (const item of map.values()) value = item
  return value
}

/** 空状态：站在工位，什么也不干。没有任何事件时全公司就长这样，10 分钟也不会动。 */
export function emptyEmployeeRuntime(employeeId: string): EmployeeRuntimeState {
  return {
    employeeId, status: 'idle', station: 'desk', activity: '工位待命',
    task: null, tool: null, meeting: null, vision: null, pluginInstall: null,
    block: null, lastSkill: null, lastOutcome: null, pending: 0, notices: [], updatedAt: 0,
  }
}

function finalize(draft: Draft): EmployeeRuntimeState {
  const meeting = last(draft.meetings)
  const install = last(draft.installs)
  const vision = last(draft.visions)
  const tool = last(draft.tools)
  const task = last(draft.tasks)
  const pending = draft.pending.size
  const notices = draft.notices.slice()

  // 优先级：会议 > 装插件 > 识图 > 工具 > 任务 > 卡住 > 已交付 > 待命。
  // 这个顺序是确定的、无随机的，办公室只按它落位。
  let status: EmployeeRuntimeStatus = 'idle'
  let station: EmployeeStation = 'desk'
  let activity = '工位待命'
  if (meeting) {
    status = 'meeting'; station = 'meeting'
    activity = meeting.topic ? `在会议室讨论：${meeting.topic}` : '在会议室讨论'
  } else if (install) {
    status = 'installing'; station = 'server-room'
    activity = `服务器机房 · 安装插件 ${install.pluginName}`
  } else if (vision) {
    status = 'vision'; station = 'media-lab'
    activity = vision.mode ? `多媒体工作台 · 识图中（${vision.mode}）` : '多媒体工作台 · 识图中'
  } else if (tool) {
    status = 'working'; station = 'desk'
    activity = tool.label
  } else if (task) {
    status = 'working'; station = 'desk'
    activity = task.title ? `处理任务：${task.title}` : '处理真实任务'
  } else if (draft.block) {
    status = 'blocked'; station = 'desk'
    activity = draft.block.reason ? `任务卡住：${draft.block.reason}` : '任务卡住，等老板决策'
  } else if (draft.lastOutcome) {
    status = 'done'; station = 'desk'
    activity = draft.lastTitle ? `已交付：${draft.lastTitle}` : '整理交付'
  } else if (pending > 0) {
    status = 'working'; station = 'desk'
    activity = `已接活 ${pending} 个，准备开工`
  }

  return {
    employeeId: draft.employeeId,
    status, station, activity,
    task, tool, meeting, vision,
    pluginInstall: install,
    block: draft.block,
    lastSkill: draft.lastSkill,
    lastOutcome: draft.lastOutcome,
    pending, notices,
    updatedAt: draft.updatedAt,
  }
}

export type ReduceOptions = {
  /** 预置员工名册：保证名册里的人即使一条事件都没有也有一份 idle 状态。 */
  employeeIds?: readonly string[]
  /** 前台提示保留条数上限，默认 6。 */
  noticeLimit?: number
}

/**
 * 事件 → 公司运行时状态。纯函数：同样的输入必然得到同样的输出，
 * 不读系统时钟、不产生副作用、不依赖 tick。
 */
export function reduceCompanyRuntime(events: readonly CompanyEvent[], options?: ReduceOptions): CompanyRuntime {
  const noticeLimit = Math.max(1, options?.noticeLimit ?? 6)
  const drafts = new Map<string, Draft>()
  const meetings = new Map<string, RuntimeMeeting>()
  const notices = new Map<string, ReceptionNotice>()
  const discovered = new Map<string, { pluginName: string; pluginId?: string; source?: string; at: number }>()
  let updatedAt = 0

  for (const id of options?.employeeIds || []) {
    if (id && !drafts.has(id)) drafts.set(id, newDraft(id))
  }

  const draftOf = (employeeId: string): Draft => {
    let draft = drafts.get(employeeId)
    if (!draft) { draft = newDraft(employeeId); drafts.set(employeeId, draft) }
    return draft
  }
  const touch = (draft: Draft, at: number) => { if (at > draft.updatedAt) draft.updatedAt = at }

  const ordered = sortCompanyEvents(dedupeCompanyEvents(events))
  for (const event of ordered) {
    if (event.at > updatedAt) updatedAt = event.at
    switch (event.type) {
      case 'task.assigned': {
        const draft = draftOf(event.employeeId)
        if (!draft.tasks.has(event.taskId)) {
          draft.pending.set(event.taskId, { id: event.taskId, title: event.title, startedAt: event.at, tool: event.tool })
        }
        draft.block = null
        touch(draft, event.at)
        break
      }
      case 'task.started': {
        const draft = draftOf(event.employeeId)
        draft.pending.delete(event.taskId)
        draft.tasks.set(event.taskId, { id: event.taskId, title: event.title, startedAt: event.at, tool: event.tool })
        draft.block = null
        draft.lastTitle = event.title
        touch(draft, event.at)
        break
      }
      case 'task.completed': {
        const draft = draftOf(event.employeeId)
        const known = draft.tasks.get(event.taskId) || draft.pending.get(event.taskId)
        if (known?.title) draft.lastTitle = known.title
        draft.tasks.delete(event.taskId)
        draft.pending.delete(event.taskId)
        draft.block = null
        draft.lastOutcome = event.outcome
        touch(draft, event.at)
        break
      }
      case 'task.blocked': {
        const draft = draftOf(event.employeeId)
        const known = draft.tasks.get(event.taskId) || draft.pending.get(event.taskId)
        if (known?.title) draft.lastTitle = known.title
        draft.tasks.delete(event.taskId)
        draft.pending.delete(event.taskId)
        draft.block = { taskId: event.taskId, reason: event.reason, at: event.at }
        draft.lastOutcome = 'blocked'
        touch(draft, event.at)
        break
      }
      case 'tool.started': {
        const draft = draftOf(event.employeeId)
        draft.tools.set(event.callId, {
          callId: event.callId, name: event.tool,
          label: event.label || toolActivityLabel(event.tool), startedAt: event.at,
        })
        touch(draft, event.at)
        break
      }
      case 'tool.completed': {
        const draft = draftOf(event.employeeId)
        draft.tools.delete(event.callId)
        touch(draft, event.at)
        break
      }
      case 'meeting.started': {
        const participants = (event.participants || []).filter(Boolean)
        const meeting: RuntimeMeeting = { id: event.meetingId, topic: event.topic, participants, startedAt: event.at }
        meetings.set(event.meetingId, meeting)
        for (const employeeId of participants) {
          const draft = draftOf(employeeId)
          draft.meetings.set(event.meetingId, meeting)
          touch(draft, event.at)
        }
        break
      }
      case 'meeting.finished': {
        const known = meetings.get(event.meetingId)
        const participants = (event.participants && event.participants.length ? event.participants : known?.participants) || []
        meetings.delete(event.meetingId)
        for (const employeeId of participants) {
          const draft = draftOf(employeeId)
          draft.meetings.delete(event.meetingId)
          touch(draft, event.at)
        }
        break
      }
      case 'message.received': {
        const notice: ReceptionNotice = {
          id: event.id, platform: event.platform, conversationId: event.conversationId,
          preview: event.preview, senderName: event.senderName,
          targetEmployeeId: event.targetEmployeeId, at: event.at,
        }
        notices.set(event.id, notice)
        if (event.targetEmployeeId) {
          const draft = draftOf(event.targetEmployeeId)
          draft.notices.push(notice)
          touch(draft, event.at)
        }
        break
      }
      case 'message.sent': {
        // 同一会话已经回过了，前台提示就该消失——这是真实状态，不是定时清理。
        for (const [key, notice] of [...notices]) {
          if (notice.platform === event.platform && notice.conversationId === event.conversationId) notices.delete(key)
        }
        const draft = draftOf(event.employeeId)
        draft.notices = draft.notices.filter((notice) => !(notice.platform === event.platform && notice.conversationId === event.conversationId))
        touch(draft, event.at)
        break
      }
      case 'vision.started': {
        const draft = draftOf(event.employeeId)
        draft.visions.set(event.callId, { callId: event.callId, mode: event.mode, images: event.images, startedAt: event.at })
        touch(draft, event.at)
        break
      }
      case 'vision.completed': {
        const draft = draftOf(event.employeeId)
        draft.visions.delete(event.callId)
        touch(draft, event.at)
        break
      }
      case 'plugin.discovered': {
        discovered.set(event.pluginId || event.pluginName, {
          pluginName: event.pluginName, pluginId: event.pluginId, source: event.source, at: event.at,
        })
        if (event.employeeId) touch(draftOf(event.employeeId), event.at)
        break
      }
      case 'plugin.install.started': {
        const draft = draftOf(event.employeeId)
        draft.installs.set(event.pluginId || event.pluginName, {
          pluginName: event.pluginName, pluginId: event.pluginId, startedAt: event.at,
        })
        touch(draft, event.at)
        break
      }
      case 'plugin.installed': {
        const draft = draftOf(event.employeeId)
        const key = event.pluginId || event.pluginName
        draft.installs.delete(key)
        if (event.ok) discovered.delete(key)
        touch(draft, event.at)
        break
      }
      case 'skill.updated': {
        const draft = draftOf(event.employeeId)
        draft.lastSkill = { name: event.skillName, level: event.level, at: event.at }
        touch(draft, event.at)
        break
      }
      default:
        break
    }
  }

  const employees: Record<string, EmployeeRuntimeState> = {}
  for (const [employeeId, draft] of drafts) employees[employeeId] = finalize(draft)

  const receptionNotices = [...notices.values()].sort((a, b) => a.at - b.at).slice(-noticeLimit)
  return {
    employees,
    reception: {
      notices: receptionNotices,
      unread: receptionNotices.length,
      lastAt: receptionNotices.length ? receptionNotices[receptionNotices.length - 1].at : 0,
    },
    meetings: Object.fromEntries(meetings),
    discoveredPlugins: [...discovered.values()].sort((a, b) => a.at - b.at),
    eventCount: ordered.length,
    updatedAt,
  }
}

/** 需求文档三十二条要求的主形态：CompanyEvent[] → Record<employeeId, EmployeeRuntimeState>。 */
export function reduceEmployeeRuntime(events: readonly CompanyEvent[], options?: ReduceOptions): Record<string, EmployeeRuntimeState> {
  return reduceCompanyRuntime(events, options).employees
}

/** 取单个员工状态；没有事件时返回工位待命的空状态，绝不返回 undefined 让 UI 自己脑补。 */
export function employeeRuntimeOf(runtime: CompanyRuntime | null | undefined, employeeId: string): EmployeeRuntimeState {
  return runtime?.employees[employeeId] || emptyEmployeeRuntime(employeeId)
}

export function emptyCompanyRuntime(): CompanyRuntime {
  return { employees: {}, reception: { notices: [], unread: 0, lastAt: 0 }, meetings: {}, discoveredPlugins: [], eventCount: 0, updatedAt: 0 }
}
