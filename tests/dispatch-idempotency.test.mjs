// 一条老板消息 → 一条履历（需求文档第五章：派活即开单，真实结束才结单）。
//
// 这一组守的是另一个只有接上真实 LLM 才会暴露的洞。真机实录（~/.dsh/sessions，glm-5.2）：
//   turn 3 / step 1  秘书调 staff_chat(developer, M) 与 staff_chat(platform, N)  → 各开一条履历
//   turn 3 / step 2  两个子代理都 "failed before it finished"，宿主拿不到任何结束信号
//   turn 3 / step 3  秘书说「我重新把两个任务分别再发一次」，把**一模一样**的原话又派了一遍
// 于是 evolution.json 里每个人两条履历：前一条被 settlePending 硬判成 partial，
// 后一条 completedAt=None、summary=None，永远挂着结不掉，statistics.totalTasks 也只认得前一条。
//
// 根因不是 startContinuable / followup 各开了一次单（两条分支互斥、各自 return），
// 而是**模型真的调了两次工具**，而 staff_chat 每次调用都无条件 openTask —— 系统没有幂等能力。
//
// 底线同时守住：拿不到真实结束信号时照旧如实记 partial 且写明「成败未知」，绝不谎报 success，
// 也绝不为了消重复而不写履历。
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { scratch, settle } from './_helpers.mjs'

const { apply } = await import('../lib/index.js')

const EXTRA_TOOLS = [{ name: 'file_write', description: '写文件' }]

/**
 * 装一套真 host，subagents 走**持续会话**分支且**不回传任何结束信号** ——
 * 这正是真实 DSH 的形态：startContinuable 只回 { childId, messageId }，
 * followup 只回一个 MessageId，handle 上根本没有 result/settled 这类 thenable。
 */
async function bench(name) {
  const dir = await scratch(name)
  const registered = new Map()
  const logs = []
  const children = []
  const followups = []
  const started = []

  const subagents = {
    list: () => ['spawn'],
    getProvider: (provider) => (provider === 'spawn' ? { name: provider, prepareContinuable() {} } : undefined),
    async start() { throw new Error('本组用例只走持续会话分支') },
    async listChildren() { return children },
    async startContinuable({ label }) {
      const childId = `child-${children.length + 1}`
      children.push({ id: childId, kind: 'child', mode: 'continuable', label })
      started.push({ childId, label })
      return { childId, messageId: `msg-${started.length}` }
    },
    async followup(_parent, childId, blocks) {
      followups.push({ childId, text: blocks.map((block) => block.text).join('') })
      return `msg-followup-${followups.length}`
    },
  }

  const ctx = {
    tools: {
      register(tool) { registered.set(tool.name, tool) },
      list() { return [...registered.values()].map((item) => ({ name: item.name, description: item.description })).concat(EXTRA_TOOLS) },
    },
    subagents,
    systemPrompt: { section() {} },
    logger: {
      info: (message) => logs.push(['info', String(message)]),
      warn: (message) => logs.push(['warn', String(message)]),
      error: (message) => logs.push(['error', String(message)]),
      debug: () => {},
    },
    on() {},
  }

  const host = apply(ctx, {
    memoryFile: join(dir, 'evolution.json'),
    companyFile: join(dir, 'company.json'),
    approvalsFile: join(dir, 'plugin-approvals.json'),
    healthCheckOnStart: false,
  })
  assert.ok(host, 'host 应当装配成功')
  return { host, logs, followups, started, subagents, tool: (name) => registered.get(name) }
}

const EXEC = { agent: { session: { id: 'main-session' } } }
/** 真机那条老板原话，一个字都不改。 */
const BOSS_MESSAGE = '@小刘 一句话说明 tsdown.config.ts 里 client 为什么要单独打成 cjs'

/** 一条履历是否还挂着（completedAt 没落地）。 */
const dangling = (rows) => rows.filter((item) => !item.completedAt)

test('履历幂等：同一条老板消息被模型重复派活，只留一条履历，不产生悬空记录', async () => {
  const { host, followups, started, logs, tool } = await bench('repeat-dispatch')
  const staffChat = tool('staff_chat')

  // step 1：秘书第一次派活 —— 建持续会话。
  await staffChat.execute({ staff: 'developer', message: BOSS_MESSAGE }, EXEC)
  await settle(20)
  // step 3：子代理没有任何结束信号，秘书把一模一样的原话又派了一遍。
  await staffChat.execute({ staff: 'developer', message: BOSS_MESSAGE }, EXEC)
  await settle(20)

  const rows = await host.core.store.tasks('developer')
  assert.equal(rows.length, 1, '一条老板消息只能有一条履历（旧实现在这里会是 2 条）')
  assert.equal(dangling(rows).length, 1, '这一条本来就还没结束，挂着是对的')
  assert.equal(rows[0].title.includes('tsdown.config.ts'), true)
  assert.equal(rows[0].summary, undefined, '没结单就不许有摘要')

  // 重发这件事真实发生过：消息照常投递，不许为了消重复把老板的话吞掉。
  assert.equal(started.length, 1, '第二次不该再建一个新的持续会话')
  assert.equal(followups.length, 1, '第二次必须真的把原话再投递一次')
  assert.match(followups[0].text, /tsdown\.config\.ts/)
  assert.ok(logs.some(([, message]) => /重复派活/.test(message)), '重复派活必须留下可查的日志')

  // 统计不许因为重复调用而虚增，也不许凭空判成功。
  const stats = await host.core.store.statistics('developer')
  assert.equal(stats.successCount, 0, '一个结束信号都没有，绝不能计成功')
  assert.equal(stats.totalTasks, 0, '还没结单就不该计入累计任务')
})

test('履历幂等：重复三次也还是一条履历，绝不越派越多', async () => {
  const { host, tool } = await bench('repeat-dispatch-x3')
  const staffChat = tool('staff_chat')
  for (let round = 0; round < 3; round++) {
    await staffChat.execute({ staff: 'developer', message: BOSS_MESSAGE }, EXEC)
    await settle(15)
  }
  const rows = await host.core.store.tasks('developer')
  assert.equal(rows.length, 1)
  assert.equal(dangling(rows).length, 1, '悬空的只能是这一条进行中的，不许再多一条')
})

test('履历幂等：换成新任务照旧开新单，上一轮如实记 partial 并写明成败未知', async () => {
  const { host, tool } = await bench('repeat-then-new')
  const staffChat = tool('staff_chat')

  await staffChat.execute({ staff: 'developer', message: BOSS_MESSAGE }, EXEC)
  await settle(15)
  await staffChat.execute({ staff: 'developer', message: BOSS_MESSAGE }, EXEC)
  await settle(15)
  // 真的换了一条新任务 ⇒ 上一轮确实结束了，但宿主观测不到成败。
  await staffChat.execute({ staff: 'developer', message: '@小刘 再顺手把 README 的构建段落更一下' }, EXEC)
  await settle(20)

  const rows = await host.core.store.tasks('developer')
  assert.equal(rows.length, 2, '两条老板消息 = 两条履历，不多不少')
  const first = rows.find((item) => item.title.includes('tsdown.config.ts'))
  const second = rows.find((item) => item.title.includes('README'))
  assert.equal(first.outcome, 'partial', '拿不到结束信号只能记 partial')
  assert.match(first.summary, /成败未知/, '摘要必须写明成败未知，不许谎报成功')
  assert.ok(first.completedAt > 0, '上一轮确实结束了，履历必须结掉')
  assert.equal(dangling(rows).length, 1, '只有正在进行的那一条挂着')
  assert.equal(second.completedAt, undefined)
  assert.equal((await host.core.store.statistics('developer')).successCount, 0)
})

test('履历幂等：真机那一轮双人派活复刻 —— 两个人各自只有一条履历', async () => {
  const { host, tool } = await bench('real-trace-two-staff')
  const staffChat = tool('staff_chat')
  const devMessage = BOSS_MESSAGE
  const platformMessage = '@大壮 去 DSH 插件市场搜索适合当前团队的新能力，列出用途、风险、仓库和安装命令；不要安装。'

  // step 1：一个 step 里两条 staff_chat。
  await staffChat.execute({ staff: 'developer', message: devMessage }, EXEC)
  await staffChat.execute({ staff: 'platform', message: platformMessage }, EXEC)
  await settle(20)
  // step 3：两条原话又整轮重发了一次。
  await staffChat.execute({ staff: 'developer', message: devMessage }, EXEC)
  await staffChat.execute({ staff: 'platform', message: platformMessage }, EXEC)
  await settle(20)

  for (const employeeId of ['developer', 'platform']) {
    const rows = await host.core.store.tasks(employeeId)
    assert.equal(rows.length, 1, `${employeeId} 应当只有一条履历（真机上是 2 条）`)
    assert.equal(dangling(rows).length, 1)
    assert.equal(rows[0].summary, undefined, '不许出现「子代理已接受下一轮任务」这种事实上没发生的结论')
  }
})

test('履历幂等：重复派活时投递失败，履历要如实结成 failed，不许再挂着', async () => {
  const { host, tool, subagents } = await bench('repeat-dispatch-failure')
  const staffChat = tool('staff_chat')
  await staffChat.execute({ staff: 'developer', message: BOSS_MESSAGE }, EXEC)
  await settle(15)

  subagents.followup = async () => { throw new Error('通道已断') }
  await assert.rejects(staffChat.execute({ staff: 'developer', message: BOSS_MESSAGE }, EXEC), /通道已断/)
  await settle(20)

  const rows = await host.core.store.tasks('developer')
  assert.equal(rows.length, 1, '还是同一条履历')
  assert.equal(rows[0].outcome, 'failed')
  assert.match(rows[0].summary, /派活失败/)
  assert.equal(dangling(rows).length, 0, '派不出去就没有这次工作，不能永远挂在进行中')
})
