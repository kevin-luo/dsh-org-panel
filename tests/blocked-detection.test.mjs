// G4：「卡住」的定义 + 「现在」的单一答案位。
//
// 这一组守的是四件事，每一条都对应一个「老板会被这块屏幕骗到」的真实洞：
//   B1 员工回一句「我需要你确认用哪个数据库再继续」是一次**成功**的 tool-result。
//      只认 res.isError 的话，顶栏把它计进「已交付」、办公室画成绿色 ✓ ——
//      老板最该看见的那类卡住，恰恰是唯一看不见的一类。
//   B2 反向：正常交付一条都不许被误判成卡住。把交付标成卡住比漏判更伤信任，
//      所以这里的反例比正例多，规则宁可漏判。
//   B3 顶栏 / 办公室 / 左栏 / 右栏必须读同一份 CompanyRuntime：同一份输入 → 同一份计数。
//      以前顶栏走 buildCompanyStatuses（派活推导）、右栏优先走 Event Bus，两个口径能同时上屏。
//   B4 tick 只准驱动装饰：走 12 帧，文案与坐标一个字节都不许变（既有 U7 断言的同款约束）。
//
// 口径同 ui-honesty.test.mjs：用 typescript 的 transpileModule 现编 src/**，跑真实源码，不手搓替身。
import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import React from 'react'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '..', 'src')
const V9 = join(SRC, 'client-v9')
const nodeRequire = createRequire(join(HERE, '..', 'package.json'))

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

const S = loadTs(join(V9, 'selectors.ts'))
const Events = loadTs(join(SRC, 'runtime', 'company-events.ts'))
const Header = loadTs(join(V9, 'components', 'CompanyHeader.tsx'))
const Office = loadTs(join(V9, 'components', 'OfficeWorld.tsx'))
const List = loadTs(join(V9, 'components', 'EmployeeList.tsx'))
const Rail = loadTs(join(V9, 'components', 'RightRail.tsx'))

// ---------------------------------------------------------------------------
// 静态渲染（同 ui-honesty.test.mjs：递归调用函数组件，读真实产出的元素树）
// ---------------------------------------------------------------------------

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

function walk(node, visit) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) { for (const item of node) walk(item, visit); return }
  if (typeof node === 'string' || typeof node === 'number') { visit(node); return }
  if (typeof node !== 'object' || !node.props) return
  visit(node)
  for (const value of Object.values(node.props)) walk(value, visit)
}

function textOf(node) {
  const parts = []
  walk(node, (item) => { if (typeof item === 'string' || typeof item === 'number') parts.push(String(item)) })
  return parts.join('\n')
}

/** 只走 children 的可见文字（textOf 连 className / title 也算进去，断言「屏幕上写着什么」时不能用）。 */
function visibleText(node) {
  const parts = []
  const visit = (item) => {
    if (item === null || item === undefined || typeof item === 'boolean') return
    if (Array.isArray(item)) { item.forEach(visit); return }
    if (typeof item === 'string' || typeof item === 'number') { parts.push(String(item)); return }
    if (typeof item !== 'object' || !item.props) return
    visit(item.props.children)
  }
  visit(node)
  return parts.join(' ')
}

function findByClass(tree, className) {
  let found = null
  walk(tree, (node) => {
    if (typeof node === 'object' && node && node.props && node.props.className === className && !found) found = node
  })
  return found
}

/** 办公室顶部「现在」那一行屏幕上真正写着的字。 */
function nowLine(office) {
  const row = findByClass(office, 'cy9-office-now')
  assert.ok(row, '办公室顶部没有「现在」那一行')
  return visibleText(row)
}

/** 一个 `<b>数字</b><span>标签</span>` 指标格当前显示的值。返回原始字符串，不做类型猜测。 */
function statOf(tree, label) {
  let value = null
  walk(tree, (node) => {
    if (typeof node !== 'object' || !node || !node.props) return
    const kids = [].concat(node.props.children ?? [])
    const b = kids.find((kid) => kid && typeof kid === 'object' && kid.type === 'b')
    const span = kids.find((kid) => kid && typeof kid === 'object' && kid.type === 'span' && textOf(kid) === label)
    if (b && span) value = textOf(b)
  })
  assert.notEqual(value, null, `页面上没有「${label}」这个指标格`)
  return value
}

/** 逐人状态：办公室小人与左栏行都会把自己的状态写进 data-status。 */
function statusTally(tree) {
  const tally = {}
  walk(tree, (node) => {
    if (typeof node !== 'object' || !node || !node.props) return
    const status = node.props['data-status']
    if (typeof status === 'string') tally[status] = (tally[status] || 0) + 1
  })
  return tally
}

/** 某个小人名字底下那一行小字：老板扫一眼就会当成「他现在在干什么」的那句。 */
function spriteLine(tree, name) {
  let line = null
  walk(tree, (node) => {
    if (typeof node !== 'object' || !node || !node.props || node.props.className !== 'cy9-sprite-label') return
    const kids = [].concat(node.props.children ?? [])
    if (!kids.some((kid) => kid && typeof kid === 'object' && kid.type === 'b' && textOf(kid) === name)) return
    const small = kids.find((kid) => kid && typeof kid === 'object' && kid.type === 'small')
    if (small) line = textOf(small)
  })
  return line
}

/** 办公室里每个小人的落位坐标（tick 不许改动其中任何一个）。 */
function spritePositions(tree) {
  const seats = []
  walk(tree, (node) => {
    if (typeof node !== 'object' || !node || !node.props) return
    if (typeof node.props['data-status'] !== 'string' || !node.props.style) return
    seats.push(`${node.props.style.left},${node.props.style.top}`)
  })
  return seats.join('|')
}

// ---------------------------------------------------------------------------
// 真实会话夹具
// ---------------------------------------------------------------------------

const T = 1_787_000_000_000
const ROLES = []
const STAFF = [
  { id: 'secretary', name: '小助', role: '秘书', roleId: 'secretary', department: '管理层', emoji: '', intro: '' },
  { id: 'tech-lead', name: '大壮', role: '技术负责人', roleId: 'tech-lead', department: '产品研发部', emoji: '', intro: '' },
  { id: 'developer', name: '小刘', role: '程序员', roleId: 'developer', department: '产品研发部', emoji: '', intro: '' },
  { id: 'pm', name: '小林', role: '产品经理', roleId: 'pm', department: '产品研发部', emoji: '', intro: '' },
  { id: 'doc', name: '小文', role: '文档', roleId: 'doc', department: '知识与内容部', emoji: '', intro: '' },
  { id: 'data-analyst', name: '小数', role: '数据分析', roleId: 'data-analyst', department: '数据智能部', emoji: '', intro: '' },
]
const ROSTER = STAFF.map((item) => item.id)

/** 一次真实的 staff_chat 往返：派活 → 接单回执（带 [[NIUMA_STAFF]]）→ 子代理结算回复。 */
function chatSession(reply, options = {}) {
  const { callId = 'c1', staffId = 'developer', message = '把用户表迁移到新库', t = T } = options
  const child = `${callId}-child`
  return [
    { kind: 'assistant', time: t + 1, blocks: [{ kind: 'tool-call', callId, name: 'staff_chat', argsRaw: JSON.stringify({ staff: staffId, message }) }] },
    { kind: 'tool-result', callId, time: t + 2, isError: false, content: [{ text: `[[NIUMA_STAFF id="${staffId}" child="${child}" state="accepted"]]\n已接通 ${staffId}（独立子代理），等本人回复` }] },
    {
      kind: 'user', time: t + 3, source: { kind: 'subagent-settled', senderSessionId: child },
      content: [{ text: `Background subagent ${child} finished. Its closing message: ${reply}` }],
    },
  ]
}

function runtimeOf(nodes, runningCalls = []) {
  return Events.reduceCompanyRuntime(S.deriveCompanyEvents(nodes, runningCalls, ROLES, STAFF), { employeeIds: ROSTER })
}

/** 同一份会话在「事件」与「派活推导」两条路上的结论。两条路都必须认卡住。 */
function verdictOf(nodes, staffId) {
  const delegations = S.extractDelegations(nodes, [], ROLES, STAFF)
  return {
    runtime: runtimeOf(nodes).employees[staffId].status,
    legacy: S.buildCompanyStatuses(STAFF, delegations, false).statuses[staffId],
    blocked: delegations.find((task) => task.staffId === staffId)?.blocked || null,
  }
}

// ---------------------------------------------------------------------------
// B1 待决信号 = 卡住
// ---------------------------------------------------------------------------

test('blocked: 「我需要你确认用哪个数据库」是成功的 tool-result，但必须算卡住而不是已交付', () => {
  const reply = '老板，我需要你确认用哪个数据库再继续。旧库是 mysql-a，新库是 mysql-b。'
  const verdict = verdictOf(chatSession(reply), 'developer')

  assert.equal(verdict.runtime, 'blocked', '成功的 tool-result 里写着待决问题，仍然是卡住')
  assert.equal(verdict.legacy, 'wait', '派活推导那条路也必须认，否则两处会互相打架')
  assert.equal(verdict.blocked?.ruleId, 'confirm')

  // reason 必须是员工的**原句片段**，不许改写、不许加情绪、不许猜他想干什么。
  const runtime = runtimeOf(chatSession(reply))
  const reason = runtime.employees.developer.block.reason
  assert.ok(reply.includes(reason.replace(/…$/, '')), `reason 必须出自原句，实际是「${reason}」`)
  assert.match(reason, /需要你确认用哪个数据库/)
  assert.doesNotMatch(reason, /可能|似乎|建议老板/, '不许在原因里替员工发挥')
})

test('blocked: 缺凭据 / 权限不足 / 等老板拍板 / 无法继续，四类待决信号都能进 task.blocked', () => {
  const cases = [
    ['缺少凭据', '我需要生产库的连接串才能跑迁移，现在拿不到。', 'credential'],
    ['权限不足', '尝试写入 /var/log 时权限不足，脚本已停在这一步。', 'permission'],
    ['等老板拍板', '两个方案各有取舍，等你确认之后我再动手。', 'decision'],
    ['无法继续', '上游接口返回的字段和文档对不上，无法继续，需要人工介入。', 'halt'],
    ['需要选择', '请老板选择保留 A 版还是 B 版的排版。', 'choose'],
  ]
  for (const [name, reply, ruleId] of cases) {
    const signal = S.detectPendingDecision(reply)
    assert.ok(signal, `${name}：这句话没有被认出来 —— ${reply}`)
    assert.equal(signal.ruleId, ruleId, `${name}：命中的规则不对`)
    assert.equal(verdictOf(chatSession(reply), 'developer').runtime, 'blocked', `${name}：没有进 blocked`)
  }
})

test('blocked: 规则表可配置可扩展，判定逻辑本身不用改', () => {
  assert.ok(Array.isArray(S.PENDING_SIGNAL_RULES) && S.PENDING_SIGNAL_RULES.length > 0)
  for (const rule of S.PENDING_SIGNAL_RULES) {
    assert.equal(rule.pattern.global, false, `规则 ${rule.id} 带了 g 标志，lastIndex 会让判定结果不可复现`)
  }
  const custom = [{ id: 'sop', label: '等 SOP', pattern: /等公司 SOP/ }]
  assert.equal(S.detectPendingDecision('这一步要等公司 SOP 定稿', custom)?.ruleId, 'sop')
  // 换了规则表就只按新表判：默认表里的「需要你确认」在自定义表里不再命中。
  assert.equal(S.detectPendingDecision('我需要你确认用哪个数据库', custom), null)
})

// ---------------------------------------------------------------------------
// B2 反向：正常交付一条都不许被误判
// ---------------------------------------------------------------------------

const NORMAL_DELIVERIES = [
  '已完成登录页重构，改了 3 个文件，测试全绿。',
  '周报已生成，共 5 个章节，如需调整我再改一版。',
  '已按老板确认的方案完成部署，服务已上线。',
  '数据库连接已建立，共写入 120 条记录。',
  '测试全部通过，没有权限问题。',
  '已选定方案 B 并完成实现，压测 QPS 1200。',
  '我确认了三处改动，构建通过。',
  '接口调用成功，返回 200，token 已生效。',
  '排查完成：问题出在缓存 key 写错了，已修复。',
  '文档已更新，请查收。',
  '已完成，请确认。',
  '已经和产品确认过需求，先开发第一版。',
  '两版设计都做完了，推荐 A 版，理由写在文末。',
  '权限申请单已提交并获批，昨天就跑通了。',
]

test('blocked: 正常交付一条都不许被误判成卡住', () => {
  for (const reply of NORMAL_DELIVERIES) {
    assert.equal(S.detectPendingDecision(reply), null, `被误判成卡住了：${reply}`)
    const verdict = verdictOf(chatSession(reply), 'developer')
    assert.equal(verdict.runtime, 'done', `事件路把交付判成了 ${verdict.runtime}：${reply}`)
    assert.equal(verdict.legacy, 'done', `派活推导路把交付判成了 ${verdict.legacy}：${reply}`)
    assert.equal(verdict.blocked, null)
  }
})

test('blocked: 空回复 / 纯日志不算待决信号，工具真报错仍然算卡住', () => {
  assert.equal(S.detectPendingDecision(''), null)
  assert.equal(S.detectPendingDecision(undefined), null)
  // 超长的一行多半是贴进来的日志，不是员工在跟老板说话。
  assert.equal(S.detectPendingDecision(`${'x'.repeat(160)}需要你确认`), null)

  const nodes = chatSession('随便写点什么')
  nodes[1] = { ...nodes[1], isError: true, content: [{ text: 'staff_chat failed: subagent crashed' }] }
  nodes.splice(2, 1) // 崩了就没有结算回复
  const runtime = runtimeOf(nodes)
  assert.equal(runtime.employees.developer.status, 'blocked')
  assert.match(runtime.employees.developer.block.reason, /subagent crashed/)
})

// ---------------------------------------------------------------------------
// B3 四处同一个口径
// ---------------------------------------------------------------------------

/** 一份同时含「工作中 / 会议中 / 卡住 / 已交付 / 待命」的真实会话。 */
function mixedSession() {
  return [
    // 卡住：成功的 tool-result，回复里是待决问题
    ...chatSession('老板，我需要你确认用哪个数据库再继续。', { callId: 'c1', staffId: 'developer' }),
    // 已交付
    ...chatSession('文案已定稿，三个版本都在文档里。', { callId: 'c2', staffId: 'doc', t: T + 10 }),
    // 工作中：派出去了还没有结果
    {
      kind: 'assistant', time: T + 20,
      blocks: [{ kind: 'tool-call', callId: 'c3', name: 'staff_chat', argsRaw: JSON.stringify({ staff: 'tech-lead', message: '重构结算模块' }) }],
    },
    // 会议中：两个人在开会，会议没结束
    {
      kind: 'assistant', time: T + 30,
      blocks: [{ kind: 'tool-call', callId: 'c4', name: 'staff_meeting', argsRaw: JSON.stringify({ staff: ['pm', 'data-analyst'], topic: '季度选题' }) }],
    },
  ]
}

const EXPECTED = { working: 1, meeting: 2, blocked: 1, done: 1, idle: 1 }

test('presence: 顶栏 / 办公室 / 左栏 / 右栏读同一份 CompanyRuntime，四处计数完全一致', () => {
  const runtime = runtimeOf(mixedSession())
  const presence = S.companyPresence(ROSTER, runtime)
  assert.equal(presence.eventDriven, true)
  assert.deepEqual(
    { working: presence.counts.working, meeting: presence.counts.meeting, blocked: presence.counts.blocked, done: presence.counts.done, idle: presence.counts.idle },
    EXPECTED,
  )
  assert.deepEqual(presence.blocked, ['developer'])
  assert.deepEqual(presence.meeting.slice().sort(), ['data-analyst', 'pm'])

  // 故意把降级用的旧数字全部喂成 0：四处只要还在读旧口径就会露馅。
  const zeroStats = { total: ROSTER.length, online: 0, running: 0, done: 0, wait: 0, idle: 0, since: T }

  const header = render(Header.CompanyHeader, {
    companyName: '赛博公司 · AI 员工总部', stats: zeroStats, now: new Date(T), onMarket: () => {}, onSettings: () => {}, runtime,
  })
  assert.equal(statOf(header, '工作中'), String(EXPECTED.working))
  assert.equal(statOf(header, '已交付'), String(EXPECTED.done))
  assert.equal(statOf(header, '卡住'), String(EXPECTED.blocked))
  assert.equal(statOf(header, '活跃/在册'), `${ROSTER.length - EXPECTED.idle}/${ROSTER.length}`)

  const office = render(Office.OfficeWorld, {
    staff: STAFF, statuses: {}, tasksMap: {}, tick: 0, activeStaffId: null, zoomIdx: 0,
    onZoom: () => {}, onSelect: () => {}, onTalk: () => {}, onOpenProfile: () => {}, runtime,
  })
  assert.equal(nowLine(office), `现在 ${EXPECTED.working} 人工作中 · ${EXPECTED.meeting} 人在会议 · ${EXPECTED.blocked} 人卡住 小刘`)
  assert.deepEqual(statusTally(office), EXPECTED)

  const list = render(List.EmployeeList, {
    staff: STAFF, statuses: {}, tasksMap: {}, activeStaffId: null, tick: 0, onSelect: () => {}, onMention: () => {}, runtime,
  })
  assert.deepEqual(statusTally(list), EXPECTED)

  const rail = render(Rail.RightRail, {
    staff: STAFF, stats: zeroStats, delegations: [], growth: [], skills: [], plugins: [],
    sessionRunning: false, now: T, open: true, onClose: () => {}, onDraft: () => {}, snapshot: null, runtime,
  })
  assert.equal(statOf(rail, '工作中'), String(EXPECTED.working))
  assert.equal(statOf(rail, '已交付'), String(EXPECTED.done))
  assert.equal(statOf(rail, '卡住'), String(EXPECTED.blocked))
  assert.equal(statOf(rail, '待命'), String(EXPECTED.idle))
})

test('presence: 「现在」那一行点得到人，卡住的人挂着真实原因', () => {
  const runtime = runtimeOf(mixedSession())
  const picked = []
  const office = render(Office.OfficeWorld, {
    staff: STAFF, statuses: {}, tasksMap: {}, tick: 0, activeStaffId: null, zoomIdx: 0,
    onZoom: () => {}, onSelect: (id) => picked.push(id), onTalk: () => {}, onOpenProfile: () => {}, runtime,
  })
  const buttons = []
  walk(office, (node) => {
    if (typeof node === 'object' && node && node.props && node.type === 'button' && typeof node.props.onClick === 'function') buttons.push(node)
  })
  const stuck = buttons.find((node) => visibleText(node) === '1 人卡住')
  assert.ok(stuck, '「现在」那一行必须有「N 人卡住」这一格')
  stuck.props.onClick()
  assert.deepEqual(picked, ['developer'], '点「卡住」要能定位到那个人')

  const name = buttons.find((node) => visibleText(node) === '小刘')
  assert.ok(name, '卡住的人要以名字挂出来，老板不用再去四处找是谁')
  assert.match(String(name.props.title), /需要你确认用哪个数据库/)
  name.props.onClick()
  assert.deepEqual(picked, ['developer', 'developer'])
})

test('presence: 总线一条事件都没有时不许假装有数据，四态回落到派活推导且四处仍然一致', () => {
  const empty = Events.emptyCompanyRuntime()
  const presence = S.companyPresence(ROSTER, empty, { developer: { status: 'wait' }, pm: { status: 'running', tool: 'staff_meeting' } })
  assert.equal(presence.eventDriven, false)
  assert.deepEqual(presence.blocked, ['developer'])
  assert.deepEqual(presence.meeting, ['pm'])
  assert.equal(presence.reasons.developer, '', '拿不到原因就是空串，绝不编一条出来')

  const office = render(Office.OfficeWorld, {
    staff: STAFF, statuses: { developer: 'wait', pm: 'running' }, tasksMap: { pm: [{ callId: 'm1:pm', tool: 'staff_meeting', desc: '季度选题', running: true }] },
    tick: 0, activeStaffId: null, zoomIdx: 0, onZoom: () => {}, onSelect: () => {}, onTalk: () => {}, onOpenProfile: () => {}, runtime: empty,
  })
  assert.equal(nowLine(office), '现在 0 人工作中 · 1 人在会议 · 1 人卡住 小刘 来自本会话派活记录')
})

// ---------------------------------------------------------------------------
// B4 tick 只驱动装饰
// ---------------------------------------------------------------------------

test('blocked: tick 走 12 帧，办公室与左栏的文案和坐标一个字节都不变', () => {
  const runtime = runtimeOf(mixedSession())
  const officeFrames = new Set()
  const seatFrames = new Set()
  const listFrames = new Set()
  for (let tick = 0; tick < 12; tick++) {
    const office = render(Office.OfficeWorld, {
      staff: STAFF, statuses: {}, tasksMap: {}, tick, activeStaffId: null, zoomIdx: 0,
      onZoom: () => {}, onSelect: () => {}, onTalk: () => {}, onOpenProfile: () => {}, runtime,
    })
    officeFrames.add(textOf(office))
    seatFrames.add(spritePositions(office))
    listFrames.add(textOf(render(List.EmployeeList, {
      staff: STAFF, statuses: {}, tasksMap: {}, activeStaffId: null, tick, onSelect: () => {}, onMention: () => {}, runtime,
    })))
  }
  assert.equal(officeFrames.size, 1, 'tick 变了办公室文案却在变 = 又在轮播编造的活动描述')
  assert.equal(seatFrames.size, 1, 'tick 变了坐标却在变 = 员工又开始随机走动')
  assert.equal(listFrames.size, 1, 'tick 变了左栏文案却在变')
})

test('blocked: 小人行内文案取当前工具 / 当前活动，绝不拿老板自己刚说的话冒充员工在干的事', () => {
  const boss = '把用户表从 mysql-a 迁到 mysql-b，今晚要上线'
  const nodes = [{
    kind: 'assistant', time: T + 1,
    blocks: [{ kind: 'tool-call', callId: 'c9', name: 'staff_chat', argsRaw: JSON.stringify({ staff: 'developer', message: boss }) }],
  }]
  const delegations = S.extractDelegations(nodes, [], ROLES, STAFF)
  assert.equal(delegations[0].desc, boss, 'desc 确实就是老板刚说的那句话（问题的根）')

  // 没有事件、只有一条 staff_chat 派活：行内只准显示诚实的状态词。
  const office = render(Office.OfficeWorld, {
    staff: STAFF, statuses: { developer: 'running' }, tasksMap: { developer: delegations },
    tick: 0, activeStaffId: null, zoomIdx: 0, onZoom: () => {}, onSelect: () => {}, onTalk: () => {}, onOpenProfile: () => {},
    runtime: Events.emptyCompanyRuntime(),
  })
  const text = textOf(office)
  assert.ok(!text.includes('把用户表从 mysql-a'), '老板自己的话不许当成员工正在做的事显示')
  assert.match(text, /老板交办：/, '悬浮卡里得标清楚这条派活是老板自己交办的，不是员工的活动')
  assert.match(text, /正在工作/, '拿不到细节就诚实显示「正在工作」')
  assert.equal(spriteLine(office, '小刘'), '正在工作', '行内那一行只准是状态词，不许出现任何「具体在做什么」的假象')
  // 「面板读不到」和「员工没在干活」是两件事，悬浮卡必须说清是哪一件。
  assert.match(text, /面板暂未收到/, '拿不到回传要说是面板没收到，不许写成员工没有进展')

  // 原话一个字都没丢：它在右栏「当前任务」里，那一栏本来就标着这是老板派出去的活。
  const rail = render(Rail.RightRail, {
    staff: STAFF, stats: { total: STAFF.length, running: 1, done: 0, wait: 0, idle: STAFF.length - 1 },
    delegations, growth: [], skills: [], plugins: [], sessionRunning: true, now: T + 2,
    open: true, onClose: () => {}, onDraft: () => {}, snapshot: null, runtime: Events.emptyCompanyRuntime(),
  })
  assert.ok(textOf(rail).includes('把用户表从 mysql-a'), '原话不许被删掉，它该留在右栏当前任务里')

  // 有真实工具事件时，行内显示的是工具名。
  const runtime = Events.reduceCompanyRuntime([
    { id: 't1', type: 'tool.started', at: T + 5, employeeId: 'developer', callId: 'k1', tool: 'grep' },
  ], { employeeIds: ROSTER })
  const withTool = textOf(render(Office.OfficeWorld, {
    staff: STAFF, statuses: {}, tasksMap: {}, tick: 0, activeStaffId: null, zoomIdx: 0,
    onZoom: () => {}, onSelect: () => {}, onTalk: () => {}, onOpenProfile: () => {}, runtime,
  }))
  assert.match(withTool, /检索代码中/)
})
