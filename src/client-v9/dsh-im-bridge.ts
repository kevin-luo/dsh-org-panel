// 可选的 @xmanrui/dsh-im 生态桥。
//
// 设计原则：
// 1. 不把 dsh-im 设成 npm 依赖，不复制它的协议实现；org-panel 仍兼容 Node 18+。
// 2. 只通过 DSH 已有 connection.rpc 调它公开的插件频道。
// 3. IM 协议/扫码/凭证生命周期由 dsh-im 负责；员工身份、记忆、技能、履历仍由赛博公司负责。
// 4. 浏览器永远只拿 dsh-im 已脱敏的 public status / QR data URL，不读取 bot token。
// 5. 微信 / QQ / 飞书统一走同一个 Provider 契约，后续渠道只补 spec，不再复制整套页面状态机。
import { callRpcChannel, outcomeMessage, rpcChannelWrite, type OrgPanelRpc, type RpcOutcome } from './rpc'

export const DSH_IM_PACKAGE = '@xmanrui/dsh-im'
export const DSH_IM_INSTALL_COMMAND = 'dsh plugin --profile web add @xmanrui/dsh-im'

export type DshImPlatform =
  | 'feishu'
  | 'weixin'
  | 'dingtalk'
  | 'wecom'
  | 'qq'
  | 'slack'
  | 'telegram'
  | 'discord'
  | 'whatsapp'

export type DshImPairing = 'qr' | 'credential' | 'mixed'

export type DshImPlatformSpec = {
  id: DshImPlatform
  label: string
  pairing: DshImPairing
  qr: boolean
  credentials: boolean
  verification: boolean
  credentialLabels?: [string, string]
  description: string
}

export const DSH_IM_PLATFORMS: DshImPlatformSpec[] = [
  { id: 'weixin', label: '微信', pairing: 'qr', qr: true, credentials: false, verification: true, description: '腾讯 iLink 扫码绑定 · 长轮询' },
  { id: 'feishu', label: '飞书', pairing: 'mixed', qr: true, credentials: true, verification: false, credentialLabels: ['App ID', 'App Secret'], description: '官方扫码建机器人 / App 凭证 · 长连接' },
  { id: 'qq', label: 'QQ', pairing: 'mixed', qr: true, credentials: true, verification: false, credentialLabels: ['AppID', 'AppSecret'], description: 'QQBot v2 官方扫码 / App 凭证 · WebSocket' },
  { id: 'dingtalk', label: '钉钉', pairing: 'mixed', qr: true, credentials: true, verification: false, credentialLabels: ['Client ID', 'Client Secret'], description: '扫码 / Client 凭证 · Stream' },
  { id: 'wecom', label: '企业微信', pairing: 'mixed', qr: true, credentials: true, verification: false, credentialLabels: ['Bot ID', 'Secret'], description: '官方机器人 · WebSocket' },
  { id: 'slack', label: 'Slack', pairing: 'credential', qr: false, credentials: true, verification: false, credentialLabels: ['Bot Token', 'App Token'], description: 'Socket Mode' },
  { id: 'telegram', label: 'Telegram', pairing: 'credential', qr: false, credentials: true, verification: false, credentialLabels: ['Bot Token', ''], description: 'Bot API Long Polling' },
  { id: 'discord', label: 'Discord', pairing: 'credential', qr: false, credentials: true, verification: false, credentialLabels: ['Bot Token', ''], description: 'Gateway v10' },
  { id: 'whatsapp', label: 'WhatsApp', pairing: 'qr', qr: true, credentials: false, verification: false, description: '关联设备扫码 · WhatsApp Web' },
]

export const DSH_IM_CHANNEL: Record<DshImPlatform, string> = {
  feishu: '/feishu',
  weixin: '/weixin',
  dingtalk: '/dingtalk',
  wecom: '/wecom',
  qq: '/qq',
  slack: '/slack',
  telegram: '/telegram',
  discord: '/discord',
  whatsapp: '/whatsapp',
}

export function dshImSpec(platform: DshImPlatform): DshImPlatformSpec {
  const spec = DSH_IM_PLATFORMS.find((item) => item.id === platform)
  if (!spec) throw new Error(`未知 DSH IM 平台：${platform}`)
  return spec
}

export type DshImAccount = {
  botId: string
  connected: boolean
  state: string
  name: string
  accountMasked?: string
  workspace?: string
  health?: string
  messagesReceived?: number
  messagesReplied?: number
}

export type DshImProvisionStatus =
  | 'starting'
  | 'pending'
  | 'scanned'
  | 'needs_verification'
  | 'connecting'
  | 'connected'
  | 'expired'
  | 'failed'
  | 'cancelled'

export type DshImProvisioning = {
  attemptId: string
  status: DshImProvisionStatus
  expiresAt: number
  pollIntervalMs: number
  verificationRequired: boolean
  qrCodeDataUrl?: string
  verificationUrl?: string
  botId?: string
  alreadyConnected?: boolean
  error?: { code?: string; message?: string }
}

export type DshImStatus = {
  platform: DshImPlatform
  state: string
  revision?: number
  accounts: DshImAccount[]
  configured: number
  connected: number
  provisioning?: DshImProvisioning | null
}

export type DshImChannelActions = {
  platform: DshImPlatform
  spec: DshImPlatformSpec
  status(signal?: AbortSignal): Promise<DshImStatus>
  begin?: () => Promise<DshImProvisioning>
  poll?: (attemptId: string) => Promise<DshImProvisioning>
  verify?: (attemptId: string, verifyCode: string) => Promise<DshImProvisioning>
  cancel?: (attemptId: string) => Promise<unknown>
  bindCredentials?: (first: string, second: string) => Promise<DshImStatus>
  reconnect(botId: string): Promise<unknown>
  remove(botId: string): Promise<unknown>
  setWorkspace(botId: string, workspace: string): Promise<unknown>
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function timestamp(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallback
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null
}

function safeQr(value: unknown): string | undefined {
  return typeof value === 'string'
    && value.length <= 2 * 1024 * 1024
    && /^data:image\/(?:png|webp|svg\+xml)(?:;charset=[^;,]+)?;base64,/i.test(value)
    ? value : undefined
}

function safeVerificationUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch { return undefined }
}

const PROVISION_STATUS_ALIAS: Record<string, DshImProvisionStatus> = {
  starting: 'starting',
  pending: 'pending',
  refreshing: 'pending',
  provisioning: 'pending',
  qr_ready: 'pending',
  polling: 'pending',
  slow_down: 'pending',
  domain_switched: 'pending',
  scanned: 'scanned',
  needs_verification: 'needs_verification',
  saving: 'connecting',
  connecting: 'connecting',
  reconnecting: 'connecting',
  connected: 'connected',
  succeeded: 'connected',
  expired: 'expired',
  expired_token: 'expired',
  failed: 'failed',
  error: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  access_denied: 'cancelled',
}

/**
 * dsh-im 各渠道 public contract 的 provisioning 形状并不完全一致：
 * - 微信 / QQ 直接给 status；
 * - 飞书 connection.status 的 provisioning 只给二维码，状态在外层 state；
 * - 飞书 provision.poll 又会把 status 放回外层。
 * 这里统一归一成公司 UI 的单一状态机，不猜业务，只做公开状态别名映射。
 */
export function normalizeDshImProvisioning(
  value: unknown,
  platform: DshImPlatform = 'weixin',
  fallbackStatus: DshImProvisionStatus = 'pending',
): DshImProvisioning | null {
  const wrapper = record(value)
  if (!wrapper) return null
  const source = record(wrapper.provisioning) || wrapper
  const attemptId = text(source.attemptId || source.provisioningId || source.attempt)
  if (!attemptId) return null

  const reported = text(wrapper.status || source.status || wrapper.state || source.state)
  const status = PROVISION_STATUS_ALIAS[reported] || fallbackStatus
  const output: DshImProvisioning = {
    attemptId,
    status,
    expiresAt: timestamp(source.expiresAt, Date.now() + 5 * 60_000),
    pollIntervalMs: Math.min(10_000, Math.max(500, number(source.pollIntervalMs, platform === 'feishu' ? 1800 : 1000))),
    verificationRequired: source.verificationRequired === true || status === 'needs_verification',
  }
  const qrCodeDataUrl = safeQr(source.qrCodeDataUrl)
  const verificationUrl = safeVerificationUrl(source.verificationUrl)
  if (qrCodeDataUrl) output.qrCodeDataUrl = qrCodeDataUrl
  if (verificationUrl) output.verificationUrl = verificationUrl
  if (text(wrapper.botId || source.botId)) output.botId = text(wrapper.botId || source.botId)
  if (source.alreadyConnected === true || wrapper.alreadyConnected === true) output.alreadyConnected = true
  const error = record(wrapper.error) || record(source.error)
  if (error) output.error = { code: text(error.code), message: text(error.message) }
  return output
}

function normalizeAccount(value: unknown, platform: DshImPlatform): DshImAccount | null {
  const source = record(value)
  if (!source || !text(source.botId)) return null
  const bot = record(source.bot) || {}
  const health = record(source.health) || {}
  const stats = record(source.stats) || {}
  const defaultName = platform === 'weixin' ? '微信机器人' : platform === 'qq' ? 'QQ机器人' : platform === 'feishu' ? '飞书机器人' : 'IM 机器人'
  return {
    botId: text(source.botId),
    connected: source.connected === true,
    state: text(source.state, source.connected === true ? 'connected' : 'offline'),
    name: text(bot.name, defaultName),
    accountMasked: text(bot.accountIdMasked || bot.appIdMasked) || undefined,
    workspace: text(source.workspace) || undefined,
    health: text(health.summary) || undefined,
    messagesReceived: Number.isFinite(Number(stats.messagesReceived)) ? Math.max(0, Number(stats.messagesReceived)) : undefined,
    messagesReplied: Number.isFinite(Number(stats.messagesReplied)) ? Math.max(0, Number(stats.messagesReplied)) : undefined,
  }
}

export function normalizeDshImStatus(platform: DshImPlatform, value: unknown): DshImStatus {
  const root = record(value)
  const source = record(root?.snapshot) || root
  if (!source) throw new Error(`${platform} 返回了无法识别的状态`)
  const accounts = Array.isArray(source.bots)
    ? source.bots.map((item: unknown) => normalizeAccount(item, platform)).filter((item: DshImAccount | null): item is DshImAccount => !!item)
    : []

  // 部分旧版/单账号频道只下发顶层 bot；保持兼容，但仍只消费 public status。
  if (!accounts.length && source.configured === true && record(source.bot)) {
    const single = normalizeAccount({
      botId: text(source.botId, `${platform}-default`),
      connected: source.connected,
      state: source.state,
      bot: source.bot,
      health: source.health,
      stats: source.stats,
      workspace: source.workspace,
    }, platform)
    if (single) accounts.push(single)
  }
  const totals = record(source.totals)
  const configured = totals ? number(totals.configured, accounts.length) : accounts.length
  const connected = totals ? number(totals.connected, accounts.filter((item) => item.connected).length) : accounts.filter((item) => item.connected).length
  const state = text(source.state, connected > 0 ? 'connected' : 'offline')
  return {
    platform,
    state,
    revision: Number.isFinite(Number(source.revision)) ? Number(source.revision) : undefined,
    accounts,
    configured,
    connected,
    provisioning: source.provisioning
      ? normalizeDshImProvisioning(source.provisioning, platform, PROVISION_STATUS_ALIAS[state] || 'pending')
      : null,
  }
}

/** 探测任一 dsh-im 频道；unavailable 只表示该插件频道不存在，不影响 org-panel 本身。 */
export async function probeDshIm(
  rpc: OrgPanelRpc | null | undefined,
  platform: DshImPlatform,
  signal?: AbortSignal,
): Promise<RpcOutcome<DshImStatus>> {
  const outcome = await callRpcChannel<unknown>(rpc, DSH_IM_CHANNEL[platform], 'connection.status', {}, signal)
  if (outcome.state !== 'ok') return outcome as RpcOutcome<DshImStatus>
  try {
    return { state: 'ok', value: normalizeDshImStatus(platform, outcome.value) }
  } catch (error) {
    return { state: 'error', code: 'malformed-dsh-im', message: error instanceof Error ? error.message : String(error) }
  }
}

async function dshImWrite<T>(rpc: OrgPanelRpc | null | undefined, platform: DshImPlatform, endpoint: string, payload: unknown): Promise<T> {
  return rpcChannelWrite<T>(rpc, DSH_IM_CHANNEL[platform], endpoint, payload)
}

async function provision(
  rpc: OrgPanelRpc | null | undefined,
  platform: DshImPlatform,
  endpoint: string,
  payload: unknown,
  fallbackStatus: DshImProvisionStatus = 'pending',
): Promise<DshImProvisioning> {
  const raw = await dshImWrite<unknown>(rpc, platform, endpoint, payload)
  const value = normalizeDshImProvisioning(raw, platform, fallbackStatus)
  if (!value) throw new Error(`${dshImSpec(platform).label} ${endpoint} 没有返回有效的扫码任务`)
  return value
}

function validateCredential(value: string, label: string, max: number): string {
  const next = String(value || '').trim()
  if (!next) throw new Error(`${label} 不能为空`)
  if (next.length > max) throw new Error(`${label} 长度异常`)
  return next
}

/**
 * 当前先把微信 / QQ / 飞书打成统一 Provider；其它平台仍可以 probe 状态，
 * 等确认其公开 RPC 契约后再把写能力挂进来，绝不猜 endpoint。
 */
export function createDshImChannelActions(
  rpc: OrgPanelRpc | null | undefined,
  platform: DshImPlatform,
): DshImChannelActions {
  const spec = dshImSpec(platform)
  const actions: DshImChannelActions = {
    platform,
    spec,
    async status(signal?: AbortSignal): Promise<DshImStatus> {
      const outcome = await probeDshIm(rpc, platform, signal)
      if (outcome.state === 'ok') return outcome.value
      throw new Error(outcomeMessage(outcome))
    },
    reconnect(botId: string): Promise<unknown> {
      return dshImWrite(rpc, platform, 'bot.reconnect', { botId })
    },
    remove(botId: string): Promise<unknown> {
      return dshImWrite(rpc, platform, 'bot.delete', { botId, confirm: true })
    },
    setWorkspace(botId: string, workspace: string): Promise<unknown> {
      const next = String(workspace || '').trim()
      if (!next || !/^(?:\/|[A-Za-z]:[\\/])/.test(next)) return Promise.reject(new Error('请输入工作区绝对路径'))
      return dshImWrite(rpc, platform, 'bot.workspace.set', { botId, workspace: next })
    },
  }

  if (platform === 'weixin' || platform === 'qq' || platform === 'feishu') {
    actions.begin = () => provision(rpc, platform, 'provision.begin', { locale: 'zh-CN' }, 'pending')
    actions.poll = (attemptId: string) => provision(rpc, platform, 'provision.poll', { attemptId }, 'pending')
    actions.cancel = (attemptId: string) => dshImWrite(rpc, platform, 'provision.cancel', { attemptId })
  }

  if (platform === 'weixin') {
    actions.verify = (attemptId: string, verifyCode: string) => {
      if (!/^\d{4,8}$/.test(verifyCode)) return Promise.reject(new Error('配对码必须是 4～8 位数字'))
      return provision(rpc, platform, 'provision.verify', { attemptId, verifyCode }, 'connecting')
    }
  }

  if (platform === 'qq' || platform === 'feishu') {
    actions.bindCredentials = async (appId: string, appSecret: string): Promise<DshImStatus> => {
      const first = validateCredential(appId, platform === 'qq' ? 'AppID' : 'App ID', 256)
      const second = validateCredential(appSecret, platform === 'qq' ? 'AppSecret' : 'App Secret', 1024)
      const raw = await dshImWrite<unknown>(rpc, platform, 'bot.bind-credentials', { appId: first, appSecret: second })
      return normalizeDshImStatus(platform, raw)
    }
  }

  return actions
}

/** 兼容旧调用方；内部已经走统一 Provider。 */
export function createDshImWeixinActions(rpc: OrgPanelRpc | null | undefined) {
  return createDshImChannelActions(rpc, 'weixin')
}

export type DshImWeixinActions = ReturnType<typeof createDshImWeixinActions>
