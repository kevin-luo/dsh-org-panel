// 「赛博公司」Company Event Bus（需求文档三十二条）。
//
// 定位：全公司唯一的事件汇聚点。会话节点流、Host、Vision、Plugin Runtime、飞书 Adapter
// 都往这里投事件，办公室只从这里取状态（三十三条：办公室不能自己制造业务状态）。
//
// 硬约束：
//   1. 不 import node:*，不碰 window/document，浏览器与 Node 两侧都能直接用。
//   2. 自己不生成时间戳、不生成事件——事件必须由真实发生源头带 at 投进来。
//   3. snapshot() 做了记忆化，引用稳定，可直接喂 React useSyncExternalStore。
import type { CompanyEvent, CompanyRuntime, ReduceOptions } from './company-events'
import { dedupeCompanyEvents, emptyCompanyRuntime, reduceCompanyRuntime, sortCompanyEvents } from './company-events'

const DEFAULT_LIMIT = 600
const LIVE_CHANNEL = 'live'
/** 增量日志默认条数上限。它与 channel 的 limit 是两码事：channel 存状态，feed 存「还能补发给谁」。 */
const DEFAULT_FEED_LIMIT = 400
/** 增量日志默认保留窗口（30 分钟）。超窗的事件不再补发 —— 补一条半小时前的铃铛没有意义。 */
export const DEFAULT_FEED_RETENTION_MS = 30 * 60 * 1000
/** since() 单页默认条数。 */
const DEFAULT_PAGE = 200

/** 一页增量事件。host 侧 `/org-panel` events/since 原样吐这个结构。 */
export type CompanyEventPage = {
  /** 本页最后一条事件的游标；下次带上它就只会拿到更新的事件。 */
  cursor: number
  events: CompanyEvent[]
  /** 当前还能补发的最老游标。 */
  oldest: number
  /**
   * 请求的 cursor 与 feed 之间真的断了档（客户端离线太久 / 保留窗口太短）。
   * 这是一条必须如实上报的事实：断档就是断档，不许假装事件流连续。
   */
  dropped: boolean
  /** 本页之后还有积压，调用方可以立刻再要一页。 */
  more: boolean
}

/** 通道内容是否等价：id + at 完全一致就认为没变，避免重复渲染。 */
function sameEvents(a: readonly CompanyEvent[], b: readonly CompanyEvent[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) {
    if (a[index].id !== b[index].id || a[index].at !== b[index].at || a[index].type !== b[index].type) return false
  }
  return true
}

export type CompanyEventBusOptions = {
  /** 事件保留上限，超出后丢弃最旧的。默认 600。 */
  limit?: number
  /** 增量日志条数上限，默认 400。 */
  feedLimit?: number
  /** 增量日志保留窗口（毫秒），默认 30 分钟；0 = 只受条数上限约束。 */
  retentionMs?: number
  reduce?: ReduceOptions
}

export class CompanyEventBus {
  private channels = new Map<string, CompanyEvent[]>()
  private listeners = new Set<() => void>()
  private limit: number
  private reduceOptions: ReduceOptions
  private cachedEvents: CompanyEvent[] | null = null
  private cachedRuntime: CompanyRuntime | null = null
  // --- 增量日志（host→client 推送用） ---------------------------------------
  // 单调递增的 seq 是游标的唯一定义。不用 at 当游标：同一毫秒里可能挤进好几条事件，
  // 拿时间戳翻页必然要么漏发要么重发。
  private feed: Array<{ seq: number; event: CompanyEvent }> = []
  private feedIds = new Set<string>()
  private seq = 0
  /** 已见过的最大事件时间。保留窗口以它为「现在」—— 本文件绝不读系统时钟（见文件头约束 2）。 */
  private newestAt = 0
  private feedLimit: number
  private retentionMs: number

  constructor(options?: CompanyEventBusOptions) {
    this.limit = Math.max(1, options?.limit ?? DEFAULT_LIMIT)
    this.feedLimit = Math.max(1, options?.feedLimit ?? DEFAULT_FEED_LIMIT)
    this.retentionMs = Math.max(0, options?.retentionMs ?? DEFAULT_FEED_RETENTION_MS)
    this.reduceOptions = options?.reduce || {}
  }

  /** 设定员工名册：名册里的人即使零事件也会有一份 idle 状态。 */
  setEmployeeIds(ids: readonly string[]): void {
    const next = [...ids].filter(Boolean)
    const current = this.reduceOptions.employeeIds || []
    if (next.length === current.length && next.every((id, index) => id === current[index])) return
    this.reduceOptions = { ...this.reduceOptions, employeeIds: next }
    this.invalidate(true)
  }

  /** 追加一条实时事件（Host / Vision / Plugin / IM Adapter 用这个）。 */
  publish(event: CompanyEvent, origin = LIVE_CHANNEL): void {
    this.publishAll([event], origin)
  }

  publishAll(events: readonly CompanyEvent[], origin = LIVE_CHANNEL): void {
    const incoming = dedupeCompanyEvents(events)
    if (!incoming.length) return
    const channel = this.channels.get(origin) || []
    const known = new Set(channel.map((item) => item.id))
    const fresh = incoming.filter((item) => !known.has(item.id))
    if (!fresh.length) return
    const merged = channel.concat(fresh)
    this.channels.set(origin, merged.length > this.limit ? merged.slice(merged.length - this.limit) : merged)
    this.record(fresh)
    this.invalidate(true)
  }

  /**
   * 把真实增量投递记进 feed。**只有 publishAll 会调它**：
   * setChannel 的语义是「幂等全量替换」，是快照不是增量，塞进增量日志会让
   * 「会话重算掉了一条」这种事在补发流里表现成一条永远撤不回的幽灵事件。
   */
  private record(events: readonly CompanyEvent[]): void {
    let added = false
    for (const event of events) {
      if (!event?.id || this.feedIds.has(event.id)) continue
      this.seq += 1
      this.feed.push({ seq: this.seq, event })
      this.feedIds.add(event.id)
      if (event.at > this.newestAt) this.newestAt = event.at
      added = true
    }
    if (added) this.trimFeed()
  }

  /** 双重上限：先按保留窗口裁时间，再按条数裁长度。两条都以 feed 自己为唯一真相。 */
  private trimFeed(): void {
    if (this.retentionMs > 0 && this.feed.length && this.feed[0].event.at < this.newestAt - this.retentionMs) {
      const cutoff = this.newestAt - this.retentionMs
      this.feed = this.feed.filter((row) => row.event.at >= cutoff)
    }
    if (this.feed.length > this.feedLimit) this.feed = this.feed.slice(this.feed.length - this.feedLimit)
    if (this.feedIds.size !== this.feed.length) this.feedIds = new Set(this.feed.map((row) => row.event.id))
  }

  /** 当前最新游标。客户端第一次拉取传 0，之后一直带上一页的 cursor。 */
  feedCursor(): number {
    return this.seq
  }

  /**
   * 取 cursor 之后的增量事件。**只返回增量**，不做全量下发（cursor=0 除外，那是首次拉取）。
   * 断档如实标 dropped：宁可让前端知道「中间那段丢了」，也不许把不连续的流当连续的用。
   */
  since(cursor = 0, max = DEFAULT_PAGE): CompanyEventPage {
    const from = Number.isFinite(cursor) && cursor > 0 ? Math.floor(cursor) : 0
    const size = Math.max(1, Math.min(Math.floor(max) || DEFAULT_PAGE, this.feedLimit))
    const rows = this.feed.filter((row) => row.seq > from)
    const page = rows.slice(0, size)
    return {
      // 一条都没有时把游标推到当前 seq：那些事件已经被保留窗口丢掉了，再要一万次也不会回来。
      cursor: page.length ? page[page.length - 1].seq : Math.max(from, this.seq),
      events: page.map((row) => row.event),
      oldest: this.feed.length ? this.feed[0].seq : this.seq,
      dropped: from > 0 && (this.feed.length ? this.feed[0].seq > from + 1 : this.seq > from),
      more: rows.length > page.length,
    }
  }

  /**
   * 幂等全量替换某个来源的事件。会话节点流每次重算后调这个：
   * 内容没变就完全不通知，React 侧不会因此死循环。
   */
  setChannel(origin: string, events: readonly CompanyEvent[]): void {
    const next = dedupeCompanyEvents(events)
    const current = this.channels.get(origin)
    if (current && sameEvents(current, next)) return
    if (!next.length && !current) return
    if (next.length) this.channels.set(origin, next.length > this.limit ? next.slice(next.length - this.limit) : next)
    else this.channels.delete(origin)
    this.invalidate(true)
  }

  /** 只清状态通道，**不动 feed**：feed 是「谁还没收到」的投递台账，跟某个通道当前存了什么无关。 */
  clearChannel(origin: string): void {
    if (!this.channels.delete(origin)) return
    this.invalidate(true)
  }

  reset(): void {
    // seq 绝不回退：已经发出去的游标必须永远有效，否则客户端会被迫重收一遍老事件。
    this.feed = []
    this.feedIds.clear()
    if (!this.channels.size) return
    this.channels.clear()
    this.invalidate(true)
  }

  /** 所有通道合并后的事件流，已去重并按 at 排序。 */
  events(): readonly CompanyEvent[] {
    if (!this.cachedEvents) {
      const all: CompanyEvent[] = []
      for (const channel of this.channels.values()) all.push(...channel)
      const ordered = sortCompanyEvents(dedupeCompanyEvents(all))
      this.cachedEvents = ordered.length > this.limit ? ordered.slice(ordered.length - this.limit) : ordered
    }
    return this.cachedEvents
  }

  /** 记忆化快照，引用稳定；供 useSyncExternalStore 的 getSnapshot 直接使用。 */
  snapshot(): CompanyRuntime {
    if (!this.cachedRuntime) {
      const events = this.events()
      this.cachedRuntime = events.length || (this.reduceOptions.employeeIds || []).length
        ? reduceCompanyRuntime(events, this.reduceOptions)
        : emptyCompanyRuntime()
    }
    return this.cachedRuntime
  }

  /** 订阅变更；返回退订函数。回调不带参数，配合 snapshot() 使用。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private invalidate(notify: boolean): void {
    this.cachedEvents = null
    this.cachedRuntime = null
    if (!notify) return
    for (const listener of [...this.listeners]) {
      try { listener() } catch { /* 单个订阅者出错不许拖垮整条总线 */ }
    }
  }
}

/**
 * 全局单例。**注意这是两个进程里的两个对象**：tsdown 有 index / client 两个 entry，
 * host bundle 与 browser bundle 各自打进一份，它们之间没有任何共享内存。
 *
 * 所以 host 侧 publish 的 `external.message.received` / `plugin.install.started` /
 * `vision.started` 不会自己飘到浏览器里 —— 必须由 client 主动经 `/org-panel` 的
 * events/since 拉过来再 publishAll 一遍（见 src/client-v9/company-bridge.ts 的事件泵）。
 * feed 的存在就是为了让这次拉取只拿增量，而不是每次全量。
 */
export const companyEventBus = new CompanyEventBus()

/** 会话节点流专用通道名，client 侧每次重算都往这里 setChannel。 */
export const SESSION_CHANNEL = 'session'

/**
 * host 事件通道名。host 侧生产者 publish 到这里，client 侧把拉回来的增量也 publish 到这里。
 * 与 SESSION_CHANNEL 同时存在是常态：两边描述同一件事时事件 id 相同，
 * events() 里的 dedupeCompanyEvents 保证只算一次（tests/event-push.test.mjs 有专门断言）。
 */
export const HOST_CHANNEL = 'host'
