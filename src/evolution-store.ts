import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export type MemoryKind = 'preference' | 'lesson' | 'project' | 'fact' | 'relationship' | 'workflow'

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

export type LearnedSkill = {
  id: string
  employeeId: string
  name: string
  category: string
  summary: string
  source: 'seed' | 'experience' | 'plugin' | 'manual'
  toolNames: string[]
  pluginNames: string[]
  level: number
  successes: number
  failures: number
  createdAt: number
  updatedAt: number
}

export type Reflection = {
  id: string
  employeeId: string
  task: string
  outcome: 'success' | 'partial' | 'blocked' | 'failed'
  lesson: string
  createdAt: number
}

export type EmployeeEvolution = {
  employeeId: string
  revision: number
  xp: number
  memories: EmployeeMemory[]
  skills: LearnedSkill[]
  reflections: Reflection[]
  updatedAt: number
}

type StoreFile = {
  version: 1
  employees: Record<string, EmployeeEvolution>
}

const EMPTY_FILE: StoreFile = { version: 1, employees: {} }
const MAX_MEMORIES = 120
const MAX_REFLECTIONS = 80
const MAX_SKILLS = 80

function now() { return Date.now() }
function id(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
function normalize(text: string) { return text.trim().replace(/\s+/g, ' ').toLowerCase() }
function unique(values: unknown[]): string[] { return Array.from(new Set(values.map(String).map((value) => value.trim()).filter(Boolean))) }

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

function defaultEvolution(employeeId: string): EmployeeEvolution {
  return { employeeId, revision: 1, xp: 0, memories: [], skills: [], reflections: [], updatedAt: now() }
}

function sanitizeEvolution(raw: any, employeeId: string): EmployeeEvolution {
  const fallback = defaultEvolution(employeeId)
  return {
    employeeId,
    revision: Number.isFinite(raw?.revision) ? Math.max(1, Number(raw.revision)) : fallback.revision,
    xp: Number.isFinite(raw?.xp) ? Math.max(0, Number(raw.xp)) : 0,
    memories: Array.isArray(raw?.memories) ? raw.memories.slice(-MAX_MEMORIES) : [],
    skills: Array.isArray(raw?.skills) ? raw.skills.slice(-MAX_SKILLS) : [],
    reflections: Array.isArray(raw?.reflections) ? raw.reflections.slice(-MAX_REFLECTIONS) : [],
    updatedAt: Number.isFinite(raw?.updatedAt) ? Number(raw.updatedAt) : fallback.updatedAt,
  }
}

export function evolutionLevel(xp: number): { level: number; title: string; progress: number } {
  const level = Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 80)) + 1)
  const currentFloor = (level - 1) * (level - 1) * 80
  const nextFloor = level * level * 80
  const progress = nextFloor === currentFloor ? 1 : clamp((xp - currentFloor) / (nextFloor - currentFloor), 0, 1)
  const title = level >= 8 ? '领域专家' : level >= 6 ? '资深员工' : level >= 4 ? '熟练员工' : level >= 2 ? '成长员工' : '新员工'
  return { level, title, progress }
}

export class EvolutionStore {
  private loaded = false
  private state: StoreFile = EMPTY_FILE
  private queue: Promise<void> = Promise.resolve()
  readonly filePath: string

  constructor(filePath?: string) {
    this.filePath = filePath || process.env.DSH_ORG_PANEL_MEMORY_FILE || join(homedir(), '.dsh-org-panel', 'evolution.json')
  }

  private async ensureLoaded() {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf-8'))
      const employees: Record<string, EmployeeEvolution> = {}
      for (const [employeeId, value] of Object.entries(raw?.employees || {})) employees[employeeId] = sanitizeEvolution(value, employeeId)
      this.state = { version: 1, employees }
    } catch {
      this.state = { version: 1, employees: {} }
    }
  }

  private profileRef(employeeId: string): EmployeeEvolution {
    const existing = this.state.employees[employeeId]
    if (existing) return existing
    const created = defaultEvolution(employeeId)
    this.state.employees[employeeId] = created
    return created
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

  async profile(employeeId: string): Promise<EmployeeEvolution> {
    await this.ensureLoaded()
    return JSON.parse(JSON.stringify(this.profileRef(employeeId)))
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
        profile.updatedAt = time
        return existing
      }
      const memory: EmployeeMemory = {
        id: id('mem'), employeeId, kind: input.kind || 'lesson', text,
        tags: unique(input.tags || []), importance: clamp(Number(input.importance ?? 3), 1, 5),
        createdAt: time, updatedAt: time, lastUsedAt: 0, useCount: 0,
      }
      profile.memories.push(memory)
      if (profile.memories.length > MAX_MEMORIES) {
        profile.memories.sort((a, b) => (b.importance * 4 + b.useCount) - (a.importance * 4 + a.useCount))
        profile.memories = profile.memories.slice(0, MAX_MEMORIES)
      }
      profile.xp += 8 + memory.importance
      profile.updatedAt = time
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
        current.updatedAt = time
      })
    }
    return JSON.parse(JSON.stringify(matches))
  }

  async learnSkill(employeeId: string, input: {
    name: string
    category?: string
    summary?: string
    source?: LearnedSkill['source']
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
        skill = {
          id: id('skill'), employeeId, name, category: input.category?.trim() || '通用能力', summary: input.summary?.trim() || '',
          source: input.source || 'experience', toolNames: unique(input.toolNames || []), pluginNames: unique(input.pluginNames || []),
          level: 1, successes: 0, failures: 0, createdAt: time, updatedAt: time,
        }
        profile.skills.push(skill)
      } else {
        skill.category = input.category?.trim() || skill.category
        skill.summary = input.summary?.trim() || skill.summary
        skill.toolNames = unique(skill.toolNames.concat(input.toolNames || []))
        skill.pluginNames = unique(skill.pluginNames.concat(input.pluginNames || []))
        skill.updatedAt = time
      }
      if (input.success === true) skill.successes += 1
      if (input.success === false) skill.failures += 1
      const evidence = skill.successes + skill.failures
      skill.level = clamp(1 + Math.floor(skill.successes / 3) + Math.floor(evidence / 8), 1, 10)
      if (profile.skills.length > MAX_SKILLS) profile.skills = profile.skills.slice(-MAX_SKILLS)
      profile.xp += input.success === true ? 18 : 10
      profile.revision += 1
      profile.updatedAt = time
      return skill
    })
  }

  async reflect(employeeId: string, input: { task: string; outcome: Reflection['outcome']; lesson: string; tags?: string[] }): Promise<Reflection> {
    const reflection = await this.mutate(() => {
      const profile = this.profileRef(employeeId)
      const time = now()
      const row: Reflection = { id: id('ref'), employeeId, task: input.task.trim(), outcome: input.outcome, lesson: input.lesson.trim(), createdAt: time }
      profile.reflections.push(row)
      profile.reflections = profile.reflections.slice(-MAX_REFLECTIONS)
      profile.xp += input.outcome === 'success' ? 24 : input.outcome === 'partial' ? 14 : 8
      profile.revision += 1
      profile.updatedAt = time
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
    const profile = await this.profile(employeeId)
    const memories = query ? await this.recall(employeeId, query, memoryLimit) : profile.memories.slice().sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt).slice(0, memoryLimit)
    const topSkills = profile.skills.slice().sort((a, b) => b.level - a.level || b.updatedAt - a.updatedAt).slice(0, 8)
    const level = evolutionLevel(profile.xp)
    const lines = [`成长等级：Lv.${level.level} ${level.title}；经验 ${profile.xp}；记忆 ${profile.memories.length} 条；技能 ${profile.skills.length} 项。`]
    if (topSkills.length) lines.push('已掌握技能：' + topSkills.map((skill) => `${skill.name} Lv.${skill.level}${skill.toolNames.length ? `(${skill.toolNames.slice(0, 3).join('/')})` : ''}`).join('、'))
    if (memories.length) lines.push('相关长期记忆：\n' + memories.map((memory) => `- [${memory.kind}] ${memory.text}`).join('\n'))
    return lines.join('\n')
  }
}
