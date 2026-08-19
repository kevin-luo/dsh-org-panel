// 飞书 Adapter 第一版（需求文档二十八）：接收消息（长连接 / 事件订阅）、发送消息、
// @员工识别、附件下载归一化为 AttachmentRef。
// 铁律：
// 1. 本文件只负责「飞书协议 ↔ ExternalMessage」，绝不调用 staff_chat，也绝不自己决定找哪位员工；
// 2. appId / appSecret 只以 SecretRef 形式配置，解析出的明文只留在实例内存，永不落盘、永不进日志；
// 3. 未配置或依赖缺失时安静降级为未连接，不抛错、不刷屏。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type AdapterRuntime, type AdapterStatus, type AttachmentKind, type AttachmentRef,
  type CommunicationAdapterConfig, type ExternalMessage, type IMAdapter, type OutgoingMessage,
} from '../types'

const DEFAULT_DOMAIN = 'https://open.feishu.cn'
const TOKEN_SAFETY_MS = 60_000
const REQUEST_TIMEOUT = 10_000
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
// 自建事件订阅端口默认只绑回环：要对外暴露必须显式写 options.webhookHost。
const DEFAULT_WEBHOOK_HOST = '127.0.0.1'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
// 官方长连接协议是私有帧格式，第一版复用官方 SDK；没装 SDK 时降级到 webhook 事件订阅。
const LARK_SDK = '@larksuiteoapi/node-sdk'
const NODE_HTTP = 'node:http'
const NODE_CRYPTO = 'node:crypto'

type FeishuCredentials = { appId: string; appSecret: string; verificationToken?: string; encryptKey?: string }
/** 事件验真所需的密钥，与调 API 用的 appId/appSecret 解耦。 */
type FeishuEventSecrets = { verificationToken?: string; encryptKey?: string }

type EventResult = { challenge?: string; ok: boolean }

function pickString(options: Record<string, string | number | boolean> | undefined, key: string, fallback = ''): string {
  const value = options?.[key]
  return value === undefined || value === null ? fallback : String(value)
}

function pickNumber(options: Record<string, string | number | boolean> | undefined, key: string): number | undefined {
  const value = Number(options?.[key])
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/** 定长比较：verification token 校验不给出可测的时间差。 */
function secretEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return diff === 0
}

function safeName(value: string, fallback: string): string {
  const text = String(value || '').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim()
  return text || fallback
}

function mimeOf(name: string, kind: AttachmentKind): string {
  const ext = (name.split('.').pop() || '').toLowerCase()
  const table: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip', mp3: 'audio/mpeg', opus: 'audio/opus', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4', mov: 'video/quicktime',
  }
  if (table[ext]) return table[ext]
  return kind === 'image' ? 'image/png' : kind === 'audio' ? 'audio/opus' : kind === 'video' ? 'video/mp4' : 'application/octet-stream'
}

/** 二进制转 base64：只用 DOM/Node 都有的 btoa，避免引入 Buffer 类型依赖。 */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  return btoa(binary)
}

/** 富文本 post 内容抽取纯文本，同时收集 @ 到的人。 */
function flattenPost(content: any, mentions: string[]): string {
  const lines: string[] = []
  const blocks = Array.isArray(content?.content) ? content.content : []
  for (const line of blocks) {
    const parts: string[] = []
    for (const node of Array.isArray(line) ? line : []) {
      if (!node || typeof node !== 'object') continue
      if (node.tag === 'text' || node.tag === 'md') parts.push(String(node.text || ''))
      else if (node.tag === 'a') parts.push(`${String(node.text || '')}(${String(node.href || '')})`)
      else if (node.tag === 'at') { const name = String(node.user_name || node.user_id || ''); if (name) { parts.push(`@${name}`); mentions.push(name) } }
    }
    if (parts.length) lines.push(parts.join(''))
  }
  const title = String(content?.title || '')
  return [title, ...lines].filter(Boolean).join('\n')
}

export class FeishuAdapter implements IMAdapter {
  readonly id: string
  readonly platform = 'feishu' as const

  private readonly domain: string
  private readonly connectionMode: string
  private handler: ((message: ExternalMessage) => void) | null = null
  private credentials: FeishuCredentials | null = null
  private eventSecrets: FeishuEventSecrets | null = null
  private token: { value: string; expiresAt: number } | null = null
  private state: AdapterStatus['state'] = 'idle'
  private detail: string | undefined
  private receivedCount = 0
  private sentCount = 0
  private lastEventAt: number | undefined
  private lastSentAt: number | undefined
  private wsClient: any = null
  private httpServer: any = null
  private warnedUnverified = false

  constructor(private readonly config: CommunicationAdapterConfig, private readonly runtime: AdapterRuntime) {
    this.id = config.id
    this.domain = pickString(config.options, 'domain', DEFAULT_DOMAIN).replace(/\/+$/, '') || DEFAULT_DOMAIN
    this.connectionMode = (config.connectionMode || 'long-conn').toLowerCase()
  }

  onMessage(handler: (message: ExternalMessage) => void): void {
    this.handler = handler
  }

  status(): AdapterStatus {
    return { id: this.id, platform: this.platform, state: this.state, detail: this.detail, lastEventAt: this.lastEventAt, lastSentAt: this.lastSentAt, receivedCount: this.receivedCount, sentCount: this.sentCount }
  }

  async start(): Promise<void> {
    if (!this.config.enabled) { this.setState('idle', '渠道未启用'); return }
    const credentials = await this.ensureCredentials()
    if (!credentials) { this.setState('degraded', '缺少 appId / appSecret 凭据引用，未连接'); return }
    this.setState('connecting', undefined)
    if (this.connectionMode === 'webhook') { await this.startWebhook(); return }
    const started = await this.startLongConnection(credentials)
    if (!started) await this.startWebhook()
  }

  async stop(): Promise<void> {
    try { await this.wsClient?.stop?.() } catch {}
    this.wsClient = null
    try { this.httpServer?.close?.() } catch {}
    this.httpServer = null
    this.token = null
    this.setState('stopped', undefined)
  }

  // -------------------------------------------------------------------------
  // 凭据与 token：解析结果只留在内存，绝不写日志、绝不落盘
  // -------------------------------------------------------------------------

  /**
   * 事件验真密钥。**必须独立于 appId/appSecret 解析**：
   * 收事件只需要 verificationToken / encryptKey，而调飞书 API 才需要 appId/appSecret。
   * 早先把两者绑在一起解析，导致 appSecret 没注入时 verificationToken 根本不会被读出来，
   * 整条 token 校验静默消失 —— 伪造者因此可以冒充老板拿到 Full Access。
   */
  private async ensureEventSecrets(): Promise<FeishuEventSecrets> {
    if (this.eventSecrets) return this.eventSecrets
    const refs = this.config.credentials
    this.eventSecrets = {
      verificationToken: refs.verificationToken ? await this.runtime.resolveSecret(refs.verificationToken) : undefined,
      encryptKey: refs.encryptKey ? await this.runtime.resolveSecret(refs.encryptKey) : undefined,
    }
    return this.eventSecrets
  }

  private async ensureCredentials(): Promise<FeishuCredentials | null> {
    if (this.credentials) return this.credentials
    const refs = this.config.credentials
    const appId = refs.appId ? await this.runtime.resolveSecret(refs.appId) : undefined
    const appSecret = refs.appSecret ? await this.runtime.resolveSecret(refs.appSecret) : undefined
    if (!appId || !appSecret) return null
    const secrets = await this.ensureEventSecrets()
    this.credentials = { appId, appSecret, verificationToken: secrets.verificationToken, encryptKey: secrets.encryptKey }
    return this.credentials
  }

  private async tenantToken(): Promise<string | null> {
    const credentials = await this.ensureCredentials()
    if (!credentials) return null
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value
    const data = await this.request('/open-apis/auth/v3/tenant_access_token/internal', { app_id: credentials.appId, app_secret: credentials.appSecret }, null)
    const value = String(data?.tenant_access_token || '')
    if (!value) throw new Error(`飞书 tenant_access_token 获取失败：code=${String(data?.code ?? 'unknown')}`)
    this.token = { value, expiresAt: Date.now() + Math.max(0, Number(data?.expire || 7200) * 1000 - TOKEN_SAFETY_MS) }
    return value
  }

  /** 统一请求：错误里只带 code/msg，绝不回显请求体（含密钥）。 */
  private async request(path: string, body: unknown, token: string | null): Promise<any> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    try {
      const response = await fetch(`${this.domain}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(`飞书接口 ${path} HTTP ${response.status}`)
      if (data && typeof data.code === 'number' && data.code !== 0) throw new Error(`飞书接口 ${path} 返回 code=${data.code} ${String(data.msg || '')}`)
      return data?.data ?? data
    } finally {
      clearTimeout(timer)
    }
  }

  // -------------------------------------------------------------------------
  // 发送
  // -------------------------------------------------------------------------

  async send(conversationId: string, message: OutgoingMessage): Promise<void> {
    const token = await this.tenantToken()
    if (!token) throw new Error('飞书凭据未配置，无法发送')
    const text = this.renderOutgoing(message)
    const content = JSON.stringify({ text })
    if (message.replyToMessageId) {
      await this.request(`/open-apis/im/v1/messages/${encodeURIComponent(message.replyToMessageId)}/reply`, { content, msg_type: 'text' }, token)
    } else {
      await this.request(`/open-apis/im/v1/messages?receive_id_type=chat_id`, { receive_id: conversationId, msg_type: 'text', content }, token)
    }
    this.sentCount += 1
    this.lastSentAt = Date.now()
    if (this.state !== 'connected') this.setState('connected', this.detail)
  }

  /** 员工回复带上「谁在说话」，但身份仍然是同一个 employeeId，不是「飞书分身」。 */
  private renderOutgoing(message: OutgoingMessage): string {
    const head = message.kind === 'employee-reply' && message.employeeName ? `【${message.employeeName}${message.employeeRole ? ` · ${message.employeeRole}` : ''}】\n` : ''
    const attachments = (message.attachments || []).filter((item) => item.url || item.localPath)
    const tail = attachments.length ? `\n\n附件：\n${attachments.map((item) => `· ${item.name || item.type}：${item.url || item.localPath}`).join('\n')}` : ''
    return `${head}${message.text}${tail}`.trim()
  }

  // -------------------------------------------------------------------------
  // 接收：长连接（官方 SDK）/ 事件订阅（自带 webhook）
  // -------------------------------------------------------------------------

  private async startLongConnection(credentials: FeishuCredentials): Promise<boolean> {
    let sdk: any
    try {
      sdk = await import(LARK_SDK)
    } catch {
      this.runtime.logger?.info?.(`dsh-org-panel: 未安装 ${LARK_SDK}，飞书长连接不可用，改用事件订阅（webhook）模式`)
      return false
    }
    try {
      const WSClient = sdk?.WSClient || sdk?.default?.WSClient
      const EventDispatcher = sdk?.EventDispatcher || sdk?.default?.EventDispatcher
      if (!WSClient || !EventDispatcher) throw new Error('SDK 缺少 WSClient / EventDispatcher')
      this.wsClient = new WSClient({ appId: credentials.appId, appSecret: credentials.appSecret, domain: this.domain })
      const dispatcher = new EventDispatcher({}).register({
        'im.message.receive_v1': async (data: any) => { await this.ingestMessageEvent(data, String(data?.event_id || data?.message?.message_id || '')) },
      })
      await this.wsClient.start({ eventDispatcher: dispatcher })
      this.setState('connected', '长连接已建立')
      return true
    } catch (error) {
      this.wsClient = null
      this.runtime.logger?.warn?.(`dsh-org-panel: 飞书长连接启动失败（${error instanceof Error ? error.message : String(error)}），尝试事件订阅模式`)
      return false
    }
  }

  private async startWebhook(): Promise<void> {
    const port = pickNumber(this.config.options, 'webhookPort')
    const path = pickString(this.config.options, 'webhookPath', '/feishu/event')
    if (!port) {
      // 没给端口就等宿主自己把 handleEvent 挂到已有 HTTP 服务上，属于正常降级，不刷屏。
      this.setState('degraded', '事件订阅未监听端口，请配置 options.webhookPort 或把 handleEvent 挂到宿主 HTTP 服务')
      return
    }
    // 没有 verificationToken 也没有 encryptKey 时，任何人都能伪造事件冒充老板 →
    // 宁可不开端口，也不开一个无法鉴权的入口。确需如此必须显式声明。
    if (!(await this.canVerifyEvents()) && this.config.options?.allowUnverifiedEvents !== true) {
      this.setState('degraded', '事件订阅缺少 verificationToken / encryptKey，无法鉴权，已拒绝开放端口（确需裸奔请显式设置 options.allowUnverifiedEvents: true）')
      return
    }
    let http: any
    try {
      http = await import(NODE_HTTP)
    } catch {
      this.setState('degraded', '当前运行时没有 node:http，无法自建事件订阅端口')
      return
    }
    const server = http.createServer((req: any, res: any) => {
      if (String(req.url || '').split('?')[0] !== path || String(req.method || '').toUpperCase() !== 'POST') {
        res.writeHead(404); res.end(); return
      }
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (chunk: string) => { body += chunk; if (body.length > 2_000_000) req.destroy() })
      req.on('end', () => {
        void this.handleEvent(body).then((result) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(result.challenge ? { challenge: result.challenge } : { code: 0 }))
        }).catch((error) => {
          this.runtime.logger?.warn?.(`dsh-org-panel: 飞书事件处理失败：${error instanceof Error ? error.message : String(error)}`)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ code: 0 }))
        })
      })
    })
    // 默认只绑 127.0.0.1：不写 options.webhookHost 就不会把事件入口暴露到公网/内网。
    const host = pickString(this.config.options, 'webhookHost', DEFAULT_WEBHOOK_HOST) || DEFAULT_WEBHOOK_HOST
    if (!LOOPBACK_HOSTS.has(host)) {
      this.runtime.logger?.warn?.(`dsh-org-panel: 飞书事件订阅按配置绑定到 ${host}，该端口对外可达，请确认前面有反向代理与鉴权`)
    }
    await new Promise<void>((resolve) => server.listen(port, host, () => resolve()))
    this.httpServer = server
    this.setState('connected', `事件订阅已监听 ${host}:${port}${path}`)
  }

  /** 是否具备验证事件真伪的手段（verification token 或 encryptKey，二者有其一即可）。 */
  private async canVerifyEvents(): Promise<boolean> {
    const secrets = await this.ensureEventSecrets()
    return !!(secrets.verificationToken || secrets.encryptKey)
  }

  /**
   * 事件入口。宿主已有 HTTP 服务时可直接调用：
   * `await adapter.handleEvent(rawBody)`，返回 { challenge } 时原样回给飞书完成 URL 校验。
   */
  async handleEvent(raw: string | Record<string, unknown>): Promise<EventResult> {
    const payload = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw
    const decrypted = await this.decryptIfNeeded(payload)
    if (!decrypted) return { ok: false }
    // 事件密钥独立解析：appId/appSecret 缺失也不能让 token 校验消失。
    const secrets = await this.ensureEventSecrets()
    const token = String((decrypted as any)?.token || (decrypted as any)?.header?.token || '')
    const expected = secrets.verificationToken
    if (expected) {
      // 配了 token 就必须带且必须对：不带 token 的事件同样是伪造，不能因为字段缺席就放行。
      if (!token) {
        this.runtime.logger?.warn?.('dsh-org-panel: 飞书事件缺少 verification token，已丢弃')
        return { ok: false }
      }
      if (!secretEquals(token, expected)) {
        this.runtime.logger?.warn?.('dsh-org-panel: 飞书事件 verification token 不匹配，已丢弃')
        return { ok: false }
      }
    } else if (!secrets.encryptKey) {
      // 两种校验手段都没有 = 谁都能伪造成老板。自建端口那条路（startWebhookServer）已经拒绝开放端口，
      // 宿主直接挂 handleEvent 这条路以前只 warn 一次就放行，是同一个洞的另一半 —— 这里同样 fail-closed。
      if (this.config.options?.allowUnverifiedEvents !== true) {
        if (!this.warnedUnverified) {
          this.warnedUnverified = true
          this.runtime.logger?.warn?.('dsh-org-panel: 飞书渠道既未配置 verificationToken 也未配置 encryptKey，无法验证事件真伪，已拒绝处理（确需裸奔请显式设置 options.allowUnverifiedEvents: true）')
        }
        return { ok: false }
      }
      if (!this.warnedUnverified) {
        this.warnedUnverified = true
        this.runtime.logger?.warn?.('dsh-org-panel: 飞书渠道已显式允许未验真事件（allowUnverifiedEvents），任何人都能伪造发件人身份，请确认前置反代已做鉴权')
      }
    }
    if ((decrypted as any)?.type === 'url_verification' || (decrypted as any)?.challenge) {
      return { ok: true, challenge: String((decrypted as any).challenge || '') }
    }
    const header = (decrypted as any)?.header || {}
    const eventType = String(header.event_type || (decrypted as any)?.event?.type || '')
    if (eventType !== 'im.message.receive_v1') return { ok: true }
    await this.ingestMessageEvent((decrypted as any)?.event, String(header.event_id || ''))
    return { ok: true }
  }

  /** 仅在配置了 encryptKey 时才需要解密；node:crypto 不可用时如实降级。 */
  private async decryptIfNeeded(payload: any): Promise<any> {
    const encrypted = payload?.encrypt
    const credentials = await this.ensureEventSecrets()
    const hasCipher = typeof encrypted === 'string' && !!encrypted
    if (credentials?.encryptKey && !hasCipher) {
      // 配了 encryptKey 就说明订阅端开了加密：明文事件只可能来自伪造者，一律丢弃。
      this.runtime.logger?.warn?.('dsh-org-panel: 飞书渠道已配置 encryptKey，但收到的是明文事件，已丢弃')
      return null
    }
    if (!hasCipher) return payload
    if (!credentials?.encryptKey) {
      this.runtime.logger?.warn?.('dsh-org-panel: 收到加密的飞书事件，但未配置 encryptKey，已丢弃')
      return null
    }
    let crypto: any
    try {
      crypto = await import(NODE_CRYPTO)
    } catch {
      this.runtime.logger?.warn?.('dsh-org-panel: 当前运行时没有 node:crypto，无法解密飞书事件')
      return null
    }
    const key = crypto.createHash('sha256').update(credentials.encryptKey).digest()
    const buffer = crypto.Buffer ? crypto.Buffer.from(encrypted, 'base64') : (globalThis as any).Buffer.from(encrypted, 'base64')
    const iv = buffer.subarray(0, 16)
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    decipher.setAutoPadding(true)
    const plain = `${decipher.update(buffer.subarray(16), undefined, 'utf8')}${decipher.final('utf8')}`
    return JSON.parse(plain)
  }

  /** 飞书事件 → ExternalMessage。permissionMode 一律给最低档，最终裁决在 Gateway。 */
  private async ingestMessageEvent(event: any, eventId: string): Promise<void> {
    const message = event?.message
    const sender = event?.sender
    if (!message || !this.handler) return
    if (String(sender?.sender_type || 'user') !== 'user') return
    const senderId = String(sender?.sender_id?.open_id || sender?.sender_id?.union_id || sender?.sender_id?.user_id || '')
    if (!senderId) return
    const messageId = String(message.message_id || eventId || `feishu-${Date.now()}`)
    const chatId = String(message.chat_id || '')
    const mentions: string[] = []
    let content: any = {}
    try { content = JSON.parse(String(message.content || '{}')) } catch {}
    const messageType = String(message.message_type || 'text')
    let text = messageType === 'post' ? flattenPost(content, mentions) : String(content?.text || '')
    for (const item of Array.isArray(message.mentions) ? message.mentions : []) {
      const name = String(item?.name || '')
      const key = String(item?.key || '')
      if (name) mentions.push(name)
      if (key && name) text = text.split(key).join(`@${name}`)
    }
    const attachments = await this.collectAttachments(messageId, messageType, content)
    const normalized: ExternalMessage = {
      id: messageId,
      platform: 'feishu',
      adapterId: this.id,
      conversationId: chatId,
      conversationType: String(message.chat_type || 'group') === 'p2p' ? 'direct' : 'group',
      senderId,
      senderName: undefined,
      text: text.trim(),
      mentions: Array.from(new Set(mentions.filter(Boolean))),
      attachments,
      actorRole: 'guest',
      permissionMode: 'read-only',
      createdAt: Number(message.create_time) || Date.now(),
      threadId: message.root_id ? String(message.root_id) : message.parent_id ? String(message.parent_id) : undefined,
    }
    this.receivedCount += 1
    this.lastEventAt = Date.now()
    if (this.state !== 'connected') this.setState('connected', this.detail)
    this.handler(normalized)
  }

  // -------------------------------------------------------------------------
  // 附件：下载并归一化为 AttachmentRef（需求文档二十七）
  // -------------------------------------------------------------------------

  private async collectAttachments(messageId: string, messageType: string, content: any): Promise<AttachmentRef[]> {
    const capabilities = this.config.capabilities
    const jobs: Array<{ key: string; kind: AttachmentKind; name: string }> = []
    if (messageType === 'image' && content?.image_key) jobs.push({ key: String(content.image_key), kind: 'image', name: `${String(content.image_key)}.png` })
    if (messageType === 'file' && content?.file_key) jobs.push({ key: String(content.file_key), kind: 'file', name: safeName(String(content.file_name || content.file_key), String(content.file_key)) })
    if (messageType === 'audio' && content?.file_key) jobs.push({ key: String(content.file_key), kind: 'audio', name: `${String(content.file_key)}.opus` })
    if (messageType === 'media' && content?.file_key) jobs.push({ key: String(content.file_key), kind: 'video', name: safeName(String(content.file_name || `${content.file_key}.mp4`), String(content.file_key)) })
    if (messageType === 'post') {
      for (const line of Array.isArray(content?.content) ? content.content : []) {
        for (const node of Array.isArray(line) ? line : []) {
          if (node?.tag === 'img' && node.image_key) jobs.push({ key: String(node.image_key), kind: 'image', name: `${String(node.image_key)}.png` })
        }
      }
    }
    const refs: AttachmentRef[] = []
    for (const job of jobs) {
      if (job.kind === 'image' && !capabilities.image) continue
      if (job.kind === 'file' && !capabilities.file) continue
      if (job.kind === 'audio' && !capabilities.audio) continue
      if (job.kind === 'video' && !capabilities.video) continue
      const ref = await this.downloadResource(messageId, job.key, job.kind, job.name)
      if (ref) refs.push(ref)
    }
    return refs
  }

  private async downloadResource(messageId: string, fileKey: string, kind: AttachmentKind, name: string): Promise<AttachmentRef | null> {
    const token = await this.tenantToken().catch(() => null)
    if (!token) return null
    const type = kind === 'image' ? 'image' : 'file'
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT * 3)
    try {
      const response = await fetch(`${this.domain}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=${type}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`附件超过 ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB 上限`)
      const dir = join(this.runtime.attachmentDir, 'feishu')
      await mkdir(dir, { recursive: true })
      const fileName = safeName(`${messageId}-${name}`, `${messageId}-${fileKey}`)
      const localPath = join(dir, fileName)
      await writeFile(localPath, toBase64(new Uint8Array(buffer)), 'base64')
      return { id: fileKey, type: kind, mime: mimeOf(fileName, kind), name, localPath, size: buffer.byteLength, source: 'feishu' }
    } catch (error) {
      // 下载失败如实记录，不给员工一个「假装存在」的附件。
      this.runtime.logger?.warn?.(`dsh-org-panel: 飞书附件下载失败（${kind}）：${error instanceof Error ? error.message : String(error)}`)
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  private setState(state: AdapterStatus['state'], detail: string | undefined): void {
    this.state = state
    this.detail = detail
  }
}

export function createFeishuAdapter(config: CommunicationAdapterConfig, runtime: AdapterRuntime): FeishuAdapter {
  return new FeishuAdapter(config, runtime)
}
