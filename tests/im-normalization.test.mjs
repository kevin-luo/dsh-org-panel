// IM normalization：平台层只负责配置清洗、消息翻译与权限最低化。
// 员工选择属于 Work Orchestrator；这里明确禁止再出现 defaultTarget / secretary fallback / handoff。
import test from 'node:test'
import assert from 'node:assert/strict'

const { registerCommunication } = await import('../lib/index.js')

function ctxWith() {
  const logs = []
  return {
    logs,
    logger: {
      info: (message) => logs.push(['info', message]),
      warn: (message) => logs.push(['warn', message]),
      error: (message) => logs.push(['error', message]),
    },
  }
}

function feishuEvent(message, sender = { sender_id: { open_id: 'ou_boss' }, sender_type: 'user' }, header = {}) {
  return {
    schema: '2.0',
    header: { event_id: `evt-${message.message_id}`, event_type: 'im.message.receive_v1', ...header },
    event: { sender, message },
  }
}

test('IM normalization（配置）: 渠道只保留权限与工作组规模，不再表达默认员工或秘书兜底', async () => {
  const manager = registerCommunication(ctxWith(), {
    communication: {
      adapters: [{
        id: 'feishu', platform: 'FeiShu', name: '飞书', enabled: true, connectionMode: 'webhook',
        credentials: { appId: 'env:DSH_TEST_FEISHU_ID', appSecret: 'env:DSH_TEST_FEISHU_SECRET' },
        routing: { maxWorkgroupSize: 999 },
        access: {
          defaultPermissionMode: 'write',
          actors: [
            { userId: 'ou_boss', name: '老板', role: 'boss', permissionMode: 'FULL' },
            { userId: 'ou_mate', role: 'staff' },
            { name: '没有 userId 的脏数据' },
          ],
          conversations: [{ conversationId: 'oc_dev', name: '研发群', permissionMode: 'read only', allowedEmployees: ['developer'] }],
        },
        options: { webhookPath: '/feishu/hook', webhookPort: 0 },
      }],
      channelBindings: [
        { adapterId: 'feishu', externalConversationId: 'oc_dev', companyChannelId: 'engineering' },
        { adapterId: 'feishu', companyChannelId: '缺 conversationId 的脏数据' },
      ],
    },
  })
  assert.ok(manager)

  const config = manager.gateway.configOf('feishu')
  assert.equal(config.platform, 'feishu')
  assert.deepEqual(config.routing, { maxWorkgroupSize: 4, notifyUndeliverable: true }, '工作组人数有系统硬上限 4')
  assert.equal('defaultTarget' in config.routing, false)
  assert.equal('maxHops' in config.routing, false)
  assert.equal('allowEmployeeCollaboration' in config.routing, false)

  assert.equal(config.access.defaultPermissionMode, 'workspace-write')
  assert.equal(config.access.allowUnknownUsers, false)
  assert.equal(config.access.allowUnknownConversations, false)
  assert.equal(config.access.actors.length, 2)
  assert.deepEqual(config.access.actors[0], { userId: 'ou_boss', name: '老板', role: 'owner', permissionMode: 'danger-full-access' })
  assert.equal(config.access.actors[1].role, 'member')
  assert.equal(config.access.actors[1].permissionMode, 'workspace-write')
  assert.equal(config.access.conversations[0].permissionMode, 'read-only')
  assert.deepEqual(config.access.conversations[0].allowedEmployees, ['developer'], 'allowedEmployees 是权限范围，不是默认负责人')

  assert.equal(manager.config.channelBindings.length, 1)
  assert.deepEqual(manager.config.channelBindings[0], { adapterId: 'feishu', externalConversationId: 'oc_dev', companyChannelId: 'engineering' })
  assert.equal(manager.router.channelIdFor('feishu', 'oc_dev'), 'engineering')
  await manager.stop()
})

test('IM normalization（配置）: 未知档位与未知角色一律落到最低权限，不给隐式提权', async () => {
  const manager = registerCommunication(ctxWith(), {
    communication: { adapters: [{
      id: 'feishu', platform: 'feishu', enabled: true,
      access: {
        defaultPermissionMode: '我随便写的',
        actors: [{ userId: 'ou_x', role: '超级管理员', permissionMode: 'root' }],
        conversations: [{ conversationId: 'oc_x' }],
      },
    }] },
  })
  const config = manager.gateway.configOf('feishu')
  assert.equal(config.access.defaultPermissionMode, 'read-only')
  assert.equal(config.access.actors[0].permissionMode, 'read-only')
  assert.equal(config.access.actors[0].role, 'guest')
  assert.equal(config.access.conversations[0].permissionMode, 'read-only')
  assert.equal(config.name, '飞书')
  assert.equal(config.routing.maxWorkgroupSize, 4)
  await manager.stop()
})

test('IM normalization（配置）: 明文密钥 / 未知平台 / 重复渠道 id 一律拒绝整条配置', async () => {
  const raw = ctxWith()
  assert.equal(registerCommunication(raw, { communication: { adapters: [{ id: 'feishu', platform: 'feishu', enabled: true, credentials: { appSecret: 'a-real-plaintext-secret' } }] } }), undefined)
  assert.match(raw.logs.at(-1)[1], /appSecret 必须写成 env:XXX 或 secret:XXX 引用/)

  const options = ctxWith()
  assert.equal(registerCommunication(options, { communication: { adapters: [{ id: 'feishu', platform: 'feishu', options: { appSecret: 'plain' } }] } }), undefined)
  assert.match(options.logs.at(-1)[1], /options\.appSecret 疑似明文密钥/)

  const unknown = ctxWith()
  assert.equal(registerCommunication(unknown, { communication: { adapters: [{ id: 'tg', platform: 'telegram' }] } }), undefined)
  assert.match(unknown.logs.at(-1)[1], /未知的通讯平台：telegram/)

  const duplicated = ctxWith()
  assert.equal(registerCommunication(duplicated, { communication: { adapters: [{ id: 'feishu', platform: 'feishu' }, { id: 'feishu', platform: 'qq' }] } }), undefined)
  assert.match(duplicated.logs.at(-1)[1], /通讯渠道 id 重复/)

  const silent = ctxWith()
  const manager = registerCommunication(silent, {})
  assert.ok(manager)
  assert.equal(manager.configured, false)
  const summary = await manager.summary()
  assert.deepEqual(summary.adapters, [])
  assert.equal(summary.maxWorkgroupSize, 4)
  await manager.stop()
})

test('IM normalization（配置）: 摘要不泄密，并如实下发工作组上限', async () => {
  const appId = 'cli_a1b2c3d4e5f6'
  const appSecret = 'Zq9wErTy0pAsDfGh1234'
  process.env.DSH_TEST_FEISHU_ID = appId
  process.env.DSH_TEST_FEISHU_SECRET = appSecret
  const manager = registerCommunication(ctxWith(), {
    communication: { adapters: [{
      id: 'feishu', platform: 'feishu', enabled: true, connectionMode: 'webhook',
      credentials: { appId: 'env:DSH_TEST_FEISHU_ID', appSecret: 'env:DSH_TEST_FEISHU_SECRET' },
      routing: { maxWorkgroupSize: 3 },
      access: { conversations: [{ conversationId: 'oc_dev' }] },
    }] },
  })

  const summary = await manager.summary()
  const adapter = summary.adapters[0]
  assert.equal(adapter.appId, 'cli_****e5f6')
  assert.equal(adapter.appSecretConfigured, true)
  assert.deepEqual(adapter.credentials.map((item) => [item.field, item.ref, item.configured]), [
    ['appId', 'env:DSH_TEST_FEISHU_ID', true],
    ['appSecret', 'env:DSH_TEST_FEISHU_SECRET', true],
  ])
  assert.equal(adapter.credentials.find((item) => item.field === 'appSecret').masked, '****')
  const serialized = JSON.stringify(summary)
  assert.equal(serialized.includes(appSecret), false)
  assert.equal(serialized.includes(appId), false)
  assert.equal(summary.maxWorkgroupSize, 3)
  await manager.stop()
  delete process.env.DSH_TEST_FEISHU_ID
  delete process.env.DSH_TEST_FEISHU_SECRET
})

test('IM normalization（消息）: 飞书原始事件 → 统一 ExternalMessage', async () => {
  const manager = registerCommunication(ctxWith(), {
    communication: { adapters: [{
      id: 'feishu', platform: 'feishu', enabled: true, connectionMode: 'webhook',
      credentials: { appId: 'env:DSH_TEST_ABSENT_ID', appSecret: 'env:DSH_TEST_ABSENT_SECRET' },
      access: { actors: [{ userId: 'ou_boss', role: 'owner' }], conversations: [{ conversationId: 'oc_dev' }] },
      options: { allowUnverifiedEvents: true },
    }] },
  })
  const adapter = manager.feishuAdapter()
  assert.ok(adapter)
  const captured = []
  adapter.onMessage((message) => captured.push(message))
  assert.deepEqual(await adapter.handleEvent({ type: 'url_verification', challenge: 'abc123' }), { ok: true, challenge: 'abc123' })

  await adapter.handleEvent(JSON.stringify(feishuEvent({
    message_id: 'om_1', chat_id: 'oc_dev', chat_type: 'group', message_type: 'text', create_time: '1787000000000',
    content: JSON.stringify({ text: '@_user_1 帮我看下构建挂了' }),
    mentions: [{ key: '@_user_1', id: { open_id: 'ou_wang' }, name: '老王' }], root_id: 'om_root',
  })))

  await adapter.handleEvent(feishuEvent({
    message_id: 'om_2', chat_id: 'p2p_boss', chat_type: 'p2p', message_type: 'post',
    content: JSON.stringify({ title: '周报', content: [
      [{ tag: 'text', text: '请 ' }, { tag: 'at', user_name: '小刘' }, { tag: 'text', text: ' 汇总' }],
      [{ tag: 'a', text: '看这里', href: 'https://example.invalid/x' }],
    ] }),
  }, { sender_id: { union_id: 'on_guest' }, sender_type: 'user' }))

  await adapter.handleEvent(feishuEvent({ message_id: 'om_3', chat_id: 'oc_dev', message_type: 'text', content: JSON.stringify({ text: '我是机器人' }) }, { sender_id: { open_id: 'ou_bot' }, sender_type: 'app' }))
  assert.deepEqual(await adapter.handleEvent({ header: { event_type: 'im.chat.updated_v1' }, event: {} }), { ok: true })
  assert.equal(captured.length, 2)

  const [group, direct] = captured
  assert.deepEqual(group, {
    id: 'om_1', platform: 'feishu', adapterId: 'feishu', conversationId: 'oc_dev', conversationType: 'group',
    senderId: 'ou_boss', senderName: undefined, text: '@老王 帮我看下构建挂了', mentions: ['老王'], attachments: [],
    actorRole: 'guest', permissionMode: 'read-only', createdAt: 1787000000000, threadId: 'om_root',
  })
  assert.equal(direct.conversationType, 'direct')
  assert.equal(direct.senderId, 'on_guest')
  assert.equal(direct.text, '周报\n请 @小刘 汇总\n看这里(https://example.invalid/x)')
  assert.deepEqual(direct.mentions, ['小刘'])
  assert.equal(direct.threadId, undefined)
  assert.ok(direct.createdAt > 0)
  for (const message of captured) {
    assert.equal(message.actorRole, 'guest')
    assert.equal(message.permissionMode, 'read-only')
    assert.equal(message.platform, 'feishu')
    assert.equal(message.adapterId, 'feishu')
  }
  assert.equal(adapter.status().receivedCount, 2)
  await manager.stop()
})

test('IM normalization（消息）: verification token 不匹配的事件直接丢弃', async () => {
  process.env.DSH_TEST_FEISHU_ID2 = 'cli_zzz'
  process.env.DSH_TEST_FEISHU_SECRET2 = 'secret-zzz'
  process.env.DSH_TEST_FEISHU_TOKEN2 = 'the-real-token'
  const ctx = ctxWith()
  const manager = registerCommunication(ctx, {
    communication: { adapters: [{
      id: 'feishu', platform: 'feishu', enabled: true, connectionMode: 'webhook',
      credentials: { appId: 'env:DSH_TEST_FEISHU_ID2', appSecret: 'env:DSH_TEST_FEISHU_SECRET2', verificationToken: 'env:DSH_TEST_FEISHU_TOKEN2' },
      access: { actors: [{ userId: 'ou_boss', role: 'owner' }], conversations: [{ conversationId: 'oc_dev' }] },
    }] },
  })
  const adapter = manager.feishuAdapter()
  const captured = []
  adapter.onMessage((message) => captured.push(message))
  const body = feishuEvent({ message_id: 'om_9', chat_id: 'oc_dev', chat_type: 'group', message_type: 'text', content: JSON.stringify({ text: '伪造的消息' }) }, undefined, { token: 'forged-token' })
  assert.deepEqual(await adapter.handleEvent(body), { ok: false })
  assert.equal(captured.length, 0)
  assert.ok(ctx.logs.some(([, message]) => /verification token 不匹配/.test(message)))
  body.header.token = 'the-real-token'
  assert.deepEqual(await adapter.handleEvent(body), { ok: true })
  assert.equal(captured.length, 1)
  await manager.stop()
  delete process.env.DSH_TEST_FEISHU_ID2
  delete process.env.DSH_TEST_FEISHU_SECRET2
  delete process.env.DSH_TEST_FEISHU_TOKEN2
})
