// evolution.json 的版本迁移与入库清洗。
// 铁律：升级绝不能清空用户数据。V1 已有的 memories / skills / reflections / xp 全量保留，
// V2 新增字段一律给空默认值；迁移前必须先把原文件备份成 evolution.json.v1.bak。
// 另一条铁律：不凭空捏造任务。V1 没有 TaskHistory，迁移后 taskHistory 就是空的，不从复盘伪造履历。
import { writeFile } from 'node:fs/promises'
import {
  MEMORY_KINDS, STORE_VERSION, createEmptyEvolution, emptyStatistics, skillLevelFrom,
  type EmployeeEvolutionV2, type EmployeeMemory, type EmployeeStatistics, type LearnedSkill, type MemoryKind,
  type ModelBinding, type ModelBindingStatus, type ModelCapability, type PluginBinding, type PluginSource, type PluginStatus,
  type Reflection, type SkillEvidence, type SkillSource, type StoreFileV2, type TaskHistory, type TaskOutcome, type TaskSource,
} from './types'

/** 单个员工各集合的保留上限；超出后按重要度/时间裁剪。 */
export const STORE_LIMITS = { memories: 120, reflections: 80, skills: 80, tasks: 200, evidence: 400, plugins: 60, models: 20 }

const OUTCOMES: TaskOutcome[] = ['success', 'partial', 'blocked', 'failed']
const TASK_SOURCES: TaskSource[] = ['web', 'feishu', 'qq', 'wechat', 'system']
const SKILL_SOURCES: SkillSource[] = ['seed', 'experience', 'plugin', 'manual']
const PLUGIN_SOURCES: PluginSource[] = ['dsh-market', 'github', 'mcp', 'builtin']
const PLUGIN_STATUS: PluginStatus[] = ['available', 'degraded', 'missing', 'disabled']
const MODEL_CAPABILITIES: ModelCapability[] = ['text', 'vision', 'image-generation', 'video-generation', 'embedding']
const MODEL_STATUS: ModelBindingStatus[] = ['available', 'missing', 'disabled']

function now() { return Date.now() }
function id(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
function text(value: unknown, fallback = ''): string { const out = typeof value === 'string' ? value.trim() : ''; return out || fallback }
function count(value: unknown, fallback = 0): number { const out = Number(value); return Number.isFinite(out) ? Math.max(0, Math.floor(out)) : fallback }
function stamp(value: unknown, fallback = 0): number { const out = Number(value); return Number.isFinite(out) && out > 0 ? out : fallback }
function list(value: unknown): string[] { return Array.isArray(value) ? Array.from(new Set(value.map(String).map((item) => item.trim()).filter(Boolean))) : [] }
function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T { const out = String(value ?? '') as T; return allowed.includes(out) ? out : fallback }
function optional(value: unknown): string | undefined { const out = text(value); return out || undefined }

function sanitizeMemory(raw: any, employeeId: string, time: number): EmployeeMemory | null {
  const body = text(raw?.text)
  if (!body) return null
  const createdAt = stamp(raw?.createdAt, time)
  return {
    id: text(raw?.id) || id('mem'),
    employeeId,
    kind: pick<MemoryKind>(raw?.kind, MEMORY_KINDS, 'lesson'),
    text: body,
    tags: list(raw?.tags),
    importance: clamp(count(raw?.importance, 3) || 3, 1, 5),
    createdAt,
    updatedAt: stamp(raw?.updatedAt, createdAt),
    lastUsedAt: stamp(raw?.lastUsedAt, 0),
    useCount: count(raw?.useCount, 0),
  }
}

function sanitizeSkill(raw: any, employeeId: string, time: number): LearnedSkill | null {
  const name = text(raw?.name)
  if (!name) return null
  const createdAt = stamp(raw?.createdAt, time)
  // level 不从文件里读：V2 起等级永远由证据重算，避免把 V1 里 LLM 影响过的等级带进来。
  return {
    id: text(raw?.id) || id('skill'),
    employeeId,
    name,
    category: text(raw?.category, '通用能力'),
    summary: text(raw?.summary),
    source: pick<SkillSource>(raw?.source, SKILL_SOURCES, 'experience'),
    toolNames: list(raw?.toolNames),
    pluginNames: list(raw?.pluginNames),
    level: 1,
    successes: count(raw?.successes, 0),
    failures: count(raw?.failures, 0),
    evidenceCount: count(raw?.evidenceCount, 0),
    lastUsedAt: stamp(raw?.lastUsedAt, 0),
    createdAt,
    updatedAt: stamp(raw?.updatedAt, createdAt),
  }
}

function sanitizeReflection(raw: any, employeeId: string, time: number): Reflection | null {
  const task = text(raw?.task)
  const lesson = text(raw?.lesson)
  if (!task && !lesson) return null
  return {
    id: text(raw?.id) || id('ref'),
    employeeId,
    task,
    outcome: pick<TaskOutcome>(raw?.outcome, OUTCOMES, 'partial'),
    lesson,
    createdAt: stamp(raw?.createdAt, time),
  }
}

function sanitizeTask(raw: any, employeeId: string, time: number): TaskHistory | null {
  const title = text(raw?.title)
  if (!title) return null
  const startedAt = stamp(raw?.startedAt, time)
  const completedAt = stamp(raw?.completedAt, 0)
  return {
    id: text(raw?.id) || id('task'),
    employeeId,
    title,
    description: optional(raw?.description),
    source: pick<TaskSource>(raw?.source, TASK_SOURCES, 'web'),
    channelId: optional(raw?.channelId),
    startedAt,
    completedAt: completedAt || undefined,
    outcome: pick<TaskOutcome>(raw?.outcome, OUTCOMES, 'partial'),
    tools: list(raw?.tools),
    plugins: list(raw?.plugins),
    models: list(raw?.models),
    summary: optional(raw?.summary),
  }
}

function sanitizeEvidence(raw: any, employeeId: string, time: number): SkillEvidence | null {
  const skillId = text(raw?.skillId)
  if (!skillId) return null
  const duration = stamp(raw?.duration, 0)
  return {
    id: text(raw?.id) || id('ev'),
    employeeId,
    skillId,
    taskId: optional(raw?.taskId),
    tool: optional(raw?.tool),
    plugin: optional(raw?.plugin),
    model: optional(raw?.model),
    success: raw?.success !== false,
    duration: duration || undefined,
    createdAt: stamp(raw?.createdAt, time),
  }
}

function sanitizePlugin(raw: any, time: number): PluginBinding | null {
  const packageName = text(raw?.packageName)
  const pluginId = text(raw?.pluginId) || packageName
  if (!pluginId || !packageName) return null
  const installedAt = stamp(raw?.installedAt, time)
  return {
    pluginId,
    packageName,
    version: optional(raw?.version),
    source: pick<PluginSource>(raw?.source, PLUGIN_SOURCES, 'dsh-market'),
    tools: list(raw?.tools),
    installedAt,
    lastVerifiedAt: stamp(raw?.lastVerifiedAt, installedAt),
    // 未通过验证的绑定读回来先按 missing 处理，宁可少显示也不谎报「已学会」。
    status: pick<PluginStatus>(raw?.status, PLUGIN_STATUS, 'missing'),
    approvedBy: 'boss',
  }
}

function sanitizeModel(raw: any): ModelBinding | null {
  const providerId = text(raw?.providerId)
  if (!providerId) return null
  return {
    capability: pick<ModelCapability>(raw?.capability, MODEL_CAPABILITIES, 'text'),
    providerId,
    priority: clamp(count(raw?.priority, 1) || 1, 1, 99),
    status: pick<ModelBindingStatus>(raw?.status, MODEL_STATUS, 'missing'),
  }
}

function sanitizeStatistics(raw: any): EmployeeStatistics {
  const fallback = emptyStatistics()
  return {
    totalTasks: count(raw?.totalTasks, fallback.totalTasks),
    successCount: count(raw?.successCount, fallback.successCount),
    partialCount: count(raw?.partialCount, fallback.partialCount),
    failedCount: count(raw?.failedCount, fallback.failedCount),
    blockedCount: count(raw?.blockedCount, fallback.blockedCount),
    memoryCount: count(raw?.memoryCount, fallback.memoryCount),
    skillCount: count(raw?.skillCount, fallback.skillCount),
    evidenceCount: count(raw?.evidenceCount, fallback.evidenceCount),
    pluginCount: count(raw?.pluginCount, fallback.pluginCount),
    modelCount: count(raw?.modelCount, fallback.modelCount),
    totalDurationMs: count(raw?.totalDurationMs, fallback.totalDurationMs),
    lastTaskAt: stamp(raw?.lastTaskAt, fallback.lastTaskAt),
    lastActiveAt: stamp(raw?.lastActiveAt, fallback.lastActiveAt),
  }
}

/** 重算派生统计（集合规模类字段），终身累计计数不动。 */
export function refreshDerivedStatistics(profile: EmployeeEvolutionV2, time = now()) {
  const statistics = profile.statistics
  statistics.memoryCount = profile.memories.length
  statistics.skillCount = profile.skills.length
  statistics.evidenceCount = profile.skillEvidence.length
  statistics.pluginCount = profile.pluginBindings.filter((item) => item.status === 'available' || item.status === 'degraded').length
  statistics.modelCount = profile.modelBindings.filter((item) => item.status === 'available').length
  statistics.lastActiveAt = Math.max(statistics.lastActiveAt, time)
}

/** 把任意一份（V1 或 V2）员工数据清洗成合法 V2 结构。 */
export function migrateEmployee(raw: any, employeeId: string, time = now()): EmployeeEvolutionV2 {
  const profile = createEmptyEvolution(employeeId, time)
  if (!raw || typeof raw !== 'object') return profile
  profile.revision = Math.max(1, count(raw.revision, 1) || 1)
  profile.xp = count(raw.xp, 0)
  profile.updatedAt = stamp(raw.updatedAt, time)
  profile.memories = (Array.isArray(raw.memories) ? raw.memories : []).map((item: any) => sanitizeMemory(item, employeeId, time)).filter(Boolean).slice(-STORE_LIMITS.memories) as EmployeeMemory[]
  profile.skills = (Array.isArray(raw.skills) ? raw.skills : []).map((item: any) => sanitizeSkill(item, employeeId, time)).filter(Boolean).slice(-STORE_LIMITS.skills) as LearnedSkill[]
  profile.reflections = (Array.isArray(raw.reflections) ? raw.reflections : []).map((item: any) => sanitizeReflection(item, employeeId, time)).filter(Boolean).slice(-STORE_LIMITS.reflections) as Reflection[]
  profile.taskHistory = (Array.isArray(raw.taskHistory) ? raw.taskHistory : []).map((item: any) => sanitizeTask(item, employeeId, time)).filter(Boolean).slice(-STORE_LIMITS.tasks) as TaskHistory[]
  profile.skillEvidence = (Array.isArray(raw.skillEvidence) ? raw.skillEvidence : []).map((item: any) => sanitizeEvidence(item, employeeId, time)).filter(Boolean).slice(-STORE_LIMITS.evidence) as SkillEvidence[]
  profile.pluginBindings = (Array.isArray(raw.pluginBindings) ? raw.pluginBindings : []).map((item: any) => sanitizePlugin(item, time)).filter(Boolean).slice(-STORE_LIMITS.plugins) as PluginBinding[]
  profile.modelBindings = (Array.isArray(raw.modelBindings) ? raw.modelBindings : []).map((item: any) => sanitizeModel(item)).filter(Boolean).slice(-STORE_LIMITS.models) as ModelBinding[]
  profile.statistics = sanitizeStatistics(raw.statistics)
  // 只保留有对应技能的证据，避免孤儿数据把等级算歪。
  const skillIds = new Set(profile.skills.map((item) => item.id))
  profile.skillEvidence = profile.skillEvidence.filter((item) => skillIds.has(item.skillId))
  for (const skill of profile.skills) skill.level = skillLevelFrom(skill, profile.skillEvidence, time)
  refreshDerivedStatistics(profile, profile.updatedAt || time)
  return profile
}

export function detectStoreVersion(raw: any): number {
  const version = Number(raw?.version)
  if (Number.isFinite(version) && version > 0) return Math.floor(version)
  return raw && typeof raw === 'object' && raw.employees ? 1 : 0
}

/** 读盘后的统一入口：任何版本都归一到 V2，并告知是否发生了版本升级。 */
export function migrateStoreFile(raw: any, time = now()): { file: StoreFileV2; fromVersion: number; migrated: boolean } {
  const fromVersion = detectStoreVersion(raw)
  const employees: Record<string, EmployeeEvolutionV2> = {}
  for (const [employeeId, value] of Object.entries(raw?.employees || {})) employees[employeeId] = migrateEmployee(value, employeeId, time)
  return { file: { version: STORE_VERSION as 2, employees }, fromVersion, migrated: fromVersion > 0 && fromVersion < STORE_VERSION }
}

/**
 * 覆盖写 V2 之前先备份旧文件；备份失败不阻断读取，但会返回 null 供调用方记日志。
 * 备份路径形如 ~/.dsh-org-panel/evolution.json.v1.bak。
 */
export async function backupLegacyStore(filePath: string, rawText: string, fromVersion: number): Promise<string | null> {
  const target = `${filePath}.v${Math.max(1, Math.floor(fromVersion) || 1)}.bak`
  try {
    await writeFile(target, rawText, 'utf-8')
    return target
  } catch {
    return null
  }
}
