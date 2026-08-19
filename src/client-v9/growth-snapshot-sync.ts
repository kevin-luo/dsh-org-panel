// Host 的 Company Event 能让办公室马上知道“技能发生了变化”，但 Lv / XP / Evidence
// 的权威数据仍在 evolution.json 的 CompanySnapshot 里。这里把两条线接起来：
// 收到新的 skill.updated 后只做一次去抖刷新，让档案、个人空间和办公室等级同步到同一份持久化快照。
import { useEffect } from 'react'
import { companyEventBus } from '../runtime/event-bus'

const REFRESH_DEBOUNCE_MS = 180

export function usePersistentGrowthRefresh(refresh: () => unknown | Promise<unknown>): void {
  useEffect(() => {
    // 挂载前已经存在的事件视为“已看过”，不能一打开页面就因为历史 skill.updated 再打一遍 RPC。
    const seen = new Set(companyEventBus.events().map((event) => event.id))
    let timer: any = null
    let disposed = false

    const schedule = () => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (disposed) return
        try {
          const value = refresh()
          if (value && typeof (value as Promise<unknown>).then === 'function') {
            void (value as Promise<unknown>).catch(() => undefined)
          }
        } catch {
          // refresh 自己会把真实错误状态写进 OrgPanelConsole；这里不能再制造第二套错误 UI。
        }
      }, REFRESH_DEBOUNCE_MS)
    }

    const onChange = () => {
      let growthChanged = false
      for (const event of companyEventBus.events()) {
        if (seen.has(event.id)) continue
        seen.add(event.id)
        if (event.type === 'skill.updated') growthChanged = true
      }
      if (growthChanged) schedule()
    }

    const unsubscribe = companyEventBus.subscribe(onChange)
    return () => {
      disposed = true
      unsubscribe()
      if (timer !== null) clearTimeout(timer)
    }
  }, [refresh])
}
