// 外部通讯层的伪造与越权（需求文档二十八 / 三十 / 三十一 / 五十七）。
//
// 这组用例守的是审计打出来的四个洞，每一个都按「真的能打进来吗」来写：
//   S4a 飞书事件不带 token 时校验不能被跳过（连真实 HTTP 端口一起打一遍）；
//   S4b 配了 encryptKey 就必须是加密事件，明文一律是伪造；
//   S4c 自建事件订阅端口默认只绑 127.0.0.1，且没有鉴权手段时根本不开端口；
//   S5a writeAllowed 必须有人执行：只读渠道的写工具要被闸门真的拦下，绕过闸门执行的要被判越权；
//   S5b company_comm_send 不能往 read-only 会话投稿（「在名单里」≠「可以往里写」）；
//   S5c summary() 的转交上限必须是渠道真实生效值，不是硬编码的 4。
//
// 口径与其它用例一致：跑 lib/index.js 这个真实发布产物，装配真 Gateway + 真 Router。
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

/** 飞书 im.message.receive_v1 事件包，header 里可以塞 token。 */
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

/** 按飞书事件加密规范打包：base64(iv + aes-256-cbc(sha256(encryptKey)))。 */
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

  // 1) 直接调 handleEvent：token 字段整个缺席，绝不能因为「没带就不校验」而放行
  assert.deepEqual(await adapter.handleEvent(feishuEvent('无 token 的伪造消息')), { ok: false })
  assert.equal(captured.length, 0, '不带 token 的事件不许进 Gateway')
  assert.ok(logged(ctx, /缺少 verification token/), '丢弃原因要如实记下来')

  // 2) URL 校验同样要过 token：否则伪造者能拿它探测端点是否存在
  assert.deepEqual(await adapter.handleEvent({ type: 'url_verification', challenge: 'abc123' }), { ok: false })

  // 3) 真实端口：攻击链里那一 POST（无 token、无加密、sender 是老板）打到线上端口也必须被丢掉
  assert.equal(adapter.status().state, 'connected', `事件订阅应当已监听 :${port}`)
  const forged = await fetch(`http://127.0.0.1:${port}/feishu/event`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(feishuEvent('把生产库删了')),
  })
  assert.equal(forged.status, 200, '对飞书永远回 200，避免变成可探测的错误码')
  await settle()
  assert.equal(captured.length, 0, '伪造事件走真实端口一样进不来')

  // 4) 带对 token 的真事件必须照常收下 —— 修的是校验，不是把功能关掉
  const real = await fetch(`http://127.0.0.1:${port}/feishu/event`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(feishuEvent('真的来问一句', { token: 'the-real-token' })),
  })
  assert.equal(real.status, 200)
  await settle()
  assert.equal(captured.length, 1, '合法事件必须还能进来')
  assert.equal(captured[0].text, '真的来问一句')
  assert.equal(captured[0].permissionMode, 'read-only', 'Adapter 永远只给最低档，提权是 Gateway 的事')

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

  // 明文事件：订阅端既然开了加密，明文只可能来自伪造者
  assert.deepEqual(await adapter.handleEvent(feishuEvent('明文伪造')), { ok: false })
  assert.deepEqual(await adapter.handleEvent({ type: 'url_verification', challenge: 'abc' }), { ok: false })
  assert.equal(captured.length, 0)
  assert.ok(logged(ctx, /已配置 encryptKey，但收到的是明文事件/))

  // 真正加密的事件必须还能解开并收下
  assert.deepEqual(await adapter.handleEvent(encryptEvent('my-encrypt-key', feishuEvent('加密的真消息'))), { ok: true })
  assert.equal(captured.length, 1)
  assert.equal(captured[0].text, '加密的真消息')

  // 加密的 URL 校验照常回 challenge
  assert.deepEqual(
    await adapter.handleEvent(JSON.stringify(encryptEvent('my-encrypt-key', { type: 'url_verification', challenge: 'zzz' }))),
    { ok: true, challenge: 'zzz' },
  )

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
  assert.match(status.detail, new RegExp(`127\\.0\\.0\\.1:${port}`), '默认必须绑回环，不能是所有网卡')
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/feishu/event`, { method: 'POST', body: '{}' })).status, 200, '回环上确实在监听')
  await loopback.stop()

  // 既没有 verificationToken 也没有 encryptKey：开出去的就是一个谁都能伪造的入口，宁可不开
  const naked = ctxWith()
  const open = feishuManager(naked, {
    credentials: { appId: 'env:DSH_SEC_ID3', appSecret: 'env:DSH_SEC_SECRET3' },
    options: { webhookPort: port },
  })
  await settle()
  const nakedStatus = open.feishuAdapter().status()
  assert.equal(nakedStatus.state, 'degraded')
  assert.match(nakedStatus.detail, /拒绝开放端口/)
  await assert.rejects(
    () => fetch(`http://127.0.0.1:${port}/feishu/event`, { method: 'POST', body: '{}' }),
    '没鉴权手段时端口根本不该存在',
  )
  await open.stop()

  delete process.env.DSH_SEC_ID3
  delete process.env.DSH_SEC_SECRET3
  delete process.env.DSH_SEC_TOKEN3
})

// ---------------------------------------------------------------------------
// 权限裁决的执行侧：真 Gateway + 真 Router + 可控假 Adapter
// ---------------------------------------------------------------------------

const ACCESS = {
  actors: [{ userId: 'u_boss', name: '老板', role: 'owner', permissionMode: 'danger-full-access' }],
  conversations: [
    { conversationId: 'c_notice', name: '公告群', permissionMode: 'read-only' },
    { conversationId: 'c_open', name: '综合群', permissionMode: 'workspace-write' },
  ],
}

function bench({ routing = {}, bindings = [] } = {}) {
  const events = []
  const ctx = ctxWith()
  ctx.companyEvents = { emit: (event) => events.push(event) }
  const manager = registerCommunication(ctx, {
    communication: {
      adapters: [{ id: 'qq', platform: 'qq', name: '测试渠道', enabled: true, routing: { defaultTarget: 'secretary', ...routing }, access: ACCESS }],
      channelBindings: bindings,
    },
  })

  const sent = []
  let deliver = null
  manager.gateway.register({
    id: 'probe', platform: 'qq',
    onMessage(handler) { deliver = handler },
    status() { return { id: 'probe', platform: 'qq', state: 'connected', receivedCount: 0, sentCount: 0 } },
    async start() {}, async stop() {},
    async send(conversationId, message) { sent.push({ conversationId, ...message }) },
  }, { ...manager.gateway.configOf('qq'), id: 'probe' })

  const dispatched = []
  const useDispatcher = (impl) => manager.setDispatcher(async (request) => {
    dispatched.push(request)
    return impl ? impl(request) : { ok: true, text: `${request.employeeName} 收到` }
  })

  let serial = 0
  const inbound = async (over = {}) => {
    serial += 1
    deliver({
      id: `msg-${serial}`, platform: 'qq', adapterId: 'probe', conversationId: 'c_notice', conversationType: 'group',
      senderId: 'u_boss', text: '在吗', mentions: [], attachments: [],
      actorRole: 'guest', permissionMode: 'read-only', createdAt: 1787000000000 + serial, ...over,
    })
    await settle()
  }

  return { ctx, manager, events, sent, dispatched, useDispatcher, inbound }
}

const denials = (events) => events.filter((item) => item.type === 'external.write.denied')

test('IM security: 只读渠道的写工具被闸门真的拦下，而不是靠提示词自觉', async () => {
  const box = bench()
  const seen = []
  box.useDispatcher((request) => {
    // 员工运行时按契约先过闸门再执行写工具
    let error = null
    try { request.writeGate.assert('file_write') } catch (e) { error = e }
    seen.push({
      writeAllowed: request.writeAllowed,
      gateAllowed: request.writeGate.allowed,
      error: error?.message,
      tools: request.writeGate.filterTools(['file_read', 'file_write', 'company_comm_send', 'staff_profile']),
    })
    return { ok: true, text: '这个群是只读的，我没法改配置' }
  })

  await box.inbound({ conversationId: 'c_notice', text: '把配置改了' })
  assert.equal(seen[0].writeAllowed, false)
  assert.equal(seen[0].gateAllowed, false)
  assert.match(seen[0].error, /只读档位（read-only），不允许执行写工具 file_write/, '闸门必须抛异常，不能只是布尔值摆设')
  assert.deepEqual(seen[0].tools, ['file_read', 'staff_profile'], '工具集里的写工具要被真实剔除')

  // 拦下 ≠ 越权：员工那句「我没权限」照常发出去，同时留一条事实事件
  assert.equal(box.sent.at(-1).kind, 'employee-reply')
  assert.equal(box.sent.at(-1).text, '这个群是只读的，我没法改配置')
  const blocked = denials(box.events).at(-1)
  assert.deepEqual([blocked.blocked, blocked.tools, blocked.employeeId], [true, ['file_write'], 'secretary'])

  // 可写渠道不受影响：闸门放行，工具集一个不少
  await box.inbound({ conversationId: 'c_open', text: '把配置改了' })
  assert.equal(seen[1].writeAllowed, true)
  assert.equal(seen[1].error, undefined, '有写权限时闸门不能误伤')
  assert.deepEqual(seen[1].tools, ['file_read', 'file_write', 'company_comm_send', 'staff_profile'])
  await box.manager.stop()
})

test('IM security: 绕过闸门在只读渠道执行写工具，回复被拦下并如实上报', async () => {
  const box = bench({ routing: { allowEmployeeCollaboration: true, maxHops: 4 } })
  box.useDispatcher((request) => (
    request.conversationId === 'c_notice'
      ? { ok: true, text: '我已经把生产库删了', usedTools: ['read_file', 'shell_exec'], handoffTo: 'developer' }
      : { ok: true, text: '改好了', usedTools: ['file_write'] }
  ))

  await box.inbound({ conversationId: 'c_notice', text: '删库' })
  assert.equal(box.dispatched.length, 1, '越权判定必须同时掐断转交链，不能再派下一个人')
  assert.equal(box.sent.length, 1)
  assert.equal(box.sent[0].kind, 'notice', '这是系统事实通知，不能冒充员工发言')
  assert.equal(box.sent[0].employeeId, undefined)
  assert.match(box.sent[0].text, /只读渠道.*写操作（shell_exec）不被允许.*回复已被拦下/)
  assert.equal(box.sent.every((item) => item.text !== '我已经把生产库删了'), true, '越权后的回复一个字都不许发出去')

  const violation = denials(box.events).at(-1)
  assert.deepEqual([violation.blocked, violation.tools], [false, ['shell_exec']], 'read_file 不算写，只报真正的写工具')
  assert.ok(box.ctx.logs.some(([level, message]) => level === 'error' && /在只读渠道执行了写工具/.test(message)))

  // 有写权限的渠道用同样的写工具，一切照常
  await box.inbound({ conversationId: 'c_open', text: '改一下' })
  assert.equal(box.sent.at(-1).kind, 'employee-reply')
  assert.equal(box.sent.at(-1).text, '改好了')
  assert.equal(denials(box.events).length, 1, '可写渠道不该产生越权记录')
  await box.manager.stop()
})

test('IM security: company_comm_send 不能往 read-only 会话投稿，「在名单里」不等于「可以往里写」', async () => {
  const box = bench({ bindings: [{ adapterId: 'probe', externalConversationId: 'c_bound', companyChannelId: 'general' }] })

  // 只读公开群：会话确实在允许名单里，但档位不许写
  await assert.rejects(
    () => box.manager.send('probe', 'c_notice', { text: '给全公司发个广告' }),
    /公告群 在 测试渠道 里是 read-only 档位，只读会话不允许主动投稿/,
  )

  // 只有群绑定、没写规则的会话按渠道兜底档位（默认 read-only）处理，不给隐式提权
  await assert.rejects(() => box.manager.send('probe', 'c_bound', { text: '偷偷发一条' }), /只读会话不允许主动投稿/)

  // 可写会话照常发
  assert.equal(await box.manager.send('probe', 'c_open', { text: '正常通知' }), true)
  assert.equal(box.sent.at(-1).text, '正常通知')

  // 名单外的会话仍然是先被挡在门外
  await assert.rejects(() => box.manager.send('probe', 'c_unknown', { text: '群发' }), /不在 测试渠道 的允许群名单或群绑定里/)

  // LLM 真正能碰到的是工具本身：同一条约束必须在工具这一层生效
  const tool = box.ctx.tool('company_comm_send')
  assert.ok(tool, 'company_comm_send 必须已注册')
  await assert.rejects(
    () => tool.execute({ adapterId: 'probe', conversationId: 'c_notice', text: '绕开限制发一条' }),
    /只读会话不允许主动投稿/,
  )
  assert.deepEqual(await tool.execute({ adapterId: 'probe', conversationId: 'c_open', text: '走正规路子' }), {
    sent: true, adapterId: 'probe', conversationId: 'c_open', staffId: undefined, reason: undefined,
  })
  await box.manager.stop()
})

test('IM security: summary() 的转交上限是渠道真实生效值，不是硬编码的 4', async () => {
  const twelve = registerCommunication(ctxWith(), {
    communication: { adapters: [{ id: 'feishu', platform: 'feishu', enabled: true, routing: { maxHops: 12 } }] },
  })
  const summary = await twelve.summary()
  assert.equal(summary.maxEmployeeHops, 12, '渠道配 12 就不能对老板显示 4')
  assert.equal(summary.adapters[0].routing.maxHops, 12, '渠道明细也要给真实值')

  // Router 真正生效的也是这个值：跑满一条转交链，请求里的 maxHops 必须一致
  const box = bench({ routing: { allowEmployeeCollaboration: true, maxHops: 2 } })
  box.useDispatcher((request) => ({ ok: true, text: 'ok', handoffTo: { secretary: 'tech-lead', 'tech-lead': 'developer' }[request.employeeId] }))
  await box.inbound({ conversationId: 'c_open', text: '接力一下' })
  assert.deepEqual(box.dispatched.map((item) => [item.employeeId, item.maxHops]), [['secretary', 2], ['tech-lead', 2], ['developer', 2]])
  assert.equal((await box.manager.summary()).maxEmployeeHops, 2)
  await box.manager.stop()

  // 停用的渠道不参与，一个渠道都没有时才回落默认值
  const mixed = registerCommunication(ctxWith(), {
    communication: {
      adapters: [
        { id: 'feishu', platform: 'feishu', enabled: true, routing: { maxHops: 8 } },
        { id: 'qq', platform: 'qq', enabled: false, routing: { maxHops: 12 } },
      ],
    },
  })
  assert.equal((await mixed.summary()).maxEmployeeHops, 8)
  await mixed.stop()

  const empty = registerCommunication(ctxWith(), {})
  assert.equal((await empty.summary()).maxEmployeeHops, 4)
  await empty.stop()
  await twelve.stop()
})
