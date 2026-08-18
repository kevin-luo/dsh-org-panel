// host 装配自举（本轮 T0）。
//
// 这一组用例守住一件事：**插件在真实 cordis Context 上真的装得起来**。
//
// 为什么既有的 105 条一条都没发现问题：它们喂给 apply() 的 ctx 是普通对象字面量
// （tests/runtime-wiring.test.mjs 的 bench()）。而 DSH / cordis 4 的 Context 是带 inject
// 校验的 Proxy，有两条只有真实现才有的规则：
//   1. 读没在 inject 里声明过的自定义属性 → 抛「cannot get property "x" without inject」；
//   2. 插件 apply() 的返回值被当 **effect** 处理，普通对象 → TypeError('Invalid effect')，fiber 直接进失败态。
// 三处独立缺陷（host-v3 的 ctx.companyEventBus、apply 的返回值、gateway 的急求值候选数组）
// 叠在一起的后果是：Model Gateway / Plugin Runtime / 通讯层**从来没有挂载成功过**，
// 所以模型配置、插件审批台账、通讯状态一个字节都没被写过 —— 不是「写了但前端读不到」。
//
// 所以这里一律跑真 cordis，不再手搓 ctx 夹具。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { realCordisCtx, scratch, settleFiber } from './_helpers.mjs'

const { apply, inject } = await import('../lib/index.js')
const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** 在真 cordis root 上装一次插件，返回 fiber + apply() 的真实返回值。 */
async function boot(name, config = {}, services = {}) {
  const dir = await scratch(name)
  const { root, logs, registered } = realCordisCtx(services)
  let host
  let thrown = null
  const fiber = root.plugin({
    name: 'dsh-org-panel',
    inject,
    apply(ctx, cfg) {
      try { host = apply(ctx, cfg) } catch (error) { thrown = error; throw error }
      return host
    },
  }, {
    memoryFile: join(dir, 'evolution.json'),
    companyFile: join(dir, 'company.json'),
    approvalsFile: join(dir, 'plugin-approvals.json'),
    healthCheckOnStart: false,
    ...config,
  })
  await settleFiber(fiber)
  return { dir, root, fiber, host, logs, registered, thrown }
}

// ---------------------------------------------------------------------------
// B1：fiber 必须活着
// ---------------------------------------------------------------------------

test('B1 真实 cordis Context 上装载后 fiber 处于活跃态，apply 不抛', async () => {
  const { fiber, thrown } = await boot('bootstrap-alive')
  assert.equal(thrown, null, `apply() 不许在真实 Context 上抛异常：${thrown && thrown.message}`)
  // cordis 的 fiber.state：2 = active，3 = failed。修复前这里稳定是 3。
  assert.equal(fiber.state, 2, 'fiber 必须是活跃态；失败态意味着能力层一层都没挂上')
})

// ---------------------------------------------------------------------------
// B2：三层能力对应的工具必须真的进 Tool Registry
// ---------------------------------------------------------------------------

test('B2 Plugin Runtime / Model Gateway 的工具全部注册，不再只剩 host-v2 那 10 个', async () => {
  const { registered } = await boot('bootstrap-tools')
  const names = [...registered.keys()]
  for (const expected of [
    // host-v2 核心（修复前唯一还在的一批，因为它们是裸 tools.register，抛异常前就已落地）
    'staff_chat', 'company_snapshot', 'staff_plugin_market_search',
    // Plugin Runtime：修复前一个都没有
    'staff_plugin_install_request', 'staff_plugin_install_apply', 'staff_plugin_verify',
    'staff_plugin_health_check', 'staff_skill_evidence',
    // Model Gateway：修复前一个都没有
    'vision_analyze', 'company_model_list', 'company_model_config', 'company_model_test', 'company_model_bind',
  ]) {
    assert.ok(names.includes(expected), `${expected} 没有注册；能力层没挂上 = 老板看到「模型 0 / 插件 0」`)
  }
})

// ---------------------------------------------------------------------------
// B3：句柄上的四层实例
// ---------------------------------------------------------------------------

test('B3 apply() 返回的句柄带着真实的 gateway 与 plugins 实例', async () => {
  const { host } = await boot('bootstrap-handle')
  assert.ok(host, 'apply() 必须返回句柄')
  assert.equal(typeof host, 'function', '返回值必须是 cordis 合法 effect（函数 = disposer），否则 fiber 直接失败')
  assert.ok(host.core, 'core 必须在')
  assert.ok(host.gateway, 'Model Gateway 必须挂上（修复前恒为 undefined）')
  assert.ok(host.plugins, 'Plugin Runtime 必须挂上（修复前恒为 null）')
})

// ---------------------------------------------------------------------------
// B4：通讯层
// ---------------------------------------------------------------------------

test('B4 喂真实 communication 配置时通讯层必须挂上', async () => {
  const { host } = await boot('bootstrap-comm', {
    communication: {
      adapters: [{
        id: 'feishu', platform: 'feishu', enabled: false, connectionMode: 'long-conn',
        credentials: { appId: 'env:TEST_FEISHU_APP_ID', appSecret: 'env:TEST_FEISHU_APP_SECRET' },
      }],
    },
  })
  assert.ok(host.communication, 'registerCommunication 修复前必定返回 undefined（resolveEventSink 在 try 块里抛）')
  const summary = await host.communication.summary()
  assert.equal(summary.adapters.length, 1)
  // 没配密钥就是没配：如实报 configured=false，不给好看的默认值。
  assert.equal(summary.adapters[0].credentials.every((item) => item.configured), false)
})

test('B4b 没有 communication 配置时通讯层安静降级，不影响其他层', async () => {
  const { host, fiber } = await boot('bootstrap-comm-off')
  assert.equal(fiber.state, 2)
  const summary = await host.communication.summary()
  assert.equal(summary.configured, false, '没配就是没配，不许显示成已配置')
  assert.deepEqual(summary.adapters, [])
})

// ---------------------------------------------------------------------------
// B5：门禁 —— src 里不许再出现裸 ctx.<自定义属性>
// ---------------------------------------------------------------------------

/** cordis Context 本身提供的 mixin / 内建成员，读它们不需要 inject。 */
const CORDIS_MEMBERS = new Set([
  'get', 'set', 'provide', 'accessor', 'mixin', 'alias', 'reflect', 'inject', 'effect', 'fiber', 'registry',
  'events', 'plugin', 'on', 'once', 'off', 'emit', 'parallel', 'serial', 'bail', 'waterfall', 'logger',
  'root', 'scope', 'config', 'extend', 'intercept', 'isolate', 'name',
])
/** 本插件在 inject 数组里真实声明过的服务。 */
const DECLARED_INJECT = new Set(['tools', 'subagents', 'systemPrompt'])

function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { out.push(...sourceFiles(full)); continue }
    if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(full)
  }
  return out
}

/** 注释里写「以前这里读 ctx.approvals」是文档，不是代码。扫描前先把注释去掉。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

test('B5 门禁：src 里不许再出现裸 ctx.<未声明服务> 的读或写', () => {
  const offenders = []
  for (const file of sourceFiles(join(REPO, 'src'))) {
    const code = stripComments(readFileSync(file, 'utf-8'))
    for (const match of code.matchAll(/\bctx\??\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
      const property = match[1]
      if (CORDIS_MEMBERS.has(property) || DECLARED_INJECT.has(property)) continue
      offenders.push(`${relative(REPO, file)} → ctx.${property}`)
    }
  }
  assert.deepEqual(
    offenders, [],
    '真实 cordis Context 上裸读/写未声明属性会抛异常；请改用 readCtxService(ctx, name) 或把服务写进 inject。',
  )
})

// ---------------------------------------------------------------------------
// B6：dispose
// ---------------------------------------------------------------------------

test('B6 卸载插件时 apply() 返回的 disposer 被 cordis 真的调用', async () => {
  const { root, fiber } = await boot('bootstrap-dispose')
  assert.equal(fiber.state, 2)
  await fiber.dispose()
  // 4 = disposed。真正的意义在于：cordis 认得这个返回值，才谈得上卸载清理。
  assert.notEqual(fiber.state, 2, '卸载后 fiber 不该还是活跃态')
  assert.ok(root)
})
