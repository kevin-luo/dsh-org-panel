import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILE = resolve(HERE, '..', 'src', 'client-v9', 'game', 'career-timeline.ts')
const source = readFileSync(FILE, 'utf8')
const output = ts.transpileModule(source, {
  fileName: FILE,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const box = { exports: {} }
new Function('module', 'exports', 'require', output)(box, box.exports, () => ({}))
const Timeline = box.exports

function snapshot(overrides = {}) {
  return {
    employeeId: 'dev', name: '小刘', role: '开发', revision: 1, xp: 720,
    level: { level: 4, title: '熟练员工', progress: 0.5 },
    statistics: {
      totalTasks: 1, successCount: 1, partialCount: 0, failedCount: 0, blockedCount: 0,
      memoryCount: 1, skillCount: 1, evidenceCount: 1, pluginCount: 1, modelCount: 0,
      totalDurationMs: 1000, lastTaskAt: 400, lastActiveAt: 400,
    },
    skills: [{
      id: 'ts', employeeId: 'dev', name: 'TypeScript', category: 'dev', summary: '长期写 TS 获得', source: 'experience',
      toolNames: ['edit'], pluginNames: [], level: 4, successes: 3, failures: 0, evidenceCount: 1,
      lastUsedAt: 350, createdAt: 100, updatedAt: 350,
      recentEvidence: [{ id: 'ev-1', employeeId: 'dev', skillId: 'ts', taskId: 'task-1', tool: 'edit', success: true, createdAt: 350 }],
    }],
    plugins: [{
      pluginId: 'github', packageName: '@dsh/github', version: '1.2.0', source: 'dsh-market', tools: ['github_search'],
      installedAt: 250, lastVerifiedAt: 260, status: 'available', approvedBy: 'boss',
    }],
    models: [],
    recentTasks: [{
      id: 'task-1', employeeId: 'dev', title: '修复线上问题', source: 'qq', channelId: 'group-1',
      startedAt: 300, completedAt: 400, outcome: 'success', tools: ['edit'], plugins: ['@dsh/github'], models: [], summary: '修复完成',
    }],
    recentReflections: [{ id: 'r1', employeeId: 'dev', task: '修复线上问题', outcome: 'success', lesson: '先复现再改', createdAt: 390 }],
    memoryCounts: { preference: 0, lesson: 1, project: 0, fact: 0, relationship: 0, workflow: 0 },
    recentMemories: [{ id: 'm1', employeeId: 'dev', kind: 'lesson', text: '线上问题先复现', tags: ['debug'], importance: 5, createdAt: 200, updatedAt: 410, lastUsedAt: 410, useCount: 1 }],
    updatedAt: 410,
    ...overrides,
  }
}

test('career timeline: 只用档案中真实存在的事件，并按真实时间倒序', () => {
  const rows = Timeline.careerTimeline(snapshot())
  assert.deepEqual(rows.map((row) => row.at), [410, 400, 390, 350, 250, 100])
  assert.equal(rows[1].title, '完成任务 · 修复线上问题')
  assert.equal(rows[1].source, 'QQ')
  assert.equal(rows[3].title, '技能验证成功 · TypeScript')
  assert.equal(rows[4].title, '获得插件 · @dsh/github')
})

test('career timeline: 当前 Lv/XP 不得被倒推出不存在的晋升历史', () => {
  const rows = Timeline.careerTimeline(snapshot({
    level: { level: 9, title: '领域专家', progress: 0.8 },
    xp: 99999,
    recentTasks: [], skills: [], plugins: [], recentReflections: [], recentMemories: [],
  }))
  assert.deepEqual(rows, [])
  assert.equal(rows.some((row) => /晋升|Lv\./.test(row.title)), false)
})

test('career timeline: 没有合法时间戳的数据不会伪造 Date.now', () => {
  const data = snapshot({
    recentTasks: [{ id: 'x', employeeId: 'dev', title: '无时间任务', source: 'web', startedAt: 0, outcome: 'partial', tools: [], plugins: [], models: [] }],
    skills: [{ ...snapshot().skills[0], createdAt: 0, recentEvidence: [{ ...snapshot().skills[0].recentEvidence[0], createdAt: 0 }] }],
    plugins: [{ ...snapshot().plugins[0], installedAt: 0 }],
    recentReflections: [{ ...snapshot().recentReflections[0], createdAt: 0 }],
    recentMemories: [{ ...snapshot().recentMemories[0], createdAt: 0, updatedAt: 0 }],
  })
  assert.deepEqual(Timeline.careerTimeline(data), [])
})

test('career timeline: limit 有上限，避免大档案一次渲染几千条', () => {
  const recentTasks = Array.from({ length: 300 }, (_, index) => ({
    id: `t-${index}`, employeeId: 'dev', title: `任务 ${index}`, source: 'web', startedAt: index + 1,
    completedAt: index + 1, outcome: 'success', tools: [], plugins: [], models: [],
  }))
  const rows = Timeline.careerTimeline(snapshot({ recentTasks, skills: [], plugins: [], recentReflections: [], recentMemories: [] }), 500)
  assert.equal(rows.length, 200)
  assert.equal(rows[0].at, 300)
})
