// 统一 Employee Runtime 集成：履历、IM 来源、只读策略、技能证据与持久化安全。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, chmod, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { scratch } from './_helpers.mjs'

const { apply, EvolutionStore } = await import('../lib/index.js')
const EXTRA_TOOLS = [{ name: 'sd_generate', description: '出图' }, { name: 'file_write', description: '写文件' }]

async function bench(name, { plan, communication } = {}) {
  const dir = await scratch(name)
  const registered = new Map()
  const logs = []
  const starts = []
  let serial = 0
  const subagents = {
    list: () => ['spawn'],
    getProvider: (provider) => (provider === 'spawn' ? { name: provider } : undefined),
    async start(provider, options) {
      serial += 1
      starts.push({ provider, options })
      const result = plan ? plan(options, serial) : { stopReason: 'completed', output: [{ type: 'text', text: '好的，已处理。' }] }
      return { id: `run-${serial}`, result: Promise.resolve(result), async dispose() {} }
    },
  }
  const ctx = {
    logs,
    tools: {
      register(tool) { registered.set(tool.name, tool) },
      list() { return [...registered.values()].map((item) => ({ name: item.name, description: item.description })).concat(EXTRA_TOOLS) },
    },
    subagents,
    systemPrompt: { section() {} },
    logger: { info: (message) => logs.push(['info', message]), warn: (message) => logs.push(['warn', message]), error: (message) => logs.push(['error', message]), debug() {} },
    on() {},
  }
  const host = apply(ctx, {
    memoryFile: join(dir, 'evolution.json'), companyFile: join(dir, 'company.json'), approvalsFile: join(dir, 'plugin-approvals.json'),
    healthCheckOnStart: false, communication,
  })
  assert.ok(host)
  const parent = { session: { id: 'main-session' } }
  host.core.bindAgent(parent)
  return { dir, host, ctx, logs, starts, parent, tool: (name) => registered.get(name), registered }
}

function probeAdapter(manager, { platform = 'qq', baseAdapterId = 'im' } = {}) {
  const sent = []
  let deliver = null
  manager.gateway.register({
    id: 'probe', platform,
    onMessage(handler) { deliver = handler },
    status() { return { id: 'probe', platform, state: 'connected', receivedCount: 0, sentCount: 0 } },
    async start() {}, async stop() {}, async send(conversationId, message) { sent.push({ conversationId, ...message }) },
  }, { ...manager.gateway.configOf(baseAdapterId), id: 'probe' })
  let serial = 0
  return {
    sent,
    async inbound(over = {}) {
      serial += 1
      await deliver({
        id: `msg-${serial}`, platform, adapterId: 'probe', conversationId: 'c_dev', conversationType: 'group',
        senderId: 'u_boss', text: '@小刘 检查项目进度', mentions: [], attachments: [], actorRole: 'guest', permissionMode: 'read-only',
        createdAt: 1787000000000 + serial, ...over,
      })
    },
  }
}

const IM_CONFIG = {
  adapters: [{
    id: 'im', platform: 'qq', name: '测试渠道', enabled: true,
    routing: { maxWorkgroupSize: 3 },
    access: {
      actors: [{ userId: 'u_boss', name: '老板', role: 'owner', permissionMode: 'danger-full-access' }],
      conversations: [
        { conversationId: 'c_dev', name: '研发群', permissionMode: 'workspace-write' },
        { conversationId: 'c_notice', name: '公告群', permissionMode: 'read-only' },
      ],
    },
  }],
}

test('Employee Runtime: core.dispatch 真实写履历，outcome 只认执行结果', async () => {
  const { host, parent } = await bench('runtime-history', {
    plan: (options) => options.prompt[0].text.includes('失败任务')
      ? { stopReason: 'error', isError: true, output: [{ type: 'text', text: '嘴上说成功' }] }
      : { stopReason: 'completed', output: [{ type: 'tool_use', name: 'sd_generate' }, { type: 'text', text: '真实完成' }] },
  })
  const ok = await host.core.dispatch({ employeeId: 'developer', text: '完成正常任务', source: 'web', channelId: 'workspace', agent: parent })
  assert.equal(ok.ok, true)
  assert.equal(ok.reply, '真实完成')
  assert.deepEqual(ok.tools, ['sd_generate'])
  const bad = await host.core.dispatch({ employeeId: 'developer', text: '失败任务', source: 'web', channelId: 'workspace', agent: parent })
  assert.equal(bad.ok, false)
  assert.equal(bad.outcome, 'failed')
  const rows = await host.core.store.tasks('developer')
  assert.equal(rows.length, 2)
  assert.equal(rows.find((item) => item.title.includes('完成正常任务')).outcome, 'success')
  assert.equal(rows.find((item) => item.title.includes('失败任务')).outcome, 'failed')
  assert.deepEqual(rows.find((item) => item.title.includes('完成正常任务')).tools, ['sd_generate'])
})

test('全渠道主链：QQ 消息经 Work Orchestrator 落到真实员工，履历 source=qq', async () => {
  const { host, starts } = await bench('runtime-im', {
    communication: IM_CONFIG,
    plan: () => ({ stopReason: 'completed', output: [{ type: 'text', text: '项目进度已检查。' }] }),
  })
  const probe = probeAdapter(host.communication)
  await probe.inbound({ text: '@小刘 检查项目进度' })
  assert.equal(starts.length, 1)
  const reply = probe.sent.find((item) => item.kind === 'employee-reply')
  assert.ok(reply)
  assert.equal(reply.employeeId, 'developer')
  assert.equal(reply.text, '项目进度已检查。')
  const tasks = await host.core.store.tasks('developer')
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].source, 'qq')
  assert.equal(host.core.roster.filter((item) => item.id === 'developer').length, 1, 'Web/IM 共用一份员工身份')
})

test('全渠道安全：只读消息真实观测到写工具后任务 blocked，员工回复被拦下', async () => {
  const { host } = await bench('runtime-readonly', {
    communication: IM_CONFIG,
    plan: () => ({ stopReason: 'completed', output: [{ type: 'tool_use', name: 'file_write' }, { type: 'text', text: '已经修改文件' }] }),
  })
  const probe = probeAdapter(host.communication)
  await probe.inbound({ conversationId: 'c_notice', text: '@小刘 把配置改一下' })
  assert.equal(probe.sent.some((item) => item.kind === 'employee-reply'), false)
  const notice = probe.sent.find((item) => item.kind === 'notice')
  assert.ok(notice)
  assert.match(notice.text, /file_write/)
  const tasks = await host.core.store.tasks('developer')
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].outcome, 'blocked')
  assert.ok(tasks[0].tools.includes('file_write'))
})

test('装配失败时不留下半截市场/工作工具', async () => {
  const registered = new Map()
  const ctx = {
    tools: { register(tool) { registered.set(tool.name, tool) }, list: () => [] },
    systemPrompt: { section() {} },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  }
  assert.equal(apply(ctx, {}), undefined)
  assert.equal(registered.size, 0)
})

test('staff_skill_learn: 自述 success 连调也不能刷等级，真实证据才升级', async () => {
  const { host, tool } = await bench('runtime-skill-claim')
  const learn = tool('staff_skill_learn')
  for (let index = 0; index < 12; index += 1) {
    const result = await learn.execute({ staff: 'image-creator', name: 'AI 出图', source: 'plugin', toolNames: ['sd_generate'], pluginNames: ['sd-plugin'], success: true })
    assert.equal(result.evidenceRecorded, false)
    assert.equal(result.skill.level, 1)
  }
  const skill = (await host.core.store.skills('image-creator')).find((item) => item.name === 'AI 出图')
  assert.equal(skill.successes, 0)
  assert.equal(skill.evidenceCount, 0)
  for (let index = 0; index < 5; index += 1) await host.core.store.addEvidence({ employeeId: 'image-creator', skillId: skill.id, tool: 'sd_generate', success: true })
  const upgraded = (await host.core.store.skills('image-creator')).find((item) => item.id === skill.id)
  assert.ok(upgraded.level > 1)
})

test('staff_skill_learn: 插件技能必须绑定当前 Registry 真实工具', async () => {
  const { tool } = await bench('runtime-skill-registry')
  const learn = tool('staff_skill_learn')
  await assert.rejects(() => learn.execute({ staff: 'platform', name: '幽灵插件', source: 'plugin', toolNames: [] }), /真实存在的工具/)
  await assert.rejects(() => learn.execute({ staff: 'platform', name: '幽灵插件', source: 'plugin', toolNames: ['ghost_tool'] }), /一个都不存在/)
  const ok = await learn.execute({ staff: 'platform', name: '出图能力', source: 'plugin', toolNames: ['sd_generate', 'ghost_tool'] })
  assert.deepEqual(ok.verifiedTools, ['sd_generate'])
  assert.deepEqual(ok.ignoredTools, ['ghost_tool'])
})

test('损坏 evolution.json 必须先备份再继续，绝不静默覆盖', async () => {
  const dir = await scratch('runtime-corrupt')
  const file = join(dir, 'evolution.json')
  const original = '{"version":2,"employees":{"developer":{"xp":9999,'
  await writeFile(file, original, 'utf-8')
  const store = new EvolutionStore(file)
  await store.remember('developer', { text: '新的一条记忆' })
  assert.ok(store.corruptBackupPath)
  assert.equal(await readFile(store.corruptBackupPath, 'utf-8'), original)
  assert.equal(store.writeBlocked, null)
  const rewritten = JSON.parse(await readFile(file, 'utf-8'))
  assert.equal(rewritten.employees.developer.memories.length, 1)
})

test('损坏文件备份失败时锁死写入，宁可报错也不覆盖', async () => {
  const dir = await scratch('runtime-corrupt-readonly')
  const home = join(dir, 'store')
  await mkdir(home, { recursive: true })
  const file = join(home, 'evolution.json')
  await writeFile(file, '{"version":2,"employees":{', 'utf-8')
  await chmod(home, 0o500)
  try {
    const probe = join(home, '.writable-probe')
    let writable = false
    try { await writeFile(probe, 'x', 'utf-8'); writable = true } catch {}
    if (writable) return
    const store = new EvolutionStore(file)
    await assert.rejects(() => store.remember('developer', { text: '不该落盘' }), /拒绝写入/)
    assert.equal(store.corruptBackupPath, null)
    assert.ok(store.writeBlocked)
    assert.ok((await stat(file)).size > 0)
  } finally {
    await chmod(home, 0o700)
  }
})

test('插件 / 模型绑定省略 status 时默认 missing，避免伪造可用状态', async () => {
  const dir = await scratch('runtime-binding-default')
  const store = new EvolutionStore(join(dir, 'evolution.json'))
  const plugin = await store.bindPlugin('platform', { pluginId: 'sd-plugin', packageName: '@acme/sd', source: 'dsh-market', tools: ['sd_generate'] })
  assert.equal(plugin.status, 'missing')
  const model = await store.bindModel('platform', { capability: 'vision', providerId: 'strong', priority: 1 })
  assert.equal(model.status, 'missing')
})
