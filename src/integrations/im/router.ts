// Company Router（需求文档二十一 / 二十四 / 二十五 / 二十九 / 三十六）：
// 所有平台的消息在这里被解释成「找哪位员工」，然后交给同一套 Employee Runtime。
// 铁律：员工身份只有 employeeId 一份，Web 与飞书、QQ、微信共享同一份 Memory / Skills / XP / TaskHistory；
// 这里绝不创建「飞书老王」，也绝不为某个平台另写一套 Agent 逻辑。
import {
  DEFAULT_MAX_EMPLOYEE_HOPS, SECRETARY_ID, allowsWrite, createWriteGate, isWriteToolName,
  type AttachmentRef, type ChannelBinding, type CommunicationEventSink, type CommunicationLogger,
  type EmployeeDispatchRequest, type EmployeeDispatchResult, type EmployeeDispatcher, type ExternalMessage,
  type OutgoingMessage, type RosterEntry, type RouteDecision, type TaskSource, type TimelineEntry, type WriteGate,
} from './types'
import { IMGateway } from './gateway'

const TIMELINE_LIMIT = 200

type RouterDeps = {
  gateway: IMGateway
  roster: RosterEntry[]
  bindings?: ChannelBinding[]
  dispatcher?: EmployeeDispatcher
  logger?: CommunicationLogger
  events?: CommunicationEventSink
  maxEmployeeHops?: number
}

type AliasHit = { employeeId: string; alias: string; index: number }

export class CompanyRouter {
  private roster: RosterEntry[]
  private bindings: ChannelBinding[]
  private dispatcher: EmployeeDispatcher | null
  private readonly timelineEntries: TimelineEntry[] = []
  private readonly queues = new Map<string, Promise<void>>()
  private warnedMissingRuntime = false

  constructor(private readonly deps: RouterDeps) {
    this.roster = deps.roster
    this.bindings = deps.bindings || []
    this.dispatcher = deps.dispatcher || null
  }

  /** host 侧把真实员工 Runtime 接进来；没接线时 Router 宁可如实说无法处理，也不编造回复。 */
  setDispatcher(dispatcher: EmployeeDispatcher | null): void {
    this.dispatcher = dispatcher
  }

  setRoster(roster: RosterEntry[]): void {
    this.roster = roster
  }

  setBindings(bindings: ChannelBinding[]): void {
    this.bindings = bindings
  }

  hasDispatcher(): boolean {
    return !!this.dispatcher
  }

  timeline(limit = 50): TimelineEntry[] {
    return this.timelineEntries.slice(-Math.max(1, Math.min(TIMELINE_LIMIT, limit)))
  }

  /** 外部群 → 内部频道（需求文档二十五）。 */
  channelIdFor(adapterId: string, conversationId: string): string | undefined {
    return this.bindings.find((item) => item.adapterId === adapterId && item.externalConversationId === conversationId)?.companyChannelId
  }

  employeeById(employeeId: string): RosterEntry | undefined {
    return this.roster.find((item) => item.id === employeeId)
  }

  /** Gateway 回调入口：同一会话内串行处理，保证消息顺序。 */
  handle(message: ExternalMessage): void {
    const key = `${message.adapterId}:${message.conversationId}`
    const previous = this.queues.get(key) || Promise.resolve()
    const next = previous.then(() => this.process(message)).catch((error) => {
      this.deps.logger?.error?.(`dsh-org-panel: 外部消息处理异常：${error instanceof Error ? error.message : String(error)}`)
    })
    this.queues.set(key, next)
    void next.then(() => { if (this.queues.get(key) === next) this.queues.delete(key) })
  }

  /**
   * 路由决策（需求文档二十四）：
   * 1) 文本 / 平台 @ 命中员工 → 直达该员工；
   * 2) 群绑定的默认负责人；
   * 3) 渠道 defaultTarget（秘书 / 某位员工 / auto）；
   * 4) auto 只做确定性关键词匹配，没把握一律交秘书，不猜。
   */
  route(message: ExternalMessage): RouteDecision {
    const config = this.deps.gateway.configOf(message.adapterId)
    const companyChannelId = this.channelIdFor(message.adapterId, message.conversationId)
    const allowed = this.allowedEmployees(message)
    const recognize = config ? config.routing.recognizeMentions : true
    const hits = recognize ? this.resolveMentions(message) : []
    const permitted = hits.filter((hit) => this.isEmployeeAllowed(hit.employeeId, allowed))
    if (permitted.length) {
      const primary = permitted[0]
      return this.decide(primary.employeeId, 'mention', companyChannelId, permitted.slice(1).map((item) => item.employeeId))
    }
    const binding = this.bindings.find((item) => item.adapterId === message.adapterId && item.externalConversationId === message.conversationId)
    const bound = (binding?.defaultEmployees || []).find((id) => this.employeeById(id) && this.isEmployeeAllowed(id, allowed))
    if (bound) return this.decide(bound, 'binding', companyChannelId, [])
    const target = config?.routing.defaultTarget || SECRETARY_ID
    if (target !== SECRETARY_ID && target !== 'auto' && this.employeeById(target) && this.isEmployeeAllowed(target, allowed)) {
      return this.decide(target, 'default', companyChannelId, [])
    }
    if (target === 'auto') {
      const guess = this.guessByKeywords(message.text, allowed)
      if (guess) return this.decide(guess, 'auto', companyChannelId, [])
    }
    return this.decide(SECRETARY_ID, 'fallback', companyChannelId, [])
  }

  private decide(employeeId: string, reason: RouteDecision['reason'], companyChannelId: string | undefined, alsoMentioned: string[]): RouteDecision {
    const employee = this.employeeById(employeeId)
    return {
      kind: employeeId === SECRETARY_ID ? 'secretary' : 'employee',
      employeeId,
      employeeName: employee?.name || (employeeId === SECRETARY_ID ? '秘书' : employeeId),
      reason,
      companyChannelId,
      alsoMentioned,
    }
  }

  /** 群规则里配置的可直达员工白名单，空表示不限制。 */
  private allowedEmployees(message: ExternalMessage): string[] | undefined {
    const config = this.deps.gateway.configOf(message.adapterId)
    const rule = config?.access.conversations.find((item) => item.conversationId === message.conversationId)
    return rule?.allowedEmployees
  }

  private isEmployeeAllowed(employeeId: string, allowed: string[] | undefined): boolean {
    if (employeeId === SECRETARY_ID) return true
    return !allowed || !allowed.length || allowed.includes(employeeId)
  }

  /** 识别 @员工：优先文本里的「@老王」，再看平台侧 mention 显示名。别名越长越优先。 */
  private resolveMentions(message: ExternalMessage): AliasHit[] {
    const text = message.text || ''
    const lower = text.toLowerCase()
    const hits: AliasHit[] = []
    for (const employee of this.roster) {
      for (const alias of this.aliasesOf(employee)) {
        const index = lower.indexOf(`@${alias.toLowerCase()}`)
        if (index >= 0) { hits.push({ employeeId: employee.id, alias, index }); break }
      }
    }
    if (hits.length) {
      return hits.sort((a, b) => a.index - b.index || b.alias.length - a.alias.length).filter((hit, index, list) => list.findIndex((item) => item.employeeId === hit.employeeId) === index)
    }
    const mentioned = (message.mentions || []).map((item) => String(item).toLowerCase().replace(/^@/, '').trim()).filter(Boolean)
    for (const employee of this.roster) {
      if (this.aliasesOf(employee).some((alias) => mentioned.includes(alias.toLowerCase()))) hits.push({ employeeId: employee.id, alias: employee.name, index: 0 })
    }
    return hits
  }

  private aliasesOf(employee: RosterEntry): string[] {
    return Array.from(new Set([employee.name, employee.id, employee.role, ...(employee.aliases || [])].filter(Boolean).map(String))).sort((a, b) => b.length - a.length)
  }

  /** auto 路由：只做确定性关键词匹配（岗位 / 部门 / 显式 keywords），匹配不到就交秘书。 */
  private guessByKeywords(text: string, allowed: string[] | undefined): string | undefined {
    const haystack = String(text || '').toLowerCase()
    if (!haystack.trim()) return undefined
    let best: { id: string; score: number } | null = null
    for (const employee of this.roster) {
      if (employee.id === SECRETARY_ID || !this.isEmployeeAllowed(employee.id, allowed)) continue
      const keywords = Array.from(new Set([...(employee.keywords || []), employee.role, employee.department || ''].filter(Boolean).map((item) => String(item).toLowerCase())))
      let score = 0
      for (const keyword of keywords) if (keyword.length >= 2 && haystack.includes(keyword)) score += keyword.length
      if (score > 0 && (!best || score > best.score)) best = { id: employee.id, score }
    }
    return best?.id
  }

  private async process(message: ExternalMessage): Promise<void> {
    const config = this.deps.gateway.configOf(message.adapterId)
    const decision = this.route(message)
    this.pushTimeline({
      id: message.id, at: message.createdAt || Date.now(), direction: 'in', platform: message.platform, adapterId: message.adapterId,
      conversationId: message.conversationId, conversationName: message.conversationName, companyChannelId: decision.companyChannelId,
      senderName: message.senderName || message.senderId, text: message.text, attachments: message.attachments.length, permissionMode: message.permissionMode,
    })
    this.deps.events?.emit({
      type: 'external.message.received', at: Date.now(), platform: message.platform, adapterId: message.adapterId,
      conversationId: message.conversationId, companyChannelId: decision.companyChannelId, messageId: message.id,
      senderId: message.senderId, senderName: message.senderName, text: message.text, attachments: message.attachments,
      actorRole: message.actorRole, permissionMode: message.permissionMode, targetEmployeeId: decision.employeeId,
    })

    if (!this.dispatcher) {
      if (!this.warnedMissingRuntime) {
        this.warnedMissingRuntime = true
        this.deps.logger?.warn?.('dsh-org-panel: Employee Runtime 未接线（setDispatcher 未调用），外部消息已记录但未处理')
      }
      if (config?.routing.notifyUndeliverable !== false) {
        await this.reply(message, decision.companyChannelId, { kind: 'system', text: '赛博公司当前没有可用的员工运行时，这条消息已被记录但还没有员工处理。' })
      }
      return
    }

    const maxHops = Math.max(0, config?.routing.maxHops ?? this.deps.maxEmployeeHops ?? DEFAULT_MAX_EMPLOYEE_HOPS)
    const collaboration = config?.routing.allowEmployeeCollaboration === true
    const writeAllowed = allowsWrite(message.permissionMode)
    const visited = new Set<string>()
    let current = decision.employeeId
    let hop = 0
    let text = message.text
    let attachments = message.attachments

    while (true) {
      visited.add(current)
      const employee = this.employeeById(current)
      // 每一跳一把新闸门：只读渠道下它会真的拦掉写工具，并把拦截 / 越权记录下来。
      const gate = createWriteGate(writeAllowed)
      const request = this.buildRequest(message, decision, current, employee?.name || current, text, attachments, hop, maxHops, gate)
      let result: EmployeeDispatchResult
      try {
        result = await this.dispatcher(request)
      } catch (error) {
        result = { ok: false, text: '', error: error instanceof Error ? error.message : String(error) }
      }
      // 权限裁决必须有人执行：闸门拦下的只记账，真被执行掉的写工具直接判越权。
      if (await this.auditWrite(message, decision, current, employee?.name || current, gate, result)) return
      if (!result.ok) {
        this.deps.logger?.warn?.(`dsh-org-panel: ${request.employeeName} 处理外部消息失败：${result.error || '未知原因'}`)
        if (config?.routing.notifyUndeliverable !== false) {
          await this.reply(message, decision.companyChannelId, { kind: 'notice', text: `${request.employeeName} 没能完成这次处理：${result.error || '未知原因'}` })
        }
        return
      }
      if (result.text.trim()) {
        await this.reply(message, decision.companyChannelId, { kind: 'employee-reply', text: result.text, employeeId: current, employeeName: employee?.name || current, employeeRole: employee?.role })
      }
      const handoff = result.handoffTo && this.employeeById(result.handoffTo) ? result.handoffTo : undefined
      if (!handoff || handoff === current) return
      if (!collaboration) {
        this.deps.logger?.info?.(`dsh-org-panel: 渠道未开启员工协作，已忽略 ${request.employeeName} → ${handoff} 的转交`)
        return
      }
      // 文档口径：一次「A → B」算一跳，maxHops=4 表示最多转发 4 次。
      if (hop + 1 > maxHops || visited.has(handoff)) {
        // 需求文档三十六：达到上限停止员工间转发，交回秘书。
        this.deps.events?.emit({ type: 'external.handoff.limited', at: Date.now(), platform: message.platform, adapterId: message.adapterId, conversationId: message.conversationId, fromEmployeeId: current, toEmployeeId: handoff, hop: hop + 1, maxHops })
        await this.reply(message, decision.companyChannelId, { kind: 'notice', text: `员工之间的转交已达到上限（${maxHops} 次），这件事交回秘书跟进。` })
        return
      }
      hop += 1
      text = `[同事转交] ${employee?.name || current} 把这件事转给你：\n${result.text || text}\n\n[原始消息]\n${message.text}`
      attachments = message.attachments
      current = handoff
    }
  }

  private buildRequest(
    message: ExternalMessage, decision: RouteDecision, employeeId: string, employeeName: string,
    text: string, attachments: AttachmentRef[], hop: number, maxHops: number, writeGate: WriteGate,
  ): EmployeeDispatchRequest {
    return {
      employeeId, employeeName, text, attachments,
      platform: message.platform, adapterId: message.adapterId, conversationId: message.conversationId,
      companyChannelId: decision.companyChannelId, senderId: message.senderId, senderName: message.senderName,
      actorRole: message.actorRole, permissionMode: message.permissionMode,
      writeAllowed: writeGate.allowed, writeGate,
      hop, maxHops, messageId: message.id, threadId: message.threadId,
      taskSource: taskSourceOf(message.platform),
    }
  }

  /**
   * 只读渠道的写操作审计（需求文档三十 / 五十七）。返回 true 表示这次派活已被判越权，调用方必须立刻停下。
   * · 闸门当场拦下（写没发生）→ 只记一条事实事件，员工那句「我没权限」照常发出去；
   * · 运行时绕过闸门真的执行了写工具 → 回复一律不发（可能是在汇报越权结果），转交链同时中止。
   */
  private async auditWrite(
    message: ExternalMessage, decision: RouteDecision, employeeId: string, employeeName: string,
    gate: WriteGate, result: EmployeeDispatchResult,
  ): Promise<boolean> {
    if (gate.allowed) return false
    if (gate.denied.length) {
      this.deps.logger?.info?.(`dsh-org-panel: 只读渠道拦下 ${employeeName} 的写工具：${gate.denied.join('、')}`)
      this.deps.events?.emit({ type: 'external.write.denied', at: Date.now(), platform: message.platform, adapterId: message.adapterId, conversationId: message.conversationId, employeeId, tools: [...gate.denied], blocked: true })
    }
    const executed = Array.from(new Set((result.usedTools || []).map(String).filter((tool) => isWriteToolName(tool))))
    if (!executed.length) return false
    this.deps.logger?.error?.(`dsh-org-panel: ${employeeName} 在只读渠道执行了写工具（${executed.join('、')}），回复已拦下`)
    this.deps.events?.emit({ type: 'external.write.denied', at: Date.now(), platform: message.platform, adapterId: message.adapterId, conversationId: message.conversationId, employeeId, tools: executed, blocked: false })
    await this.reply(message, decision.companyChannelId, { kind: 'notice', text: `这条消息来自只读渠道，${employeeName} 尝试执行的写操作（${executed.join('、')}）不被允许，这次回复已被拦下。` })
    return true
  }

  private async reply(message: ExternalMessage, companyChannelId: string | undefined, outgoing: OutgoingMessage): Promise<void> {
    const payload: OutgoingMessage = { ...outgoing, replyToMessageId: outgoing.replyToMessageId || message.id, threadId: outgoing.threadId || message.threadId }
    const sent = await this.deps.gateway.send(message.adapterId, message.conversationId, payload)
    const at = Date.now()
    this.pushTimeline({
      id: `${message.id}:out:${this.timelineEntries.length}`, at, direction: 'out', platform: message.platform, adapterId: message.adapterId,
      conversationId: message.conversationId, conversationName: message.conversationName, companyChannelId,
      employeeId: payload.employeeId, employeeName: payload.employeeName, text: payload.text,
      attachments: payload.attachments?.length || 0, permissionMode: message.permissionMode,
    })
    if (!sent) return
    this.deps.events?.emit({
      type: 'external.message.sent', at, platform: message.platform, adapterId: message.adapterId, conversationId: message.conversationId,
      companyChannelId, employeeId: payload.employeeId, employeeName: payload.employeeName, text: payload.text, kind: payload.kind || 'notice',
    })
  }

  private pushTimeline(entry: TimelineEntry): void {
    this.timelineEntries.push(entry)
    if (this.timelineEntries.length > TIMELINE_LIMIT) this.timelineEntries.splice(0, this.timelineEntries.length - TIMELINE_LIMIT)
  }
}

/** 平台 → TaskHistory.source（持久化层口径）。 */
export function taskSourceOf(platform: string): TaskSource {
  return platform === 'feishu' || platform === 'qq' || platform === 'wechat' || platform === 'web' ? platform : 'system'
}
