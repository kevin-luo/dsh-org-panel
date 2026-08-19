// CompanyStore：公司级配置（company.json）+ CompanySnapshot 组装。
// 需求文档 2.1 的核心修复点：前端在一个全新的空 Session 里也必须能一次性拿回全部员工的
// level / xp / statistics / skills / plugins / models / 最近履历，而不是只显示本 Session 的 Tool Event。
// 安全铁律（三十一条）：company.json 只存 SecretRef（env:XXX / secret:XXX），明文密钥一律拒绝落盘。
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { EvolutionStore } from './evolution-store'
import {
  RAW_SECRET_FIELDS, emptyCompanyProfile, emptyMemoryCounts, evolutionLevel, isSecretRef,
  type CompanyProfile, type CompanySnapshot, type CompanyTotals, type EmployeeIdentity, type EmployeeSnapshot,
  type ModelProviderConfig, type ModelProviderSummary, type ModelProviderType, type ModelProviderVendor,
  type SkillSnapshot,
} from './types'

const PROVIDER_TYPES: ModelProviderType[] = ['text', 'vision', 'image', 'video', 'embedding']
const PROVIDER_VENDORS: ModelProviderVendor[] = ['openai-compatible', 'gemini', 'custom']

export type SnapshotOptions = {
  taskLimit?: number
  memoryLimit?: number
  skillLimit?: number
  evidenceLimit?: number
  /** 名册里没有、但 evolution.json 里存在的员工是否也纳入快照。默认不纳入。 */
  includeUnknown?: boolean
}

function now() { return Date.now() }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function text(value: unknown, fallback = ''): string { const out = typeof value === 'string' ? value.trim() : ''; return out || fallback }

/** 任何明文密钥字段都直接拒绝，避免调用方顺手把 apiKey 塞进配置。 */
function assertNoRawSecret(input: any) {
  for (const field of RAW_SECRET_FIELDS) {
    if (input && Object.prototype.hasOwnProperty.call(input, field) && input[field]) {
      throw new Error(`refusing to persist raw secret field "${field}"; use apiKeyRef: env:XXX or secret:XXX instead`)
    }
  }
}

/**
 * 供应商配置的唯一校验口径：cordis 配置入口、host 工具、前端写入全部走这一份，
 * 避免「配置文件里能塞明文密钥、工具里不能」这种双标。导出给 models/gateway.ts 的
 * 配置解析复用；调用方不需要先造一个 CompanyStore 就能校验一行配置。
 */
export function sanitizeModelProvider(input: any): ModelProviderConfig {
  return sanitizeProvider(input)
}

function sanitizeProvider(input: any): ModelProviderConfig {
  assertNoRawSecret(input)
  const id = text(input?.id)
  const model = text(input?.model)
  if (!id) throw new Error('model provider requires an id')
  if (!model) throw new Error('model provider requires a model name')
  const type = PROVIDER_TYPES.includes(input?.type) ? (input.type as ModelProviderType) : 'text'
  const provider = PROVIDER_VENDORS.includes(input?.provider) ? (input.provider as ModelProviderVendor) : 'openai-compatible'
  const apiKeyRef = input?.apiKeyRef
  if (apiKeyRef !== undefined && !isSecretRef(apiKeyRef)) throw new Error('apiKeyRef must look like env:XXX or secret:XXX')
  const timeout = Number(input?.timeout)
  return {
    id, type, provider, model,
    baseUrl: text(input?.baseUrl) || undefined,
    apiKeyRef: apiKeyRef === undefined ? undefined : apiKeyRef,
    timeout: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : undefined,
    enabled: input?.enabled !== false,
  }
}

function sanitizeProfile(raw: any): CompanyProfile {
  const fallback = emptyCompanyProfile()
  const providers: ModelProviderConfig[] = []
  for (const item of Array.isArray(raw?.modelProviders) ? raw.modelProviders : []) {
    try { providers.push(sanitizeProvider(item)) } catch { /* 坏行直接丢弃，不让脏配置阻断整个公司启动 */ }
  }
  return {
    version: 2,
    companyName: text(raw?.companyName, fallback.companyName),
    modelProviders: providers,
    updatedAt: Number(raw?.updatedAt) > 0 ? Number(raw.updatedAt) : fallback.updatedAt,
  }
}

function summarizeProvider(config: ModelProviderConfig): ModelProviderSummary {
  return {
    id: config.id, type: config.type, provider: config.provider, model: config.model, baseUrl: config.baseUrl,
    apiKeyRef: config.apiKeyRef, apiKeyConfigured: !!config.apiKeyRef, enabled: config.enabled,
  }
}

export class CompanyStore {
  private state: CompanyProfile = emptyCompanyProfile()
  private loadPromise: Promise<void> | null = null
  private queue: Promise<void> = Promise.resolve()
  private readonly evolution: EvolutionStore
  readonly filePath: string

  constructor(evolution: EvolutionStore, filePath?: string) {
    this.evolution = evolution
    this.filePath = filePath || process.env.DSH_ORG_PANEL_COMPANY_FILE || join(homedir(), '.dsh-org-panel', 'company.json')
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.load()
    return this.loadPromise
  }

  private async load() {
    let raw = ''
    try { raw = await readFile(this.filePath, 'utf-8') } catch { raw = '' }
    if (!raw.trim()) return
    try { this.state = sanitizeProfile(JSON.parse(raw)) } catch { /* 解析失败保持空配置 */ }
  }

  private async persist() {
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

  // -------------------------------------------------------------------------
  // 公司配置
  // -------------------------------------------------------------------------

  async profile(): Promise<CompanyProfile> {
    await this.ensureLoaded()
    return clone(this.state)
  }

  async setCompanyName(name: string): Promise<CompanyProfile> {
    return this.mutate(() => {
      const value = name.trim()
      if (!value) throw new Error('company name must not be empty')
      this.state.companyName = value
      this.state.updatedAt = now()
      return clone(this.state)
    })
  }

  async upsertModelProvider(input: ModelProviderConfig): Promise<ModelProviderConfig> {
    return this.mutate(() => {
      const config = sanitizeProvider(input)
      const index = this.state.modelProviders.findIndex((item) => item.id === config.id)
      if (index >= 0) this.state.modelProviders[index] = config
      else this.state.modelProviders.push(config)
      this.state.updatedAt = now()
      return clone(config)
    })
  }

  async removeModelProvider(providerId: string): Promise<boolean> {
    return this.mutate(() => {
      const before = this.state.modelProviders.length
      this.state.modelProviders = this.state.modelProviders.filter((item) => item.id !== providerId)
      const removed = this.state.modelProviders.length !== before
      if (removed) this.state.updatedAt = now()
      return removed
    })
  }

  /**
   * 把某个供应商移动到同能力类型的兜底链首位。
   * Model Gateway 对 company.modelProviders(type) 的返回顺序有真实语义：员工没有显式绑定时，
   * 第一个已启用且协议可用的供应商就是公司默认。因此“设为默认”必须落到持久化顺序，
   * 不能只在前端打一个 isDefault 标签。
   */
  async setDefaultModelProvider(providerId: string): Promise<ModelProviderConfig> {
    return this.mutate(() => {
      const index = this.state.modelProviders.findIndex((item) => item.id === providerId)
      if (index < 0) throw new Error(`unknown model provider: ${providerId}`)
      const provider = this.state.modelProviders[index]
      this.state.modelProviders.splice(index, 1)
      const firstSameType = this.state.modelProviders.findIndex((item) => item.type === provider.type)
      this.state.modelProviders.splice(firstSameType >= 0 ? firstSameType : this.state.modelProviders.length, 0, provider)
      this.state.updatedAt = now()
      return clone(provider)
    })
  }

  async modelProviders(type?: ModelProviderType): Promise<ModelProviderConfig[]> {
    await this.ensureLoaded()
    return clone(this.state.modelProviders.filter((item) => !type || item.type === type))
  }

  /** 下发给 UI 的供应商列表：不含密钥，只告诉前端是否已配置。 */
  async modelProviderSummaries(): Promise<ModelProviderSummary[]> {
    const providers = await this.modelProviders()
    return providers.map(summarizeProvider)
  }

  // -------------------------------------------------------------------------
  // 快照
  // -------------------------------------------------------------------------

  async employeeSnapshot(identity: EmployeeIdentity, options: SnapshotOptions = {}): Promise<EmployeeSnapshot> {
    const profile = await this.evolution.profile(identity.id)
    const taskLimit = clamp(Number(options.taskLimit) || 12, 1, 100)
    const memoryLimit = clamp(Number(options.memoryLimit) || 8, 1, 60)
    const skillLimit = clamp(Number(options.skillLimit) || 24, 1, 80)
    const evidenceLimit = clamp(Number(options.evidenceLimit) || 6, 1, 30)
    const memoryCounts = emptyMemoryCounts()
    for (const memory of profile.memories) memoryCounts[memory.kind] = (memoryCounts[memory.kind] || 0) + 1
    const skills: SkillSnapshot[] = profile.skills
      .slice()
      .sort((a, b) => b.level - a.level || b.updatedAt - a.updatedAt)
      .slice(0, skillLimit)
      .map((skill) => ({ ...skill, recentEvidence: profile.skillEvidence.filter((item) => item.skillId === skill.id).slice(-evidenceLimit).reverse() }))
    return {
      employeeId: identity.id,
      name: identity.name || identity.id,
      role: identity.role || '',
      emoji: identity.emoji,
      department: identity.department,
      revision: profile.revision,
      xp: profile.xp,
      level: evolutionLevel(profile.xp),
      statistics: profile.statistics,
      skills,
      plugins: profile.pluginBindings.slice(),
      models: profile.modelBindings.slice(),
      recentTasks: profile.taskHistory.slice().sort((a, b) => (b.completedAt || b.startedAt) - (a.completedAt || a.startedAt)).slice(0, taskLimit),
      recentReflections: profile.reflections.slice(-5).reverse(),
      memoryCounts,
      recentMemories: profile.memories.slice().sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt).slice(0, memoryLimit),
      updatedAt: profile.updatedAt,
    }
  }

  /** 一次性返回整家公司的持久化状态，供前端空 Session hydrate。 */
  async snapshot(roster: EmployeeIdentity[], options: SnapshotOptions = {}): Promise<CompanySnapshot> {
    const [company, providers] = await Promise.all([this.profile(), this.modelProviderSummaries()])
    const identities = roster.slice()
    if (options.includeUnknown) {
      const known = new Set(identities.map((item) => item.id))
      const stored = await this.evolution.profiles()
      for (const employeeId of Object.keys(stored)) if (!known.has(employeeId)) identities.push({ id: employeeId, name: employeeId, role: '' })
    }
    const employees: EmployeeSnapshot[] = []
    for (const identity of identities) employees.push(await this.employeeSnapshot(identity, options))
    const totals: CompanyTotals = { employees: employees.length, tasks: 0, success: 0, failed: 0, blocked: 0, memories: 0, skills: 0, plugins: 0, xp: 0 }
    for (const employee of employees) {
      totals.tasks += employee.statistics.totalTasks
      totals.success += employee.statistics.successCount
      totals.failed += employee.statistics.failedCount
      totals.blocked += employee.statistics.blockedCount
      totals.memories += employee.statistics.memoryCount
      totals.skills += employee.statistics.skillCount
      totals.plugins += employee.statistics.pluginCount
      totals.xp += employee.xp
    }
    return { version: 2, generatedAt: now(), companyName: company.companyName, employees, models: providers, totals }
  }
}