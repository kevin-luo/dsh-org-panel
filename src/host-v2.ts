// 赛博公司 Employee Runtime：只负责“某一位真实员工如何工作”。
//
// 架构边界：
// - 本层没有秘书主 Agent、没有 staff_chat、没有 staff_meeting、没有业务路由；
// - Work Orchestrator 决定谁加入工作组，本层只执行指定 employeeId；
// - 每位员工读取自己的长期记忆 / 技能 / 插件 / 模型档案，并把真实履历写回同一份 Store；
// - DSH root 只作为不可见执行根，不属于任何员工身份。
import { EMPLOYEE_BLUEPRINTS, employeeById } from './org-blueprints'
import { EvolutionStore } from './persistence/evolution-store'
import { CompanyStore } from './persistence/company-store'
import { resolveEmployeeAgentRoute, type EmployeeAgentRoute } from './models/employee-agent-route'
import { readCtxService } from './runtime/ctx-service'
import { memoryEndpoints } from './host/org-panel-memory'
import type { EndpointMap } from './host/org-panel-rpc'
import { evolutionLevel, type EmployeeIdentity, type MemoryKind, type TaskOutcome, type TaskSource } from './persistence/types'

export type Employee = {
  id: string
  name: string
  role: string
  emoji?: string
  department?: string
  aliases: string[]
  brief: string
  capabilities: string[]
  preferredToolHints: string[]
}

type RuntimeCapability = { name: string; source: string; description?: string }

const MEMORY_TOOL = 'staff_memory_recall'
const REMEMBER_TOOL = 'staff_memory_remember'
const SKILL_TOOL = 'staff_skill_learn'
const REFLECT_TOOL = 'staff_reflect'
const PROFILE_TOOL = 'staff_profile'
const CAPABILITY_TOOL = 'staff_capability_scan'
const SNAPSHOT_TOOL = 'company_snapshot'
const INTERNAL_TOOL_NAMES = new Set([MEMORY_TOOL, REMEMBER_TOOL, SKILL_TOOL, REFLECT_TOOL, PROFILE_TOOL, CAPABILITY_TOOL, SNAPSHOT_TOOL])

const DEFAULT_EMPLOYEES: Employee[] = EMPLOYEE_BLUEPRINTS.map((item) => ({ id: item.id, name: item.name, role: item.role, emoji: item.emoji, department: item.department, aliases: item.aliases, brief: item.brief, capabilities: item.capabilities, preferredToolHints: item.preferredToolHints }))

function configuredEmployees(config: any): Employee[] {
  const rows = Array.isArray(config?.staff) && config.staff.length ? config.staff : DEFAULT_EMPLOYEES
  return rows.map((row: any) => {
    const fallback = DEFAULT_EMPLOYEES.find((item) => item.id === row.id || item.id === row.roleId) || employeeById(String(row.id || row.roleId || ''))
    return {
      id: String(row.id), name: String(row.name), role: String(row.role), emoji: row.emoji ? String(row.emoji) : fallback?.emoji,
      department: row.department ? String(row.department) : fallback?.department,
      aliases: Array.from(new Set([row.name, row.role, row.id, ...(row.aliases || fallback?.aliases || [])].filter(Boolean).map(String))),
      brief: String(row.brief || row.intro || fallback?.brief || '负责完成自己岗位范围内的工作。'),
      capabilities: Array.from(new Set([...(row.capabilities || []), ...(fallback?.capabilities || [])].map(String))),
      preferredToolHints: Array.from(new Set([...(row.preferredToolHints || []), ...(fallback?.preferredToolHints || [])].map(String))),
    }
  })
}

function textOf(blocks: any): string { return Array.isArray(blocks) ? blocks.filter((block) => block && block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('') : '' }
function clip(value: unknown, max: number): string { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > max ? text.slice(0, max) + '…' : text }
function describeError(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function toolsOfResult(result: any): string[] {
  const names = new Set<string>()
  const push = (value: unknown) => { const name = String(value ?? '').trim(); if (name) names.add(name) }
  const visit = (blocks: any, depth: number) => {
    if (depth > 4 || !Array.isArray(blocks)) return
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue
      const type = String((block as any).type || '').toLowerCase().replace(/[-\s]/g, '_')
      if (type === 'tool_use' || type === 'tool_call' || type === 'tool_result') push((block as any).name || (block as any).tool || (block as any).toolName)
      visit((block as any).content, depth + 1)
    }
  }
  visit(result?.output, 0); visit(result?.messages, 0)
  for (const key of ['usedTools', 'toolNames', 'toolCalls', 'tools']) {
    const rows = result?.[key]
    if (Array.isArray(rows)) for (const row of rows) push(typeof row === 'string' ? row : row?.name || row?.tool)
  }
  return Array.from(names)
}

const STOP_COMPLETED = new Set(['completed', 'complete', 'done', 'finished', 'end_turn', 'stop'])
const STOP_BLOCKED = /(abort|cancel|interrupt|denied|deny|permission|refus)/
const STOP_FAILED = /(error|fail|crash|timeout|exceed|overflow)/
function outcomeOfRun(run: { stopReason?: unknown; isError?: boolean; reply?: string }): TaskOutcome {
  if (run.isError === true) return 'failed'
  const reason = String(run.stopReason ?? '').trim().toLowerCase()
  if (STOP_COMPLETED.has(reason)) return String(run.reply || '').trim() ? 'success' : 'partial'
  if (STOP_BLOCKED.test(reason)) return 'blocked'
  if (STOP_FAILED.test(reason)) return 'failed'
  return 'partial'
}

function selectProvider(subagents: any): string | undefined {
  const names: string[] = typeof subagents?.list === 'function' ? subagents.list() : []
  const ranked = ['spawn', 'fork', ...names.filter((name) => name !== 'spawn' && name !== 'fork')]
  return ranked.find((name, index) => ranked.indexOf(name) === index && subagents.getProvider?.(name))
}

function sourceOfTool(name: string): string {
  const value = name.toLowerCase()
  if (value.startsWith('cordis_') || value.includes('cordis')) return 'Cordis / DSH 插件'
  if (value.startsWith('mcp_') || value.includes('mcp') || value.includes('::')) return 'MCP'
  if (/(image|video|audio|fal|canva|figma|remotion|ffmpeg)/.test(value)) return '创意插件'
  if (/(github|gmail|calendar|drive|slack|notion|linear|jira|stripe|supabase)/.test(value)) return '外部连接器'
  if (/(web|search|fetch|browser)/.test(value)) return '搜索 / Web'
  if (/(bash|pwsh|edit|write|grep|glob|codex|python|sql)/.test(value)) return '工程工具'
  return '运行时工具'
}

async function runtimeCapabilities(tools: any): Promise<RuntimeCapability[]> {
  const collected: RuntimeCapability[] = []
  const push = (value: any) => {
    if (!value) return
    if (typeof value === 'string') { if (!INTERNAL_TOOL_NAMES.has(value)) collected.push({ name: value, source: sourceOfTool(value) }); return }
    const name = String(value.name || value.id || value.key || '')
    if (!name || INTERNAL_TOOL_NAMES.has(name)) return
    collected.push({ name, source: String(value.source || value.provider || sourceOfTool(name)), description: typeof value.description === 'string' ? value.description : undefined })
  }
  for (const probe of ['list', 'names', 'keys', 'entries', 'getAll']) {
    try {
      const fn = tools?.[probe]; if (typeof fn !== 'function') continue
      const result = await Promise.resolve(fn.call(tools))
      if (Array.isArray(result)) result.forEach((item) => Array.isArray(item) ? push(item[1] || item[0]) : push(item))
      else if (result && typeof result[Symbol.iterator] === 'function') Array.from(result as Iterable<any>).forEach((item: any) => Array.isArray(item) ? push(item[1] || item[0]) : push(item))
    } catch {}
  }
  const registry = tools?.registry || tools?.tools || tools?._tools
  if (registry instanceof Map) registry.forEach((value: any, key: any) => push(value || key))
  else if (registry && typeof registry === 'object') Object.entries(registry).forEach(([key, value]) => push((value as any)?.name ? value : key))
  const dedup = new Map<string, RuntimeCapability>(); for (const item of collected) if (!dedup.has(item.name)) dedup.set(item.name, item)
  return Array.from(dedup.values()).sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name))
}

async function ensureSeedSkills(store: EvolutionStore, employee: Employee) { for (const capability of employee.capabilities) await store.seedSkill(employee.id, capability, `${employee.role}的基础能力。`, employee.preferredToolHints.slice(0, 5)) }
type PersonaBuild = { text: string; query: string; memoryIds: string[]; reflectionIds: string[] }
async function employeePersona(employee: Employee, store: EvolutionStore, task = ''): Promise<PersonaBuild> {
  await ensureSeedSkills(store, employee)
  const digest = await store.digestWithEvidence(employee.id, task, 6)
  const text = [
    `你是“${employee.name}”，赛博公司的${employee.role}。`, employee.brief, `你的基础能力：${employee.capabilities.join('、') || '按岗位完成任务'}。`, '',
    '你是一名长期存在、可成长的真实数字员工。你与其他员工是平级同事，不存在主 Agent / 子 Agent 的产品等级。',
    '只以你自己的岗位身份处理当前工作。不要假装其他员工已经做过没有真实发生的事情，也不要替调度内核总结全公司。',
    '你的公开回复会直接进入当前工作组或外部会话；需要同事协助时可以明确写“@姓名 + 需要他做什么”。', '',
    '【自我进化协议】',
    `1. 处理非 trivial 任务前，优先调用 ${MEMORY_TOOL}，staff 固定填写“${employee.id}”，检索与当前任务相关的历史经验、偏好和项目记忆。`,
    `2. 如果现有工具不够，调用 ${CAPABILITY_TOOL} 查看当前 DSH/Cordis/MCP/连接器已经暴露的真实工具；找到可复用能力后调用 ${SKILL_TOOL} 绑定成自己的技能。不要声称安装了实际上不存在的插件。`,
    `3. 发现稳定的用户偏好、项目事实、工作流或可复用经验时，调用 ${REMEMBER_TOOL} 写入长期记忆。`,
    `4. 完成有价值的任务后调用 ${REFLECT_TOOL} 做一次简短复盘，把真正可复用的经验留下；不要为了升级虚构执行结果。`,
    `5. ${SKILL_TOOL} 只登记已发现能力；技能等级只由宿主真实观测到的执行证据决定，不能靠自述成功刷级。`,
    '6. 回复自然、简洁、直接；不要把私有记忆摘要原样复述，除非它与当前答案直接相关。', '', '【你的长期记忆摘要】', digest.text,
  ].join('\n')
  return { text, query: task, memoryIds: digest.memoryIds, reflectionIds: digest.reflectionIds }
}

export const inject = ['tools', 'subagents']

export type StaffDispatchInput = {
  employeeId: string; text: string; taskTitle?: string; taskDescription?: string; source?: TaskSource; channelId?: string;
  platform?: string; senderId?: string; senderName?: string; conversationId?: string; messageId?: string; threadId?: string;
  workgroupId?: string; permissionMode?: string; writeAllowed?: boolean; writeGate?: { allowed: boolean; isWriteTool(tool: string): boolean };
  agent?: unknown; signal?: AbortSignal
}

export type StaffDispatchOutcome = {
  ok: boolean; employeeId: string; employeeName: string; reply: string; error?: string; tools: string[]; outcome: TaskOutcome; taskId?: string;
  model?: { providerId: string; dshProvider: string; model: string; bound: boolean }
}

export type OrgPanelCore = {
  store: EvolutionStore; company: CompanyStore; employees: Employee[]; roster: EmployeeIdentity[]; memoryEndpoints: EndpointMap;
  snapshot(options?: { taskLimit?: number; memoryLimit?: number }): Promise<unknown>; dispatch(input: StaffDispatchInput): Promise<StaffDispatchOutcome>;
  bindAgent(agent: unknown): void; hasAgent(): boolean
}

export function apply(ctx: any, config?: any): OrgPanelCore | undefined {
  const tools = ctx?.tools; const subagents = ctx?.subagents
  if (!tools || !subagents) { ctx?.logger?.warn?.('dsh-org-panel: employee runtime unavailable because tools/subagents is missing'); return undefined }
  const employees = configuredEmployees(config); const byId = new Map(employees.map((employee) => [employee.id, employee]))
  const store = new EvolutionStore(config?.memoryFile); const company = new CompanyStore(store, config?.companyFile)
  const roster: EmployeeIdentity[] = employees.map((item) => ({ id: item.id, name: item.name, role: item.role, emoji: item.emoji, department: item.department, brief: item.brief }))
  const snapshot = (options?: { taskLimit?: number; memoryLimit?: number }) => company.snapshot(roster, { taskLimit: Number(options?.taskLimit) || 12, memoryLimit: Number(options?.memoryLimit) || 8 })
  const requireEmployee = (value: unknown): Employee => { const employee = byId.get(String(value)); if (!employee) throw new Error(`unknown staff id: ${String(value)}`); return employee }

  let lastAgent: any = null
  const resolveAgent = (candidate?: unknown): any => {
    if (candidate) return candidate; if (lastAgent) return lastAgent
    for (const probe of [() => readCtxService(ctx, 'agent'), () => (readCtxService(ctx, 'agents') as any)?.current?.(), () => (readCtxService(ctx, 'agents') as any)?.main?.(), () => subagents?.rootAgent?.()]) {
      try { const value = probe(); if (value) { lastAgent = value; return value } } catch {}
    }
    return null
  }

  const openTask = async (employee: Employee, input: StaffDispatchInput, modelLabel?: string): Promise<string | null> => {
    try {
      const task = await store.startTask(employee.id, { title: clip(input.taskTitle || input.text, 100) || '未命名任务', description: input.taskDescription ? clip(input.taskDescription, 800) : undefined, source: input.source || 'web', channelId: input.channelId, tools: [], models: modelLabel ? [modelLabel] : [] })
      return task.id
    } catch (error) { ctx?.logger?.warn?.(`dsh-org-panel: 履历开单失败（${employee.id}）：${describeError(error)}`); return null }
  }
  const closeTask = async (taskId: string | null, employeeId: string, completion: { outcome: TaskOutcome; summary?: string; tools?: string[] }): Promise<void> => {
    if (!taskId) return
    try { await store.completeTask(taskId, { outcome: completion.outcome, summary: completion.summary ? clip(completion.summary, 600) : undefined, tools: completion.tools || [] }, employeeId) }
    catch (error) { ctx?.logger?.warn?.(`dsh-org-panel: 履历结单失败（${employeeId}/${taskId}）：${describeError(error)}`) }
  }

  type EmployeeRun = { runId: string; reply: string; stopReason: string; isError: boolean; tools: string[] }
  const runEmployeeOnce = async (parent: any, employee: Employee, options: { prompt: string; personaTask: string; signal: AbortSignal; taskId?: string | null; agentRoute?: EmployeeAgentRoute }): Promise<EmployeeRun> => {
    const provider = selectProvider(subagents); if (!provider) throw new Error('没有可用的 DSH 子代理 provider，无法启动真实员工')
    const persona = await employeePersona(employee, store, options.personaTask)
    const run = await subagents.start(provider, { label: `赛博公司员工:${employee.id}:${employee.name}`, prompt: [{ type: 'text', text: options.prompt }], parent, persona: persona.text, agentOptions: options.agentRoute?.agentOptions, maxDepth: 3, signal: options.signal })
    store.recordMemoryInjection({ employeeId: employee.id, query: persona.query, memoryIds: persona.memoryIds, reflectionIds: persona.reflectionIds, taskId: options.taskId || undefined, childId: String(run.id ?? '') || undefined })
    try { const result = await run.result; return { runId: String(run.id ?? ''), reply: textOf(result?.output), stopReason: String(result?.stopReason ?? ''), isError: result?.isError === true, tools: toolsOfResult(result) } }
    finally { await run.dispose() }
  }

  const memoryRecallTool = { name: MEMORY_TOOL, description: '读取某位数字员工自己的持久长期记忆。', parameters: { type: 'object', additionalProperties: false, required: ['staff', 'query'], properties: { staff: { type: 'string', enum: employees.map((item) => item.id) }, query: { type: 'string', minLength: 1 }, limit: { type: 'number', minimum: 1, maximum: 12 } } }, output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] } }, isConcurrencySafe: () => true, async execute(args: any) { const employee = requireEmployee(args.staff); await ensureSeedSkills(store, employee); const memories = await store.recall(employee.id, String(args.query || ''), Number(args.limit || 6)); return { staffId: employee.id, staffName: employee.name, count: memories.length, memories: memories.map((item) => ({ kind: item.kind, text: item.text, tags: item.tags, importance: item.importance, used: item.useCount })) } } }
  const rememberTool = { name: REMEMBER_TOOL, description: '把稳定、可复用的信息写入某位员工的长期记忆。', parameters: { type: 'object', additionalProperties: false, required: ['staff', 'text'], properties: { staff: { type: 'string', enum: employees.map((item) => item.id) }, kind: { type: 'string', enum: ['preference', 'lesson', 'project', 'fact', 'relationship', 'workflow'] }, text: { type: 'string', minLength: 3 }, tags: { type: 'array', items: { type: 'string' }, maxItems: 12 }, importance: { type: 'number', minimum: 1, maximum: 5 } } }, output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: `已写入${value.staffName}长期记忆：${value.text}` }] } }, isConcurrencySafe: () => true, async execute(args: any) { const employee = requireEmployee(args.staff); const memory = await store.remember(employee.id, { kind: (args.kind || 'lesson') as MemoryKind, text: String(args.text), tags: Array.isArray(args.tags) ? args.tags.map(String) : [], importance: Number(args.importance || 3) }); return { staffId: employee.id, staffName: employee.name, memoryId: memory.id, kind: memory.kind, text: memory.text, importance: memory.importance } } }
  const skillLearnTool = { name: SKILL_TOOL, description: '把当前运行时真实存在的工具能力登记成某位员工的技能；等级只由真实执行证据决定。', parameters: { type: 'object', additionalProperties: false, required: ['staff', 'name'], properties: { staff: { type: 'string', enum: employees.map((item) => item.id) }, name: { type: 'string', minLength: 2 }, category: { type: 'string' }, summary: { type: 'string' }, source: { type: 'string', enum: ['experience', 'plugin', 'manual'] }, toolNames: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 }, pluginNames: { type: 'array', items: { type: 'string' }, maxItems: 20 }, success: { type: 'boolean' } } }, output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: `${value.staffName} 已登记技能：${value.skill.name} Lv.${value.skill.level}` }] } }, isConcurrencySafe: () => true, async execute(args: any) { const employee = requireEmployee(args.staff); const catalog = await runtimeCapabilities(tools); const requested = Array.isArray(args.toolNames) ? args.toolNames.map(String) : []; const verified = requested.filter((name: string) => catalog.some((item) => item.name === name) || INTERNAL_TOOL_NAMES.has(name)); const source = args.source === 'manual' ? 'manual' : args.source === 'plugin' ? 'plugin' : 'experience'; if (source === 'plugin' && !verified.length) throw new Error(`插件类技能必须至少点名一个当前 Tool Registry 里真实存在的工具。${requested.length ? `你给的 ${requested.join('、')} 一个都不存在。` : '你一个工具都没给。'}先用 ${CAPABILITY_TOOL} 看看当前能力。`); const skill = await store.learnSkill(employee.id, { name: String(args.name), category: String(args.category || '扩展能力'), summary: String(args.summary || ''), source, toolNames: verified, pluginNames: Array.isArray(args.pluginNames) ? args.pluginNames.map(String) : [], success: undefined }); return { staffId: employee.id, staffName: employee.name, verifiedTools: verified, ignoredTools: requested.filter((name: string) => !verified.includes(name)), evidenceRecorded: false, ignoredSuccessClaim: typeof args.success === 'boolean' ? args.success : undefined, skill } } }
  const reflectTool = { name: REFLECT_TOOL, description: '员工完成任务后做复盘，沉淀可复用经验。', parameters: { type: 'object', additionalProperties: false, required: ['staff', 'task', 'outcome', 'lesson'], properties: { staff: { type: 'string', enum: employees.map((item) => item.id) }, task: { type: 'string', minLength: 2 }, outcome: { type: 'string', enum: ['success', 'partial', 'blocked', 'failed'] }, lesson: { type: 'string', minLength: 3 }, tags: { type: 'array', items: { type: 'string' }, maxItems: 12 } } }, output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: `${value.staffName} 已完成复盘 · Lv.${value.level.level} ${value.level.title}` }] } }, isConcurrencySafe: () => true, async execute(args: any) { const employee = requireEmployee(args.staff); await store.reflect(employee.id, { task: String(args.task), outcome: args.outcome, lesson: String(args.lesson), tags: Array.isArray(args.tags) ? args.tags.map(String) : [] }); const profile = await store.profile(employee.id); return { staffId: employee.id, staffName: employee.name, xp: profile.xp, memories: profile.memories.length, skills: profile.skills.length, level: evolutionLevel(profile.xp) } } }
  const profileTool = { name: PROFILE_TOOL, description: '查看某位员工的成长档案。', parameters: { type: 'object', additionalProperties: false, required: ['staff'], properties: { staff: { type: 'string', enum: employees.map((item) => item.id) } } }, output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] } }, isConcurrencySafe: () => true, async execute(args: any) { const employee = requireEmployee(args.staff); await ensureSeedSkills(store, employee); const profile = await store.profile(employee.id); const pluginNames = Array.from(new Set(profile.skills.flatMap((skill) => skill.pluginNames))); return { staffId: employee.id, staffName: employee.name, role: employee.role, level: evolutionLevel(profile.xp), xp: profile.xp, revision: profile.revision, memoryCount: profile.memories.length, skillCount: profile.skills.length, pluginNames, skills: profile.skills.slice().sort((a, b) => b.level - a.level).slice(0, 20).map((skill) => ({ name: skill.name, level: skill.level, source: skill.source, tools: skill.toolNames, plugins: skill.pluginNames, successes: skill.successes, failures: skill.failures })), recentReflections: profile.reflections.slice(-5).reverse() } } }
  const snapshotTool = { name: SNAPSHOT_TOOL, description: '读取整家赛博公司的持久化快照，供空 Session 和诊断场景使用。', parameters: { type: 'object', additionalProperties: false, properties: { taskLimit: { type: 'number', minimum: 1, maximum: 50 }, memoryLimit: { type: 'number', minimum: 1, maximum: 30 } } }, output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: JSON.stringify(value) }] } }, isConcurrencySafe: () => true, async execute(args: any) { return snapshot({ taskLimit: Number(args?.taskLimit), memoryLimit: Number(args?.memoryLimit) }) } }
  const capabilityScanTool = { name: CAPABILITY_TOOL, description: '扫描当前 DSH 运行时真实暴露的工具能力。', parameters: { type: 'object', additionalProperties: false, properties: { staff: { type: 'string', enum: employees.map((item) => item.id) }, query: { type: 'string' } } }, output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] } }, isConcurrencySafe: () => true, async execute(args: any) { const query = String(args.query || '').toLowerCase(); const catalog = await runtimeCapabilities(tools); const visible = query ? catalog.filter((item) => (item.name + ' ' + item.source + ' ' + (item.description || '')).toLowerCase().includes(query)) : catalog; const grouped: Record<string, RuntimeCapability[]> = {}; for (const item of visible.slice(0, 120)) (grouped[item.source] ||= []).push(item); return { staffId: args.staff ? String(args.staff) : undefined, count: visible.length, groups: grouped, note: '这里只列出当前运行时能发现的真实工具。' } } }

  const dispatch = async (input: StaffDispatchInput): Promise<StaffDispatchOutcome> => {
    const employeeId = String(input.employeeId || ''); const employee = byId.get(employeeId)
    const fail = (error: string, outcome: TaskOutcome = 'blocked'): StaffDispatchOutcome => ({ ok: false, employeeId, employeeName: employee?.name || employeeId, reply: '', error, tools: [], outcome })
    if (!employee) return fail(`赛博公司名册里没有 ${employeeId || '（空）'} 这位员工。`)
    const text = String(input.text || '').trim(); if (!text) return fail('工作上下文为空，没有可执行的任务。')
    const parent = resolveAgent(input.agent); if (!parent) return fail('赛博公司还没有可用的 DSH 执行根。请先从工作台发起一次真实 company_work，再让外部渠道继续工作。')

    let agentRoute: EmployeeAgentRoute | undefined
    try { agentRoute = await resolveEmployeeAgentRoute({ ctx, company, store, employeeId: employee.id }) }
    catch (error) { ctx?.logger?.warn?.(`dsh-org-panel: ${employee.name} 文本模型路由解析失败，继承当前 DSH 模型：${describeError(error)}`) }
    const modelInfo = agentRoute ? { providerId: agentRoute.providerId, dshProvider: agentRoute.dshProvider, model: agentRoute.model, bound: agentRoute.bound } : undefined
    const modelLabel = agentRoute ? `${agentRoute.dshProvider}/${agentRoute.model}` : undefined
    const signal = input.signal || new AbortController().signal; const taskId = await openTask(employee, input, modelLabel)
    let run: EmployeeRun
    try { run = await runEmployeeOnce(parent, employee, { prompt: text, personaTask: input.taskTitle || input.taskDescription || text, signal, taskId, agentRoute }) }
    catch (error) { const message = describeError(error); await closeTask(taskId, employee.id, { outcome: 'failed', summary: `子代理异常：${message}` }); return { ok: false, employeeId: employee.id, employeeName: employee.name, reply: '', error: message, tools: [], outcome: 'failed', taskId: taskId || undefined, model: modelInfo } }

    const gate = input.writeGate; const violations = gate && !gate.allowed ? run.tools.filter((tool) => gate.isWriteTool(tool)) : []
    const outcome: TaskOutcome = violations.length ? 'blocked' : outcomeOfRun(run)
    await closeTask(taskId, employee.id, { outcome, summary: violations.length ? `只读来源观测到写工具：${violations.join('、')}` : (run.reply || `子代理结束原因：${run.stopReason || '未知'}`), tools: run.tools })
    if (violations.length) return { ok: false, employeeId: employee.id, employeeName: employee.name, reply: run.reply, error: `只读来源观测到写工具：${violations.join('、')}`, tools: run.tools, outcome, taskId: taskId || undefined, model: modelInfo }
    if (outcome === 'failed' || outcome === 'blocked') return { ok: false, employeeId: employee.id, employeeName: employee.name, reply: run.reply, error: `员工运行异常结束：${run.stopReason || outcome}`, tools: run.tools, outcome, taskId: taskId || undefined, model: modelInfo }
    return { ok: true, employeeId: employee.id, employeeName: employee.name, reply: run.reply, tools: run.tools, outcome, taskId: taskId || undefined, model: modelInfo }
  }

  tools.register(memoryRecallTool); tools.register(rememberTool); tools.register(skillLearnTool); tools.register(reflectTool); tools.register(profileTool); tools.register(capabilityScanTool); tools.register(snapshotTool)
  void store.profile('secretary').then(() => {
    if (store.migratedFrom) ctx?.logger?.info?.(`dsh-org-panel: evolution store migrated v${store.migratedFrom} → v2, backup: ${store.backupPath || 'failed'}`)
    if (store.corruptBackupPath) ctx?.logger?.warn?.(`dsh-org-panel: ${store.filePath} 解析失败，损坏原文已备份到 ${store.corruptBackupPath}，本次以空档案继续运行`)
    if (store.writeBlocked) ctx?.logger?.error?.(`dsh-org-panel: ${store.writeBlocked}`)
  }).catch((error: unknown) => ctx?.logger?.warn?.(`dsh-org-panel: evolution store 初始化失败：${describeError(error)}`))

  return { store, company, employees, roster, snapshot, dispatch, memoryEndpoints: memoryEndpoints({ store, roster }), bindAgent: (agent: unknown) => { if (agent) lastAgent = agent }, hasAgent: () => !!resolveAgent() }
}
