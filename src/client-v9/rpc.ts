// 「赛博公司」client → host RPC 通道。
//
// /org-panel 是本插件自己的 Control Plane；同时允许通过同一个 DSH connection.rpc
// 调用其它已安装插件公开的 RPC 频道（例如 @xmanrui/dsh-im 的 /weixin、/qq、/feishu）。
// 这样赛博公司可以复用成熟的 DSH 生态能力，而不必把第三方协议实现复制进本仓库。

/** host 侧 src/host/org-panel-rpc.ts 注册的频道名。改名必须两边一起改。 */
export const ORG_PANEL_CHANNEL = '/org-panel'

/** 只依赖 call 这一个方法，避免把 DSH 的 restricted client 类型 import 进 browser bundle。 */
export type OrgPanelRpc = {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

/**
 * 三态结果：
 *   ok          —— host 应答且业务成功；
 *   error       —— 频道是通的，但这次调用失败；
 *   unavailable —— 连一个合法 RPC 信封都没拿回来：频道没注册 / 传输层不可用 / 网络断。
 */
export type RpcOutcome<T> =
  | { state: 'ok'; value: T }
  | { state: 'error'; code: string; message: string }
  | { state: 'unavailable'; message: string }

export const NO_CONNECTION = '当前运行时没有给 client 提供 connection 服务，面板无法直接读写 host'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || String(error)
  return error === undefined || error === null ? '未说明的错误' : String(error)
}

function validChannel(channel: string): boolean {
  return /^\/[A-Za-z0-9._~-]+$/.test(channel)
}

function channelDown(channel: string): string {
  return `host 没有应答 ${channel} 频道（对应插件未安装 / host 未挂载，或该部署形态没有 webServer 传输层）`
}

/**
 * 从 client 侧 cordis Context 上取宿主已经创建好的通用 RPC 调用器。
 * 不 import @deepseek-ai/dsh-client-connection 的内部实现，避免 restricted 包解析失败。
 */
export function resolveOrgPanelRpc(ctx: any): OrgPanelRpc | null {
  try {
    const connection = ctx && typeof ctx.get === 'function' ? ctx.get('connection') : undefined
    const rpc = connection?.rpc
    return setCurrentOrgPanelRpc(rpc && typeof rpc.call === 'function' ? (rpc as OrgPanelRpc) : null)
  } catch {
    return setCurrentOrgPanelRpc(null)
  }
}

let currentRpc: OrgPanelRpc | null = null

export function currentOrgPanelRpc(): OrgPanelRpc | null { return currentRpc }

export function setCurrentOrgPanelRpc(rpc: OrgPanelRpc | null): OrgPanelRpc | null {
  currentRpc = rpc
  return rpc
}

/**
 * 通用 DSH 插件 RPC 调用口。
 *
 * 关键边界：
 * - 只允许 DSH 合法的单段频道名，避免调用方把任意 URL 当 RPC 目标；
 * - 不吞业务错误；
 * - 不因为第三方频道不存在就把 /org-panel 判离线。
 */
export async function callRpcChannel<T = unknown>(
  rpc: OrgPanelRpc | null | undefined,
  channel: string,
  endpoint: string,
  payload: unknown = {},
  signal?: AbortSignal,
): Promise<RpcOutcome<T>> {
  if (!rpc || typeof rpc.call !== 'function') return { state: 'unavailable', message: NO_CONNECTION }
  if (!validChannel(channel)) return { state: 'error', code: 'bad-channel', message: `非法 RPC 频道：${channel}` }
  if (!endpoint || typeof endpoint !== 'string') return { state: 'error', code: 'bad-endpoint', message: 'RPC endpoint 不能为空' }

  let raw: unknown
  try {
    raw = await rpc.call(channel, endpoint, payload === undefined ? {} : payload, signal)
  } catch (error) {
    if (signal?.aborted) return { state: 'error', code: 'aborted', message: `${channel}/${endpoint} 调用已取消` }
    return { state: 'unavailable', message: `${channelDown(channel)}：${errorMessage(error)}` }
  }

  const result = raw as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } } | null
  if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
    return { state: 'error', code: 'malformed', message: `${channel}/${endpoint} 返回了面板不认识的结构` }
  }
  if (result.ok === true) return { state: 'ok', value: result.value as T }
  const error = result.error || {}
  return {
    state: 'error',
    code: String(error.code ?? 'unknown'),
    message: String(error.message ?? `${channel}/${endpoint} 调用失败`),
  }
}

/** 本插件 /org-panel 的兼容封装。 */
export function callOrgPanel<T = unknown>(
  rpc: OrgPanelRpc | null | undefined,
  endpoint: string,
  payload: unknown = {},
  signal?: AbortSignal,
): Promise<RpcOutcome<T>> {
  return callRpcChannel<T>(rpc, ORG_PANEL_CHANNEL, endpoint, payload, signal)
}

export function outcomeMessage(outcome: RpcOutcome<unknown>): string {
  if (outcome.state === 'ok') return ''
  return outcome.state === 'unavailable' ? outcome.message : `${outcome.message}（${outcome.code}）`
}

/** 任意已安装 DSH 插件频道的写操作：成功返回 value，失败抛真实错误。 */
export async function rpcChannelWrite<T = unknown>(
  rpc: OrgPanelRpc | null | undefined,
  channel: string,
  endpoint: string,
  payload: unknown = {},
): Promise<T> {
  const outcome = await callRpcChannel<T>(rpc, channel, endpoint, payload)
  if (outcome.state === 'ok') return outcome.value
  throw new Error(outcomeMessage(outcome))
}

/** /org-panel 写操作兼容封装。 */
export function orgPanelWrite<T = unknown>(
  rpc: OrgPanelRpc | null | undefined,
  endpoint: string,
  payload: unknown = {},
): Promise<T> {
  return rpcChannelWrite<T>(rpc, ORG_PANEL_CHANNEL, endpoint, payload)
}
