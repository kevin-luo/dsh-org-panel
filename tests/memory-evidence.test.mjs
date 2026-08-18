// 需求文档六十条前两句：「老王越来越懂我的代码库」「小刘踩过的坑现在会主动避开」。
//
// 在这组用例之前，这两句话在产品里是**零可见性**的：记忆确实写进了 evolution.json，
// digest 也确实进了子代理 persona，但老板在回答现场看不到任何「我用到了历史」的痕迹，
// 于是「这次没踩坑」永远无法归因给系统 —— 持久化做得再好，感受也不会产生。
//
// 这里守的就是「证据必须是真的」这条线，每一条都按「老板会不会被这枚 chip 骗到」来写：
//   M1 同一员工先后两次任务，第二次的证据里能看到第一次真实沉淀下来的记忆与复盘；
//   M2 证据里的每一个 id 都能在 evolution.json 里查到真实条目（不许凭空 id）；
//   M3 注入之后才产生的记忆，绝不会混进这次的证据（不按相关度现编）；
//   M4 注入 0 条时台账照记，但 UI 不产生 chip（不是显示一个「0 条」的 chip）；
//   M5 chip 文案 = 真实条数，点开列出真实条目（内容 + 时间 + 来源任务）；
//   M6 通道不通时不显示 chip（「读不到」不许渲染成 0）；
//   M7 记忆分页真的分页：一页 10 条、offset 生效、不许一次拉 120 条；
//   M8 `/org-panel` 频道上真的挂着这两个端点（守住 host-v3 那行接线，被人覆盖就红）。
//
// 口径：host 侧全部跑 lib/index.js 这个发布产物 + 真 cordis Context + 真 EvolutionStore 落盘；
// client 侧用 typescript.transpileModule 现编 src/client-v9/**，跑的是真实组件源码，
// 喂给它的数据来自上面那条真实 `/org-panel` 频道，不手搓假证据。
import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import React from 'react'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dshWebStack, realCordisCtx, scratch, settleFiber } from './_helpers.mjs'

const { apply, inject } = await import('../lib/index.js')

const HERE = dirname(fileURLToPath(import.meta.url))
const V9 = resolve(HERE, '..', 'src', 'client-v9')
const nodeRequire = createRequire(join(HERE, '..', 'package.json'))

// ---------------------------------------------------------------------------
// 迷你 TS 模块加载器（与 ui-honesty.test.mjs 同一套做法：加载真实组件源码，不改一行业务代码）
// ---------------------------------------------------------------------------

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

const evidenceModule = loadTs(join(V9, 'memory-evidence.ts'))
const ChatMessageModule = loadTs(join(V9, 'components', 'ChatMessage.tsx'))
const MemoryTabModule = loadTs(join(V9, 'employee-profile', 'MemoryTab.tsx'))

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
 * 装上一个只跑一次、不保存状态的 dispatcher。initial 用来把某个 useState 的初值换掉
 * （这里只用来把 chip 的 open=false 换成 true，好断言展开后的面板），
 * 生产代码一行都不用为测试改。
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

/** 把 chip 的收起状态翻成展开，用来断言面板里到底列了什么。 */
const CHIP_OPEN = new Map([[false, true]])

function renderNode(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return node
  if (Array.isArray(node)) return node.map(renderNode)
  if (typeof node !== 'object' || !node.props) return node
  if (typeof node.type === 'function') return renderNode(node.type(node.props))
  const props = {}
  for (const [key, value] of Object.entries(node.props)) props[key] = renderNode(value)
  return { ...node, props }
}

function render(component, props, initial) {
  return withHooks(() => renderNode(component(props)), initial)
}

/** 把渲染树摊平成一串文本，用来断言屏幕上到底写了什么。 */
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node !== 'object') return ''
  return textOf(node.props?.children)
}

/** 按 className 找节点。 */
function findByClass(node, className, found = []) {
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) { for (const item of node) findByClass(item, className, found); return found }
  if (node.props?.className === className) found.push(node)
  findByClass(node.props?.children, className, found)
  return found
}

// ---------------------------------------------------------------------------
// host 夹具：真 cordis + 真频道 + 一个可观测的假 subagents
// ---------------------------------------------------------------------------

/**
 * 假 subagents：只提供一次性前台 provider（没有 prepareContinuable），
 * 于是 staff_chat 走 runEmployeeOnce 那条真实链路，childId 就是 run.id。
 * personas 记下每一次真正发出去的 persona 文本 —— 「真实注入过」这句话最后要靠它证明。
 */
function fakeSubagents(replies = {}) {
  const personas = []
  let seq = 0
  return {
    personas,
    service: {
      list: () => ['spawn'],
      getProvider: (name) => (name === 'spawn' ? { name } : undefined),
      async start(_provider, request) {
        seq += 1
        const childId = `child-${seq}`
        personas.push({ childId, label: request.label, persona: String(request.persona || '') })
        const reply = replies[childId] || '老板，已经按你说的做完了。'
        return {
          id: childId,
          result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: reply }] }),
          async dispose() {},
        }
      },
    },
  }
}

async function boot(name, replies) {
  const dir = await scratch(name)
  const subagents = fakeSubagents(replies)
  const { root, registered } = realCordisCtx({ subagents: subagents.service })
  const web = await dshWebStack(root)

  let host
  const fiber = root.plugin({
    name: 'dsh-org-panel',
    inject,
    apply(ctx, cfg) { host = apply(ctx, cfg); return host },
  }, {
    memoryFile: join(dir, 'evolution.json'),
    companyFile: join(dir, 'company.json'),
    approvalsFile: join(dir, 'plugin-approvals.json'),
    healthCheckOnStart: false,
  })
  await settleFiber(fiber)

  const route = web.routes[0]
  assert.ok(route, '/org-panel 频道没有注册，本组用例的前提不成立')
  const callEndpoint = (endpoint, payload = {}) => route.handler(endpoint, payload, new AbortController().signal)
  /** 一个直连真实 host 端点的 client 侧 rpc：浏览器发过来的那一次调用就走这条路。 */
  const rpc = { call: (_channel, endpoint, payload) => callEndpoint(endpoint, payload) }
  const parent = { session: { id: `sess-${name}` } }
  const exec = { agent: parent, signal: new AbortController().signal }
  const tool = (toolName) => {
    const found = registered.get(toolName)
    assert.ok(found, `工具 ${toolName} 没有注册`)
    return found
  }
  const chat = (staff, message) => tool('staff_chat').execute({ staff, message }, exec)

  return {
    dir, host, fiber, subagents, rpc, callEndpoint, tool, chat,
    memoryFile: join(dir, 'evolution.json'),
    async evolution() { return JSON.parse(await readFile(join(dir, 'evolution.json'), 'utf-8')) },
  }
}

/** 一次真实的 memory/evidence 调用，取某个 childId 的那一条台账。 */
async function evidenceOf(ctx, employeeId, childId) {
  const result = await ctx.callEndpoint('memory/evidence', { employeeId, childId })
  assert.equal(result.ok, true, `memory/evidence 失败：${result.ok === false ? result.error.message : ''}`)
  return result.value.injections[0] || null
}

// ---------------------------------------------------------------------------
// M1 / M2 / M3：证据必须是真的
// ---------------------------------------------------------------------------

test('M1 第二次任务的证据里能看到第一次沉淀的记忆与复盘，且它们真的进了 persona', async () => {
  const ctx = await boot('mem-two-turns')

  // 第一次任务：跑完之后 host 会把「完成任务…交付摘要…」真实写进长期记忆。
  await ctx.chat('developer', '修一下登录接口重定向')
  // 员工自己复盘一次（真实工具、真实落盘）：这就是「小刘踩过的坑」。
  await ctx.tool('staff_reflect').execute({
    staff: 'developer', task: '修登录接口重定向', outcome: 'blocked',
    lesson: '动重定向前必须先看 nginx 配置，否则本地过了线上必挂',
  }, { agent: { session: { id: 'sess-x' } } })

  // 第二次任务。
  await ctx.chat('developer', '再看看登录接口那个问题')

  const second = ctx.subagents.personas.at(-1)
  assert.equal(second.childId, 'child-2')

  const view = await evidenceOf(ctx, 'developer', 'child-2')
  assert.ok(view, '第二次任务必须有一条注入台账')
  assert.ok(view.items.length >= 2, `第二次注入应当带上第一次的沉淀，实际 ${view.items.length} 条`)

  const memories = view.items.filter((item) => item.type === 'memory')
  const reflections = view.items.filter((item) => item.type === 'reflection')
  assert.ok(memories.length >= 1, '第一次任务沉淀的记忆必须出现在第二次的证据里')
  assert.equal(reflections.length, 1, '刚写的那条复盘必须出现在第二次的证据里')
  assert.match(reflections[0].text, /nginx/, '复盘正文必须是真实写下的那一条')
  assert.equal(reflections[0].sourceTask, '修登录接口重定向', '复盘要带回真实来源任务')
  assert.match(memories.map((item) => item.text).join('\n'), /登录接口重定向/)

  // 「真实注入过」不是一句口号：这些条目必须逐字出现在真正发出去的那段 persona 里。
  for (const item of view.items) {
    assert.ok(second.persona.includes(item.text), `证据条目没有出现在真实 persona 里：${item.text}`)
  }
})

test('M2 证据里的每个 id 都能在 evolution.json 查到真实条目', async () => {
  const ctx = await boot('mem-real-ids')
  await ctx.chat('developer', '梳理一下支付回调的重试策略')
  await ctx.tool('staff_reflect').execute({
    staff: 'developer', task: '支付回调重试', outcome: 'partial', lesson: '重试要带幂等键，否则会重复入账',
  }, { agent: { session: { id: 'sess-x' } } })
  await ctx.chat('developer', '继续看支付回调')

  const view = await evidenceOf(ctx, 'developer', 'child-2')
  const file = await ctx.evolution()
  const profile = file.employees.developer
  const memoryIds = new Set(profile.memories.map((item) => item.id))
  const reflectionIds = new Set(profile.reflections.map((item) => item.id))

  assert.ok(view.items.length > 0)
  for (const item of view.items) {
    const pool = item.type === 'memory' ? memoryIds : reflectionIds
    assert.ok(pool.has(item.id), `证据 id ${item.id} 在 evolution.json 里不存在，等于凭空造证据`)
  }
  // 台账里的 id 数 = 查得到的条目数 + 查不到的条数，两边必须对得上，不许悄悄补齐或吞掉。
  assert.equal(
    view.injection.memoryIds.length + view.injection.reflectionIds.length,
    view.items.length + view.missing,
  )
})

test('M3 注入之后才产生的记忆，绝不会混进这一次的证据', async () => {
  const ctx = await boot('mem-no-backfill')
  const remember = (text) => ctx.tool('staff_memory_remember').execute(
    { staff: 'developer', kind: 'project', text, importance: 5 },
    { agent: { session: { id: 'sess-x' } } },
  )

  await ctx.chat('developer', '看看首页的埋点')
  await remember('首页埋点走的是自研 SDK，不是 GA')
  // child-2 这一轮注入时，上面那条已经在档案里了。
  await ctx.chat('developer', '继续看首页埋点')
  // 这一条是 child-2 注入**之后**才写的：按相关度它同样高度相关，但当时并没有被注入。
  await remember('埋点上报域名上周换成了 t.example.com')

  const view = await evidenceOf(ctx, 'developer', 'child-2')
  assert.ok(view.items.some((item) => item.text.includes('自研 SDK')), '注入时就存在的记忆必须在证据里')
  assert.ok(
    !view.items.some((item) => item.text.includes('t.example.com')),
    '事后写的记忆被算进了这次证据 —— 那是按相关度现编，不是注入记录',
  )
})

// ---------------------------------------------------------------------------
// M4 / M5 / M6：chip 只在有真东西时出现
// ---------------------------------------------------------------------------

/** 造一条真实形状的员工消息节点：staff_chat 的 tool-result，带 NIUMA_STAFF 标记。 */
function staffMessage(staffId, childId, content) {
  const node = {
    kind: 'tool-result',
    call: { name: 'staff_chat' },
    content: [{ type: 'text', text: `[[NIUMA_STAFF id="${staffId}" child="${childId}" state="replied"]]\n回复：\n${content}` }],
  }
  return {
    id: `m-${childId}`, channelId: '', node,
    sender: { type: 'employee', staffId },
    content, mentions: [], kind: 'message', createdAt: Date.now(),
  }
}

const STAFF = [
  { id: 'developer', name: '小刘', role: '程序员', emoji: '💻', intro: '', roleId: 'developer' },
  { id: 'researcher', name: '阿搜', role: '研究员', emoji: '🔍', intro: '', roleId: 'researcher' },
]

async function chipFor(ctx, staffId, childId) {
  evidenceModule.resetMemoryEvidence()
  evidenceModule.ensureMemoryEvidence(staffId, childId, ctx.rpc)
  // ensureMemoryEvidence 是 fire-and-forget，等它把真实应答落进缓存（idle/loading 之外都算落定）。
  for (let i = 0; i < 60; i++) {
    const settled = evidenceModule.readMemoryEvidence(staffId, childId).state
    if (settled !== 'idle' && settled !== 'loading') break
    await new Promise((done) => setTimeout(done, 5))
  }
  const tree = render(ChatMessageModule.ChatMessage, {
    message: staffMessage(staffId, childId, '老板，看完了。'),
    staff: STAFF,
    onOpenThread: () => {},
  })
  return { tree, chips: findByClass(tree, 'cy9-mem-chip'), state: evidenceModule.readMemoryEvidence(staffId, childId) }
}

test('M4 注入 0 条时台账照记，但消息旁不产生 chip', async () => {
  const ctx = await boot('mem-zero')
  // 阿搜是全新员工：一条记忆、一条复盘都没有，这一轮真实注入 0 条。
  await ctx.chat('researcher', '帮我查一下竞品最近的定价')

  const view = await evidenceOf(ctx, 'researcher', 'child-1')
  assert.ok(view, 'host 必须如实记下「这一轮注入了 0 条」这件事')
  assert.equal(view.items.length, 0)
  assert.equal(view.injection.memoryIds.length, 0)
  assert.equal(view.injection.reflectionIds.length, 0)

  const { chips, state } = await chipFor(ctx, 'researcher', 'child-1')
  assert.equal(state.state, 'ok', '通道是通的，状态必须是 ok（不是 unavailable）')
  assert.equal(chips.length, 0, '注入 0 条必须是「没有 chip」，而不是一个写着 0 条的 chip')
})

test('M5 chip 文案是真实条数，点开列出真实条目（内容 + 时间 + 来源任务）', async () => {
  const ctx = await boot('mem-chip')
  await ctx.chat('developer', '排查一下构建缓存')
  await ctx.tool('staff_reflect').execute({
    staff: 'developer', task: '排查构建缓存', outcome: 'success', lesson: 'CI 缓存键要带上 lockfile 哈希',
  }, { agent: { session: { id: 'sess-x' } } })
  await ctx.chat('developer', '再看看构建缓存')

  const view = await evidenceOf(ctx, 'developer', 'child-2')
  const memoryCount = view.items.filter((item) => item.type === 'memory').length
  const reflectionCount = view.items.filter((item) => item.type === 'reflection').length

  const { tree, chips } = await chipFor(ctx, 'developer', 'child-2')
  assert.equal(chips.length, 1, '有真实注入就必须有一枚 chip')
  const label = textOf(chips[0]).trim()
  assert.match(label, /^引用了/)
  assert.match(label, new RegExp(`${memoryCount} 条记忆`), `chip 上的记忆条数必须等于真实注入条数（${memoryCount}）`)
  assert.match(label, new RegExp(`${reflectionCount} 条复盘`), `chip 上的复盘条数必须等于真实注入条数（${reflectionCount}）`)

  assert.equal(findByClass(tree, 'cy9-mem-pop').length, 0, '默认收起，不该一上来就铺一屏记忆')

  // 展开面板：逐条断言「内容摘要 + 时间 + 来源任务」三样都在，且内容就是真实条目原文。
  const opened = render(ChatMessageModule.ChatMessage, {
    message: staffMessage('developer', 'child-2', '老板，看完了。'),
    staff: STAFF,
    onOpenThread: () => {},
  }, CHIP_OPEN)
  const pop = findByClass(opened, 'cy9-mem-pop')
  assert.equal(pop.length, 1, '点开必须真的展开一块面板')
  const rows = findByClass(opened, 'cy9-mem-row')
  assert.equal(rows.length, view.items.length, '面板里列出的条数必须等于真实注入条数')
  const popText = textOf(pop[0])
  for (const item of view.items) {
    assert.ok(popText.includes(item.text.slice(0, 20)), `面板里没有列出真实条目：${item.text}`)
  }

  const reflection = view.items.find((item) => item.type === 'reflection')
  assert.ok(reflection.sourceTask, '复盘必须带真实来源任务')
  assert.ok(reflection.createdAt > 0, '条目必须带真实时间')
  assert.ok(popText.includes(`来源任务：${reflection.sourceTask}`), '复盘要把真实来源任务写在屏幕上')
  const memory = view.items.find((item) => item.type === 'memory')
  assert.equal(memory.sourceTask, undefined, '记忆没有结构化来源任务，就该缺席')
  assert.ok(popText.includes('来源任务未知'), '拿不到来源任务时要如实说未知，不许拿别的内容顶上')
})

test('M6 没有 client↔host 通道时不显示 chip，也不把「读不到」渲染成 0', async () => {
  evidenceModule.resetMemoryEvidence()
  evidenceModule.ensureMemoryEvidence('developer', 'child-9', null)
  const state = evidenceModule.readMemoryEvidence('developer', 'child-9')
  assert.equal(state.state, 'unavailable', '没有通道是 unavailable，不是「没有记忆」')
  assert.ok(state.message, '必须带上真实原因，方便定位')
  const tree = render(ChatMessageModule.ChatMessage, {
    message: staffMessage('developer', 'child-9', '老板，好了。'),
    staff: STAFF,
    onOpenThread: () => {},
  })
  assert.equal(findByClass(tree, 'cy9-mem-chip').length, 0)
  assert.ok(!textOf(tree).includes('引用了'), '读不到时一个字的断言都不许上屏')
})

// ---------------------------------------------------------------------------
// M7 / M8：记忆分页与频道接线
// ---------------------------------------------------------------------------

test('M7 memory/page 真的分页：一页 10 条、offset 生效、不许一次拉 120 条', async () => {
  const ctx = await boot('mem-page')
  const store = ctx.host.core.store
  for (let index = 0; index < 25; index++) {
    await store.remember('developer', { kind: 'preference', text: `老板偏好第 ${index + 1} 条：这条要按 ${index} 号规则处理`, importance: 3 })
  }

  const first = await ctx.callEndpoint('memory/page', { employeeId: 'developer', kind: 'preference', offset: 0, limit: 10 })
  assert.equal(first.ok, true)
  assert.equal(first.value.items.length, 10)
  assert.equal(first.value.total, 25)
  assert.equal(first.value.hasMore, true)

  const second = await ctx.callEndpoint('memory/page', { employeeId: 'developer', kind: 'preference', offset: 10, limit: 10 })
  const third = await ctx.callEndpoint('memory/page', { employeeId: 'developer', kind: 'preference', offset: 20, limit: 10 })
  assert.equal(second.value.items.length, 10)
  assert.equal(third.value.items.length, 5)
  assert.equal(third.value.hasMore, false)

  const ids = [...first.value.items, ...second.value.items, ...third.value.items].map((item) => item.id)
  assert.equal(new Set(ids).size, 25, '三页之间不许有重复或漏条')

  // 「不要一次加载全部 120 条」：要多少都夹到 30。
  const greedy = await ctx.callEndpoint('memory/page', { employeeId: 'developer', kind: 'preference', offset: 0, limit: 120 })
  assert.ok(greedy.value.items.length <= 30, '单次分页上限必须夹住，别让浏览器一次吃下整本档案')

  // 分组过滤是真的：另一个分组一条都不该串进来。
  const other = await ctx.callEndpoint('memory/page', { employeeId: 'developer', kind: 'relationship', offset: 0, limit: 10 })
  assert.equal(other.value.items.length, 0)
  assert.equal(other.value.total, 0)

  // 名册里没有的 id 必须被挡住：否则一次 RPC 就能往公司里凭空塞一位员工。
  const ghost = await ctx.callEndpoint('memory/page', { employeeId: 'ghost', kind: 'preference' })
  assert.equal(ghost.ok, false)
})

test('M7b MemoryTab 在有通道时用真实分页加载器，没有通道时如实说明还有多少条没下发', async () => {
  const ctx = await boot('mem-tab')
  const store = ctx.host.core.store
  for (let index = 0; index < 24; index++) {
    await store.remember('developer', { kind: 'preference', text: `偏好条目 ${index + 1}`, importance: 3 })
  }
  const snapshot = await ctx.host.core.company.employeeSnapshot(
    { id: 'developer', name: '小刘', role: '程序员' },
    { memoryLimit: 8 },
  )
  const rpcModule = loadTs(join(V9, 'rpc.ts'))

  // 有通道：MemoryTab 自己造出加载器，「加载更多」按钮是活的。
  rpcModule.setCurrentOrgPanelRpc(ctx.rpc)
  const withChannel = render(MemoryTabModule.MemoryTab, { employeeId: 'developer', snapshot, loadMemories: undefined })
  const more = findByClass(withChannel, 'cy9-ep-more')
  assert.equal(more.length, 1, '有通道时必须给出真实的「加载更多」')
  assert.match(textOf(more[0]), /加载更多/)

  // 真的能翻页：拿组件用的同一个加载器打一次真实 RPC。
  const loader = evidenceModule.createMemoryLoader(ctx.rpc)
  assert.ok(loader, '有通道就必须造得出加载器')
  const page = await loader({ employeeId: 'developer', kind: 'preference', offset: 8, limit: 10 })
  assert.equal(page.items.length, 10)
  assert.equal(page.total, 24)
  assert.equal(page.hasMore, true)

  // 没通道：不许假装已经全部显示，要如实说明还差多少条。
  rpcModule.setCurrentOrgPanelRpc(null)
  const offline = render(MemoryTabModule.MemoryTab, { employeeId: 'developer', snapshot, loadMemories: undefined })
  assert.equal(findByClass(offline, 'cy9-ep-more').length, 0)
  assert.match(textOf(offline), /未下发/)
})

test('M8 /org-panel 频道上真的挂着 memory/page 与 memory/evidence', async () => {
  const ctx = await boot('mem-wired')
  assert.ok(ctx.host.core.memoryEndpoints['memory/page'], 'core 必须自带 memory/page')
  assert.ok(ctx.host.core.memoryEndpoints['memory/evidence'], 'core 必须自带 memory/evidence')
  // 这一条守的是 host-v3 里把 core.memoryEndpoints 并进频道的那一行：
  // 被人覆盖掉的话，端点会退化成 bad-request，这里立刻变红。
  const page = await ctx.callEndpoint('memory/page', { employeeId: 'developer' })
  assert.equal(page.ok, true, '频道上没有 memory/page —— host-v3 的端点合并那行被改没了')
  const evidence = await ctx.callEndpoint('memory/evidence', { employeeId: 'developer' })
  assert.equal(evidence.ok, true, '频道上没有 memory/evidence —— host-v3 的端点合并那行被改没了')
  assert.deepEqual(evidence.value.injections, [], '一次任务都没跑过就该是空数组，不是编一条出来')
})
