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
  reduce?: ReduceOptions
}

export class CompanyEventBus {
  private channels = new Map<string, CompanyEvent[]>()
  private listeners = new Set<() => void>()
  private limit: number
  private reduceOptions: ReduceOptions
  private cachedEvents: CompanyEvent[] | null = null
  private cachedRuntime: CompanyRuntime | null = null

  constructor(options?: CompanyEventBusOptions) {
    this.limit = Math.max(1, options?.limit ?? DEFAULT_LIMIT)
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
    this.invalidate(true)
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

  clearChannel(origin: string): void {
    if (!this.channels.delete(origin)) return
    this.invalidate(true)
  }

  reset(): void {
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

/** 全局单例：client 与 host 在各自 bundle 内共用。 */
export const companyEventBus = new CompanyEventBus()

/** 会话节点流专用通道名，client 侧每次重算都往这里 setChannel。 */
export const SESSION_CHANNEL = 'session'
