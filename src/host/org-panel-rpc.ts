// 「赛博公司」/org-panel RPC 频道（host 侧）。
//
// 这条通道解决的是一个具体的、老板亲眼看到的问题：空 Session 打开「公司设置」，
// 六个页签全是 0 / 未知 —— 因为面板过去只能从会话里的 tool-result 反推数据，
// 而老板还没让任何员工跑过工具。有了频道之后，设置中心一打开就能读到真实台账。
//
// ---------------------------------------------------------------------------
// 信任边界（这一段是安全设计，改代码前先读完）
// ---------------------------------------------------------------------------
// 1. `authority: 'loopback'` —— DSH 的 HostConnectionService 对 loopback 频道把
//    trustedHosts 置为空数组，非回环来源一律 403。设置中心是本机操作，不放宽。
// 2. **LLM 没有 RPC。** 模型能碰到的只有 Tool Registry；`ctx.connection` 是 host 侧
//    cordis 服务，工具执行上下文里拿不到它。所以这条通道天然把「人类在浏览器里点的那一下」
//    和「模型发起的工具调用」分在两个不同的传输层上 —— 它不是给审批开的后门，
//    恰恰相反，它是第一次让「人类点击」有了一条真实、且模型走不通的路。
// 3. 因此写端点（plugins/approve 等）**没有放宽任何审批语义**：
//    PluginRuntime.approve() 的调用方仍然只有 UI / CLI / 配置预批准。
//    tests/org-panel-rpc.test.mjs 里有一条专门的反向用例证明这一点。
//
// ---------------------------------------------------------------------------
// 注册时机（这一段是实测结论，不要凭直觉改回去）
// ---------------------------------------------------------------------------
// HostConnectionService.rpc.handle() 的实现最后一行是
//   `owner.effect(() => owner.httpServer.register(route), …)`
// 而 `owner` 被绑成**读取 connection 服务的那个 context**。也就是说：
// 拿 rpc 的 context 自己必须能读到 `httpServer`，否则 effect 内部会抛
// `cannot get property "httpServer" without inject`。
//
// 又因为 cordis 的 Inject.resolve 把 inject 数组每一项都当**必需**依赖、没有 optional 形式，
// 我们不能把 httpServer / connection 加进插件顶层的 `export const inject`
// （那会让整个赛博公司在没有 httpServer 的部署形态下彻底装不上）。
//
// 所以唯一正确的写法是子 fiber：`ctx.inject(['httpServer', 'connection'], child => …)`。
// 两个服务任缺其一，回调就不执行 —— 安静降级，apply() 照常返回完整 host，
// 面板回落到既有的「LLM 调 company_snapshot 工具」路径，行为与今天完全一致。
import { readCtxService } from '../runtime/ctx-service'

/** 频道名。CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/，且不能是保留的 '/api'。 */
export const ORG_PANEL_CHANNEL = '/org-panel'

/**
 * 一个 endpoint 的实现。返回值即 RpcResult 的 value；抛异常由分发器折成 error 分支。
 * endpoint 名里的每一段都必须匹配 DSH 的 /^[A-Za-z0-9_$.-]+$/，所以只能用 `a/b` 这种形状。
 */
export type OrgPanelEndpoint = (payload: any, signal?: AbortSignal) => unknown | Promise<unknown>

export type EndpointMap = Record<string, OrgPanelEndpoint>

/** 本频道会用到的错误码。DSH 的 RpcErrorCode 是封闭联合，我们只用这三个通用码。 */
export type OrgPanelRpcErrorCode = 'bad-request' | 'internal' | 'cancelled'

type RpcResultLike =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: OrgPanelRpcErrorCode; message: string; details: Record<string, unknown> } }

function errorResult(code: OrgPanelRpcErrorCode, message: string): RpcResultLike {
  // bad-request 的 details 形状是 { issues }，其余两个是空对象；不导入受限包，按契约手写。
  return { ok: false, error: { code, message, details: code === 'bad-request' ? { issues: [] } : {} } }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 把 EndpointMap 折成 DSH 的 ConnectionRpcHandler。
 * 约定：未知 endpoint → bad-request；handler 抛异常 → internal（并把真实原因原样带出去，
 * 不吞、不改写成「操作失败」这类既没信息又像在遮掩的话术）。
 */
export function createDispatcher(endpoints: EndpointMap, logger?: any) {
  return async (endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResultLike> => {
    const handler = endpoints[endpoint]
    if (!handler) return errorResult('bad-request', `未知的 /org-panel endpoint：${endpoint}`)
    try {
      const value = await handler(payload as any, signal)
      return { ok: true, value: value === undefined ? null : value }
    } catch (error) {
      if (signal?.aborted) return errorResult('cancelled', '调用已取消')
      const detail = errorText(error)
      logger?.warn?.(`dsh-org-panel: /org-panel ${endpoint} 失败：${detail}`)
      return errorResult('internal', detail)
    }
  }
}

export type OrgPanelChannelHandle = {
  /** 频道当前是否真的挂上了 HTTP 路由。false = 这套部署没有 httpServer/connection。 */
  registered(): boolean
  /** 卸载：插件 unload 时必须调用，否则重载会重复注册。 */
  dispose(): Promise<void>
}

/**
 * 声明 /org-panel 频道。**任何情况下都不抛异常**：
 * 拿不到 connection / httpServer 就安静地什么都不做，让整套插件照常工作。
 */
export function registerOrgPanelChannel(ctx: any, endpoints: EndpointMap): OrgPanelChannelHandle {
  const logger = readCtxService<any>(ctx, 'logger')
  const dispatch = createDispatcher(endpoints, logger)
  let channelDispose: (() => Promise<void> | void) | null = null
  let live = false

  const attach = (host: any): (() => Promise<void> | void) | undefined => {
    const rpc = (readCtxService<any>(host, 'connection') || {}).rpc
    if (!rpc || typeof rpc.handle !== 'function') return undefined
    try {
      const off = rpc.handle(ORG_PANEL_CHANNEL, dispatch, { authority: 'loopback' })
      live = true
      logger?.info?.(`dsh-org-panel: 已注册 ${ORG_PANEL_CHANNEL} RPC 频道（authority=loopback，${Object.keys(endpoints).length} 个 endpoint），设置中心可以直接读真实台账了。`)
      channelDispose = () => { live = false; return typeof off === 'function' ? off() : undefined }
      return channelDispose
    } catch (error) {
      // 频道名非法 / 已被占用等：如实写日志，不拖垮插件。
      logger?.warn?.(`dsh-org-panel: 注册 ${ORG_PANEL_CHANNEL} RPC 频道失败：${errorText(error)}`)
      return undefined
    }
  }

  logger?.info?.(`dsh-org-panel: 已声明 ${ORG_PANEL_CHANNEL} 频道，等待 httpServer + connection 两个服务就位。`)

  // cordis 宿主：走子 fiber，两个服务都到齐才注册（见文件头注释）。
  if (typeof ctx?.inject === 'function') {
    let fiber: any = null
    try {
      fiber = ctx.inject(['httpServer', 'connection'], (child: any) => attach(child))
    } catch (error) {
      logger?.warn?.(`dsh-org-panel: 声明 ${ORG_PANEL_CHANNEL} 频道失败：${errorText(error)}`)
    }
    return {
      registered: () => live,
      dispose: async () => {
        try { await fiber?.dispose?.() } catch { /* 卸载失败不许拖住整个插件的卸载 */ }
        // 宿主实现万一没有把子 fiber 的 effect 收走，这里再补一刀（disposer 是幂等的）。
        try { await channelDispose?.() } catch { /* 同上 */ }
        live = false
      },
    }
  }

  // 非 cordis 宿主（单测夹具 / 直接挂载）：ctx 是普通对象，直接读 connection 即可。
  const off = attach(ctx)
  return {
    registered: () => live,
    dispose: async () => { try { await off?.() } catch { /* 同上 */ } live = false },
  }
}
