import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { scratch } from './_helpers.mjs'
import { WorkSessionStore, registerWorkOrchestrator } from '../lib/index.js'

function employee(id, name, role, capabilities = [], aliases = []) {
  return { id, name, role, brief: `${role}负责相关工作`, capabilities, aliases, preferredToolHints: [] }
}

const STAFF = [
  employee('secretary', '秘书', '总裁秘书', ['行政', '会议安排'], ['秘书']),
  employee('developer', '小刘', '程序员', ['开发', '修复', '测试'], ['小刘', '开发']),
  employee('pm', '阿明', '产品经理', ['需求', '产品'], ['阿明', '产品']),
]

test('WorkSessionStore: 来源、消息、参与者和员工 turn 重启后完整读回', async () => {
  const dir = await scratch('work-session-persist')
  const file = join(dir, 'work-sessions.json')
  const store = new WorkSessionStore(file)
  const session = await store.open({
    key: 'qq:c_dev:thread-1', goal: '修复登录问题', source: 'qq', platform: 'qq', channelId: 'engineering',
    conversationId: 'c_dev', threadId: 'thread-1', senderId: 'u_boss', senderName: '老板', messageId: 'msg-1', messageText: '修复登录问题',
  })
  await store.join(session.id, { employeeId: 'developer', employeeName: '小刘', role: '程序员', reason: '工程实现' })
  await store.appendTurn(session.id, { employeeId: 'developer', employeeName: '小刘', role: '程序员', reply: '已定位并修复。', outcome: 'success', taskId: 'task-1', tools: ['grep', 'edit'], policyViolation: false })

  const reopened = new WorkSessionStore(file)
  const row = await reopened.getByKey('qq:c_dev:thread-1')
  assert.ok(row)
  assert.equal(row.id, session.id)
  assert.equal(row.origin.platform, 'qq')
  assert.equal(row.origin.conversationId, 'c_dev')
  assert.equal(row.origin.threadId, 'thread-1')
  assert.equal(row.origin.senderId, 'u_boss')
  assert.equal(row.messages[0].messageId, 'msg-1')
  assert.equal(row.participants[0].employeeId, 'developer')
  assert.equal(row.turns[0].taskId, 'task-1')
  assert.deepEqual(row.turns[0].tools, ['grep', 'edit'])
})

test('WorkSessionStore: 同一平台 messageId 重投不复制老板消息', async () => {
  const dir = await scratch('work-session-dedup')
  const store = new WorkSessionStore(join(dir, 'work-sessions.json'))
  await store.open({ key: 'qq:c1:main', goal: 'A', source: 'qq', platform: 'qq', conversationId: 'c1', messageId: 'same', messageText: '第一条' })
  await store.open({ key: 'qq:c1:main', goal: 'A', source: 'qq', platform: 'qq', conversationId: 'c1', messageId: 'same', messageText: '第一条' })
  const row = await store.getByKey('qq:c1:main')
  assert.equal(row.messages.length, 1)
})

test('Work Orchestrator: 同一会话跨轮复用稳定 teamId，第二轮看到第一轮真实公开输出', async () => {
  const dir = await scratch('work-session-orchestrator')
  const dispatches = []
  let serial = 0
  const core = {
    employees: STAFF,
    bindAgent() {},
    async dispatch(input) {
      serial += 1
      dispatches.push(input)
      return { ok: true, employeeId: input.employeeId, employeeName: '小刘', reply: serial === 1 ? '第一轮：登录 bug 已定位。' : '第二轮继续处理。', tools: ['grep'], outcome: 'success', taskId: `task-${serial}` }
    },
  }
  const registered = new Map()
  const ctx = {
    tools: { register(tool) { registered.set(tool.name, tool) } },
    systemPrompt: { section() {} },
  }
  const orchestrator = registerWorkOrchestrator(ctx, core, { sessionFile: join(dir, 'work-sessions.json') })
  const first = await orchestrator.run({ task: '@小刘 修复登录 bug', source: 'qq', platform: 'qq', conversationId: 'c_dev', messageId: 'm1', senderId: 'boss', senderName: '老板', allowedEmployeeIds: ['developer'] })
  const second = await orchestrator.run({ task: '继续把边界情况补完', source: 'qq', platform: 'qq', conversationId: 'c_dev', messageId: 'm2', senderId: 'boss', senderName: '老板', allowedEmployeeIds: ['developer'] })

  assert.equal(first.teamId, second.teamId, '同一外部会话必须复用同一个持久工作组')
  assert.equal(dispatches.length, 2)
  assert.equal(dispatches[0].taskTitle, '@小刘 修复登录 bug', '个人履历标题应当拿老板原话')
  assert.equal(dispatches[1].taskTitle, '继续把边界情况补完')
  assert.match(dispatches[1].text, /第一轮：登录 bug 已定位/, '第二轮必须真实注入前一轮公开协作上下文')
  assert.doesNotMatch(dispatches[1].taskTitle, /赛博公司持久工作组/)

  const session = await orchestrator.sessions.get(first.teamId)
  assert.equal(session.messages.length, 2)
  assert.equal(session.turns.length, 2)
  assert.deepEqual(session.turns.map((item) => item.taskId), ['task-1', 'task-2'])
})

test('WorkSessionStore: 文件损坏时 fail-closed，不用空文件覆盖历史', async () => {
  const dir = await scratch('work-session-corrupt')
  const file = join(dir, 'work-sessions.json')
  const raw = '{"version":1,"sessions":{"qq:c1":'
  await writeFile(file, raw, 'utf-8')
  const store = new WorkSessionStore(file)
  await assert.rejects(() => store.open({ key: 'qq:c1:main', goal: '新任务', source: 'qq', platform: 'qq', conversationId: 'c1' }), /拒绝写入/)
})
