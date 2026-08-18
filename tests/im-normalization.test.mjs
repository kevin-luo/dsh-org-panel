// 需求文档五十八条第 6 项：IM normalization。
//
// 两层归一化都要测：
//   A. 配置归一化（文档二十三 / 三十 / 三十一）：cordis.yml 里的松散写法 → 严格结构；
//      明文密钥、未知平台一律拒绝整条配置，不允许静默带病启动。
//   B. 消息归一化（文档二十六 / 二十七 / 二十八）：飞书原始事件 → 统一 ExternalMessage；
//      Adapter 只翻译，永远给最低权限，不自己决定找谁、也不自己提权。
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

/** 飞书 im.message.receive_v1 事件包（结构照官方事件订阅格式写）。 */
function feishuEvent(message, sender = { sender_id: { open_id: 'ou_boss' }, sender_type: 'user' }, header = {}) {
  return {
    schema: '2.0',
    header: { event_id: `evt-${message.message_id}`, event_type: 'im.message.receive_v1', ...header },
    event: { sender, message },
  }
}

test('IM normalization（配置）: 松散配置被清洗成严格结构，任何未写死的档位一律往低了兜', async () => {
  const ctx = ctxWith()
  const manager = registerCommunication(ctx, {
    communication: {
      adapters: [{
        // 平台名大小写混写、权限用别名、maxHops 写了个离谱的数
        id: 'feishu', platform: 'FeiShu', name: '飞书', enabled: true, connectionMode: 'webhook',
        credentials: { appId: 'env:DSH_TEST_FEISHU_ID', appSecret: 'env:DSH_TEST_FEISHU_SECRET' },
        routing: { defaultTarget: 'secretary', maxHops: 999 },
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
        { adapterId: 'feishu', externalConversationId: 'oc_dev', companyChannelId: 'engineering', defaultEmployees: ['developer'] },
        { adapterId: 'feishu', companyChannelId: '缺 conversationId 的脏数据' },
      ],
    },
  })
  assert.ok(manager, '合法配置必须装配成功')

  const config = manager.gateway.configOf('feishu')
  assert.equal(config.platform, 'feishu', '平台名大小写要归一')
  assert.equal(config.routing.maxHops, 12, 'maxHops 必须被夹在合法区间里')
  assert.equal(config.routing.recognizeMentions, true, '缺省即开启 @ 识别')
  assert.equal(config.routing.allowEmployeeCollaboration, false, '员工互相转交默认关闭')
  assert.equal(config.routing.notifyUndeliverable, true)

  assert.equal(config.access.defaultPermissionMode, 'workspace-write', "'write' → workspace-write")
  assert.equal(config.access.allowUnknownUsers, false, '默认不接名单外用户')
  assert.equal(config.access.allowUnknownConversations, false, '默认不接名单外群')

  assert.equal(config.access.actors.length, 2, '没有 userId 的脏规则要被丢掉')
  assert.deepEqual(config.access.actors[0], { userId: 'ou_boss', name: '老板', role: 'owner', permissionMode: 'danger-full-access' })
  assert.equal(config.access.actors[1].role, 'member', "'staff' → member")
  assert.equal(config.access.actors[1].permissionMode, 'workspace-write', '没写档位就继承 defaultPermissionMode')
  assert.deepEqual(config.access.conversations[0].permissionMode, 'read-only', "'read only' → read-only")
  assert.deepEqual(config.access.conversations[0].allowedEmployees, ['developer'])

  assert.equal(manager.config.channelBindings.length, 1, '缺字段的群绑定要被丢掉')
  assert.equal(manager.config.channelBindings[0].companyChannelId, 'engineering')
  assert.equal(manager.router.channelIdFor('feishu', 'oc_dev'), 'engineering')
  await manager.stop()
})

test('IM normalization（配置）: 未知档位与未知角色一律落到最低权限，不给隐式提权', async () => {
  const manager = registerCommunication(ctxWith(), {
    communication: {
      adapters: [{
        id: 'feishu', platform: 'feishu', enabled: true,
        access: {
          defaultPermissionMode: '我随便写的',
          actors: [{ userId: 'ou_x', role: '超级管理员', permissionMode: 'root' }],
          conversations: [{ conversationId: 'oc_x' }],
        },
      }],
    },
  })
  const config = manager.gateway.configOf('feishu')
  assert.equal(config.access.defaultPermissionMode, 'read-only')
  assert.equal(config.access.actors[0].permissionMode, 'read-only')
  assert.equal(config.access.actors[0].role, 'guest', '认不出来的角色只能是陌生人')
  assert.equal(config.access.conversations[0].permissionMode, 'read-only')
  assert.equal(config.name, '飞书', '缺省名字按平台补，不留空')
  await manager.stop()
})

test('IM normalization（配置）: 明文密钥 / 未知平台 / 重复渠道 id 一律拒绝整条配置', async () => {
  const raw = ctxWith()
  assert.equal(
    registerCommunication(raw, { communication: { adapters: [{ id: 'feishu', platform: 'feishu', enabled: true, credentials: { appSecret: 'a-real-plaintext-secret' } }] } }),
    undefined,
    '明文密钥必须让整条通讯配置作废',
  )
  assert.match(raw.logs.at(-1)[1], /appSecret 必须写成 env:XXX 或 secret:XXX 引用，禁止明文密钥/)

  const options = ctxWith()
  assert.equal(
    registerCommunication(options, { communication: { adapters: [{ id: 'feishu', platform: 'feishu', options: { appSecret: 'plain' } }] } }),
    undefined,
    'options 里塞明文密钥同样要被拦下',
  )
  assert.match(options.logs.at(-1)[1], /options\.appSecret 疑似明文密钥/)

  const unknown = ctxWith()
  assert.equal(registerCommunication(unknown, { communication: { adapters: [{ id: 'tg', platform: 'telegram' }] } }), undefined)
  assert.match(unknown.logs.at(-1)[1], /未知的通讯平台：telegram/)

  const duplicated = ctxWith()
  assert.equal(
    registerCommunication(duplicated, { communication: { adapters: [{ id: 'feishu', platform: 'feishu' }, { id: 'feishu', platform: 'qq' }] } }),
    undefined,
  )
  assert.match(duplicated.logs.at(-1)[1], /通讯渠道 id 重复/)

  // 没配 communication 段：安静降级成"未配置"，不报错也不假装连上了。
  const silent = ctxWith()
  const manager = registerCommunication(silent, {})
  assert.ok(manager)
  assert.equal(manager.configured, false)
  assert.deepEqual((await manager.summary()).adapters, [])
  await manager.stop()
})

test('IM normalization（配置）: 对外摘要只有掩码与 configured，绝不回传完整密钥', async () => {
  const appId = 'cli_a1b2c3d4e5f6'
  const appSecret = 'Zq9wErTy0pAsDfGh1234'
  process.env.DSH_TEST_FEISHU_ID = appId
  process.env.DSH_TEST_FEISHU_SECRET = appSecret

  const manager = registerCommunication(ctxWith(), {
    communication: {
      adapters: [{
        id: 'feishu', platform: 'feishu', enabled: true, connectionMode: 'webhook',
        credentials: { appId: 'env:DSH_TEST_FEISHU_ID', appSecret: 'env:DSH_TEST_FEISHU_SECRET' },
        access: { conversations: [{ conversationId: 'oc_dev' }] },
      }],
    },
  })

  const summary = await manager.summary()
  const adapter = summary.adapters[0]
  assert.equal(adapter.appId, 'cli_****e5f6', 'appId 只给掩码')
  assert.equal(adapter.appSecretConfigured, true)
  assert.deepEqual(adapter.credentials.map((item) => [item.field, item.ref, item.configured]), [
    ['appId', 'env:DSH_TEST_FEISHU_ID', true],
    ['appSecret', 'env:DSH_TEST_FEISHU_SECRET', true],
  ])
  assert.equal(adapter.credentials.find((item) => item.field === 'appSecret').masked, '****')

  const serialized = JSON.stringify(summary)
  assert.equal(serialized.includes(appSecret), false, '摘要里绝不能出现完整 appSecret')
  assert.equal(serialized.includes(appId), false, '摘要里绝不能出现完整 appId')
  assert.equal(summary.maxEmployeeHops, 4)
  await manager.stop()

  delete process.env.DSH_TEST_FEISHU_ID
  delete process.env.DSH_TEST_FEISHU_SECRET
})

test('IM normalization（消息）: 飞书原始事件 → 统一 ExternalMessage', async () => {
  const manager = registerCommunication(ctxWith(), {
    communication: {
      adapters: [{
        id: 'feishu', platform: 'feishu', enabled: true, connectionMode: 'webhook',
        credentials: { appId: 'env:DSH_TEST_ABSENT_ID', appSecret: 'env:DSH_TEST_ABSENT_SECRET' },
        access: { actors: [{ userId: 'ou_boss', role: 'owner' }], conversations: [{ conversationId: 'oc_dev' }] },
        // 本用例只验「Adapter 只翻译、不裁决」的归一化逻辑，与鉴权无关。
        // handleEvent 现在对无法验真的事件 fail-closed，所以这里显式走文档给的逃生口，
        // 把归一化与鉴权解耦；鉴权本身由下面「无法验真的事件一律丢弃」那条用例覆盖。
        options: { allowUnverifiedEvents: true },
      }],
    },
  })
  const adapter = manager.feishuAdapter()
  assert.ok(adapter, 'feishu 渠道应当装配出 FeishuAdapter')

  // 直接拿 Adapter 层的产物，才能验证「Adapter 只翻译、不裁决」。
  const captured = []
  adapter.onMessage((message) => captured.push(message))

  // 1) URL 校验：原样回 challenge，且不产生任何消息
  assert.deepEqual(await adapter.handleEvent({ type: 'url_verification', challenge: 'abc123' }), { ok: true, challenge: 'abc123' })

  // 2) 群消息 + @ 占位符：飞书正文里是 @_user_1，必须按 mentions 表还原成 @老王
  await adapter.handleEvent(JSON.stringify(feishuEvent({
    message_id: 'om_1', chat_id: 'oc_dev', chat_type: 'group', message_type: 'text',
    create_time: '1787000000000',
    content: JSON.stringify({ text: '@_user_1 帮我看下构建挂了' }),
    mentions: [{ key: '@_user_1', id: { open_id: 'ou_wang' }, name: '老王' }],
    root_id: 'om_root',
  })))

  // 3) 单聊富文本：post 结构压平成纯文本，@ 的人也要收进 mentions
  await adapter.handleEvent(feishuEvent(
    {
      message_id: 'om_2', chat_id: 'p2p_boss', chat_type: 'p2p', message_type: 'post',
      content: JSON.stringify({
        title: '周报',
        content: [
          [{ tag: 'text', text: '请 ' }, { tag: 'at', user_name: '小刘' }, { tag: 'text', text: ' 汇总' }],
          [{ tag: 'a', text: '看这里', href: 'https://example.invalid/x' }],
        ],
      }),
    },
    { sender_id: { union_id: 'on_guest' }, sender_type: 'user' },
  ))

  // 4) 机器人自己发的消息：不能回环成一条新任务
  await adapter.handleEvent(feishuEvent(
    { message_id: 'om_3', chat_id: 'oc_dev', message_type: 'text', content: JSON.stringify({ text: '我是机器人' }) },
    { sender_id: { open_id: 'ou_bot' }, sender_type: 'app' },
  ))

  // 5) 非消息事件：安静忽略
  assert.deepEqual(await adapter.handleEvent({ header: { event_type: 'im.chat.updated_v1' }, event: {} }), { ok: true })

  assert.equal(captured.length, 2, '只有两条真实的人类消息应该被归一化出来')

  const [group, direct] = captured
  assert.deepEqual(group, {
    id: 'om_1',
    platform: 'feishu',
    adapterId: 'feishu',
    conversationId: 'oc_dev',
    conversationType: 'group',
    senderId: 'ou_boss',
    senderName: undefined,
    text: '@老王 帮我看下构建挂了',
    mentions: ['老王'],
    attachments: [],
    actorRole: 'guest',
    permissionMode: 'read-only',
    createdAt: 1787000000000,
    threadId: 'om_root',
  })

  assert.equal(direct.conversationType, 'direct', 'p2p 要归一成 direct')
  assert.equal(direct.senderId, 'on_guest', 'open_id 缺失时回落 union_id')
  assert.equal(direct.text, '周报\n请 @小刘 汇总\n看这里(https://example.invalid/x)')
  assert.deepEqual(direct.mentions, ['小刘'])
  assert.equal(direct.threadId, undefined)
  assert.ok(direct.createdAt > 0)

  // 铁律：Adapter 永远只给最低权限，提权是 Gateway 的事。
  for (const message of captured) {
    assert.equal(message.actorRole, 'guest')
    assert.equal(message.permissionMode, 'read-only')
    assert.equal(message.platform, 'feishu')
    assert.equal(message.adapterId, 'feishu')
    assert.equal(Array.isArray(message.attachments), true)
  }

  const status = adapter.status()
  assert.equal(status.receivedCount, 2, '收到的条数要如实计数')
  assert.equal(status.platform, 'feishu')
  await manager.stop()
})

test('IM normalization（消息）: verification token 不匹配的事件直接丢弃', async () => {
  process.env.DSH_TEST_FEISHU_ID2 = 'cli_zzz'
  process.env.DSH_TEST_FEISHU_SECRET2 = 'secret-zzz'
  process.env.DSH_TEST_FEISHU_TOKEN2 = 'the-real-token'

  const ctx = ctxWith()
  const manager = registerCommunication(ctx, {
    communication: {
      adapters: [{
        id: 'feishu', platform: 'feishu', enabled: true, connectionMode: 'webhook',
        credentials: { appId: 'env:DSH_TEST_FEISHU_ID2', appSecret: 'env:DSH_TEST_FEISHU_SECRET2', verificationToken: 'env:DSH_TEST_FEISHU_TOKEN2' },
        access: { actors: [{ userId: 'ou_boss', role: 'owner' }], conversations: [{ conversationId: 'oc_dev' }] },
      }],
    },
  })
  const adapter = manager.feishuAdapter()
  const captured = []
  adapter.onMessage((message) => captured.push(message))

  const body = feishuEvent({ message_id: 'om_9', chat_id: 'oc_dev', chat_type: 'group', message_type: 'text', content: JSON.stringify({ text: '伪造的消息' }) }, undefined, { token: 'forged-token' })
  assert.deepEqual(await adapter.handleEvent(body), { ok: false })
  assert.equal(captured.length, 0, '校验不过的事件不许进 Gateway')
  assert.ok(ctx.logs.some(([, message]) => /verification token 不匹配/.test(message)))

  body.header.token = 'the-real-token'
  assert.deepEqual(await adapter.handleEvent(body), { ok: true })
  assert.equal(captured.length, 1)
  await manager.stop()

  delete process.env.DSH_TEST_FEISHU_ID2
  delete process.env.DSH_TEST_FEISHU_SECRET2
  delete process.env.DSH_TEST_FEISHU_TOKEN2
})
