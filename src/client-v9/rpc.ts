// 「赛博公司」client → host 的 `/org-panel` RPC 通道（全局唯一出口）。
//
// 事实依据全部实读自 @deepseek-ai/dsh-client-connection@0.0.1-rc.1，不是推测：
//   1. client 侧 cordis Context 上确实有 connection 服务：
//      `ctx.provide('connection', { api, isLoopback, rpc, start })`（该包 lib/client.js:9933），
//      其中 `rpc = createWebConnectionRpc()`（:9917）。**DSH 一直都有通用 RPC**；
//      之前那个相反的结论来自只读了 ui-conversation 包就下判断，是错的。
//   2. 该包 `publishConfig.access: "restricted"`，node_modules/@deepseek-ai 下只有 cordis 与 cosmokit ——
//      **绝不能 import `createWebConnectionRpc`**，否则 browser bundle 直接解析失败。
//      只能用 `ctx.get('connection')` 拿宿主已经建好的那一个实例
//      （cordis 4 的 get 是 mixin，注释写明「不需要 inject 就能读服务」）。
//   3. `call()` 的失败面不统一，**只判 `result.ok` 是 bug**，两道都必须做：
//        · HTTP 非 2xx / rpcId 不匹配 → 直接 throw（该包 lib/client.js:9873-9877）
//        · `?fixture` 模式下任何非 `/api` 频道 → Promise.reject（:9600）
//        · 正常应答但 `{ ok:false, error }` → 业务失败
//   4. 频道名合法性：`CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/`，`/org-panel` 通过。
//
// 安全边界（不因为「有 RPC 了」就退化）：host 侧以 `authority:'loopback'` 注册这个频道，
// 且这条通道只有浏览器里的人类能发起 —— LLM 手上只有 Tool Registry，拿不到 ctx.connection，
// 永远调不到 `/org-panel`。插件审批因此第一次在传输层把「人类点击」和「模型调用」分开了。

/** host 侧 src/host/org-panel-rpc.ts 注册的频道名。改名必须两边一起改。 */
export const ORG_PANEL_CHANNEL = '/org-panel'

/** 只依赖 call 这一个方法，避免把 DSH 的类型 import 进 browser bundle。 */
export type OrgPanelRpc = {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

/**
 * 三态结果：
 *   ok          —— host 应答且业务成功；
 *   error       —— 通道是通的，但这次调用失败（host 明确回了 error，或返回结构不认识）；
 *   unavailable —— 连一个合法 RPC 信封都没拿回来：频道没注册 / 没有 httpServer / fixture 模式 / 网络断。
 * 三者都不许被静默吞掉，unavailable 也不许当成「没有数据」渲染成 0。
 */
export type RpcOutcome<T> =
  | { state: 'ok'; value: T }
  | { state: 'error'; code: string; message: string }
  | { state: 'unavailable'; message: string }

/** 页面里根本没有 connection 服务（某些部署形态）。 */
export const NO_CONNECTION = '当前运行时没有给 client 提供 connection 服务，面板无法直接读写 host'
/** connection 在，但 `/org-panel` 频道没应答。 */
export const CHANNEL_DOWN = 'host 没有应答 /org-panel 频道（插件 host 未挂载，或该部署形态没有 httpServer）'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || String(error)
  return error === undefined || error === null ? '未说明的错误' : String(error)
}

/**
 * 从 client 侧 cordis Context 上取现成的 RPC 调用器。
 * 拿不到就返回 null —— 调用方一律安静降级到「会话 tool-result / localStorage」那条老路，不报错、不假装。
 */
export function resolveOrgPanelRpc(ctx: any): OrgPanelRpc | null {
  try {
    const connection = ctx && typeof ctx.get === 'function' ? ctx.get('connection') : undefined
    const rpc = connection?.rpc
    return setCurrentOrgPanelRpc(rpc && typeof rpc.call === 'function' ? (rpc as OrgPanelRpc) : null)
  } catch {
    // 没 provide 过这个服务时 cordis 可能抛：当作没有通道。
    return setCurrentOrgPanelRpc(null)
  }
}

// ---------------------------------------------------------------------------
// 组件树深处的取用口
// ---------------------------------------------------------------------------
// rpc 只在 client-v9/index.tsx 那个 ctx 上取得到，然后一路当 props 往下传。
// 但有两处需要它的地方不在那条 props 链上：员工档案的记忆分页、员工消息旁的记忆证据 chip。
// 与其为它们把 rpc 串过五层组件，不如在这里存一份 resolveOrgPanelRpc() 已经解析好的实例。
// 没解析到就是 null —— 调用方一律安静回落到既有行为，绝不因此显示 0 或「暂无」。

let currentRpc: OrgPanelRpc | null = null

/** 供 index.tsx 之外的模块按需取用；null = 这套部署没有 client↔host 通道。 */
export function currentOrgPanelRpc(): OrgPanelRpc | null { return currentRpc }

/** 由 resolveOrgPanelRpc 写入；单测也用它注入一个假通道。返回入参，方便直接 return。 */
export function setCurrentOrgPanelRpc(rpc: OrgPanelRpc | null): OrgPanelRpc | null {
  currentRpc = rpc
  return rpc
}

/** 调一个 `/org-panel` endpoint。任何异常都会被翻译成三态之一，绝不向上抛。 */
export async function callOrgPanel<T = unknown>(
  rpc: OrgPanelRpc | null | undefined,
  endpoint: string,
  payload: unknown = {},
  signal?: AbortSignal,
): Promise<RpcOutcome<T>> {
  if (!rpc || typeof rpc.call !== 'function') return { state: 'unavailable', message: NO_CONNECTION }
  let raw: unknown
  try {
    raw = await rpc.call(ORG_PANEL_CHANNEL, endpoint, payload === undefined ? {} : payload, signal)
  } catch (error) {
    // 主动取消不是通道故障，不许据此把通道判死。
    if (signal?.aborted) return { state: 'error', code: 'aborted', message: `${endpoint} 调用已取消` }
    return { state: 'unavailable', message: `${CHANNEL_DOWN}：${errorMessage(error)}` }
  }
  const result = raw as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } } | null
  if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
    return { state: 'error', code: 'malformed', message: `${ORG_PANEL_CHANNEL}/${endpoint} 返回了面板不认识的结构` }
  }
  if (result.ok === true) return { state: 'ok', value: result.value as T }
  const error = result.error || {}
  return {
    state: 'error',
    code: String(error.code ?? 'unknown'),
    message: String(error.message ?? `${ORG_PANEL_CHANNEL}/${endpoint} 调用失败`),
  }
}

/** 失败原因的统一文案（unavailable 与 error 都要带上真实原文，方便老板和下一个改代码的人定位）。 */
export function outcomeMessage(outcome: RpcOutcome<unknown>): string {
  if (outcome.state === 'ok') return ''
  return outcome.state === 'unavailable' ? outcome.message : `${outcome.message}（${outcome.code}）`
}

/**
 * 写操作专用：成功就交出 value，失败就抛真实错误。
 * ActionButton 会把抛出来的 message 原样显示成红字 —— 失败必须看得见，绝不能静默当成功。
 */
export async function orgPanelWrite<T = unknown>(
  rpc: OrgPanelRpc | null | undefined,
  endpoint: string,
  payload: unknown = {},
): Promise<T> {
  const outcome = await callOrgPanel<T>(rpc, endpoint, payload)
  if (outcome.state === 'ok') return outcome.value
  throw new Error(outcomeMessage(outcome))
}
