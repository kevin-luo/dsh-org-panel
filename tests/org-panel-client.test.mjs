// `/org-panel` 通道的 **client 侧**用例（host 侧在 tests/org-panel-rpc.test.mjs）。
//
// 这一组守的是三件事，每一条都对应一个「面板会骗到老板」的真实洞：
//   C1 三种失败面一条都不许静默吞掉，也不许当成功
//      —— DSH 的 ClientConnectionRpc.call() 在 HTTP 非 2xx / rpcId 不匹配时**直接 throw**，
//         ?fixture 模式下任何非 '/api' 频道 Promise.reject，正常应答也可能是 { ok:false }。
//         只判 result.ok 是 bug。
//   C2 通道不可用（或还没探明）时，一个写操作都不下发 —— 降级形态必须与接 RPC 之前逐字一致，
//      「批准」按钮不许出现，那句诚实提示不许消失。
//   C3 host 说的「available:false + reason」不许被翻译成「暂无 / 未配置」。
//      「拿不到」和「一条都没有」是两件事，合并就是替 host 编结论。
//
// 口径同 ui-honesty.test.mjs：用 typescript 的 transpileModule 现编 src/client-v9/**，
// 跑的是真实组件与真实桥接层源码，不手搓替身。
import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import React from 'react'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const V9 = resolve(HERE, '..', 'src', 'client-v9')
const nodeRequire = createRequire(join(HERE, '..', 'package.json'))

const moduleCache = new Map()
// 1.2MB 的 base64 资产对本组用例毫无意义，用空表顶掉。
moduleCache.set(join(V9, 'generated-assets.ts'), { RUNTIME_ASSETS: {} })

function resolveFile(from, spec) {
  const base = resolve(dirname(from), spec)
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  throw new Error(`无法解析 ${spec}（来自 ${from}）`)
}

function loadTs(file) {
  const hit = moduleCache.get(file)
  if (hit) return hit
  const output = ts.transpileModule(readFileSync(file, 'utf-8'), {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const box = { exports: {} }
  moduleCache.set(file, box.exports)
  const req = (spec) => (spec.startsWith('.') ? loadTs(resolveFile(file, spec)) : nodeRequire(spec))
  new Function('module', 'exports', 'require', output)(box, box.exports, req)
  moduleCache.set(file, box.exports)
  return box.exports
}

const Rpc = loadTs(join(V9, 'rpc.ts'))
const Bridge = loadTs(join(V9, 'company-bridge.ts'))
const Plugins = loadTs(join(V9, 'settings', 'PluginSettings.tsx'))
const Models = loadTs(join(V9, 'settings', 'ModelSettings.tsx'))
const Communication = loadTs(join(V9, 'settings', 'CommunicationSettings.tsx'))

// --- 静态渲染（同 ui-honesty 的口径）----------------------------------------

const HOOKS = {
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useReducer: (_reducer, init) => [init, () => {}],
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useInsertionEffect: () => {},
  useContext: () => undefined,
  useDebugValue: () => {},
  useId: () => 'test-id',
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useTransition: () => [false, (fn) => fn()],
}

function withHooks(run, initial) {
  const hooks = initial
    ? { ...HOOKS, useState: (init) => { const value = typeof init === 'function' ? init() : init; return [initial.has(value) ? initial.get(value) : value, () => {}] } }
    : HOOKS
  const modern = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
  const legacy = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
  if (modern) {
    const prev = modern.H
    modern.H = hooks
    try { return run() } finally { modern.H = prev }
  }
  if (legacy?.ReactCurrentDispatcher) {
    const prev = legacy.ReactCurrentDispatcher.current
    legacy.ReactCurrentDispatcher.current = hooks
    try { return run() } finally { legacy.ReactCurrentDispatcher.current = prev }
  }
  throw new Error('这个 React 版本没有可挂载的 hooks dispatcher，测试无法静态渲染组件')
}

function renderNode(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return node
  if (Array.isArray(node)) return node.map(renderNode)
  if (typeof node !== 'object' || !node.props) return node
  if (typeof node.type === 'function') return renderNode(node.type(node.props))
  const props = {}
  for (const [key, value] of Object.entries(node.props)) props[key] = renderNode(value)
  return { ...node, props }
}

const render = (component, props, initial) => withHooks(() => renderNode(component(props)), initial)
const APPROVALS_TAB = new Map([['installed', 'approvals']])

function textOf(node) {
  const parts = []
  const walk = (item) => {
    if (item === null || item === undefined || typeof item === 'boolean') return
    if (Array.isArray(item)) { for (const child of item) walk(child); return }
    if (typeof item === 'string' || typeof item === 'number') { parts.push(String(item)); return }
    if (typeof item !== 'object' || !item.props) return
    for (const value of Object.values(item.props)) walk(value)
  }
  walk(node)
  return parts.join('\n')
}

// --- 假 rpc：每个端点由用例指定「怎么失败 / 怎么成功」-------------------------

function fakeRpc(handler) {
  const calls = []
  return {
    calls,
    rpc: {
      async call(channel, endpoint, payload) {
        calls.push({ channel, endpoint, payload })
        return handler(endpoint, payload)
      },
    },
  }
}

const ok = (value) => ({ ok: true, value })

// ---------------------------------------------------------------------------
// C1 三种失败面
// ---------------------------------------------------------------------------

test('org-panel client: HTTP 非 2xx 时 call() 直接 throw —— 必须翻成 unavailable 并带上原文，不许当成功', async () => {
  const { rpc } = fakeRpc(() => { throw new Error('transport failure for /org-panel/company/snapshot: HTTP 500') })
  const outcome = await Rpc.callOrgPanel(rpc, 'company/snapshot')
  assert.equal(outcome.state, 'unavailable')
  assert.match(outcome.message, /HTTP 500/, '真实错误原文不许被吞掉')
  assert.equal(outcome.value, undefined)
})

test('org-panel client: fixture 模式对非 /api 频道 Promise.reject —— 同样是 unavailable，不是「没有数据」', async () => {
  const { rpc } = fakeRpc(() => Promise.reject(new Error('fixture connection RPC channel "/org-panel" is unavailable')))
  const outcome = await Rpc.callOrgPanel(rpc, 'plugins/approvals')
  assert.equal(outcome.state, 'unavailable')
  assert.match(outcome.message, /fixture/)
})

test('org-panel client: host 正常应答但 { ok:false } —— 是 error 不是 unavailable，code / message 原样带出', async () => {
  const { rpc } = fakeRpc(() => ({ ok: false, error: { code: 'internal', message: '插件运行时没有挂载', details: {} } }))
  const outcome = await Rpc.callOrgPanel(rpc, 'plugins/approve', { requestId: 'r1' })
  assert.equal(outcome.state, 'error')
  assert.equal(outcome.code, 'internal')
  assert.equal(outcome.message, '插件运行时没有挂载')
  assert.match(Rpc.outcomeMessage(outcome), /internal/)
})

test('org-panel client: 根本没有 connection 服务时安静降级，不抛异常也不假装成功', async () => {
  for (const missing of [null, undefined, {}, { call: 1 }]) {
    const outcome = await Rpc.callOrgPanel(missing, 'company/snapshot')
    assert.equal(outcome.state, 'unavailable')
    assert.equal(outcome.message, Rpc.NO_CONNECTION)
  }
  assert.equal(Rpc.resolveOrgPanelRpc(undefined), null)
  assert.equal(Rpc.resolveOrgPanelRpc({ get: () => { throw new Error('without inject') } }), null)
  assert.equal(Rpc.resolveOrgPanelRpc({ get: () => ({ rpc: {} }) }), null, 'rpc 上没有 call 就等于没有通道')
  const real = { call: async () => ok(1) }
  assert.equal(Rpc.resolveOrgPanelRpc({ get: (name) => (name === 'connection' ? { rpc: real } : undefined) }), real)
})

test('org-panel client: 结构不认识的应答按 error 处理，绝不当成 value', async () => {
  const { rpc } = fakeRpc(() => ({ value: '看起来像数据但没有 ok 字段' }))
  const outcome = await Rpc.callOrgPanel(rpc, 'company/snapshot')
  assert.equal(outcome.state, 'error')
  assert.equal(outcome.code, 'malformed')
})

test('org-panel client: 写操作失败必须抛出去（红字给老板看），成功才交出 value', async () => {
  const { rpc, calls } = fakeRpc((endpoint) => (endpoint === 'plugins/approve'
    ? { ok: false, error: { code: 'bad-request', message: '缺少必填参数 requestId', details: {} } }
    : ok({ request: { status: 'approved' } })))
  await assert.rejects(() => Rpc.orgPanelWrite(rpc, 'plugins/approve', {}), /缺少必填参数 requestId/)
  assert.deepEqual(await Rpc.orgPanelWrite(rpc, 'plugins/reject', { requestId: 'r1' }), { request: { status: 'approved' } })
  assert.equal(calls[0].channel, '/org-panel')
})

// ---------------------------------------------------------------------------
// C2 通道不可用 / 未探明时，写操作一个都不下发
// ---------------------------------------------------------------------------

test('org-panel client: 通道 offline 或未探明时不下发任何写 action，降级形态与接 RPC 之前一致', () => {
  for (const channel of ['offline', 'unknown']) {
    const actions = Bridge.buildSettingsActions({
      channel, rpc: { call: async () => ok(1) }, refresh: () => 'x', openProfile: () => {},
    })
    assert.deepEqual(Object.keys(actions).sort(), ['employees', 'refresh'], `${channel}：只应保留 refresh + openProfile`)
    assert.equal(actions.plugins, undefined, '点了必然报错的按钮不许摆出来')
    assert.equal(actions.models, undefined)
  }
  const noRpc = Bridge.buildSettingsActions({ channel: 'online', rpc: null, refresh: () => 'x', openProfile: () => {} })
  assert.equal(noRpc.plugins, undefined)
})

test('org-panel client: 通道 online 时插件审批与模型控制动作都真的打到 /org-panel', async () => {
  const { rpc, calls } = fakeRpc(() => ok({ request: { status: 'approved', decision: { channel: 'ui' } } }))
  const actions = Bridge.buildSettingsActions({ channel: 'online', rpc, refresh: () => 'x', openProfile: () => {} })
  await actions.plugins.approve('req-1')
  await actions.plugins.reject('req-2')
  await actions.plugins.verify('req-3')
  await actions.plugins.healthCheck()
  assert.deepEqual(calls.map((item) => item.endpoint), ['plugins/approve', 'plugins/reject', 'plugins/verify', 'plugins/healthCheck'])
  assert.deepEqual(calls[0].payload, { requestId: 'req-1' })
  for (const call of calls) {
    assert.equal(call.channel, '/org-panel')
    assert.equal(call.payload.status, undefined)
    assert.equal(call.payload.decision, undefined)
    assert.equal(call.payload.channel, undefined)
  }

  calls.length = 0
  const provider = { id: 'text-main', type: 'text', provider: 'openai-compatible', model: 'model-x', enabled: true }
  await actions.models.upsert(provider)
  await actions.models.remove('text-main')
  await actions.models.setDefault('text-main')
  await actions.models.test('text-main')
  await actions.models.setEnabled('text-main', false)
  await actions.models.bind('developer', 'text', 'text-main')
  assert.deepEqual(calls.map((item) => item.endpoint), [
    'models/upsert', 'models/remove', 'models/setDefault', 'models/test', 'models/setEnabled', 'models/bind',
  ])
  assert.deepEqual(calls[0].payload, { provider })
  assert.deepEqual(calls[1].payload, { providerId: 'text-main' })
  assert.deepEqual(calls[2].payload, { providerId: 'text-main' })
  assert.deepEqual(calls[5].payload, { employeeId: 'developer', capability: 'text', providerId: 'text-main' })
  assert.deepEqual(Object.keys(actions.models).sort(), ['bind', 'remove', 'setDefault', 'setEnabled', 'test', 'upsert'])
})

test('org-panel client: 通道还在探测时，审批页不宣布「此处无法审批」，也不摆「批准」', () => {
  const approvals = [{
    requestId: 'r1', employeeId: 'developer', pluginName: 'markdown-tools', packageName: '@acme/markdown-tools',
    source: 'dsh-market', purpose: '把周报转成 markdown', permissions: [], risks: [], installCommand: 'npm i',
    expectedTools: ['md_render'], skillName: 'markdown', category: 'doc', createdAt: 1, updatedAt: 1, status: 'pending',
  }]
  const probing = textOf(render(Plugins.PluginSettings, { data: { installed: [], approvals, channelProbing: true }, actions: {} }, APPROVALS_TAB))
  assert.match(probing, /正在确认/)
  assert.doesNotMatch(probing, /此处无法审批/, '还没探明就下结论，跟编数据是一回事')

  const offline = textOf(render(Plugins.PluginSettings, { data: { installed: [], approvals }, actions: {} }, APPROVALS_TAB))
  assert.match(offline, /此处无法审批/)
  assert.match(offline, /pluginInstall\.preapproved/)
  assert.match(offline, /PluginRuntime\.approve/)
  assert.doesNotMatch(offline, /没有 client→host 的 RPC 通道/)
  assert.match(offline, /没有提供 \/org-panel RPC 频道/)
})

test('org-panel client: 全仓不再存在「DSH 没有 RPC 通道」这类断言', () => {
  const files = ['company-bridge.ts', 'rpc.ts', 'company-view.tsx', 'index.tsx', join('settings', 'PluginSettings.tsx')]
  for (const name of files) {
    const source = readFileSync(join(V9, name), 'utf-8')
    assert.doesNotMatch(source, /没有 client→host 的 RPC 通道/, `${name} 里还留着那句错误断言`)
    assert.doesNotMatch(source, /没有给插件 client→host 的 RPC 通道/, `${name} 里还留着那句错误断言`)
  }
})

// ---------------------------------------------------------------------------
// C3 「拿不到」不许被翻译成「暂无 / 未配置」
// ---------------------------------------------------------------------------

test('org-panel client: host 回 available:false 时不下发空清单，reason 原样带到 UI', async () => {
  const reasons = {
    'plugins/approvals': '插件运行时没有挂载（缺 tools 服务），本次运行没有审批台账。',
    'communication/summary': '通讯层未挂载：cordis 配置里没有 communication 段。',
    'models/providers': 'Model Gateway 未挂载（详见启动日志）。',
  }
  const { rpc } = fakeRpc((endpoint) => (reasons[endpoint]
    ? ok({ available: false, requests: [], adapters: [], channelBindings: [], providers: [], reason: reasons[endpoint] })
    : ok({ available: true })))
  const result = await Bridge.fetchOrgPanel(rpc)
  assert.equal(result.channel, 'online')

  assert.equal(result.extra.plugins.approvals, undefined)
  assert.equal(result.extra.plugins.reason, reasons['plugins/approvals'])
  const pluginText = textOf(render(Plugins.PluginSettings, { data: result.extra.plugins, actions: {} }, APPROVALS_TAB))
  assert.match(pluginText, /插件运行时没有挂载/)
  assert.doesNotMatch(pluginText, /暂无审批记录/)

  assert.equal(result.extra.communication.adapters, undefined)
  const commText = textOf(render(Communication.CommunicationSettings, { data: result.extra.communication }))
  assert.match(commText, /cordis 配置里没有 communication 段/)
  assert.doesNotMatch(commText, /尚未接入任何外部渠道/)

  assert.equal(result.extra.models.providers, undefined)
  const modelText = textOf(render(Models.ModelSettings, { data: result.extra.models }))
  assert.match(modelText, /Model Gateway 未挂载/)
  assert.doesNotMatch(modelText, /公司还没有配置任何模型供应商/)
})

test('org-panel client: 端点全部不可用时 channel=offline，一个字段都不下发', async () => {
  const { rpc } = fakeRpc(() => { throw new Error('transport failure for /org-panel/company/snapshot: HTTP 404') })
  const result = await Bridge.fetchOrgPanel(rpc)
  assert.equal(result.channel, 'offline')
  assert.deepEqual(result.extra, {})
  assert.equal(result.snapshot, null)
  assert.match(result.note, /HTTP 404/)
  assert.deepEqual(result.errors, [], '通道整体不通时不该再刷一屏端点错误')
})

test('org-panel client: 真数据照单接收，快照只认 version 2 的合法结构', async () => {
  const snapshot = { version: 2, generatedAt: 1700000000000, companyName: '赛博公司', employees: [], models: [], totals: { employees: 0 } }
  const { rpc } = fakeRpc((endpoint) => {
    if (endpoint === 'company/snapshot') return ok(snapshot)
    if (endpoint === 'plugins/approvals') return ok({ available: true, requests: [{ requestId: 'r1', status: 'pending' }], pendingCount: 1 })
    if (endpoint === 'plugins/health') return ok({ available: true, catalogSize: 12, checkedAt: 1700000000001, changed: 0 })
    if (endpoint === 'storage/inventory') {
      return ok({
        dataDir: '/tmp/dsh',
        files: [{ key: 'evolution', label: '员工档案', path: '/tmp/dsh/evolution.json', exists: true, bytes: 2048, updatedAt: 1700000000002 }],
        totals: { employees: 15, memories: 3, tasks: 7, skills: 2 },
      })
    }
    return ok({ available: true })
  })
  const result = await Bridge.fetchOrgPanel(rpc)
  assert.equal(result.snapshot.generatedAt, snapshot.generatedAt)
  assert.equal(result.extra.plugins.approvals.length, 1)
  assert.equal(result.extra.plugins.health.catalogSize, 12)
  assert.equal(result.extra.storage.dataDir, '/tmp/dsh')
  assert.equal(result.extra.storage.files[0].bytes, 2048)
  assert.equal(result.extra.storage.employees, 15)
  assert.equal(result.extra.storage.tasks, 7)

  const bad = fakeRpc((endpoint) => (endpoint === 'company/snapshot' ? ok({ version: 1, employees: {} }) : ok({ available: true })))
  assert.equal((await Bridge.fetchOrgPanel(bad.rpc)).snapshot, null)
})

// ---------------------------------------------------------------------------
// 空态必须带下一步
// ---------------------------------------------------------------------------

test('org-panel client: 模型页空状态直接给可操作入口，不再把手改 company.json 当主路径', () => {
  const loaded = textOf(render(Models.ModelSettings, { data: { loaded: true, providers: [], employees: [] } }))
  assert.match(loaded, /添加模型/)
  assert.match(loaded, /不需要手动编辑 company\.json/)
  assert.doesNotMatch(loaded, /下一步：在 .*company\.json/, 'UI 已经能写配置后，不应继续把改文件当主路径')

  const blind = textOf(render(Models.ModelSettings, { data: undefined }))
  assert.match(blind, /尚未读到模型配置|当前 \/org-panel 通道没有模型写入能力/)
  assert.doesNotMatch(blind, /公司还没有模型供应商/, '没拿到数据不能冒充“真的一个都没配”')
})

test('org-panel client: 插件页每一个空态都带动词或指向具体去处', () => {
  const trees = [
    render(Plugins.PluginSettings, { data: { installed: [], approvals: [] }, actions: {} }),
    render(Plugins.PluginSettings, { data: { installed: [], approvals: [] }, actions: {} }, APPROVALS_TAB),
    render(Plugins.PluginSettings, { data: { installed: [], approvals: [] }, actions: {} }, new Map([['installed', 'market']])),
    render(Plugins.PluginSettings, { data: { installed: [], approvals: [] }, actions: {} }, new Map([['installed', 'permissions']])),
  ]
  const empties = []
  const collect = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const item of node) collect(item); return }
    if (node.props?.className === 'cy9-set-empty') empties.push(textOf(node))
    for (const value of Object.values(node.props || {})) collect(value)
  }
  for (const tree of trees) collect(tree)
  assert.ok(empties.length >= 4, `应该至少有四个空态，实际 ${empties.length}`)
  for (const text of empties) {
    const actionable = /(搜|提交|批准|点|输入|执行|加|配置|回车|去)/.test(text)
    assert.ok(actionable, `空态没有告诉老板下一步做什么：${text}`)
  }
})
