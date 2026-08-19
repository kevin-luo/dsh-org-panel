// IM Gateway（需求文档二十一 / 二十八 / 三十）：所有平台消息的唯一入口。
// 职责：注册 Adapter、归一化去重、按「允许用户 / 允许群 / 权限级别」裁决安全边界，
// 然后把统一的 ExternalMessage 交给 Company Router。
// 铁律：Gateway 不认识员工，也不调用 staff_chat；Adapter 更不允许自己路由。
import {
  SAFE_PERMISSION_FLOOR, minPermission, normalizeActorRole,
  type AccessDecision, type AdapterStatus, type CommunicationAdapterConfig, type CommunicationEventSink,
  type CommunicationLogger, type ExternalMessage, type IMAdapter, type IMMessageHandler, type OutgoingMessage,
} from './types'

const DEDUPE_TTL = 10 * 60 * 1000
const DEDUPE_MAX = 500

type Entry = { adapter: IMAdapter; config: CommunicationAdapterConfig }

/**
 * 安全裁决（需求文档三十）：外部消息进入 Runtime 前必须拿到 actorRole 与 permissionMode。
 * 名单外用户 / 名单外群一律 read-only 或直接拒绝，绝不因为消息来自飞书就默认 Full Access。
 */
export function evaluateAccess(config: CommunicationAdapterConfig, message: ExternalMessage): AccessDecision {
  if (!config.enabled) return { allowed: false, reason: 'adapter-disabled', detail: `渠道 ${config.id} 未启用` }
  const policy = config.access
  const actorRule = policy.actors.find((item) => item.userId === message.senderId)
  if (!actorRule && !policy.allowUnknownUsers) {
    return { allowed: false, reason: 'unknown-user', detail: `发件人不在 ${config.name} 允许用户名单内` }
  }
  const conversationRule = policy.conversations.find((item) => item.conversationId === message.conversationId)
  const isDirect = message.conversationType === 'direct'
  if (!conversationRule && !policy.allowUnknownConversations && !(isDirect && actorRule)) {
    return { allowed: false, reason: 'unknown-conversation', detail: `会话不在 ${config.name} 允许群名单内` }
  }
  // 名单外用户恒为 guest + read-only；名单外群同样按最低档位处理。
  const actorMode = actorRule ? actorRule.permissionMode : SAFE_PERMISSION_FLOOR
  const conversationMode = conversationRule ? conversationRule.permissionMode : isDirect && actorRule ? actorRule.permissionMode : SAFE_PERMISSION_FLOOR
  return {
    allowed: true,
    actorRole: actorRule ? normalizeActorRole(actorRule.role) : 'guest',
    permissionMode: minPermission(actorMode, conversationMode),
    actorName: actorRule?.name,
    conversationName: conversationRule?.name,
    allowedEmployees: conversationRule?.allowedEmployees,
  }
}

export class IMGateway {
  private readonly entries = new Map<string, Entry>()
  private readonly seen = new Map<string, number>()
  private handler: IMMessageHandler | null = null
  private started = false

  constructor(private readonly deps: { logger?: CommunicationLogger; events?: CommunicationEventSink } = {}) {}

  register(adapter: IMAdapter, config: CommunicationAdapterConfig): void {
    if (this.entries.has(adapter.id)) throw new Error(`通讯渠道 id 重复：${adapter.id}`)
    this.entries.set(adapter.id, { adapter, config })
    // 把 Promise 原样交还 Adapter。支持等待回调的 Adapter / 测试探针可以等到 Router 真实处理完；
    // 不等待的第三方 Adapter 仍保持原行为，不改变兼容性。
    adapter.onMessage((message) => this.ingest(adapter.id, message))
  }

  onMessage(handler: IMMessageHandler): void {
    this.handler = handler
  }

  configOf(adapterId: string): CommunicationAdapterConfig | undefined {
    return this.entries.get(adapterId)?.config
  }

  adapterIds(): string[] {
    return Array.from(this.entries.keys())
  }

  statuses(): AdapterStatus[] {
    return Array.from(this.entries.values()).map((entry) => entry.adapter.status())
  }

  /** 启动全部已启用渠道；单个渠道失败只降级它自己，不影响其它渠道与主插件。 */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    for (const entry of this.entries.values()) {
      if (!entry.config.enabled) continue
      try {
        await entry.adapter.start()
      } catch (error) {
        this.deps.logger?.warn?.(`dsh-org-panel: 通讯渠道 ${entry.config.name} 启动失败（${describeError(error)}），已降级为未连接`)
      }
      const status = entry.adapter.status()
      this.deps.events?.emit({ type: 'external.adapter.status', at: Date.now(), platform: entry.adapter.platform, adapterId: entry.adapter.id, state: status.state, detail: status.detail })
    }
  }

  async stop(): Promise<void> {
    this.started = false
    for (const entry of this.entries.values()) {
      try {
        await entry.adapter.stop()
      } catch (error) {
        this.deps.logger?.warn?.(`dsh-org-panel: 通讯渠道 ${entry.config.name} 停止异常：${describeError(error)}`)
      }
    }
  }

  /** 出站发送。返回 false 表示渠道不存在或发送失败，调用方负责如实告知，不允许假装已送达。 */
  async send(adapterId: string, conversationId: string, message: OutgoingMessage): Promise<boolean> {
    const entry = this.entries.get(adapterId)
    if (!entry) {
      this.deps.logger?.warn?.(`dsh-org-panel: 未知通讯渠道 ${adapterId}，消息未发送`)
      return false
    }
    if (!entry.config.enabled) return false
    try {
      await entry.adapter.send(conversationId, message)
      return true
    } catch (error) {
      this.deps.logger?.warn?.(`dsh-org-panel: ${entry.config.name} 发送失败：${describeError(error)}`)
      return false
    }
  }

  /** Adapter 回调入口：去重 → 安全裁决 → 交给 Router，并等待这一条真实处理链结束。 */
  private async ingest(adapterId: string, raw: ExternalMessage): Promise<void> {
    const entry = this.entries.get(adapterId)
    if (!entry) return
    const message: ExternalMessage = { ...raw, adapterId }
    if (!message.text.trim() && !message.attachments.length) return
    if (this.isDuplicate(`${adapterId}:${message.id}`)) return
    const decision = evaluateAccess(entry.config, message)
    if (!decision.allowed) {
      this.deps.logger?.info?.(`dsh-org-panel: 已拦截 ${entry.config.name} 消息（${decision.reason}）`)
      this.deps.events?.emit({ type: 'external.message.blocked', at: Date.now(), platform: message.platform, adapterId, conversationId: message.conversationId, senderId: message.senderId, reason: decision.detail })
      return
    }
    const stamped: ExternalMessage = {
      ...message,
      actorRole: decision.actorRole,
      permissionMode: decision.permissionMode,
      senderName: message.senderName || decision.actorName,
      conversationName: message.conversationName || decision.conversationName,
    }
    if (!this.handler) {
      this.deps.logger?.warn?.('dsh-org-panel: Company Router 未接线，外部消息被丢弃')
      return
    }
    try {
      await this.handler(stamped)
    } catch (error) {
      this.deps.logger?.error?.(`dsh-org-panel: 处理外部消息失败：${describeError(error)}`)
    }
  }

  private isDuplicate(key: string): boolean {
    const now = Date.now()
    if (this.seen.size > DEDUPE_MAX) {
      for (const [item, at] of this.seen) if (now - at > DEDUPE_TTL) this.seen.delete(item)
      if (this.seen.size > DEDUPE_MAX) this.seen.clear()
    }
    const hit = this.seen.get(key)
    if (hit !== undefined && now - hit < DEDUPE_TTL) return true
    this.seen.set(key, now)
    return false
  }
}

/** 统一错误描述：只输出 message，避免把带凭据的请求体打进日志。 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
