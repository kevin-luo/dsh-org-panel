import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILE = resolve(HERE, '..', 'src', 'client-v9', 'game', 'company-game.ts')
const source = readFileSync(FILE, 'utf8')
const output = ts.transpileModule(source, {
  fileName: FILE,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const box = { exports: {} }
new Function('module', 'exports', 'require', output)(box, box.exports, () => ({}))
const Game = box.exports

function employee(overrides = {}) {
  return {
    employeeId: 'dev', name: '小刘', role: '开发', revision: 1, xp: 720,
    level: { level: 4, title: '熟练员工', progress: 0.5 },
    statistics: {
      totalTasks: 20, successCount: 15, partialCount: 2, failedCount: 2, blockedCount: 1,
      memoryCount: 3, skillCount: 2, evidenceCount: 13, pluginCount: 1, modelCount: 1,
      totalDurationMs: 1000, lastTaskAt: 1, lastActiveAt: 1,
    },
    skills: [
      { id: 'ts', employeeId: 'dev', name: 'TypeScript', category: 'dev', summary: '', source: 'experience', toolNames: [], pluginNames: [], level: 5, successes: 10, failures: 1, evidenceCount: 11, lastUsedAt: 1, createdAt: 1, updatedAt: 1, recentEvidence: [] },
      { id: 'git', employeeId: 'dev', name: 'Git', category: 'dev', summary: '', source: 'experience', toolNames: [], pluginNames: [], level: 3, successes: 2, failures: 0, evidenceCount: 2, lastUsedAt: 1, createdAt: 1, updatedAt: 1, recentEvidence: [] },
    ],
    plugins: [], models: [], recentTasks: [{ id: 't1', employeeId: 'dev', title: '修复 CI', source: 'web', startedAt: 1, completedAt: 2, outcome: 'success', tools: [], plugins: [], models: [] }],
    recentReflections: [],
    memoryCounts: { preference: 4, lesson: 6, project: 5, fact: 3, relationship: 1, workflow: 2 },
    recentMemories: [], updatedAt: 2,
    ...overrides,
  }
}

test('game projection: 等级、XP、技能、记忆和空间全部来自持久化快照', () => {
  const state = Game.employeeGameState(employee())
  assert.equal(state.level, 4)
  assert.equal(state.xp, 720)
  assert.equal(state.workspaceTier, '专业工位')
  assert.equal(state.memories, 21)
  assert.equal(state.topSkill.name, 'TypeScript')
  assert.equal(state.topSkill.level, 5)
  assert.equal(state.successRate, 0.75)
  assert.ok(state.badges.includes('长期记忆'))
})

test('game projection: 不得凭空制造等级或成功率', () => {
  const state = Game.employeeGameState(employee({
    xp: 0,
    level: { level: 1, title: '新员工', progress: 0 },
    statistics: { ...employee().statistics, totalTasks: 0, successCount: 0, skillCount: 0, evidenceCount: 0, pluginCount: 0 },
    skills: [], memoryCounts: { preference: 0, lesson: 0, project: 0, fact: 0, relationship: 0, workflow: 0 },
  }))
  assert.equal(state.level, 1)
  assert.equal(state.workspaceTier, '基础工位')
  assert.equal(state.successRate, null)
  assert.equal(state.topSkill, undefined)
  assert.deepEqual(state.badges, [])
})

test('company projection: 公司经营指标由员工真实终身统计聚合', () => {
  const snapshot = {
    version: 2, generatedAt: 1, companyName: '赛博公司', models: [],
    employees: [employee(), employee({ employeeId: 'design', xp: 1280, level: { level: 6, title: '资深员工', progress: 0.2 }, statistics: { ...employee().statistics, totalTasks: 10, successCount: 9 } })],
    totals: { employees: 2, tasks: 30, success: 24, failed: 2, blocked: 1, memories: 42, skills: 4, plugins: 2, xp: 2000 },
  }
  const company = Game.companyGameState(snapshot)
  assert.equal(company.xp, 2000)
  assert.equal(company.averageLevel, 5)
  assert.equal(company.veterans, 1)
  assert.equal(company.totalTasks, 30)
  assert.equal(company.successRate, 0.8)
})
