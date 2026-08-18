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
 * services 里额外的键会被一并 provide。
 *
 * 注意：**浏览器传输层（webServer / connection）不要从这里传**。
 * 在 root 上 provide 等于把服务塞进 root fiber 的 store，于是任何 fiber 都能读到它 ——
 * 那正是让「插件 inject 了一个宿主根本没有的服务名」这种 bug 溜过单测的漏洞。
 * 传输层一律用下面的 dshWebStack()，它按真实 DSH 的形态各自起一个 fiber。
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
 * 按**真实 DSH 的形态**装一套浏览器传输栈。这个夹具是本轮 405 事故的直接产物，
 * 三条形态特征一条都不能省，否则它又会变成一层假保险：
 *
 *  1. **服务名叫 `webServer`，不叫 `httpServer`。**
 *     @deepseek-ai/dsh-host-webserver@0.1.0-rc.7 的 lib/index.js 第 36 行是
 *     `super(ctx, "webServer")`；只有 0.0.1-rc.1 那份旧 .d.ts 里写的是 httpServer。
 *     旧夹具跟着旧 typings 用了 httpServer，于是「插件 inject 了一个宿主没有的名字」
 *     这件事在单测里永远暴露不出来 —— 因为夹具提供的正好是同一个错名字。
 *  2. **两个服务各自由自己的 plugin fiber 提供，不在 root 上 provide。**
 *     root.provide() 会把服务写进 root fiber 的 store，任何 fiber 都读得到；
 *     真实 DSH 里 webServer 只有 connection 自己的 fiber 读得到（它 inject 了它）。
 *     org-panel 那个 fiber 读 webServer 一定抛 —— 而且**本来就该抛**，因为
 *     connection.rpc.handle() 是通过 cordis 的 shadow 机制回到它自己的 fiber 去取的。
 *  3. **connection 声明 `inject: ['webServer']`**，与真实现一致：没有 webServer 时
 *     connection 自己都起不来，更不会有半截可用的传输层。
 *
 * @param options.webServer  是否提供 webServer 服务
 * @param options.connection 是否提供 connection 服务
 * @param options.connectionInject connection 是否 inject webServer。置 false 用来构造
 *   「传输层残缺」的宿主：connection 在，但它的 effect 读不到 webServer，handle() 当场抛。
 * @param options.webServerName 服务名。默认 'webServer'；传别的名字可以模拟 DSH 再次改名。
 */
export async function dshWebStack(root, { webServer = true, connection = true, connectionInject = true, webServerName = 'webServer' } = {}) {
  const routes = []
  const calls = []
  const service = {
    register(route) {
      routes.push(route)
      return () => { const index = routes.indexOf(route); if (index >= 0) routes.splice(index, 1) }
    },
    registerUpgrade() { return () => {} },
  }

  if (webServer) {
    await root.plugin({ name: 'fake-webserver', apply(ctx) { ctx.provide(webServerName, service) } })
  }
  if (connection) {
    await root.plugin({
      name: 'fake-connection',
      inject: connectionInject ? [webServerName] : [],
      apply(ctx) {
        class FakeConnection extends CordisService {
          get rpc() {
            // 与真实现逐字同构：owner 是 cordis 给取值器造的 shadow context，
            // 它的 webServer 走的是 (ctx[shadow] ?? ctx).fiber —— 即 connection 自己这个 fiber。
            const owner = this.ctx
            return {
              handle(channel, handler, options) {
                calls.push({ channel, options, handler })
                return owner.effect(
                  () => owner[webServerName].register({ kind: 'prefix', path: channel, handler }),
                  `fake-connection: ${channel}`,
                )
              },
            }
          }
        }
        new FakeConnection(ctx, 'connection')
      },
    })
  }
  return { routes, calls }
}

/** 等 cordis fiber settle（inject 子 fiber 是异步 resolve 的）。 */
export async function settleFiber(fiber, ms = 60) {
  try { await fiber } catch { /* 失败态由用例自己断言 fiber.state */ }
  await new Promise((resolve) => setTimeout(resolve, ms))
  return fiber
}
