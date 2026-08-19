import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { planTaskTeam, requestedPeers, apply, inject, COMPANY_WORK_TOOL } from '../lib/index.js'
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

test('代码任务默认路由开发员工，不再由秘书接管', () => {
  const plan = planTaskTeam('修复登录接口的 bug，并跑完测试', STAFF, 3)
  assert.ok(plan.members.some((item) => item.employeeId === 'developer'))
  assert.ok(!plan.members.some((item) => item.employeeId === 'secretary'), '普通工程任务不应把秘书拉进工作组')
})

test('跨岗位任务自动组成临时工作组', () => {
  const plan = planTaskTeam('先做这个 App 的界面设计，再实现前端，并给出产品验收方案', STAFF, 4)
  const ids = plan.members.map((item) => item.employeeId)
  assert.ok(ids.includes('image-creator'), '界面设计应激活视觉设计师')
  assert.ok(ids.includes('developer'), '前端实现应激活程序员')
  assert.ok(ids.includes('pm'), '产品验收方案应激活产品经理')
  assert.equal(plan.mode, 'team')
})

test('明确 @ 员工会锁定本人，复杂任务仍可自动补相关同事', () => {
  const plan = planTaskTeam('@小画 设计角色形象，并考虑后续短视频传播方案', STAFF, 3)
  assert.equal(plan.members[0].employeeId, 'image-creator')
  assert.equal(plan.members[0].explicit, true)
  assert.ok(plan.members.some((item) => ['social-editor', 'growth'].includes(item.employeeId)))
})

test('秘书只在行政/日程任务里作为普通岗位被激活', () => {
  const plan = planTaskTeam('帮我安排明天下午的会议日程，并通知参会人', STAFF, 3)
  assert.equal(plan.members[0].employeeId, 'secretary')
  assert.ok(plan.members[0].reasons.some((item) => item.includes('行政')))
})

test('员工公开 @ 同事可以触发动态入场', () => {
  const peers = requestedPeers('角色方案我先定了。@小麦 看一下传播切入点，同时需要小画补一版视觉。', STAFF)
  const ids = peers.map((item) => item.id)
  assert.ok(ids.includes('growth'))
  assert.ok(ids.includes('image-creator'))
})

test('真实 host 装载后 company_work 注册并成为独立能力层', async () => {
  const dir = await scratch('team-runtime-host')
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
  assert.ok(host?.team, 'Task Team Runtime 必须挂到 host 句柄')
  assert.ok(registered.has(COMPANY_WORK_TOOL), 'company_work 必须真实进入 Tool Registry')
  await fiber.dispose()
})
