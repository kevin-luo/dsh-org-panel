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

export interface IMAdapter {
  readonly id: string
  readonly platform: IMPlatform
  start(): Promise<void>
  stop(): Promise<void>
  send(conversationId: string, message: OutgoingMessage): Promise<void>
  /** Adapter 只吐消息，绝不允许自己调用 staff_chat 或另写一套路由（需求文档二十一）。 */
  onMessage(handler: (message: ExternalMessage) => void): void
  status(): AdapterStatus
}

/** Adapter 运行期依赖，由 Manager 注入；logger 里不允许出现任何密钥。 */
export type AdapterRuntime = {
  logger?: { info?: (message: string) => void; warn?: (message: string) => void; error?: (message: string) => void }
  /** 把 SecretRef 解析成真实值；解析结果只留在 Adapter 实例内存里。 */
  resolveSecret: (ref: SecretRef) => Promise<string | undefined>
  /** 附件落地目录，Adapter 自行按需创建。 */
  attachmentDir: string
}

// ---------------------------------------------------------------------------
// 通讯配置（需求文档二十三 / 二十五 / 三十）
// ---------------------------------------------------------------------------

/** 允许用户规则（需求文档三十）。 */
export type ExternalActorRule = {
  userId: string
  name?: string
  role: ActorRole
  permissionMode: ExternalPermissionMode
}

/** 允许群规则（需求文档三十）。 */
export type ExternalConversationRule = {
  conversationId: string
  name?: string
  permissionMode: ExternalPermissionMode
  /** 该群允许直达的员工；留空表示不限制（仍受全局路由约束）。 */
  allowedEmployees?: string[]
}

export type AccessPolicy = {
  /** 命中规则但没写档位时的兜底，默认 read-only。 */
  defaultPermissionMode: ExternalPermissionMode
  /** 是否接收名单外用户的消息，默认 false。 */
  allowUnknownUsers: boolean
  /** 是否接收名单外群的消息，默认 false。 */
  allowUnknownConversations: boolean
  actors: ExternalActorRule[]
  conversations: ExternalConversationRule[]
}

export type AdapterRouting = {
  defaultTarget: 'secretary' | 'auto' | string
  recognizeMentions: boolean
  allowEmployeeCollaboration: boolean
  maxHops: number
  /** 无法投递（没有员工运行时/命中限制）时，是否回一条事实说明。默认 true。 */
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
  /** feishu: 'long-conn' | 'webhook'；其它平台由各自 Adapter 定义。 */
  connectionMode?: string
  /** 只允许 env:XXX / secret:XXX 引用，永不落明文（需求文档三十一）。 */
  credentials: Record<string, SecretRef>
  routing: AdapterRouting
  capabilities: AdapterCapabilities
  access: AccessPolicy
  /** 平台私有的非密钥选项，如飞书 webhookPort / webhookPath / domain。 */
  options?: Record<string, string | number | boolean>
}

/** 群绑定（需求文档二十五）。 */
export type ChannelBinding = {
  adapterId: string
  externalConversationId: string
  companyChannelId: string
  defaultEmployees?: string[]
}

export type CommunicationConfig = {
  adapters: CommunicationAdapterConfig[]
  channelBindings: ChannelBinding[]
}

// ---------------------------------------------------------------------------
// 对外摘要（需求文档三十一：API 只回掩码，不回完整密钥）
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
  /** 便于 UI 直接显示：飞书 appId 掩码 + appSecret 是否已配置。 */
  appId?: string
  appSecretConfigured?: boolean
  access: { allowUnknownUsers: boolean; allowUnknownConversations: boolean; defaultPermissionMode: ExternalPermissionMode; actorCount: number; conversationCount: number }
}

export type CommunicationSummary = {
  configured: boolean
  adapters: AdapterSummary[]
  channelBindings: ChannelBinding[]
  maxEmployeeHops: number
}

/** 掩码：只保留尾部 4 位，其余固定成 ****，绝不返回完整值。 */
export function maskSecretValue(value: string | undefined, prefixHint = ''): string {
  const text = String(value ?? '')
  if (!text) return ''
  const tail = text.slice(-4)
  const head = prefixHint && text.startsWith(prefixHint) ? prefixHint : text.slice(0, Math.min(4, Math.max(0, text.length - 4)))
  return `${head}****${tail}`
}

/** 掩码 SecretRef 本身（引用名不是密钥，但仍不展开值）。 */
export function describeSecretRef(ref: SecretRef): string {
  return ref.startsWith('env:') ? `环境变量 ${ref.slice(4)}` : `密钥库 ${ref.slice(7)}`
}

// ---------------------------------------------------------------------------
// 配置清洗：明文密钥一律拒绝入库（需求文档三十一 + 五十七）
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

/** options 里出现任何疑似明文密钥字段一律拒绝。 */
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
  // 没写档位的规则统一落到 defaultPermissionMode（默认 read-only），不给任何隐式提权。
  const fallback = normalizePermissionMode(raw?.defaultPermissionMode ?? raw?.permissionMode ?? SAFE_PERMISSION_FLOOR)
  return {
    defaultPermissionMode: fallback,
    allowUnknownUsers: raw?.allowUnknownUsers === true,
    allowUnknownConversations: raw?.allowUnknownConversations === true,
    actors: (Array.isArray(raw?.actors) ? raw.actors : Array.isArray(raw?.allowUsers) ? raw.allowUsers : []).map((row: any) => normalizeActorRule(row, fallback)).filter((item: ExternalActorRule | null): item is ExternalActorRule => !!item),
    conversations: (Array.isArray(raw?.conversations) ? raw.conversations : Array.isArray(raw?.allowConversations) ? raw.allowConversations : []).map((row: any) => normalizeConversationRule(row, fallback)).filter((item: ExternalConversationRule | null): item is ExternalConversationRule => !!item),
  }
}

function normalizeRouting(raw: any): AdapterRouting {
  const hops = Number(raw?.maxHops ?? raw?.maxEmployeeHops ?? DEFAULT_MAX_EMPLOYEE_HOPS)
  return {
    defaultTarget: String(raw?.defaultTarget || SECRETARY_ID) || SECRETARY_ID,
    recognizeMentions: raw?.recognizeMentions !== false,
    allowEmployeeCollaboration: raw?.allowEmployeeCollaboration === true,
    maxHops: Number.isFinite(hops) ? Math.max(0, Math.min(12, Math.floor(hops))) : DEFAULT_MAX_EMPLOYEE_HOPS,
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

/** 把用户写在 cordis.yml 里的松散配置清洗成严格结构；任何明文密钥直接 throw。 */
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
    access: normalizeAccessPolicy(raw?.access ?? raw?.security),
    options: Object.keys(options).length ? options : undefined,
  }
}

export function normalizeChannelBinding(raw: any): ChannelBinding | null {
  const adapterId = String(raw?.adapterId || '').trim()
  const externalConversationId = String(raw?.externalConversationId || raw?.chatId || '').trim()
  const companyChannelId = String(raw?.companyChannelId || raw?.channelId || '').trim()
  if (!adapterId || !externalConversationId || !companyChannelId) return null
  const defaults = Array.isArray(raw?.defaultEmployees) ? raw.defaultEmployees.map(String).filter(Boolean) : undefined
  return { adapterId, externalConversationId, companyChannelId, defaultEmployees: defaults?.length ? defaults : undefined }
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
// Router 契约
// ---------------------------------------------------------------------------

/** 员工名册项：Web 与 IM 共用同一份 id（需求文档二十九）。 */
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

export type RouteTargetKind = 'employee' | 'secretary'

export type RouteDecision = {
  kind: RouteTargetKind
  employeeId: string
  employeeName: string
  /** mention=文本或平台 @；binding=群默认负责人；default=渠道 defaultTarget；auto=关键词匹配；fallback=兜底给秘书。 */
  reason: 'mention' | 'binding' | 'default' | 'auto' | 'fallback'
  companyChannelId?: string
  /** 命中的其它 @ 对象（第一版只直达第一位，其余记录下来供前端展示）。 */
  alsoMentioned: string[]
}

export type EmployeeDispatchRequest = {
  employeeId: string
  employeeName: string
  text: string
  attachments: AttachmentRef[]
  platform: MessagePlatform
  adapterId: string
  conversationId: string
  companyChannelId?: string
  senderId: string
  senderName?: string
  actorRole: ActorRole
  permissionMode: ExternalPermissionMode
  /** Read Only 渠道下恒为 false，员工运行时必须据此禁用写工具。 */
  writeAllowed: boolean
  /** writeAllowed 的执行体：真正拦写的闸门对象，运行时必须用它过滤/校验工具。 */
  writeGate: WriteGate
  /** 已经过的员工转发次数（需求文档三十六）。 */
  hop: number
  maxHops: number
  messageId: string
  threadId?: string
  /** 便于持久化层写 TaskHistory.source。 */
  taskSource: TaskSource
}

export type EmployeeDispatchResult = {
  ok: boolean
  text: string
  /** 员工希望把任务转交给另一位同事；Router 负责校验 hop 上限与协作开关。 */
  handoffTo?: string
  error?: string
  /** 这次派活真正执行过的工具名。只读渠道里出现写工具 = 越权，Router 会拦掉回复并如实上报。 */
  usedTools?: string[]
}

/** 真正跑员工 Runtime 的实现由 host 注入；未注入时 Router 绝不编造回复。 */
export type EmployeeDispatcher = (request: EmployeeDispatchRequest) => Promise<EmployeeDispatchResult>

// ---------------------------------------------------------------------------
// Company Event（需求文档三十二 / 三十三）
// ---------------------------------------------------------------------------

export type CommunicationEvent =
  | { type: 'external.message.received'; at: number; platform: MessagePlatform; adapterId: string; conversationId: string; companyChannelId?: string; messageId: string; senderId: string; senderName?: string; text: string; attachments: AttachmentRef[]; actorRole: ActorRole; permissionMode: ExternalPermissionMode; targetEmployeeId?: string }
  | { type: 'external.message.blocked'; at: number; platform: MessagePlatform; adapterId: string; conversationId: string; senderId: string; reason: string }
  | { type: 'external.message.sent'; at: number; platform: MessagePlatform; adapterId: string; conversationId: string; companyChannelId?: string; employeeId?: string; employeeName?: string; text: string; kind: 'employee-reply' | 'notice' | 'system' }
  | { type: 'external.handoff.limited'; at: number; platform: MessagePlatform; adapterId: string; conversationId: string; fromEmployeeId: string; toEmployeeId: string; hop: number; maxHops: number }
  /** 只读渠道里的写操作。blocked=true：闸门当场拦下，写没有发生；false：运行时越权执行了，回复已被拦掉。 */
  | { type: 'external.write.denied'; at: number; platform: MessagePlatform; adapterId: string; conversationId: string; employeeId: string; tools: string[]; blocked: boolean }
  | { type: 'external.adapter.status'; at: number; platform: MessagePlatform; adapterId: string; state: AdapterConnectionState; detail?: string }

export type CommunicationEventSink = { emit(event: CommunicationEvent): void }

export type CommunicationLogger = { info?: (message: string) => void; warn?: (message: string) => void; error?: (message: string) => void }

/** 网页群聊镜像用的时间线条目：Web 与 IM 看到的是同一条消息（需求文档五十六）。 */
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
