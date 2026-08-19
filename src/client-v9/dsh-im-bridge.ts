// 可选的 @xmanrui/dsh-im 生态桥。
//
// 设计原则：
// 1. 不把 dsh-im 设成 npm 依赖，不复制它的协议实现；org-panel 仍兼容 Node 18+。
// 2. 只通过 DSH 已有 connection.rpc 调它公开的插件频道。
// 3. IM 协议/扫码/凭证生命周期由 dsh-im 负责；员工身份、记忆、技能、履历仍由赛博公司负责。
// 4. 浏览器永远只拿 dsh-im 已脱敏的 public status / QR data URL，不读取 bot token。
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

export const DSH_IM_PLATFORMS: Array<{ id: DshImPlatform; label: string; pairing: 'qr' | 'credential' | 'mixed' }> = [
  { id: 'weixin', label: '微信', pairing: 'qr' },
  { id: 'feishu', label: '飞书', pairing: 'mixed' },
  { id: 'qq', label: 'QQ', pairing: 'mixed' },
  { id: 'dingtalk', label: '钉钉', pairing: 'mixed' },
  { id: 'wecom', label: '企业微信', pairing: 'mixed' },
  { id: 'slack', label: 'Slack', pairing: 'credential' },
  { id: 'telegram', label: 'Telegram', pairing: 'credential' },
  { id: 'discord', label: 'Discord', pairing: 'credential' },
  { id: 'whatsapp', label: 'WhatsApp', pairing: 'qr' },
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

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null
}

function safeQr(value: unknown): string | undefined {
  return typeof value === 'string' && /^data:image\/(?:png|webp|svg\+xml)(?:;charset=[^;,]+)?;base64,/i.test(value)
    ? value : undefined
}

function safeVerificationUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch { return undefined }
}

export function normalizeDshImProvisioning(value: unknown): DshImProvisioning | null {
  const source = record(value)
  if (!source || !text(source.attemptId)) return null
  const allowed = new Set<DshImProvisionStatus>([
    'starting', 'pending', 'scanned', 'needs_verification', 'connecting', 'connected', 'expired', 'failed', 'cancelled',
  ])
  const rawStatus = text(source.status, 'failed') as DshImProvisionStatus
  const status = allowed.has(rawStatus) ? rawStatus : 'failed'
  const output: DshImProvisioning = {
    attemptId: text(source.attemptId),
    status,
    expiresAt: number(source.expiresAt, Date.now()),
    pollIntervalMs: Math.min(5000, Math.max(500, number(source.pollIntervalMs, 1000))),
    verificationRequired: source.verificationRequired === true || status === 'needs_verification',
  }
  const qrCodeDataUrl = safeQr(source.qrCodeDataUrl)
  const verificationUrl = safeVerificationUrl(source.verificationUrl)
  if (qrCodeDataUrl) output.qrCodeDataUrl = qrCodeDataUrl
  if (verificationUrl) output.verificationUrl = verificationUrl
  if (text(source.botId)) output.botId = text(source.botId)
  if (source.alreadyConnected === true) output.alreadyConnected = true
  if (record(source.error)) output.error = { code: text(source.error.code), message: text(source.error.message) }
  return output
}

function normalizeAccount(value: unknown): DshImAccount | null {
  const source = record(value)
  if (!source || !text(source.botId)) return null
  const bot = record(source.bot) || {}
  const health = record(source.health) || {}
  const stats = record(source.stats) || {}
  return {
    botId: text(source.botId),
    connected: source.connected === true,
    state: text(source.state, source.connected === true ? 'connected' : 'offline'),
    name: text(bot.name, 'IM 机器人'),
    accountMasked: text(bot.accountIdMasked || bot.appIdMasked) || undefined,
    workspace: text(source.workspace) || undefined,
    health: text(health.summary) || undefined,
    messagesReceived: Number.isFinite(Number(stats.messagesReceived)) ? Math.max(0, Number(stats.messagesReceived)) : undefined,
    messagesReplied: Number.isFinite(Number(stats.messagesReplied)) ? Math.max(0, Number(stats.messagesReplied)) : undefined,
  }
}

export function normalizeDshImStatus(platform: DshImPlatform, value: unknown): DshImStatus {
  const source = record(value)
  if (!source) throw new Error(`${platform} 返回了无法识别的状态`)
  const accounts = Array.isArray(source.bots) ? source.bots.map(normalizeAccount).filter((item): item is DshImAccount => !!item) : []
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
    })
    if (single) accounts.push(single)
  }
  const totals = record(source.totals)
  const configured = totals ? number(totals.configured, accounts.length) : accounts.length
  const connected = totals ? number(totals.connected, accounts.filter((item) => item.connected).length) : accounts.filter((item) => item.connected).length
  return {
    platform,
    state: text(source.state, connected > 0 ? 'connected' : 'offline'),
    revision: Number.isFinite(Number(source.revision)) ? Number(source.revision) : undefined,
    accounts,
    configured,
    connected,
    provisioning: source.provisioning ? normalizeDshImProvisioning(source.provisioning) : null,
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

async function provision(rpc: OrgPanelRpc | null | undefined, endpoint: string, payload: unknown): Promise<DshImProvisioning> {
  const raw = await dshImWrite<unknown>(rpc, 'weixin', endpoint, payload)
  const value = normalizeDshImProvisioning(raw)
  if (!value) throw new Error(`微信 ${endpoint} 没有返回有效的扫码任务`)
  return value
}

/** 微信 iLink 扫码生命周期。端点与 dsh-im 0.10.x 的公开 RPC 契约对齐。 */
export function createDshImWeixinActions(rpc: OrgPanelRpc | null | undefined) {
  return {
    async status(signal?: AbortSignal): Promise<DshImStatus> {
      const outcome = await probeDshIm(rpc, 'weixin', signal)
      if (outcome.state === 'ok') return outcome.value
      throw new Error(outcomeMessage(outcome))
    },
    begin(): Promise<DshImProvisioning> {
      return provision(rpc, 'provision.begin', { locale: 'zh-CN' })
    },
    poll(attemptId: string): Promise<DshImProvisioning> {
      return provision(rpc, 'provision.poll', { attemptId })
    },
    verify(attemptId: string, verifyCode: string): Promise<DshImProvisioning> {
      if (!/^\d{4,8}$/.test(verifyCode)) return Promise.reject(new Error('配对码必须是 4～8 位数字'))
      return provision(rpc, 'provision.verify', { attemptId, verifyCode })
    },
    cancel(attemptId: string): Promise<unknown> {
      return dshImWrite(rpc, 'weixin', 'provision.cancel', { attemptId })
    },
    reconnect(botId: string): Promise<unknown> {
      return dshImWrite(rpc, 'weixin', 'bot.reconnect', { botId })
    },
    remove(botId: string): Promise<unknown> {
      return dshImWrite(rpc, 'weixin', 'bot.delete', { botId, confirm: true })
    },
  }
}

export type DshImWeixinActions = ReturnType<typeof createDshImWeixinActions>
