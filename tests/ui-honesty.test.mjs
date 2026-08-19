// UI 真实性：状态必须来自真实 Runtime，未知就显示未知。
import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import React from 'react'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { scratch } from './_helpers.mjs'

const { CompanyStore, EvolutionStore, ModelGateway, registerCommunication } = await import('../lib/index.js')
const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '..', 'src')
const V9 = join(SRC, 'client-v9')
const nodeRequire = createRequire(join(HERE, '..', 'package.json'))
const moduleCache = new Map()
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
const Company = loadTs(join(V9, 'settings', 'CompanySettings.tsx'))
const PluginsTab = loadTs(join(V9, 'employee-profile', 'PluginsTab.tsx'))

const PRIMITIVES = new Set([styles.StatusPill, styles.SettingsRow, styles.SettingsCard, styles.ActionButton, styles.SelectField, styles.Toggle, styles.Empty, styles.KeyValues, styles.Tabs, styles.SecretChip])
const HOOKS = {
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useReducer: (_r, init) => [init, () => {}], useMemo: (fn) => fn(), useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }), useEffect: () => {}, useLayoutEffect: () => {}, useInsertionEffect: () => {},
  useContext: () => undefined, useDebugValue: () => {}, useId: () => 'test-id',
  useSyncExternalStore: (_s, getSnapshot) => getSnapshot(), useTransition: () => [false, (fn) => fn()],
}

function withHooks(run) {
  const modern = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
  const legacy = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
  if (modern) {
    const prev = modern.H; modern.H = HOOKS
    try { return run() } finally { modern.H = prev }
  }
  if (legacy?.ReactCurrentDispatcher) {
    const prev = legacy.ReactCurrentDispatcher.current; legacy.ReactCurrentDispatcher.current = HOOKS
    try { return run() } finally { legacy.ReactCurrentDispatcher.current = prev }
  }
  throw new Error('React hooks dispatcher unavailable')
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
function render(component, props) { return withHooks(() => renderNode(component(props))) }
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node !== 'object') return ''
  return textOf(node.props?.children)
}
function collect(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const item of node) collect(item, predicate, out); return out }
  if (predicate(node)) out.push(node)
  collect(node.props?.children, predicate, out)
  return out
}
function rows(tree) { return collect(tree, (node) => node.type === styles.SettingsRow) }
function pills(tree) { return collect(tree, (node) => node.type === styles.StatusPill).map((node) => node.props) }
function kv(tree, label) {
  const groups = collect(tree, (node) => node.type === styles.KeyValues)
  for (const group of groups) {
    const item = (group.props.items || []).find((row) => row.label === label)
    if (item) return String(item.value)
  }
  return ''
}
function row(tree, title) { return rows(tree).map((node) => node.props).find((item) => textOf(item.title) === title) }
function ctxWith() { return { logger: { info() {}, warn() {}, error() {} } } }

test('UI honesty: 拿不到插件审批策略时显示未知，不默认给最安全绿标', () => {
  const view = Security.describePluginApproval(undefined)
  assert.equal(view.known, false)
  assert.notEqual(view.tone, 'ok')
  assert.match(view.label, /未知/)
  const preapproved = Security.describePluginApproval({ mode: 'preapproved', preapproved: ['@acme/tool'], executor: 'auto' })
  assert.equal(preapproved.tone, 'warn')
  assert.match(preapproved.desc, /不会再问老板/)
})

test('UI honesty: 本机混淆密钥库不能显示成加密绿标', async () => {
  const dir = await scratch('ui-vault')
  const evolution = new EvolutionStore(join(dir, 'evolution.json'))
  const company = new CompanyStore(evolution, join(dir, 'company.json'))
  const gateway = new ModelGateway({ company, evolution, vaultFile: join(dir, 'vault.enc') })
  const status = await gateway.secretStorage()
  assert.equal(status.mode, 'obfuscated')
  const view = Security.describeSecretStorage(status)
  assert.equal(view.tone, 'warn')
  assert.ok(status.warning)
})

test('UI honesty: 动态工作组人数来自 CommunicationManager.summary()，通讯页与安全页同源', async () => {
  const manager = registerCommunication(ctxWith(), {
    communication: { adapters: [{ id: 'feishu', platform: 'feishu', enabled: true, routing: { maxWorkgroupSize: 3 } }] },
  })
  const summary = await manager.summary()
  assert.equal(summary.maxWorkgroupSize, 3)
  const comm = render(Communication.CommunicationSettings, { data: summary })
  assert.equal(kv(comm, '工作组人数上限'), '最多 3 人')
  assert.match(kv(comm, '路由模式'), /任务语义自动组队/)

  const data = Company.settingsDataFromSnapshot(null, { communication: summary })
  assert.equal(data.security.maxWorkgroupSize, 3)
  const security = render(Security.SecuritySettings, { data: data.security })
  const workgroup = row(security, '动态工作组')
  assert.ok(workgroup)
  const workgroupPills = collect(workgroup.side, (node) => node.type === styles.StatusPill).map((node) => node.props)
  assert.equal(workgroupPills[0].label, '最多 3 人')
  await manager.stop()
})

test('UI honesty: 没下发通讯摘要时显示未知，不假装未连接', () => {
  const tree = render(Communication.CommunicationSettings, { data: undefined })
  assert.match(textOf(tree), /面板没有拿到通讯配置摘要/)
  assert.match(kv(tree, '工作组人数上限'), /未知/)
  assert.equal(kv(tree, '群映射总数'), '未知')
  assert.equal(pills(tree).filter((item) => item.label === '未连接').length, 0)
  assert.deepEqual(Company.summaryWorkgroup(undefined), {})
})

test('UI honesty: 工作组硬上限不会因为配置写 99 就显示 99 人', async () => {
  const manager = registerCommunication(ctxWith(), {
    communication: { adapters: [{ id: 'qq', platform: 'qq', enabled: true, routing: { maxWorkgroupSize: 99 } }] },
  })
  const summary = await manager.summary()
  assert.equal(summary.maxWorkgroupSize, 4)
  assert.equal(summary.adapters[0].routing.maxWorkgroupSize, 4)
  assert.equal(Security.describeWorkgroupSize(summary.maxWorkgroupSize).label, '最多 4 人')
  await manager.stop()
})

test('UI honesty: degraded 插件必须单列，不能并进 available', () => {
  const plugins = [
    { pluginId: 'good', status: 'available' },
    { pluginId: 'slow', status: 'degraded' },
    { pluginId: 'gone', status: 'missing' },
  ]
  const tally = PluginsTab.tallyPlugins(plugins)
  assert.deepEqual(tally, { available: 1, degraded: 1, missing: 1, disabled: 0, total: 3 })
  assert.match(PluginsTab.pluginTallyText(tally), /可用 1 · 降级 1/)
})
