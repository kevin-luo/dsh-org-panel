// WorkSessionStore：赛博公司的共享协作上下文。
//
// Employee TaskHistory 记录“某位员工做了什么”；本文件记录“这一群员工为什么一起工作、
// 任务来自哪个真实会话、谁参与、每轮公开交付是什么”。两边通过 taskId 关联。
//
// 这份数据独立于 evolution.json：员工长期成长与公司协作会话是两个生命周期，混在同一文件
// 会让个人档案承担 transport / 群聊 / 项目上下文职责，也会放大迁移和锁竞争。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { TaskOutcome, TaskSource } from '../persistence/types'

export const WORK_SESSION_VERSION = 1
export const WORK_SESSION_LIMITS = { sessions: 120, messages: 240, turns: 360, participants: 24 }

export type WorkSessionStatus = 'active' | 'blocked' | 'completed'

export type WorkSessionOrigin = {
  source: TaskSource
  platform: string
  channelId?: string
  conversationId?: string
  threadId?: string
  senderId?: string
  senderName?: string
}

export type WorkSessionParticipant = {
  employeeId: string
  employeeName: string
  role: string
  reason: string
  joinedAt: number
  lastActiveAt: number
}

export type WorkSessionMessage = {
  id: string
  at: number
  messageId?: string
  senderId?: string
  senderName?: string
  text: string
}

export type WorkSessionTurn = {
  id: string
  at: number
  employeeId: string
  employeeName: string
  role: string
  reply: string
  outcome: TaskOutcome
  taskId?: string
  tools: string[]
  policyViolation: boolean
}

export type WorkSession = {
  id: string
  key: string
  goal: string
  status: WorkSessionStatus
  origin: WorkSessionOrigin
  participants: WorkSessionParticipant[]
  messages: WorkSessionMessage[]
  turns: WorkSessionTurn[]
  createdAt: number
  updatedAt: number
}

type WorkSessionFile = {
  version: 1
  sessions: Record<string, WorkSession>
}

export type WorkSessionOpenInput = WorkSessionOrigin & {
  key: string
  goal: string
  messageId?: string
  messageText?: string
}

function now() { return Date.now() }
function uid(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function text(value: unknown): string | undefined { const out = typeof value === 'string' ? value.trim() : ''; return out || undefined }
function list(value: unknown): string[] { return Array.isArray(value) ? Array.from(new Set(value.map(String).map((item) => item.trim()).filter(Boolean))) : [] }
function stamp(value: unknown, fallback: number): number { const out = Number(value); return Number.isFinite(out) && out > 0 ? out : fallback }

function sanitizeOrigin(raw: any, fallbackSource: TaskSource = 'system'): WorkSessionOrigin {
  return {
    source: ['web', 'feishu', 'qq', 'wechat', 'system'].includes(String(raw?.source)) ? raw.source : fallbackSource,
    platform: text(raw?.platform) || String(raw?.source || fallbackSource),
    channelId: text(raw?.channelId),
    conversationId: text(raw?.conversationId),
    threadId: text(raw?.threadId),
    senderId: text(raw?.senderId),
    senderName: text(raw?.senderName),
  }
}

function sanitizeSession(raw: any, key: string, time: number): WorkSession | null {
  if (!raw || typeof raw !== 'object') return null
  const id = text(raw.id) || uid('work')
  const goal = text(raw.goal)
  if (!goal) return null
  const createdAt = stamp(raw.createdAt, time)
  const participants: WorkSessionParticipant[] = (Array.isArray(raw.participants) ? raw.participants : []).map((item: any) => ({
    employeeId: text(item?.employeeId) || '', employeeName: text(item?.employeeName) || text(item?.employeeId) || '', role: text(item?.role) || '',
    reason: text(item?.reason) || '历史参与者', joinedAt: stamp(item?.joinedAt, createdAt), lastActiveAt: stamp(item?.lastActiveAt, createdAt),
  })).filter((item: WorkSessionParticipant) => item.employeeId).slice(-WORK_SESSION_LIMITS.participants)
  const messages: WorkSessionMessage[] = (Array.isArray(raw.messages) ? raw.messages : []).map((item: any) => ({
    id: text(item?.id) || uid('msg'), at: stamp(item?.at, createdAt), messageId: text(item?.messageId), senderId: text(item?.senderId),
    senderName: text(item?.senderName), text: text(item?.text) || '',
  })).filter((item: WorkSessionMessage) => item.text).slice(-WORK_SESSION_LIMITS.messages)
  const turns: WorkSessionTurn[] = (Array.isArray(raw.turns) ? raw.turns : []).map((item: any) => ({
    id: text(item?.id) || uid('turn'), at: stamp(item?.at, createdAt), employeeId: text(item?.employeeId) || '', employeeName: text(item?.employeeName) || '',
    role: text(item?.role) || '', reply: text(item?.reply) || '',
    outcome: ['success', 'partial', 'blocked', 'failed'].includes(String(item?.outcome)) ? item.outcome : 'partial',
    taskId: text(item?.taskId), tools: list(item?.tools), policyViolation: item?.policyViolation === true,
  })).filter((item: WorkSessionTurn) => item.employeeId).slice(-WORK_SESSION_LIMITS.turns)
  return {
    id, key, goal,
    status: ['active', 'blocked', 'completed'].includes(String(raw.status)) ? raw.status : 'active',
    origin: sanitizeOrigin(raw.origin), participants, messages, turns,
    createdAt, updatedAt: stamp(raw.updatedAt, createdAt),
  }
}

export class WorkSessionStore {
  readonly filePath: string
  private state: WorkSessionFile = { version: 1, sessions: {} }
  private loaded: Promise<void> | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(filePath?: string) {
    this.filePath = filePath || process.env.DSH_ORG_PANEL_WORK_SESSION_FILE || join(homedir(), '.dsh-org-panel', 'work-sessions.json')
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loaded) this.loaded = this.load()
    return this.loaded
  }

  private async load(): Promise<void> {
    let raw = ''
    try { raw = await readFile(this.filePath, 'utf-8') } catch { return }
    if (!raw.trim()) return
    try {
      const parsed = JSON.parse(raw)
      const time = now()
      const sessions: Record<string, WorkSession> = {}
      for (const [key, value] of Object.entries(parsed?.sessions || {})) {
        const session = sanitizeSession(value, key, time)
        if (session) sessions[key] = session
      }
      this.state = { version: WORK_SESSION_VERSION, sessions }
      this.trimSessions()
    } catch {
      // 协作上下文损坏时不允许下一次写入覆盖原文件。与员工档案相比它可重建，但仍是用户历史。
      throw new Error(`${this.filePath} 解析失败。为避免覆盖历史工作组，本次运行拒绝写入；请先手动备份或修复该文件。`)
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.tmp`
    await writeFile(temp, JSON.stringify(this.state, null, 2), 'utf-8')
    await rename(temp, this.filePath)
  }

  private mutate<T>(work: () => T | Promise<T>): Promise<T> {
    let resolveResult: (value: T | PromiseLike<T>) => void = () => undefined
    let rejectResult: (reason?: unknown) => void = () => undefined
    const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
    this.queue = this.queue.then(async () => {
      try {
        await this.ensureLoaded()
        const value = await work()
        this.trimSessions()
        await this.persist()
        resolveResult(value)
      } catch (error) { rejectResult(error) }
    })
    return result
  }

  private trimSessions(): void {
    const rows = Object.values(this.state.sessions).sort((a, b) => b.updatedAt - a.updatedAt)
    const keep = new Set(rows.slice(0, WORK_SESSION_LIMITS.sessions).map((item) => item.key))
    for (const key of Object.keys(this.state.sessions)) if (!keep.has(key)) delete this.state.sessions[key]
  }

  async getByKey(key: string): Promise<WorkSession | null> {
    await this.ensureLoaded()
    return this.state.sessions[key] ? clone(this.state.sessions[key]) : null
  }

  async get(id: string): Promise<WorkSession | null> {
    await this.ensureLoaded()
    const session = Object.values(this.state.sessions).find((item) => item.id === id)
    return session ? clone(session) : null
  }

  async open(input: WorkSessionOpenInput): Promise<WorkSession> {
    return this.mutate(() => {
      const key = String(input.key || '').trim()
      const goal = String(input.goal || '').trim()
      if (!key || !goal) throw new Error('WorkSession requires key + goal')
      const time = now()
      let session = this.state.sessions[key]
      if (!session) {
        session = {
          id: uid('work'), key, goal, status: 'active', origin: sanitizeOrigin(input, input.source),
          participants: [], messages: [], turns: [], createdAt: time, updatedAt: time,
        }
        this.state.sessions[key] = session
      } else {
        session.goal = goal
        session.status = 'active'
        session.origin = { ...session.origin, ...sanitizeOrigin(input, session.origin.source) }
        session.updatedAt = time
      }
      const messageText = text(input.messageText)
      const messageId = text(input.messageId)
      const duplicate = messageId && session.messages.some((item) => item.messageId === messageId)
      if (messageText && !duplicate) {
        session.messages.push({ id: uid('msg'), at: time, messageId, senderId: text(input.senderId), senderName: text(input.senderName), text: messageText })
        session.messages = session.messages.slice(-WORK_SESSION_LIMITS.messages)
      }
      return clone(session)
    })
  }

  async join(sessionId: string, input: Omit<WorkSessionParticipant, 'joinedAt' | 'lastActiveAt'>): Promise<WorkSession> {
    return this.mutate(() => {
      const session = Object.values(this.state.sessions).find((item) => item.id === sessionId)
      if (!session) throw new Error(`unknown work session: ${sessionId}`)
      const time = now()
      const existing = session.participants.find((item) => item.employeeId === input.employeeId)
      if (existing) {
        existing.employeeName = input.employeeName || existing.employeeName
        existing.role = input.role || existing.role
        existing.reason = input.reason || existing.reason
        existing.lastActiveAt = time
      } else {
        session.participants.push({ ...input, joinedAt: time, lastActiveAt: time })
        session.participants = session.participants.slice(-WORK_SESSION_LIMITS.participants)
      }
      session.updatedAt = time
      return clone(session)
    })
  }

  async appendTurn(sessionId: string, turn: Omit<WorkSessionTurn, 'id' | 'at'> & { at?: number }): Promise<WorkSessionTurn> {
    return this.mutate(() => {
      const session = Object.values(this.state.sessions).find((item) => item.id === sessionId)
      if (!session) throw new Error(`unknown work session: ${sessionId}`)
      const at = stamp(turn.at, now())
      const row: WorkSessionTurn = { id: uid('turn'), at, employeeId: turn.employeeId, employeeName: turn.employeeName, role: turn.role, reply: turn.reply, outcome: turn.outcome, taskId: turn.taskId, tools: list(turn.tools), policyViolation: turn.policyViolation === true }
      session.turns.push(row)
      session.turns = session.turns.slice(-WORK_SESSION_LIMITS.turns)
      const participant = session.participants.find((item) => item.employeeId === turn.employeeId)
      if (participant) participant.lastActiveAt = at
      session.updatedAt = at
      if (turn.outcome === 'blocked' || turn.policyViolation) session.status = 'blocked'
      return clone(row)
    })
  }

  async setStatus(sessionId: string, status: WorkSessionStatus): Promise<void> {
    await this.mutate(() => {
      const session = Object.values(this.state.sessions).find((item) => item.id === sessionId)
      if (!session) throw new Error(`unknown work session: ${sessionId}`)
      session.status = status
      session.updatedAt = now()
    })
  }

  async recent(limit = 20): Promise<WorkSession[]> {
    await this.ensureLoaded()
    return clone(Object.values(this.state.sessions).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.max(1, Math.min(100, Number(limit) || 20))))
  }
}
