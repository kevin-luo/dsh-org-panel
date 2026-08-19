// 「插入 @员工到输入框」这条链路的用例。
//
// 这条链路以前只有真机才暴露问题，因为它同时踩在三样单测摸不到的东西上：
// 宿主下发的 props、真实 DOM、以及浏览器的焦点与 rAF 时序。所以这一组专门把这三样都做成可注入的替身：
//   D1 草稿写入必须走通，且**永远不覆盖**老板已经敲进去的字；
//   D2 宿主没给 inputActions（或 setDraft 抛错）时要退到原生 input 事件那条路，
//      不许像原来那样悄悄什么都不做 —— 这正是「点了没反应、控制台里草稿恒为空」的形态；
//   D3 焦点不许只挂在 requestAnimationFrame 上：页面在后台标签页时 rAF 根本不触发；
//   D4 任何分支都不许调 submit（需求文档第二十条：发不发由老板决定）；
//   D5 办公室里必须有一个**不在滚动/裁剪区里**的 @ 入口 —— 小人身上那张悬浮卡绝对定位在
//      1200×720 的办公室世界里，真机实测整张卡落在 .cy9-office-viewport 之外，一个像素都点不到。
//
// 说明：命中测试（元素到底在不在可视区、鼠标点下去命中谁）没法在 node 里复现，
// D5 只能守住「这个入口不是 viewport 的后代」这条结构性事实，真机验证见提交说明。
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

const Composer = loadTs(join(V9, 'composer.ts'))
const CompanyViewMod = loadTs(join(V9, 'company-view.tsx'))
const Office = loadTs(join(V9, 'components', 'OfficeWorld.tsx'))

// --- 静态渲染（口径同 ui-honesty / org-panel-client）--------------------------

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

function withHooks(run) {
  const modern = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
  const legacy = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
  if (modern) {
    const prev = modern.H
    modern.H = HOOKS
    try { return run() } finally { modern.H = prev }
  }
  if (legacy?.ReactCurrentDispatcher) {
    const prev = legacy.ReactCurrentDispatcher.current
    legacy.ReactCurrentDispatcher.current = HOOKS
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

const render = (component, props) => withHooks(() => renderNode(component(props)))

/** 深度遍历渲染树，收集满足 match 的宿主节点。 */
function collect(node, match, out = [], inside = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) { for (const item of node) collect(item, match, out, inside); return out }
  if (typeof node !== 'object' || !node.props) return out
  if (match(node, inside)) out.push({ node, inside: [...inside] })
  const next = [...inside, node]
  for (const value of Object.values(node.props)) collect(value, match, out, next)
  return out
}

/** 节点自身的文字（只看直接的字符串子节点，避免把整棵子树的字拼进来）。 */
function ownText(node) {
  const parts = []
  const walk = (item) => {
    if (Array.isArray(item)) { for (const child of item) walk(child); return }
    if (typeof item === 'string' || typeof item === 'number') parts.push(String(item))
  }
  walk(node.props.children)
  return parts.join('')
}

const className = (node) => String(node.props.className || '')

// --- 可注入的 DOM / window 替身 ----------------------------------------------

class FakeTextarea {
  constructor() {
    this._value = ''
    this.events = []
    this.selection = null
    this.focusCount = 0
  }
  focus() { this.focusCount += 1; this.doc.activeElement = this }
  setSelectionRange(start, end) { this.selection = [start, end] }
  dispatchEvent(event) { this.events.push(event.type); return true }
}
// 原型上的 value 访问器：typeIntoComposer 要拿 prototype 的 setter，真实 HTMLTextAreaElement 就是这个形状。
Object.defineProperty(FakeTextarea.prototype, 'value', {
  get() { return this._value },
  set(next) { this._value = String(next) },
  configurable: true,
})

/** seat 里挂着一个 textarea 的假 document + 一个可控时序的假 window。 */
function fakeDom(initialDraft = '') {
  const textarea = new FakeTextarea()
  textarea._value = initialDraft
  const doc = {
    activeElement: null,
    querySelector: (selector) => (selector === Composer.COMPOSER_SELECTOR ? textarea : null),
  }
  textarea.doc = doc
  const frames = []
  const timers = []
  const win = {
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length },
    setTimeout: (fn) => { timers.push(fn); return timers.length },
  }
  return {
    textarea, doc, win, frames, timers,
    /** 只跑 rAF（模拟前台可见）。 */
    flushFrames: () => { const list = frames.splice(0); for (const fn of list) fn() },
    /** 只跑 setTimeout（模拟页面在后台标签页：rAF 永远不触发）。 */
    flushTimers: () => { const list = timers.splice(0); for (const fn of list) fn() },
  }
}

/** 把假 document / window 装成全局，跑完还原。CompanyView 里的 draftComposer 读的是全局那两个。 */
function withGlobals(dom, run) {
  const hadDoc = 'document' in globalThis
  const hadWin = 'window' in globalThis
  const prevDoc = globalThis.document
  const prevWin = globalThis.window
  globalThis.document = dom.doc
  globalThis.window = dom.win
  try { return run() } finally {
    if (hadDoc) globalThis.document = prevDoc; else delete globalThis.document
    if (hadWin) globalThis.window = prevWin; else delete globalThis.window
  }
}

/** 记录调用的 InputActions 替身，形状照抄已安装的 0.1.0-rc.7 契约。 */
function fakeInputActions(behaviour = {}) {
  const calls = { setDraft: [], submit: 0 }
  return {
    calls,
    actions: {
      setDraft(text) { calls.setDraft.push(text); if (behaviour.throws) throw new Error('宿主拒绝了草稿写入') },
      addImages: () => true,
      removeImage: () => {},
      pruneImages: () => {},
      submit() { calls.submit += 1 },
    },
  }
}

const STAFF = [
  { id: 'developer', name: '小刘', role: '程序员', roleId: 'developer', department: '产品研发部', emoji: '👨‍💻' },
  { id: 'platform', name: '大壮', role: '平台工程师', roleId: 'platform', department: '产品研发部', emoji: '🛠' },
]
const CONFIG = { companyName: '赛博公司 · AI 员工总部', staff: STAFF, roles: [], chatEnabled: true }

function renderCompany(actions) {
  return render(CompanyViewMod.CompanyView, {
    useSession: () => undefined,
    inputActions: actions,
    config: CONFIG,
    rpc: null,
  })
}

// ---------------------------------------------------------------------------
// D1 草稿并进现有内容，绝不覆盖老板已经敲进去的字
// ---------------------------------------------------------------------------

test('composer: 插入 @员工 只往草稿里接，老板写的字一个都不许丢', () => {
  assert.equal(Composer.joinDraft('', '@小刘 '), '@小刘 ')
  assert.equal(Composer.joinDraft('   ', '@小刘 '), '@小刘 ', '只有空白等于空草稿')
  assert.equal(Composer.joinDraft('把登录页修一下', '@小刘 '), '把登录页修一下 @小刘 ')
  assert.equal(Composer.joinDraft('把登录页修一下 ', '@小刘 '), '把登录页修一下 @小刘 ', '末尾已有空白就不再补')
  // 引用芯片占位符（U+FFFC）trim 之后是空的，但它是真实内容，不许被当成空草稿冲掉。
  assert.equal(Composer.joinDraft('￼', '@小刘 '), '￼ @小刘 ')
})

test('composer: 同一个人点两下也看得见变化（machine 对完全相同的草稿是彻底空操作）', () => {
  const dom = fakeDom()
  const { actions, calls } = fakeInputActions()
  assert.equal(Composer.writeDraft(actions, Composer.joinDraft(dom.textarea.value, '@小刘 '), dom.doc), 'actions')
  dom.textarea._value = calls.setDraft[0]
  assert.equal(Composer.writeDraft(actions, Composer.joinDraft(dom.textarea.value, '@小刘 '), dom.doc), 'actions')
  assert.notEqual(calls.setDraft[1], calls.setDraft[0], '第二次写的文本和第一次一样 → 宿主 machine 直接 return，画面上毫无反应')
})

// ---------------------------------------------------------------------------
// D2 宿主 face 缺席 / 抛错时要退到原生 input 事件，不许静默失败
// ---------------------------------------------------------------------------

test('composer: 宿主没给 inputActions 时退到原生 input 事件，草稿照样落进 textarea', () => {
  const dom = fakeDom()
  assert.equal(Composer.writeDraft(undefined, '@小刘 ', dom.doc), 'dom')
  assert.equal(dom.textarea.value, '@小刘 ')
  assert.deepEqual(dom.textarea.events, ['input'], '必须派发 input 事件，否则受控组件的 onChange 不会跑')
})

test('composer: setDraft 抛错也退到兜底路径，不许当成写成功了', () => {
  const dom = fakeDom()
  const { actions } = fakeInputActions({ throws: true })
  assert.equal(Composer.writeDraft(actions, '@大壮 ', dom.doc), 'dom')
  assert.equal(dom.textarea.value, '@大壮 ')
})

test('composer: 两条路都不通时如实返回 none，绝不假装写进去了', () => {
  const empty = { activeElement: null, querySelector: () => null }
  assert.equal(Composer.writeDraft(undefined, '@小刘 ', empty), 'none')
})

// ---------------------------------------------------------------------------
// D3 焦点不许只挂 rAF —— 页面在后台标签页时 rAF 永远不触发
// ---------------------------------------------------------------------------

test('composer: 页面在后台（rAF 永不触发）时，焦点仍然靠 setTimeout 兜底交还 Composer', () => {
  const dom = fakeDom()
  dom.doc.activeElement = { tag: '别处的按钮' }
  Composer.scheduleFocus(dom.win, dom.doc)
  assert.equal(dom.doc.activeElement, dom.textarea, '同步那一次就该拿到焦点（还在用户手势里）')
  assert.ok(dom.frames.length > 0 && dom.timers.length > 0, 'rAF 与 setTimeout 必须各排一次，缺一条就是原来的 bug')

  // 模拟后台：只跑 timers，一帧都不给。
  dom.doc.activeElement = { tag: '别处的按钮' }
  dom.flushTimers()
  assert.equal(dom.doc.activeElement, dom.textarea, 'rAF 不触发时焦点就永远不过去 —— 这正是真机上「有焦点:false」的成因')
  assert.deepEqual(dom.textarea.selection, [dom.textarea.value.length, dom.textarea.value.length], '光标要落在末尾')
})

// ---------------------------------------------------------------------------
// D4 + 全链路：面板上每个 @ 入口点下去都必须真的写进草稿，且一次都不许 submit
// ---------------------------------------------------------------------------

test('company-view: 顶栏与通讯录的 @ 入口点下去真的写草稿、真的把焦点交还 Composer，且从不 submit', () => {
  const dom = fakeDom()
  const { actions, calls } = fakeInputActions()
  const tree = renderCompany(actions)

  const market = collect(tree, (node) => className(node) === 'cy9-market-btn' && ownText(node) === '插件市场')[0]
  assert.ok(market, '顶栏「插件市场」按钮不见了')
  const at = collect(tree, (node) => className(node) === 'cy9-emp-at')
  assert.equal(at.length, STAFF.length, '通讯录每一行都要有一个单击就能 @ 的明牌入口')

  withGlobals(dom, () => {
    market.node.props.onClick()
    dom.flushFrames()
  })
  assert.equal(calls.setDraft.length, 1)
  assert.match(calls.setDraft[0], /@大壮/)
  assert.equal(dom.doc.activeElement, dom.textarea, '焦点必须回到原生 Composer')

  // 老板已经敲了半句话，再点通讯录里的 @：他的字必须原样留着。
  dom.textarea._value = '今晚要上线'
  let stopped = 0
  withGlobals(dom, () => {
    at[0].node.props.onClick({ stopPropagation: () => { stopped += 1 } })
  })
  assert.equal(stopped, 1, '行内 @ 必须吃掉冒泡，否则外层 onSelect 会跟着跑')
  assert.equal(calls.setDraft[1], '今晚要上线 @小刘 ')
  assert.equal(calls.submit, 0, '写草稿这条路一次都不许调 submit —— 发不发由老板决定')
})

test('company-view: 宿主一个 inputActions 都不给时，@ 入口照样把草稿写进真实 textarea', () => {
  const dom = fakeDom()
  const tree = renderCompany(undefined)
  const market = collect(tree, (node) => className(node) === 'cy9-market-btn' && ownText(node) === '插件市场')[0]
  withGlobals(dom, () => { market.node.props.onClick() })
  assert.match(dom.textarea.value, /@大壮/, 'inputActions 缺席时原来什么都不做，草稿恒为空 —— 就是这条 bug')
  assert.deepEqual(dom.textarea.events, ['input'])
})

// ---------------------------------------------------------------------------
// D5 办公室的 @ 入口不许躲在会被裁掉的滚动区里
// ---------------------------------------------------------------------------

test('office: 选中员工后的 @ 入口必须在 viewport 之外（悬浮卡整张都落在可视区外，点不到）', () => {
  const office = render(Office.OfficeWorld, {
    staff: STAFF, statuses: { developer: 'running' }, tasksMap: {}, tick: 0,
    activeStaffId: 'developer', zoomIdx: 0,
    onZoom: () => {}, onSelect: () => {}, onTalk: () => {}, onOpenProfile: () => {}, runtime: null,
  })
  const dock = collect(office, (node) => className(node) === 'cy9-office-dock')[0]
  assert.ok(dock, '选中员工后必须给出一条固定可见的操作栏')
  assert.ok(
    !dock.inside.some((parent) => className(parent).includes('cy9-office-viewport')),
    '操作栏一旦落进 .cy9-office-viewport 就会被裁 —— 真机上悬浮卡正是这么死的',
  )

  assert.ok(
    collect(dock.node, (node) => ownText(node).includes('@ 小刘') && typeof node.props.onClick === 'function')[0],
    '操作栏里必须有 @ 本人',
  )
  // onTalk 由 CompanyView 注入，这里只验证它确实被接上了（上面那条用例验证真实写入）。
  let talked = null
  const wired = render(Office.OfficeWorld, {
    staff: STAFF, statuses: {}, tasksMap: {}, tick: 0, activeStaffId: 'developer', zoomIdx: 0,
    onZoom: () => {}, onSelect: () => {}, onTalk: (item) => { talked = item }, onOpenProfile: () => {}, runtime: null,
  })
  collect(wired, (node) => ownText(node).includes('@ 小刘') && typeof node.props.onClick === 'function')[0].node.props.onClick()
  assert.equal(talked?.id, 'developer')
})

test('office: 小人的 tooltip 与真实事件处理一致 —— 单击选中、双击 @，两条都写清楚', () => {
  const office = render(Office.OfficeWorld, {
    staff: STAFF, statuses: {}, tasksMap: {}, tick: 0, activeStaffId: null, zoomIdx: 0,
    onZoom: () => {}, onSelect: () => {}, onTalk: () => {}, onOpenProfile: () => {}, runtime: null,
  })
  const sprite = collect(office, (node) => className(node).startsWith('cy9-sprite '))[0]
  assert.ok(sprite, '办公室里没画出小人')
  assert.equal(typeof sprite.node.props.onClick, 'function')
  assert.equal(typeof sprite.node.props.onDoubleClick, 'function', '双击 @ 的处理器还在')
  assert.match(sprite.node.props.title, /单击选中/, 'tooltip 只说双击 = 漏了单击那条路，老板会以为 @ 是死的')
  assert.match(sprite.node.props.title, /双击直接 @ 本人/)
})
