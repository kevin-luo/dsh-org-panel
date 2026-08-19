import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { scratch } from './_helpers.mjs'

const { WorkSessionStore, readEndpoints } = await import('../lib/index.js')

async function fixture(name) {
  const dir = await scratch(name)
  const sessions = new WorkSessionStore(join(dir, 'work-sessions.json'))
  const core = {
    store: { filePath: join(dir, 'evolution.json') },
    company: { filePath: join(dir, 'company.json'), modelProviderSummaries: async () => [] },
    roster: [],
    snapshot: async () => ({ generatedAt: 1, totals: { employees: 0, tasks: 0, success: 0, failed: 0, blocked: 0, memories: 0, skills: 0, plugins: 0, xp: 0 } }),
  }
  return { dir, sessions, core, endpoints: readEndpoints({ core, orchestrator: { sessions } }) }
}

test('/org-panel work/sessions：空 Session 也能读取 host 上持久工作组摘要', async () => {
  const { sessions, endpoints } = await fixture('work-session-rpc-list')
  const first = await sessions.open({ key: 'wechat:chat-a:main', goal: '优化产品首页', source: 'wechat', platform: 'wechat', conversationId: 'chat-a', senderId: 'u1', senderName: '客户A', messageId: 'm1', messageText: '优化产品首页' })
  await sessions.join(first.id, { employeeId: 'pm', employeeName: '阿明', role: '产品经理', reason: '产品方案' })
  await sessions.appendTurn(first.id, { employeeId: 'pm', employeeName: '阿明', role: '产品经理', reply: '先收敛首屏信息层级。', outcome: 'success', taskId: 'task-1', tools: [], policyViolation: false })
  await sessions.open({ key: 'qq:chat-b:main', goal: '修复接口', source: 'qq', platform: 'qq', conversationId: 'chat-b', messageId: 'm2', messageText: '修复接口' })

  const value = await endpoints['work/sessions']({ limit: 10 })
  assert.equal(value.available, true)
  assert.equal(value.sessions.length, 2)
  const row = value.sessions.find((item) => item.id === first.id)
  assert.equal(row.goal, '优化产品首页')
  assert.equal(row.currentTask, '优化产品首页')
  assert.equal(row.origin.platform, 'wechat')
  assert.equal(row.participants[0].employeeId, 'pm')
  assert.equal(row.turnCount, 1)
  assert.equal(row.lastTurn.taskId, 'task-1')
})

test('/org-panel work/session：按 id / key 能读到完整 provenance、消息和员工交付', async () => {
  const { sessions, endpoints } = await fixture('work-session-rpc-one')
  const opened = await sessions.open({ key: 'feishu:c1:t1', goal: '发布 2.0', source: 'feishu', platform: 'feishu', channelId: 'growth', conversationId: 'c1', threadId: 't1', senderId: 'boss', senderName: '老板', messageId: 'msg-1', messageText: '发布 2.0' })
  await sessions.join(opened.id, { employeeId: 'growth', employeeName: '小麦', role: '增长运营', reason: '增长运营' })
  await sessions.appendTurn(opened.id, { employeeId: 'growth', employeeName: '小麦', role: '增长运营', reply: '发布渠道已整理。', outcome: 'success', taskId: 'task-growth', tools: ['search'], policyViolation: false })

  const byId = await endpoints['work/session']({ id: opened.id })
  const byKey = await endpoints['work/session']({ key: 'feishu:c1:t1' })
  for (const value of [byId, byKey]) {
    assert.equal(value.available, true)
    assert.equal(value.session.origin.threadId, 't1')
    assert.equal(value.session.origin.senderId, 'boss')
    assert.equal(value.session.messages[0].messageId, 'msg-1')
    assert.equal(value.session.turns[0].taskId, 'task-growth')
    assert.deepEqual(value.session.turns[0].tools, ['search'])
  }
})

test('/org-panel storage/inventory：work-sessions.json 是一等持久化数据文件', async () => {
  const { dir, sessions, core, endpoints } = await fixture('work-session-rpc-storage')
  await writeFile(core.store.filePath, '{}', 'utf8')
  await writeFile(core.company.filePath, '{}', 'utf8')
  await sessions.open({ key: 'web:s1:main', goal: '测试持久化', source: 'web', platform: 'web', conversationId: 's1', messageText: '测试持久化' })

  const value = await endpoints['storage/inventory']({})
  const row = value.files.find((item) => item.key === 'work-sessions')
  assert.ok(row)
  assert.equal(row.path, sessions.filePath)
  assert.equal(row.exists, true)
  assert.ok(row.bytes > 0)
})
