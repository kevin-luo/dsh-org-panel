// 「赛博公司」IM 统一通讯层类型。
// 约束：纯数据 + 纯函数，host/client 都可安全引用。
// 架构铁律：平台层只负责传输与权限；员工选择统一由 Work Orchestrator 完成。
import { isSecretRef, RAW_SECRET_FIELDS, type SecretRef, type TaskSource } from '../../persistence/types'

export type { SecretRef, TaskSource }

// ---------------------------------------------------------------------------
// 平台与权限
// ---------------------------------------------------------------------------

export type IMPlatform = 'feishu' | 'qq' | 'wechat'
export type MessagePlatform = 'web' | IMPlatform
export const IM_PLATFORMS: IMPlatform[] = ['feishu', 'qq', 'wechat']

export type ExternalPermissionMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type ActorRole = 'owner' | 'member' | 'guest'

export const PERMISSION_RANK: Record<ExternalPermissionMode, number> = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 }
export const SAFE_PERMISSION_FLOOR: ExternalPermissionMode = 'read-only'
export const DEFAULT_MAX_WORKGROUP_SIZE = 4

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

export function minPermission(a: ExternalPermissionMode, b: ExternalPermissionMode): ExternalPermissionMode {
  return PERMISSION_RANK[a] <= PERMISSION_RANK[b] ? a : b
}

export function allowsWrite(mode: ExternalPermissionMode): boolean {
  return PERMISSION_RANK[mode] >= PERMISSION_RANK['workspace-write']
}

// ---------------------------------------------------------------------------
// 写操作闸门：Read Only 是代码约束，不是提示词
// ---------------------------------------------------------------------------

const WRITE_TOOL_HINTS = [
  'write', 'edit', 'create', 'update', 'upsert', 'delete', 'remove', 'rename',
  'install', 'uninstall', 'deploy', 'publish', 'send', 'post', 'commit', 'push',
  'apply', 'patch', 'exec', 'shell', 'bash', 'command', 'mkdir', 'chmod', 'save', 'approve',
] as const

export function isWriteToolName(name: string): boolean {
  const text = String(name || '').trim().toLowerCase()
  if (!text) return false
  return WRITE_TOOL_HINTS.some((hint) => text.includes(hint))
}

/**
 * 当前 DSH 子代理 API 暂无真正的 per-run 工具白名单，因此只读来源采用两层约束：
 * 1. Employee Runtime prompt 明确禁止写；
 * 2. 运行后按真实 usedTools 审计，发现写工具就拦截该员工的外部回复并记录事件。
 * `assert/filterTools` 保留给将来支持工具裁剪的执行器，不宣称当前已经是预防式沙箱。
 */
export type WriteGate = {
  allowed: boolean
  readonly denied: string[]
  isWriteTool(tool: string): boolean
  assert(tool: string): void
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
// 附件与消息
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

export type ConversationType = 'direct' | 'group'

export type ExternalMessage = {
  id: string
  platform: MessagePlatform
  adapterId: string
  conversationId: string
  conversationName?: string
  conversationType?: ConversationType
  senderId: string
  senderName?: string
  text: string
  /** 平台侧真实 mention；Work Router 会把它并入 Work Orchestrator 可理解的任务文本。 */
  mentions: string[]
  attachments: AttachmentRef[]
  actorRole: ActorRole
  permissionMode: ExternalPermissionMode
  createdAt: number
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
  kind?: 'employee-reply' | 'notice' | 'system'
  employeeId?: string
  employeeName?: string
  employeeRole?: string
  replyToMessageId?: string
  threadId?: string
  attachments?: OutgoingAttachment[]
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export type AdapterConnectionState = 'idle' | 'connecting' | 'connected' | 'degraded' | 'stopped' | 'error'

export type AdapterStatus = {
  id: string
  platform: IMPlatform
  state: AdapterConnectionState
  detail?: string
  lastEventAt?: number
  lastSentAt?: number
  receivedCount: number
  sentCount: number
}

export type IMMessageHandler = (message: ExternalMessage) => void | Promise<void>

export interface IMAdapter {
  readonly id: string
  readonly platform: IMPlatform
  start(): Promise<void>
  stop(): Promise<void>
  send(conversationId: string, message: OutgoingMessage): Promise<void>
  /** Adapter 只吐消息，不做员工路由。 */
  onMessage(handler: IMMessageHandler): void
  status(): AdapterStatus
}

export type AdapterRuntime = {
  logger?: { info?: (message: string) => void; warn?: (message: string) => void; error?: (message: string) => void }
  resolveSecret: (ref: SecretRef) => Promise<string | undefined>
  attachmentDir: string
}

// ---------------------------------------------------------------------------
// 通讯配置
// ---------------------------------------------------------------------------

export type ExternalActorRule = {
  userId: string
  name?: string
  role: ActorRole
  permissionMode: ExternalPermissionMode
}

export type ExternalConversationRule = {
  conversationId: string
  name?: string
  permissionMode: ExternalPermissionMode
  /** 这是权限范围，不是默认负责人。留空表示整家公司都可被 Orchestrator 激活。 */
  allowedEmployees?: string[]
}

export type AccessPolicy = {
  defaultPermissionMode: ExternalPermissionMode
  allowUnknownUsers: boolean
  allowUnknownConversations: boolean
  actors: ExternalActorRule[]
  conversations: ExternalConversationRule[]
}

/**
 * 每个外部渠道只保留真正属于“渠道入口”的行为。
 * 不再存在 defaultTarget / secretary fallback / handoff / maxHops。
 */
export type AdapterRouting = {
  maxWorkgroupSize: number
  notifyUndeliverable: boolean
}

export type AdapterCapabilities = {
  text: boolean
  image: boolean
  file: boolean
  audio: boolean
  video: boolean
}

export type CommunicationAdapterConfig = {
  id: string
  platform: IMPlatform
  name: string
  enabled: boolean
  connectionMode?: string
  credentials: Record<string, SecretRef>
  routing: AdapterRouting
  capabilities: AdapterCapabilities
  access: AccessPolicy
  options?: Record<string, string | number | boolean>
}

/** 外部会话只映射内部频道，不绑定默认员工。 */
export type ChannelBinding = {
  adapterId: string
  externalConversationId: string
  companyChannelId: string
}

export type CommunicationConfig = {
  adapters: CommunicationAdapterConfig[]
  channelBindings: ChannelBinding[]
}

// ---------------------------------------------------------------------------
// 对外摘要
// ---------------------------------------------------------------------------

export type CredentialSummary = { field: string; ref: SecretRef; configured: boolean; masked: string }

export type AdapterSummary = {
  id: string
  platform: IMPlatform
  name: string
  enabled: boolean
  connectionMode?: string
  state: AdapterConnectionState
  detail?: string
  lastEventAt?: number
  lastSentAt?: number
  receivedCount: number
  sentCount: number
  capabilities: AdapterCapabilities
  routing: AdapterRouting
  credentials: CredentialSummary[]
  appId?: string
  appSecretConfigured?: boolean
  access: { allowUnknownUsers: boolean; allowUnknownConversations: boolean; defaultPermissionMode: ExternalPermissionMode; actorCount: number; conversationCount: number }
}

export type CommunicationSummary = {
  configured: boolean
  adapters: AdapterSummary[]
  channelBindings: ChannelBinding[]
  maxWorkgroupSize: number
}

export function maskSecretValue(value: string | undefined, prefixHint = ''): string {
  const text = String(value ?? '')
  if (!text) return ''
  const tail = text.slice(-4)
  const head = prefixHint && text.startsWith(prefixHint) ? prefixHint : text.slice(0, Math.min(4, Math.max(0, text.length - 4)))
  return `${head}****${tail}`
}

export function describeSecretRef(ref: SecretRef): string {
  return ref.startsWith('env:') ? `环境变量 ${ref.slice(4)}` : `密钥库 ${ref.slice(7)}`
}

// ---------------------------------------------------------------------------
// 配置清洗
// ---------------------------------------------------------------------------

export function assertCredentialRefs(adapterId: string, credentials: Record<string, unknown>): Record<string, SecretRef> {
  const result: Record<string, SecretRef> = {}
  for (const [field, value] of Object.entries(credentials || {})) {
    if (value === undefined || value === null || value === '') continue
    if (!isSecretRef(value)) {
      throw new Error(`通讯渠道 ${adapterId} 的凭据 ${field} 必须写成 env:XXX 或 secret:XXX 引用，禁止明文密钥`)
    }
    result[field] = value
  }
  return result
}

export function assertNoRawSecrets(adapterId: string, options: Record<string, unknown> | undefined): void {
  for (const field of Object.keys(options || {})) {
    if ((RAW_SECRET_FIELDS as readonly string[]).includes(field)) {
      throw new Error(`通讯渠道 ${adapterId} 的 options.${field} 疑似明文密钥，请改用 credentials 里的 env:/secret: 引用`)
    }
  }
}

function normalizeActorRule(row: any, fallback: ExternalPermissionMode): ExternalActorRule | null {
  const userId = String(row?.userId || row?.id || '').trim()
  if (!userId) return null
  const raw = row?.permissionMode ?? row?.permission
  return { userId, name: row?.name ? String(row.name) : undefined, role: normalizeActorRole(row?.role), permissionMode: raw === undefined ? fallback : normalizePermissionMode(raw) }
}

function normalizeConversationRule(row: any, fallback: ExternalPermissionMode): ExternalConversationRule | null {
  const conversationId = String(row?.conversationId || row?.id || row?.chatId || '').trim()
  if (!conversationId) return null
  const allowed = Array.isArray(row?.allowedEmployees) ? row.allowedEmployees.map(String).filter(Boolean) : undefined
  const raw = row?.permissionMode ?? row?.permission
  return { conversationId, name: row?.name ? String(row.name) : undefined, permissionMode: raw === undefined ? fallback : normalizePermissionMode(raw), allowedEmployees: allowed?.length ? allowed : undefined }
}

export function normalizeAccessPolicy(raw: any): AccessPolicy {
  const fallback = normalizePermissionMode(raw?.defaultPermissionMode ?? raw?.permissionMode ?? SAFE_PERMISSION_FLOOR)
  return {
    defaultPermissionMode: fallback,
    allowUnknownUsers: raw?.allowUnknownUsers === true,
    allowUnknownConversations: raw?.allowUnknownConversations === true,
    actors: (Array.isArray(raw?.actors) ? raw.actors : []).map((row: any) => normalizeActorRule(row, fallback)).filter((item: ExternalActorRule | null): item is ExternalActorRule => !!item),
    conversations: (Array.isArray(raw?.conversations) ? raw.conversations : []).map((row: any) => normalizeConversationRule(row, fallback)).filter((item: ExternalConversationRule | null): item is ExternalConversationRule => !!item),
  }
}

function normalizeRouting(raw: any): AdapterRouting {
  const size = Number(raw?.maxWorkgroupSize ?? DEFAULT_MAX_WORKGROUP_SIZE)
  return {
    maxWorkgroupSize: Number.isFinite(size) ? Math.max(1, Math.min(DEFAULT_MAX_WORKGROUP_SIZE, Math.floor(size))) : DEFAULT_MAX_WORKGROUP_SIZE,
    notifyUndeliverable: raw?.notifyUndeliverable !== false,
  }
}

function normalizeCapabilities(raw: any, platform: IMPlatform): AdapterCapabilities {
  const fallback = platform === 'feishu'
  return {
    text: raw?.text !== false,
    image: raw?.image === true || (raw?.image === undefined && fallback),
    file: raw?.file === true || (raw?.file === undefined && fallback),
    audio: raw?.audio === true,
    video: raw?.video === true,
  }
}

export function normalizePlatform(value: unknown): IMPlatform | null {
  const text = String(value ?? '').trim().toLowerCase()
  return (IM_PLATFORMS as string[]).includes(text) ? (text as IMPlatform) : null
}

export function normalizeAdapterConfig(raw: any): CommunicationAdapterConfig {
  const platform = normalizePlatform(raw?.platform)
  if (!platform) throw new Error(`未知的通讯平台：${String(raw?.platform)}（当前支持 feishu / qq / wechat）`)
  const id = String(raw?.id || platform).trim() || platform
  assertNoRawSecrets(id, raw?.options)
  const options: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(raw?.options || {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') options[key] = value
  }
  return {
    id,
    platform,
    name: String(raw?.name || (platform === 'feishu' ? '飞书' : platform === 'qq' ? 'QQ' : '微信')),
    enabled: raw?.enabled === true,
    connectionMode: raw?.connectionMode ? String(raw.connectionMode) : undefined,
    credentials: assertCredentialRefs(id, raw?.credentials || {}),
    routing: normalizeRouting(raw?.routing),
    capabilities: normalizeCapabilities(raw?.capabilities, platform),
    access: normalizeAccessPolicy(raw?.access),
    options: Object.keys(options).length ? options : undefined,
  }
}

export function normalizeChannelBinding(raw: any): ChannelBinding | null {
  const adapterId = String(raw?.adapterId || '').trim()
  const externalConversationId = String(raw?.externalConversationId || '').trim()
  const companyChannelId = String(raw?.companyChannelId || '').trim()
  if (!adapterId || !externalConversationId || !companyChannelId) return null
  return { adapterId, externalConversationId, companyChannelId }
}

export function normalizeCommunicationConfig(raw: any): CommunicationConfig {
  const adapters = (Array.isArray(raw?.adapters) ? raw.adapters : []).map(normalizeAdapterConfig)
  const bindings = (Array.isArray(raw?.channelBindings) ? raw.channelBindings : []).map(normalizeChannelBinding).filter((item: ChannelBinding | null): item is ChannelBinding => !!item)
  return { adapters, channelBindings: bindings }
}

// ---------------------------------------------------------------------------
// Gateway 访问裁决
// ---------------------------------------------------------------------------

export type AccessDecision =
  | { allowed: true; actorRole: ActorRole; permissionMode: ExternalPermissionMode; actorName?: string; conversationName?: string; allowedEmployees?: string[] }
  | { allowed: false; reason: 'unknown-user' | 'unknown-conversation' | 'adapter-disabled'; detail: string }

// ---------------------------------------------------------------------------
// Work Router 共享名册
// ---------------------------------------------------------------------------

export type RosterEntry = {
  id: string
  name: string
  role: string
  emoji?: string
  department?: string
  brief?: string
  aliases?: string[]
  keywords?: string[]
}

// ---------------------------------------------------------------------------
// Company Event
// ---------------------------------------------------------------------------

export type CommunicationEvent =
  | { type: 'external.message.received'; at: number; platform: MessagePlatform; adapterId: string; conversationId: string; companyChannelId?: string; messageId: string; senderId: string; senderName?: string; text: string; attachments: AttachmentRef[]; actorRole: ActorRole; permissionMode: ExternalPermissionMode }
  | { type: 'external.message.blocked'; at: number; platform: MessagePlatform; adapterId: string; conversationId: string; senderId: string; reason: string }
  | { type: 'external.message.sent'; at: number; platform: MessagePlatform; adapterId: string; conversationId: string; companyChannelId?: string; employeeId?: string; employeeName?: string; text: string; kind: 'employee-reply' | 'notice' | 'system' }
  | { type: 'external.write.denied'; at: number; platform: MessagePlatform; adapterId: string; conversationId: string; employeeId: string; tools: string[]; blocked: boolean }
  | { type: 'external.adapter.status'; at: number; platform: MessagePlatform; adapterId: string; state: AdapterConnectionState; detail?: string }

export type CommunicationEventSink = { emit(event: CommunicationEvent): void }
export type CommunicationLogger = { info?: (message: string) => void; warn?: (message: string) => void; error?: (message: string) => void }

export type TimelineEntry = {
  id: string
  at: number
  direction: 'in' | 'out'
  platform: MessagePlatform
  adapterId: string
  conversationId: string
  conversationName?: string
  companyChannelId?: string
  senderName?: string
  employeeId?: string
  employeeName?: string
  text: string
  attachments: number
  permissionMode: ExternalPermissionMode
}
