// 需求文档五十八条第 4 项：Plugin health check。
//
// 被测口径来自需求文档第九章 + 五十七条：
//   · 绑定声明的工具在当前 Tool Registry 里全在 = available，部分在 = degraded，全不在 = missing；
//   · 「Plugin missing 时不显示 Available」—— 插件掉了必须如实翻状态；
//   · 技能历史（等级 / 证据）永远保留，只有可用性会变，绝不因为插件掉了就抹掉员工学过的东西；
//   · 老板手动 disabled 的绑定不许被自动翻回可用。
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fakeCtx, scratch } from './_helpers.mjs'

const { EvolutionStore, PluginRuntime, computeSkillLevel } = await import('../lib/index.js')

/** 造一个绑定了插件、且技能已经积累了真实证据的员工。 */
async function seedEmployee(dir) {
  const store = new EvolutionStore(join(dir, 'evolution.json'))
  await store.bindPlugin('image-creator', {
    pluginId: 'sd-plugin',
    packageName: '@acme/stable-diffusion',
    version: '1.2.0',
    source: 'dsh-market',
    tools: ['sd_generate', 'sd_upscale'],
    status: 'available',
  })
  await store.learnSkill('image-creator', {
    name: 'AI 出图', summary: '用 SD 出图', source: 'plugin',
    toolNames: ['sd_generate'], pluginNames: ['sd-plugin'],
  })
  // 5 成 1 败的真实证据 → 历史熟练度不是 1，后面才能验证「插件掉了但等级不回退」。
  for (let index = 0; index < 5; index++) {
    await store.addEvidence({ employeeId: 'image-creator', skillName: 'AI 出图', tool: 'sd_generate', plugin: 'sd-plugin', success: true })
  }
  await store.addEvidence({ employeeId: 'image-creator', skillName: 'AI 出图', tool: 'sd_generate', plugin: 'sd-plugin', success: false })
  return store
}

function runtimeWith(store, dir, toolNames) {
  return new PluginRuntime(fakeCtx(toolNames), { store, approvalsFile: join(dir, 'plugin-approvals.json') })
}

function pluginRow(report, employeeId = 'image-creator', pluginId = 'sd-plugin') {
  const employee = report.employees.find((item) => item.employeeId === employeeId)
  assert.ok(employee, `健康报告里应该有 ${employeeId}`)
  const row = employee.plugins.find((item) => item.pluginId === pluginId)
  assert.ok(row, `健康报告里应该有插件 ${pluginId}`)
  return row
}

test('Plugin health check: 工具全在=available，掉一半=degraded，全没了=missing', async () => {
  const dir = await scratch('plugin-health')
  const store = await seedEmployee(dir)

  const healthy = await runtimeWith(store, dir, ['sd_generate', 'sd_upscale', 'Bash']).healthCheck()
  const row1 = pluginRow(healthy)
  assert.equal(row1.status, 'available')
  assert.deepEqual(row1.missingTools, [])
  assert.equal(healthy.catalogSize, 3, 'catalogSize 必须是真实扫到的工具数')

  // 插件被卸载了一半：只剩 sd_generate。
  const partial = await runtimeWith(store, dir, ['sd_generate', 'Bash']).healthCheck()
  const row2 = pluginRow(partial)
  assert.equal(row2.before, 'available', 'before 要如实记录翻转前的状态')
  assert.equal(row2.status, 'degraded')
  assert.deepEqual(row2.missingTools, ['sd_upscale'])
  assert.equal(partial.changed, 1)
  assert.equal((await store.pluginBindings('image-creator'))[0].status, 'degraded', '状态必须真的写回磁盘')

  // 插件彻底不在了。
  const gone = await runtimeWith(store, dir, ['Bash']).healthCheck()
  const row3 = pluginRow(gone)
  assert.equal(row3.status, 'missing')
  assert.deepEqual(row3.missingTools, ['sd_generate', 'sd_upscale'])
  assert.equal(gone.changed, 1)

  // 五十七条：Plugin missing 时绝不显示 Available。
  const binding = (await store.pluginBindings('image-creator'))[0]
  assert.equal(binding.status, 'missing')
  assert.notEqual(binding.status, 'available')

  // 插件回来了就该恢复，不能一朝掉线永久拉黑。
  const restored = await runtimeWith(store, dir, ['sd_generate', 'sd_upscale']).healthCheck()
  assert.equal(pluginRow(restored).status, 'available')
})

test('Plugin health check: 插件掉了也不许抹掉员工的技能历史', async () => {
  const dir = await scratch('plugin-history')
  const store = await seedEmployee(dir)

  const before = (await store.skills('image-creator')).find((item) => item.name === 'AI 出图')
  // 5 成 1 败 + 近 14 天 5 条成功证据（上限 6）→ score = 15-1+5 = 19 → 1+floor(log2(20)) = 5
  assert.equal(before.level, computeSkillLevel({ successes: 5, failures: 1, recentUsageBonus: 5 }))
  assert.equal(before.level, 5)
  assert.equal(before.evidenceCount, 6)

  const report = await runtimeWith(store, dir, ['Bash']).healthCheck()
  const row = pluginRow(report)
  assert.equal(row.status, 'missing')
  // 报告里带着「历史熟练度」，档案页才能显示「Lv.5 · 插件已缺失」。
  assert.deepEqual(row.skills, ['AI 出图 Lv.5'])

  const after = (await store.skills('image-creator')).find((item) => item.id === before.id)
  assert.equal(after.level, 5, '插件缺失不得让历史等级回退')
  assert.equal(after.successes, 5)
  assert.equal(after.failures, 1)
  assert.equal((await store.evidence('image-creator', { skillId: before.id })).length, 6, '证据一条都不能被健康检查删掉')
})

test('Plugin health check: 老板手动停用的绑定不会被自动翻回可用', async () => {
  const dir = await scratch('plugin-disabled')
  const store = new EvolutionStore(join(dir, 'evolution.json'))
  await store.bindPlugin('platform', {
    pluginId: 'mcp-github', packageName: '@acme/mcp-github', source: 'mcp',
    tools: ['github_search'], status: 'disabled',
  })

  // 工具其实是在的，但老板停用了它 —— 健康检查不能替老板做主。
  const report = await runtimeWith(store, dir, ['github_search']).healthCheck()
  const row = pluginRow(report, 'platform', 'mcp-github')
  assert.equal(row.before, 'disabled')
  assert.equal(row.status, 'disabled')
  assert.deepEqual(row.missingTools, [])
  assert.equal(report.changed, 0)
  assert.equal((await store.pluginBindings('platform'))[0].status, 'disabled')
})

test('Plugin health check: 没有工具声明的绑定算 missing，没有绑定的员工不进报告', async () => {
  const dir = await scratch('plugin-empty')
  const store = new EvolutionStore(join(dir, 'evolution.json'))
  // 装了但一个工具都没注册出来 = 没验证成功，绝不能显示可用。
  await store.bindPlugin('doc', { pluginId: 'ghost', packageName: '@acme/ghost', source: 'github', tools: [], status: 'available' })
  await store.remember('developer', { text: '小刘没有任何插件绑定' })

  const report = await runtimeWith(store, dir, ['Bash', 'Edit']).healthCheck()
  assert.equal(pluginRow(report, 'doc', 'ghost').status, 'missing')
  assert.equal(report.employees.some((item) => item.employeeId === 'developer'), false, '没有绑定的员工不该出现在健康报告里')

  // 指定员工时只检查这些人。
  const scoped = await runtimeWith(store, dir, ['Bash']).healthCheck(['developer'])
  assert.deepEqual(scoped.employees, [])
})
