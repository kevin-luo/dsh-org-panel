// 「赛博公司」V2 持久化数据结构：evolution.json / company.json 的唯一类型来源。
// 约束：本文件必须保持「纯数据 + 纯函数」，禁止 import node:* 或任何带副作用的模块，
// 这样 host 侧与 client 侧（浏览器 bundle）可以共用同一份类型与派生算法。

export const STORE_VERSION = 2

// ---------------------------------------------------------------------------
// Secret 引用（需求文档三十一）：配置里只允许出现引用，绝不允许出现明文密钥。
// ---------------------------------------------------------------------------

export type SecretRef = `env:${string}` | `secret:${string}`

/** 常见的明文密钥字段名，落盘前必须拒绝。 */
export const RAW_SECRET_FIELDS = ['apiKey', 'api_key', 'apikey', 'secret', 'appSecret', 'app_secret', 'token', 'botToken', 'bot_token', 'accessToken', 'password'] as const

export function isSecretRef(value: unknown): value is SecretRef {
  return typeof value === 'string' && /^(env|secret):.+/.test(value)
}

// ---------------------------------------------------------------------------
// 长期记忆 / 技能 / 复盘（V1 已有，语义保持不变）
// ---------------------------------------------------------------------------

export type MemoryKind = 'preference' | 'lesson' | 'project' | 'fact' | 'relationship' | 'workflow'

export const MEMORY_KINDS: MemoryKind[] = ['preference', 'lesson', 'project', 'fact', 'relationship', 'workflow']

export type EmployeeMemory = {
  id: string
  employeeId: string
  kind: MemoryKind
  text: string
  tags: string[]
  importance: number
  createdAt: number
  updatedAt: number
  lastUsedAt: number
  useCount: number
}

export type SkillSource = 'seed' | 'experience' | 'plugin' | 'manual'

export type LearnedSkill = {
  id: string
  employeeId: string
  name: string
  category: string
  summary: string
  source: SkillSource
  toolNames: string[]
  pluginNames: string[]
  /** 派生值：只能由 computeSkillLevel 依据真实证据算出，禁止 LLM 或调用方直接指定。 */
  level: number
  successes: number
  failures: number
  /** V2 新增：该技能累计到的真实证据条数。 */
  evidenceCount: number
  /** V2 新增：最近一次产生证据的时间；无证据为 0。 */
  lastUsedAt: number
  createdAt: number
  updatedAt: number
}

export type TaskOutcome = 'success' | 'partial' | 'blocked' | 'failed'

export type Reflection = {
  id: string
  employeeId: string
  task: string
  outcome: TaskOutcome
  lesson: string
  createdAt: number
}

// ---------------------------------------------------------------------------
// V2 新增结构（需求文档第四~七、十二章，字段名照抄文档）
// ---------------------------------------------------------------------------

export type TaskSource = 'web' | 'feishu' | 'qq' | 'wechat' | 'system'

/**
 * 员工工作履历。进行中的任务：completedAt 为 undefined，outcome 先占位为 'partial'；
 * 「是否完成」一律以 completedAt 是否存在为准，统计只计入已完成任务。
 */
export type TaskHistory = {
  id: string
  employeeId: string
  title: string
  description?: string
  source: TaskSource
  channelId?: string
  startedAt: number
  completedAt?: number
  outcome: TaskOutcome
  tools: string[]
  plugins: string[]
  models: string[]
  summary?: string
}

/** 技能证据：只能由真实执行结果写入，是技能等级的唯一事实来源。 */
export type SkillEvidence = {
  id: string
  employeeId: string
  skillId: string
  taskId?: string
  tool?: string
  plugin?: string
  model?: string
  success: boolean
  duration?: number
  createdAt: number
}

export type PluginSource = 'dsh-market' | 'github' | 'mcp' | 'builtin'

export type PluginStatus = 'available' | 'degraded' | 'missing' | 'disabled'

export type PluginBinding = {
  pluginId: string
  packageName: string
  version?: string
  source: PluginSource
  tools: string[]
  installedAt: number
  lastVerifiedAt: number
  status: PluginStatus
  approvedBy: 'boss'
}

export type ModelCapability = 'text' | 'vision' | 'image-generation' | 'video-generation' | 'embedding'

export type ModelBindingStatus = 'available' | 'missing' | 'disabled'

export type ModelBinding = {
  capability: ModelCapability
  providerId: string
  priority: number
  status: ModelBindingStatus
}

/** 员工统计：totalTasks/xxxCount 为终身累计计数，其余为派生快照。 */
export type EmployeeStatistics = {
  totalTasks: number
  successCount: number
  partialCount: number
  failedCount: number
  blockedCount: number
  memoryCount: number
  skillCount: number
  evidenceCount: number
  pluginCount: number
  modelCount: number
  totalDurationMs: number
  lastTaskAt: number
  lastActiveAt: number
}

export type EmployeeEvolutionV2 = {
  employeeId: string
  revision: number
  xp: number
  memories: EmployeeMemory[]
  skills: LearnedSkill[]
  skillEvidence: SkillEvidence[]
  reflections: Reflection[]
  taskHistory: TaskHistory[]
  pluginBindings: PluginBinding[]
  modelBindings: ModelBinding[]
  statistics: EmployeeStatistics
  updatedAt: number
}

/** 兼容别名：V1 时代的 EmployeeEvolution 现在等同于 V2 结构（字段只增不减）。 */
export type EmployeeEvolution = EmployeeEvolutionV2

/** 仅用于迁移读入的 V1 结构。 */
export type EmployeeEvolutionV1 = {
  employeeId: string
  revision: number
  xp: number
  memories: EmployeeMemory[]
  skills: Array<Omit<LearnedSkill, 'evidenceCount' | 'lastUsedAt'>>
  reflections: Reflection[]
  updatedAt: number
}

export type StoreFileV1 = { version: 1; employees: Record<string, EmployeeEvolutionV1> }

export type StoreFileV2 = { version: 2; employees: Record<string, EmployeeEvolutionV2> }

// ---------------------------------------------------------------------------
// 模型供应商配置（需求文档十一）：公司级配置，落在 company.json，只存 SecretRef。
// ---------------------------------------------------------------------------

export type ModelProviderType = 'text' | 'vision' | 'image' | 'video' | 'embedding'

export type ModelProviderVendor = 'openai-compatible' | 'gemini' | 'custom'

export type ModelProviderConfig = {
  id: string
  type: ModelProviderType
  provider: ModelProviderVendor
  baseUrl?: string
  model: string
  /** 只允许 env:XXX / secret:XXX 引用，永远不落明文。 */
  apiKeyRef?: SecretRef
  timeout?: number
  enabled: boolean
}

/** 下发给前端的供应商摘要：不含任何密钥，只告诉 UI 是否已配置。 */
export type ModelProviderSummary = {
  id: string
  type: ModelProviderType
  provider: ModelProviderVendor
  model: string
  baseUrl?: string
  apiKeyRef?: SecretRef
  apiKeyConfigured: boolean
  enabled: boolean
}

export type CompanyProfile = {
  version: 2
  companyName: string
  modelProviders: ModelProviderConfig[]
  updatedAt: number
}

// ---------------------------------------------------------------------------
// 快照（需求文档 2.1 / Phase 2）：空 Session 打开时前端一次性 hydrate 用。
// ---------------------------------------------------------------------------

export type EvolutionLevel = { level: number; title: string; progress: number }

/** 员工名册身份信息，由 host 侧 org-blueprints/config 提供，不落 evolution.json。 */
export type EmployeeIdentity = {
  id: string
  name: string
  role: string
  emoji?: string
  department?: string
  brief?: string
}

export type SkillSnapshot = LearnedSkill & { recentEvidence: SkillEvidence[] }

export type EmployeeSnapshot = {
  employeeId: string
  name: string
  role: string
  emoji?: string
  department?: string
  revision: number
  xp: number
  level: EvolutionLevel
  statistics: EmployeeStatistics
  skills: SkillSnapshot[]
  plugins: PluginBinding[]
  models: ModelBinding[]
  recentTasks: TaskHistory[]
  recentReflections: Reflection[]
  /** 记忆按 kind 分组计数；前端分组懒加载用，不一次性下发全部记忆。 */
  memoryCounts: Record<MemoryKind, number>
  recentMemories: EmployeeMemory[]
  updatedAt: number
}

export type CompanyTotals = {
  employees: number
  tasks: number
  success: number
  failed: number
  blocked: number
  memories: number
  skills: number
  plugins: number
  xp: number
}

export type CompanySnapshot = {
  version: 2
  generatedAt: number
  companyName: string
  employees: EmployeeSnapshot[]
  models: ModelProviderSummary[]
  totals: CompanyTotals
}

// ---------------------------------------------------------------------------
// 纯派生算法（host 与 client 共用）
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }

/** 成长等级：与 V1 完全一致的公式，UI 与 host 都依赖它，不要改动。 */
export function evolutionLevel(xp: number): EvolutionLevel {
  const level = Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 80)) + 1)
  const currentFloor = (level - 1) * (level - 1) * 80
  const nextFloor = level * level * 80
  const progress = nextFloor === currentFloor ? 1 : clamp((xp - currentFloor) / (nextFloor - currentFloor), 0, 1)
  const title = level >= 8 ? '领域专家' : level >= 6 ? '资深员工' : level >= 4 ? '熟练员工' : level >= 2 ? '成长员工' : '新员工'
  return { level, title, progress }
}

/** 近期证据加成的统计窗口与上限（需求文档 6.2 的 recentUsageBonus）。 */
export const SKILL_RECENT_WINDOW_MS = 14 * 86_400_000
export const SKILL_RECENT_BONUS_CAP = 6

export function computeRecentUsageBonus(evidence: SkillEvidence[], skillId: string, time: number): number {
  let bonus = 0
  for (const item of evidence) {
    if (item.skillId !== skillId || !item.success) continue
    if (time - item.createdAt > SKILL_RECENT_WINDOW_MS) continue
    bonus += 1
    if (bonus >= SKILL_RECENT_BONUS_CAP) break
  }
  return bonus
}

/**
 * 需求文档 6.2 的等级算法。等级永远由真实成功/失败证据推导，LLM 不得自定级。
 * score = successes*3 - failures + recentUsageBonus
 * level = clamp(1 + floor(log2(score + 1)), 1, 10)
 */
export function computeSkillLevel(input: { successes: number; failures: number; recentUsageBonus?: number }): number {
  const successes = Math.max(0, Math.floor(Number(input.successes) || 0))
  const failures = Math.max(0, Math.floor(Number(input.failures) || 0))
  const bonus = clamp(Math.floor(Number(input.recentUsageBonus) || 0), 0, SKILL_RECENT_BONUS_CAP)
  const score = Math.max(0, successes * 3 - failures + bonus)
  return clamp(1 + Math.floor(Math.log2(score + 1)), 1, 10)
}

/** 结合证据表算一个技能的当前等级。 */
export function skillLevelFrom(skill: LearnedSkill, evidence: SkillEvidence[], time: number): number {
  return computeSkillLevel({ successes: skill.successes, failures: skill.failures, recentUsageBonus: computeRecentUsageBonus(evidence, skill.id, time) })
}

export function emptyStatistics(): EmployeeStatistics {
  return {
    totalTasks: 0, successCount: 0, partialCount: 0, failedCount: 0, blockedCount: 0,
    memoryCount: 0, skillCount: 0, evidenceCount: 0, pluginCount: 0, modelCount: 0,
    totalDurationMs: 0, lastTaskAt: 0, lastActiveAt: 0,
  }
}

export function emptyMemoryCounts(): Record<MemoryKind, number> {
  return { preference: 0, lesson: 0, project: 0, fact: 0, relationship: 0, workflow: 0 }
}

export function createEmptyEvolution(employeeId: string, time = Date.now()): EmployeeEvolutionV2 {
  return {
    employeeId, revision: 1, xp: 0,
    memories: [], skills: [], skillEvidence: [], reflections: [], taskHistory: [], pluginBindings: [], modelBindings: [],
    statistics: emptyStatistics(), updatedAt: time,
  }
}

export function emptyCompanyProfile(companyName = '赛博公司', time = Date.now()): CompanyProfile {
  return { version: 2, companyName, modelProviders: [], updatedAt: time }
}
