// Communication Manager：公司外部通讯的装配与状态中心。
// 平台 Adapter 只负责传输；Gateway 负责鉴权；WorkRouter 负责会话串行与安全回信；
// 真正的员工选择 / 动态组队 / 同事邀请统一交给 Work Orchestrator。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { EMPLOYEE_BLUEPRINTS, roleById } from '../../org-blueprints'
import { firstCtxService, readCtxService } from '../../runtime/ctx-service'
import { IMGateway, describeError } from './gateway'
import { WorkRouter, type WorkDispatcher } from './work-router'
import { createFeishuAdapter, FeishuAdapter } from './adapters/feishu'
import { createQQAdapter } from './adapters/qq'
import { createWeChatAdapter } from './adapters/wechat'
import {
  DEFAULT_MAX_WORKGROUP_SIZE, allowsWrite, maskSecretValue, normalizeCommunicationConfig,
  type AdapterSummary, type ChannelBinding, type CommunicationAdapterConfig, type CommunicationConfig,
  type CommunicationEventSink, type CommunicationLogger, type CommunicationSummary, type CredentialSummary,
  type IMAdapter, type OutgoingMessage, type RosterEntry, type SecretRef, type TimelineEntry,
} from './types'

export type SecretResolver = (ref: SecretRef) => Promise<string | undefined> | string | undefined

export type CommunicationManagerDeps = {
  config: CommunicationConfig
  roster: RosterEntry[]
  logger?: CommunicationLogger
  events?: CommunicationEventSink
  dispatcher?: WorkDispatcher
  resolveSecret?: SecretResolver
  attachmentDir?: string
}

function createAdapter(config: CommunicationAdapterConfig, runtime: { logger?: CommunicationLogger; resolveSecret: (ref: SecretRef) => Promise<string | undefined>; attachmentDir: string }): IMAdapter {
  if (config.platform === 'feishu') return createFeishuAdapter(config, runtime)
  if (config.platform === 'qq') return createQQAdapter(config, runtime)
  return createWeChatAdapter(config, runtime)
}

export class CommunicationManager {
  readonly gateway: IMGateway
  readonly router: WorkRouter

  private readonly adapters = new Map<string, IMAdapter>()
  private readonly attachmentDir: string
  private readonly resolver: SecretResolver
  private warnedSecretStore = false
  private started = false

  constructor(private readonly deps: CommunicationManagerDeps) {
    this.attachmentDir = deps.attachmentDir || join(homedir(), '.dsh-org-panel', 'attachments')
    this.resolver = deps.resolveSecret || ((ref: SecretRef) => this.defaultResolve(ref))
    this.gateway = new IMGateway({ logger: deps.logger, events: deps.events })
    this.router = new WorkRouter({ gateway: this.gateway, roster: deps.roster, bindings: deps.config.channelBindings, dispatcher: deps.dispatcher, logger: deps.logger, events: deps.events })
    this.gateway.onMessage((message) => this.router.handle(message))
    for (const adapterConfig of deps.config.adapters) {
      const adapter = createAdapter(adapterConfig, { logger: deps.logger, resolveSecret: (ref) => this.resolve(ref), attachmentDir: this.attachmentDir })
      this.adapters.set(adapterConfig.id, adapter)
      this.gateway.register(adapter, adapterConfig)
    }
  }

  get config(): CommunicationConfig { return this.deps.config }
  get configured(): boolean { return this.deps.config.adapters.some((item) => item.enabled) }
  adapter(adapterId: string): IMAdapter | undefined { return this.adapters.get(adapterId) }

  feishuAdapter(adapterId?: string): FeishuAdapter | undefined {
    for (const [id, adapter] of this.adapters) {
      if (adapterId && id !== adapterId) continue
      if (adapter instanceof FeishuAdapter) return adapter
    }
    return undefined
  }

  setDispatcher(dispatcher: WorkDispatcher | null): void { this.router.setDispatcher(dispatcher) }
  setRoster(roster: RosterEntry[]): void { this.router.setRoster(roster) }
  setBindings(bindings: ChannelBinding[]): void { this.deps.config.channelBindings = bindings; this.router.setBindings(bindings) }
  timeline(limit = 30): TimelineEntry[] { return this.router.timeline(limit) }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    if (!this.configured) {
      this.deps.logger?.info?.('dsh-org-panel: 未配置任何已启用的通讯渠道，IM Gateway 保持关闭')
      return
    }
    await this.gateway.start()
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    await this.gateway.stop()
  }

  async send(adapterId: string, conversationId: string, message: OutgoingMessage): Promise<boolean> {
    const config = this.gateway.configOf(adapterId)
    if (!config) return false
    const rule = config.access.conversations.find((item) => item.conversationId === conversationId)
    const bound = this.deps.config.channelBindings.some((item) => item.adapterId === adapterId && item.externalConversationId === conversationId)
    if (!rule && !bound) throw new Error(`会话 ${conversationId} 不在 ${config.name} 的允许群名单或群绑定里，拒绝发送`)
    const mode = rule ? rule.permissionMode : config.access.defaultPermissionMode
    if (!allowsWrite(mode)) throw new Error(`会话 ${rule?.name || conversationId} 在 ${config.name} 里是 ${mode} 档位，只读会话不允许主动投稿，拒绝发送`)
    return this.gateway.send(adapterId, conversationId, message)
  }

  async summary(): Promise<CommunicationSummary> {
    const statuses = new Map(this.gateway.statuses().map((item) => [item.id, item]))
    const adapters: AdapterSummary[] = []
    for (const config of this.deps.config.adapters) {
      const status = statuses.get(config.id)
      const credentials: CredentialSummary[] = []
      for (const [field, ref] of Object.entries(config.credentials)) {
        const value = await this.resolve(ref)
        credentials.push({ field, ref, configured: !!value, masked: field === 'appId' ? maskSecretValue(value, 'cli_') : value ? '****' : '' })
      }
      const appId = credentials.find((item) => item.field === 'appId')
      adapters.push({
        id: config.id, platform: config.platform, name: config.name, enabled: config.enabled, connectionMode: config.connectionMode,
        state: status?.state || 'idle', detail: status?.detail, lastEventAt: status?.lastEventAt, lastSentAt: status?.lastSentAt,
        receivedCount: status?.receivedCount || 0, sentCount: status?.sentCount || 0,
        capabilities: config.capabilities, routing: config.routing, credentials,
        appId: appId?.masked || undefined,
        appSecretConfigured: credentials.some((item) => item.field === 'appSecret' && item.configured),
        access: {
          allowUnknownUsers: config.access.allowUnknownUsers, allowUnknownConversations: config.access.allowUnknownConversations,
          defaultPermissionMode: config.access.defaultPermissionMode, actorCount: config.access.actors.length, conversationCount: config.access.conversations.length,
        },
      })
    }
    const enabled = this.deps.config.adapters.filter((item) => item.enabled)
    const pool = enabled.length ? enabled : this.deps.config.adapters
    const maxWorkgroupSize = pool.length ? Math.max(...pool.map((item) => item.routing.maxWorkgroupSize)) : DEFAULT_MAX_WORKGROUP_SIZE
    return { configured: this.configured, adapters, channelBindings: this.deps.config.channelBindings, maxWorkgroupSize }
  }

  private async resolve(ref: SecretRef): Promise<string | undefined> {
    try {
      const value = await this.resolver(ref)
      return value ? String(value) : undefined
    } catch (error) {
      this.deps.logger?.warn?.(`dsh-org-panel: 凭据引用解析失败（${ref.split(':')[0]}:***）：${describeError(error)}`)
      return undefined
    }
  }

  private defaultResolve(ref: SecretRef): string | undefined {
    if (ref.startsWith('env:')) return process.env[ref.slice(4)] || undefined
    if (!this.warnedSecretStore) {
      this.warnedSecretStore = true
      this.deps.logger?.warn?.('dsh-org-panel: secret: 引用需要宿主注入密钥服务（resolveSecret），当前仅支持 env: 引用')
    }
    return undefined
  }
}

export type CompanyEventPublisher = { publish(event: any, origin?: string): void }

function clip(text: string, max = 120): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export function createCompanyEventSink(bus: CompanyEventPublisher): CommunicationEventSink {
  let serial = 0
  return {
    emit(event) {
      serial += 1
      if (event.type === 'external.message.received') {
        bus.publish({ id: `im:${event.adapterId}:${event.messageId}`, type: 'message.received', at: event.at, origin: event.platform, platform: event.platform, conversationId: event.conversationId, preview: clip(event.text), senderName: event.senderName }, event.platform)
        return
      }
      if (event.type === 'external.message.sent' && event.kind === 'employee-reply' && event.employeeId) {
        bus.publish({ id: `im:sent:${event.adapterId}:${event.at}:${serial}`, type: 'message.sent', at: event.at, origin: event.platform, platform: event.platform, conversationId: event.conversationId, employeeId: event.employeeId, preview: clip(event.text) }, event.platform)
      }
    },
  }
}

export function rosterFromConfig(config: any): RosterEntry[] {
  const rows = Array.isArray(config?.staff) && config.staff.length ? config.staff : EMPLOYEE_BLUEPRINTS
  return rows.map((row: any) => {
    const blueprint = EMPLOYEE_BLUEPRINTS.find((item) => item.id === row.id || item.id === row.roleId)
    const role = roleById(String(row.roleId || blueprint?.roleId || ''))
    return {
      id: String(row.id), name: String(row.name || blueprint?.name || row.id), role: String(row.role || blueprint?.role || ''),
      emoji: row.emoji || blueprint?.emoji, department: row.department || blueprint?.department, brief: row.brief || blueprint?.brief,
      aliases: Array.from(new Set([...(row.aliases || []), ...(blueprint?.aliases || [])].map(String).filter(Boolean))),
      keywords: Array.from(new Set([...(role?.keywords || []), ...(blueprint?.capabilities || [])].map(String).filter(Boolean))),
    } as RosterEntry
  })
}

function resolveEventSink(ctx: any, explicit?: CommunicationEventSink | CompanyEventPublisher): CommunicationEventSink | undefined {
  const bus: any = explicit || firstCtxService(ctx, ['companyEvents', 'companyEventBus'])
  if (!bus) return undefined
  if (typeof bus.emit === 'function') return bus as CommunicationEventSink
  if (typeof bus.publish === 'function') return createCompanyEventSink(bus as CompanyEventPublisher)
  return undefined
}

function resolveSecretReader(ctx: any): SecretResolver | undefined {
  const service: any = readCtxService(ctx, 'secrets')
  if (!service || typeof service.get !== 'function') return undefined
  return (ref: SecretRef) => (ref.startsWith('env:') ? process.env[ref.slice(4)] : service.get(ref.slice(7)))
}

export function registerCommunication(ctx: any, config?: any, options?: { events?: CommunicationEventSink | CompanyEventPublisher }): CommunicationManager | undefined {
  const logger: CommunicationLogger = { info: (text) => ctx?.logger?.info?.(text), warn: (text) => ctx?.logger?.warn?.(text), error: (text) => ctx?.logger?.error?.(text) }
  let manager: CommunicationManager
  try {
    manager = new CommunicationManager({
      config: normalizeCommunicationConfig(config?.communication), roster: rosterFromConfig(config), logger,
      events: resolveEventSink(ctx, options?.events), resolveSecret: resolveSecretReader(ctx),
      attachmentDir: config?.attachmentDir ? String(config.attachmentDir) : undefined,
    })
  } catch (error) {
    logger.warn?.(`dsh-org-panel: 通讯配置无效，已跳过：${describeError(error)}`)
    return undefined
  }

  const tools = ctx?.tools
  if (tools?.register) {
    tools.register({
      name: 'company_comm_status',
      description: '查看赛博公司外部通讯渠道的真实连接状态、工作组上限、群绑定、权限与最近消息。只返回掩码。',
      parameters: { type: 'object', additionalProperties: false, properties: { timeline: { type: 'number', minimum: 1, maximum: 50 } } },
      output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] } },
      isConcurrencySafe: () => true,
      async execute(args: any) { return { ...(await manager.summary()), timeline: manager.timeline(Number(args?.timeline) || 20) } },
    })
    tools.register({
      name: 'company_comm_send',
      description: '把消息主动发到已配置且可写的外部会话。可以指定真实员工身份；不会创建平台分身。',
      parameters: { type: 'object', additionalProperties: false, required: ['adapterId', 'conversationId', 'text'], properties: { adapterId: { type: 'string' }, conversationId: { type: 'string' }, text: { type: 'string', minLength: 1 }, staff: { type: 'string', description: '真实 employeeId。' } } },
      output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: value?.sent ? `已发送到 ${value.adapterId} · ${value.conversationId}` : `发送失败：${value?.reason || '未知原因'}` }] } },
      isConcurrencySafe: () => false,
      async execute(args: any) {
        const employee = args?.staff ? manager.router.employeeById(String(args.staff)) : undefined
        if (args?.staff && !employee) throw new Error(`未知员工 id：${String(args.staff)}`)
        const sent = await manager.send(String(args.adapterId), String(args.conversationId), { text: String(args.text), kind: employee ? 'employee-reply' : 'notice', employeeId: employee?.id, employeeName: employee?.name, employeeRole: employee?.role })
        return { sent, adapterId: String(args.adapterId), conversationId: String(args.conversationId), staffId: employee?.id, reason: sent ? undefined : '渠道未连接或发送失败' }
      },
    })
  }

  if (manager.configured) {
    ctx?.systemPrompt?.section?.({
      name: 'dsh-org-panel:communication', order: -3,
      text: [
        '【赛博公司 · 外部通讯制度】',
        '飞书、QQ、微信统一经过 IM Gateway 鉴权，再进入 Work Router，最终交给同一个 Work Orchestrator 自动组队。',
        '渠道层不选择主 Agent、不默认交给秘书，也不维护员工转交链。每位员工在所有渠道共享长期记忆、技能、插件、模型能力和履历。',
        'Read Only 来源若真实观测到写工具，该员工回复会被拦下并留下越权事件。',
      ].join('\n'),
    })
  }

  void manager.start().catch((error) => logger.warn?.(`dsh-org-panel: 通讯层启动失败：${describeError(error)}`))
  ctx?.on?.('dispose', () => { void manager.stop() })
  return manager
}
