// host 装配自举：必须在真实 cordis Context 上完整挂载，并且旧的秘书星型路由不能再暴露。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { realCordisCtx, scratch, settleFiber } from './_helpers.mjs'

const { apply, inject } = await import('../lib/index.js')
const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..')

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

test('B1 真实 cordis Context 上装载后 fiber 处于活跃态，apply 不抛', async () => {
  const { fiber, thrown } = await boot('bootstrap-alive')
  assert.equal(thrown, null, `apply() 不许在真实 Context 上抛异常：${thrown && thrown.message}`)
  assert.equal(fiber.state, 2)
})

test('B2 Tool Registry 只暴露统一 company_work，不再暴露 staff_chat / staff_meeting', async () => {
  const { registered, host } = await boot('bootstrap-tools')
  const names = [...registered.keys()]
  for (const expected of [
    'company_work', 'company_snapshot', 'staff_plugin_market_search',
    'staff_plugin_install_request', 'staff_plugin_install_apply', 'staff_plugin_verify',
    'staff_plugin_health_check', 'staff_skill_evidence',
    'vision_analyze', 'company_model_list', 'company_model_config', 'company_model_test', 'company_model_bind',
  ]) {
    assert.ok(names.includes(expected), `${expected} 没有注册；能力层没有完整挂载`)
  }
  assert.equal(names.includes('staff_chat'), false, '旧的单员工星型入口必须从真实 Registry 消失')
  assert.equal(names.includes('staff_meeting'), false, '旧会议入口必须由统一 Work Orchestrator 取代')
  assert.ok(host.orchestrator, 'host 句柄必须暴露统一 Work Orchestrator')
})

test('B3 apply() 返回合法 disposer，并带齐 core / orchestrator / model / plugin 实例', async () => {
  const { host } = await boot('bootstrap-handle')
  assert.ok(host)
  assert.equal(typeof host, 'function')
  assert.ok(host.core)
  assert.ok(host.orchestrator)
  assert.ok(host.gateway)
  assert.ok(host.plugins)
})

test('B4 喂真实 communication 配置时通讯层必须挂上并使用 WorkRouter', async () => {
  const { host } = await boot('bootstrap-comm', {
    communication: {
      adapters: [{
        id: 'feishu', platform: 'feishu', enabled: false, connectionMode: 'long-conn',
        credentials: { appId: 'env:TEST_FEISHU_APP_ID', appSecret: 'env:TEST_FEISHU_APP_SECRET' },
      }],
    },
  })
  assert.ok(host.communication)
  assert.equal(host.communication.router.hasDispatcher(), true, '通讯层必须直接接 Work Orchestrator')
  const summary = await host.communication.summary()
  assert.equal(summary.adapters.length, 1)
  assert.equal(summary.adapters[0].credentials.every((item) => item.configured), false)
  assert.equal(summary.maxWorkgroupSize, 4)
})

test('B4b 没有 communication 配置时通讯层安静降级，不影响其他层', async () => {
  const { host, fiber } = await boot('bootstrap-comm-off')
  assert.equal(fiber.state, 2)
  const summary = await host.communication.summary()
  assert.equal(summary.configured, false)
  assert.deepEqual(summary.adapters, [])
  assert.equal(summary.maxWorkgroupSize, 4)
})

const CORDIS_MEMBERS = new Set([
  'get', 'set', 'provide', 'accessor', 'mixin', 'alias', 'reflect', 'inject', 'effect', 'fiber', 'registry',
  'events', 'plugin', 'on', 'once', 'off', 'emit', 'parallel', 'serial', 'bail', 'waterfall', 'logger',
  'root', 'scope', 'config', 'extend', 'intercept', 'isolate', 'name',
])
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
  assert.deepEqual(offenders, [], '真实 cordis Context 上裸读/写未声明属性会抛异常；请走 readCtxService 或 inject。')
})

test('B6 卸载插件时 apply() 返回的 disposer 被 cordis 真的调用', async () => {
  const { root, fiber } = await boot('bootstrap-dispose')
  assert.equal(fiber.state, 2)
  await fiber.dispose()
  assert.notEqual(fiber.state, 2)
  assert.ok(root)
})
