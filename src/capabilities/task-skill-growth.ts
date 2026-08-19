// 真实任务 → 技能证据的自动成长桥。
//
// 核心原则：
// 1. 只消费 TaskHistory 里宿主真实观测到的 tools；preferredToolHints / LLM 自述不算证据。
// 2. success 记正证据，failed 记负证据；partial / blocked 不知道技能成败，宁可不记。
// 3. 一个工具最多归到一个最匹配的既有技能；找不到可信技能就跳过，不凭空造技能。
// 4. 同一 taskId + skillId + tool 只记一次；重复结单、热重载都不能刷经验。
// 5. 只有等级真的提高才发 skill.updated，办公室的“技能↑”必须对应真实升级。
import type { LearnedSkill, SkillEvidence, TaskHistory, TaskOutcome } from '../persistence/types'

const MAX_EVIDENCE_PER_TASK = 4

const META_TOOL = /^(?:staff_|company_|org[_-]?panel|company_snapshot$)/i

/**
 * 工具族 → 已有技能名称/分类里的语义提示。
 * 顺序就是优先级：越靠前权重越高。这里只用于“在多个既有技能之间选哪个”，不会据此新建技能。
 */
export const TASK_TOOL_SKILL_HINTS: Array<{ match: RegExp; hints: string[] }> = [
  { match: /(test|vitest|jest|pytest|playwright|spec|lint|typecheck|tsc|build|compile|bundle)/i, hints: ['测试', '质量', '验证', '调试', '工程', '开发'] },
  { match: /(grep|glob|search_files|find|ripgrep)/i, hints: ['调试', '检索', '搜索', '排查', '开发', '工程'] },
  { match: /(edit|write|patch|str_replace|multi_edit|bash|shell|pwsh|terminal|exec|codex|git|github|repo|file)/i, hints: ['开发', '工程', '代码', '实现', '重构', '调试', '架构'] },
  { match: /(web_search|web_fetch|browser|search|crawl|fetch|research)/i, hints: ['搜索', '检索', '调研', '情报', '研究', '人才', '招聘', '增长', '竞品'] },
  { match: /(image|vision|figma|canva|fal|photo|draw|diffusion)/i, hints: ['视觉', '图片', '设计', '创作', '海报', '图像'] },
  { match: /(video|ffmpeg|remotion|subtitle|audio|voice|tts)/i, hints: ['视频', '剪辑', '分镜', '镜头', '字幕', '音频'] },
  { match: /(python|sql|database|postgres|supabase|spreadsheet|analytics|chart|data)/i, hints: ['数据', '分析', '统计', '指标', '报表', '可视化'] },
  { match: /(cordis|mcp|plugin|registry|capability|extension)/i, hints: ['插件', '平台', '能力', '集成', '扩展', '适配'] },
  { match: /(subagent|workflow|todo|send_message|list_agents|meeting|schedule)/i, hints: ['调度', '协调', '管理', '架构', '会议', '组织'] },
  { match: /(write_doc|document|docs|markdown|knowledge)/i, hints: ['文档', '知识', '整理', '归档'] },
]

export type TaskSkillEvidencePlan = {
  skillId: string
  skillName: string
  tool: string
  success: boolean
  score: number
}

function clean(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function uniqueTools(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values || []) {
    const value = String(raw || '').trim()
    if (!value || META_TOOL.test(value)) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function ruleFor(tool: string): { match: RegExp; hints: string[] } | undefined {
  return TASK_TOOL_SKILL_HINTS.find((item) => item.match.test(tool))
}

/** 单个真实工具对一个既有技能的保守匹配分。0 = 没有足够依据。 */
export function taskToolSkillScore(skill: LearnedSkill, tool: string): number {
  const normalizedTool = clean(tool)
  if (!normalizedTool || META_TOOL.test(tool)) return 0
  const declared = (skill.toolNames || []).some((name) => clean(name) === normalizedTool)
  const text = clean([skill.name, skill.category, skill.summary].filter(Boolean).join(' '))
  const rule = ruleFor(tool)
  let semantic = 0
  if (rule) {
    for (let index = 0; index < rule.hints.length; index++) {
      const hint = clean(rule.hints[index])
      if (!hint || !text.includes(hint)) continue
      semantic = Math.max(semantic, 40 - index * 4)
    }
  }
  // 唯一绑定的插件技能经常没有中文语义命中；显式 toolNames 仍是一条有效事实。
  // 但种子技能可能共享同一批 preferredToolHints，所以语义分高于“只是声明过这个工具”。
  return (declared ? 20 : 0) + semantic
}

/**
 * 一条已完成任务应该给哪些既有技能记证据。
 * 每个 skill 每个任务最多一条，避免 edit+write+patch 把同一个技能在一次任务里刷三次。
 */
export function planTaskSkillEvidence(
  skills: readonly LearnedSkill[],
  tools: readonly string[],
  outcome: TaskOutcome,
): TaskSkillEvidencePlan[] {
  if (outcome !== 'success' && outcome !== 'failed') return []
  const success = outcome === 'success'
  const bestBySkill = new Map<string, TaskSkillEvidencePlan>()

  for (const tool of uniqueTools(tools)) {
    let best: { skill: LearnedSkill; score: number; index: number } | null = null
    for (let index = 0; index < (skills || []).length; index++) {
      const skill = skills[index]
      const score = taskToolSkillScore(skill, tool)
      if (score <= 0) continue
      if (!best || score > best.score || (score === best.score && index < best.index)) best = { skill, score, index }
    }
    if (!best) continue
    const plan: TaskSkillEvidencePlan = { skillId: best.skill.id, skillName: best.skill.name, tool, success, score: best.score }
    const current = bestBySkill.get(plan.skillId)
    if (!current || plan.score > current.score) bestBySkill.set(plan.skillId, plan)
  }

  return [...bestBySkill.values()]
    .sort((a, b) => b.score - a.score || a.skillName.localeCompare(b.skillName))
    .slice(0, MAX_EVIDENCE_PER_TASK)
}

export type TaskGrowthStore = {
  completeTask(taskId: string, input: any, employeeId?: string): Promise<TaskHistory>
  recordTask(employeeId: string, input: any): Promise<TaskHistory>
  task(taskId: string, employeeId?: string): Promise<TaskHistory | null>
  skills(employeeId: string): Promise<LearnedSkill[]>
  evidence(employeeId: string, options?: { skillId?: string; limit?: number }): Promise<SkillEvidence[]>
  addEvidence(input: {
    employeeId: string
    skillId?: string
    taskId?: string
    tool?: string
    success: boolean
  }): Promise<SkillEvidence>
}

export type TaskGrowthEvent = {
  id: string
  type: 'skill.updated'
  at: number
  employeeId: string
  skillName: string
  skillId?: string
  level?: number
  source?: string
}

export type TaskSkillGrowthRuntime = {
  /** 手动补算一条已经完成的任务；主要给迁移/测试用。 */
  syncTask(task: TaskHistory): Promise<number>
  dispose(): void
}

export function installTaskSkillGrowth(store: TaskGrowthStore, options: {
  emit?: (event: TaskGrowthEvent) => void
  onError?: (error: unknown, task?: TaskHistory) => void
} = {}): TaskSkillGrowthRuntime {
  const originalCompleteTask = store.completeTask.bind(store)
  const originalRecordTask = store.recordTask.bind(store)
  let disposed = false
  let queue: Promise<void> = Promise.resolve()

  const syncTaskNow = async (task: TaskHistory): Promise<number> => {
    if (!task?.completedAt || (task.outcome !== 'success' && task.outcome !== 'failed')) return 0
    const skills = await store.skills(task.employeeId)
    const plans = planTaskSkillEvidence(skills, task.tools || [], task.outcome)
    if (!plans.length) return 0
    let created = 0

    for (const plan of plans) {
      const existing = await store.evidence(task.employeeId, { skillId: plan.skillId, limit: 100000 })
      if (existing.some((item) => item.taskId === task.id && String(item.tool || '').toLowerCase() === plan.tool.toLowerCase())) continue
      const before = (await store.skills(task.employeeId)).find((item) => item.id === plan.skillId)
      if (!before) continue
      const evidence = await store.addEvidence({
        employeeId: task.employeeId,
        skillId: plan.skillId,
        taskId: task.id,
        tool: plan.tool,
        success: plan.success,
      })
      created += 1
      const after = (await store.skills(task.employeeId)).find((item) => item.id === plan.skillId)
      // skill.updated 在办公室里明确表示“技能真的升了”，普通证据只进档案时间线，不冒充升级动画。
      if (after && after.level > before.level) {
        options.emit?.({
          id: `task-skill-up:${evidence.id}`,
          type: 'skill.updated',
          at: evidence.createdAt,
          employeeId: task.employeeId,
          skillName: after.name,
          skillId: after.id,
          level: after.level,
          source: 'task-evidence',
        })
      }
    }
    return created
  }

  const enqueue = (task: TaskHistory): Promise<number> => {
    let resolveCount: (value: number) => void = () => undefined
    const result = new Promise<number>((resolve) => { resolveCount = resolve })
    queue = queue.then(async () => {
      try { resolveCount(await syncTaskNow(task)) }
      catch (error) { options.onError?.(error, task); resolveCount(0) }
    })
    return result
  }

  const completeWrapped = async (taskId: string, input: any, employeeId?: string): Promise<TaskHistory> => {
    // 只在“第一次从进行中变成已完成”时自动成长。重复 completeTask 是修正履历，不得再次刷证据。
    let before: TaskHistory | null = null
    try { before = await store.task(taskId, employeeId) } catch { before = null }
    const task = await originalCompleteTask(taskId, input, employeeId)
    if (!disposed && before && !before.completedAt) await enqueue(task)
    return task
  }

  const recordWrapped = async (employeeId: string, input: any): Promise<TaskHistory> => {
    const task = await originalRecordTask(employeeId, input)
    if (!disposed) await enqueue(task)
    return task
  }

  ;(store as any).completeTask = completeWrapped
  ;(store as any).recordTask = recordWrapped

  return {
    syncTask: enqueue,
    dispose(): void {
      if (disposed) return
      disposed = true
      if ((store as any).completeTask === completeWrapped) (store as any).completeTask = originalCompleteTask
      if ((store as any).recordTask === recordWrapped) (store as any).recordTask = originalRecordTask
    },
  }
}
