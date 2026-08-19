// EvolutionStore V2：员工长期记忆 / 技能 / 证据 / 履历 / 插件 / 模型的本地持久化。
// 在 V1 基础上演进：profile / remember / recall / learnSkill / reflect / seedSkill / digest 全部保持原语义，
// 新增 TaskHistory、SkillEvidence、PluginBinding、ModelBinding、EmployeeStatistics。
// 落盘依旧是 tmp + rename 原子写 + 串行 mutate 队列；密钥永远不写进这个文件。
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { STORE_LIMITS, backupLegacyStore, migrateStoreFile, refreshDerivedStatistics } from './migrations'
import {
  createEmptyEvolution, evolutionLevel, skillLevelFrom,
  type EmployeeEvolutionV2, type EmployeeMemory, type EmployeeStatistics, type LearnedSkill, type MemoryKind,
  type ModelBinding, type ModelBindingStatus, type ModelCapability, type PluginBinding, type PluginSource, type PluginStatus,
  type Reflection, type SkillEvidence, type SkillSource, type StoreFileV2, type TaskHistory, type TaskOutcome, type TaskSource,
} from './types'

/** 任务完成后的经验奖励；只有真实完成的任务才会加经验。 */
const TASK_XP: Record<TaskOutcome, number> = { success: 20, partial: 12, blocked: 6, failed: 4 }

function now() { return Date.now() }
function id(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
function normalize(text: string) { return text.trim().replace(/\s+/g, ' ').toLowerCase() }
function unique(values: unknown[]): string[] { return Array.from(new Set(values.map(String).map((value) => value.trim()).filter(Boolean))) }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function trimText(value: unknown): string | undefined { const out = typeof value === 'string' ? value.trim() : ''; return out || undefined }
function clip(value: unknown, max: number): string { const out = String(value ?? '').replace(/\s+/g, ' ').trim(); return out.length > max ? out.slice(0, max) + '…' : out }

// node-shims.d.ts 只声明了 writeFile(path, data, encoding)，这里要用 wx 独占标志，做一次窄化转换。
const writeFileExclusive = writeFile as unknown as (path: string, data: string, options: { encoding: string; flag: string }) => Promise<void>

/**
 * 备份一个解析失败的档案文件。返回备份路径；备份不成功返回 null。
 * 固定文件名 + wx 独占创建：反复启动只会保住**第一份**损坏原文，不会被后续空档案覆盖掉。
 */
async function backupCorruptStore(filePath: string, rawText: string): Promise<string | null> {
  const target = `${filePath}.corrupt.bak`
  try {
    await writeFileExclusive(target, rawText, { encoding: 'utf-8', flag: 'wx' })
    return target
  } catch {}
  // 已经有一份备份了（同一个坏文件被读过第二次）：那份更早，保留它。
  try {
    await readFile(target, 'utf-8')
    return target
  } catch {}
  // 目标不可写又不存在（权限/只读盘）：再试一个带时间戳的名字，仍失败就交给调用方锁死写入。
  try {
    const fallback = `${filePath}.corrupt-${Date.now().toString(36)}.bak`
    await writeFile(fallback, rawText, 'utf-8')
    return fallback
  } catch {
    return null
  }
}

function tokens(text: string): string[] {
  const normalized = normalize(text)
  const words = normalized.split(/[\s,，。；;、/|:_\-]+/).filter((item) => item.length > 1)
  const grams: string[] = []
  const compact = normalized.replace(/[\s,，。；;、/|:_\-]+/g, '')
  for (let index = 0; index < compact.length - 1 && grams.length < 80; index++) grams.push(compact.slice(index, index + 2))
  return unique(words.concat(grams))
}

function scoreMemory(memory: EmployeeMemory, query: string, time: number): number {
  const haystack = normalize([memory.text, ...memory.tags].join(' '))
  let score = memory.importance * 2
  for (const token of tokens(query)) {
    if (!token) continue
    if (haystack.includes(token)) score += token.length >= 4 ? 5 : 2
  }
  const ageDays = Math.max(0, time - memory.updatedAt) / 86_400_000
  score += Math.max(0, 4 - ageDays / 14)
  score += Math.min(3, memory.useCount * .15)
  return score
}

export type TaskInput = {
  title: string
  description?: string
  source?: TaskSource
  channelId?: string
  tools?: string[]
  plugins?: string[]
  models?: string[]
  startedAt?: number
}

export type TaskCompletion = {
  outcome: TaskOutcome
  summary?: string
  tools?: string[]
  plugins?: string[]
  models?: string[]
  completedAt?: number
}

export type EvidenceInput = {
  employeeId: string
  skillId?: string
  /** 没有 skillId 时用技能名匹配；仍匹配不到且给了名字则新建技能。 */
  skillName?: string
  taskId?: string
  tool?: string
  plugin?: string
  model?: string
  success: boolean
  duration?: number
  createdAt?: number
}

export type PluginBindingInput = {
  pluginId: string
  packageName: string
  version?: string
  source: PluginSource
  tools?: string[]
  status?: PluginStatus
  installedAt?: number
  lastVerifiedAt?: number
}

export type ModelBindingInput = {
  capability: ModelCapability
  providerId: string
  priority?: number
  status?: ModelBindingStatus
}

// ---------------------------------------------------------------------------
// 记忆注入台账（需求文档六十条前两句：「越来越懂我」必须有可见证据）
//
// 记忆确实写进了 evolution.json，digest 也确实进了子代理 persona —— 但老板在回答现场
// 看不到任何「这次用到了历史」的痕迹，于是无法把「这次没踩坑」归因给系统。
// 这一段就是把「真实注入过什么」记成台账，让前端能在员工消息旁摆出真东西。
//
// 三条底线：
//   1. 只记**真的写进了那段 prompt** 的 id。算出来没发出去的（例如 staff_chat 走了另一条分支、
//      followup 派活失败）一律不记。
//   2. 注入 0 条就是空数组，不是「找不到就补几条相关的」。前端据此不显示 chip。
//   3. 台账只活在本进程内存里：evolution.json 的结构由 persistence/types.ts + migrations.ts 定义，
//      往里塞新字段会被读盘时的 sanitize 丢掉，那才是真正的假持久化。
//      因此进程重启后台账为空 —— 前端表现为「没有 chip」，而不是「显示 0 条」，
//      任何时候都不会对老板宣称一件没发生的事。
// ---------------------------------------------------------------------------

/** 一次真实注入的登记入参。 */
export type MemoryInjectionInput = {
  employeeId: string
  /** 触发这次注入的任务原话；只留摘要，用于让老板认出是哪一次。 */
  query?: string
  memoryIds: string[]
  reflectionIds: string[]
  /** 履历 id；注入发生在开单之前时先缺席，随后由 attachMemoryInjection 补上。 */
  taskId?: string
  /** 子代理 childId：前端把「这条员工消息」和「这次注入」对上号的唯一锚点。 */
  childId?: string
  injectedAt?: number
}

export type MemoryInjectionRecord = {
  id: string
  employeeId: string
  query: string
  injectedAt: number
  memoryIds: string[]
  reflectionIds: string[]
  taskId?: string
  childId?: string
}

/** 证据条目：由台账里的 id 回查真实条目得到。查不到的 id 直接不出现，绝不用占位条目凑数。 */
export type MemoryEvidenceItem = {
  id: string
  type: 'memory' | 'reflection'
  text: string
  createdAt: number
  updatedAt?: number
  kind?: MemoryKind
  outcome?: TaskOutcome
  tags?: string[]
  /** 来源任务：复盘自带 task；记忆没有结构化来源，就是 undefined（UI 显示「未知」）。 */
  sourceTask?: string
}

/** 一次注入的完整证据视图。missing = 台账里有 id、档案里已经查不到的条数（被 STORE_LIMITS 淘汰）。 */
export type MemoryEvidenceView = {
  injection: MemoryInjectionRecord
  items: MemoryEvidenceItem[]
  missing: number
}

/** digest 的证据版返回值。text 与 digest() 逐字一致。 */
export type MemoryDigest = {
  text: string
  /** 这一次**真正写进 text** 的记忆 id。 */
  memoryIds: string[]
  /** 这一次**真正写进 text** 的复盘 id。 */
  reflectionIds: string[]
}

export type MemoryPageQuery = {
  kind?: MemoryKind
  offset?: number
  limit?: number
}

export type MemoryPageResult = {
  items: EmployeeMemory[]
  /** 该分组的真实总条数。 */
  total: number
  hasMore: boolean
  offset: number
  limit: number
}

/** 台账在内存里最多留多少条。够前端翻完当前会话，也不会让长跑进程越攒越大。 */
const INJECTION_LIMIT = 300

export class EvolutionStore {
  private state: StoreFileV2 = { version: 2, employees: {} }
  private loadPromise: Promise<void> | null = null
  private queue: Promise<void> = Promise.resolve()
  /** 本进程内的记忆注入台账，不落盘（原因见 MemoryInjectionRecord 上方注释）。 */
  private injections: MemoryInjectionRecord[] = []
  readonly filePath: string
  /** 最近一次读盘时若发生了 V1→V2 升级，这里是备份文件路径，供 host 打日志。 */
  migratedFrom: number | null = null
  backupPath: string | null = null
  /** 读盘时文件存在但 JSON 解析失败：这里是损坏原文的备份路径，供 host 如实告诉老板。 */
  corruptBackupPath: string | null = null
  /** 非空表示写入已被锁死（损坏文件没能备份成功）；宁可让调用方报错，也不静默覆盖老板的档案。 */
  writeBlocked: string | null = null

  constructor(filePath?: string) {
    this.filePath = filePath || process.env.DSH_ORG_PANEL_MEMORY_FILE || join(homedir(), '.dsh-org-panel', 'evolution.json')
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.load()
    return this.loadPromise
  }

  private async load() {
    let raw = ''
    try { raw = await readFile(this.filePath, 'utf-8') } catch { raw = '' }
    if (!raw.trim()) return
    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      // 解析失败绝不能当成「空档案」直接返回：下一次 mutate 会把原文件整个覆盖掉 = 静默清空用户数据。
      // 先把损坏原文原样备份出去；备份也失败就锁死写入，让调用方拿到明确错误而不是丢数据。
      this.corruptBackupPath = await backupCorruptStore(this.filePath, raw)
      if (!this.corruptBackupPath) {
        this.writeBlocked = `${this.filePath} 解析失败且损坏文件备份不成功，为避免覆盖丢失历史档案，本次运行拒绝写入。请手动备份该文件后再重启。`
      }
      return
    }
    const result = migrateStoreFile(parsed)
    this.state = result.file
    if (!result.migrated) return
    // 版本升级：先备份原文件，再立刻把 V2 结构写回磁盘，保证升级过程可回滚。
    this.migratedFrom = result.fromVersion
    this.backupPath = await backupLegacyStore(this.filePath, raw, result.fromVersion)
    await this.persist()
  }

  private profileRef(employeeId: string): EmployeeEvolutionV2 {
    const existing = this.state.employees[employeeId]
    if (existing) return existing
    const created = createEmptyEvolution(employeeId)
    this.state.employees[employeeId] = created
    return created
  }

  private async persist() {
    if (this.writeBlocked) throw new Error(this.writeBlocked)
    await mkdir(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.tmp`
    await writeFile(temp, JSON.stringify(this.state, null, 2), 'utf-8')
    await rename(temp, this.filePath)
  }

  private mutate<T>(work: () => Promise<T> | T): Promise<T> {
    let resolveResult: (value: T | PromiseLike<T>) => void = () => undefined
    let rejectResult: (reason?: unknown) => void = () => undefined
    const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
    this.queue = this.queue.then(async () => {
      try {
        await this.ensureLoaded()
        const value = await work()
        await this.persist()
        resolveResult(value)
      } catch (error) {
        rejectResult(error)
      }
    })
    return result
  }

  private touch(profile: EmployeeEvolutionV2, time: number) {
    profile.updatedAt = time
    refreshDerivedStatistics(profile, time)
  }

  // -------------------------------------------------------------------------
  // V1 既有 API（host-v2 直接依赖，语义不变）
  // -------------------------------------------------------------------------

  async profile(employeeId: string): Promise<EmployeeEvolutionV2> {
    await this.ensureLoaded()
    return clone(this.profileRef(employeeId))
  }

  /** 一次性读取多名员工档案；不传 ids 则返回文件里已存在的全部员工。 */
  async profiles(employeeIds?: string[]): Promise<Record<string, EmployeeEvolutionV2>> {
    await this.ensureLoaded()
    const ids = employeeIds && employeeIds.length ? employeeIds : Object.keys(this.state.employees)
    const out: Record<string, EmployeeEvolutionV2> = {}
    for (const employeeId of ids) out[employeeId] = clone(this.profileRef(employeeId))
    return out
  }

  async remember(employeeId: string, input: { kind?: MemoryKind; text: string; tags?: string[]; importance?: number }): Promise<EmployeeMemory> {
    return this.mutate(() => {
      const profile = this.profileRef(employeeId)
      const text = input.text.trim()
      if (!text) throw new Error('memory text must not be empty')
      const key = normalize(text)
      const existing = profile.memories.find((item) => normalize(item.text) === key)
      const time = now()
      if (existing) {
        existing.kind = input.kind || existing.kind
        existing.tags = unique(existing.tags.concat(input.tags || []))
        existing.importance = clamp(Number(input.importance ?? existing.importance), 1, 5)
        existing.updatedAt = time
        profile.xp += 2
        this.touch(profile, time)
        return existing
      }
      const memory: EmployeeMemory = {
        id: id('mem'), employeeId, kind: input.kind || 'lesson', text,
        tags: unique(input.tags || []), importance: clamp(Number(input.importance ?? 3), 1, 5),
        createdAt: time, updatedAt: time, lastUsedAt: 0, useCount: 0,
      }
      profile.memories.push(memory)
      if (profile.memories.length > STORE_LIMITS.memories) {
        profile.memories.sort((a, b) => (b.importance * 4 + b.useCount) - (a.importance * 4 + a.useCount))
        profile.memories = profile.memories.slice(0, STORE_LIMITS.memories)
      }
      profile.xp += 8 + memory.importance
      this.touch(profile, time)
      return memory
    })
  }

  async recall(employeeId: string, query: string, limit = 6): Promise<EmployeeMemory[]> {
    await this.ensureLoaded()
    const profile = this.profileRef(employeeId)
    const time = now()
    const matches = profile.memories
      .map((memory) => ({ memory, score: scoreMemory(memory, query, time) }))
      .filter((item) => item.score > 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, clamp(limit, 1, 12))
      .map((item) => item.memory)
    if (matches.length) {
      await this.mutate(() => {
        const current = this.profileRef(employeeId)
        for (const match of matches) {
          const memory = current.memories.find((item) => item.id === match.id)
          if (memory) { memory.useCount += 1; memory.lastUsedAt = time }
        }
        current.xp += matches.length
        this.touch(current, time)
      })
    }
    return clone(matches)
  }

  /**
   * 沉淀技能。注意：level 不再由调用方决定，只按证据重算。
   * 传入 success 时会同时记一条真实证据（工具/插件名由 host 侧先做过 Tool Registry 校验）。
   */
  async learnSkill(employeeId: string, input: {
    name: string
    category?: string
    summary?: string
    source?: SkillSource
    toolNames?: string[]
    pluginNames?: string[]
    success?: boolean
  }): Promise<LearnedSkill> {
    return this.mutate(() => {
      const profile = this.profileRef(employeeId)
      const name = input.name.trim()
      if (!name) throw new Error('skill name must not be empty')
      const key = normalize(name)
      const time = now()
      let skill = profile.skills.find((item) => normalize(item.name) === key)
      if (!skill) {
        skill = this.createSkill(profile, { name, category: input.category, summary: input.summary, source: input.source, toolNames: input.toolNames, pluginNames: input.pluginNames }, time)
      } else {
        skill.category = input.category?.trim() || skill.category
        skill.summary = input.summary?.trim() || skill.summary
        skill.toolNames = unique(skill.toolNames.concat(input.toolNames || []))
        skill.pluginNames = unique(skill.pluginNames.concat(input.pluginNames || []))
        skill.updatedAt = time
      }
      if (typeof input.success === 'boolean') {
        this.pushEvidence(profile, {
          employeeId, skillId: skill.id, success: input.success,
          tool: (input.toolNames || [])[0], plugin: (input.pluginNames || [])[0],
        }, time)
      }
      this.applySkillLevel(profile, skill, time)
      profile.xp += input.success === true ? 18 : 10
      profile.revision += 1
      this.touch(profile, time)
      return skill
    })
  }

  async reflect(employeeId: string, input: { task: string; outcome: TaskOutcome; lesson: string; tags?: string[] }): Promise<Reflection> {
    const reflection = await this.mutate(() => {
      const profile = this.profileRef(employeeId)
      const time = now()
      const row: Reflection = { id: id('ref'), employeeId, task: input.task.trim(), outcome: input.outcome, lesson: input.lesson.trim(), createdAt: time }
      profile.reflections.push(row)
      profile.reflections = profile.reflections.slice(-STORE_LIMITS.reflections)
      profile.xp += input.outcome === 'success' ? 24 : input.outcome === 'partial' ? 14 : 8
      profile.revision += 1
      this.touch(profile, time)
      return row
    })
    if (input.lesson.trim()) {
      await this.remember(employeeId, {
        kind: 'lesson', text: input.lesson.trim(), tags: unique(['复盘', input.outcome, ...(input.tags || [])]), importance: input.outcome === 'success' ? 4 : 5,
      })
    }
    return reflection
  }

  async seedSkill(employeeId: string, name: string, summary: string, toolNames: string[] = []): Promise<void> {
    await this.ensureLoaded()
    const profile = this.profileRef(employeeId)
    if (profile.skills.some((item) => normalize(item.name) === normalize(name))) return
    await this.learnSkill(employeeId, { name, summary, source: 'seed', toolNames })
  }

  async digest(employeeId: string, query = '', memoryLimit = 6): Promise<string> {
    return (await this.digestWithEvidence(employeeId, query, memoryLimit)).text
  }

  /**
   * digest 的证据版：digest() 现在就是它的一层薄包装，两边永远不会漂移。
   *
   * 相比 V1 多注入了一段「踩过的坑」——复盘自带 task 与 outcome，这是同一条经验
   * 落成 lesson 记忆时丢掉的上下文，也正是需求文档六十条第二句要的东西。
   * 返回的两组 id 是**真的写进了 text** 的那些；调用方只有把 text 发出去了才可以记账。
   */
  async digestWithEvidence(employeeId: string, query = '', memoryLimit = 6, reflectionLimit = 3): Promise<MemoryDigest> {
    const profile = await this.profile(employeeId)
    const memories = query ? await this.recall(employeeId, query, memoryLimit) : profile.memories.slice().sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt).slice(0, memoryLimit)
    const topSkills = profile.skills.slice().sort((a, b) => b.level - a.level || b.updatedAt - a.updatedAt).slice(0, 8)
    const level = evolutionLevel(profile.xp)
    const statistics = profile.statistics
    const lines = [`成长等级：Lv.${level.level} ${level.title}；经验 ${profile.xp}；记忆 ${profile.memories.length} 条；技能 ${profile.skills.length} 项。`]
    if (statistics.totalTasks) lines.push(`工作履历：累计任务 ${statistics.totalTasks}，成功 ${statistics.successCount}，失败 ${statistics.failedCount}，blocked ${statistics.blockedCount}。`)
    if (topSkills.length) lines.push('已掌握技能：' + topSkills.map((skill) => `${skill.name} Lv.${skill.level}${skill.toolNames.length ? `(${skill.toolNames.slice(0, 3).join('/')})` : ''}`).join('、'))
    const plugins = profile.pluginBindings.filter((item) => item.status === 'available')
    if (plugins.length) lines.push('已验证插件：' + plugins.slice(0, 6).map((item) => `${item.packageName}${item.tools.length ? `(${item.tools.slice(0, 3).join('/')})` : ''}`).join('、'))
    const recentTasks = profile.taskHistory.filter((item) => item.completedAt).slice(-3).reverse()
    if (recentTasks.length) lines.push('最近履历：' + recentTasks.map((item) => `${item.title}·${item.outcome}`).join('；'))
    if (memories.length) lines.push('相关长期记忆：\n' + memories.map((memory) => `- [${memory.kind}] ${memory.text}`).join('\n'))
    const reflections = profile.reflections.filter((item) => item.lesson).slice(-clamp(reflectionLimit, 0, 8)).reverse()
    if (reflections.length) lines.push('踩过的坑（历史复盘，遇到同类任务先避开）：\n' + reflections.map((item) => `- [${item.outcome}] ${item.task}：${item.lesson}`).join('\n'))
    return {
      text: lines.join('\n'),
      memoryIds: memories.map((item) => item.id),
      reflectionIds: reflections.map((item) => item.id),
    }
  }

  // -------------------------------------------------------------------------
  // 记忆注入台账（只读查询 + 记账，不落盘，见文件上方 MemoryInjectionRecord 的注释）
  // -------------------------------------------------------------------------

  /**
   * 登记一次**已经真实发出去**的注入。注入 0 条也照样登记（前端据此显示「这次没引用历史」，
   * 而不是显示一个 0 条的 chip），但绝不为了让台账好看而补条目。
   */
  recordMemoryInjection(input: MemoryInjectionInput): MemoryInjectionRecord {
    const record: MemoryInjectionRecord = {
      id: id('inj'),
      employeeId: String(input.employeeId || '').trim(),
      query: trimText(input.query) ? clip(String(input.query), 200) : '',
      injectedAt: Number(input.injectedAt) > 0 ? Number(input.injectedAt) : now(),
      memoryIds: unique(input.memoryIds || []),
      reflectionIds: unique(input.reflectionIds || []),
      taskId: trimText(input.taskId),
      childId: trimText(input.childId),
    }
    this.injections.push(record)
    if (this.injections.length > INJECTION_LIMIT) this.injections = this.injections.slice(-INJECTION_LIMIT)
    return clone(record)
  }

  /** 按员工 / 任务 / 子代理查台账，时间倒序。什么都不传就是全量最近若干条。 */
  memoryInjections(options: { employeeId?: string; taskId?: string; childId?: string; limit?: number } = {}): MemoryInjectionRecord[] {
    const rows = this.injections.filter((item) =>
      (!options.employeeId || item.employeeId === options.employeeId)
      && (!options.taskId || item.taskId === options.taskId)
      && (!options.childId || item.childId === options.childId))
    return clone(rows.slice(-clamp(Number(options.limit) || 20, 1, INJECTION_LIMIT)).reverse())
  }

  /**
   * 把一条台账的 id 回查成真实条目。查不到的 id 只计进 missing，绝不合成条目 ——
   * 「档案里已经没有这条了」和「这条是这样的」是两件事，不能混。
   */
  async memoryEvidence(injectionId: string): Promise<MemoryEvidenceView | null> {
    const record = this.injections.find((item) => item.id === injectionId)
    if (!record) return null
    await this.ensureLoaded()
    const profile = this.profileRef(record.employeeId)
    const items: MemoryEvidenceItem[] = []
    let missing = 0
    for (const memoryId of record.memoryIds) {
      const memory = profile.memories.find((item) => item.id === memoryId)
      if (!memory) { missing += 1; continue }
      items.push({
        id: memory.id, type: 'memory', text: memory.text, createdAt: memory.createdAt, updatedAt: memory.updatedAt,
        kind: memory.kind, tags: memory.tags.slice(),
      })
    }
    for (const reflectionId of record.reflectionIds) {
      const reflection = profile.reflections.find((item) => item.id === reflectionId)
      if (!reflection) { missing += 1; continue }
      items.push({
        id: reflection.id, type: 'reflection', text: reflection.lesson, createdAt: reflection.createdAt,
        outcome: reflection.outcome, sourceTask: reflection.task || undefined,
      })
    }
    return { injection: clone(record), items, missing }
  }

  /**
   * 记忆分页（需求文档四十四条：不要一次加载全部 120 条）。
   * 排序与 CompanyStore.employeeSnapshot 的 recentMemories 逐字一致（importance desc, updatedAt desc），
   * 这样前端拿快照里那几条当第一页、用 offset 续着翻，不会跳条也不会重复。
   */
  async memoryPage(employeeId: string, query: MemoryPageQuery = {}): Promise<MemoryPageResult> {
    await this.ensureLoaded()
    const rows = this.profileRef(employeeId).memories
      .filter((item) => !query.kind || item.kind === query.kind)
      .slice()
      .sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt)
    const offset = clamp(Math.floor(Number(query.offset) || 0), 0, STORE_LIMITS.memories)
    const limit = clamp(Math.floor(Number(query.limit) || 10), 1, 30)
    const items = rows.slice(offset, offset + limit)
    return { items: clone(items), total: rows.length, hasMore: offset + items.length < rows.length, offset, limit }
  }

  // -------------------------------------------------------------------------
  // 技能证据与等级（需求文档 6.1 / 6.2）
  // -------------------------------------------------------------------------

  private createSkill(profile: EmployeeEvolutionV2, input: { name: string; category?: string; summary?: string; source?: SkillSource; toolNames?: string[]; pluginNames?: string[] }, time: number): LearnedSkill {
    const skill: LearnedSkill = {
      id: id('skill'), employeeId: profile.employeeId, name: input.name.trim(), category: input.category?.trim() || '通用能力', summary: input.summary?.trim() || '',
      source: input.source || 'experience', toolNames: unique(input.toolNames || []), pluginNames: unique(input.pluginNames || []),
      level: 1, successes: 0, failures: 0, evidenceCount: 0, lastUsedAt: 0, createdAt: time, updatedAt: time,
    }
    profile.skills.push(skill)
    if (profile.skills.length > STORE_LIMITS.skills) profile.skills = profile.skills.slice(-STORE_LIMITS.skills)
    return skill
  }

  private pushEvidence(profile: EmployeeEvolutionV2, input: Omit<EvidenceInput, 'skillName'> & { skillId: string }, time: number): SkillEvidence {
    const row: SkillEvidence = {
      id: id('ev'), employeeId: profile.employeeId, skillId: input.skillId,
      taskId: trimText(input.taskId), tool: trimText(input.tool), plugin: trimText(input.plugin), model: trimText(input.model),
      success: input.success === true,
      duration: Number.isFinite(Number(input.duration)) && Number(input.duration) > 0 ? Math.floor(Number(input.duration)) : undefined,
      createdAt: Number.isFinite(Number(input.createdAt)) && Number(input.createdAt) > 0 ? Number(input.createdAt) : time,
    }
    profile.skillEvidence.push(row)
    if (profile.skillEvidence.length > STORE_LIMITS.evidence) profile.skillEvidence = profile.skillEvidence.slice(-STORE_LIMITS.evidence)
    const skill = profile.skills.find((item) => item.id === row.skillId)
    if (skill) {
      if (row.success) skill.successes += 1
      else skill.failures += 1
      skill.evidenceCount += 1
      skill.lastUsedAt = row.createdAt
      skill.updatedAt = time
    }
    return row
  }

  private applySkillLevel(profile: EmployeeEvolutionV2, skill: LearnedSkill, time: number): number {
    skill.level = skillLevelFrom(skill, profile.skillEvidence, time)
    return skill.level
  }

  /** 写入一条真实执行证据，并按证据重算技能等级。这是 V2 里技能升级的唯一合法路径。 */
  async addEvidence(input: EvidenceInput): Promise<SkillEvidence> {
    return this.mutate(() => {
      const employeeId = String(input.employeeId || '').trim()
      if (!employeeId) throw new Error('evidence employeeId must not be empty')
      const profile = this.profileRef(employeeId)
      const time = now()
      const skillName = input.skillName?.trim() || ''
      let skill = input.skillId ? profile.skills.find((item) => item.id === input.skillId) : undefined
      if (!skill && skillName) skill = profile.skills.find((item) => normalize(item.name) === normalize(skillName))
      if (!skill && skillName) skill = this.createSkill(profile, { name: skillName, source: input.plugin ? 'plugin' : 'experience', toolNames: input.tool ? [input.tool] : [], pluginNames: input.plugin ? [input.plugin] : [] }, time)
      if (!skill) throw new Error(`unknown skill for evidence: ${String(input.skillId || skillName)}`)
      const evidence = this.pushEvidence(profile, {
        employeeId, skillId: skill.id, taskId: input.taskId, tool: input.tool, plugin: input.plugin, model: input.model,
        success: input.success, duration: input.duration, createdAt: input.createdAt,
      }, time)
      this.applySkillLevel(profile, skill, time)
      profile.xp += evidence.success ? 6 : 2
      profile.revision += 1
      this.touch(profile, time)
      return evidence
    })
  }

  /** 按当前证据重算某个技能的等级；skillId 全局唯一，employeeId 只用于加速定位。 */
  async recomputeSkillLevel(skillId: string, employeeId?: string): Promise<number> {
    return this.mutate(() => {
      const time = now()
      const profiles = employeeId ? [this.profileRef(employeeId)] : Object.values(this.state.employees)
      for (const profile of profiles) {
        const skill = profile.skills.find((item) => item.id === skillId)
        if (!skill) continue
        const level = this.applySkillLevel(profile, skill, time)
        this.touch(profile, time)
        return level
      }
      throw new Error(`unknown skill id: ${skillId}`)
    })
  }

  async skills(employeeId: string): Promise<LearnedSkill[]> {
    await this.ensureLoaded()
    return clone(this.profileRef(employeeId).skills)
  }

  async evidence(employeeId: string, options: { skillId?: string; limit?: number } = {}): Promise<SkillEvidence[]> {
    await this.ensureLoaded()
    const rows = this.profileRef(employeeId).skillEvidence.filter((item) => !options.skillId || item.skillId === options.skillId)
    return clone(rows.slice(-clamp(Number(options.limit) || 50, 1, STORE_LIMITS.evidence)).reverse())
  }

  // -------------------------------------------------------------------------
  // 工作履历 TaskHistory（增删改查）
  // -------------------------------------------------------------------------

  private locateTask(taskId: string, employeeId?: string): { profile: EmployeeEvolutionV2; task: TaskHistory } | null {
    const profiles = employeeId ? [this.profileRef(employeeId)] : Object.values(this.state.employees)
    for (const profile of profiles) {
      const task = profile.taskHistory.find((item) => item.id === taskId)
      if (task) return { profile, task }
    }
    return null
  }

  private countOutcome(statistics: EmployeeStatistics, outcome: TaskOutcome, delta: number) {
    const key = outcome === 'success' ? 'successCount' : outcome === 'partial' ? 'partialCount' : outcome === 'blocked' ? 'blockedCount' : 'failedCount'
    statistics[key] = Math.max(0, statistics[key] + delta)
  }

  private applyCompletion(profile: EmployeeEvolutionV2, task: TaskHistory, input: TaskCompletion, time: number): TaskHistory {
    const wasCompleted = !!task.completedAt
    if (wasCompleted) this.countOutcome(profile.statistics, task.outcome, -1)
    task.outcome = input.outcome
    task.completedAt = Number(input.completedAt) > 0 ? Number(input.completedAt) : time
    task.summary = trimText(input.summary) || task.summary
    task.tools = unique(task.tools.concat(input.tools || []))
    task.plugins = unique(task.plugins.concat(input.plugins || []))
    task.models = unique(task.models.concat(input.models || []))
    if (!wasCompleted) {
      profile.statistics.totalTasks += 1
      profile.statistics.totalDurationMs += Math.max(0, (task.completedAt || time) - task.startedAt)
      profile.xp += TASK_XP[task.outcome] || 0
    }
    this.countOutcome(profile.statistics, task.outcome, 1)
    profile.statistics.lastTaskAt = Math.max(profile.statistics.lastTaskAt, task.completedAt || time)
    profile.revision += 1
    return task
  }

  /** 开始一个任务：completedAt 为空即代表进行中，outcome 先占位 partial。 */
  async startTask(employeeId: string, input: TaskInput): Promise<TaskHistory> {
    return this.mutate(() => {
      const profile = this.profileRef(employeeId)
      const title = input.title.trim()
      if (!title) throw new Error('task title must not be empty')
      const time = now()
      const task: TaskHistory = {
        id: id('task'), employeeId, title, description: trimText(input.description), source: input.source || 'web', channelId: trimText(input.channelId),
        startedAt: Number(input.startedAt) > 0 ? Number(input.startedAt) : time, outcome: 'partial',
        tools: unique(input.tools || []), plugins: unique(input.plugins || []), models: unique(input.models || []),
      }
      profile.taskHistory.push(task)
      if (profile.taskHistory.length > STORE_LIMITS.tasks) profile.taskHistory = profile.taskHistory.slice(-STORE_LIMITS.tasks)
      this.touch(profile, time)
      return clone(task)
    })
  }

  /** 结束任务并计入统计；重复调用同一任务只会修正结果，不会重复累计。 */
  async completeTask(taskId: string, input: TaskCompletion, employeeId?: string): Promise<TaskHistory> {
    return this.mutate(() => {
      const found = this.locateTask(taskId, employeeId)
      if (!found) throw new Error(`unknown task id: ${taskId}`)
      const time = now()
      const task = this.applyCompletion(found.profile, found.task, input, time)
      this.touch(found.profile, time)
      return clone(task)
    })
  }

  /** 一次性登记一条已经完成的履历（IM/系统侧回填用）。 */
  async recordTask(employeeId: string, input: TaskInput & TaskCompletion): Promise<TaskHistory> {
    return this.mutate(() => {
      const profile = this.profileRef(employeeId)
      const title = input.title.trim()
      if (!title) throw new Error('task title must not be empty')
      const time = now()
      const task: TaskHistory = {
        id: id('task'), employeeId, title, description: trimText(input.description), source: input.source || 'web', channelId: trimText(input.channelId),
        startedAt: Number(input.startedAt) > 0 ? Number(input.startedAt) : time, outcome: 'partial',
        tools: unique(input.tools || []), plugins: unique(input.plugins || []), models: unique(input.models || []),
      }
      profile.taskHistory.push(task)
      if (profile.taskHistory.length > STORE_LIMITS.tasks) profile.taskHistory = profile.taskHistory.slice(-STORE_LIMITS.tasks)
      this.applyCompletion(profile, task, input, time)
      this.touch(profile, time)
      return clone(task)
    })
  }

  async updateTask(taskId: string, patch: Partial<Pick<TaskHistory, 'title' | 'description' | 'summary' | 'channelId' | 'tools' | 'plugins' | 'models'>>, employeeId?: string): Promise<TaskHistory> {
    return this.mutate(() => {
      const found = this.locateTask(taskId, employeeId)
      if (!found) throw new Error(`unknown task id: ${taskId}`)
      const time = now()
      const task = found.task
      task.title = patch.title?.trim() || task.title
      task.description = trimText(patch.description) || task.description
      task.summary = trimText(patch.summary) || task.summary
      task.channelId = trimText(patch.channelId) || task.channelId
      if (patch.tools) task.tools = unique(task.tools.concat(patch.tools))
      if (patch.plugins) task.plugins = unique(task.plugins.concat(patch.plugins))
      if (patch.models) task.models = unique(task.models.concat(patch.models))
      this.touch(found.profile, time)
      return clone(task)
    })
  }

  /** 删除一条履历。终身累计统计不回退（累计任务数代表真实发生过的工作量）。 */
  async deleteTask(taskId: string, employeeId?: string): Promise<boolean> {
    return this.mutate(() => {
      const found = this.locateTask(taskId, employeeId)
      if (!found) return false
      const time = now()
      found.profile.taskHistory = found.profile.taskHistory.filter((item) => item.id !== taskId)
      this.touch(found.profile, time)
      return true
    })
  }

  async task(taskId: string, employeeId?: string): Promise<TaskHistory | null> {
    await this.ensureLoaded()
    const found = this.locateTask(taskId, employeeId)
    return found ? clone(found.task) : null
  }

  /** 按时间倒序读取履历。 */
  async tasks(employeeId: string, options: { limit?: number; source?: TaskSource; outcome?: TaskOutcome; onlyCompleted?: boolean } = {}): Promise<TaskHistory[]> {
    await this.ensureLoaded()
    const rows = this.profileRef(employeeId).taskHistory
      .filter((item) => (!options.source || item.source === options.source) && (!options.outcome || item.outcome === options.outcome) && (!options.onlyCompleted || !!item.completedAt))
      .slice()
      .sort((a, b) => (b.completedAt || b.startedAt) - (a.completedAt || a.startedAt))
      .slice(0, clamp(Number(options.limit) || 20, 1, STORE_LIMITS.tasks))
    return clone(rows)
  }

  async statistics(employeeId: string): Promise<EmployeeStatistics> {
    await this.ensureLoaded()
    const profile = this.profileRef(employeeId)
    refreshDerivedStatistics(profile, profile.statistics.lastActiveAt)
    return clone(profile.statistics)
  }

  // -------------------------------------------------------------------------
  // 插件与模型绑定
  // -------------------------------------------------------------------------

  /**
   * 绑定一个已经过老板批准的插件。
   * status 默认 **missing**（与 migrations.sanitizePlugin 的读盘默认一致）：
   * 「已批准」不等于「已验证可用」，可用状态只能由真实验证过的调用方显式传 available，
   * 否则一次没验证的绑定就会在档案里显示成 Available（违反需求文档五十七条）。
   * 重新绑定同一个 pluginId 时同理：没有显式声明状态就说明这次没做验证，一律退回 missing 等待健康检查。
   */
  async bindPlugin(employeeId: string, input: PluginBindingInput): Promise<PluginBinding> {
    return this.mutate(() => {
      const profile = this.profileRef(employeeId)
      const packageName = input.packageName.trim()
      const pluginId = input.pluginId.trim() || packageName
      if (!pluginId || !packageName) throw new Error('plugin binding requires pluginId and packageName')
      const time = now()
      let binding = profile.pluginBindings.find((item) => item.pluginId === pluginId)
      if (!binding) {
        binding = {
          pluginId, packageName, version: trimText(input.version), source: input.source, tools: unique(input.tools || []),
          installedAt: Number(input.installedAt) > 0 ? Number(input.installedAt) : time,
          lastVerifiedAt: Number(input.lastVerifiedAt) > 0 ? Number(input.lastVerifiedAt) : time,
          status: input.status || 'missing', approvedBy: 'boss',
        }
        profile.pluginBindings.push(binding)
        if (profile.pluginBindings.length > STORE_LIMITS.plugins) profile.pluginBindings = profile.pluginBindings.slice(-STORE_LIMITS.plugins)
      } else {
        binding.packageName = packageName
        binding.version = trimText(input.version) || binding.version
        binding.source = input.source || binding.source
        binding.tools = unique(binding.tools.concat(input.tools || []))
        binding.status = input.status || 'missing'
        binding.lastVerifiedAt = Number(input.lastVerifiedAt) > 0 ? Number(input.lastVerifiedAt) : time
      }
      profile.revision += 1
      this.touch(profile, time)
      return clone(binding)
    })
  }

  /** 健康检查回写：Tool Registry 里找不到就置 missing，绝不谎报已学会。 */
  async updatePluginStatus(employeeId: string, pluginId: string, status: PluginStatus, verifiedAt?: number): Promise<PluginBinding | null> {
    return this.mutate(() => {
      const profile = this.profileRef(employeeId)
      const binding = profile.pluginBindings.find((item) => item.pluginId === pluginId)
      if (!binding) return null
      const time = now()
      binding.status = status
      binding.lastVerifiedAt = Number(verifiedAt) > 0 ? Number(verifiedAt) : time
      this.touch(profile, time)
      return clone(binding)
    })
  }

  async unbindPlugin(employeeId: string, pluginId: string): Promise<boolean> {
    return this.mutate(() => {
      const profile = this.profileRef(employeeId)
      const before = profile.pluginBindings.length
      profile.pluginBindings = profile.pluginBindings.filter((item) => item.pluginId !== pluginId)
      const removed = profile.pluginBindings.length !== before
      if (removed) this.touch(profile, now())
      return removed
    })
  }

  async pluginBindings(employeeId: string): Promise<PluginBinding[]> {
    await this.ensureLoaded()
    return clone(this.profileRef(employeeId).pluginBindings)
  }

  async bindModel(employeeId: string, input: ModelBindingInput): Promise<ModelBinding> {
    return this.mutate(() => {
      const profile = this.profileRef(employeeId)
      const providerId = input.providerId.trim()
      if (!providerId) throw new Error('model binding requires providerId')
      const time = now()
      let binding = profile.modelBindings.find((item) => item.capability === input.capability && item.providerId === providerId)
      if (!binding) {
        // 同 bindPlugin：没有显式声明状态就等于没验证过供应商，默认 missing 而不是 available。
        binding = { capability: input.capability, providerId, priority: clamp(Number(input.priority) || 1, 1, 99), status: input.status || 'missing' }
        profile.modelBindings.push(binding)
        if (profile.modelBindings.length > STORE_LIMITS.models) profile.modelBindings = profile.modelBindings.slice(-STORE_LIMITS.models)
      } else {
        binding.priority = clamp(Number(input.priority) || binding.priority, 1, 99)
        binding.status = input.status || 'missing'
      }
      profile.modelBindings.sort((a, b) => a.capability.localeCompare(b.capability) || a.priority - b.priority)
      profile.revision += 1
      this.touch(profile, time)
      return clone(binding)
    })
  }

  async updateModelStatus(employeeId: string, capability: ModelCapability, providerId: string, status: ModelBindingStatus): Promise<ModelBinding | null> {
    return this.mutate(() => {
      const profile = this.profileRef(employeeId)
      const binding = profile.modelBindings.find((item) => item.capability === capability && item.providerId === providerId)
      if (!binding) return null
      binding.status = status
      this.touch(profile, now())
      return clone(binding)
    })
  }

  async unbindModel(employeeId: string, capability: ModelCapability, providerId?: string): Promise<boolean> {
    return this.mutate(() => {
      const profile = this.profileRef(employeeId)
      const before = profile.modelBindings.length
      profile.modelBindings = profile.modelBindings.filter((item) => !(item.capability === capability && (!providerId || item.providerId === providerId)))
      const removed = profile.modelBindings.length !== before
      if (removed) this.touch(profile, now())
      return removed
    })
  }

  async modelBindings(employeeId: string): Promise<ModelBinding[]> {
    await this.ensureLoaded()
    return clone(this.profileRef(employeeId).modelBindings)
  }
}
