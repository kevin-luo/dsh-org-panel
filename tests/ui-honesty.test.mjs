// 需求文档四十八条：状态必须来自真实 Runtime，不许写假 KPI。
//
// 这组用例守的是「UI 显示与真实配置不符」那一类洞，每一条都按「老板会不会被这块屏幕骗到」来写：
//   U1 安全页拿不到审批策略时，绝不默认显示成最安全的一档（绿色「每次需要审批」是最危险的假 UI）；
//   U2 Secret Store 只能按 SecretVault 真实能力标志显示，混淆存储不许打绿标；
//   U3 「员工之间自动转交上限」必须是 CommunicationManager.summary() 的真实生效值，
//      一个渠道都没有时的缺省回落值要自报家门，不能当配置值展示；
//   U4 degraded 插件不许并进「可用 / 真实插件」（migrations 的 pluginCount 合并了两者，UI 不跟）；
//   U5 顶栏那个 online/total 不叫「在线」（本插件没有员工心跳，拿不到谁在线）；
//   U6 面板没有 client→host 写通道时，不给老板一条走不通的审批指引；
//   U7 员工列表不再按 tick 轮播预置台词。
//
// 口径说明（与其它用例不同的地方）：
//   其它测试跑 lib/index.js 那个发布产物。client 侧不行 —— lib/client.js 是给浏览器 __ModuleLoader__
//   用的 CJS 包，且只导出 apply()，组件够不着。所以这里用 typescript 自带的 transpileModule
//   现编 src/client-v9/**，跑的是真实组件源码；而喂给组件的数据一律来自 lib/index.js 里真实的
//   CommunicationManager / ModelGateway / EvolutionStore / CompanyStore / PluginRuntime，不手搓假快照。
import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import React from 'react'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { scratch } from './_helpers.mjs'

const { CompanyStore, EvolutionStore, ModelGateway, PluginRuntime, registerCommunication } = await import('../lib/index.js')

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '..', 'src')
const V9 = join(SRC, 'client-v9')
const nodeRequire = createRequire(join(HERE, '..', 'package.json'))

// ---------------------------------------------------------------------------
// 迷你 TS 模块加载器：只为把真实组件源码加载进来，不改写任何一行业务代码
// ---------------------------------------------------------------------------

const moduleCache = new Map()
// 1.2MB 的 base64 资产对本组用例毫无意义，用空表顶掉，省下几秒转译时间。
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

const styles = loadTs(join(V9, 'settings', 'styles.ts'))
const Security = loadTs(join(V9, 'settings', 'SecuritySettings.tsx'))
const Communication = loadTs(join(V9, 'settings', 'CommunicationSettings.tsx'))
const Plugins = loadTs(join(V9, 'settings', 'PluginSettings.tsx'))
const Company = loadTs(join(V9, 'settings', 'CompanySettings.tsx'))
const Header = loadTs(join(V9, 'components', 'CompanyHeader.tsx'))
const Rail = loadTs(join(V9, 'components', 'RightRail.tsx'))
const List = loadTs(join(V9, 'components', 'EmployeeList.tsx'))
const Overview = loadTs(join(V9, 'employee-profile', 'OverviewTab.tsx'))
const PluginsTab = loadTs(join(V9, 'employee-profile', 'PluginsTab.tsx'))

// ---------------------------------------------------------------------------
// 静态渲染：递归调用函数组件，但在 styles 里那批展示原语处停下，
// 好让断言能读到 StatusPill / SettingsRow 真实收到的 props（tone、label 才是「绿标」的判据）。
// ---------------------------------------------------------------------------

const PRIMITIVES = new Set([styles.StatusPill, styles.SettingsRow, styles.SettingsCard, styles.ActionButton, styles.SelectField, styles.Toggle, styles.Empty, styles.KeyValues, styles.Tabs, styles.SecretChip])

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

/**
 * 装上一个只跑一次、不保存状态的 dispatcher；React 18 / 19 的挂点不同，两个都支持。
 * initial 用来把某个 useState 的初值换掉（例如把插件设置默认停留的「已安装」页换成「审批记录」），
 * 这样测试能看到别的 Tab，而生产代码一行都不用为测试改。
 */
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
  if (typeof node.type === 'function' && !PRIMITIVES.has(node.type)) return renderNode(node.type(node.props))
  const props = {}
  for (const [key, value] of Object.entries(node.props)) props[key] = renderNode(value)
  return { ...node, props }
}

/** 渲染一个组件（含其内部所有非原语子组件），返回可断言的元素树。 */
function render(component, props, initial) {
  return withHooks(() => renderNode(component(props)), initial)
}

/** 插件设置默认停在「已安装」，这个开关让用例看到「审批记录」页。 */
const APPROVALS_TAB = new Map([['installed', 'approvals']])

function walk(node, visit) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) { for (const item of node) walk(item, visit); return }
  if (typeof node === 'string' || typeof node === 'number') { visit(node); return }
  if (typeof node !== 'object' || !node.props) return
  visit(node)
  for (const value of Object.values(node.props)) walk(value, visit)
}

/** 页面上老板能看见的全部文字（含 label / title / desc 这类字符串 props）。 */
function textOf(node) {
  const parts = []
  walk(node, (item) => { if (typeof item === 'string' || typeof item === 'number') parts.push(String(item)) })
  return parts.join('\n')
}

function nodesOf(node, type) {
  const found = []
  walk(node, (item) => { if (typeof item === 'object' && item.type === type) found.push(item) })
  return found
}

const pillsOf = (node) => nodesOf(node, styles.StatusPill).map((item) => item.props)

/** 按标题找到某一行，行内的 pill / 按钮就是这一行真正显示出来的东西。 */
function rowOf(node, title) {
  const row = nodesOf(node, styles.SettingsRow).find((item) => typeof item.props.title === 'string' && item.props.title === title)
  assert.ok(row, `没找到标题为「${title}」的设置行`)
  return { desc: typeof row.props.desc === 'string' ? row.props.desc : textOf(row.props.desc), pills: pillsOf(row.props.side), node: row }
}

function kvOf(node, label) {
  for (const kv of nodesOf(node, styles.KeyValues)) {
    const hit = (kv.props.items || []).find((item) => item.label === label)
    if (hit) return typeof hit.value === 'string' ? hit.value : textOf(hit.value)
  }
  throw new Error(`没找到 KeyValues 里的「${label}」`)
}

// ---------------------------------------------------------------------------
// 真实数据夹具
// ---------------------------------------------------------------------------

function ctxWith(toolNames = []) {
  const logs = []
  const registered = new Map()
  return {
    logs,
    tools: { list: () => toolNames.map((name) => ({ name })), register: (tool) => registered.set(tool.name, tool) },
    tool: (name) => registered.get(name),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  }
}

/** 一个员工绑一个 available、一个 degraded 的插件，快照全部来自真实 Store。 */
async function snapshotWithDegraded(name) {
  const dir = await scratch(name)
  const evolution = new EvolutionStore(join(dir, 'evolution.json'))
  const company = new CompanyStore(evolution, join(dir, 'company.json'))
  await evolution.bindPlugin('developer', {
    pluginId: 'good', packageName: '@acme/good', source: 'dsh-market', tools: ['good_run'], status: 'available',
  })
  await evolution.bindPlugin('developer', {
    pluginId: 'half', packageName: '@acme/half', source: 'dsh-market', tools: ['half_a', 'half_b'], status: 'degraded',
  })
  const snapshot = await company.snapshot([{ id: 'developer', name: '小刘', role: '程序员' }])
  return { dir, snapshot, employee: snapshot.employees[0] }
}

// ---------------------------------------------------------------------------
// U1 插件审批策略：读不到就是未知，绝不默认显示成最安全的一档
// ---------------------------------------------------------------------------

test('UI honesty: 拿不到 security.pluginApproval 时显示未知，不给绿标也不宣称「任何插件都要老板点头」', () => {
  const view = Security.describePluginApproval(undefined)
  assert.equal(view.known, false)
  assert.notEqual(view.tone, 'ok', '读不到策略却打绿标，等于替老板宣布了最安全的配置')
  assert.match(view.label, /未知/)

  const tree = render(Security.SecuritySettings, { data: undefined })
  const row = rowOf(tree, '第三方插件安装')
  assert.notEqual(row.pills[0].tone, 'ok')
  assert.match(row.pills[0].label, /未知/)
  assert.doesNotMatch(row.desc, /没有预批准包/, '面板并不知道有没有预批准包')
  assert.doesNotMatch(row.desc, /任何插件都要老板点头/)
  // 一无所知的页面上不许出现任何一个绿标。
  assert.deepEqual(pillsOf(tree).filter((pill) => pill.tone === 'ok'), [])
})

test('UI honesty: 真配了 preapproved / executor:auto 时面板照实说，声称 always 也压不住预批准清单', () => {
  const real = Security.describePluginApproval({ mode: 'preapproved', preapproved: ['@acme/tool'], pendingCount: 2, executor: 'auto' })
  assert.equal(real.tone, 'warn')
  assert.match(real.desc, /@acme\/tool/)
  assert.match(real.desc, /批准后自动执行安装命令/)
  assert.match(real.desc, /待审批 2 条/)

  // 配置自相矛盾（mode 说 always，清单里却躺着包）：以清单为准报警，不替配置圆场。
  const lying = Security.describePluginApproval({ mode: 'always', preapproved: ['@acme/tool'] })
  assert.equal(lying.tone, 'warn')
  assert.equal(lying.label, '存在预批准清单')

  // 干净的 always 才配绿标；面板不认识的策略按未知处理。
  assert.equal(Security.describePluginApproval({ mode: 'always', preapproved: [], pendingCount: 0, executor: 'tool' }).tone, 'ok')
  const weird = Security.describePluginApproval({ mode: 'auto-install-everything' })
  assert.equal(weird.known, false)
  assert.notEqual(weird.tone, 'ok')

  const tree = render(Security.SecuritySettings, { data: { pluginApproval: { mode: 'preapproved', preapproved: ['@acme/tool'], executor: 'auto' } } })
  assert.match(rowOf(tree, '第三方插件安装').desc, /@acme\/tool/)
})

// ---------------------------------------------------------------------------
// U2 Secret Store：按 SecretVault 的真实能力标志显示
// ---------------------------------------------------------------------------

test('UI honesty: 混淆存储不许打绿标，warning 必须原样显示', async () => {
  const dir = await scratch('vault-machine')
  const evolution = new EvolutionStore(join(dir, 'evolution.json'))
  const company = new CompanyStore(evolution, join(dir, 'company.json'))
  // 真的 ModelGateway → 真的 SecretVault.status()，不手搓状态对象。
  const gateway = new ModelGateway({ company, evolution, vaultFile: join(dir, 'vault.enc') })
  const status = await gateway.secretStorage()
  assert.equal(status.mode, 'obfuscated', '没有口令时本地库就是混淆存储')
  assert.ok(status.warning, '混淆模式必须带 warning')

  const view = Security.describeSecretStorage(status)
  assert.equal(view.tone, 'warn')
  assert.equal(view.label, '仅本机混淆存储')

  const tree = render(Security.SecuritySettings, { data: { secretStorage: status } })
  const row = rowOf(tree, '模型 API Key')
  assert.notEqual(row.pills[0].tone, 'ok')
  assert.equal(row.pills[0].label, status.label)
  const page = textOf(tree)
  assert.doesNotMatch(page, /Secret Store/, '不许再用一个更好听的名字盖住真实保护等级')
  for (const line of status.warning.split('\n')) assert.ok(page.includes(line), `warning 必须逐行原样显示：${line}`)
})

test('UI honesty: 只有真加密 + 权限确实收紧才给绿标；拿不到能力标志时既不绿也不说「已加密」', async () => {
  const dir = await scratch('vault-passphrase')
  const evolution = new EvolutionStore(join(dir, 'evolution.json'))
  const company = new CompanyStore(evolution, join(dir, 'company.json'))
  const gateway = new ModelGateway({ company, evolution, vaultFile: join(dir, 'vault.enc'), vaultPassphrase: 'test-passphrase' })
  const encrypted = await gateway.secretStorage()
  assert.equal(encrypted.mode, 'encrypted')
  assert.equal(Security.describeSecretStorage(encrypted).tone, 'ok')

  // 同样是 encrypted，但文件权限没收紧 / host 自己带了警告 —— 都不给绿标。
  assert.equal(Security.describeSecretStorage({ ...encrypted, ownerOnly: false }).tone, 'warn')
  assert.equal(Security.describeSecretStorage({ ...encrypted, warning: '密钥文件权限没能收紧' }).tone, 'warn')

  const unknown = Security.describeSecretStorage(undefined)
  assert.equal(unknown.tone, 'off')
  assert.match(unknown.label, /未知/)
  assert.doesNotMatch(unknown.desc, /已加密/)
})

// ---------------------------------------------------------------------------
// U3 转交上限：只认 CommunicationManager.summary() 的真实生效值
// ---------------------------------------------------------------------------

test('UI honesty: 转交上限来自 manager.summary() 的真实生效值，两页同源', async () => {
  const manager = registerCommunication(ctxWith(), {
    communication: { adapters: [{ id: 'feishu', platform: 'feishu', enabled: true, routing: { maxHops: 12 } }] },
  })
  const summary = await manager.summary()
  assert.equal(summary.maxEmployeeHops, 12)

  const comm = render(Communication.CommunicationSettings, { data: summary })
  assert.match(kvOf(comm, '员工之间自动转交上限'), /^12 次/)

  // 安全页读的必须是同一个数：由 settingsDataFromSnapshot 从通讯摘要接过去。
  const data = Company.settingsDataFromSnapshot(null, { communication: summary })
  assert.equal(data.security.maxEmployeeHops, 12)
  assert.equal(data.security.hopsFallback, false)
  const security = render(Security.SecuritySettings, { data: data.security })
  const row = rowOf(security, '员工之间自动转交')
  assert.equal(row.pills[0].label, '最多 12 次')
  await manager.stop()
})

test('UI honesty: 一个渠道都没有时的缺省 4 次要自报家门，不能当成配置值显示', async () => {
  const empty = registerCommunication(ctxWith(), {})
  const summary = await empty.summary()
  assert.equal(summary.maxEmployeeHops, 4, '这就是代码里的缺省回落值')
  assert.equal(summary.adapters.length, 0)

  const comm = render(Communication.CommunicationSettings, { data: summary })
  const value = kvOf(comm, '员工之间自动转交上限')
  assert.match(value, /未知/)
  assert.match(value, /缺省回落值/)

  const data = Company.settingsDataFromSnapshot(null, { communication: summary })
  assert.equal(data.security.hopsFallback, true)
  const security = render(Security.SecuritySettings, { data: data.security })
  const row = rowOf(security, '员工之间自动转交')
  assert.notEqual(row.pills[0].tone, 'ok')
  assert.match(row.pills[0].label, /未知/)
  assert.doesNotMatch(row.pills[0].label, /^最多 4 次$/)
  await empty.stop()
})

test('UI honesty: 完全没下发通讯摘要时显示未知，不替老板宣布「未连接 / 未配置」', () => {
  const tree = render(Communication.CommunicationSettings, { data: undefined })
  const page = textOf(tree)
  assert.match(page, /面板没有拿到通讯配置摘要/)
  assert.match(kvOf(tree, '员工之间自动转交上限'), /未知/)
  assert.equal(kvOf(tree, '群映射总数'), '未知')
  // 三个平台行都不许出现「未连接」这种结论。
  assert.deepEqual(pillsOf(tree).filter((pill) => pill.label === '未连接'), [])
  assert.equal(pillsOf(tree).filter((pill) => pill.label === '未知').length, 3)
  assert.equal(Object.keys(Company.summaryHops(undefined)).length, 0)
})

// ---------------------------------------------------------------------------
// U4 degraded 不算「可用 / 真实插件」
// ---------------------------------------------------------------------------

test('UI honesty: degraded 插件不并进「可用」，统计口径与下面那张表对得上', async () => {
  const { snapshot, employee } = await snapshotWithDegraded('plugin-tally')
  // 先证明「合并」这件事在持久层真的存在，否则这条用例就是空转。
  assert.equal(employee.statistics.pluginCount, 2, 'migrations 的 pluginCount 确实把 available + degraded 合并了')
  assert.equal(employee.plugins.length, 2)

  const tally = PluginsTab.tallyPlugins(employee.plugins)
  assert.deepEqual(tally, { available: 1, degraded: 1, missing: 0, disabled: 0, total: 2 })

  const overview = render(Overview.OverviewTab, { staff: { id: 'developer', name: '小刘', intro: '' }, role: { id: 'developer' }, snapshot: employee, runtime: null })
  const kpi = textOf(overview)
  assert.match(kpi, /可用插件/)
  assert.doesNotMatch(kpi, /真实插件/, '「真实插件」这个说法会把 degraded 也算进去')
  assert.match(kpi, /降级 1/)
  const values = nodesOf(overview, 'b').map((item) => textOf(item))
  assert.ok(values.includes('1'), 'KPI 数值必须是 available 的 1，不是 statistics.pluginCount 的 2')

  const tab = render(PluginsTab.PluginsTab, { staff: { id: 'developer', name: '小刘' }, snapshot: employee, onDraft: () => {} })
  const text = textOf(tab)
  assert.match(text, /可用 1/)
  assert.match(text, /降级 1/)
  assert.doesNotMatch(text, /2 个可用/)
  assert.equal(PluginsTab.pluginTallyText(tally).startsWith('可用 1 · 降级 1'), true)

  // 公司右栏那个「可用插件」也要按 available 算，不能用 totals.plugins。
  const company = { version: 2, generatedAt: Date.now(), companyName: '赛博公司', employees: [employee], models: [], totals: snapshot.totals }
  assert.equal(snapshot.totals.plugins, 2, 'totals.plugins 是 pluginCount 之和，同样合并过')
  const rail = render(Rail.RightRail, {
    staff: [{ id: 'developer', name: '小刘', role: '程序员' }],
    stats: { total: 1, running: 0, done: 0, wait: 0, idle: 1 },
    delegations: [], growth: [], skills: [], plugins: [], sessionRunning: false, now: Date.now(),
    open: true, onClose: () => {}, onDraft: () => {}, snapshot: company, runtime: null,
  })
  const railText = textOf(rail)
  assert.match(railText, /可用插件/)
  assert.doesNotMatch(railText, /真实插件/)
  assert.match(railText, /可用 1 · 降级 1/)
})

// ---------------------------------------------------------------------------
// U5 顶栏「在线」
// ---------------------------------------------------------------------------

test('UI honesty: 顶栏不再谎称「在线」，RailStats.online 这个死字段已清理', () => {
  const header = render(Header.CompanyHeader, {
    companyName: '赛博公司 · AI 员工总部',
    stats: { total: 15, online: 3, running: 2, done: 1, wait: 0, since: Date.now() - 3_600_000 },
    now: new Date(), onMarket: () => {}, onSettings: () => {},
  })
  const spans = nodesOf(header, 'span').map((item) => textOf(item))
  assert.ok(!spans.includes('在线'), '没有心跳就不许说「在线」')
  assert.ok(spans.includes('活跃/在册'))
  assert.match(textOf(header), /本会话有真实事件（非待命）的员工数/)

  // 右栏收到一份不含 online 的 stats 也必须照常渲染 —— 证明那个字段真的没人读了。
  const rail = render(Rail.RightRail, {
    staff: [], stats: { total: 0, running: 0, done: 0, wait: 0, idle: 0 },
    delegations: [], growth: [], skills: [], plugins: [], sessionRunning: false, now: Date.now(),
    open: true, onClose: () => {}, onDraft: () => {}, snapshot: null, runtime: null,
  })
  const railText = textOf(rail)
  assert.doesNotMatch(railText, /undefined|NaN/)
  assert.match(railText, /在册 0 人/)
  assert.doesNotMatch(readFileSync(join(V9, 'components', 'RightRail.tsx'), 'utf-8'), /stats\.online/)
})

// ---------------------------------------------------------------------------
// U6 审批通道：要么真能点，要么给一条真走得通的路
// ---------------------------------------------------------------------------

test('UI honesty: 没有写通道时不摆禁用的「批准」按钮，也不把老板指回这个页面', async () => {
  const dir = await scratch('approval-offline')
  const store = new EvolutionStore(join(dir, 'evolution.json'))
  const runtime = new PluginRuntime(ctxWith(['bash']), { store, approvalsFile: join(dir, 'plugin-approvals.json') })
  const request = await runtime.submit({
    employeeId: 'developer', employeeName: '小刘', pluginName: 'markdown-tools', packageName: '@acme/markdown-tools',
    purpose: '把周报转成 markdown', installCommand: 'npm install @acme/markdown-tools', expectedTools: ['md_render'],
  })
  assert.equal(request.status, 'pending')

  const approvals = await runtime.requests()
  const tree = render(Plugins.PluginSettings, { data: { installed: [], approvals }, actions: {} }, APPROVALS_TAB)
  const text = textOf(tree)
  assert.deepEqual(nodesOf(tree, styles.ActionButton).map((item) => item.props.label).filter((label) => label === '批准'), [], '点不动的按钮不许摆出来')
  assert.ok(pillsOf(tree).some((pill) => pill.label === '此处无法审批'))
  assert.match(text, /pluginInstall\.preapproved/)
  assert.match(text, /PluginRuntime\.approve/)
  // 这一版 DSH 没有 client→host RPC，「去公司设置→插件点击批准」就是一条走不通的指引。
  assert.doesNotMatch(text, /公司设置 → 插件.*点击批准/)
})

test('UI honesty: 真有写通道时「批准」按钮是真的能把申请批下去', async () => {
  const dir = await scratch('approval-online')
  const store = new EvolutionStore(join(dir, 'evolution.json'))
  const runtime = new PluginRuntime(ctxWith(['bash']), { store, approvalsFile: join(dir, 'plugin-approvals.json') })
  const request = await runtime.submit({
    employeeId: 'developer', pluginName: 'markdown-tools', packageName: '@acme/markdown-tools',
    purpose: '把周报转成 markdown', installCommand: 'npm install @acme/markdown-tools', expectedTools: ['md_render'],
  })
  const actions = { approve: (requestId) => runtime.approve(requestId, { by: '老板', channel: 'ui' }) }
  const tree = render(Plugins.PluginSettings, { data: { installed: [], approvals: await runtime.requests() }, actions }, APPROVALS_TAB)
  const button = nodesOf(tree, styles.ActionButton).find((item) => item.props.label === '批准')
  assert.ok(button, '有写通道就必须真的给按钮')
  assert.deepEqual(pillsOf(tree).filter((pill) => pill.label === '此处无法审批'), [])

  await button.props.run()
  const after = await runtime.request(request.requestId)
  assert.equal(after.status, 'approved')
  assert.equal(after.decision.by, '老板')
})

test('UI honesty: 审批台账没下发时显示「未读取」，不显示成「暂无待审批」', () => {
  const tree = render(Plugins.PluginSettings, { data: { installed: [] }, actions: {} }, APPROVALS_TAB)
  const text = textOf(tree)
  assert.match(text, /审批记录 未知/)
  assert.match(text, /面板没有拿到审批台账/)
  assert.doesNotMatch(text, /暂无审批记录/)

  // 真的下发了一份空台账，才可以说「暂无」。
  const loaded = textOf(render(Plugins.PluginSettings, { data: { installed: [], approvals: [] }, actions: {} }, APPROVALS_TAB))
  assert.match(loaded, /暂无审批记录/)
  assert.match(loaded, /审批记录 0/)
})

test('UI honesty: 已安装列表把 degraded 单列，且没下发时不显示成「暂无插件」', async () => {
  const { employee } = await snapshotWithDegraded('installed-tally')
  const rows = employee.plugins.map((plugin) => ({ ...plugin, employees: ['小刘'] }))
  assert.deepEqual(Plugins.countByStatus(rows), { available: 1, degraded: 1, missing: 0, disabled: 0, total: 2 })
  const loaded = textOf(render(Plugins.PluginSettings, { data: { installed: rows }, actions: {} }))
  assert.match(loaded, /可用 1 · 降级 1/)

  const blind = textOf(render(Plugins.PluginSettings, { data: {}, actions: {} }))
  assert.match(blind, /已安装 未知/)
  assert.match(blind, /面板没有拿到插件绑定/)
  assert.doesNotMatch(blind, /暂无已安装插件/)
})

// ---------------------------------------------------------------------------
// U7 员工列表：不再按 tick 轮播编造的活动描述
// ---------------------------------------------------------------------------

test('UI honesty: 无真实任务时显示静态事实，tick 怎么走文案都不变', () => {
  const staff = [{ id: 'developer', name: '小刘', role: '程序员', department: '产品研发部', lines: { running: ['正在重构支付模块', '正在写单元测试', '正在跑压测'] } }]
  const frames = []
  for (let tick = 0; tick < 12; tick++) {
    frames.push(textOf(render(List.EmployeeList, {
      staff, statuses: { developer: 'running' }, tasksMap: {}, activeStaffId: null, tick,
      onSelect: () => {}, onMention: () => {},
    })))
  }
  assert.equal(new Set(frames).size, 1, 'tick 变了文案却在变 = 还在轮播编造的活动描述')
  for (const line of staff[0].lines.running) assert.ok(!frames[0].includes(line), `预置台词不许出现：${line}`)
  assert.match(frames[0], /暂无任务详情/)

  // 待命时说「待命中」；有真实任务时照抄任务描述。
  const idle = textOf(render(List.EmployeeList, { staff, statuses: { developer: 'idle' }, tasksMap: {}, activeStaffId: null, tick: 7, onSelect: () => {}, onMention: () => {} }))
  assert.match(idle, /待命中，等真实派活/)
  const busy = textOf(render(List.EmployeeList, {
    staff, statuses: { developer: 'running' },
    tasksMap: { developer: [{ callId: 'c1', staffId: 'developer', desc: '修复登录页跳转', running: true }] },
    activeStaffId: null, tick: 3, onSelect: () => {}, onMention: () => {},
  }))
  assert.match(busy, /修复登录页跳转/)
  assert.equal(List.employeeLine(undefined, 'wait'), '暂无原因说明')
  // 顺带守住来源：selectors 那边只再拿 clip，lineOf 不许被重新引进来。
  const importLine = readFileSync(join(V9, 'components', 'EmployeeList.tsx'), 'utf-8').split('\n').find((line) => line.includes("from '../selectors'"))
  assert.ok(importLine && !importLine.includes('lineOf'), 'EmployeeList 不许再 import lineOf')
})

// ---------------------------------------------------------------------------
// 兜底：设置中心导航角标不许把「没读到」写成「0」
// ---------------------------------------------------------------------------

test('UI honesty: 没拿到快照时导航角标是空的，不是一排 0', () => {
  const blind = Company.settingsDataFromSnapshot(null, undefined)
  assert.deepEqual(blind, {})
  const tree = render(Company.CompanySettings, { open: true, data: blind, onClose: () => {} })
  const badges = nodesOf(tree, 'em').map((item) => textOf(item))
  assert.deepEqual(badges, [], '一个「0」会被老板读成「真的一个都没有」')
})
