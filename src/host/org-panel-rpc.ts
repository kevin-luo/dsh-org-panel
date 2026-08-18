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
// 注册时机（这一段是**真实 DSH 实测**结论，不要凭直觉或凭 typings 改回去）
// ---------------------------------------------------------------------------
// 曾经这里写的是 `ctx.inject(['httpServer', 'connection'], …)`，理由是
// 「HostConnectionService.rpc.handle() 最后一行是 owner.effect(() => owner.httpServer.register(route))，
// 所以读 rpc 的 context 自己必须能读到 httpServer」。两句话各错一半，代价是浏览器里
// 16 条 405 —— /org-panel 从来没被挂成 HTTP 路由，设置中心六个页签全空。
//
// 实测（dsh 0.1.0-rc.7，把 ctx.reflect.props 全量打出来）：
//   1. **宿主根本没有名叫 `httpServer` 的服务。** 真实服务名是 `webServer`
//      （@deepseek-ai/dsh-host-webserver 的 `super(ctx, 'webServer')`）。
//      scratchpad 里那份 0.0.1-rc.1 的 .d.ts 写的是 httpServer —— 它是旧版本，
//      拿它对服务名等于拿一张过期的地图。
//      而 cordis 的 inject 全是**必需**依赖：多写一个宿主没有的名字，子 fiber 就永远停在
//      PENDING，回调一次都不执行，**没有任何人报错**。这就是 405 的全部原因。
//   2. 那半句「读 rpc 的 context 必须自己能读到 web 服务」也是错的。cordis 的
//      createShadow() 把 Service 取值器里的 `this.ctx` 绑成
//      `读取方 ctx.extend({ [cordis.shadow]: 服务自己的 ctx })`，而 ReflectService 的
//      属性解析走的是 `(ctx[shadow] ?? ctx).fiber` —— 也就是说 `owner.webServer` 是从
//      **connection 自己那个 fiber** 的 store 里取的（connection 的 inject 就是 ['webServer']），
//      跟我们这边 inject 了什么毫无关系。实测佐证：修好之后 attach() 里
//      `host.httpServer` / `host.webServer` 依然抛 `cannot get property … without inject`，
//      而 `rpc.handle()` 照样把路由挂上了，curl /org-panel/company/snapshot 返回 200。
//
// 所以这里**只 inject 我们真正调用的那一个服务：`connection`**。
// web 服务由 connection 自己负责，我们不替它声明，也就不会再被它的服务名改名波及。
//
// 又因为 Inject.resolve 没有 optional 形式，connection 也不能进插件顶层的
// `export const inject`（那会让整个赛博公司在没有浏览器传输层的部署形态下彻底装不上），
// 所以仍然走子 fiber：connection 缺席时回调不执行 —— 安静降级，apply() 照常返回完整 host，
// 面板回落到既有的「LLM 调 company_snapshot 工具」路径。
//
// 但「安静」不等于「无声」：CHANNEL_REQUIRES 里任何一项宿主没提供时，
// 下面的 watchdog 会把缺的那个名字原样写进日志。这次 405 之所以查了这么久，
// 就是因为当时没有这一行。
import { readCtxService } from '../runtime/ctx-service'

/** 频道名。CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/，且不能是保留的 '/api'。 */
export const ORG_PANEL_CHANNEL = '/org-panel'

/**
 * 频道子 fiber 的依赖服务名 —— 只有一项，而且必须是宿主真实提供的名字。
 *
 * 这个常量存在的唯一理由是：cordis 的 inject 是必需依赖，写错一个名字就是永久 PENDING
 * 且零报错。把它单独拎出来，是为了让回归测试能直接断言「这里面的每一个名字，
 * 真实宿主都提供得出来」，而不是再靠 typings 或记忆去核对。
 */
export const CHANNEL_REQUIRES = ['connection'] as const

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
  /** 频道当前是否真的挂上了 HTTP 路由。false = 这套部署没有 connection 传输层。 */
  registered(): boolean
  /** 子 fiber 依赖的服务名（= CHANNEL_REQUIRES）。宿主少给一个，频道就永远挂不上。 */
  readonly requires: readonly string[]
  /** 没挂上时的**真实**原因；已挂上时为 null。绝不返回「未知错误」这种等于没说的话。 */
  pendingReason(): string | null
  /** 卸载：插件 unload 时必须调用，否则重载会重复注册。 */
  dispose(): Promise<void>
}

/**
 * 声明 /org-panel 频道。**任何情况下都不抛异常**：
 * 拿不到 connection 就安静地什么都不做，让整套插件照常工作。
 */
export function registerOrgPanelChannel(ctx: any, endpoints: EndpointMap): OrgPanelChannelHandle {
  const logger = readCtxService<any>(ctx, 'logger')
  const dispatch = createDispatcher(endpoints, logger)
  let channelDispose: (() => Promise<void> | void) | null = null
  let live = false
  let failure: string | null = null

  const attach = (host: any): (() => Promise<void> | void) | undefined => {
    const connection = readCtxService<any>(host, 'connection')
    if (connection === undefined) {
      // 这套部署没有浏览器传输层。不是错误，也不写 warn —— 安静降级就是预期行为。
      failure = `宿主没有提供 connection 服务，${ORG_PANEL_CHANNEL} 频道未挂载`
      return undefined
    }
    const rpc = connection.rpc
    if (!rpc || typeof rpc.handle !== 'function') {
      failure = 'connection 服务在场但没有 rpc.handle()：这套宿主的传输层与 DSH 不同构'
      logger?.warn?.(`dsh-org-panel: ${failure}`)
      return undefined
    }
    try {
      const off = rpc.handle(ORG_PANEL_CHANNEL, dispatch, { authority: 'loopback' })
      live = true
      failure = null
      logger?.info?.(`dsh-org-panel: 已注册 ${ORG_PANEL_CHANNEL} RPC 频道（authority=loopback，${Object.keys(endpoints).length} 个 endpoint），设置中心可以直接读真实台账了。`)
      channelDispose = () => { live = false; return typeof off === 'function' ? off() : undefined }
      return channelDispose
    } catch (error) {
      // 频道名非法 / 已被占用 / connection 自己读不到 web 服务：如实写日志，不拖垮插件。
      failure = `注册 ${ORG_PANEL_CHANNEL} 频道时 connection.rpc.handle() 抛了：${errorText(error)}`
      logger?.warn?.(`dsh-org-panel: ${failure}`)
      return undefined
    }
  }

  /** 哪些依赖宿主压根没提供。这就是「永久 PENDING」唯一可能的原因。 */
  const missingServices = (): string[] => CHANNEL_REQUIRES.filter((name) => readCtxService(ctx, name) === undefined)

  logger?.info?.(`dsh-org-panel: 已声明 ${ORG_PANEL_CHANNEL} 频道，等待 ${CHANNEL_REQUIRES.join(' + ')} 就位。`)

  // cordis 宿主：走子 fiber（见文件头注释）。
  if (typeof ctx?.inject === 'function') {
    let fiber: any = null
    try {
      fiber = ctx.inject([...CHANNEL_REQUIRES], (child: any) => attach(child))
    } catch (error) {
      failure = `声明 ${ORG_PANEL_CHANNEL} 频道失败：${errorText(error)}`
      logger?.warn?.(`dsh-org-panel: ${failure}`)
    }

    // watchdog：子 fiber settle 之后如果还没挂上，把**缺哪个服务名**原样写进日志。
    // 少了这一行，服务改名（httpServer → webServer）就只会表现为浏览器里一片 405，
    // host 侧安静得像什么都没发生 —— 这次的 bug 就是这么藏了一整轮的。
    if (fiber) {
      Promise.resolve(fiber).then(() => {
        if (live) return
        const missing = missingServices()
        failure ??= missing.length
          ? `宿主没有提供 ${missing.join(' / ')} 服务，${ORG_PANEL_CHANNEL} 频道未挂载`
          : `${CHANNEL_REQUIRES.join(' / ')} 都在，但子 fiber 没有激活（state=${String(fiber?.state)}）`
        logger?.warn?.(`dsh-org-panel: ${failure}；设置中心将回落到「LLM 调 company_snapshot 工具」这条老路。`)
      }).catch(() => { /* watchdog 自己出问题不许影响插件 */ })
    }

    return {
      registered: () => live,
      requires: CHANNEL_REQUIRES,
      pendingReason: () => (live ? null : failure ?? `等待 ${CHANNEL_REQUIRES.join(' / ')} 服务就位`),
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
    requires: CHANNEL_REQUIRES,
    pendingReason: () => (live ? null : failure),
    dispose: async () => { try { await off?.() } catch { /* 同上 */ } live = false },
  }
}
