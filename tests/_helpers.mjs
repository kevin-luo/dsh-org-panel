// 单元测试公共夹具。不是测试文件（不匹配 *.test.mjs），node --test 不会把它当用例跑。
//
// 统一口径：所有测试都跑 lib/index.js —— 也就是 npm pack 真正发出去的产物。
// 测发布产物而不是 src/*.ts，是因为仓库没有 TS test runner，而且这样能顺带守住
// 「该导出的东西有没有真的导出」这条线。
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 每个用例一个独立临时目录，绝不碰用户真实的 ~/.dsh-org-panel。 */
export async function scratch(name) {
  const dir = await mkdtemp(join(tmpdir(), `dsh-org-panel-${name}-`))
  await mkdir(dir, { recursive: true })
  return dir
}

/** 等待 Router 的串行队列 / fire-and-forget 分支跑完。 */
export function settle(ms = 40) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 1×1 透明 PNG：给 vision 用的真实合法图片，避免测试依赖网络或磁盘。 */
export const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export const PIXEL_PNG_IMAGE = { name: 'shot.png', mimeType: 'image/png', data: PIXEL_PNG_BASE64 }

/**
 * 造一个只有 tools 服务的假 ctx。names 就是当前 Tool Registry 里真实存在的工具名，
 * 形态与 DSH 的 tools.list() 一致（scanToolRegistry 会去探测 list/names/keys/entries/getAll）。
 */
export function fakeCtx(names, extra = {}) {
  const logs = []
  return {
    logs,
    tools: { list: () => names.map((name) => ({ name, description: `${name} tool` })) },
    logger: {
      info: (message) => logs.push(['info', message]),
      warn: (message) => logs.push(['warn', message]),
      error: (message) => logs.push(['error', message]),
      debug: (message) => logs.push(['debug', message]),
    },
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// 真实 cordis Context 夹具
//
// 为什么必须用真 Context 而不是手搓的普通对象：cordis 4 的 Context 是带 inject 校验的 Proxy，
// 它有两条规则只有真实现才有 ——
//   1. 读没在 inject 里声明过的自定义属性 → 抛「cannot get property "x" without inject」；
//   2. 插件 apply() 的返回值被当 effect 处理，普通对象 → 抛 TypeError('Invalid effect')。
// 这两条正是「105 个单测全绿、但 host 在真实宿主上一次都没装起来过」的成因。
// 拿普通对象字面量当 ctx 的夹具永远看不见它们，所以这里直接跑 node_modules 里那份真 cordis。
// ---------------------------------------------------------------------------
import { createRequire } from 'node:module'

const requireFromHere = createRequire(import.meta.url)
const cordisEntry = requireFromHere.resolve('@deepseek-ai/cordis')
const { Context: CordisContext, Service: CordisService } = await import(cordisEntry)

export { CordisContext, CordisService }

/**
 * 一个可观测的假 Tool Registry。register 收下的工具会进 registered，
 * list() 同时把 extra 里的「外部工具」一起报出去（scanToolRegistry 的真实输入形状）。
 */
export function toolRegistry(extra = []) {
  const registered = new Map()
  return {
    registered,
    service: {
      register(tool) { registered.set(tool.name, tool) },
      list() { return [...registered.values()].map((item) => ({ name: item.name, description: item.description })).concat(extra) },
    },
  }
}

/**
 * 造一个真 cordis root Context，并 provide 上 DSH 的三个必需服务。
 * services 里额外的键会被一并 provide（httpServer / connection 等）。
 */
export function realCordisCtx(services = {}) {
  const logs = []
  const root = new CordisContext()
  const registry = services.tools ? { registered: services.tools.registered, service: services.tools.service || services.tools } : toolRegistry()

  root.provide('tools', registry.service)
  root.provide('subagents', services.subagents || {
    list: () => ['spawn'],
    getProvider: (provider) => (provider === 'spawn' ? { name: provider } : undefined),
    async start() { return { id: 'run-1', result: Promise.resolve({ stopReason: 'completed', output: [] }), async dispose() {} } },
  })
  root.provide('systemPrompt', services.systemPrompt || { section() {} })
  root.provide('logger', {
    info: (message) => logs.push(['info', String(message)]),
    warn: (message) => logs.push(['warn', String(message)]),
    error: (message) => logs.push(['error', String(message)]),
    debug: () => {},
  })
  for (const [name, value] of Object.entries(services)) {
    if (['tools', 'subagents', 'systemPrompt'].includes(name)) continue
    root.provide(name, value)
  }
  return { root, logs, registered: registry.registered }
}

/**
 * 一个忠实复刻 DSH HostConnectionService 关键行为的假 connection 服务。
 *
 * 关键在 handle()：真实现最后一行是 `owner.effect(() => owner.httpServer.register(route))`，
 * 其中 owner 是**读取 connection 服务的那个 context**（Service 的 this.ctx 会被 getTraceable
 * 重绑到读它的那个 context）。也就是说读 rpc 的 context 自己必须能读到 httpServer，
 * 否则 effect 内部会抛「cannot get property "httpServer" without inject」。
 * 这个夹具用真 cordis Service 原样保留这条约束 —— 正是它让 R1 / R2 有意义。
 */
export function connectionService(root) {
  const calls = []
  class FakeConnection extends CordisService {
    get rpc() {
      const owner = this.ctx
      return {
        handle(channel, handler, options) {
          calls.push({ channel, options, handler })
          // 与真实现同构：owner.httpServer 是裸属性读，owner 没 inject 过 httpServer 就会抛。
          return owner.effect(() => owner.httpServer.register({ kind: 'prefix', path: channel, handler }), `fake-connection: ${channel}`)
        },
      }
    }
  }
  const instance = new FakeConnection(root, 'connection')
  return { calls, instance }
}

/** 一个只记账的假 httpServer 服务。routes 就是当前真实挂着的路由。 */
export function fakeHttpServer() {
  const routes = []
  return {
    routes,
    service: {
      register(route) { routes.push(route); return () => { const index = routes.indexOf(route); if (index >= 0) routes.splice(index, 1) } },
      unregister(route) { const index = routes.indexOf(route); if (index >= 0) routes.splice(index, 1) },
    },
  }
}

/** 等 cordis fiber settle（inject 子 fiber 是异步 resolve 的）。 */
export async function settleFiber(fiber, ms = 60) {
  try { await fiber } catch { /* 失败态由用例自己断言 fiber.state */ }
  await new Promise((resolve) => setTimeout(resolve, ms))
  return fiber
}
