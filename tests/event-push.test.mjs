// host → client 事件推送（G5）。
//
// 这一组守的是「我在飞书 @老王，回复我的就是网页里那个老王」这句话的**唯一可见证明**。
//
// 背景：companyEventBus 在 host bundle 与 browser bundle 里是两个独立单例（tsdown 两个 entry），
// host 侧 publish 的 message.received / plugin.install.started / vision.started 永远飘不到浏览器。
// 前台的 🔔、机房的装插件、多媒体工作台的识图这三套视觉语言，在接上事件泵之前于真实链路里全是死代码。
//
// 五条底线，每一条一个用例：
//   E1 游标增量 —— 第二次只拿新事件，不许每次全量。
//   E2 双通道去重 —— session 与 host 同时描述同一件事时只算一次（复用既有 dedupe 语义）。
//   E3 RPC 不可用 —— 一次都不重试、一条都不伪造，办公室行为与接泵之前逐字一致。
//   E4 上限与保留窗口 —— feed 不许无限增长；断档要如实标 dropped，不许假装事件流连续。
//   E5 页面隐藏 —— 一个请求都不发；切回来只补一次，不是一串。
import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { connectionService, fakeHttpServer, realCordisCtx, scratch, settleFiber } from './_helpers.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '..', 'src')
const nodeRequire = createRequire(join(HERE, '..', 'package.json'))

// --- src 直读加载器（口径同 tests/org-panel-client.test.mjs） -----------------
const moduleCache = new Map()
moduleCache.set(join(SRC, 'client-v9', 'generated-assets.ts'), { RUNTIME_ASSETS: {} })

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

const Bus = loadTs(join(SRC, 'runtime', 'event-bus.ts'))
const Bridge = loadTs(join(SRC, 'client-v9', 'company-bridge.ts'))
const { CompanyEventBus, HOST_CHANNEL, SESSION_CHANNEL } = Bus

// host 侧走 npm pack 真正发出去的产物，和其余 host 用例同口径。
const { apply, inject, readEndpoints } = await import('../lib/index.js')

const T0 = Date.UTC(2026, 7, 18, 9, 0, 0)
const at = (minutes) => T0 + minutes * 60_000

/** 一条真实形状的飞书来信事件 —— 铃铛亮不亮就看它。 */
const feishu = (id, minutes, preview = '老王在吗') => ({
  id, type: 'message.received', at: at(minutes),
  platform: 'feishu', conversationId: 'oc_1', preview, senderName: '老板', targetEmployeeId: 'laowang',
})

// ---------------------------------------------------------------------------
// 假件：unary RPC / 假时钟 / 可见性开关
// ---------------------------------------------------------------------------

function fakeRpc(script) {
  const calls = []
  const queue = [...script]
  return {
    calls,
    async call(channel, endpoint, payload) {
      calls.push({ channel, endpoint, payload })
      const next = queue.length ? queue.shift() : queue.at(-1)
      const reply = typeof next === 'function' ? next(payload, calls.length) : next
      if (reply === undefined) return { ok: true, value: { available: true, cursor: Number(payload?.cursor) || 0, events: [], dropped: false, more: false } }
      if (reply instanceof Error) throw reply
      return reply
    },
  }
}

const okPage = (cursor, events, more = false) => ({ ok: true, value: { available: true, cursor, events, oldest: 1, dropped: false, more } })

function fakeClock() {
  let seq = 0
  const timers = []
  return {
    timers,
    setTimer: (fn, ms) => { const handle = ++seq; timers.push({ handle, fn, ms }); return handle },
    clearTimer: (handle) => { const index = timers.findIndex((row) => row.handle === handle); if (index >= 0) timers.splice(index, 1) },
    get queued() { return timers.length },
    get nextDelay() { return timers.length ? timers[timers.length - 1].ms : null },
    async fire() {
      const timer = timers.shift()
      if (!timer) return false
      timer.fn()
      await flush()
      return true
    },
  }
}

/** 冲干净所有 microtask（假 rpc 全是已决 Promise，一个宏任务边界就够）。 */
const flush = () => new Promise((done) => setTimeout(done, 0))

/** 可见性开关 + 手动触发 visibilitychange。 */
function fakeVisibility(initial = true) {
  let value = initial
  const listeners = new Set()
  return {
    visible: () => value,
    onVisibility: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    async set(next) { value = next; for (const listener of listeners) listener(); await flush() },
    get listeners() { return listeners.size },
  }
}

// ---------------------------------------------------------------------------
// E1 游标增量：第二次只拿新事件
// ---------------------------------------------------------------------------

test('E1a host 的 events/since 真的挂在 /org-panel 上，且带游标只回增量', async () => {
  const dir = await scratch('event-push-channel')
  const http = fakeHttpServer()
  const { root } = realCordisCtx({ httpServer: http.service })
  connectionService(root)
  const fiber = root.plugin({
    name: 'dsh-org-panel', inject,
    apply(ctx, cfg) { return apply(ctx, cfg) },
  }, {
    memoryFile: join(dir, 'evolution.json'),
    companyFile: join(dir, 'company.json'),
    approvalsFile: join(dir, 'plugin-approvals.json'),
    healthCheckOnStart: false,
  })
  await settleFiber(fiber)

  const route = http.routes[0]
  assert.ok(route, '/org-panel 频道没有注册，事件推送无从谈起')
  const call = (payload) => route.handler('events/since', payload, new AbortController().signal)

  // 端点必须真的存在 —— 不存在时 createDispatcher 会回 bad-request，客户端据此永久停表。
  const probe = await call({})
  assert.equal(probe.ok, true, `events/since 必须是频道上的真实端点，实际：${JSON.stringify(probe.error)}`)
  assert.equal(probe.value.available, true)
  assert.ok(Array.isArray(probe.value.events))
  const base = probe.value.cursor

  // 用 host 侧真实生产者的口径投事件：插件运行时与通讯层都走 publish(event, 'host')。
  const { companyEventBus } = await import('../lib/index.js')
  companyEventBus.publish(feishu('f1', 1), 'host')
  companyEventBus.publish({ id: 'p1', type: 'plugin.install.started', at: at(2), employeeId: 'laowang', pluginName: 'sd-webui' }, 'host')

  const first = await call({ cursor: base })
  assert.deepEqual(first.value.events.map((row) => row.id), ['f1', 'p1'])
  assert.equal(first.value.dropped, false)
  assert.equal(first.value.cursor, base + 2)

  // 关键断言：带上游标之后**一条旧的都不许再回**。
  const idle = await call({ cursor: first.value.cursor })
  assert.deepEqual(idle.value.events, [], '没有新事件时必须回空数组，不许每次全量')
  assert.equal(idle.value.cursor, first.value.cursor, '空页不许把游标推乱')

  companyEventBus.publish({ id: 'v1', type: 'vision.started', at: at(3), employeeId: 'laowang', callId: 'c1', images: 1 }, 'host')
  const second = await call({ cursor: first.value.cursor })
  assert.deepEqual(second.value.events.map((row) => row.id), ['v1'], '第二次只拿新事件')

  // 只读：同一个游标再拉一次，别的标签页拿到的东西一模一样（拉取不吃掉事件）。
  const replay = await call({ cursor: first.value.cursor })
  assert.deepEqual(replay.value.events.map((row) => row.id), ['v1'])

  await fiber.dispose?.()
})

test('E1b 事件泵带着游标走，拉回来的增量落到 host 通道', async () => {
  const bus = new CompanyEventBus()
  const clock = fakeClock()
  const rpc = fakeRpc([
    okPage(2, [feishu('f1', 1), feishu('f2', 2, '在的')]),
    okPage(3, [{ id: 'p1', type: 'plugin.install.started', at: at(3), employeeId: 'laowang', pluginName: 'sd-webui' }]),
    okPage(3, []),
  ])
  const pump = Bridge.createHostEventPump({
    rpc,
    publish: (events) => bus.publishAll(events, HOST_CHANNEL),
    visible: () => true,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onVisibility: () => () => {},
  })
  await flush()

  assert.equal(rpc.calls[0].endpoint, 'events/since')
  assert.equal(rpc.calls[0].channel, '/org-panel')
  assert.equal(rpc.calls[0].payload.cursor, 0, '第一次必须从 0 开始，让老板补上他不在时的那几声铃铛')
  assert.equal(pump.cursor(), 2)
  assert.equal(bus.snapshot().reception.unread, 2, '两条飞书来信必须把前台铃铛点亮')

  await clock.fire()
  assert.equal(rpc.calls[1].payload.cursor, 2, '第二次必须带上上一页的游标')
  assert.equal(bus.snapshot().employees.laowang.station, 'server-room', '装插件事件要把老王送进机房')

  await clock.fire()
  assert.equal(rpc.calls[2].payload.cursor, 3)
  assert.equal(bus.events().length, 3)
  pump.stop()
})

// ---------------------------------------------------------------------------
// E2 双通道去重
// ---------------------------------------------------------------------------

test('E2 session 与 host 两个通道同时存在时同一条事件只算一次', async () => {
  const bus = new CompanyEventBus()
  bus.setEmployeeIds(['laowang'])
  const shared = { id: 'tool-1', type: 'tool.started', at: at(1), employeeId: 'laowang', callId: 'c1', tool: 'vision_analyze' }

  // 会话节点流先推导出这条（client 侧每次重算都全量替换）。
  bus.setChannel(SESSION_CHANNEL, [shared])
  assert.equal(bus.snapshot().eventCount, 1)

  // 事件泵随后又从 host 拉回同一条（同 id）。
  bus.publishAll([{ ...shared }], HOST_CHANNEL)
  assert.equal(bus.events().length, 1, '同一条事件在两个通道里只能算一次')
  assert.equal(bus.snapshot().eventCount, 1)
  assert.equal(bus.snapshot().employees.laowang.tool.callId, 'c1')

  // 只有 host 独有的那条才是真增量：飞书来信不会出现在会话节点流里。
  bus.publishAll([feishu('f9', 2)], HOST_CHANNEL)
  assert.equal(bus.snapshot().reception.unread, 1)
  assert.equal(bus.snapshot().eventCount, 2)

  // 会话通道再全量替换一次也不许把 host 那条挤掉。
  bus.setChannel(SESSION_CHANNEL, [{ ...shared }])
  assert.equal(bus.snapshot().reception.unread, 1, 'session 通道的幂等替换不能碰 host 通道')
  assert.equal(bus.events().length, 2)

  // 泵反复拉到同一页（重发 / 断线重连）也不许把计数翻倍。
  bus.publishAll([{ ...shared }, feishu('f9', 2)], HOST_CHANNEL)
  assert.equal(bus.events().length, 2)
})

// ---------------------------------------------------------------------------
// E3 RPC 不可用：不重试、不伪造
// ---------------------------------------------------------------------------

test('E3a 没有 rpc 时事件泵一个请求都不发、一个定时器都不建', async () => {
  const bus = new CompanyEventBus()
  bus.setEmployeeIds(['laowang'])
  const before = bus.snapshot()
  const clock = fakeClock()
  const pump = Bridge.createHostEventPump({
    rpc: null,
    publish: (events) => bus.publishAll(events, HOST_CHANNEL),
    visible: () => true,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onVisibility: () => () => {},
  })
  await flush()
  assert.equal(pump.stopped(), Bridge.PUMP_NO_RPC)
  assert.equal(clock.queued, 0, '没有通道就不许排队，否则就是一台永远敲不开门的泵')
  assert.equal(pump.pending(), null)
  assert.equal(bus.snapshot(), before, '快照必须是同一个引用：办公室行为与接泵之前逐字一致')
  pump.stop()
})

test('E3b 通道不通（unavailable）时只探一次就停表，绝不轮询伪造', async () => {
  const bus = new CompanyEventBus()
  bus.setEmployeeIds(['laowang'])
  const before = bus.snapshot()
  const clock = fakeClock()
  // ClientConnectionRpc.call() 在 HTTP 非 2xx / fixture 模式下是**直接 throw**，不是回 { ok:false }。
  const rpc = fakeRpc([new Error('connection refused')])
  const pump = Bridge.createHostEventPump({
    rpc,
    publish: (events) => bus.publishAll(events, HOST_CHANNEL),
    visible: () => true,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onVisibility: () => () => {},
  })
  await flush()
  assert.equal(rpc.calls.length, 1)
  assert.equal(pump.stopped(), Bridge.PUMP_UNAVAILABLE)
  assert.equal(clock.queued, 0)
  assert.equal(bus.snapshot(), before, 'unavailable 不许被渲染成任何事件')

  // 停表之后再怎么催都不许再打 host。
  assert.equal(await pump.pull(), -1)
  assert.equal(rpc.calls.length, 1)
  pump.stop()
})

test('E3c host 不认识 events/since（bad-request）时立刻停表', async () => {
  const clock = fakeClock()
  const rpc = fakeRpc([{ ok: false, error: { code: 'bad-request', message: '未知的 /org-panel endpoint：events/since', details: { issues: [] } } }])
  const pump = Bridge.createHostEventPump({
    rpc, publish: () => assert.fail('不许落任何事件'), visible: () => true,
    setTimer: clock.setTimer, clearTimer: clock.clearTimer, onVisibility: () => () => {},
  })
  await flush()
  assert.equal(pump.stopped(), Bridge.PUMP_NO_ENDPOINT)
  assert.equal(clock.queued, 0)
  pump.stop()
})

test('E3d 通道活着但端点连续报错时退避、到上限后停表', async () => {
  const clock = fakeClock()
  const boom = { ok: false, error: { code: 'internal', message: 'evolution.json 读失败', details: {} } }
  const rpc = fakeRpc([boom, boom, boom, boom])
  const pump = Bridge.createHostEventPump({
    rpc, publish: () => assert.fail('不许落任何事件'), visible: () => true,
    setTimer: clock.setTimer, clearTimer: clock.clearTimer, onVisibility: () => () => {},
  })
  await flush()
  assert.equal(pump.stopped(), '', '第一次失败不该停表')
  assert.equal(clock.nextDelay, 9000, '失败也要退避，不许原地高频重试')
  await clock.fire()
  assert.equal(pump.stopped(), '')
  assert.equal(clock.nextDelay, 16200)
  await clock.fire()
  assert.equal(pump.stopped(), Bridge.PUMP_TOO_MANY_ERRORS)
  assert.equal(rpc.calls.length, Bridge.HOST_EVENT_MAX_ERRORS, '第三次失败就停表，不许把 host 敲穿')
  assert.equal(clock.queued, 0)
  pump.stop()
})

// ---------------------------------------------------------------------------
// E4 上限与保留窗口
// ---------------------------------------------------------------------------

test('E4a feed 条数上限生效，断档如实标 dropped', () => {
  const bus = new CompanyEventBus({ feedLimit: 3, retentionMs: 0 })
  for (let index = 1; index <= 5; index++) bus.publish(feishu(`f${index}`, index), HOST_CHANNEL)

  const all = bus.since(0)
  assert.deepEqual(all.events.map((row) => row.id), ['f3', 'f4', 'f5'], '超上限的最旧事件必须被丢掉，不许无限增长')
  assert.equal(all.cursor, 5)
  assert.equal(all.oldest, 3)
  assert.equal(all.dropped, false, '首次拉取（cursor=0）不是断档，是起点')

  // 客户端落后太多：中间那段真的没了，必须如实说。
  const stale = bus.since(1)
  assert.equal(stale.dropped, true)
  assert.deepEqual(stale.events.map((row) => row.id), ['f3', 'f4', 'f5'])

  // 刚好接上就不是断档。
  assert.equal(bus.since(2).dropped, false)
  assert.equal(bus.since(5).events.length, 0)
})

test('E4b 保留窗口生效：超窗事件不再补发，且窗口以事件时间为准（永不读系统时钟）', () => {
  const bus = new CompanyEventBus({ feedLimit: 100, retentionMs: 10 * 60_000 })
  bus.publish(feishu('old', 0), HOST_CHANNEL)
  bus.publish(feishu('mid', 5), HOST_CHANNEL)
  assert.equal(bus.since(0).events.length, 2, '窗口内一条都不能少')

  // 又来了一条 20 分钟后的事件 —— 窗口随之推进，'old' 出窗。
  bus.publish(feishu('new', 20), HOST_CHANNEL)
  const page = bus.since(0)
  assert.deepEqual(page.events.map((row) => row.id), ['new'], '超出保留窗口的事件不再补发')
  assert.equal(page.oldest, 3)
  assert.equal(bus.since(1).dropped, true)

  // 出窗只影响补发，不影响办公室当前状态（状态在 channel 里，不在 feed 里）。
  assert.equal(bus.events().length, 3)

  // reset 清空 feed，但游标绝不回退 —— 已经发出去的游标必须永远有效。
  const before = bus.feedCursor()
  bus.reset()
  assert.equal(bus.feedCursor(), before)
  assert.equal(bus.since(before).events.length, 0)
  assert.equal(bus.since(before).dropped, false)
})

test('E4c 单页上限生效，more 为真时泵会把积压一次取完', async () => {
  const bus = new CompanyEventBus({ feedLimit: 50, retentionMs: 0 })
  for (let index = 1; index <= 5; index++) bus.publish(feishu(`f${index}`, index), HOST_CHANNEL)
  const page = bus.since(0, 2)
  assert.deepEqual(page.events.map((row) => row.id), ['f1', 'f2'])
  assert.equal(page.more, true)
  assert.equal(bus.since(page.cursor, 2).more, true)
  assert.equal(bus.since(4, 2).more, false)

  // 泵侧：more=true 的下一次必须立刻续（delay 0），而不是等一个退避周期。
  const clock = fakeClock()
  const rpc = fakeRpc([okPage(2, [feishu('f1', 1), feishu('f2', 2)], true), okPage(3, [feishu('f3', 3)], false)])
  const pump = Bridge.createHostEventPump({
    rpc, publish: () => {}, visible: () => true,
    setTimer: clock.setTimer, clearTimer: clock.clearTimer, onVisibility: () => () => {},
  })
  await flush()
  assert.equal(clock.nextDelay, 0, '还有积压就立刻续一页')
  await clock.fire()
  assert.equal(clock.nextDelay, Bridge.HOST_EVENT_MIN_INTERVAL, '取完之后回到正常节奏')
  pump.stop()
})

// ---------------------------------------------------------------------------
// E5 页面隐藏就停表 + 退避
// ---------------------------------------------------------------------------

test('E5a 页面隐藏时一个请求都不发，切回来只补一次', async () => {
  const clock = fakeClock()
  const view = fakeVisibility(false)
  const rpc = fakeRpc([okPage(1, [feishu('f1', 1)]), okPage(1, [])])
  const pump = Bridge.createHostEventPump({
    rpc, publish: () => {}, visible: view.visible,
    setTimer: clock.setTimer, clearTimer: clock.clearTimer, onVisibility: view.onVisibility,
  })
  await flush()
  assert.equal(rpc.calls.length, 0, '一进场就是隐藏状态：一个请求都不许发')
  assert.equal(clock.queued, 0)

  await view.set(true)
  assert.equal(rpc.calls.length, 1, '切回来补一次 —— 是一次，不是一串')
  assert.equal(clock.queued, 1)

  await view.set(false)
  assert.equal(clock.queued, 0, '隐藏就把已经排上的那次撤掉')
  assert.equal(await pump.pull(), -1, '隐藏时连手动 pull 都不许打 host')
  assert.equal(rpc.calls.length, 1)

  pump.stop()
  assert.equal(view.listeners, 0, '卸载必须退订 visibilitychange，否则换 Session 会越挂越多')
})

test('E5b 一直没有新事件时退避到上限，绝不高频轮询', async () => {
  const clock = fakeClock()
  const rpc = fakeRpc([okPage(0, [])])
  const pump = Bridge.createHostEventPump({
    rpc, publish: () => {}, visible: () => true,
    setTimer: clock.setTimer, clearTimer: clock.clearTimer, onVisibility: () => () => {},
  })
  await flush()
  const delays = [clock.nextDelay]
  for (let index = 0; index < 6; index++) { await clock.fire(); delays.push(clock.nextDelay) }
  assert.deepEqual(delays, [9000, 16200, 29160, 52488, 60000, 60000, 60000])
  assert.ok(delays.every((ms) => ms >= Bridge.HOST_EVENT_MIN_INTERVAL), '任何一次间隔都不许低于最短间隔')

  // 真有事发生就立刻回到最短间隔 —— 退避只针对「什么都没发生」。
  rpc.calls.length = 0
  const lively = Bridge.createHostEventPump({
    rpc: fakeRpc([okPage(1, [feishu('f1', 1)]), okPage(1, [])]),
    publish: () => {}, visible: () => true,
    setTimer: clock.setTimer, clearTimer: clock.clearTimer, onVisibility: () => () => {},
  })
  await flush()
  assert.equal(clock.nextDelay, Bridge.HOST_EVENT_MIN_INTERVAL)
  pump.stop()
  lively.stop()
})

// ---------------------------------------------------------------------------
// 脏数据不许把办公室带歪
// ---------------------------------------------------------------------------

test('E6 host 回来的脏事件被丢掉，合法的照收', () => {
  const events = Bridge.readEventPage({
    events: [
      feishu('f1', 1),
      null,
      { id: '', type: 'message.received', at: at(2) },
      { id: 'x', type: '', at: at(2) },
      { id: 'y', type: 'task.started', at: 'not-a-number' },
      { id: 'z', type: 'task.started', at: at(3), employeeId: 'laowang', taskId: 't1', title: '写代码' },
    ],
  })
  assert.deepEqual(events.map((row) => row.id), ['f1', 'z'])
  assert.deepEqual(Bridge.readEventPage(null), [])
  assert.deepEqual(Bridge.readEventPage({ events: 'nope' }), [])
})

test('E7 events/since 是只读端点：拉事件不改 host 上的任何状态', async () => {
  const bus = new CompanyEventBus({ feedLimit: 10, retentionMs: 0 })
  bus.publish(feishu('f1', 1), HOST_CHANNEL)
  const endpoints = readEndpoints({ core: { roster: [], store: {}, company: {}, snapshot: async () => ({}) }, events: bus })
  assert.equal(typeof endpoints['events/since'], 'function', 'events/since 必须在只读端点表里')

  const before = bus.events().length
  const first = await endpoints['events/since']({})
  const again = await endpoints['events/since']({})
  assert.equal(bus.events().length, before, '拉取不许吃掉事件，多个标签页各拉各的')
  assert.deepEqual(first.events.map((row) => row.id), ['f1'])
  assert.deepEqual(again.events.map((row) => row.id), ['f1'])
  assert.equal(first.available, true)

  // limit 被夹住：非法值不许穿透成一次全量。
  const capped = await endpoints['events/since']({ cursor: 'abc', limit: -5 })
  assert.deepEqual(capped.events.map((row) => row.id), ['f1'])
})
