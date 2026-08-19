// 「赛博公司」IM 统一通讯层类型（需求文档二十三 / 二十五 / 二十六 / 二十七 / 二十八 / 三十 / 三十一）。
// 约束：本文件必须保持「纯数据 + 纯函数」，禁止 import node:*，host 与 client 都能安全引用。
// 架构铁律（需求文档二十九）：所有平台共享同一个 employeeId，绝不存在「Web 老王 / 飞书老王」。
import { isSecretRef, RAW_SECRET_FIELDS, type SecretRef, type TaskSource } from '../../persistence/types'

export type { SecretRef, TaskSource }

// ---------------------------------------------------------------------------
// 平台与权限
// ---------------------------------------------------------------------------

/** 已接入或规划中的外部 IM 平台。 */
export type IMPlatform = 'feishu' | 'qq' | 'wechat'

/** 消息来源平台，web 表示 DSH 工作台本身（需求文档二十六）。 */
export type MessagePlatform = 'web' | IMPlatform

export const IM_PLATFORMS: IMPlatform[] = ['feishu', 'qq', 'wechat']

/** 权限档位与 DSH Composer 的 PermissionSelect 保持同一套字面量。 */
export type ExternalPermissionMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** 外部说话人身份（需求文档三十）。owner=老板本人，member=公司成员，guest=陌生人。 */
export type ActorRole = 'owner' | 'member' | 'guest'

export const PERMISSION_RANK: Record<ExternalPermissionMode, number> = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 }

/** 兜底档位：任何未知来源一律 read-only，绝不因为消息来自飞书就默认 Full Access。 */
export const SAFE_PERMISSION_FLOOR: ExternalPermissionMode = 'read-only'

/** 默认员工间转发上限（需求文档三十六）。 */
export const DEFAULT_MAX_EMPLOYEE_HOPS = 4

export const SECRETARY_ID = 'secretary'

export function normalizePermissionMode(value: unknown): ExternalPermissionMode {
  const text = String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (text === 'workspace-write' || text === 'write') return 'workspace-write'
  if (text === 'danger-full-access' || text === 'full-access' || text === 'full') return 'danger-full-access'
  return 'read-only'
}

export function normalizeActorRole(value: unknown): ActorRole {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'owner' || text === 'boss') return 'owner'
  if (text === 'member' || text === 'staff') return 'member'
  return 'guest'
}

/** 取两个档位中更低的一个：用户权限与群权限必须同时满足。 */
export function minPermission(a: ExternalPermissionMode, b: ExternalPermissionMode): ExternalPermissionMode {
  return PERMISSION_RANK[a] <= PERMISSION_RANK[b] ? a : b
}

/** Read Only 渠道不能触发任何写操作（需求文档三十 / 五十七）。 */
export function allowsWrite(mode: ExternalPermissionMode): boolean {
  return PERMISSION_RANK[mode] >= PERMISSION_RANK['workspace-write']
}

// ---------------------------------------------------------------------------
// 写操作闸门（需求文档三十 / 五十七）：Read Only 是代码约束，不是提示词
// ---------------------------------------------------------------------------

/**
 * 写工具关键字。命中任意一个即按写操作处理 —— 宁可把某个只读工具误判成写（fail-closed），
 * 也绝不放过一次真实写。宿主自己的工具名可以避开这些词来表达「这是读」。
 */
const WRITE_TOOL_HINTS = [
  'write', 'edit', 'create', 'update', 'upsert', 'delete', 'remove', 'rename',
  'install', 'uninstall', 'deploy', 'publish', 'send', 'post', 'commit', 'push',
  'apply', 'patch', 'exec', 'shell', 'bash', 'command', 'mkdir', 'chmod', 'save', 'approve',
] as const

/** 工具名是否属于写操作。 */
export function isWriteToolName(name: string): boolean {
  const text = String(name || '').trim().toLowerCase()
  if (!text) return false
  return WRITE_TOOL_HINTS.some((hint) => text.includes(hint))
}

/**
 * 派活时随请求下发的写闸门。
 *
 * **能力边界（不要美化）**：当前 DSH 的子代理 API（`@deepseek-ai/dsh-agent` 已发布 typings）
 * **不接受工具白名单参数**，宿主无法在起子代理时把写工具从它的工具集里真正剔除。
 * 因此只读渠道的实际保证是：
 *   1. 提示词层面明确禁止写操作（`host-v2.ts` 的外部渠道 prompt）；
 *   2. **事后真实观测**：子代理跑完后按 `result` 里真实用过的工具判越权，
 *      一旦命中写工具 → 回复一个字都不外发、任务记 blocked、发 `external.write.denied` 事件、中止转交链。
 * 也就是说这是「写可能已经发生，但结果被拦下且被记录」，**不是预防式拦截**。
 *
 * `assert()` / `filterTools()` 供**支持工具集裁剪的宿主运行时**在注入 dispatcher 时使用；
 * 当前生产链路没有这样的宿主，所以它们只在契约与测试中被调用。
 * 未来 DSH 若提供工具白名单，应当在 `runEmployeeOnce` 起子代理处接上 `filterTools()`，
 * 那时这里才能升级成预防式拦截。
 */
export type WriteGate = {
  /** 只读渠道恒为 false。 */
  allowed: boolean
  /** 被闸门当场拦下的写工具名（写没有发生）。 */
  readonly denied: string[]
  isWriteTool(tool: string): boolean
  /** 不允许时直接 throw，调用方不许吞掉这个异常。 */
  assert(tool: string): void
  /** 只读渠道下把写工具从工具集中剔除。 */
  filterTools<T extends string>(tools: readonly T[]): T[]
}

export function createWriteGate(allowed: boolean): WriteGate {
  const denied: string[] = []
  return {
    allowed,
    denied,
    isWriteTool: isWriteToolName,
    assert(tool: string): void {
      if (allowed || !isWriteToolName(tool)) return
      if (!denied.includes(tool)) denied.push(tool)
      throw new Error(`当前渠道是只读档位（read-only），不允许执行写工具 ${tool}`)
    },
    filterTools<T extends string>(tools: readonly T[]): T[] {
      return allowed ? [...tools] : tools.filter((tool) => !isWriteToolName(tool))
    },
  }
}

// ---------------------------------------------------------------------------
// 附件统一模型（需求文档二十七）
// ---------------------------------------------------------------------------

export type AttachmentKind = 'image' | 'file' | 'audio' | 'video'

export type AttachmentRef = {
  id: string
  type: AttachmentKind
  mime: string
  name: string
  localPath?: string
  url?: string
  size?: number
  source: MessagePlatform
}

// ---------------------------------------------------------------------------
// 通讯消息统一结构（需求文档二十六 + 三十的安全字段）
// ---------------------------------------------------------------------------

export type ConversationType = 'direct' | 'group'

/**
 * 归一化后的外部消息。禁止携带平台原始载荷（可能含密钥/隐私），
 * Adapter 只负责翻译成本结构，permissionMode / actorRole 的最终裁决权在 Gateway。
 */
export type ExternalMessage = {
  id: string
  platform: MessagePlatform
  /** 来源 Adapter 实例 id，用于回信找回同一条连接。 */
  adapterId: string
  conversationId: string
  conversationName?: string
  conversationType?: ConversationType
  senderId: string
  senderName?: string
  text: string
  /** 平台侧真实 @ 到的对象（显示名或 open_id），文本里的「@老王」由 Router 解析。 */
  mentions: string[]
  attachments: AttachmentRef[]
  actorRole: ActorRole
  permissionMode: ExternalPermissionMode
  createdAt: number
  /** 平台侧话题/回复线索 id，用于 reply 而不是新开一条。 */
  threadId?: string
}

export type OutgoingAttachment = {
  type: AttachmentKind
  name?: string
  mime?: string
  localPath?: string
  url?: string
}

export type OutgoingMessage = {
  text: string
  /** employee-reply=某位员工本人的真实回复；notice=系统事实通知；system=连接/降级说明。 */
  kind?: 'employee-reply' | 'notice' | 'system'
  employeeId?: string
  employeeName?: string
  employeeRole?: string
  replyToMessageId?: string
  threadId?: string
  attachments?: OutgoingAttachment[]
}

// ---------------------------------------------------------------------------
// Adapter 接口（需求文档二十八）
// ---------------------------------------------------------------------------

export type AdapterConnectionState = 'idle' | 'connecting' | 'connected' | 'degraded' | 'stopped' | 'error'

export type AdapterStatus = {
  id: string
  platform: IMPlatform
  state: AdapterConnectionState
  /** 面向 UI 的事实说明，禁止包含任何密钥片段。 */
  detail?: string
  lastEventAt?: number
  lastSentAt?: number
  receivedCount: number
  sentCount: number
}

/**
 * Adapter → Gateway 的消息回调允许返回 Promise。
 * 这样一条外部消息的生命周期可以被真正等待到 Router / 员工处理完毕；
 * 旧实现把 handler 写死成 void，Gateway 调完就丢，测试和宿主只能靠 sleep 猜处理是否结束。
 */
export type IMMessageHandler = (message: ExternalMessage) => void | Promise<void>

export interface IMAdapter {
  readonly id: string
  readonly platform: IMPlatform
  start(): Promise<void>
  stop(): Promise<void>
  send(conversationId: string, message: OutgoingMessage): Promise<void>
  /** Adapter 只吐消息，绝不允许自己调用 staff_chat 或另写一套路由（需求文档二十一）。 */
  onMessage(handler: IMMessageHandler): void
  status(): AdapterStatus
}

// ---------------------------------------------------------------------------
// 下方其余通讯配置 / Router 契约保持原样
// ---------------------------------------------------------------------------

export type AdapterCapabilities = {
  text: boolean
  image: boolean
  file: boolean
  audio: boolean
  video: boolean
  thread: boolean
  reaction: boolean
}

export type CredentialMap = Record<string, SecretRef>

export type ActorAccessRule = {
  userId: string
  name?: string
  role: ActorRole
  permissionMode: ExternalPermissionMode
}

export type ConversationAccessRule = {
  conversationId: string
  name?: string
  permissionMode: ExternalPermissionMode
  allowedEmployees?: string[]
}

export type AccessPolicy = {
  allowUnknownUsers: boolean
  allowUnknownConversations: boolean
  defaultPermissionMode: ExternalPermissionMode
  actors: ActorAccessRule[]
  conversations: ConversationAccessRule[]
}

export type AdapterRoutingConfig = {
  defaultTarget: string
  recognizeMentions: boolean
  allowEmployeeHandoff: boolean
  maxHops: number
}

export type CommunicationAdapterConfig = {
  id: string
  platform: IMPlatform
  name: string
  enabled: boolean
  connectionMode: string
  credentials: CredentialMap
  capabilities: AdapterCapabilities
  routing: AdapterRoutingConfig
  access: AccessPolicy
}

export type ChannelBinding = {
  adapterId: string
  externalConversationId: string
  companyChannelId: string
  employeeId?: string
}

export type CommunicationConfig = {
  adapters: CommunicationAdapterConfig[]
  channelBindings: ChannelBinding[]
}

export type AccessDecision = {
  allowed: boolean
  reason?: string
  detail?: string
  actorRole?: ActorRole
  permissionMode?: ExternalPermissionMode
  actorName?: string
  conversationName?: string
  allowedEmployees?: string[]
}

export type CommunicationLogger = {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
  debug?(message: string): void
}

export type CommunicationEvent =
  | { type: 'external.adapter.status'; at: number; platform: IMPlatform; adapterId: string; state: AdapterConnectionState; detail?: string }
  | { type: 'external.message.received'; at: number; platform: MessagePlatform; adapterId: string; conversationId: string; senderId: string; senderName?: string; messageId: string; text: string; targetEmployeeId?: string }
  | { type: 'external.message.sent'; at: number; platform: MessagePlatform; adapterId: string; conversationId: string; kind?: OutgoingMessage['kind']; employeeId?: string; text: string }
  | { type: 'external.message.blocked'; at: number; platform: MessagePlatform; adapterId: string; conversationId: string; senderId: string; reason?: string }
  | { type: 'external.write.denied'; at: number; platform: MessagePlatform; adapterId: string; conversationId: string; employeeId?: string; tools: string[] }

export type CommunicationEventSink = { emit(event: CommunicationEvent): void }

export type RosterEntry = {
  id: string
  name: string
  role: string
  emoji?: string
  department?: string
  brief?: string
  aliases: string[]
  keywords: string[]
}

export type EmployeeDispatchRequest = {
  employeeId: string
  text: string
  taskSource: TaskSource
  platform: MessagePlatform
  adapterId: string
  conversationId: string
  companyChannelId?: string
  senderId: string
  senderName?: string
  actorRole: ActorRole
  permissionMode: ExternalPermissionMode
  writeAllowed: boolean
  writeGate: WriteGate
  attachments: AttachmentRef[]
  hops: number
}

export type EmployeeDispatchResult = {
  ok: boolean
  text: string
  error?: string
  usedTools?: string[]
  handoffTo?: string
}

export type EmployeeDispatcher = (request: EmployeeDispatchRequest) => Promise<EmployeeDispatchResult>

export type TimelineEntry = {
  id: string
  at: number
  platform: MessagePlatform
  adapterId: string
  conversationId: string
  direction: 'in' | 'out' | 'system'
  text: string
  senderId?: string
  senderName?: string
  employeeId?: string
  employeeName?: string
  kind?: OutgoingMessage['kind']
  permissionMode?: ExternalPermissionMode
}

export type CredentialSummary = {
  field: string
  ref: SecretRef
  configured: boolean
  masked: string
}

export type AdapterSummary = {
  id: string
  platform: IMPlatform
  name: string
  enabled: boolean
  connectionMode: string
  state: AdapterConnectionState
  detail?: string
  lastEventAt?: number
  lastSentAt?: number
  receivedCount: number
  sentCount: number
  capabilities: AdapterCapabilities
  routing: AdapterRoutingConfig
  credentials: CredentialSummary[]
  appId?: string
  appSecretConfigured?: boolean
  access: {
    allowUnknownUsers: boolean
    allowUnknownConversations: boolean
    defaultPermissionMode: ExternalPermissionMode
    actorCount: number
    conversationCount: number
  }
}

export type CommunicationSummary = {
  configured: boolean
  adapters: AdapterSummary[]
  channelBindings: ChannelBinding[]
  maxEmployeeHops: number
}

// ---------------------------------------------------------------------------
// 配置归一化与 Secret 安全
// ---------------------------------------------------------------------------

const DEFAULT_CAPABILITIES: AdapterCapabilities = { text: true, image: false, file: false, audio: false, video: false, thread: false, reaction: false }
const EMPTY_ACCESS: AccessPolicy = { allowUnknownUsers: false, allowUnknownConversations: false, defaultPermissionMode: SAFE_PERMISSION_FLOOR, actors: [], conversations: [] }

function asBool(value: unknown, fallback: boolean): boolean { return typeof value === 'boolean' ? value : fallback }
function asArray<T = unknown>(value: unknown): T[] { return Array.isArray(value) ? value : [] }
function uniqStrings(values: unknown[]): string[] { return Array.from(new Set(values.map(String).map((item) => item.trim()).filter(Boolean))) }

export function normalizeCommunicationConfig(input: unknown): CommunicationConfig {
  const raw = input && typeof input === 'object' ? input as any : {}
  const adapters = asArray<any>(raw.adapters).map((item) => normalizeAdapter(item))
  const ids = new Set<string>()
  for (const adapter of adapters) {
    if (ids.has(adapter.id)) throw new Error(`通讯渠道 id 重复：${adapter.id}`)
    ids.add(adapter.id)
  }
  return {
    adapters,
    channelBindings: asArray<any>(raw.channelBindings).map((item) => ({
      adapterId: String(item?.adapterId || '').trim(),
      externalConversationId: String(item?.externalConversationId || '').trim(),
      companyChannelId: String(item?.companyChannelId || '').trim(),
      employeeId: item?.employeeId ? String(item.employeeId).trim() : undefined,
    })).filter((item) => item.adapterId && item.externalConversationId && item.companyChannelId),
  }
}

function normalizeAdapter(input: any): CommunicationAdapterConfig {
  const item = input && typeof input === 'object' ? input : {}
  for (const field of RAW_SECRET_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(item, field) && item[field] != null) throw new Error(`通讯配置不允许明文字段 ${field}，请改用 credentials 里的 env:/secret: 引用`)
  }
  const platform = String(item.platform || '').trim().toLowerCase()
  if (!IM_PLATFORMS.includes(platform as IMPlatform)) throw new Error(`未知通讯平台：${platform || '(空)'}`)
  const id = String(item.id || '').trim()
  if (!id) throw new Error('通讯渠道 id 不能为空')
  const credentialsRaw = item.credentials && typeof item.credentials === 'object' ? item.credentials : {}
  const credentials: CredentialMap = {}
  for (const [key, value] of Object.entries(credentialsRaw)) {
    if (!isSecretRef(value)) throw new Error(`通讯渠道 ${id} 的 credentials.${key} 必须是 env:/secret: 引用`)
    credentials[key] = value
  }
  const accessRaw = item.access && typeof item.access === 'object' ? item.access : {}
  const actors = asArray<any>(accessRaw.actors).map((row) => ({
    userId: String(row?.userId || '').trim(),
    name: row?.name ? String(row.name).trim() : undefined,
    role: normalizeActorRole(row?.role),
    permissionMode: normalizePermissionMode(row?.permissionMode),
  })).filter((row) => row.userId)
  const conversations = asArray<any>(accessRaw.conversations).map((row) => ({
    conversationId: String(row?.conversationId || '').trim(),
    name: row?.name ? String(row.name).trim() : undefined,
    permissionMode: normalizePermissionMode(row?.permissionMode),
    allowedEmployees: uniqStrings(asArray(row?.allowedEmployees)),
  })).filter((row) => row.conversationId)
  const routingRaw = item.routing && typeof item.routing === 'object' ? item.routing : {}
  return {
    id,
    platform: platform as IMPlatform,
    name: String(item.name || id).trim(),
    enabled: asBool(item.enabled, true),
    connectionMode: String(item.connectionMode || '').trim(),
    credentials,
    capabilities: {
      text: asBool(item.capabilities?.text, DEFAULT_CAPABILITIES.text),
      image: asBool(item.capabilities?.image, DEFAULT_CAPABILITIES.image),
      file: asBool(item.capabilities?.file, DEFAULT_CAPABILITIES.file),
      audio: asBool(item.capabilities?.audio, DEFAULT_CAPABILITIES.audio),
      video: asBool(item.capabilities?.video, DEFAULT_CAPABILITIES.video),
      thread: asBool(item.capabilities?.thread, DEFAULT_CAPABILITIES.thread),
      reaction: asBool(item.capabilities?.reaction, DEFAULT_CAPABILITIES.reaction),
    },
    routing: {
      defaultTarget: String(routingRaw.defaultTarget || SECRETARY_ID).trim() || SECRETARY_ID,
      recognizeMentions: asBool(routingRaw.recognizeMentions, true),
      allowEmployeeHandoff: asBool(routingRaw.allowEmployeeHandoff, true),
      maxHops: Math.max(0, Math.min(12, Math.floor(Number(routingRaw.maxHops) || DEFAULT_MAX_EMPLOYEE_HOPS))),
    },
    access: {
      allowUnknownUsers: asBool(accessRaw.allowUnknownUsers, false),
      allowUnknownConversations: asBool(accessRaw.allowUnknownConversations, false),
      defaultPermissionMode: normalizePermissionMode(accessRaw.defaultPermissionMode),
      actors,
      conversations,
    },
  }
}

export function maskSecretValue(value: string | undefined, prefix = ''): string {
  if (!value) return ''
  const text = String(value)
  if (text.length <= 4) return '****'
  const head = prefix && text.startsWith(prefix) ? prefix : text.slice(0, Math.min(3, text.length))
  return `${head}****${text.slice(-2)}`
}
