import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILE = resolve(HERE, '..', 'src', 'capabilities', 'task-skill-growth.ts')
const source = readFileSync(FILE, 'utf8')
const output = ts.transpileModule(source, {
  fileName: FILE,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const box = { exports: {} }
new Function('module', 'exports', 'require', output)(box, box.exports, () => ({}))
const Growth = box.exports

function skill(id, name, category, toolNames = []) {
  return {
    id, employeeId: 'developer', name, category, summary: `${name}的真实岗位能力`, source: 'seed',
    toolNames, pluginNames: [], level: 1, successes: 0, failures: 0, evidenceCount: 0,
    lastUsedAt: 0, createdAt: 1, updatedAt: 1,
  }
}

test('task growth: 共享 preferredToolHints 时按工具语义只归到一个最匹配技能', () => {
  const skills = [
    skill('dev', '前后端开发', '工程实现', ['edit', 'grep', 'test']),
    skill('debug', '调试', '问题排查', ['edit', 'grep', 'test']),
    skill('test', '测试', '质量验证', ['edit', 'grep', 'test']),
  ]
  const plans = Growth.planTaskSkillEvidence(skills, ['edit', 'grep', 'test', 'staff_memory_recall'], 'success')
  assert.deepEqual(plans.map((item) => [item.tool, item.skillName]).sort(), [
    ['edit', '前后端开发'],
    ['grep', '调试'],
    ['test', '测试'],
  ].sort())
  assert.equal(plans.every((item) => item.success === true), true)
})

test('task growth: partial / blocked 不知道技能成败，一条证据都不猜', () => {
  const skills = [skill('dev', '前后端开发', '工程实现', ['edit'])]
  assert.deepEqual(Growth.planTaskSkillEvidence(skills, ['edit'], 'partial'), [])
  assert.deepEqual(Growth.planTaskSkillEvidence(skills, ['edit'], 'blocked'), [])
})

test('task growth: 陌生工具找不到可信既有技能时不凭空造技能', () => {
  const skills = [skill('pm', '需求分析', '产品', [])]
  assert.deepEqual(Growth.planTaskSkillEvidence(skills, ['totally_unknown_runtime_tool'], 'success'), [])
})

function fakeStore() {
  const skills = [skill('dev', '前后端开发', '工程实现', ['edit', 'write', 'patch'])]
  const tasks = new Map([
    ['t1', { id: 't1', employeeId: 'developer', title: '实现功能', source: 'web', startedAt: 10, outcome: 'partial', tools: [], plugins: [], models: [] }],
    ['t2', { id: 't2', employeeId: 'developer', title: '继续实现', source: 'web', startedAt: 20, outcome: 'partial', tools: [], plugins: [], models: [] }],
    ['t3', { id: 't3', employeeId: 'developer', title: '失败任务', source: 'web', startedAt: 30, outcome: 'partial', tools: [], plugins: [], models: [] }],
  ])
  const evidence = []
  let seq = 0
  const clone = (value) => JSON.parse(JSON.stringify(value))
  return {
    _skills: skills,
    _tasks: tasks,
    _evidence: evidence,
    async task(taskId) { return tasks.has(taskId) ? clone(tasks.get(taskId)) : null },
    async skills() { return clone(skills) },
    async evidence(_employeeId, options = {}) {
      return clone(evidence.filter((row) => !options.skillId || row.skillId === options.skillId))
    },
    async addEvidence(input) {
      seq += 1
      const row = { id: `ev${seq}`, createdAt: 100 + seq, ...input }
      evidence.push(row)
      const target = skills.find((item) => item.id === input.skillId)
      if (target) {
        if (input.success) target.successes += 1
        else target.failures += 1
        target.evidenceCount += 1
        target.lastUsedAt = row.createdAt
        // 第一次真实成功跨到 Lv.2；后续证据保持 Lv.2，方便断言“证据更新 ≠ 每次都升级”。
        if (input.success && target.successes === 1) target.level = 2
      }
      return clone(row)
    },
    async completeTask(taskId, input) {
      const task = tasks.get(taskId)
      if (!task) throw new Error('unknown task')
      task.completedAt = input.completedAt || 200 + seq
      task.outcome = input.outcome
      task.summary = input.summary
      task.tools = Array.from(new Set([...(task.tools || []), ...(input.tools || [])]))
      return clone(task)
    },
    async recordTask(employeeId, input) {
      const row = {
        id: `record-${tasks.size}`, employeeId, title: input.title, source: input.source || 'system',
        startedAt: input.startedAt || 1, completedAt: input.completedAt || 2, outcome: input.outcome,
        tools: [...(input.tools || [])], plugins: [], models: [], summary: input.summary,
      }
      tasks.set(row.id, row)
      return clone(row)
    },
  }
}

test('task growth: 首次真实结单自动写证据；重复结单不能刷，只有跨级才发事件', async () => {
  const store = fakeStore()
  const events = []
  const runtime = Growth.installTaskSkillGrowth(store, { emit: (event) => events.push(event) })

  await store.completeTask('t1', { outcome: 'success', tools: ['edit', 'write', 'patch'] })
  assert.equal(store._evidence.length, 1, '一次任务同一个技能最多一条证据')
  assert.equal(store._evidence[0].taskId, 't1')
  assert.equal(store._evidence[0].success, true)
  assert.equal(store._skills[0].level, 2)
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'skill.updated')
  assert.equal(events[0].level, 2)
  assert.equal(events[0].source, 'task-evidence')

  await store.completeTask('t1', { outcome: 'success', tools: ['edit'] })
  assert.equal(store._evidence.length, 1, '重复 completeTask 只能修履历，不能重复涨证据')
  assert.equal(events.length, 1)

  await store.completeTask('t2', { outcome: 'success', tools: ['edit'] })
  assert.equal(store._evidence.length, 2)
  assert.equal(events.length, 1, '有新证据但没跨等级时不能冒充一次升级事件')

  await store.completeTask('t3', { outcome: 'failed', tools: ['edit'] })
  assert.equal(store._evidence.length, 3)
  assert.equal(store._evidence.at(-1).success, false, '真实失败必须沉淀负证据')
  assert.equal(events.length, 1)

  runtime.dispose()
})

test('task growth: recordTask 回填也走同一规则，dispose 后彻底停止自动成长', async () => {
  const store = fakeStore()
  const runtime = Growth.installTaskSkillGrowth(store)
  await store.recordTask('developer', { title: '系统回填任务', outcome: 'success', tools: ['edit'] })
  assert.equal(store._evidence.length, 1)

  runtime.dispose()
  store._tasks.set('after', { id: 'after', employeeId: 'developer', title: '卸载后', source: 'web', startedAt: 1, outcome: 'partial', tools: [], plugins: [], models: [] })
  await store.completeTask('after', { outcome: 'success', tools: ['edit'] })
  assert.equal(store._evidence.length, 1, '卸载后原 Store 行为恢复，不能残留 wrapper')
})
