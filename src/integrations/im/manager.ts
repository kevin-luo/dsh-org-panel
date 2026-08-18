// Communication Manager（需求文档二十二 / 二十三 / 三十一 / 四十一）：
// 「公司设置 → 通讯」背后的唯一实现。负责按配置装配 Adapter、解析 SecretRef、
// 把 Gateway 与 Company Router 接起来，并给 UI 提供只含掩码的渠道摘要。
// 铁律：密钥只以 env:/secret: 引用形式配置，解析出的明文只在 Adapter 实例内存里活着，
// 不落 evolution.json / company.json，不进日志，也不通过任何工具回传。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { EMPLOYEE_BLUEPRINTS, roleById } from '../../org-blueprints'
import { IMGateway, describeError } from './gateway'
import { CompanyRouter } from './router'
import { createFeishuAdapter, FeishuAdapter } from './adapters/feishu'
import { createQQAdapter } from './adapters/qq'
import { createWeChatAdapter } from './adapters/wechat'
import {
  DEFAULT_MAX_EMPLOYEE_HOPS, allowsWrite, maskSecretValue, normalizeCommunicationConfig,
  type AdapterSummary, type ChannelBinding, type CommunicationAdapterConfig, type CommunicationConfig,
  type CommunicationEventSink, type CommunicationLogger, type CommunicationSummary, type CredentialSummary,
  type EmployeeDispatcher, type IMAdapter, type OutgoingMessage, type RosterEntry, type SecretRef, type TimelineEntry,
} from './types'

/** 把 SecretRef 解析成真实值；返回 undefined 表示未配置（UI 只会看到 configured=false）。 */
export type SecretResolver = (ref: SecretRef) => Promise<string | undefined> | string | undefined

export type CommunicationManagerDeps = {
  config: CommunicationConfig
  roster: RosterEntry[]
  logger?: CommunicationLogger
  events?: CommunicationEventSink
  dispatcher?: EmployeeDispatcher
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
  readonly router: CompanyRouter

  private readonly adapters = new Map<string, IMAdapter>()
  private readonly attachmentDir: string
  private readonly resolver: SecretResolver
  private warnedSecretStore = false
  private started = false

  constructor(private readonly deps: CommunicationManagerDeps) {
    this.attachmentDir = deps.attachmentDir || join(homedir(), '.dsh-org-panel', 'attachments')
    this.resolver = deps.resolveSecret || ((ref: SecretRef) => this.defaultResolve(ref))
    this.gateway = new IMGateway({ logger: deps.logger, events: deps.events })
    this.router = new CompanyRouter({
      gateway: this.gateway, roster: deps.roster, bindings: deps.config.channelBindings,
      dispatcher: deps.dispatcher, logger: deps.logger, events: deps.events,
      maxEmployeeHops: DEFAULT_MAX_EMPLOYEE_HOPS,
    })
    this.gateway.onMessage((message) => this.router.handle(message))
    for (const adapterConfig of deps.config.adapters) {
      const adapter = createAdapter(adapterConfig, { logger: deps.logger, resolveSecret: (ref) => this.resolve(ref), attachmentDir: this.attachmentDir })
      this.adapters.set(adapterConfig.id, adapter)
      this.gateway.register(adapter, adapterConfig)
    }
  }

  get config(): CommunicationConfig {
    return this.deps.config
  }

  /** 是否真的配置了通讯渠道；未配置时上层应当安静降级。 */
  get configured(): boolean {
    return this.deps.config.adapters.some((item) => item.enabled)
  }

  adapter(adapterId: string): IMAdapter | undefined {
    return this.adapters.get(adapterId)
  }

  /** 拿到飞书 Adapter，便于宿主把 handleEvent 挂到自己已有的 HTTP 服务上。 */
  feishuAdapter(adapterId?: string): FeishuAdapter | undefined {
    for (const [id, adapter] of this.adapters) {
      if (adapterId && id !== adapterId) continue
      if (adapter instanceof FeishuAdapter) return adapter
    }
    return undefined
  }

  setDispatcher(dispatcher: EmployeeDispatcher | null): void {
    this.router.setDispatcher(dispatcher)
  }

  setRoster(roster: RosterEntry[]): void {
    this.router.setRoster(roster)
  }

  setBindings(bindings: ChannelBinding[]): void {
    this.deps.config.channelBindings = bindings
    this.router.setBindings(bindings)
  }

  timeline(limit = 30): TimelineEntry[] {
    return this.router.timeline(limit)
  }

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

  /**
   * 主动向已配置的会话发一条消息；只允许发往配置里出现过的会话，避免变成群发工具。
   * 「在名单里」不等于「可以往里写」：目标会话的 permissionMode 不允许写就一律拒绝，
   * 否则只读公开群会变成 LLM 的投稿口（需求文档三十 / 五十七）。
   */
  async send(adapterId: string, conversationId: string, message: OutgoingMessage): Promise<boolean> {
    const config = this.gateway.configOf(adapterId)
    if (!config) return false
    const rule = config.access.conversations.find((item) => item.conversationId === conversationId)
    const bound = this.deps.config.channelBindings.some((item) => item.adapterId === adapterId && item.externalConversationId === conversationId)
    if (!rule && !bound) throw new Error(`会话 ${conversationId} 不在 ${config.name} 的允许群名单或群绑定里，拒绝发送`)
    // 只在群绑定里出现、没写规则的会话，按渠道兜底档位处理，绝不隐式提权。
    const mode = rule ? rule.permissionMode : config.access.defaultPermissionMode
    if (!allowsWrite(mode)) {
      throw new Error(`会话 ${rule?.name || conversationId} 在 ${config.name} 里是 ${mode} 档位，只读会话不允许主动投稿，拒绝发送`)
    }
    return this.gateway.send(adapterId, conversationId, message)
  }

  /**
   * UI 上那个「员工之间自动转交上限」必须是真实生效值：
   * Router 用的是各渠道自己的 routing.maxHops，这里取已启用渠道里最大的那个，
   * 一个渠道都没有时才回落到默认值。
   */
  private effectiveMaxEmployeeHops(): number {
    const enabled = this.deps.config.adapters.filter((item) => item.enabled)
    const pool = enabled.length ? enabled : this.deps.config.adapters
    return pool.length ? Math.max(...pool.map((item) => item.routing.maxHops)) : DEFAULT_MAX_EMPLOYEE_HOPS
  }

  /** 对外摘要：只有掩码与 configured 布尔值，绝不回传完整密钥（需求文档三十一）。 */
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
    return { configured: this.configured, adapters, channelBindings: this.deps.config.channelBindings, maxEmployeeHops: this.effectiveMaxEmployeeHops() }
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

  /** 默认解析：env: 走环境变量；secret: 需要宿主注入密钥服务，第一版不自建明文存储。 */
  private defaultResolve(ref: SecretRef): string | undefined {
    if (ref.startsWith('env:')) return process.env[ref.slice(4)] || undefined
    if (!this.warnedSecretStore) {
      this.warnedSecretStore = true
      this.deps.logger?.warn?.('dsh-org-panel: secret: 引用需要宿主注入密钥服务（resolveSecret），当前仅支持 env: 引用')
    }
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Company Event Bus 桥接（需求文档三十二 / 三十三）
// ---------------------------------------------------------------------------

/** 结构化的事件总线接口：只要有 publish(event, origin) 就能接，避免与 Phase 3 文件强耦合。 */
export type CompanyEventPublisher = { publish(event: any, origin?: string): void }

function clip(text: string, max = 120): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/**
 * 把通讯层事件翻译成 Company Event（message.received / message.sent）投进总线，
 * 办公室与网页群聊据此显示「🔔 飞书新消息」和员工回复。
 * 只翻译有真实对应关系的事件：系统通知不会伪造成某位员工的发言。
 */
export function createCompanyEventSink(bus: CompanyEventPublisher): CommunicationEventSink {
  let serial = 0
  return {
    emit(event) {
      serial += 1
      if (event.type === 'external.message.received') {
        bus.publish({
          id: `im:${event.adapterId}:${event.messageId}`, type: 'message.received', at: event.at, origin: event.platform,
          platform: event.platform, conversationId: event.conversationId, preview: clip(event.text),
          senderName: event.senderName, targetEmployeeId: event.targetEmployeeId,
        }, event.platform)
        return
      }
      if (event.type === 'external.message.sent' && event.kind === 'employee-reply' && event.employeeId) {
        bus.publish({
          id: `im:sent:${event.adapterId}:${event.at}:${serial}`, type: 'message.sent', at: event.at, origin: event.platform,
          platform: event.platform, conversationId: event.conversationId, employeeId: event.employeeId, preview: clip(event.text),
        }, event.platform)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// 名册：Web 与 IM 共用同一份员工 id（需求文档二十九）
// ---------------------------------------------------------------------------

export function rosterFromConfig(config: any): RosterEntry[] {
  const rows = Array.isArray(config?.staff) && config.staff.length ? config.staff : EMPLOYEE_BLUEPRINTS
  return rows.map((row: any) => {
    const blueprint = EMPLOYEE_BLUEPRINTS.find((item) => item.id === row.id || item.id === row.roleId)
    const role = roleById(String(row.roleId || blueprint?.roleId || ''))
    return {
      id: String(row.id),
      name: String(row.name || blueprint?.name || row.id),
      role: String(row.role || blueprint?.role || ''),
      emoji: row.emoji || blueprint?.emoji,
      department: row.department || blueprint?.department,
      brief: row.brief || blueprint?.brief,
      aliases: Array.from(new Set([...(row.aliases || []), ...(blueprint?.aliases || [])].map(String).filter(Boolean))),
      keywords: Array.from(new Set([...(role?.keywords || []), ...(blueprint?.capabilities || [])].map(String).filter(Boolean))),
    } as RosterEntry
  })
}

// ---------------------------------------------------------------------------
// DSH 挂载入口
// ---------------------------------------------------------------------------

/** 自动发现事件总线：ctx.companyEvents / ctx.companyEventBus，emit 与 publish 两种形态都认。 */
function resolveEventSink(ctx: any): CommunicationEventSink | undefined {
  const bus = ctx?.companyEvents || ctx?.companyEventBus
  if (!bus) return undefined
  if (typeof bus.emit === 'function') return bus as CommunicationEventSink
  if (typeof bus.publish === 'function') return createCompanyEventSink(bus as CompanyEventPublisher)
  return undefined
}

/**
 * 注册通讯层。config 结构（cordis.yml）：
 *
 * communication:
 *   adapters:
 *     - id: feishu
 *       platform: feishu
 *       enabled: true
 *       connectionMode: long-conn      # 或 webhook（需要 options.webhookPort）
 *       credentials: { appId: env:FEISHU_APP_ID, appSecret: env:FEISHU_APP_SECRET }
 *       routing: { defaultTarget: secretary, recognizeMentions: true, allowEmployeeCollaboration: false, maxHops: 4 }
 *       access:
 *         actors: [{ userId: ou_xxx, name: 老板, role: owner, permissionMode: danger-full-access }]
 *         conversations: [{ conversationId: oc_xxx, name: 研发群, permissionMode: workspace-write }]
 *   channelBindings:
 *     - { adapterId: feishu, externalConversationId: oc_xxx, companyChannelId: engineering }
 *
 * 未配置时安静降级：不连接、不报错，只注册一个只读状态工具供「公司设置 → 通讯」显示未连接。
 */
export function registerCommunication(ctx: any, config?: any): CommunicationManager | undefined {
  const logger: CommunicationLogger = { info: (text) => ctx?.logger?.info?.(text), warn: (text) => ctx?.logger?.warn?.(text), error: (text) => ctx?.logger?.error?.(text) }
  let manager: CommunicationManager
  try {
    manager = new CommunicationManager({
      config: normalizeCommunicationConfig(config?.communication),
      roster: rosterFromConfig(config),
      logger,
      events: resolveEventSink(ctx),
      resolveSecret: typeof ctx?.secrets?.get === 'function' ? (ref: SecretRef) => (ref.startsWith('env:') ? process.env[ref.slice(4)] : ctx.secrets.get(ref.slice(7))) : undefined,
      attachmentDir: config?.attachmentDir ? String(config.attachmentDir) : undefined,
    })
  } catch (error) {
    // 配置写错（尤其是明文密钥、渠道 id 重复）必须让老板看到，但不能拖垮整个插件。
    logger.warn?.(`dsh-org-panel: 通讯配置无效，已跳过：${describeError(error)}`)
    return undefined
  }

  const tools = ctx?.tools
  if (tools?.register) {
    tools.register({
      name: 'company_comm_status',
      description: '查看赛博公司外部通讯渠道（飞书 / QQ / 微信）的真实连接状态、群绑定、权限名单规模与最近往来消息。只返回掩码，不返回任何密钥。',
      parameters: { type: 'object', additionalProperties: false, properties: { timeline: { type: 'number', minimum: 1, maximum: 50, description: '返回最近多少条外部往来消息。' } } },
      output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] } },
      isConcurrencySafe: () => true,
      async execute(args: any) {
        const summary = await manager.summary()
        return { ...summary, timeline: manager.timeline(Number(args?.timeline) || 20) }
      },
    })

    tools.register({
      name: 'company_comm_send',
      description: '把一条消息主动发到已配置的外部会话（飞书群 / 单聊）。只允许发往允许群名单或群绑定里出现过的会话，且该会话必须是可写档位（read-only 会话一律拒绝）；未接通渠道会如实报错，不会假装已送达。',
      parameters: {
        type: 'object', additionalProperties: false, required: ['adapterId', 'conversationId', 'text'],
        properties: {
          adapterId: { type: 'string', description: '通讯渠道 id，如 feishu。' },
          conversationId: { type: 'string', description: '外部会话 id，如飞书 chat_id（oc_xxx）。' },
          text: { type: 'string', minLength: 1 },
          staff: { type: 'string', description: '以哪位员工的身份发送；必须是公司名册里的 employeeId，不会创建平台分身。' },
        },
      },
      output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: value?.sent ? `已发送到 ${value.adapterId} · ${value.conversationId}` : `发送失败：${value?.reason || '未知原因'}` }] } },
      isConcurrencySafe: () => false,
      async execute(args: any) {
        const employee = args?.staff ? manager.router.employeeById(String(args.staff)) : undefined
        if (args?.staff && !employee) throw new Error(`未知员工 id：${String(args.staff)}`)
        const sent = await manager.send(String(args.adapterId), String(args.conversationId), {
          text: String(args.text), kind: employee ? 'employee-reply' : 'notice',
          employeeId: employee?.id, employeeName: employee?.name, employeeRole: employee?.role,
        })
        return { sent, adapterId: String(args.adapterId), conversationId: String(args.conversationId), staffId: employee?.id, reason: sent ? undefined : '渠道未连接或发送失败' }
      },
    })
  }

  if (manager.configured) {
    ctx?.systemPrompt?.section?.({
      name: 'dsh-org-panel:communication',
      order: -3,
      text: [
        '【赛博公司 · 外部通讯制度】',
        '飞书等外部平台的消息统一经过 IM Gateway 归一化、鉴权后交给 Company Router，再分派给名册里的同一位员工。',
        '不存在「飞书老王」「QQ 小刘」这类平台分身：每位员工在所有渠道共享同一份长期记忆、技能、插件绑定、经验和工作履历。',
        '外部消息自带 actorRole 与 permissionMode。Read Only 渠道只能读取和回答：写工具由派活闸门（writeGate）在代码层拦截，绕过闸门执行写操作会被判越权并拦掉回复。权限不足时如实说明，不要绕道。',
        '员工之间的转交有次数上限，达到上限必须交回秘书，不允许无限互相转发。',
        '需要查看渠道连接状态或最近外部往来时调用 company_comm_status；主动外发消息用 company_comm_send，只能发往已配置会话。',
      ].join('\n'),
    })
  }

  void manager.start().catch((error) => logger.warn?.(`dsh-org-panel: 通讯层启动失败：${describeError(error)}`))
  ctx?.on?.('dispose', () => { void manager.stop() })
  return manager
}
