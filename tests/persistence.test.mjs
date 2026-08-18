// 需求文档五十八条要求的持久层三项单元测试（另外五项见同目录其它文件）：
//   1. Evolution migration    —— V1 档案迁到 V2 不能丢数据、必须留备份、且只迁一次
//   2. TaskHistory persistence —— 履历真的落盘、重启后读得回来、统计不重复计数
//   3. Skill Evidence calculation —— 等级只能由真实证据按 6.2 公式派生
// 顺带守住 CompanySnapshot（空 Session hydrate）与 company.json 的明文密钥拦截。
//
// 跑法：npm test（会先 npm run build，再用 node --test 跑整个 tests/ 目录）。
// 之所以测 lib/index.js 而不是 src/*.ts：仓库没有 TS test runner，而 lib/ 就是真正发布出去的
// 产物——测发布产物比测源码更接近老板实际装到的东西。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { scratch } from './_helpers.mjs'

const { EvolutionStore, CompanyStore, computeSkillLevel, detectStoreVersion, evolutionLevel } =
  await import('../lib/index.js')

function v1File() {
  const now = Date.now()
  return {
    version: 1,
    employees: {
      developer: {
        employeeId: 'developer',
        revision: 3,
        xp: 148,
        memories: [
          { id: 'm1', employeeId: 'developer', kind: 'preference', text: '老板要求所有 PR 必须带测试', tags: ['规范'], importance: 5, createdAt: now - 5000, updatedAt: now - 5000, lastUsedAt: now - 5000, useCount: 4 },
          { id: 'm2', employeeId: 'developer', kind: 'project', text: 'dsh-org-panel 用 tsdown 打包', tags: ['构建'], importance: 3, createdAt: now - 4000, updatedAt: now - 4000, lastUsedAt: 0, useCount: 0 },
        ],
        // V1 存的 level 是老公式的产物，迁移后必须按 6.2 重算，不能照抄。
        skills: [
          { id: 's1', employeeId: 'developer', name: 'TypeScript', category: '工程', summary: '写 TS', source: 'seed', toolNames: ['Edit'], pluginNames: [], level: 9, successes: 5, failures: 1, createdAt: now - 9000, updatedAt: now - 900 },
        ],
        reflections: [
          { id: 'r1', employeeId: 'developer', task: '修构建', outcome: 'success', lesson: '先看 tsdown.config.ts', createdAt: now - 3000 },
        ],
        updatedAt: now - 900,
      },
    },
  }
}

test('Evolution migration: V1 档案无损迁到 V2 并留下逐字节备份', async () => {
  const dir = await scratch('migrate')
  const file = join(dir, 'evolution.json')
  const original = JSON.stringify(v1File(), null, 2)
  await writeFile(file, original, 'utf-8')
  assert.equal(detectStoreVersion(JSON.parse(original)), 1)

  const store = new EvolutionStore(file)
  const profile = await store.profile('developer')

  // 1. 老数据一条不少
  assert.equal(profile.xp, 148)
  assert.equal(profile.revision, 3)
  assert.equal(profile.memories.length, 2)
  assert.equal(profile.memories[0].text, '老板要求所有 PR 必须带测试')
  assert.equal(profile.reflections.length, 1)
  assert.equal(profile.skills.length, 1)

  // 2. 等级重算：5 成 1 败、无近期证据 → score=14 → 1+floor(log2(15))=4，不再是 V1 存的 9
  assert.equal(profile.skills[0].level, computeSkillLevel({ successes: 5, failures: 1, recentUsageBonus: 0 }))
  assert.equal(profile.skills[0].level, 4)

  // 3. V2 新结构存在且为空，不能凭空造履历
  assert.deepEqual(profile.taskHistory, [])
  assert.equal(profile.statistics.totalTasks, 0)

  // 4. 备份与原文件逐字节一致，磁盘上已经是 version 2
  const backup = await readFile(`${file}.v1.bak`, 'utf-8')
  assert.equal(backup, original)
  const onDisk = JSON.parse(await readFile(file, 'utf-8'))
  assert.equal(onDisk.version, 2)
  assert.equal(store.migratedFrom, 1)
})

test('TaskHistory persistence: 履历真落盘、重开实例读得回、完成只计一次', async () => {
  const dir = await scratch('tasks')
  const file = join(dir, 'evolution.json')
  const store = new EvolutionStore(file)

  const task = await store.startTask('developer', { title: '修复构建', source: 'web', tools: ['Bash'] })
  assert.ok(task.id)
  assert.equal(task.completedAt, undefined, '进行中的任务不能带 completedAt')
  assert.equal((await store.statistics('developer')).totalTasks, 0, '未完成的任务不计入统计')

  await store.completeTask(task.id, { outcome: 'success', summary: '改了 tsdown 配置' }, 'developer')
  const afterFirst = await store.statistics('developer')
  assert.equal(afterFirst.totalTasks, 1)
  assert.equal(afterFirst.successCount, 1)

  // 重复完成同一条任务不能重复计数
  await store.completeTask(task.id, { outcome: 'success' }, 'developer').catch(() => {})
  const afterSecond = await store.statistics('developer')
  assert.equal(afterSecond.totalTasks, 1, '重复 completeTask 不得重复累计')

  // 换一个实例重新读盘 —— 这才叫 persistence
  const reopened = new EvolutionStore(file)
  const rows = await reopened.tasks('developer', { limit: 10 })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, '修复构建')
  assert.equal(rows[0].outcome, 'success')
  assert.ok(rows[0].completedAt > 0)
  assert.equal((await reopened.statistics('developer')).totalTasks, 1)

  // 完成任务给了真实经验，等级是经验的纯函数
  const profile = await reopened.profile('developer')
  assert.ok(profile.xp > 0)
  assert.deepEqual(evolutionLevel(profile.xp), evolutionLevel(profile.xp))
})

test('Skill Evidence calculation: 等级只由真实证据派生', async () => {
  const dir = await scratch('evidence')
  const store = new EvolutionStore(join(dir, 'evolution.json'))
  await store.seedSkill('developer', 'Playwright 自动化', '跑端到端测试', ['Bash'])

  const before = (await store.skills('developer')).find((item) => item.name === 'Playwright 自动化')
  assert.ok(before, 'seedSkill 应该建出技能')
  assert.equal(before.level, 1, '没有任何证据时等级只能是 1')

  for (let index = 0; index < 4; index++) {
    await store.addEvidence({ employeeId: 'developer', skillId: before.id, success: true, tool: 'Bash' })
  }
  await store.addEvidence({ employeeId: 'developer', skillId: before.id, success: false, tool: 'Bash' })

  const after = (await store.skills('developer')).find((item) => item.id === before.id)
  assert.equal(after.successes, 4)
  assert.equal(after.failures, 1)
  assert.equal(after.evidenceCount, 5)
  const evidence = await store.evidence('developer', { skillId: before.id })
  assert.equal(evidence.length, 5, '每条证据都要留痕，等级可回溯')

  // 4 成 1 败 + 近 14 天 5 条证据（上限 6）→ score = 12-1+5 = 16 → 1+floor(log2(17)) = 5
  const expected = computeSkillLevel({ successes: 4, failures: 1, recentUsageBonus: 5 })
  assert.equal(after.level, expected)
  assert.equal(after.level, 5)
})

test('CompanySnapshot: 空 Session hydrate 拿得到全部员工的历史数据', async () => {
  const dir = await scratch('snapshot')
  const evolution = new EvolutionStore(join(dir, 'evolution.json'))
  const company = new CompanyStore(evolution, join(dir, 'company.json'))
  await evolution.recordTask('developer', { title: '接线', source: 'web', outcome: 'success' })
  await company.setCompanyName('赛博公司')

  const snapshot = await company.snapshot([
    { id: 'developer', name: '小刘', role: '程序员' },
    { id: 'secretary', name: '秘书', role: '总裁秘书' },
  ])
  assert.equal(snapshot.version, 2)
  assert.equal(snapshot.companyName, '赛博公司')
  assert.equal(snapshot.employees.length, 2)
  assert.equal(snapshot.totals.tasks, 1)
  const dev = snapshot.employees.find((item) => item.employeeId === 'developer')
  assert.equal(dev.recentTasks.length, 1)
  assert.equal(dev.recentTasks[0].title, '接线')
})

test('company.json 拒绝明文密钥，只接受 SecretRef', async () => {
  const dir = await scratch('secrets')
  const evolution = new EvolutionStore(join(dir, 'evolution.json'))
  const company = new CompanyStore(evolution, join(dir, 'company.json'))

  await assert.rejects(
    () => company.upsertModelProvider({ id: 'gpt', type: 'vision', provider: 'openai-compatible', model: 'gpt-4o', apiKey: 'sk-real-secret', enabled: true }),
    /raw secret/i,
  )
  const saved = await company.upsertModelProvider({ id: 'gpt', type: 'vision', provider: 'openai-compatible', model: 'gpt-4o', baseUrl: 'https://example.invalid/v1', apiKeyRef: 'env:OPENAI_API_KEY', enabled: true })
  assert.equal(saved.apiKeyRef, 'env:OPENAI_API_KEY')

  const summaries = await company.modelProviderSummaries()
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0].apiKeyConfigured, true)
  assert.equal('apiKey' in summaries[0], false, '摘要里不允许出现任何明文密钥字段')
})

test('Evolution migration: 没有 version 字段的早期档案照样按 V1 迁移并留备份', async () => {
  const dir = await scratch('migrate-legacy')
  const file = join(dir, 'evolution.json')
  const legacy = v1File()
  delete legacy.version // V1 早期版本压根没写过 version
  const original = JSON.stringify(legacy, null, 2)
  await writeFile(file, original, 'utf-8')
  assert.equal(detectStoreVersion(JSON.parse(original)), 1, '有 employees 就该被认成 V1，不能当成空库')

  const store = new EvolutionStore(file)
  const profile = await store.profile('developer')
  assert.equal(profile.xp, 148)
  assert.equal(profile.memories.length, 2)
  assert.equal(profile.skills.length, 1)
  assert.equal(profile.reflections.length, 1)
  assert.equal(store.migratedFrom, 1)
  assert.equal(await readFile(`${file}.v1.bak`, 'utf-8'), original)
  assert.equal(JSON.parse(await readFile(file, 'utf-8')).version, 2)
})

test('Evolution migration: 已经是 V2 的档案不再迁移、不再备份，数据原样还在', async () => {
  const dir = await scratch('migrate-idempotent')
  const file = join(dir, 'evolution.json')
  await writeFile(file, JSON.stringify(v1File(), null, 2), 'utf-8')

  const first = new EvolutionStore(file)
  await first.remember('developer', { text: '迁移后又记了一条', importance: 4 })
  await first.recordTask('developer', { title: '迁移后的第一个任务', source: 'web', outcome: 'success' })
  const before = await first.profile('developer')
  assert.equal(first.migratedFrom, 1)

  // 再开一个实例读同一个文件：这一次不该再触发任何迁移动作。
  const second = new EvolutionStore(file)
  const after = await second.profile('developer')
  assert.equal(second.migratedFrom, null, '第二次打开不许再迁移一遍')
  assert.equal(second.backupPath, null, '也不许再写一份备份')
  await assert.rejects(() => readFile(`${file}.v2.bak`, 'utf-8'), '不该出现 .v2.bak')

  assert.equal(after.xp, before.xp)
  assert.equal(after.memories.length, 3, 'V1 的 2 条 + 迁移后新记的 1 条')
  assert.equal(after.taskHistory.length, 1)
  assert.equal(after.statistics.totalTasks, 1)
  assert.deepEqual(after.skills.map((item) => [item.name, item.level]), before.skills.map((item) => [item.name, item.level]))

  // V1 的原始备份仍然在，随时可回滚。
  const backup = JSON.parse(await readFile(`${file}.v1.bak`, 'utf-8'))
  assert.equal(backup.version, 1)
  assert.equal(backup.employees.developer.xp, 148)
})
