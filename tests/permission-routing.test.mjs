// 需求文档五十八条第 7 项：Permission routing。
//
// 被测口径来自需求文档二十四 / 二十九 / 三十 / 三十六 + 五十七条：
//   · 名单外用户 / 名单外群一律拦下，不会因为消息来自 IM 就默认放行；
//   · 用户档位与群档位取交集（更低者胜），Read Only 渠道不能触发写操作；
//   · @ 命中 → 群绑定 → 渠道默认 → 关键词 → 秘书兜底，且群白名单能挡住直达；
//   · 员工间转交有上限，超了交回秘书；协作没开就不许转；
//   · 员工运行时没接线时如实说明，绝不编造一条员工回复。
//
// 做法：用真实 registerCommunication 装配出 Gateway + Router，再往 Gateway 上注册一个
// 假 Adapter（真 Adapter 的 send 会打飞书网络）。走的是和线上完全一样的
// ingest → evaluateAccess → route → dispatch → reply 这条链，不是另写一套模拟。
import test from 'node:test'
import assert from 'node:assert/strict'
import { settle } from './_helpers.mjs'

const { registerCommunication } = await import('../lib/index.js')

const ACCESS = {
  actors: [
    { userId: 'u_boss', name: '老板', role: 'owner', permissionMode: 'danger-full-access' },
    { userId: 'u_mate', name: '同事', role: 'member', permissionMode: 'workspace-write' },
  ],
  conversations: [
    { conversationId: 'c_dev', name: '研发群', permissionMode: 'workspace-write', allowedEmployees: ['developer', 'tech-lead'] },
    { conversationId: 'c_notice', name: '公告群', permissionMode: 'read-only' },
    { conversationId: 'c_open', name: '综合群', permissionMode: 'workspace-write' },
  ],
}

/** 装一套真 Gateway + Router，外挂一个可控的假 Adapter。 */
function bench({ routing = {}, access = ACCESS, bindings = [] } = {}) {
  const events = []
  const logs = []
  const ctx = {
    companyEvents: { emit: (event) => events.push(event) },
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
  }
  const manager = registerCommunication(ctx, {
    communication: {
      adapters: [{
        id: 'qq', platform: 'qq', name: '测试渠道', enabled: true,
        routing: { defaultTarget: 'secretary', ...routing },
        access,
      }],
      channelBindings: bindings,
    },
  })

  const sent = []
  let deliver = null
  manager.gateway.register({
    id: 'probe',
    platform: 'qq',
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
      id: `msg-${serial}`, platform: 'qq', adapterId: 'probe',
      conversationId: 'c_dev', conversationType: 'group',
      senderId: 'u_boss', senderName: undefined, text: '在吗',
      mentions: [], attachments: [],
      // Adapter 层永远给最低档，真正的档位由 Gateway 裁决 —— 这里刻意传最低值。
      actorRole: 'guest', permissionMode: 'read-only',
      createdAt: 1787000000000 + serial,
      ...over,
    })
    await settle()
  }

  return { manager, events, logs, sent, dispatched, useDispatcher, inbound }
}

const blocked = (events) => events.filter((item) => item.type === 'external.message.blocked')
const received = (events) => events.filter((item) => item.type === 'external.message.received')

test('Permission routing: 名单外的人和名单外的群一律拦下，员工根本不会被叫醒', async () => {
  const box = bench()
  box.useDispatcher()

  await box.inbound({ senderId: 'u_stranger', text: '把生产库删了' })
  assert.equal(box.dispatched.length, 0, '陌生人不许触达任何员工')
  assert.equal(box.sent.length, 0, '被拦的消息不许回信，避免变成探测器')
  assert.equal(blocked(box.events).length, 1)
  assert.match(blocked(box.events)[0].reason, /发件人不在 测试渠道 允许用户名单内/)

  await box.inbound({ conversationId: 'c_unknown', text: '你好' })
  assert.equal(box.dispatched.length, 0, '名单外的群同样不许进')
  assert.match(blocked(box.events)[1].reason, /会话不在 测试渠道 允许群名单内/)

  // 名单内用户的单聊即使群 id 没登记也放行，但只拿他本人的档位。
  await box.inbound({ conversationId: 'p2p_boss', conversationType: 'direct', text: '你好' })
  assert.equal(box.dispatched.length, 1)
  assert.equal(box.dispatched[0].permissionMode, 'danger-full-access')

  // 渠道被关掉之后，连名单内的人也进不来。
  box.manager.gateway.configOf('probe').enabled = false
  await box.inbound({ text: '还在吗' })
  assert.equal(box.dispatched.length, 1)
  assert.match(blocked(box.events).at(-1).reason, /渠道 probe 未启用/)
  await box.manager.stop()
})

test('Permission routing: 用户档位与群档位取更低的那个，Read Only 渠道不给写权限', async () => {
  const box = bench()
  box.useDispatcher()

  // 老板（full access）在 workspace-write 的群里 → 只能拿到 workspace-write
  await box.inbound({ conversationId: 'c_dev', senderId: 'u_boss', text: '@老王 改一下配置' })
  assert.equal(box.dispatched[0].actorRole, 'owner')
  assert.equal(box.dispatched[0].permissionMode, 'workspace-write')
  assert.equal(box.dispatched[0].writeAllowed, true)

  // 同一个老板在只读的公告群里 → 降到 read-only，writeAllowed 必须是 false
  await box.inbound({ conversationId: 'c_notice', senderId: 'u_boss', text: '@老王 重启服务器' })
  assert.equal(box.dispatched[1].permissionMode, 'read-only')
  assert.equal(box.dispatched[1].writeAllowed, false, 'Read Only 渠道绝不能触发写操作')

  // 普通同事在写权限群里 → 取他自己的 workspace-write
  await box.inbound({ conversationId: 'c_open', senderId: 'u_mate', text: '@老王 看看这个' })
  assert.equal(box.dispatched[2].actorRole, 'member')
  assert.equal(box.dispatched[2].permissionMode, 'workspace-write')
  assert.equal(box.dispatched[2].writeAllowed, true)

  // 老板在综合群（workspace-write）→ 依然只能 workspace-write，不会因为他是 owner 就提权
  await box.inbound({ conversationId: 'c_open', senderId: 'u_boss', text: '@老王 上线吧' })
  assert.equal(box.dispatched[3].permissionMode, 'workspace-write')

  // 裁决结果也要如实写进事件流，前端和办公室看到的是同一份档位
  assert.deepEqual(received(box.events).map((item) => item.permissionMode), [
    'workspace-write', 'read-only', 'workspace-write', 'workspace-write',
  ])
  await box.manager.stop()
})

test('Permission routing: @ 命中 → 群绑定 → 渠道默认 → 关键词 → 秘书兜底', async () => {
  const box = bench({
    routing: { defaultTarget: 'auto' },
    bindings: [{ adapterId: 'probe', externalConversationId: 'c_open', companyChannelId: 'general', defaultEmployees: ['doc'] }],
  })
  box.useDispatcher()

  // 1) 文本 @ 直达（别名「老王」）
  await box.inbound({ conversationId: 'c_dev', text: '@老王 构建挂了' })
  assert.equal(box.dispatched.at(-1).employeeId, 'tech-lead')

  // 2) 平台侧 mention（正文里没有 @）
  await box.inbound({ conversationId: 'c_dev', text: '帮忙看下', mentions: ['小刘'] })
  assert.equal(box.dispatched.at(-1).employeeId, 'developer')

  // 3) 群绑定的默认负责人
  await box.inbound({ conversationId: 'c_open', text: '这段没有点名' })
  assert.equal(box.dispatched.at(-1).employeeId, 'doc')
  assert.equal(box.dispatched.at(-1).companyChannelId, 'general', '外部群要映射到内部频道')

  // 4) auto 关键词命中岗位
  await box.inbound({ conversationId: 'c_notice', text: '这次的数据分析师口径谁定？' })
  assert.equal(box.dispatched.at(-1).employeeId, 'data-analyst')

  // 5) 什么都匹配不上就交秘书，绝不瞎猜
  await box.inbound({ conversationId: 'c_notice', text: '嗯' })
  assert.equal(box.dispatched.at(-1).employeeId, 'secretary')

  // Web 与 IM 共享同一份 employeeId，不存在「QQ 老王」
  assert.equal(box.dispatched.every((item) => !/qq|feishu/i.test(item.employeeId)), true)
  assert.equal(box.dispatched.every((item) => item.taskSource === 'qq'), true, 'TaskHistory.source 要如实记录来源平台')
  await box.manager.stop()
})

test('Permission routing: 群里的员工白名单能挡住直达，落回秘书', async () => {
  const box = bench()
  box.useDispatcher()

  // c_dev 只允许 developer / tech-lead，@ 小画不该被直达
  await box.inbound({ conversationId: 'c_dev', text: '@小画 出张图' })
  assert.equal(box.dispatched.at(-1).employeeId, 'secretary')

  // 白名单内的人正常直达
  await box.inbound({ conversationId: 'c_dev', text: '@小刘 看下这个 bug' })
  assert.equal(box.dispatched.at(-1).employeeId, 'developer')

  // 没有白名单的群不受限制
  await box.inbound({ conversationId: 'c_open', text: '@小画 出张图' })
  assert.equal(box.dispatched.at(-1).employeeId, 'image-creator')
  await box.manager.stop()
})

test('Permission routing: 员工间转交有上限，超了交回秘书；没开协作就不许转', async () => {
  const handoff = { secretary: 'tech-lead', 'tech-lead': 'developer', developer: 'pm' }

  const limited = bench({ routing: { defaultTarget: 'secretary', allowEmployeeCollaboration: true, maxHops: 1 } })
  limited.useDispatcher((request) => ({ ok: true, text: `${request.employeeId} 处理完了`, handoffTo: handoff[request.employeeId] }))
  await limited.inbound({ conversationId: 'c_open', text: '这事得好几个人接力' })

  assert.deepEqual(limited.dispatched.map((item) => [item.employeeId, item.hop]), [['secretary', 0], ['tech-lead', 1]])
  assert.equal(limited.dispatched.every((item) => item.maxHops === 1), true)
  const limitEvent = limited.events.find((item) => item.type === 'external.handoff.limited')
  assert.ok(limitEvent, '达到上限必须投一条真实事件')
  assert.deepEqual([limitEvent.fromEmployeeId, limitEvent.toEmployeeId, limitEvent.hop, limitEvent.maxHops], ['tech-lead', 'developer', 2, 1])
  assert.match(limited.sent.at(-1).text, /转交已达到上限（1 次），这件事交回秘书跟进/)
  assert.equal(limited.sent.at(-1).kind, 'notice', '这是系统通知，不能冒充某位员工的发言')
  await limited.manager.stop()

  const closed = bench({ routing: { defaultTarget: 'secretary', allowEmployeeCollaboration: false, maxHops: 4 } })
  closed.useDispatcher((request) => ({ ok: true, text: 'ok', handoffTo: handoff[request.employeeId] }))
  await closed.inbound({ conversationId: 'c_open', text: '转给别人吧' })
  assert.deepEqual(closed.dispatched.map((item) => item.employeeId), ['secretary'], '协作没开就一步都不许转')
  assert.equal(closed.sent.length, 1)
  await closed.manager.stop()
})

test('Permission routing: 没有员工运行时就如实说明，绝不编造员工回复', async () => {
  const box = bench()
  assert.equal(box.manager.router.hasDispatcher(), false)

  await box.inbound({ conversationId: 'c_open', text: '有人吗' })
  assert.equal(box.sent.length, 1)
  assert.equal(box.sent[0].kind, 'system', '降级说明不能标成 employee-reply')
  assert.equal(box.sent[0].employeeId, undefined)
  assert.equal(box.sent[0].text, '赛博公司当前没有可用的员工运行时，这条消息已被记录但还没有员工处理。')
  assert.equal(received(box.events).length, 1, '消息本身仍要如实记录下来')
  assert.ok(box.logs.some((line) => /Employee Runtime 未接线/.test(line)))

  // 员工真的跑挂了同样如实转达，不许伪造一句"已处理"
  box.useDispatcher(() => { throw new Error('子代理启动失败') })
  await box.inbound({ conversationId: 'c_open', text: '再试一次' })
  assert.equal(box.sent.at(-1).kind, 'notice')
  assert.match(box.sent.at(-1).text, /没能完成这次处理：子代理启动失败/)
  await box.manager.stop()
})

test('Permission routing: 同一条消息重复投递只处理一次，主动外发只能发到已配置会话', async () => {
  const box = bench()
  box.useDispatcher()

  box.manager.gateway.configOf('probe') // 触达一次，确认渠道已注册
  await box.inbound({ conversationId: 'c_open', text: '第一次' })
  assert.equal(box.dispatched.length, 1)

  // 平台重推同一个 message id（飞书重试很常见）
  const duplicate = { ...received(box.events)[0] }
  await box.inbound({ id: 'msg-1', conversationId: 'c_open', text: '第一次' })
  assert.equal(box.dispatched.length, 1, '重复事件必须被去重，不能让员工干两遍')
  assert.equal(duplicate.messageId, 'msg-1')

  await assert.rejects(
    () => box.manager.send('probe', 'c_not_configured', { text: '群发广告' }),
    /不在 测试渠道 的允许群名单或群绑定里，拒绝发送/,
  )
  assert.equal(await box.manager.send('probe', 'c_open', { text: '正常通知' }), true)
  assert.equal(box.sent.at(-1).text, '正常通知')
  await box.manager.stop()
})
