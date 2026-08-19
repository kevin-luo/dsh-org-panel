import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { planWorkgroup, requestedPeers, apply, inject, COMPANY_WORK_TOOL } from '../lib/index.js'
import { realCordisCtx, scratch, settleFiber } from './_helpers.mjs'

function employee(id, name, role, capabilities = [], aliases = []) {
  return { id, name, role, brief: `${role}负责相关工作`, capabilities, aliases, preferredToolHints: [] }
}

const STAFF = [
  employee('secretary', '秘书', '总裁秘书', ['组织调度', '会议召集'], ['秘书', '助理']),
  employee('tech-lead', '老王', '技术经理', ['架构', '技术评审'], ['老王', '技术经理']),
  employee('developer', '小刘', '程序员', ['前后端开发', '调试', '测试'], ['小刘', '程序员', '开发']),
  employee('pm', '阿明', '产品经理', ['需求分析', 'PRD', '产品决策'], ['阿明', '产品经理', '产品']),
  employee('image-creator', '小画', '视觉设计师', ['生图', '改图', '品牌视觉'], ['小画', '视觉设计师']),
  employee('social-editor', '柚子', '自媒体主编', ['内容策划', '多平台创作'], ['柚子', '自媒体主编']),
  employee('growth', '小麦', '增长运营', ['增长运营', '渠道实验'], ['小麦', '增长运营']),
]

test('Work Orchestrator: 代码任务激活开发员工，秘书不再拥有通用兜底权', () => {
  const plan = planWorkgroup('修复登录接口的 bug，并跑完测试', STAFF, { maxTeam: 3 })
  assert.ok(plan.members.some((item) => item.employeeId === 'developer'))
  assert.ok(!plan.members.some((item) => item.employeeId === 'secretary'))
})

test('Work Orchestrator: 跨岗位任务自动组成临时工作组', () => {
  const plan = planWorkgroup('先做这个 App 的界面设计，再实现前端，并给出产品验收方案', STAFF, { maxTeam: 4 })
  const ids = plan.members.map((item) => item.employeeId)
  assert.ok(ids.includes('image-creator'))
  assert.ok(ids.includes('developer'))
  assert.ok(ids.includes('pm'))
  assert.equal(plan.mode, 'team')
})

test('Work Orchestrator: 明确 @ 员工锁定本人，复杂任务仍可自动补相关同事', () => {
  const plan = planWorkgroup('@小画 设计角色形象，并考虑后续短视频传播方案', STAFF, { maxTeam: 3 })
  assert.equal(plan.members[0].employeeId, 'image-creator')
  assert.equal(plan.members[0].explicit, true)
  assert.ok(plan.members.some((item) => ['social-editor', 'growth'].includes(item.employeeId)))
})

test('Work Orchestrator: 秘书只在行政 / 日程任务里作为普通岗位被激活', () => {
  const plan = planWorkgroup('帮我安排明天下午的会议日程，并通知参会人', STAFF, { maxTeam: 3 })
  assert.equal(plan.members[0].employeeId, 'secretary')
  assert.ok(plan.members[0].reasons.some((item) => item.includes('行政')))
})

test('Work Orchestrator: 授权员工池会真实限制候选，不存在越权后回退秘书', () => {
  const plan = planWorkgroup('@小画 出张产品视觉图', STAFF, { maxTeam: 3, allowedEmployeeIds: ['developer', 'tech-lead'] })
  assert.ok(plan.members.length > 0)
  assert.equal(plan.members.every((item) => ['developer', 'tech-lead'].includes(item.employeeId)), true)
  assert.equal(plan.members.some((item) => item.employeeId === 'secretary'), false)
})

test('Work Orchestrator: 员工公开 @ 同事可以触发动态入场', () => {
  const peers = requestedPeers('角色方案我先定了。@小麦 看一下传播切入点，同时需要小画补一版视觉。', STAFF)
  const ids = peers.map((item) => item.id)
  assert.ok(ids.includes('growth'))
  assert.ok(ids.includes('image-creator'))
})

test('真实 host: company_work 是唯一业务协作入口，旧 staff_chat / staff_meeting 不再注册', async () => {
  const dir = await scratch('work-orchestrator-host')
  const { root, registered } = realCordisCtx()
  let host
  const fiber = root.plugin({
    name: 'dsh-org-panel', inject,
    apply(ctx, cfg) { host = apply(ctx, cfg); return host },
  }, {
    memoryFile: join(dir, 'evolution.json'),
    companyFile: join(dir, 'company.json'),
    approvalsFile: join(dir, 'plugin-approvals.json'),
    healthCheckOnStart: false,
  })
  await settleFiber(fiber)
  assert.equal(fiber.state, 2)
  assert.ok(host?.orchestrator)
  assert.ok(registered.has(COMPANY_WORK_TOOL))
  assert.equal(registered.has('staff_chat'), false)
  assert.equal(registered.has('staff_meeting'), false)
  await fiber.dispose()
})
