// v7 stability wrapper: keep v6 visuals while ignoring self-generated zone-stat mutations.
import { apply as applyV6 } from './client-v6'

export function apply(ctx: any, config?: any) {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') {
    applyV6(ctx, config)
    return
  }

  const NativeObserver = window.MutationObserver
  const FilteredObserver = class extends NativeObserver {
    constructor(callback: MutationCallback) {
      super((records, observer) => {
        const meaningful = records.filter((record) => {
          const target = record.target instanceof Element ? record.target : record.target.parentElement
          return !target?.closest?.('.hq6-zone-stat')
        })
        if (meaningful.length) callback(meaningful, observer)
      })
    }
  }

  ;(window as any).MutationObserver = FilteredObserver
  try {
    applyV6(ctx, config)
  } finally {
    ;(window as any).MutationObserver = NativeObserver
  }
}
