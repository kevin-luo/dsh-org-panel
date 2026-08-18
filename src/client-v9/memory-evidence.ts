// 「赛博公司」client 侧记忆证据 / 记忆分页的唯一取数口（需求文档六十条第一、二句 + 四十四条）。
//
// 要解决的问题很具体：记忆确实写进了 evolution.json，digest 也确实注入了子代理，
// 但老板在回答现场看不到任何「这次用到了历史」的痕迹，于是「这次没踩坑」永远无法归因给系统。
// 持久化做得再好，感受也不会产生。这个模块负责把 host 的**注入台账**搬到屏幕上。
//
// 四条底线（一条都不许为了好看而破）：
//   1. 只显示 host 台账里那批**真实注入过**的 id 回查出来的条目。
//      不按相关度现编，不显示「可能相关的记忆」，不拿快照里的记忆凑数。
//   2. 注入 0 条 ⇒ 不显示 chip，而不是显示一个「0 条」的 chip。
//   3. 通道不通 / 台账里查不到 ⇒ 同样不显示 chip，绝不退化成 0。
//      「读不到」与「没有」在内部是两个状态（unavailable / none），只是都不产生任何断言。
//   4. 记忆分页一页 10 条，走 host 的 memory/page；没有通道就回落到「快照里带回来的那几条」，
//      并如实说明还有多少条没下发（文档四十四条：不要一次加载全部 120 条）。
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { EmployeeMemory, MemoryKind, TaskOutcome } from '../persistence/types'
import { extractText, messageSource, parseStaffMarker, settlementEvent } from './selectors'
import { callOrgPanel, currentOrgPanelRpc, NO_CONNECTION, outcomeMessage, type OrgPanelRpc } from './rpc'

/** 与 host 侧 src/host/org-panel-memory.ts 的 memoryEndpoints() 一一对应。 */
export const MEMORY_ENDPOINTS = {
  page: 'memory/page',
  evidence: 'memory/evidence',
} as const

/** 记忆分页每页条数。改这里等于改一次 RPC 的体量，别往大了调。 */
export const MEMORY_PAGE_SIZE = 10

// ---------------------------------------------------------------------------
// 线上结构（host 的返回形状；这里只做校验，不做补全）
// ---------------------------------------------------------------------------

export type MemoryEvidenceItem = {
  id: string
  type: 'memory' | 'reflection'
  text: string
  createdAt: number
  updatedAt?: number
  kind?: MemoryKind
  outcome?: TaskOutcome
  tags?: string[]
  /** 来源任务：复盘自带；记忆没有结构化来源就是 undefined，UI 显示「来源任务未知」。 */
  sourceTask?: string
}

export type MemoryInjectionRecord = {
  id: string
  employeeId: string
  query: string
  injectedAt: number
  memoryIds: string[]
  reflectionIds: string[]
  taskId?: string
  childId?: string
}

export type MemoryEvidenceView = {
  injection: MemoryInjectionRecord
  items: MemoryEvidenceItem[]
  /** 台账里有 id、但档案里已经查不到的条数（被 STORE_LIMITS 淘汰）。如实显示，不并进 items。 */
  missing: number
}

/**
 * 一条员工消息的证据状态。
 *   idle        —— 还没查过；
 *   loading     —— 正在查；
 *   unavailable —— 压根没有 client↔host 通道，或频道没应答（**不是**「没有记忆」）；
 *   none        —— 查到了，host 说这一轮没有台账 / 注入 0 条；
 *   ok          —— 拿到真实台账。
 * 除 ok 且 items 非空之外，一律不产生任何 UI 断言。
 */
export type MemoryEvidenceState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'unavailable'; message: string }
  | { state: 'none' }
  | { state: 'ok'; view: MemoryEvidenceView }

const IDLE: MemoryEvidenceState = { state: 'idle' }
const LOADING: MemoryEvidenceState = { state: 'loading' }
const NONE: MemoryEvidenceState = { state: 'none' }

function readItem(raw: any): MemoryEvidenceItem | null {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  const type = raw.type === 'reflection' ? 'reflection' : raw.type === 'memory' ? 'memory' : null
  // id / 正文 / 类型缺一不可：认不出来的条目宁可丢掉，也不摆一条来路不明的「证据」。
  if (!id || !text || !type) return null
  return {
    id,
    type,
    text,
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : 0,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) && Number(raw.updatedAt) > 0 ? Number(raw.updatedAt) : undefined,
    kind: typeof raw.kind === 'string' ? (raw.kind as MemoryKind) : undefined,
    outcome: typeof raw.outcome === 'string' ? (raw.outcome as TaskOutcome) : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean) : undefined,
    sourceTask: typeof raw.sourceTask === 'string' && raw.sourceTask.trim() ? raw.sourceTask.trim() : undefined,
  }
}

export function readEvidenceView(raw: any): MemoryEvidenceView | null {
  const injection = raw?.injection
  if (!injection || typeof injection.id !== 'string' || !injection.id) return null
  const items: MemoryEvidenceItem[] = []
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    const item = readItem(entry)
    if (item) items.push(item)
  }
  return {
    injection: {
      id: injection.id,
      employeeId: String(injection.employeeId || ''),
      query: typeof injection.query === 'string' ? injection.query : '',
      injectedAt: Number.isFinite(Number(injection.injectedAt)) ? Number(injection.injectedAt) : 0,
      memoryIds: Array.isArray(injection.memoryIds) ? injection.memoryIds.map(String) : [],
      reflectionIds: Array.isArray(injection.reflectionIds) ? injection.reflectionIds.map(String) : [],
      taskId: typeof injection.taskId === 'string' ? injection.taskId : undefined,
      childId: typeof injection.childId === 'string' ? injection.childId : undefined,
    },
    items,
    missing: Math.max(0, Math.floor(Number(raw.missing) || 0)),
  }
}

// ---------------------------------------------------------------------------
// 证据缓存：一条员工消息 = 一个 (employeeId, childId) 键，同一次注入只打一次 RPC
// ---------------------------------------------------------------------------

const cache = new Map<string, MemoryEvidenceState>()
const inflight = new Set<string>()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of [...listeners]) {
    try { listener() } catch { /* 单个订阅者出错不许拖垮其它消息的渲染 */ }
  }
}

export function evidenceKey(employeeId: string, childId: string): string {
  return `${employeeId}|${childId}`
}

export function readMemoryEvidence(employeeId: string, childId: string): MemoryEvidenceState {
  if (!employeeId || !childId) return IDLE
  return cache.get(evidenceKey(employeeId, childId)) || IDLE
}

/** 测试与热重载用：清空缓存。 */
export function resetMemoryEvidence(): void {
  cache.clear()
  inflight.clear()
  emit()
}

/**
 * 取一次证据。同一个键只打一次，失败也记住结果 —— 通道不通的时候反复重试
 * 只会把浏览器变成一台永远敲不开门的泵，屏幕上还是什么都不会多出来。
 */
export function ensureMemoryEvidence(employeeId: string, childId: string, rpc?: OrgPanelRpc | null): void {
  if (!employeeId || !childId) return
  const key = evidenceKey(employeeId, childId)
  if (cache.has(key) || inflight.has(key)) return
  const channel = rpc === undefined ? currentOrgPanelRpc() : rpc
  if (!channel) {
    cache.set(key, { state: 'unavailable', message: NO_CONNECTION })
    emit()
    return
  }
  inflight.add(key)
  cache.set(key, LOADING)
  emit()
  void callOrgPanel<{ injections?: unknown }>(channel, MEMORY_ENDPOINTS.evidence, { employeeId, childId, limit: 1 })
    .then((outcome) => {
      if (outcome.state !== 'ok') {
        cache.set(key, { state: 'unavailable', message: outcomeMessage(outcome) })
        return
      }
      const rows = Array.isArray((outcome.value as any)?.injections) ? (outcome.value as any).injections : []
      const view = rows.length ? readEvidenceView(rows[0]) : null
      cache.set(key, view ? { state: 'ok', view } : NONE)
    })
    .catch(() => { cache.set(key, { state: 'unavailable', message: NO_CONNECTION }) })
    .then(() => { inflight.delete(key); emit() })
}

const subscribeEvidence = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

/** React 订阅口。employeeId / childId 任一为空就永远是 idle（不打请求，也不显示任何东西）。 */
export function useMemoryEvidence(employeeId: string, childId: string): MemoryEvidenceState {
  const read = useCallback(() => readMemoryEvidence(employeeId, childId), [employeeId, childId])
  const state = useSyncExternalStore(subscribeEvidence, read, () => IDLE)
  useEffect(() => { ensureMemoryEvidence(employeeId, childId) }, [employeeId, childId])
  return state
}

// ---------------------------------------------------------------------------
// 消息 → childId
// ---------------------------------------------------------------------------

/**
 * 从一条员工消息的原始会话节点里认出子代理 childId —— host 的注入台账就是按它归档的。
 * 三条真实链路：
 *   · 子代理结算事件（Background subagent <id> finished…）；
 *   · source.kind='subagent-settled' 的回话节点；
 *   · staff_chat 的 tool-result 标记 [[NIUMA_STAFF … child="…"]]。
 * 认不出来就返回空串 —— 那条消息不显示 chip，而不是随便挂一次别人的注入记录上去。
 * （会议发言暂时属于「认不出来」：staff_meeting 的结果里没有逐人 childId。）
 */
export function childIdOfNode(node: any): string {
  if (!node) return ''
  const settled = settlementEvent(node)
  if (settled?.childId) return settled.childId
  const source = messageSource(node)
  if (source?.kind === 'subagent-settled' && source.senderSessionId) return String(source.senderSessionId)
  if (node.kind === 'tool-result') {
    const marker = parseStaffMarker(extractText(node.content))
    if (marker?.childId) return marker.childId
  }
  return ''
}

// ---------------------------------------------------------------------------
// 记忆分页加载器（实现 EmployeeProfile 的 MemoryLoader 契约）
// ---------------------------------------------------------------------------

export type MemoryPageQuery = { employeeId: string; kind: MemoryKind; offset: number; limit: number }
export type MemoryPage = { items: EmployeeMemory[]; total: number; hasMore: boolean }

function readMemory(raw: any): EmployeeMemory | null {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (typeof raw.text !== 'string' || !raw.text.trim()) return null
  return {
    id: raw.id,
    employeeId: String(raw.employeeId || ''),
    kind: String(raw.kind || 'lesson') as MemoryKind,
    text: raw.text,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    importance: Number(raw.importance) || 0,
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
    lastUsedAt: Number(raw.lastUsedAt) || 0,
    useCount: Number(raw.useCount) || 0,
  }
}

/**
 * 真实分页加载器。拿不到通道就返回 null —— 档案会保持「还有 N 条未下发」的如实说明，
 * 而不是假装已经全部显示。失败一律抛真实原因，由档案红字显示，不静默当成空页。
 */
export function createMemoryLoader(rpc?: OrgPanelRpc | null): ((query: MemoryPageQuery) => Promise<MemoryPage>) | null {
  const channel = rpc === undefined ? currentOrgPanelRpc() : rpc
  if (!channel) return null
  return async (query: MemoryPageQuery): Promise<MemoryPage> => {
    const outcome = await callOrgPanel<any>(channel, MEMORY_ENDPOINTS.page, {
      employeeId: query.employeeId,
      kind: query.kind,
      offset: Math.max(0, Math.floor(query.offset) || 0),
      limit: Math.max(1, Math.min(Math.floor(query.limit) || MEMORY_PAGE_SIZE, 30)),
    })
    if (outcome.state !== 'ok') throw new Error(outcomeMessage(outcome))
    const value = outcome.value || {}
    const items: EmployeeMemory[] = []
    for (const entry of Array.isArray(value.items) ? value.items : []) {
      const memory = readMemory(entry)
      if (memory) items.push(memory)
    }
    return {
      items,
      total: Math.max(0, Math.floor(Number(value.total) || 0)),
      hasMore: value.hasMore === true,
    }
  }
}

// ---------------------------------------------------------------------------
// 样式：主布局 styles.ts 属于别的模块，这里自带一份幂等注入，互不干扰
// ---------------------------------------------------------------------------

const EVIDENCE_STYLE_ID = 'dsh-org-panel-cy9-memory-evidence'

export const MEMORY_EVIDENCE_CSS = String.raw`
.cy9-mem-chip-wrap{position:relative;margin-top:6px}
.cy9-mem-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border:1px solid rgba(163,107,255,.38);border-radius:999px;background:rgba(163,107,255,.1);color:#e6dcff;font-size:10px;line-height:1.5;cursor:pointer}
.cy9-mem-chip:hover{border-color:rgba(163,107,255,.7)}
.cy9-mem-chip i{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--violet,#a36bff);font-style:normal}
.cy9-mem-pop{position:absolute;left:0;top:calc(100% + 6px);z-index:40;width:min(460px,82vw);max-height:320px;overflow:auto;padding:10px;border:1px solid rgba(163,107,255,.34);border-radius:9px;background:#0b1220;box-shadow:0 18px 44px rgba(0,0,0,.6)}
.cy9-mem-pop>header{display:flex;align-items:baseline;gap:6px;margin-bottom:8px;color:var(--muted,#93a4bf);font-size:9px}
.cy9-mem-pop>header b{color:#dff8ff;font-size:10px}
.cy9-mem-row{padding:7px 8px;border:1px solid var(--line,rgba(255,255,255,.08));border-radius:7px;background:rgba(255,255,255,.02)}
.cy9-mem-row+.cy9-mem-row{margin-top:6px}
.cy9-mem-row>p{margin:0 0 5px;font-size:10px;line-height:1.65;white-space:pre-wrap;word-break:break-word}
.cy9-mem-row>div{display:flex;flex-wrap:wrap;gap:6px;color:var(--dim,#64748b);font-size:9px}
.cy9-mem-row em{font-style:normal;color:var(--cyan,#43d9ff)}
.cy9-mem-tag{padding:1px 5px;border:1px solid rgba(163,107,255,.3);border-radius:4px;color:#cbb6ff}
.cy9-mem-note{margin:8px 0 0;color:var(--dim,#64748b);font-size:9px;line-height:1.6}
`

/** 幂等注入。多次调用只会插一次 <style>。 */
export function installMemoryEvidenceStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(EVIDENCE_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = EVIDENCE_STYLE_ID
  style.textContent = MEMORY_EVIDENCE_CSS
  document.head.appendChild(style)
}

installMemoryEvidenceStyles()
