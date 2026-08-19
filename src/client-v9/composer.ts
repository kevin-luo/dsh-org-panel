// 原生 Composer 桥：全局唯一「把 @员工 写进 DSH 输入框」的实现。
// 只写草稿 + 聚焦，任何分支都不碰 submit —— 发不发由老板决定（需求文档第二十条）。
//
// 为什么要独立成一个模块：这条链路只有真机才暴露问题（DOM、焦点、宿主 props 三样单测都摸不到），
// 拆出来才能在单测里逐段验，也才能在 CompanyView 之外复用同一份口径。
//
// 已安装的 DSH 0.1.0-rc.7 实测口径（不要照 scratchpad 里那份 0.0.1-rc.1 的旧包核对）：
//   - conversation.view 的 slot 组件确实拿得到 `inputActions`
//     （ui-conversation/lib/client.js:9546 `sessions.provide({ props:['inputActions'] })`
//      → web-react/lib/index.js:428 `Object.assign(standard, info.props)` 逐字下发到组件 props）；
//   - `InputActions.setDraft(text)` 是唯一公开的草稿写入口，没有 phase 守卫，
//     但 machine 里有一条 `if (draft === this.draft) return []`（ui-conversation/lib/client.js:523）：
//     **写进去的文本和当前草稿一模一样时是彻底的空操作**，画面上什么都不会发生；
//   - 原生 Composer 的 seat 是 `[data-composer-seat]`，全局只有一个，里面就是那个 textarea
//     （ui-conversation/lib/client.js:6937）。选择器在 rc.7 仍然成立。

/** 原生 Composer 的 textarea 选择器。DSH 全局只挂一个 seat。 */
export const COMPOSER_SELECTOR = '[data-composer-seat] textarea'

/** DSH 引用芯片在草稿里的占位符（U+FFFC）。只做「别把它当空白裁掉」用。 */
const OBJECT_REPLACEMENT = '￼'

type Doc = Pick<Document, 'querySelector' | 'activeElement'>

/** 取原生 Composer 的 textarea；SSR / 单测里没有 document 就返回 null。 */
export function composerTextarea(doc?: Doc | null): HTMLTextAreaElement | null {
  const target = doc || (typeof document === 'undefined' ? null : document)
  if (!target) return null
  return target.querySelector(COMPOSER_SELECTOR) as HTMLTextAreaElement | null
}

/**
 * 把一段文本并进现有草稿。
 * 老板已经敲进去的字一个都不许被覆盖 —— 这是「插入 @员工」，不是「清空重写」。
 * 末尾没有空白就补一个空格，保证 `@小刘 ` 不会黏在上一句话尾巴上。
 */
export function joinDraft(current: string, text: string): string {
  const base = current || ''
  if (!base || (!base.trim() && !base.includes(OBJECT_REPLACEMENT))) return text
  return /\s$/.test(base) ? base + text : `${base} ${text}`
}

/** 草稿写入走了哪条路：官方 face / 兜底的原生 input 事件 / 一条都没走通。 */
export type DraftRoute = 'actions' | 'dom' | 'none'

/**
 * 用原生 value setter + input 事件写 textarea。
 * 这条路和老板自己敲字**完全同一条** React onChange 通道（受控组件必须绕开
 * React 缓存的 value，否则 onChange 不触发），所以不会绕过 DSH 的输入状态机，
 * 也一样不触发发送。只在官方 face 缺席或抛错时用。
 */
export function typeIntoComposer(next: string, doc?: Doc | null): boolean {
  const el = composerTextarea(doc)
  if (!el) return false
  const proto = Object.getPrototypeOf(el) as object | null
  const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : undefined
  if (!setter) return false
  setter.call(el, next)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

/**
 * 写草稿：官方 `InputActions.setDraft` 优先，缺席 / 抛错才退到原生 input 事件。
 * 返回实际走通的那条路，调用方要把 'none' 当失败上报，不许假装写进去了。
 */
export function writeDraft(actions: unknown, next: string, doc?: Doc | null): DraftRoute {
  const face = actions as { setDraft?: (text: string) => void } | null | undefined
  if (face && typeof face.setDraft === 'function') {
    try {
      face.setDraft(next)
      return 'actions'
    } catch { /* 官方通道抛错就退到兜底，不静默吞成功 */ }
  }
  return typeIntoComposer(next, doc) ? 'dom' : 'none'
}

/** 把焦点交还原生 Composer，光标落在末尾。返回是否真的拿到了焦点。 */
export function focusComposer(doc?: Doc | null): boolean {
  const target = doc || (typeof document === 'undefined' ? null : document)
  const el = composerTextarea(target)
  if (!el || typeof el.focus !== 'function') return false
  el.focus()
  try {
    const end = el.value.length
    if (typeof el.setSelectionRange === 'function') el.setSelectionRange(end, end)
  } catch { /* 光标定位失败不影响「焦点已经过去了」这个结果 */ }
  return !!target && target.activeElement === el
}

/**
 * 抢焦点的时机安排：
 *   1. 同步抢一次 —— 还在用户手势里，浏览器一定放行；
 *   2. rAF 再抢一次 —— React 提交后 DSH 可能重排 Composer；
 *   3. setTimeout 兜底 —— **页面在后台标签页时 rAF 根本不触发**，
 *      原来只挂一个 rAF，切走再回来焦点就永远不过去。
 */
export function scheduleFocus(win?: Window | null, doc?: Doc | null): boolean {
  const landed = focusComposer(doc)
  const scope = win || (typeof window === 'undefined' ? null : window)
  if (!scope) return landed
  if (typeof scope.requestAnimationFrame === 'function') scope.requestAnimationFrame(() => { focusComposer(doc) })
  if (typeof scope.setTimeout === 'function') scope.setTimeout(() => { focusComposer(doc) }, 0)
  return landed
}
