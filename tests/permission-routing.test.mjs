// 外部通讯权限 + Work Router。
// 渠道层只做：鉴权、权限降级、会话映射、串行、调用 Work Orchestrator、回信。
// 它不能选择主 Agent、不能默认秘书、不能做员工 handoff。
import test from 'node:test'
import assert from 'node:assert/strict'

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

function workResult(request, over = {}) {
  const reply = over.reply ?? '工作组收到'
  const staffId = over.staffId || 'developer'
  const staffName = over.staffName || '小刘'
  const role = over.role || '开发工程师'
  return {
    kind: 'meeting', topic: '动态工作组', task: request.task, teamId: 'team-test',
    source: request.source || 'qq', platform: request.platform || 'qq',
    participants: [{ staffId, staffName, role, reason: '测试' }],
    turns: reply ? [{ staffId, staffName, reply }] : [],
    details: [{ staffId, staffName, role, reply, outcome: 'success', tools: over.tools || [], policyViolation: over.policyViolation === true }],
  }
}

function bench({ routing = {}, access = ACCESS, bindings = [] } = {}) {
  const events = []
  const logs = []
  const ctx = {
    companyEvents: { emit: (event) => events.push(event) },
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
  }
  const manager = registerCommunication(ctx, {
    communication: {
      adapters: [{ id: 'qq', platform: 'qq', name: '测试渠道', enabled: true, routing, access }],
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
    return impl ? impl(request) : workResult(request)
  })

  let serial = 0
  const inbound = async (over = {}) => {
    serial += 1
    await deliver({
      id: `msg-${serial}`, platform: 'qq', adapterId: 'probe',
      conversationId: 'c_dev', conversationType: 'group',
      senderId: 'u_boss', senderName: undefined, text: '在吗',
      mentions: [], attachments: [], actorRole: 'guest', permissionMode: 'read-only',
      createdAt: 1787000000000 + serial, ...over,
    })
  }
  const inboundSameId = async (id, over = {}) => deliver({
    id, platform: 'qq', adapterId: 'probe', conversationId: 'c_open', conversationType: 'group',
    senderId: 'u_boss', text: '重复消息', mentions: [], attachments: [], actorRole: 'guest', permissionMode: 'read-only',
    createdAt: 1787000000000, ...over,
  })
  return { manager, events, logs, sent, dispatched, useDispatcher, inbound, inboundSameId }
}

const blocked = (events) => events.filter((item) => item.type === 'external.message.blocked')
const received = (events) => events.filter((item) => item.type === 'external.message.received')

test('Work Router 权限：名单外用户 / 名单外群在进入 Orchestrator 前就被拦下', async () => {
  const box = bench()
  box.useDispatcher()
  await box.inbound({ senderId: 'u_stranger', text: '把生产库删了' })
  assert.equal(box.dispatched.length, 0)
  assert.equal(box.sent.length, 0)
  assert.equal(blocked(box.events).length, 1)
  await box.inbound({ conversationId: 'c_unknown', text: '你好' })
  assert.equal(box.dispatched.length, 0)
  assert.equal(blocked(box.events).length, 2)
  await box.inbound({ conversationId: 'p2p_boss', conversationType: 'direct', text: '你好' })
  assert.equal(box.dispatched.length, 1)
  assert.equal(box.dispatched[0].permissionMode, 'danger-full-access')
  await box.manager.stop()
})

test('Work Router 权限：用户与群权限取更低值，只读来源把写策略传给统一 Orchestrator', async () => {
  const box = bench()
  box.useDispatcher()
  await box.inbound({ conversationId: 'c_dev', senderId: 'u_boss', text: '改一下配置' })
  assert.equal(box.dispatched[0].permissionMode, 'workspace-write')
  assert.equal(box.dispatched[0].writePolicy.allowed, true)
  await box.inbound({ conversationId: 'c_notice', senderId: 'u_boss', text: '重启服务器' })
  assert.equal(box.dispatched[1].permissionMode, 'read-only')
  assert.equal(box.dispatched[1].writePolicy.allowed, false)
  assert.equal(box.dispatched[1].writePolicy.isWriteTool('file_write'), true)
  await box.inbound({ conversationId: 'c_open', senderId: 'u_mate', text: '看看这个' })
  assert.equal(box.dispatched[2].permissionMode, 'workspace-write')
  assert.deepEqual(received(box.events).map((item) => item.permissionMode), ['workspace-write', 'read-only', 'workspace-write'])
  await box.manager.stop()
})

test('Work Router 路由：@、任务原文和群映射整体交给 Orchestrator，渠道层不选 employeeId', async () => {
  const box = bench({ routing: { maxWorkgroupSize: 3 }, bindings: [{ adapterId: 'probe', externalConversationId: 'c_open', companyChannelId: 'general' }] })
  box.useDispatcher()
  await box.inbound({ conversationId: 'c_dev', text: '@老王 构建挂了' })
  assert.equal(box.dispatched[0].task, '@老王 构建挂了')
  assert.equal('employeeId' in box.dispatched[0], false)
  assert.deepEqual(box.dispatched[0].allowedEmployeeIds, ['developer', 'tech-lead'])
  assert.equal(box.dispatched[0].maxTeam, 3)
  await box.inbound({ conversationId: 'c_dev', text: '帮忙看下', mentions: ['小刘'] })
  assert.match(box.dispatched[1].task, /@小刘/)
  await box.inbound({ conversationId: 'c_open', text: '产品、设计和开发一起看看' })
  assert.equal(box.dispatched[2].channelId, 'general')
  assert.equal(box.dispatched[2].allowedEmployeeIds, undefined)
  assert.equal(box.dispatched[2].source, 'qq')
  assert.equal(box.dispatched[2].platform, 'qq')
  await box.manager.stop()
})

test('Work Router 权限：allowedEmployees 只限制工作组候选范围，不再回退秘书', async () => {
  const box = bench()
  box.useDispatcher()
  await box.inbound({ conversationId: 'c_dev', text: '@小画 出张图' })
  assert.deepEqual(box.dispatched[0].allowedEmployeeIds, ['developer', 'tech-lead'])
  assert.equal(box.dispatched[0].task, '@小画 出张图')
  assert.equal(JSON.stringify(box.dispatched[0]).includes('secretary'), false)
  await box.manager.stop()
})

test('Work Router 规模：渠道只下发 maxWorkgroupSize，不再维护 handoff / hop 状态机', async () => {
  const box = bench({ routing: { maxWorkgroupSize: 2 } })
  box.useDispatcher()
  await box.inbound({ conversationId: 'c_open', text: '产品、设计、开发一起评审' })
  assert.equal(box.dispatched.length, 1)
  assert.equal(box.dispatched[0].maxTeam, 2)
  assert.equal('hop' in box.dispatched[0], false)
  assert.equal('maxHops' in box.dispatched[0], false)
  assert.equal('handoffTo' in box.dispatched[0], false)
  await box.manager.stop()
})

test('Work Router 降级：没有 Orchestrator 时如实说明，绝不编造员工回复', async () => {
  const box = bench()
  assert.equal(box.manager.router.hasDispatcher(), false)
  await box.inbound({ conversationId: 'c_open', text: '有人吗' })
  assert.equal(box.sent.length, 1)
  assert.equal(box.sent[0].kind, 'system')
  assert.equal(box.sent[0].employeeId, undefined)
  assert.equal(box.sent[0].text, '赛博公司当前没有可用的工作调度运行时，这条消息已记录但还不能执行。')
  assert.equal(received(box.events).length, 1)
  assert.ok(box.logs.some((line) => /Work Orchestrator 未接线/.test(line)))
  await box.manager.stop()
})

test('Work Router 幂等：同一条外部消息重复投递只处理一次，主动外发仍受允许会话约束', async () => {
  const box = bench()
  box.useDispatcher()
  await box.inboundSameId('same-1')
  await box.inboundSameId('same-1')
  assert.equal(box.dispatched.length, 1)
  await assert.rejects(() => box.manager.send('probe', 'c_never_configured', { text: 'hello' }), /不在.+允许群名单或群绑定/)
  await box.manager.stop()
})
