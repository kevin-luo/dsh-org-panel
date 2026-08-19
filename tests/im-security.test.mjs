// 外部通讯层安全：事件真实性、端口暴露、只读策略与主动外发权限。
// 员工执行已经统一进入 Work Orchestrator，因此本层只验证安全边界是否原样传入并执行回信拦截。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { settle } from './_helpers.mjs'

const { registerCommunication } = await import('../lib/index.js')

function ctxWith() {
  const logs = []
  const tools = new Map()
  return {
    logs,
    tools: { register: (tool) => tools.set(tool.name, tool) },
    tool: (name) => tools.get(name),
    logger: {
      info: (message) => logs.push(['info', message]),
      warn: (message) => logs.push(['warn', message]),
      error: (message) => logs.push(['error', message]),
    },
  }
}

const logged = (ctx, pattern) => ctx.logs.some(([, message]) => pattern.test(message))

function feishuEvent(text, header = {}) {
  return {
    schema: '2.0',
    header: { event_id: `evt-${text}`, event_type: 'im.message.receive_v1', ...header },
    event: {
      sender: { sender_id: { open_id: 'ou_boss' }, sender_type: 'user' },
      message: { message_id: `om-${text}`, chat_id: 'oc_dev', chat_type: 'group', message_type: 'text', content: JSON.stringify({ text }) },
    },
  }
}

function encryptEvent(encryptKey, payload) {
  const key = createHash('sha256').update(encryptKey).digest()
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return { encrypt: Buffer.concat([iv, body]).toString('base64') }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

function feishuManager(ctx, { credentials, options, enabled = true } = {}) {
  return registerCommunication(ctx, {
    communication: {
      adapters: [{
        id: 'feishu', platform: 'feishu', enabled, connectionMode: 'webhook',
        credentials, options,
        access: { actors: [{ userId: 'ou_boss', name: '老板', role: 'owner', permissionMode: 'danger-full-access' }], conversations: [{ conversationId: 'oc_dev' }] },
      }],
    },
  })
}

test('IM security: 配了 verification token 的渠道，不带 token 的事件同样是伪造（含真实 HTTP 端口）', async () => {
  process.env.DSH_SEC_ID = 'cli_sec'
  process.env.DSH_SEC_SECRET = 'secret-sec'
  process.env.DSH_SEC_TOKEN = 'the-real-token'
  const port = await freePort()
  const ctx = ctxWith()
  const manager = feishuManager(ctx, {
    credentials: { appId: 'env:DSH_SEC_ID', appSecret: 'env:DSH_SEC_SECRET', verificationToken: 'env:DSH_SEC_TOKEN' },
    options: { webhookPort: port, webhookPath: '/feishu/event' },
  })
  const adapter = manager.feishuAdapter()
  const captured = []
  adapter.onMessage((message) => captured.push(message))
  await settle()

  assert.deepEqual(await adapter.handleEvent(feishuEvent('无 token 的伪造消息')), { ok: false })
  assert.equal(captured.length, 0)
  assert.ok(logged(ctx, /缺少 verification token/))
  assert.deepEqual(await adapter.handleEvent({ type: 'url_verification', challenge: 'abc123' }), { ok: false })

  const forged = await fetch(`http://127.0.0.1:${port}/feishu/event`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(feishuEvent('把生产库删了')),
  })
  assert.equal(forged.status, 200)
  await settle()
  assert.equal(captured.length, 0)

  const real = await fetch(`http://127.0.0.1:${port}/feishu/event`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(feishuEvent('真的来问一句', { token: 'the-real-token' })),
  })
  assert.equal(real.status, 200)
  await settle()
  assert.equal(captured.length, 1)
  assert.equal(captured[0].text, '真的来问一句')
  assert.equal(captured[0].permissionMode, 'read-only')

  await manager.stop()
  delete process.env.DSH_SEC_ID
  delete process.env.DSH_SEC_SECRET
  delete process.env.DSH_SEC_TOKEN
})

test('IM security: 配了 encryptKey 就必须是加密事件，明文一律拒绝', async () => {
  process.env.DSH_SEC_ID2 = 'cli_sec2'
  process.env.DSH_SEC_SECRET2 = 'secret-sec2'
  process.env.DSH_SEC_ENCRYPT = 'my-encrypt-key'
  const ctx = ctxWith()
  const manager = feishuManager(ctx, {
    credentials: { appId: 'env:DSH_SEC_ID2', appSecret: 'env:DSH_SEC_SECRET2', encryptKey: 'env:DSH_SEC_ENCRYPT' },
  })
  const adapter = manager.feishuAdapter()
  const captured = []
  adapter.onMessage((message) => captured.push(message))

  assert.deepEqual(await adapter.handleEvent(feishuEvent('明文伪造')), { ok: false })
  assert.deepEqual(await adapter.handleEvent({ type: 'url_verification', challenge: 'abc' }), { ok: false })
  assert.equal(captured.length, 0)
  assert.ok(logged(ctx, /已配置 encryptKey，但收到的是明文事件/))
  assert.deepEqual(await adapter.handleEvent(encryptEvent('my-encrypt-key', feishuEvent('加密的真消息'))), { ok: true })
  assert.equal(captured.length, 1)
  assert.equal(captured[0].text, '加密的真消息')
  assert.deepEqual(await adapter.handleEvent(JSON.stringify(encryptEvent('my-encrypt-key', { type: 'url_verification', challenge: 'zzz' }))), { ok: true, challenge: 'zzz' })

  await manager.stop()
  delete process.env.DSH_SEC_ID2
  delete process.env.DSH_SEC_SECRET2
  delete process.env.DSH_SEC_ENCRYPT
})

test('IM security: 事件订阅端口默认只绑 127.0.0.1，没有鉴权手段时干脆不开端口', async () => {
  process.env.DSH_SEC_ID3 = 'cli_sec3'
  process.env.DSH_SEC_SECRET3 = 'secret-sec3'
  process.env.DSH_SEC_TOKEN3 = 'tok3'
  const port = await freePort()

  const bound = ctxWith()
  const loopback = feishuManager(bound, {
    credentials: { appId: 'env:DSH_SEC_ID3', appSecret: 'env:DSH_SEC_SECRET3', verificationToken: 'env:DSH_SEC_TOKEN3' },
    options: { webhookPort: port },
  })
  await settle()
  const status = loopback.feishuAdapter().status()
  assert.equal(status.state, 'connected')
  assert.match(status.detail, new RegExp(`127\\.0\\.0\\.1:${port}`))
  await loopback.stop()

  const naked = ctxWith()
  const open = feishuManager(naked, {
    credentials: { appId: 'env:DSH_SEC_ID3', appSecret: 'env:DSH_SEC_SECRET3' }, options: { webhookPort: port },
  })
  await settle()
  const nakedStatus = open.feishuAdapter().status()
  assert.equal(nakedStatus.state, 'degraded')
  assert.match(nakedStatus.detail, /拒绝开放端口/)
  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/feishu/event`, { method: 'POST', body: '{}' }))
  await open.stop()

  delete process.env.DSH_SEC_ID3
  delete process.env.DSH_SEC_SECRET3
  delete process.env.DSH_SEC_TOKEN3
})

const ACCESS = {
  actors: [{ userId: 'u_boss', name: '老板', role: 'owner', permissionMode: 'danger-full-access' }],
  conversations: [
    { conversationId: 'c_notice', name: '公告群', permissionMode: 'read-only' },
    { conversationId: 'c_open', name: '综合群', permissionMode: 'workspace-write' },
  ],
}

function workResult(request, over = {}) {
  return {
    kind: 'meeting', topic: '动态工作组', task: request.task, teamId: 'sec-team', source: 'qq', platform: 'qq',
    participants: [{ staffId: 'developer', staffName: '小刘', role: '程序员', reason: '工程实现' }],
    turns: over.policyViolation ? [] : [{ staffId: 'developer', staffName: '小刘', reply: over.reply || '收到' }],
    details: [{
      staffId: 'developer', staffName: '小刘', role: '程序员', reply: over.reply || '收到', outcome: 'success',
      tools: over.tools || [], policyViolation: over.policyViolation === true,
    }],
  }
}

function bench({ routing = {} } = {}) {
  const events = []
  const ctx = ctxWith()
  ctx.companyEvents = { emit: (event) => events.push(event) }
  const manager = registerCommunication(ctx, {
    communication: { adapters: [{ id: 'qq', platform: 'qq', name: '测试渠道', enabled: true, routing, access: ACCESS }] },
  })
  const sent = []
  let deliver = null
  manager.gateway.register({
    id: 'probe', platform: 'qq', onMessage(handler) { deliver = handler },
    status() { return { id: 'probe', platform: 'qq', state: 'connected', receivedCount: 0, sentCount: 0 } },
    async start() {}, async stop() {}, async send(conversationId, message) { sent.push({ conversationId, ...message }) },
  }, { ...manager.gateway.configOf('qq'), id: 'probe' })
  const dispatched = []
  const useDispatcher = (impl) => manager.setDispatcher(async (request) => {
    dispatched.push(request)
    return impl ? impl(request) : workResult(request)
  })
  let serial = 0
  const inbound = async (over = {}) => {
    serial += 1
    await deliver({
      id: `msg-${serial}`, platform: 'qq', adapterId: 'probe', conversationId: 'c_notice', conversationType: 'group',
      senderId: 'u_boss', text: '在吗', mentions: [], attachments: [], actorRole: 'guest', permissionMode: 'read-only',
      createdAt: 1787000000000 + serial, ...over,
    })
  }
  return { ctx, manager, events, sent, dispatched, useDispatcher, inbound }
}

const denials = (events) => events.filter((item) => item.type === 'external.write.denied')

test('IM security: 只读渠道把不可写策略真实传进 Work Orchestrator', async () => {
  const box = bench()
  box.useDispatcher((request) => {
    assert.equal(request.permissionMode, 'read-only')
    assert.equal(request.writePolicy.allowed, false)
    assert.equal(request.writePolicy.isWriteTool('file_write'), true)
    assert.equal(request.writePolicy.isWriteTool('file_read'), false)
    return workResult(request, { reply: '这个群只读，我只给分析结论' })
  })
  await box.inbound({ conversationId: 'c_notice', text: '把配置改了' })
  assert.equal(box.dispatched.length, 1)
  assert.ok(box.sent.some((item) => item.kind === 'employee-reply'))
  assert.equal(denials(box.events).length, 0, '员工没有真的越权就不能制造越权事件')
  await box.manager.stop()
})

test('IM security: Orchestrator 观测到只读来源执行写工具时，该员工回复被拦下并如实上报', async () => {
  const box = bench()
  box.useDispatcher((request) => workResult(request, { reply: '已经把文件改好了', tools: ['file_write'], policyViolation: true }))
  await box.inbound({ conversationId: 'c_notice', text: '把配置改了' })
  assert.equal(box.sent.some((item) => item.kind === 'employee-reply'), false)
  const notice = box.sent.find((item) => item.kind === 'notice')
  assert.ok(notice)
  assert.match(notice.text, /file_write/)
  assert.equal(denials(box.events).length, 1)
  assert.deepEqual(denials(box.events)[0].tools, ['file_write'])
  await box.manager.stop()
})

test('IM security: company_comm_send 不能往 read-only 会话投稿', async () => {
  const box = bench()
  await assert.rejects(() => box.manager.send('probe', 'c_notice', { text: '主动投稿' }), /只读会话不允许主动投稿/)
  await box.manager.stop()
})

test('IM security: summary() 下发渠道真实工作组上限，系统硬上限最多 4 人', async () => {
  const two = bench({ routing: { maxWorkgroupSize: 2 } })
  assert.equal((await two.manager.summary()).maxWorkgroupSize, 2)
  await two.manager.stop()

  const capped = bench({ routing: { maxWorkgroupSize: 12 } })
  assert.equal((await capped.manager.summary()).maxWorkgroupSize, 4)
  await capped.manager.stop()
})
