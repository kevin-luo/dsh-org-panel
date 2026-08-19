// 长期记忆证据：直接验证 Employee Runtime，不再经过已删除的 staff_chat 公共入口。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dshWebStack, realCordisCtx, scratch, settleFiber } from './_helpers.mjs'

const { apply, inject } = await import('../lib/index.js')

function fakeSubagents() {
  const personas = []
  let seq = 0
  return {
    personas,
    service: {
      list: () => ['spawn'],
      getProvider: (name) => (name === 'spawn' ? { name } : undefined),
      async start(_provider, request) {
        seq += 1
        const childId = `child-${seq}`
        personas.push({ childId, label: request.label, persona: String(request.persona || '') })
        return {
          id: childId,
          result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: `第 ${seq} 次任务已完成` }] }),
          async dispose() {},
        }
      },
    },
  }
}

async function boot(name) {
  const dir = await scratch(name)
  const subagents = fakeSubagents()
  const { root, registered } = realCordisCtx({ subagents: subagents.service })
  const web = await dshWebStack(root)
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
  const route = web.routes[0]
  assert.ok(route, '/org-panel 频道必须注册')
  const parent = { session: { id: `sess-${name}` } }
  const signal = new AbortController().signal
  const dispatch = (employeeId, text) => host.core.dispatch({ employeeId, text, source: 'web', channelId: 'memory-test', agent: parent, signal })
  const call = (endpoint, payload = {}) => route.handler(endpoint, payload, signal)
  const tool = (name) => {
    const value = registered.get(name)
    assert.ok(value, `${name} 必须注册`)
    return value
  }
  return { dir, host, fiber, subagents, parent, dispatch, call, tool }
}

async function evidence(ctx, employeeId, childId) {
  const response = await ctx.call('memory/evidence', { employeeId, childId })
  assert.equal(response.ok, true)
  return response.value.injections[0] || null
}

test('Memory Runtime: 第二轮真的注入第一轮沉淀的记忆与复盘', async () => {
  const ctx = await boot('memory-two-turns')
  await ctx.dispatch('developer', '修复登录接口重定向')
  await ctx.tool('staff_reflect').execute({
    staff: 'developer', task: '修复登录接口重定向', outcome: 'success',
    lesson: '修改重定向前先检查 nginx 与应用层配置，避免环境差异。',
  }, { agent: ctx.parent })

  await ctx.dispatch('developer', '继续处理登录链路的回调问题')
  const second = await evidence(ctx, 'developer', 'child-2')
  assert.ok(second, '第二轮必须留下真实注入台账')
  assert.ok(second.items.some((item) => /登录接口重定向|修改重定向/.test(item.text)), '证据里应有第一轮真实历史')
  assert.match(ctx.subagents.personas[1].persona, /修改重定向前先检查 nginx/, '历史复盘必须真的进入第二轮 persona')
  await ctx.fiber.dispose()
})

test('Memory Runtime: 证据里的每个 id 都能在 evolution.json 找到真实条目', async () => {
  const ctx = await boot('memory-ids')
  await ctx.dispatch('developer', '完成一次 API 调试')
  await ctx.tool('staff_reflect').execute({ staff: 'developer', task: 'API 调试', outcome: 'success', lesson: '先复现再改代码。' }, { agent: ctx.parent })
  await ctx.dispatch('developer', '再检查一次 API')
  const view = await evidence(ctx, 'developer', 'child-2')
  const raw = JSON.parse(await readFile(join(ctx.dir, 'evolution.json'), 'utf-8'))
  const profile = raw.employees.developer
  const ids = new Set([...(profile.memories || []).map((item) => item.id), ...(profile.reflections || []).map((item) => item.id)])
  assert.ok(view.items.length > 0)
  for (const item of view.items) assert.ok(ids.has(item.id), `证据 ${item.id} 必须来自真实落盘数据`)
  assert.equal(view.missing, 0)
  await ctx.fiber.dispose()
})

test('Memory Runtime: 注入之后才新增的记忆不会穿越进这一轮证据', async () => {
  const ctx = await boot('memory-no-time-travel')
  await ctx.dispatch('developer', '第一轮任务')
  await ctx.dispatch('developer', '第二轮任务')
  const before = await evidence(ctx, 'developer', 'child-2')
  const late = await ctx.host.core.store.remember('developer', { kind: 'fact', text: '这是第二轮结束后才新增的事实', tags: ['late'], importance: 5 })
  const after = await evidence(ctx, 'developer', 'child-2')
  assert.deepEqual(after.injection.memoryIds, before.injection.memoryIds)
  assert.equal(after.items.some((item) => item.id === late.id), false)
  await ctx.fiber.dispose()
})

test('Memory Runtime: 首次任务即使注入 0 条，也只记录真实空台账', async () => {
  const ctx = await boot('memory-empty-evidence')
  await ctx.dispatch('recruiter', '第一次帮我看招聘流程')
  const view = await evidence(ctx, 'recruiter', 'child-1')
  assert.ok(view)
  assert.equal(view.injection.memoryIds.length, 0)
  assert.equal(view.injection.reflectionIds.length, 0)
  assert.deepEqual(view.items, [])
  await ctx.fiber.dispose()
})

test('Memory Runtime: memory/page 真分页，不一次把全部记忆塞给前端', async () => {
  const ctx = await boot('memory-pagination')
  for (let i = 0; i < 25; i += 1) {
    await ctx.host.core.store.remember('developer', { kind: 'fact', text: `分页记忆 ${String(i).padStart(2, '0')}`, importance: 3 })
  }
  const first = await ctx.call('memory/page', { employeeId: 'developer', offset: 0, limit: 10 })
  const second = await ctx.call('memory/page', { employeeId: 'developer', offset: 10, limit: 10 })
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(first.value.items.length, 10)
  assert.equal(second.value.items.length, 10)
  assert.equal(first.value.total, 25)
  assert.equal(first.value.hasMore, true)
  assert.equal(second.value.offset, 10)
  assert.equal(new Set([...first.value.items, ...second.value.items].map((item) => item.id)).size, 20)
  await ctx.fiber.dispose()
})

test('Memory Runtime: /org-panel 只认真实员工，未知 employeeId 不会凭空建档', async () => {
  const ctx = await boot('memory-rpc-guard')
  const ok = await ctx.call('memory/page', { employeeId: 'developer', limit: 1 })
  assert.equal(ok.ok, true)
  const bad = await ctx.call('memory/page', { employeeId: 'ghost', limit: 1 })
  assert.equal(bad.ok, false)
  assert.match(bad.error.message, /名册里没有 ghost/)
  const snapshot = await ctx.host.core.snapshot()
  assert.equal(snapshot.employees.some((item) => item.employeeId === 'ghost'), false)
  await ctx.fiber.dispose()
})
