// 「赛博公司」client 侧 host↔UI 桥接层。
//
// 解决需求文档 2.1 点名的 bug：打开一个全新的空 Session 时，工作台不能只剩本 Session 的
// Tool Event，必须能显示真实的历史成长数据（等级 / 经验 / 技能 / 插件 / 履历）。
//
// 【本文件此前基于一个错误前提】旧注释断言浏览器这一侧压根没办法主动调 host。
// 那个结论来自只读了 @deepseek-ai/dsh-client-ui-conversation，没查 dsh-client-connection，是错的。
// 实读源码后确认：client 侧 cordis Context 上有 `connection` 服务，`connection.rpc` 就是
// `createWebConnectionRpc()`，可以直接调 host 注册的 `/org-panel` 频道（详见 ./rpc.ts 的实读记录）。
//
// 所以 hydrate 现在有三条真实来源，本文件按**显式优先级**把它们接起来，一条都不伪造：
//   A. `/org-panel` RPC 实时读取（权威、此刻的真实状态，且空 Session 也能拿到）；
//   B. 本 Session 里 company_snapshot 工具真实跑过 → 从 tool-result 节点解析；
//   C. 上一次 A/B 命中时写进 localStorage 的同一份快照 → 冷启动兜底。
// 每一级都带来源标记并上屏（SOURCE_LABEL），不允许「悄悄降级」。
// 三者都没有 → 交出 null，各个面板显示 0 / — / 暂无 / 未知（文档四十八条），绝不编造数字。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CompanySnapshot, ModelProviderConfig } from '../persistence/types'
import type { InstallRequest } from '../capabilities/plugin-runtime'
import type { RoleDef, StaffDef } from './types'
import type { CompanySettingsActions, CompanySettingsData } from './settings/CompanySettings'
import type { ModelSettingsData } from './settings/ModelSettings'
import type { PluginSettingsData } from './settings/PluginSettings'
import type { CommunicationSettingsData } from './settings/CommunicationSettings'
import type { SecuritySettingsData } from './settings/SecuritySettings'
import type { StorageSettingsData } from './settings/StorageSettings'
import { applyCompanySnapshot, readCompanySnapshot, setCompanySnapshot, useCompanySnapshot } from './employee-profile/EmployeeProfile'
import { deriveCompanyEvents } from './selectors'
import { companyEventBus, HOST_CHANNEL, SESSION_CHANNEL } from '../runtime/event-bus'
import type { CompanyEvent } from '../runtime/company-events'
import { callOrgPanel, orgPanelWrite, outcomeMessage, type OrgPanelRpc, type RpcOutcome } from './rpc'

/** host 侧 host-v2.ts 注册的快照工具名。改名必须两边一起改。 */
export const SNAPSHOT_TOOL = 'company_snapshot'

const CACHE_KEY = 'dsh-org-panel:company-snapshot:v2'
/** 超过这个体积就不进 localStorage：宁可下次重新拉，也不要把老板的存储塞爆。 */
const CACHE_LIMIT = 2 * 1024 * 1024

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    // Safari 隐私模式 / 被策略禁用：当作没有缓存，不报错。
    return null
  }
}

/** 结构校验后再落缓存；坏数据不写盘，也不覆盖上一份好数据。 */
function isSnapshot(value: any): value is CompanySnapshot {
  return !!value && typeof value === 'object' && Number(value.version) === 2 && Array.isArray(value.employees)
}

export function readCachedSnapshot(): CompanySnapshot | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return isSnapshot(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeCachedSnapshot(snapshot: CompanySnapshot): void {
  const store = storage()
  if (!store) return
  try {
    const raw = JSON.stringify(snapshot)
    if (raw.length > CACHE_LIMIT) return
    store.setItem(CACHE_KEY, raw)
  } catch {
    // 配额满或被禁用：缓存只是加速手段，失败不影响本 Session 的真实数据。
  }
}

export function clearCachedSnapshot(): void {
  try { storage()?.removeItem(CACHE_KEY) } catch { /* 同上 */ }
}

function textOfNode(node: any): string {
  const blocks = node?.content
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const block of blocks) if (block && typeof block.text === 'string') parts.push(block.text)
  return parts.join('\n').trim()
}

/**
 * 从会话节点流里取出最近一次 company_snapshot 的真实结果。
 * 只认 company_snapshot 的成功 tool-result，其它工具一律不当快照用。
 */
export function extractCompanySnapshot(nodes: any[]): CompanySnapshot | null {
  let latest: CompanySnapshot | null = null
  for (const node of nodes || []) {
    if (node?.kind !== 'tool-result' || node.isError) continue
    if (String(node.call?.name || '') !== SNAPSHOT_TOOL) continue
    const text = textOfNode(node)
    if (!text) continue
    try {
      const parsed = JSON.parse(text)
      if (isSnapshot(parsed)) latest = parsed
    } catch {
      // 输出被截断或不是 JSON：跳过这一条，继续找更早的完整快照。
    }
  }
  return latest
}

// ---------------------------------------------------------------------------
// 数据来源标记：UI 必须如实告诉老板他看的这一屏是从哪儿来的
// ---------------------------------------------------------------------------

export type SnapshotSource = 'rpc' | 'session' | 'cache' | 'none'

export const SOURCE_LABEL: Record<SnapshotSource, string> = {
  rpc: '数据来自 host 实时读取（/org-panel）',
  session: '数据来自本会话的 company_snapshot 结果',
  cache: '数据来自本机缓存的上一份快照',
  none: '尚未取到任何真实数据',
}

/** RPC 通道的真实状态。unknown 表示「还没探测过」——那种时候一个字都不许下结论。 */
export type OrgPanelChannelState = 'unknown' | 'online' | 'offline'

export type CompanyHydration = {
  snapshot: CompanySnapshot | null
  source: SnapshotSource
  /** 兼容旧口径：true 表示当前这份来自 localStorage 缓存，而不是刚从 host / 本会话拿到的。 */
  cached: boolean
}

// ---------------------------------------------------------------------------
// `/org-panel` 只读端点
// ---------------------------------------------------------------------------

/** 与 host 侧 src/host/org-panel-read.ts 的 readEndpoints() 一一对应。 */
export const READ_ENDPOINTS = {
  /** host→client 事件增量。只有事件泵用它，不参与设置中心那一次并发拉取。 */
  events: 'events/since',
  snapshot: 'company/snapshot',
  approvals: 'plugins/approvals',
  health: 'plugins/health',
  communication: 'communication/summary',
  security: 'security/policy',
  models: 'models/providers',
  storage: 'storage/inventory',
} as const

/** 与 host 侧 src/host/org-panel-write.ts 的 writeEndpoints() 一一对应。全部是人类点击才会触发的动作。 */
export const WRITE_ENDPOINTS = {
  approve: 'plugins/approve',
  reject: 'plugins/reject',
  verify: 'plugins/verify',
  healthCheck: 'plugins/healthCheck',
  modelUpsert: 'models/upsert',
  modelRemove: 'models/remove',
  modelSetDefault: 'models/setDefault',
  modelTest: 'models/test',
  modelSetEnabled: 'models/setEnabled',
  modelBind: 'models/bind',
} as const

type ConsoleFetch = {
  snapshot: CompanySnapshot | null
  extra: CompanySettingsData
  channel: 'online' | 'offline'
  note: string
  errors: string[]
}

/**
 * host 的只读端点用 `{ available:false, reason }` 表示「这一项本次运行根本拿不到」
 * （比如插件运行时没挂上、Model Gateway 没挂上、cordis 里没有 communication 段）。
 *
 * 这跟「拿到了、结果是空」是两件完全不同的事，绝不能合并：
 * 前者必须把 host 给的真实原因原样显示，后者才配说「暂无」。
 * 合并的后果就是老板看到一句「未配置飞书」，而事实是通讯层压根没启动过。
 */
type Answer<T> = { value: T | null; reason: string }

function answerOf<T>(outcome: RpcOutcome<unknown>): Answer<T> {
  if (outcome.state !== 'ok') return { value: null, reason: outcome.state === 'unavailable' ? '' : outcomeMessage(outcome) }
  const value = outcome.value as any
  if (!value || typeof value !== 'object') return { value: (value ?? null) as T, reason: '' }
  if (value.available === false) return { value: null, reason: String(value.reason || 'host 说本次运行拿不到这一项，但没有给出原因。') }
  return { value: value as T, reason: '' }
}

/**
 * 一次把六个只读端点全拉回来。每个端点各自成败互不影响：
 * 拉到什么就显示什么，拉不到的那一块继续显示「未读取 / 未知」，绝不用别处的数据顶上。
 */
export async function fetchOrgPanel(rpc: OrgPanelRpc, signal?: AbortSignal): Promise<ConsoleFetch> {
  const [snapshot, approvals, health, communication, security, models, storageInfo] = await Promise.all([
    callOrgPanel<CompanySnapshot>(rpc, READ_ENDPOINTS.snapshot, {}, signal),
    callOrgPanel<InstallRequest[]>(rpc, READ_ENDPOINTS.approvals, {}, signal),
    callOrgPanel<PluginSettingsData['health']>(rpc, READ_ENDPOINTS.health, {}, signal),
    callOrgPanel<CommunicationSettingsData>(rpc, READ_ENDPOINTS.communication, {}, signal),
    callOrgPanel<SecuritySettingsData>(rpc, READ_ENDPOINTS.security, {}, signal),
    callOrgPanel<unknown>(rpc, READ_ENDPOINTS.models, {}, signal),
    callOrgPanel<StorageSettingsData>(rpc, READ_ENDPOINTS.storage, {}, signal),
  ])
  const outcomes: Array<[string, RpcOutcome<unknown>]> = [
    [READ_ENDPOINTS.snapshot, snapshot], [READ_ENDPOINTS.approvals, approvals], [READ_ENDPOINTS.health, health],
    [READ_ENDPOINTS.communication, communication], [READ_ENDPOINTS.security, security],
    [READ_ENDPOINTS.models, models], [READ_ENDPOINTS.storage, storageInfo],
  ]
  // 全部 unavailable 才算通道不通；只要有一个端点真的应答过，通道就是活的，剩下的失败按端点错误报。
  // 被取消的那些不算「应答过」—— 拿一次主动 abort 当「通道是通的」证据是自欺。
  const answered = outcomes.filter(([, outcome]) => outcome.state !== 'unavailable' && !(outcome.state === 'error' && outcome.code === 'aborted'))
  const channel: 'online' | 'offline' = answered.length ? 'online' : 'offline'
  const note = channel === 'offline'
    ? (outcomes[0][1].state === 'unavailable' ? outcomes[0][1].message : '')
    : ''
  const errors = answered
    .filter(([, outcome]) => outcome.state === 'error' && outcome.code !== 'aborted')
    .map(([endpoint, outcome]) => `${endpoint}：${outcomeMessage(outcome)}`)

  const extra: CompanySettingsData = {}

  // --- 插件：审批台账 + 健康检查（同属 plugins 段，合并成一个对象） -------------
  const approvalsAnswer = answerOf<{ requests?: InstallRequest[] } | InstallRequest[]>(approvals)
  const healthAnswer = answerOf<NonNullable<PluginSettingsData['health']>>(health)
  const pluginSection: PluginSettingsData = {}
  const requests = Array.isArray(approvalsAnswer.value)
    ? approvalsAnswer.value
    : Array.isArray(approvalsAnswer.value?.requests) ? approvalsAnswer.value!.requests : null
  if (requests) pluginSection.approvals = requests
  if (healthAnswer.value) {
    pluginSection.health = {
      checkedAt: healthAnswer.value.checkedAt,
      catalogSize: healthAnswer.value.catalogSize,
      changed: healthAnswer.value.changed,
    }
  }
  const pluginReason = approvalsAnswer.reason || healthAnswer.reason
  if (pluginReason) pluginSection.reason = pluginReason
  if (Object.keys(pluginSection).length) extra.plugins = pluginSection

  // --- 通讯：available:false 时**不**下发空 adapters 数组 ----------------------
  // 那会让通讯页把「没启动过」显示成「未配置」，是两件事。
  const commAnswer = answerOf<CommunicationSettingsData>(communication)
  if (commAnswer.value) extra.communication = Object.assign({}, commAnswer.value, { loaded: true })
  else if (commAnswer.reason) extra.communication = { reason: commAnswer.reason }

  const securityAnswer = answerOf<SecuritySettingsData>(security)
  if (securityAnswer.value) extra.security = Object.assign({}, securityAnswer.value, { loaded: true })

  // --- 模型：同理，Gateway 没挂上时不能显示成「一个供应商都没配」 ---------------
  const modelAnswer = answerOf<ModelSettingsData>(models)
  if (modelAnswer.value) extra.models = Object.assign({}, modelAnswer.value, { loaded: true })
  else if (modelAnswer.reason) extra.models = { reason: modelAnswer.reason }

  // --- 存储：真实路径 / 字节 / mtime，外加快照统计 -----------------------------
  const storageAnswer = answerOf<StorageSettingsData & { totals?: Record<string, number> }>(storageInfo)
  if (storageAnswer.value) {
    const totals = storageAnswer.value.totals || {}
    extra.storage = Object.assign({}, storageAnswer.value, {
      loaded: true,
      employees: totals.employees,
      memories: totals.memories,
      tasks: totals.tasks,
      skills: totals.skills,
    })
  }
  return {
    snapshot: snapshot.state === 'ok' && isSnapshot(snapshot.value) ? snapshot.value : null,
    extra,
    channel,
    note,
    errors,
  }
}

// ---------------------------------------------------------------------------
// host → client 事件泵
// ---------------------------------------------------------------------------
//
// companyEventBus 在 host bundle 与 browser bundle 里是**两个独立单例**（tsdown 两个 entry），
// host 侧 publish 的飞书来信 / 插件安装 / 识图事件不会自己飘进浏览器。
// 前台的 🔔、机房的装插件、多媒体工作台的识图这三套已经写好的视觉语言，
// 在接上这个泵之前于真实链路里全是死代码 —— 也就是说「我在飞书 @老王，
// 回复我的就是网页里那个老王」这件事，此前没有任何可见证明。
//
// DSH 的 RPC 契约是 unary，没有 server push，只能由 client 拉。三条自律：
//   1. **只拉增量**：带游标，host 只回 cursor 之后的事件。
//   2. **只在 Tab 可见时拉**：visibilitychange 一隐藏就停表，不在后台空转。
//   3. **退避**：空手而归就把间隔往上推，绝不为了「看起来实时」高频轮询。
// 以及一条底线：通道不可用时**一次都不重试、一条都不伪造**，办公室保持现有的会话推导行为。

/** 拉到新事件后的下一次间隔（ms）。真有事情发生时才用得上这个节奏。 */
export const HOST_EVENT_MIN_INTERVAL = 5000
/** 一直没有新事件时的间隔上限（ms）。稳态就是这个值。 */
export const HOST_EVENT_MAX_INTERVAL = 60000
/** 每空一次就把间隔乘上它。5s → 9s → 16.2s → 29.2s → 52.5s → 60s。 */
export const HOST_EVENT_BACKOFF = 1.8
/** 单次最多要多少条（host 侧还会再夹一次上限）。 */
export const HOST_EVENT_PAGE = 200
/** 连续这么多次「通道活着但这个端点报错」就彻底停表，不刷屏、不硬撑。 */
export const HOST_EVENT_MAX_ERRORS = 3

/** 停表原因。空串 = 还在跑。这些原因都要能原样写进日志/诊断，不许含糊成「出错了」。 */
export const PUMP_NO_RPC = '当前运行时没有 client↔host 通道，事件泵不启动'
export const PUMP_UNAVAILABLE = '/org-panel 频道没有应答，事件泵停表（办公室继续用会话推导，不伪造事件）'
export const PUMP_NO_ENDPOINT = 'host 不认识 events/since（版本较旧），事件泵停表'
export const PUMP_TOO_MANY_ERRORS = 'events/since 连续失败，事件泵停表'

type HostEventPageWire = {
  cursor?: unknown
  events?: unknown
  dropped?: unknown
  more?: unknown
}

/**
 * 只认形状合法的事件。host 是自己人，但「自己人发来的脏数据」照样会把 reducer 带歪，
 * 而办公室里一个错位的小人比没有小人更难排查。
 */
export function readEventPage(value: unknown): CompanyEvent[] {
  const raw = (value as HostEventPageWire)?.events
  if (!Array.isArray(raw)) return []
  const out: CompanyEvent[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const event = item as CompanyEvent
    if (typeof event.id !== 'string' || !event.id) continue
    if (typeof event.type !== 'string' || !event.type) continue
    if (typeof event.at !== 'number' || !Number.isFinite(event.at)) continue
    out.push(event)
  }
  return out
}

export type HostEventPumpDeps = {
  rpc: OrgPanelRpc | null | undefined
  /** 增量落地口，默认推进浏览器侧总线的 'host' 通道。 */
  publish?(events: CompanyEvent[]): void
  /** Tab 是否可见，默认读 document.visibilityState。 */
  visible?(): boolean
  /** 定时器注入口；测试用假时钟驱动，生产就是 setTimeout。 */
  setTimer?(fn: () => void, ms: number): any
  clearTimer?(handle: any): void
  /** 可见性变化订阅口，返回退订函数。默认挂 document 的 visibilitychange。 */
  onVisibility?(listener: () => void): () => void
}

export type HostEventPump = {
  /** 立刻拉一次。返回本次真正收下的事件数；-1 = 已停表或当前不可见，没有发出任何请求。 */
  pull(): Promise<number>
  /** 当前游标。0 = 一次都还没成功拉过。 */
  cursor(): number
  /** 下一次的间隔（ms）。 */
  interval(): number
  /** 停表原因；空串表示还在跑。 */
  stopped(): string
  /** 下一次拉取排队时用的延时（ms）；null = 根本没排队（页面隐藏 / 已停表 / 请求正在飞）。 */
  pending(): number | null
  stop(): void
}

const defaultVisible = (): boolean => {
  // 非浏览器环境（SSR / 单测）当作可见：这里判错的代价是多拉一次，而判反会让泵永远不跑。
  if (typeof document === 'undefined') return true
  return document.visibilityState !== 'hidden'
}

const defaultOnVisibility = (listener: () => void): (() => void) => {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {}
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}

/**
 * 建一台事件泵并立刻开始工作（可见时马上拉一次）。
 * 任何失败都不向上抛：拿不到就停表，办公室退回会话推导那条老路，行为与接泵之前逐字一致。
 */
export function createHostEventPump(deps: HostEventPumpDeps): HostEventPump {
  const publish = deps.publish || ((events: CompanyEvent[]) => companyEventBus.publishAll(events, HOST_CHANNEL))
  const visible = deps.visible || defaultVisible
  const setTimer = deps.setTimer || ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer || ((handle: any) => clearTimeout(handle))

  let cursor = 0
  let interval = HOST_EVENT_MIN_INTERVAL
  let stoppedReason = ''
  let timer: any = null
  let queuedAt: number | null = null
  let inflight = false

  const clear = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
    queuedAt = null
  }

  const schedule = (ms: number) => {
    if (stoppedReason || !visible()) return
    clear()
    queuedAt = ms
    timer = setTimer(() => { timer = null; queuedAt = null; void pull() }, ms)
  }

  const halt = (reason: string) => {
    stoppedReason = reason
    clear()
  }

  let errors = 0

  const pull = async (): Promise<number> => {
    if (stoppedReason) return -1
    // 页面隐藏就一次都不打：停表比「反正只是个小请求」重要，后台标签页不该替老板烧电。
    if (!visible()) { clear(); return -1 }
    if (inflight) return -1
    inflight = true
    try {
      const outcome = await callOrgPanel<HostEventPageWire>(deps.rpc, READ_ENDPOINTS.events, { cursor, limit: HOST_EVENT_PAGE })
      if (stoppedReason) return -1
      if (outcome.state === 'unavailable') {
        // 通道根本不通。**这里绝不重试**：重试改变不了部署形态，只会变成一台永远敲不开门的泵。
        halt(PUMP_UNAVAILABLE)
        return -1
      }
      if (outcome.state === 'error') {
        // 端点不存在（老 host）/ 参数不合法：再打一万次也是同一个答案。
        if (outcome.code === 'bad-request') { halt(PUMP_NO_ENDPOINT); return -1 }
        errors += 1
        if (errors >= HOST_EVENT_MAX_ERRORS) { halt(PUMP_TOO_MANY_ERRORS); return -1 }
        interval = Math.min(Math.round(interval * HOST_EVENT_BACKOFF), HOST_EVENT_MAX_INTERVAL)
        schedule(interval)
        return 0
      }
      errors = 0
      const page = outcome.value || {}
      const events = readEventPage(page)
      const next = Number(page.cursor)
      if (Number.isFinite(next) && next > cursor) cursor = next
      if (events.length) {
        publish(events)
        interval = HOST_EVENT_MIN_INTERVAL
      } else {
        interval = Math.min(Math.round(interval * HOST_EVENT_BACKOFF), HOST_EVENT_MAX_INTERVAL)
      }
      // host 说还有积压就立刻续一页。这不是高频轮询 —— 是把一次积压一次性取完，
      // 且必然收敛：feed 有条数上限，每页都会把游标往前推。
      schedule(events.length && page.more === true ? 0 : interval)
      return events.length
    } finally {
      inflight = false
    }
  }

  const offVisibility = deps.onVisibility ? deps.onVisibility(onVisibilityChange) : defaultOnVisibility(onVisibilityChange)

  function onVisibilityChange(): void {
    if (stoppedReason) return
    if (!visible()) { clear(); return }
    // 老板切回来了：回到最短间隔并立刻补一次。这是一次，不是一串。
    interval = HOST_EVENT_MIN_INTERVAL
    void pull()
  }

  if (!deps.rpc) halt(PUMP_NO_RPC)
  else void pull()

  return {
    pull,
    cursor: () => cursor,
    interval: () => interval,
    stopped: () => stoppedReason,
    pending: () => queuedAt,
    stop: () => { halt(stoppedReason || '已卸载'); offVisibility() },
  }
}

/**
 * 同一条 rpc 上**只跑一台泵**。DSH 可能同时挂着多个 Session 视图，
 * 每个视图各起一台泵会让轮询频率成倍上涨 —— 那正是「克制」的反面。
 * 事件最后都落进同一条浏览器侧总线，多台泵除了多打 host 之外没有任何收益。
 */
const sharedPumps = new Map<OrgPanelRpc, { pump: HostEventPump; refs: number }>()

/**
 * 事件泵的 React 外壳。rpc 变了就换一台泵，最后一个使用者卸载时停表。
 * rpc 为空时一台泵都不建，一个定时器都不排 —— 降级形态与接泵之前逐字一致。
 */
export function useHostEventChannel(rpc: OrgPanelRpc | null | undefined): void {
  useEffect(() => {
    if (!rpc) return
    let entry = sharedPumps.get(rpc)
    if (!entry) {
      entry = { pump: createHostEventPump({ rpc }), refs: 0 }
      sharedPumps.set(rpc, entry)
    }
    entry.refs += 1
    const current = entry
    return () => {
      current.refs -= 1
      if (current.refs > 0) return
      sharedPumps.delete(rpc)
      current.pump.stop()
    }
  }, [rpc])
}

export type OrgPanelConsole = CompanyHydration & {
  channel: OrgPanelChannelState
  /** 通道不可用时的真实原因原文（含 host 的错误信息），要能直接上屏。 */
  channelNote: string
  /** 六个设置页的增量数据：审批台账 / 健康检查 / 通讯摘要 / 安全策略 / 模型供应商 / 存储清单。 */
  extra: CompanySettingsData
  loading: boolean
  error: string | null
  /** 手动刷新。ok=false 时 message 说明为什么走不通，调用方据此走降级路径。 */
  refresh(): Promise<{ ok: boolean; message: string }>
}

const EMPTY_EXTRA: CompanySettingsData = {}

/**
 * hydrate + 设置中心数据的唯一入口。
 *
 * 时序：挂载即探测一次 `/org-panel`（顺带把快照拉回来，空 Session 也有历史数据）；
 * 打开设置中心时再拉一次拿最新台账；老板点「刷新」再拉一次。
 * 通道不通时**一次都不重试**，安静走会话 / 缓存那两级，行为与接 RPC 之前完全一致。
 */
export function useOrgPanel(nodes: any[], rpc: OrgPanelRpc | null | undefined, settingsOpen: boolean): OrgPanelConsole {
  const fromSession = useMemo(() => extractCompanySnapshot(nodes), [nodes])
  const [remote, setRemote] = useState<{ snapshot: CompanySnapshot | null; extra: CompanySettingsData }>({ snapshot: null, extra: EMPTY_EXTRA })
  const [channel, setChannel] = useState<OrgPanelChannelState>('unknown')
  const [channelNote, setChannelNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  // 进场时显式置回 true：StrictMode 的双调用会先跑一次 cleanup，只写 cleanup 会把自己永久关掉。
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  // host→client 事件泵。挂在这里而不是办公室组件里，是因为 rpc 只在这一处拿得到，
  // 而且它跟着整个工作台的生命周期走：切 Tab 不该把飞书铃铛的通道掐掉。
  useHostEventChannel(rpc)

  const pull = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    if (!rpc) {
      if (alive.current) { setChannel('offline'); setChannelNote('') }
      return { ok: false, message: '当前运行时没有 client↔host 通道。' }
    }
    if (alive.current) setLoading(true)
    try {
      const result = await fetchOrgPanel(rpc)
      if (!alive.current) return { ok: result.channel === 'online', message: '' }
      setChannel(result.channel)
      setChannelNote(result.note)
      setError(result.errors.length ? result.errors.join('；') : null)
      if (result.channel === 'offline') return { ok: false, message: `${result.note || '/org-panel 频道没有应答。'}` }
      setRemote({ snapshot: result.snapshot, extra: result.extra })
      if (result.snapshot) writeCachedSnapshot(result.snapshot)
      const at = result.snapshot ? new Date(result.snapshot.generatedAt).toLocaleString('zh-CN', { hour12: false }) : ''
      return {
        ok: true,
        message: result.errors.length
          ? `已从 host 读取，但有端点失败：${result.errors.join('；')}`
          : `已从 host 读取真实数据${at ? ` · 快照时间 ${at}` : ''}`,
      }
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [rpc])

  // 依赖只用**标量**（快照生成时间），不用对象引用。
  // extractCompanySnapshot 每次都 JSON.parse 出一个新对象，拿它当 effect 依赖 =
  // 只要 nodes 的引用不稳，就会「取数 → setState → 重渲染 → 再取数」无限打 host。
  const sessionAt = fromSession ? fromSession.generatedAt : 0
  // 挂载即探测一次：空 Session 打开工作台就该有历史数据，不必先等 LLM 跑一次工具。
  // 会话里又跑出新快照时也重拉一次 —— host 侧状态多半跟着变了，不能让旧的 RPC 结果压住新的。
  useEffect(() => { void pull() }, [pull, sessionAt])
  // 打开设置中心时再拉一次：审批台账 / 健康检查这些东西过一分钟就可能变。
  // settingsOpen 初值是 false，所以这条不会在挂载时跟上面那条重复触发。
  useEffect(() => { if (settingsOpen) void pull() }, [settingsOpen, pull])

  // 三级优先级，顺序在这里显式可读：RPC 快照 > 本 Session tool-result > localStorage 缓存。
  const chosen: { snapshot: CompanySnapshot | null; source: SnapshotSource } = remote.snapshot
    ? { snapshot: remote.snapshot, source: 'rpc' }
    : fromSession
      ? { snapshot: fromSession, source: 'session' }
      : { snapshot: null, source: 'none' }

  // 同上，依赖用标量：generatedAt 一样就是同一份快照，没必要（也不能）反复推进全局 store。
  const chosenAt = chosen.snapshot ? chosen.snapshot.generatedAt : 0
  useEffect(() => {
    if (chosen.snapshot) {
      setCompanySnapshot(chosen.snapshot)
      if (chosen.source === 'session') writeCachedSnapshot(chosen.snapshot)
      return
    }
    // 前两级都没有：只在全局 store 为空时用缓存冷启动，绝不覆盖已有的新数据。
    if (readCompanySnapshot()) return
    const cached = readCachedSnapshot()
    if (cached) applyCompanySnapshot(cached)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chosen.snapshot 的身份不稳，靠 chosenAt 定身份
  }, [chosenAt, chosen.source])

  const snapshot = useCompanySnapshot()
  // 来源标记必须跟着实际渲染的那一份走：前两级都空、屏幕上却有数据，那份就只可能来自本机缓存。
  const source: SnapshotSource = chosen.snapshot ? chosen.source : snapshot ? 'cache' : 'none'

  return {
    snapshot,
    source,
    cached: source === 'cache',
    channel,
    channelNote,
    extra: remote.extra,
    loading,
    error,
    refresh: pull,
  }
}

/**
 * 会话节点流 → Company Event Bus 的 'session' 通道。
 * 幂等全量替换：内容没变就不通知，React 不会因此死循环（见 event-bus.setChannel）。
 * 办公室 / 右栏 / 档案统一从总线读状态，不再各自从 nodes 推导。
 */
export function useSessionEventChannel(nodes: any[], runningCalls: any[], roles: RoleDef[], staff: StaffDef[]): void {
  const events = useMemo(
    () => deriveCompanyEvents(nodes, runningCalls, roles, staff),
    [nodes, runningCalls, roles, staff],
  )
  useEffect(() => {
    companyEventBus.setEmployeeIds(staff.map((item) => item.id))
    companyEventBus.setChannel(SESSION_CHANNEL, events)
  }, [events, staff])
}

/**
 * 设置中心的 action 表。
 *
 * 规则只有一条：**能真正做到的才给 action**。给了 action 按钮就是真的能点；
 * 没给的那些，六个设置页会把控件禁用并在 title 里说明原因（绝不摆一个假装能用的按钮）。
 *
 * 安全边界（铁律四）：这里的 approve / reject 是把**老板的这一次点击**送到 host，
 * 审批语义一个字都没放宽 —— host 侧 PluginRuntime.approve 的调用方仍然只有 UI / CLI / 预批准配置，
 * LLM 手上只有 Tool Registry，够不到 ctx.connection，永远走不到这条路。
 */
export function buildSettingsActions(options: {
  channel: OrgPanelChannelState
  rpc?: OrgPanelRpc | null
  refresh(): unknown | Promise<unknown>
  openProfile(employeeId: string): void
}): CompanySettingsActions {
  const { channel, rpc, refresh, openProfile } = options
  const actions: CompanySettingsActions = {
    refresh: () => refresh(),
    employees: { openProfile },
  }
  // 通道没通（或还没探明）时一个写操作都不给：宁可让老板看到「此处无法审批」，也不给他一个点了没反应的按钮。
  if (channel !== 'online' || !rpc) return actions
  actions.plugins = {
    approve: (requestId: string) => orgPanelWrite(rpc, WRITE_ENDPOINTS.approve, { requestId }),
    reject: (requestId: string) => orgPanelWrite(rpc, WRITE_ENDPOINTS.reject, { requestId }),
    verify: (requestId: string) => orgPanelWrite(rpc, WRITE_ENDPOINTS.verify, { requestId }),
    healthCheck: () => orgPanelWrite(rpc, WRITE_ENDPOINTS.healthCheck, {}),
  }
  actions.models = {
    upsert: (provider: ModelProviderConfig) => orgPanelWrite(rpc, WRITE_ENDPOINTS.modelUpsert, { provider }),
    remove: (providerId: string) => orgPanelWrite(rpc, WRITE_ENDPOINTS.modelRemove, { providerId }),
    setDefault: (providerId: string) => orgPanelWrite(rpc, WRITE_ENDPOINTS.modelSetDefault, { providerId }),
    // live 由 host 决定发不发真实请求，返回里的 checked 会如实区分；面板不许把 config-only 说成「已连通」。
    test: (providerId: string) => orgPanelWrite(rpc, WRITE_ENDPOINTS.modelTest, { providerId }),
    setEnabled: (providerId: string, enabled: boolean) => orgPanelWrite(rpc, WRITE_ENDPOINTS.modelSetEnabled, { providerId, enabled }),
    // providerId 为 null = 解绑；host 侧按空串处理成 unbindModel。
    bind: (employeeId: string, capability: string, providerId: string | null) =>
      orgPanelWrite(rpc, WRITE_ENDPOINTS.modelBind, { employeeId, capability, providerId: providerId || '' }),
  }
  return actions
}

/**
 * 「刷新公司数据」的降级路径：`/org-panel` 不可用时，唯一诚实的做法是把指令写进原生 Composer 草稿，
 * 由老板自己按回车。绝不自动提交，也不假装已经刷新成功。
 */
export const REFRESH_PROMPT = '调用 company_snapshot 读取赛博公司当前的完整持久化状态，然后用一句话概括即可。'
export const REFRESH_RESULT = '已把刷新指令写进下方输入框，按回车让秘书执行 company_snapshot 后工作台会自动更新。'
