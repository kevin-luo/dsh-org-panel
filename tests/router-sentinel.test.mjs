// 路由哨兵不许泄漏进公司群（需求文档：页面只展示可公开的执行摘要，不展示路由内部信号）。
//
// 这一组守的是一个只有接上真实 LLM 才会暴露的洞：
// 旧判定是 /^\[NIUMA_(?:RELAY|DIRECT)_ACK\]$/ —— **严格全串匹配**。
// 真机（glm-5.2）在一个 step 里派了两次活，于是秘书那条消息吐的是
//   `[NIUMA_DIRECT_ACK] [NIUMA_DIRECT_ACK]`
// 同一个哨兵重复两遍、中间带空格，全串匹配当场落空，哨兵直接上了老板的屏幕。
//
// 所以这里喂的全是**脏输入**：重复、乱序、带空格 / 换行 / 全角空格、单双层括号、
// 以及「哨兵 + 员工真实回复」的混排。只喂一个规范哨兵的测试正是当初漏掉它的原因。
//
// 反向那条线同样重要：判定放宽之后，绝不能因为一条消息里出现过哨兵就把员工的真话一起吞掉。
// 口径同 ui-honesty / blocked-detection：transpile 真实 src/**，不手搓替身。
import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

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

const S = loadTs(join(V9, 'selectors.ts'))
const M = loadTs(join(V9, 'messages.ts'))

const STAFF = [
  { id: 'secretary', name: '秘书', roleId: 'secretary', department: '管理层' },
  { id: 'developer', name: '小刘', roleId: 'developer', department: '产品研发部' },
]

/** 真机实录：一个 step 里派了两次活，秘书把 ack 吐了两遍。 */
const REAL_LEAK = '[NIUMA_DIRECT_ACK] [NIUMA_DIRECT_ACK]'

// ---------------------------------------------------------------------------
// 只有哨兵 → 整条隐藏
// ---------------------------------------------------------------------------

test('哨兵：脏输入（重复 / 乱序 / 空格 / 换行 / 全角 / 单双括号）一律判成纯路由信号', () => {
  const dirty = [
    REAL_LEAK,
    '[NIUMA_DIRECT_ACK][NIUMA_DIRECT_ACK]',
    '[NIUMA_RELAY_ACK] [NIUMA_RELAY_ACK] [NIUMA_RELAY_ACK]',
    '[NIUMA_DIRECT_ACK] [NIUMA_RELAY_ACK] [NIUMA_DIRECT_ACK]',
    '[NIUMA_RELAY_ACK]\n[NIUMA_DIRECT_ACK]',
    '[NIUMA_DIRECT_ACK]\n\n[NIUMA_DIRECT_ACK]\n',
    '   [NIUMA_RELAY_ACK]   ',
    '\n\t[NIUMA_DIRECT_ACK]\t\n',
    '[NIUMA_DIRECT_ACK]　[NIUMA_DIRECT_ACK]',
    '[ NIUMA_DIRECT_ACK ]',
    '[[NIUMA_DIRECT_ACK]]',
    '[[NIUMA_RELAY_ACK]] [NIUMA_RELAY_ACK]',
    '[NIUMA_RELAY_ACK]',
  ]
  for (const value of dirty) {
    assert.equal(S.isRouterOnlyMessage(value), true, `应当判成纯路由信号：${JSON.stringify(value)}`)
    assert.equal(S.stripRouterSentinels(value), '', `剥完应当什么都不剩：${JSON.stringify(value)}`)
  }
})

test('哨兵：路由话术（已接通 / 已转交 / 老板已直连）照旧整条隐藏', () => {
  for (const value of [
    '已接通小刘的独立子代理，等他本人回复。',
    '消息已转交给小刘，等待本人回复。',
    '老板已直连 小刘，正在处理。',
  ]) {
    assert.equal(S.isRouterOnlyMessage(value), true, `路由话术应当隐藏：${value}`)
  }
})

// ---------------------------------------------------------------------------
// 哨兵 + 真实内容 → 必须显示，只剥哨兵
// ---------------------------------------------------------------------------

test('哨兵：只要还剩真实内容，整条必须显示，绝不因为出现哨兵就株连员工的真话', () => {
  const cases = [
    ['[NIUMA_RELAY_ACK] 老板，我已经看完 tsdown.config.ts 了。', '老板，我已经看完 tsdown.config.ts 了。'],
    ['小刘和大壮的通道都异常中断了。[NIUMA_DIRECT_ACK]', '小刘和大壮的通道都异常中断了。'],
    ['[NIUMA_DIRECT_ACK] [NIUMA_DIRECT_ACK]\n我已经把两个任务都派下去了。', '我已经把两个任务都派下去了。'],
    ['第一行结论。\n[NIUMA_RELAY_ACK]\n第二行依据。', '第一行结论。\n第二行依据。'],
    ['[[NIUMA_RELAY_ACK]]\n\n一句话：client 要单独打成 cjs。', '一句话：client 要单独打成 cjs。'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(S.isRouterOnlyMessage(input), false, `还有真实内容就不许隐藏：${JSON.stringify(input)}`)
    assert.equal(S.stripRouterSentinels(input), expected, `剥离结果不对：${JSON.stringify(input)}`)
  }
})

test('哨兵：没有哨兵的正常消息一个字都不许改', () => {
  const plain = '一句话：client 由浏览器侧 ModuleLoader 动态加载，必须打成 cjs。\n  缩进这一行要原样保留。'
  assert.equal(S.isRouterOnlyMessage(plain), false)
  assert.equal(S.stripRouterSentinels(plain), plain)
  // [[NIUMA_STAFF]] 是员工路由标记，不是 ack 哨兵，不归这条规则管。
  const marker = '[[NIUMA_STAFF id="developer" child="c1" state="replied"]]\n小刘回复：好的。'
  assert.equal(S.stripRouterSentinels(marker), marker)
})

// ---------------------------------------------------------------------------
// 端到端：真机那两条秘书消息不许再进公司群
// ---------------------------------------------------------------------------

test('公司群：真机泄漏的那两条秘书消息一条都不许上屏', () => {
  // 与 ~/.dsh/sessions 里那份实录同构：tool-call 在上一个 step，这一条 assistant 只有纯文本。
  const nodes = [
    { kind: 'user', seq: 21, time: 1787051918485, content: [{ text: '@小刘 一句话说明 tsdown.config.ts 里 client 为什么要单独打成 cjs' }] },
    { kind: 'assistant', seq: 78, time: 1787051939385, blocks: [{ kind: 'text', text: REAL_LEAK }] },
    { kind: 'assistant', seq: 131, time: 1787051972334, blocks: [{ kind: 'text', text: REAL_LEAK }] },
  ]
  const messages = M.buildCompanyMessages(nodes, STAFF)
  assert.equal(messages.filter((item) => item.sender.type === 'secretary').length, 0, '两条秘书消息都必须被隐藏')
  assert.equal(messages.length, 1, '只剩老板那一条')
  for (const item of messages) assert.ok(!/NIUMA_/.test(item.content), `消息里不许残留哨兵：${item.content}`)
})

test('公司群：秘书「哨兵 + 真实交代」混排时消息保留，只把哨兵剥掉', () => {
  const nodes = [
    { kind: 'assistant', seq: 1, time: 1, blocks: [{ kind: 'text', text: '[NIUMA_DIRECT_ACK] [NIUMA_DIRECT_ACK]\n小刘和大壮我都通知到了。' }] },
  ]
  const messages = M.buildCompanyMessages(nodes, STAFF)
  assert.equal(messages.length, 1, '还有真实交代就必须显示')
  assert.equal(messages[0].content, '小刘和大壮我都通知到了。')
})

test('公司群：员工结算回复里混进哨兵时，员工的真话必须留下', () => {
  const nodes = [
    {
      kind: 'assistant', seq: 1, time: 1,
      blocks: [{ kind: 'tool-call', callId: 'c1', name: 'staff_chat', argsRaw: JSON.stringify({ staff: 'developer', message: '说明一下 cjs' }) }],
    },
    {
      kind: 'tool-result', seq: 2, time: 2, callId: 'c1', call: { name: 'staff_chat' },
      content: [{ text: '[[NIUMA_STAFF id="developer" child="child-1" state="accepted"]]\n已建立老板与小刘的直连通道，等待本人回复。' }],
    },
    {
      // 真机形态：员工回话是一条 user/message，source.kind = 'subagent-settled'。
      kind: 'user', seq: 3, time: 3,
      source: { kind: 'subagent-settled', form: 'notice', senderSessionId: 'child-1' },
      content: [{ text: 'Background subagent child-1 finished and will do no further work.\nIts closing message: [NIUMA_RELAY_ACK] 老板，client 走的是浏览器 ModuleLoader，所以必须打 cjs。' }],
    },
  ]
  const messages = M.buildCompanyMessages(nodes, STAFF)
  const employee = messages.filter((item) => item.sender.type === 'employee')
  assert.equal(employee.length, 1, '员工本人的回复必须上屏')
  assert.equal(employee[0].content, '老板，client 走的是浏览器 ModuleLoader，所以必须打 cjs。')
  assert.ok(!/NIUMA_/.test(employee[0].content))
})

test('公司群：员工结算回复只有哨兵时不产生空消息', () => {
  const nodes = [
    {
      kind: 'assistant', seq: 1, time: 1,
      blocks: [{ kind: 'tool-call', callId: 'c1', name: 'staff_chat', argsRaw: JSON.stringify({ staff: 'developer', message: '说明一下 cjs' }) }],
    },
    {
      kind: 'tool-result', seq: 2, time: 2, callId: 'c1', call: { name: 'staff_chat' },
      content: [{ text: '[[NIUMA_STAFF id="developer" child="child-1" state="accepted"]]\n已建立直连通道。' }],
    },
    {
      kind: 'user', seq: 3, time: 3,
      source: { kind: 'subagent-settled', form: 'notice', senderSessionId: 'child-1' },
      content: [{ text: 'Background subagent child-1 finished and will do no further work.\nIts closing message: [NIUMA_RELAY_ACK] [NIUMA_RELAY_ACK]' }],
    },
  ]
  assert.equal(M.buildCompanyMessages(nodes, STAFF).filter((item) => item.sender.type === 'employee').length, 0)
})
