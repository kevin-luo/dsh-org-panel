// 外部通讯 Work Router：只负责 transport 安全边界、会话串行与回信。
// 员工选择、多人组队、共享上下文、动态 @ 入场全部交给 Work Orchestrator。
import type { WorkRequest, WorkResult } from '../../collaboration/work-orchestrator'
import { IMGateway } from './gateway'
import {
  allowsWrite, createWriteGate,
  type ChannelBinding, type CommunicationEventSink, type CommunicationLogger,
  type ExternalMessage, type OutgoingMessage, type RosterEntry, type TaskSource, type TimelineEntry,
} from './types'

const TIMELINE_LIMIT = 200
export type WorkDispatcher = (request: WorkRequest) => Promise<WorkResult>

type WorkRouterDeps = {
  gateway: IMGateway
  roster: RosterEntry[]
  bindings?: ChannelBinding[]
  dispatcher?: WorkDispatcher
  logger?: CommunicationLogger
  events?: CommunicationEventSink
}

export class WorkRouter {
  private roster: RosterEntry[]
  private bindings: ChannelBinding[]
  private dispatcher: WorkDispatcher | null
  private readonly timelineEntries: TimelineEntry[] = []
  private readonly queues = new Map<string, Promise<void>>()
  private warnedMissingRuntime = false

  constructor(private readonly deps: WorkRouterDeps) {
    this.roster = deps.roster
    this.bindings = deps.bindings || []
    this.dispatcher = deps.dispatcher || null
  }

  setDispatcher(dispatcher: WorkDispatcher | null): void { this.dispatcher = dispatcher }
  setRoster(roster: RosterEntry[]): void { this.roster = roster }
  setBindings(bindings: ChannelBinding[]): void { this.bindings = bindings }
  hasDispatcher(): boolean { return !!this.dispatcher }
  timeline(limit = 50): TimelineEntry[] { return this.timelineEntries.slice(-Math.max(1, Math.min(TIMELINE_LIMIT, limit))) }
  employeeById(employeeId: string): RosterEntry | undefined { return this.roster.find((item) => item.id === employeeId) }
  channelIdFor(adapterId: string, conversationId: string): string | undefined {
    return this.bindings.find((item) => item.adapterId === adapterId && item.externalConversationId === conversationId)?.companyChannelId
  }

  /** 同一外部会话严格串行，直到真实员工执行和回信全部结束。 */
  handle(message: ExternalMessage): Promise<void> {
    const key = `${message.adapterId}:${message.conversationId}`
    const previous = this.queues.get(key) || Promise.resolve()
    const next = previous.then(() => this.process(message)).catch((error) => {
      this.deps.logger?.error?.(`dsh-org-panel: 外部工作组处理异常：${error instanceof Error ? error.message : String(error)}`)
    })
    this.queues.set(key, next)
    void next.then(() => { if (this.queues.get(key) === next) this.queues.delete(key) })
    return next
  }

  private allowedEmployees(message: ExternalMessage): string[] | undefined {
    const config = this.deps.gateway.configOf(message.adapterId)
    return config?.access.conversations.find((item) => item.conversationId === message.conversationId)?.allowedEmployees
  }

  private normalizedTask(message: ExternalMessage): string {
    const text = String(message.text || '').trim()
    const mentions = (message.mentions || []).map((item) => String(item).trim()).filter(Boolean).map((item) => item.startsWith('@') ? item : `@${item}`)
    const missingMentions = mentions.filter((mention) => !text.includes(mention) && !text.includes(mention.slice(1)))
    if (text) return missingMentions.length ? `${missingMentions.join(' ')}\n${text}` : text
    if (message.attachments.length) return `请处理这条消息附带的 ${message.attachments.length} 个附件。`
    return ''
  }

  private async process(message: ExternalMessage): Promise<void> {
    const config = this.deps.gateway.configOf(message.adapterId)
    const companyChannelId = this.channelIdFor(message.adapterId, message.conversationId)
    const task = this.normalizedTask(message)

    this.pushTimeline({
      id: message.id, at: message.createdAt || Date.now(), direction: 'in', platform: message.platform, adapterId: message.adapterId,
      conversationId: message.conversationId, conversationName: message.conversationName, companyChannelId,
      senderName: message.senderName || message.senderId, text: message.text, attachments: message.attachments.length, permissionMode: message.permissionMode,
    })
    this.deps.events?.emit({
      type: 'external.message.received', at: Date.now(), platform: message.platform, adapterId: message.adapterId,
      conversationId: message.conversationId, companyChannelId, messageId: message.id,
      senderId: message.senderId, senderName: message.senderName, text: message.text, attachments: message.attachments,
      actorRole: message.actorRole, permissionMode: message.permissionMode,
    })

    if (!this.dispatcher) {
      if (!this.warnedMissingRuntime) {
        this.warnedMissingRuntime = true
        this.deps.logger?.warn?.('dsh-org-panel: Work Orchestrator 未接线，外部消息已记录但无法执行')
      }
      if (config?.routing.notifyUndeliverable !== false) await this.reply(message, companyChannelId, { kind: 'system', text: '赛博公司当前没有可用的工作调度运行时，这条消息已记录但还不能执行。' })
      return
    }

    const gate = createWriteGate(allowsWrite(message.permissionMode))
    let result: WorkResult
    try {
      result = await this.dispatcher({
        task,
        source: taskSourceOf(message.platform),
        platform: message.platform,
        channelId: companyChannelId || message.conversationId,
        conversationId: message.conversationId,
        messageId: message.id,
        threadId: message.threadId,
        senderId: message.senderId,
        senderName: message.senderName || message.senderId,
        permissionMode: message.permissionMode,
        attachments: message.attachments,
        allowedEmployeeIds: this.allowedEmployees(message),
        maxTeam: config?.routing.maxWorkgroupSize,
        writePolicy: { allowed: gate.allowed, isWriteTool: gate.isWriteTool },
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.deps.logger?.warn?.(`dsh-org-panel: 外部工作组启动失败：${detail}`)
      if (config?.routing.notifyUndeliverable !== false) await this.reply(message, companyChannelId, { kind: 'notice', text: `这次任务没能启动：${detail}` })
      return
    }

    let visibleReplies = 0
    for (const turn of result.details) {
      if (turn.policyViolation) {
        const writes = turn.tools.filter((tool) => gate.isWriteTool(tool))
        this.deps.events?.emit({ type: 'external.write.denied', at: Date.now(), platform: message.platform, adapterId: message.adapterId, conversationId: message.conversationId, employeeId: turn.staffId, tools: writes, blocked: false })
        await this.reply(message, companyChannelId, { kind: 'notice', text: `这条消息来自只读渠道，${turn.staffName} 本轮观测到写操作（${writes.join('、') || '未知写工具'}），该员工回复已被拦下。` })
        continue
      }
      if (!turn.reply.trim()) continue
      visibleReplies += 1
      await this.reply(message, companyChannelId, { kind: 'employee-reply', text: turn.reply, employeeId: turn.staffId, employeeName: turn.staffName, employeeRole: turn.role })
    }

    if (!visibleReplies && result.details.length && config?.routing.notifyUndeliverable !== false) {
      const blocked = result.details.filter((item) => item.outcome === 'blocked' || item.error)
      if (blocked.length) await this.reply(message, companyChannelId, { kind: 'notice', text: `工作组本轮没有可公开的交付：${blocked.map((item) => `${item.staffName}${item.error ? `：${item.error}` : '被阻塞'}`).join('；')}` })
    }
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
    this.deps.events?.emit({ type: 'external.message.sent', at, platform: message.platform, adapterId: message.adapterId, conversationId: message.conversationId, companyChannelId, employeeId: payload.employeeId, employeeName: payload.employeeName, text: payload.text, kind: payload.kind || 'notice' })
  }

  private pushTimeline(entry: TimelineEntry): void {
    this.timelineEntries.push(entry)
    if (this.timelineEntries.length > TIMELINE_LIMIT) this.timelineEntries.splice(0, this.timelineEntries.length - TIMELINE_LIMIT)
  }
}

export function taskSourceOf(platform: string): TaskSource {
  return platform === 'feishu' || platform === 'qq' || platform === 'wechat' || platform === 'web' ? platform : 'system'
}
