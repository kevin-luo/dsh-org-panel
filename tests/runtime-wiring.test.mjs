// 运行时接线（需求文档第五章 / Phase 6 / 6.1 + 五十八条工程质量要求）。
//
// 这一组用例专门守住「编译过但端到端不可达」的三个空壳：
//   1. TaskHistory 在生产代码里根本没有写入者 —— 员工档案的累计任务恒为 0；
//   2. EmployeeDispatcher 从未注入 —— 任何真实飞书消息都只会收到「没有可用的员工运行时」；
//   3. staff_skill_learn 的 success 是模型自述裸布尔 —— 连调十几次就能自刷等级。
// 外加两条数据安全线：损坏的 evolution.json 不许被静默覆盖，插件绑定不许默认 available。
//
// 做法：用真实 apply()（host-v3）装配整套 host，只把 DSH 自己的 subagents / tools / systemPrompt
// 换成可观测的假服务，走的是和线上完全一样的
// staff_chat → subagents.start → result.stopReason → TaskHistory 这条链，不另写一套模拟。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, chmod, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { scratch, settle } from './_helpers.mjs'

const { apply, EvolutionStore } = await import('../lib/index.js')

/** 除公司自己那 9 个内部工具外，Tool Registry 里真实存在的外部工具。 */
const EXTRA_TOOLS = [{ name: 'sd_generate', description: '出图' }, { name: 'file_write', description: '写文件' }]

/**
 * 装一套真 host。
 * plan(options) 决定每次 subagents.start 返回什么真实结果 —— stopReason / isError / 工具块全部可控，
 * 这正是「outcome 必须来自真实执行结果」要验证的东西。
 */
async function bench(name, { plan, communication, continuable } = {}) {
  const dir = await scratch(name)
  const registered = new Map()
  const logs = []
  const starts = []
  const children = []
  const followups = []
  let serial = 0

  const subagents = {
    list: () => ['spawn'],
    // 没有 prepareContinuable 时走一次性前台子代理分支，宿主能直接拿到真实 stopReason。
    getProvider: (provider) => (provider === 'spawn' ? (continuable ? { name: provider, prepareContinuable() {} } : { name: provider }) : undefined),
    async start(provider, options) {
      serial += 1
      starts.push({ provider, options })
      const result = plan ? plan(options, serial) : { stopReason: 'completed', output: [{ type: 'text', text: '好的，已处理。' }] }
      return { id: `run-${serial}`, result: Promise.resolve(result), async dispose() {} }
    },
  }
  if (continuable) {
    // 持续会话分支：宿主是否回传结束信号（handle.result）由用例决定。
    subagents.listChildren = async () => children
    subagents.startContinuable = async ({ label }) => {
      const childId = `child-${children.length + 1}`
      children.push({ id: childId, kind: 'child', mode: 'continuable', label })
      return continuable.settle ? { childId, result: Promise.resolve(continuable.settle()) } : { childId }
    }
    subagents.followup = async (_parent, childId, blocks) => {
      followups.push({ childId, blocks })
      return continuable.settle ? { result: Promise.resolve(continuable.settle()) } : undefined
    }
  }

  const ctx = {
    logs,
    tools: {
      register(tool) { registered.set(tool.name, tool) },
      list() { return [...registered.values()].map((item) => ({ name: item.name, description: item.description })).concat(EXTRA_TOOLS) },
    },
    subagents,
    systemPrompt: { section() {} },
    logger: {
      info: (message) => logs.push(['info', message]),
      warn: (message) => logs.push(['warn', message]),
      error: (message) => logs.push(['error', message]),
      debug: () => {},
    },
    on() {},
  }

  const host = apply(ctx, {
    memoryFile: join(dir, 'evolution.json'),
    companyFile: join(dir, 'company.json'),
    approvalsFile: join(dir, 'plugin-approvals.json'),
    healthCheckOnStart: false,
    communication,
  })
  assert.ok(host, 'host 应当装配成功')
  return { dir, host, ctx, logs, starts, followups, tool: (toolName) => registered.get(toolName), registered }
}

/** 一个可控的假 Adapter：真 Adapter 的 send 会打飞书网络，这里只把出站消息收起来。 */
function probeAdapter(manager, { platform = 'feishu', baseAdapterId = 'im' } = {}) {
  const sent = []
  let deliver = null
  manager.gateway.register({
    id: 'probe',
    platform,
    onMessage(handler) { deliver = handler },
    status() { return { id: 'probe', platform, state: 'connected', receivedCount: 0, sentCount: 0 } },
    async start() {}, async stop() {},
    async send(conversationId, message) { sent.push({ conversationId, ...message }) },
  }, { ...manager.gateway.configOf(baseAdapterId), id: 'probe' })
  let serial = 0
  return {
    sent,
    async inbound(over = {}) {
      serial += 1
      deliver({
        id: `msg-${serial}`, platform, adapterId: 'probe',
        conversationId: 'c_dev', conversationType: 'group',
        senderId: 'u_boss', text: '在吗', mentions: [], attachments: [],
        actorRole: 'guest', permissionMode: 'read-only',
        createdAt: 1787000000000 + serial,
        ...over,
      })
      await settle(60)
    },
  }
}

const IM_CONFIG = {
  adapters: [{
    id: 'im', platform: 'qq', name: '测试渠道', enabled: true,
    routing: { defaultTarget: 'secretary', recognizeMentions: true },
    access: {
      actors: [{ userId: 'u_boss', name: '老板', role: 'owner', permissionMode: 'danger-full-access' }],
      conversations: [
        { conversationId: 'c_dev', name: '研发群', permissionMode: 'workspace-write' },
        { conversationId: 'c_notice', name: '公告群', permissionMode: 'read-only' },
      ],
    },
  }],
  channelBindings: [{ adapterId: 'probe', externalConversationId: 'c_dev', companyChannelId: 'engineering' }],
}

// ---------------------------------------------------------------------------
// 空壳一：TaskHistory 没有生产写入者
// ---------------------------------------------------------------------------

test('TaskHistory: staff_chat 真的写履历，outcome 只认真实 stopReason，不认子代理自述', async () => {
  const plan = (options) => {
    const prompt = options.prompt[0].text
    if (prompt.includes('第一件事')) {
      return {
        stopReason: 'completed',
        output: [
          { type: 'tool_use', name: 'sd_generate' },
          { type: 'text', text: '做完了，图已经生成。' },
        ],
      }
    }
    // 子代理嘴上说成功，真实 stopReason 却是出错 —— 履历必须听真实结果的。
    if (prompt.includes('第二件事')) return { stopReason: 'error', isError: true, output: [{ type: 'text', text: '任务已成功完成！' }] }
    // 反过来：嘴上说失败，真实结果是正常结束。
    return { stopReason: 'completed', output: [{ type: 'text', text: '我失败了。' }] }
  }
  const { host, tool } = await bench('task-history', { plan })
  const staffChat = tool('staff_chat')
  assert.ok(staffChat, 'staff_chat 应当已注册')
  const exec = { agent: { session: { id: 'main-session' } } }

  const first = await staffChat.execute({ staff: 'developer', message: '第一件事：改一下登录接口' }, exec)
  assert.equal(first.kind, 'foreground')
  assert.equal(first.reply, '做完了，图已经生成。')

  const tasks = await host.core.store.tasks('developer')
  assert.equal(tasks.length, 1, '派一次活就应当有一条履历')
  assert.equal(tasks[0].outcome, 'success')
  assert.equal(tasks[0].source, 'web', 'Web 渠道来的活 source 必须是 web')
  assert.ok(tasks[0].completedAt > 0, '真实跑完了就必须结单')
  assert.ok(tasks[0].title.includes('第一件事'))
  assert.deepEqual(tasks[0].tools, ['sd_generate'], '工具列表来自子代理真实调用块，不是预填的偏好工具')

  // 真实出错：staff_chat 照旧抛错，但履历先如实结成 failed。
  await assert.rejects(() => staffChat.execute({ staff: 'developer', message: '第二件事：发一版' }, exec), /异常结束/)
  const afterFailure = await host.core.store.tasks('developer')
  const failed = afterFailure.find((item) => item.title.includes('第二件事'))
  assert.ok(failed, '失败的活也要留下履历')
  assert.equal(failed.outcome, 'failed', '子代理自述「任务已成功完成」不算数，isError 才算数')

  await staffChat.execute({ staff: 'developer', message: '第三件事：写个脚本' }, exec)
  const third = (await host.core.store.tasks('developer')).find((item) => item.title.includes('第三件事'))
  assert.equal(third.outcome, 'success', '自述「我失败了」同样不算数，stopReason=completed 就是正常结束')

  // 需求文档第五章那组 KPI 终于不是 0 了。
  const statistics = await host.core.store.statistics('developer')
  assert.equal(statistics.totalTasks, 3)
  assert.equal(statistics.successCount, 2)
  assert.equal(statistics.failedCount, 1)

  const snapshot = await host.core.snapshot()
  const row = snapshot.employees.find((item) => item.employeeId === 'developer')
  assert.equal(row.recentTasks.length, 3, 'snapshot.recentTasks 不再恒为空')
  assert.equal(row.statistics.totalTasks, 3)
})

test('TaskHistory: staff_meeting 每位参会人各一条真实履历，首位发言人的单子等总结跑完再结', async () => {
  const { host, tool } = await bench('task-history-meeting', {
    plan: (options) => ({ stopReason: 'completed', output: [{ type: 'text', text: options.label.includes('tech-lead') ? '老王发言' : '小刘发言' }] }),
  })
  const meeting = tool('staff_meeting')
  const result = await meeting.execute({ staff: ['tech-lead', 'developer'], topic: '下周排期' }, { agent: { session: { id: 'main-session' } } })
  assert.equal(result.turns.length, 3, '两人发言 + 首位发言人总结')

  const lead = await host.core.store.tasks('tech-lead')
  const dev = await host.core.store.tasks('developer')
  assert.equal(lead.length, 1, '首位发言人只开一条单（发言 + 总结算同一次会议）')
  assert.equal(dev.length, 1)
  assert.equal(lead[0].outcome, 'success')
  assert.equal(dev[0].outcome, 'success')
  assert.ok(lead[0].title.includes('下周排期'))
  assert.ok(lead[0].completedAt > 0 && dev[0].completedAt > 0)
})

test('TaskHistory: 持续会话拿得到结束信号时按真实结果结单', async () => {
  const { host, tool } = await bench('task-history-continuable', {
    continuable: { settle: () => ({ stopReason: 'aborted', output: [{ type: 'text', text: '我被打断了' }] }) },
  })
  const staffChat = tool('staff_chat')
  const accepted = await staffChat.execute({ staff: 'developer', message: '跑个长任务' }, { agent: { session: { id: 'main-session' } } })
  assert.equal(accepted.kind, 'continuable')
  await settle(20)

  const tasks = await host.core.store.tasks('developer')
  assert.equal(tasks.length, 1)
  assert.ok(tasks[0].completedAt > 0, '拿到真实结束信号就必须结单')
  assert.equal(tasks[0].outcome, 'blocked', 'aborted 是被中断，不是成功')
})

test('TaskHistory: 拿不到结束信号时挂起，下一轮如实记 partial，绝不谎报成功', async () => {
  const { host, tool, followups } = await bench('task-history-pending', { continuable: { settle: null } })
  const staffChat = tool('staff_chat')
  const exec = { agent: { session: { id: 'main-session' } } }

  await staffChat.execute({ staff: 'developer', message: '第一轮任务' }, exec)
  await settle(20)
  const open = await host.core.store.tasks('developer')
  assert.equal(open.length, 1)
  assert.equal(open[0].completedAt, undefined, '没有结束信号就只能挂在进行中，不许凭空判成功')
  assert.equal((await host.core.store.statistics('developer')).successCount, 0)

  // 同一个持续会话接受了第二轮 ⇒ 第一轮确实结束了，但成败宿主观测不到。
  await staffChat.execute({ staff: 'developer', message: '第二轮任务' }, exec)
  await settle(20)
  assert.equal(followups.length, 1, '第二轮应当走 followup 复用同一个子代理')
  const rows = await host.core.store.tasks('developer')
  const first = rows.find((item) => item.title.includes('第一轮'))
  assert.equal(first.outcome, 'partial')
  assert.match(first.summary, /没有拿到结束信号/)
  assert.equal((await host.core.store.statistics('developer')).successCount, 0, '未知成败绝不能计成功')
})

// ---------------------------------------------------------------------------
// 空壳二：IM 员工运行时从未接线
// ---------------------------------------------------------------------------

test('Phase 6 接线：飞书消息真的落到员工本人，履历来源是 [飞书]', async () => {
  const { host, starts } = await bench('im-dispatch', {
    communication: IM_CONFIG,
    plan: () => ({ stopReason: 'completed', output: [{ type: 'text', text: '今天进度：登录接口已修完。' }] }),
  })
  const manager = host.communication
  assert.ok(manager, '通讯层应当装配成功')
  assert.equal(manager.router.hasDispatcher(), true, 'host-v3 必须把员工运行时注入 Router')

  const probe = probeAdapter(manager)
  // 外部渠道没有自己的 agent：一次真实主会话都没出现过时，如实说明，不编造员工回复。
  await probe.inbound({ text: '@老王 检查今天项目进度。' })
  assert.equal(probe.sent.length, 1)
  assert.equal(probe.sent[0].kind, 'notice')
  assert.ok(!/没有可用的员工运行时/.test(probe.sent[0].text), '员工运行时已经接线了，不该再说这句话')
  assert.match(probe.sent[0].text, /执行根/)
  assert.equal(starts.length, 0, '没有执行根就不该起子代理')

  // 老板在工作台里交互过一次之后（这里直接用 bindAgent 表达同一件事），外部消息就能真派下去了。
  host.core.bindAgent({ session: { id: 'main-session' } })
  assert.equal(host.core.hasAgent(), true)
  await probe.inbound({ text: '@老王 检查今天项目进度。' })

  const reply = probe.sent.find((item) => item.kind === 'employee-reply')
  assert.ok(reply, '员工必须真的回话')
  assert.equal(reply.text, '今天进度：登录接口已修完。')
  assert.equal(reply.employeeId, 'tech-lead')
  assert.equal(starts.length, 1, '真实起了一个子代理')

  const tasks = await host.core.store.tasks('tech-lead')
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].source, 'feishu', '需求文档第五章的 [飞书] 来源标签必须真的出现')
  assert.equal(tasks[0].channelId, 'engineering', '群绑定映射到的内部频道要落进履历')
  assert.equal(tasks[0].outcome, 'success')

  // 同一位老王：Web 与飞书共享同一份档案，没有第二个「飞书老王」。
  const profile = await host.core.store.profile('tech-lead')
  assert.equal(profile.taskHistory.length, 1)
  assert.equal(host.core.roster.filter((item) => item.id === 'tech-lead').length, 1)
})

test('Phase 6 接线：名册只有一份，通讯层用的就是 core 推导出来的那份', async () => {
  const { host } = await bench('im-roster', {
    communication: IM_CONFIG,
    plan: () => ({ stopReason: 'completed', output: [{ type: 'text', text: '收到' }] }),
  })
  const fromRouter = host.communication.router.employeeById('tech-lead')
  const fromCore = host.core.employees.find((item) => item.id === 'tech-lead')
  assert.ok(fromRouter && fromCore)
  assert.equal(fromRouter.name, fromCore.name)
  assert.equal(fromRouter.role, fromCore.role)
  assert.deepEqual(fromRouter.aliases, fromCore.aliases, '别名必须来自 core，不再各推一遍')
  assert.deepEqual(fromRouter.keywords, fromCore.capabilities)
})

test('Phase 6 接线：只读渠道的约束真的进了 prompt，观测到写工具就判越权并拦掉回复', async () => {
  const { host, starts } = await bench('im-readonly', {
    communication: IM_CONFIG,
    // 子代理在只读渠道里真的动了 file_write：宿主只能事后观测，但必须如实上报。
    plan: () => ({ stopReason: 'completed', output: [{ type: 'tool_use', name: 'file_write' }, { type: 'text', text: '已经帮你把文件改好了。' }] }),
  })
  host.core.bindAgent({ session: { id: 'main-session' } })
  const probe = probeAdapter(host.communication)
  await probe.inbound({ conversationId: 'c_notice', text: '@老王 把配置改一下' })

  assert.equal(starts.length, 1)
  assert.match(starts[0].options.prompt[0].text, /只读档位/, '只读约束必须真的写进派活 prompt')

  assert.equal(probe.sent.some((item) => item.kind === 'employee-reply'), false, '越权那次回复必须被拦下')
  const notice = probe.sent.find((item) => item.kind === 'notice')
  assert.ok(notice)
  assert.match(notice.text, /file_write/)

  const tasks = await host.core.store.tasks('tech-lead')
  assert.equal(tasks[0].outcome, 'blocked', '只读渠道里动了写工具，履历不能记成 success')
  assert.ok(tasks[0].tools.includes('file_write'), '真实观测到的工具要如实落进履历')

  // 可写渠道下同样的工具调用一切照常，闸门不误伤。
  await probe.inbound({ conversationId: 'c_dev', text: '@老王 把配置改一下' })
  assert.ok(probe.sent.some((item) => item.kind === 'employee-reply' && item.text.includes('已经帮你把文件改好了')))
})

test('Phase 6 接线：core 装配失败时市场工具也不许留在 Tool Registry 里', async () => {
  const registered = new Map()
  const ctx = {
    // 缺 subagents：host-v2 会拒绝装配，整个插件本次不可用。
    tools: { register(tool) { registered.set(tool.name, tool) }, list: () => [] },
    systemPrompt: { section() {} },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  }
  assert.equal(apply(ctx, {}), undefined)
  assert.equal(registered.has('staff_plugin_market_search'), false, '守卫之前注册市场工具＝老板看到一个没人能用的半截能力')
  assert.equal(registered.size, 0)
})

// ---------------------------------------------------------------------------
// 6.1：自述 success 不涨级
// ---------------------------------------------------------------------------

test('6.1 staff_skill_learn：连调 12 次自述成功也涨不了级，一条证据都不写', async () => {
  const { host, tool } = await bench('skill-self-claim')
  const learn = tool('staff_skill_learn')
  for (let index = 0; index < 12; index++) {
    const result = await learn.execute({
      staff: 'image-creator', name: 'AI 出图', source: 'plugin',
      toolNames: ['sd_generate'], pluginNames: ['sd-plugin'], success: true,
    })
    assert.equal(result.evidenceRecorded, false)
    assert.equal(result.ignoredSuccessClaim, true)
    assert.equal(result.skill.level, 1, `第 ${index + 1} 次自述之后等级仍然只能是 1`)
  }
  const skills = await host.core.store.skills('image-creator')
  const skill = skills.find((item) => item.name === 'AI 出图')
  assert.equal(skill.level, 1)
  assert.equal(skill.successes, 0, '自述不产生成功计数')
  assert.equal(skill.evidenceCount, 0)
  assert.deepEqual(await host.core.store.evidence('image-creator'), [], '一条证据都不该写')

  // 功能没被删：真实证据照样涨级。
  for (let index = 0; index < 5; index++) {
    await host.core.store.addEvidence({ employeeId: 'image-creator', skillId: skill.id, tool: 'sd_generate', success: true })
  }
  const upgraded = (await host.core.store.skills('image-creator')).find((item) => item.name === 'AI 出图')
  assert.ok(upgraded.level > 1, '真实执行证据必须还能涨级')
})

test('6.1 staff_skill_learn：插件类技能必须点名真实存在的工具，空数组绕不过 Registry 校验', async () => {
  const { tool } = await bench('skill-registry-guard')
  const learn = tool('staff_skill_learn')
  await assert.rejects(
    () => learn.execute({ staff: 'platform', name: '幽灵插件能力', source: 'plugin' }),
    /真实存在的工具/,
    'toolNames 省略时必须被挡住',
  )
  await assert.rejects(
    () => learn.execute({ staff: 'platform', name: '幽灵插件能力', source: 'plugin', toolNames: [] }),
    /真实存在的工具/,
    '空数组同样必须被挡住',
  )
  await assert.rejects(
    () => learn.execute({ staff: 'platform', name: '幽灵插件能力', source: 'plugin', toolNames: ['ghost_tool'] }),
    /一个都不存在/,
    '编出来的工具名必须被挡住',
  )
  const ok = await learn.execute({ staff: 'platform', name: '出图能力', source: 'plugin', toolNames: ['sd_generate', 'ghost_tool'] })
  assert.deepEqual(ok.verifiedTools, ['sd_generate'])
  assert.deepEqual(ok.ignoredTools, ['ghost_tool'])
})

// ---------------------------------------------------------------------------
// 持久化安全线
// ---------------------------------------------------------------------------

test('损坏的 evolution.json 必须先备份再继续，绝不静默清空老板的档案', async () => {
  const dir = await scratch('corrupt-store')
  const file = join(dir, 'evolution.json')
  const original = '{"version":2,"employees":{"developer":{"xp":9999,'
  await writeFile(file, original, 'utf-8')

  const store = new EvolutionStore(file)
  await store.remember('developer', { text: '新的一条记忆' })

  assert.ok(store.corruptBackupPath, '损坏文件必须留下备份路径')
  assert.equal(await readFile(store.corruptBackupPath, 'utf-8'), original, '备份必须是逐字节原文')
  assert.equal(store.writeBlocked, null)
  const rewritten = JSON.parse(await readFile(file, 'utf-8'))
  assert.equal(rewritten.employees.developer.memories.length, 1)

  // 第二次读到同一个坏文件时不许把第一份备份冲掉。
  await writeFile(file, '{"version":2,"employees"', 'utf-8')
  const second = new EvolutionStore(file)
  await second.remember('developer', { text: '又一条' })
  assert.equal(second.corruptBackupPath, store.corruptBackupPath)
  assert.equal(await readFile(store.corruptBackupPath, 'utf-8'), original, '最早那份原文必须原样保住')
})

test('损坏文件备份不成功时锁死写入，宁可报错也不覆盖', async () => {
  const dir = await scratch('corrupt-store-readonly')
  const home = join(dir, 'store')
  await mkdir(home, { recursive: true })
  const file = join(home, 'evolution.json')
  await writeFile(file, '{"version":2,"employees":{', 'utf-8')
  await chmod(home, 0o500)
  try {
    const probe = join(home, '.writable-probe')
    let writable = false
    try { await writeFile(probe, 'x', 'utf-8'); writable = true } catch {}
    if (writable) return // 以 root 运行时目录权限不生效，这条断言没有意义

    const store = new EvolutionStore(file)
    await assert.rejects(() => store.remember('developer', { text: '不该落盘' }), /拒绝写入/)
    assert.equal(store.corruptBackupPath, null)
    assert.ok(store.writeBlocked)
    assert.equal((await readFile(file, 'utf-8')).startsWith('{"version":2,"employees":{'), true, '原文件必须一个字节都没动')
    assert.ok((await stat(file)).size > 0)
  } finally {
    await chmod(home, 0o700)
  }
})

test('插件 / 模型绑定省略 status 时默认不是 available', async () => {
  const dir = await scratch('binding-default')
  const store = new EvolutionStore(join(dir, 'evolution.json'))

  const plugin = await store.bindPlugin('platform', { pluginId: 'sd-plugin', packageName: '@acme/sd', source: 'dsh-market', tools: ['sd_generate'] })
  assert.equal(plugin.status, 'missing', '「已批准」不等于「已验证可用」')

  const verified = await store.bindPlugin('platform', { pluginId: 'sd-plugin', packageName: '@acme/sd', source: 'dsh-market', tools: ['sd_generate'], status: 'available' })
  assert.equal(verified.status, 'available', '真验证过的绑定照常可用，功能没被砍')

  const rebound = await store.bindPlugin('platform', { pluginId: 'sd-plugin', packageName: '@acme/sd', source: 'dsh-market', tools: ['sd_upscale'] })
  assert.equal(rebound.status, 'missing', '换了工具却没重新验证，就必须退回未验证')

  const model = await store.bindModel('platform', { capability: 'vision', providerId: 'strong', priority: 1 })
  assert.equal(model.status, 'missing')
  const okModel = await store.bindModel('platform', { capability: 'vision', providerId: 'strong', priority: 1, status: 'available' })
  assert.equal(okModel.status, 'available')
})
