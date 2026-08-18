// 「赛博公司」host v2：真实独立员工 + 持久记忆 + 技能进化 + 运行时插件发现。
import { EMPLOYEE_BLUEPRINTS, employeeById } from './org-blueprints'
import { EvolutionStore } from './persistence/evolution-store'
import { CompanyStore } from './persistence/company-store'
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

type RuntimeCapability = {
  name: string
  source: string
  description?: string
}

const STAFF_TOOL = 'staff_chat'
const STAFF_MEETING_TOOL = 'staff_meeting'
// persona 内容变了就必须 +1：label 里带着它，旧的持续会话不会被复用，
// 否则老员工会话里还留着「success=true 就算学会」这条已经作废的规则。
// v8：记忆摘要里多了一段「踩过的坑（历史复盘）」，旧会话里没有它，必须换一批 child。
const EMPLOYEE_PERSONA_REVISION = 8
const MEMORY_TOOL = 'staff_memory_recall'
const REMEMBER_TOOL = 'staff_memory_remember'
const SKILL_TOOL = 'staff_skill_learn'
const REFLECT_TOOL = 'staff_reflect'
const PROFILE_TOOL = 'staff_profile'
const CAPABILITY_TOOL = 'staff_capability_scan'
/** client 侧 hydrate 桥接层按这个工具名在会话节点流里认出快照（见 client-v9/company-bridge.ts）。 */
const SNAPSHOT_TOOL = 'company_snapshot'
const INTERNAL_TOOL_NAMES = new Set([STAFF_TOOL, STAFF_MEETING_TOOL, MEMORY_TOOL, REMEMBER_TOOL, SKILL_TOOL, REFLECT_TOOL, PROFILE_TOOL, CAPABILITY_TOOL, SNAPSHOT_TOOL])

const DEFAULT_EMPLOYEES: Employee[] = EMPLOYEE_BLUEPRINTS.map((item) => ({
  id: item.id,
  name: item.name,
  role: item.role,
  emoji: item.emoji,
  department: item.department,
  aliases: item.aliases,
  brief: item.brief,
  capabilities: item.capabilities,
  preferredToolHints: item.preferredToolHints,
}))

function configuredEmployees(config: any): Employee[] {
  const rows = Array.isArray(config?.staff) && config.staff.length ? config.staff : DEFAULT_EMPLOYEES
  return rows.map((row: any) => {
    const fallback = DEFAULT_EMPLOYEES.find((item) => item.id === row.id || item.id === row.roleId) || employeeById(String(row.id || row.roleId || ''))
    return {
      id: String(row.id),
      name: String(row.name),
      role: String(row.role),
      emoji: row.emoji ? String(row.emoji) : fallback?.emoji,
      department: row.department ? String(row.department) : fallback?.department,
      aliases: Array.from(new Set([row.name, row.role, row.id, ...(row.aliases || fallback?.aliases || [])].filter(Boolean).map(String))),
      brief: String(row.brief || row.intro || fallback?.brief || '负责完成自己岗位范围内的工作。'),
      capabilities: Array.from(new Set([...(row.capabilities || []), ...(fallback?.capabilities || [])].map(String))),
      preferredToolHints: Array.from(new Set([...(row.preferredToolHints || []), ...(fallback?.preferredToolHints || [])].map(String))),
    }
  })
}

function textOf(blocks: any): string {
  if (!Array.isArray(blocks)) return ''
  return blocks.filter((block) => block && block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('')
}

function clip(value: unknown, max: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max) + '…' : text
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 从子代理的真实返回里抽出它这一轮真正调用过的工具名。
 * 抽不到就是空数组 —— 绝不拿 preferredToolHints（"偏好工具"）冒充真实调用记录。
 */
function toolsOfResult(result: any): string[] {
  const names = new Set<string>()
  // 不做任何过滤：履历里的工具列表宁可带上公司自己的记忆/技能工具，也不能替子代理隐去任何一次真实调用
  // —— 只读渠道的越权审计（Router.auditWrite）就是拿这份列表判的。
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
  visit(result?.output, 0)
  visit(result?.messages, 0)
  for (const key of ['usedTools', 'toolNames', 'toolCalls', 'tools']) {
    const rows = (result as any)?.[key]
    if (Array.isArray(rows)) for (const row of rows) push(typeof row === 'string' ? row : row?.name || row?.tool)
  }
  return Array.from(names)
}

const STOP_COMPLETED = new Set(['completed', 'complete', 'done', 'finished', 'end_turn', 'stop'])
const STOP_BLOCKED = /(abort|cancel|interrupt|denied|deny|permission|refus)/
const STOP_FAILED = /(error|fail|crash|timeout|exceed|overflow)/

/**
 * 真实执行结果 → 履历 outcome。
 * 只看宿主观测得到的 stopReason / isError，永远不采信子代理自己说的成败（需求文档 6.1）。
 * completed 但一个字都没产出，只能算 partial —— 那不是一次成功交付。
 */
function outcomeOfRun(run: { stopReason?: unknown; isError?: boolean; reply?: string }): TaskOutcome {
  if (run.isError === true) return 'failed'
  const reason = String(run.stopReason ?? '').trim().toLowerCase()
  if (STOP_COMPLETED.has(reason)) return String(run.reply || '').trim() ? 'success' : 'partial'
  if (STOP_BLOCKED.test(reason)) return 'blocked'
  if (STOP_FAILED.test(reason)) return 'failed'
  return 'partial'
}

function marker(employee: Pick<Employee, 'id' | 'name'>, childId: string, state: string): string {
  return `[[NIUMA_STAFF id="${employee.id}" child="${childId}" state="${state}"]]`
}

function meetingMarker(value: unknown): string {
  return `[[NIUMA_MEETING state="done"]]\n${JSON.stringify(value)}`
}

function selectProvider(subagents: any, continuable: boolean): string | undefined {
  const names: string[] = typeof subagents?.list === 'function' ? subagents.list() : []
  const ranked = ['spawn', 'fork', ...names.filter((name) => name !== 'spawn' && name !== 'fork')]
  return ranked.find((name, index) => ranked.indexOf(name) === index && subagents.getProvider?.(name) && (!continuable || typeof subagents.getProvider(name).prepareContinuable === 'function'))
}

function employeeLabel(employee: Employee): string {
  return `赛博公司员工:v${EMPLOYEE_PERSONA_REVISION}:${employee.id}:${employee.name}`
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
    if (typeof value === 'string') {
      if (!INTERNAL_TOOL_NAMES.has(value)) collected.push({ name: value, source: sourceOfTool(value) })
      return
    }
    const name = String(value.name || value.id || value.key || '')
    if (!name || INTERNAL_TOOL_NAMES.has(name)) return
    collected.push({ name, source: String(value.source || value.provider || sourceOfTool(name)), description: typeof value.description === 'string' ? value.description : undefined })
  }
  const probes = ['list', 'names', 'keys', 'entries', 'getAll']
  for (const probe of probes) {
    try {
      const fn = tools?.[probe]
      if (typeof fn !== 'function') continue
      const result = await Promise.resolve(fn.call(tools))
      if (Array.isArray(result)) result.forEach((item) => Array.isArray(item) ? push(item[1] || item[0]) : push(item))
      else if (result && typeof result[Symbol.iterator] === 'function') Array.from(result as Iterable<any>).forEach((item: any) => Array.isArray(item) ? push(item[1] || item[0]) : push(item))
    } catch {}
  }
  const registry = tools?.registry || tools?.tools || tools?._tools
  if (registry instanceof Map) registry.forEach((value: any, key: any) => push(value || key))
  else if (registry && typeof registry === 'object') Object.entries(registry).forEach(([key, value]) => push((value as any)?.name ? value : key))
  const dedup = new Map<string, RuntimeCapability>()
  for (const item of collected) if (!dedup.has(item.name)) dedup.set(item.name, item)
  return Array.from(dedup.values()).sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name))
}

async function ensureSeedSkills(store: EvolutionStore, employee: Employee) {
  for (const capability of employee.capabilities) {
    await store.seedSkill(employee.id, capability, `${employee.role}的基础能力。`, employee.preferredToolHints.slice(0, 5))
  }
}

/**
 * 一次待发出的 persona：文本 + 这次真正写进文本的记忆/复盘 id。
 * 记账刻意**不在这里做** —— persona 造好不等于发出去了（subagents.start 可能抛）。
 * 只有真的把它交给子代理的那个调用方，才有资格调 recordMemoryInjection。
 */
type PersonaBuild = { text: string; query: string; memoryIds: string[]; reflectionIds: string[] }

async function employeePersona(employee: Employee, store: EvolutionStore, task = ''): Promise<PersonaBuild> {
  await ensureSeedSkills(store, employee)
  const digest = await store.digestWithEvidence(employee.id, task, 6)
  const text = [
    `你是“${employee.name}”，赛博公司的${employee.role}。`,
    employee.brief,
    `你的基础能力：${employee.capabilities.join('、') || '按岗位完成任务'}。`,
    '',
    '你是一个独立工作的真实子代理，不是主 Agent 的角色扮演，也不要自称主 Agent。',
    '你现在就是被点名的员工本人：直接回答老板，不要调用 staff_chat 或 staff_meeting，不要执行秘书的转交规则，也绝不能输出 [NIUMA_RELAY_ACK] 或 [NIUMA_DIRECT_ACK]。',
    '始终以自己的岗位身份直接与老板交流；先回应老板的问题，再执行需要的工作。不能完成时如实说明阻塞原因，不得编造进度、结果或其他员工的发言。',
    '',
    '【自我进化协议】',
    `1. 处理非 trivial 任务前，优先调用 ${MEMORY_TOOL}，staff 固定填写“${employee.id}”，检索与当前任务相关的历史经验、偏好和项目记忆。`,
    `2. 如果现有工具不够，调用 ${CAPABILITY_TOOL} 查看当前 DSH/Cordis/MCP/连接器已经暴露的真实工具；找到可复用能力后调用 ${SKILL_TOOL} 绑定成自己的技能。不要声称安装了实际上不存在的插件。`,
    `3. 发现稳定的用户偏好、项目事实、工作流或可复用经验时，调用 ${REMEMBER_TOOL} 写入长期记忆。`,
    `4. 完成有价值的任务后调用 ${REFLECT_TOOL} 做一次简短复盘，把真正可复用的经验留下；不要为了刷经验写空洞记忆。`,
    `5. ${SKILL_TOOL} 只是登记「我知道有这个能力」，它的 success 字段不会被采信、也不会让技能升级：技能等级只由宿主真实观测到的执行结果（Smoke Test 的真实返回、安装命令的真实退出码、真实工具调用）决定。想涨级就去把活真跑一遍，不要靠自述。`,
    '6. 回复使用自然、简洁的中文；不要把私有记忆摘要原样复述给老板，除非它与回答直接相关。',
    '',
    '【你的长期记忆摘要】',
    digest.text,
  ].join('\n')
  return { text, query: task, memoryIds: digest.memoryIds, reflectionIds: digest.reflectionIds }
}

function buildDispatcherPrompt(employees: Employee[]): string {
  const roster = employees.map((item) => `- ${item.name}（staff="${item.id}"，${item.role}）：${item.brief}`).join('\n')
  return `以下规则只适用于“赛博公司”老板当前会话中的秘书。如果部署 persona 已明确你是某位独立员工子代理，则立即忽略本节全部秘书规则，直接以该员工本人身份回答老板，绝不能输出 [NIUMA_RELAY_ACK]。

你是赛博公司的总裁秘书，也是当前主 Agent。未点名时负责接待、统筹与答复；老板点名其他员工时，只做不可见的真实直连路由，不得以秘书身份插话、复述或替员工回答。

真实员工名册：
${roster}

公司采用“持续成长员工”制度：员工拥有独立持久记忆、技能档案和插件学习记录。插件能力来自当前 DSH/Cordis/MCP/连接器实际暴露的工具；禁止虚构已经安装的插件。

强制路由规则：
1. 用户点名“秘书”时由你本人直接回答，不调用 ${STAFF_TOOL}。用户点名、询问或对其他员工说话时，必须调用 ${STAFF_TOOL} 把用户原话直达该员工；禁止自己用该员工口吻回答。
2. 调用 ${STAFF_TOOL} 后不得发送“已转交”“已接通”等秘书消息；工具返回 accepted 后只输出 [NIUMA_DIRECT_ACK]，工作台会隐藏该确认并等待员工本人回复。
3. 一次点名多人且明确要求讨论、商量、开会、一起评审、互相对话时调用 ${STAFF_MEETING_TOOL}；普通多人独立任务并行调用多次 ${STAFF_TOOL}。
4. 未点名但明确要求某岗位工作时选择最匹配员工：复杂搜索→阿搜；图片/设计→小画；视频/分镜→阿镜；小说/剧情→南枝；公众号/小红书/短视频内容→柚子；数据分析→小数；增长推广→小麦；综合团队任务→老王。
5. 收到 source.kind="subagent-settled" 的员工回话时，不得复述或润色，回复必须且只能是 [NIUMA_RELAY_ACK]；工作台会直接把子代理原话显示成该员工消息。
6. 老板询问员工成长、记忆、学会了什么或可用插件时，可以调用 ${PROFILE_TOOL} / ${CAPABILITY_TOOL} 后直接汇报事实；老板要求刷新工作台、查看整家公司状态或说「数据是空的」时，调用 ${SNAPSHOT_TOOL} 让工作台 hydrate 出真实历史数据。
7. 只有未点名的公司统筹、与员工无关的 Harness 操作或普通知识问答，才由你以“秘书”身份回答。`
}

export const inject = ['tools', 'subagents', 'systemPrompt']

/**
 * 可编程派活入口的入参。IM 通讯层（host-v3 注入的 EmployeeDispatcher）用它把一条外部消息
 * 交给真实员工子代理；Web 侧的 staff_chat 走同一套子代理逻辑，不存在第二份实现。
 *
 * writeGate 是结构化鸭子类型：host-v2 不 import IM 层，只认「有 allowed / isWriteTool」的对象，
 * 由 Router 在每一跳现造一把闸门传进来（见 integrations/im/types.ts 的 WriteGate）。
 */
export type StaffDispatchInput = {
  employeeId: string
  text: string
  /** 履历来源：飞书消息填 feishu，Web 填 web，系统触发填 system。 */
  source?: TaskSource
  channelId?: string
  platform?: string
  senderName?: string
  permissionMode?: string
  writeAllowed?: boolean
  writeGate?: { allowed: boolean; isWriteTool(tool: string): boolean }
  /** 执行根；不传就用最近一次真实出现过的主会话。 */
  agent?: unknown
  signal?: AbortSignal
}

export type StaffDispatchOutcome = {
  ok: boolean
  employeeId: string
  employeeName: string
  reply: string
  error?: string
  /** 这一轮真实观测到的工具调用；只读渠道的越权审计靠它。 */
  tools: string[]
  outcome: TaskOutcome
  taskId?: string
}

/**
 * host-v2 装配完成后交给 host-v3 的核心句柄。
 * Model Gateway / Plugin Runtime / Communication 必须复用这里的 store 与 company 实例，
 * 否则同一份 evolution.json / company.json 会出现两个写入者。
 */
export type OrgPanelCore = {
  store: EvolutionStore
  company: CompanyStore
  employees: Employee[]
  roster: EmployeeIdentity[]
  /**
   * 记忆相关的 `/org-panel` 端点（memory/evidence + memory/page）。
   * 挂在 core 上而不是 org-panel-read.ts 里，是因为它们读的是**注入台账**——
   * 那份台账属于本 core 实例的运行时状态，跟着 store 一起走，不该由别处再造一次。
   * host-v3 把它并进频道端点表。
   */
  memoryEndpoints: EndpointMap
  snapshot(options?: { taskLimit?: number; memoryLimit?: number }): Promise<unknown>
  /** 给某位员工派一条消息并拿回他本人的真实回复（复用 staff_chat 的子代理链路）。 */
  dispatch(input: StaffDispatchInput): Promise<StaffDispatchOutcome>
  /** 记住一个真实主会话当作派活执行根：DSH 只在工具执行上下文里提供 agent。 */
  bindAgent(agent: unknown): void
  /** 当前有没有可用的执行根；没有时外部渠道会如实报错而不是编造回复。 */
  hasAgent(): boolean
}

export function apply(ctx: any, config?: any): OrgPanelCore | undefined {
  const tools = ctx?.tools
  const subagents = ctx?.subagents
  const systemPrompt = ctx?.systemPrompt
  if (!tools || !subagents || !systemPrompt) {
    ctx?.logger?.warn?.('dsh-org-panel: staff routing unavailable because tools/subagents/systemPrompt is missing')
    return undefined
  }

  const employees = configuredEmployees(config)
  const routableEmployees = employees.filter((employee) => employee.id !== 'secretary')
  const byId = new Map(employees.map((employee) => [employee.id, employee]))
  const childCache = new Map<string, string>()
  const store = new EvolutionStore(config?.memoryFile)
  const company = new CompanyStore(store, config?.companyFile)
  const roster: EmployeeIdentity[] = employees.map((item) => ({ id: item.id, name: item.name, role: item.role, emoji: item.emoji, department: item.department, brief: item.brief }))
  const snapshot = (options?: { taskLimit?: number; memoryLimit?: number }) => company.snapshot(roster, {
    taskLimit: Number(options?.taskLimit) || 12,
    memoryLimit: Number(options?.memoryLimit) || 8,
  })

  const requireEmployee = (value: unknown): Employee => {
    const employee = byId.get(String(value))
    if (!employee) throw new Error(`unknown staff id: ${String(value)}`)
    return employee
  }

  // -------------------------------------------------------------------------
  // 执行根：DSH 只在工具执行上下文里给 agent，外部渠道（飞书等）没有自己的会话。
  // 这里记住最近一次真实出现过的主会话；一次都没出现过时如实报错，绝不伪造一个 parent。
  // -------------------------------------------------------------------------
  let lastAgent: any = null
  const rememberAgent = (exec: any): any => {
    const agent = exec?.agent
    if (agent) lastAgent = agent
    return agent
  }
  const resolveAgent = (candidate?: unknown): any => {
    if (candidate) return candidate
    if (lastAgent) return lastAgent
    // 宿主若自己暴露了主会话就用它。全部是可选探测，取不到就是取不到，不猜也不造。
    // 走 readCtxService：真实 cordis Context 上裸读 ctx.agent / ctx.agents 会抛「without inject」。
    for (const probe of [
      () => readCtxService(ctx, 'agent'),
      () => (readCtxService(ctx, 'agents') as any)?.current?.(),
      () => (readCtxService(ctx, 'agents') as any)?.main?.(),
      () => subagents?.rootAgent?.(),
    ]) {
      try {
        const value = probe()
        if (value) { lastAgent = value; return value }
      } catch {}
    }
    return null
  }

  // -------------------------------------------------------------------------
  // 工作履历（需求文档第五章）：派活即开单，真实结束才结单。
  // 写履历失败不能影响真实工作，只如实记一条日志。
  // -------------------------------------------------------------------------
  const openTask = async (employee: Employee, input: { title: string; description?: string; source?: TaskSource; channelId?: string }): Promise<string | null> => {
    try {
      const task = await store.startTask(employee.id, {
        title: clip(input.title, 60) || '未命名任务',
        description: input.description ? clip(input.description, 400) : undefined,
        source: input.source || 'web',
        channelId: input.channelId,
        // 工具列表在结束时按真实观测回填；开工时什么都还没调用，这里必须是空的。
        tools: [],
      })
      return task.id
    } catch (error) {
      ctx?.logger?.warn?.(`dsh-org-panel: 履历开单失败（${employee.id}）：${describeError(error)}`)
      return null
    }
  }

  const closeTask = async (taskId: string | null, employeeId: string, completion: { outcome: TaskOutcome; summary?: string; tools?: string[] }): Promise<void> => {
    if (!taskId) return
    try {
      await store.completeTask(taskId, {
        outcome: completion.outcome,
        summary: completion.summary ? clip(completion.summary, 400) : undefined,
        tools: completion.tools || [],
      }, employeeId)
    } catch (error) {
      ctx?.logger?.warn?.(`dsh-org-panel: 履历结单失败（${employeeId}/${taskId}）：${describeError(error)}`)
    }
  }

  type EmployeeRun = { runId: string; reply: string; stopReason: string; isError: boolean; tools: string[] }

  /**
   * 唯一一处「真实起一个员工子代理并等它跑完」的实现。
   * staff_chat 的一次性分支、staff_meeting 的每一轮发言、外部渠道派活全部复用它，不存在第二份。
   */
  const runEmployeeOnce = async (parent: any, employee: Employee, options: { label: string; prompt: string; personaTask?: string; signal: AbortSignal; taskId?: string | null }): Promise<EmployeeRun> => {
    const provider = selectProvider(subagents, false)
    if (!provider) throw new Error('没有可用的 DSH 子代理 provider，无法启动真实员工')
    const persona = await employeePersona(employee, store, options.personaTask ?? options.prompt)
    const run = await subagents.start(provider, {
      label: options.label,
      prompt: [{ type: 'text', text: options.prompt }],
      parent,
      persona: persona.text,
      maxDepth: 3,
      signal: options.signal,
    })
    // 子代理真的起来了 ⇒ 这段 persona 连同里面那批记忆确实发出去过，这时才记账（文档六十条）。
    // run.id 就是前端在 staff_chat 结果标记 / 结算事件里看到的 childId，chip 靠它认领这条消息。
    store.recordMemoryInjection({
      employeeId: employee.id, query: persona.query, memoryIds: persona.memoryIds, reflectionIds: persona.reflectionIds,
      taskId: options.taskId || undefined, childId: String(run.id ?? '') || undefined,
    })
    try {
      const result = await run.result
      return { runId: String(run.id ?? ''), reply: textOf(result?.output), stopReason: String(result?.stopReason ?? ''), isError: result?.isError === true, tools: toolsOfResult(result) }
    } finally {
      await run.dispose()
    }
  }

  // 持续会话（continuable child）没有前台 result 可 await。这里只认宿主 handle 上真实存在的
  // 结束信号；一个都没有时把这一轮挂起，等下一次真实观察点再如实结单，绝不猜一个 success。
  type PendingTurn = { employeeId: string; taskId: string; startedAt: number }
  const pendingTurns = new Map<string, PendingTurn>()

  const settleThenable = (handle: any): Promise<any> | null => {
    for (const key of ['result', 'settled', 'completion', 'done', 'finished']) {
      const candidate = handle?.[key]
      if (candidate && typeof candidate.then === 'function') return candidate as Promise<any>
    }
    return null
  }

  const trackContinuable = (childId: string, employeeId: string, taskId: string | null, handle: any): void => {
    if (!taskId) return
    const settle = settleThenable(handle)
    if (!settle) {
      pendingTurns.set(childId, { employeeId, taskId, startedAt: Date.now() })
      return
    }
    void settle.then(
      (result: any) => {
        const run = { reply: textOf(result?.output), stopReason: String(result?.stopReason ?? ''), isError: result?.isError === true, tools: toolsOfResult(result) }
        return closeTask(taskId, employeeId, { outcome: outcomeOfRun(run), summary: run.reply || `子代理结束原因：${run.stopReason || '未知'}`, tools: run.tools })
      },
      (error: unknown) => closeTask(taskId, employeeId, { outcome: 'failed', summary: `子代理异常结束：${describeError(error)}` }),
    )
  }

  /**
   * 持续会话接受了新一轮任务 ⇒ 上一轮确实已经结束。但这条链路上宿主拿不到成败，
   * 所以只记 partial 并写明原因 —— 不宣称成功，也不把一条真实发生过的工作丢掉。
   */
  const settlePending = async (childId: string): Promise<void> => {
    const pending = pendingTurns.get(childId)
    if (!pending) return
    pendingTurns.delete(childId)
    await closeTask(pending.taskId, pending.employeeId, { outcome: 'partial', summary: '子代理已接受下一轮任务，本轮宿主没有拿到结束信号，成败未知。' })
  }

  const resolveChild = async (parentId: string, employee: Employee, signal?: AbortSignal): Promise<string | undefined> => {
    const key = `${parentId}:${employee.id}`
    const cached = childCache.get(key)
    if (cached) return cached
    if (typeof subagents.listChildren !== 'function') return undefined
    const entries = await subagents.listChildren(parentId, signal)
    const hit = entries.find((entry: any) => entry?.kind === 'child' && entry.mode === 'continuable' && entry.label === employeeLabel(employee))
    if (hit?.id) childCache.set(key, hit.id)
    return hit?.id
  }

  const memoryRecallTool = {
    name: MEMORY_TOOL,
    description: '读取某位数字员工自己的持久长期记忆。用于在执行新任务前找回用户偏好、项目事实、历史经验和工作流。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['staff', 'query'],
      properties: {
        staff: { type: 'string', enum: employees.map((item) => item.id) },
        query: { type: 'string', minLength: 1 },
        limit: { type: 'number', minimum: 1, maximum: 12 },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] } },
    isConcurrencySafe: () => true,
    async execute(args: any, exec?: any) {
      rememberAgent(exec)
      const employee = requireEmployee(args.staff)
      await ensureSeedSkills(store, employee)
      const memories = await store.recall(employee.id, String(args.query || ''), Number(args.limit || 6))
      return { staffId: employee.id, staffName: employee.name, count: memories.length, memories: memories.map((item) => ({ kind: item.kind, text: item.text, tags: item.tags, importance: item.importance, used: item.useCount })) }
    },
  }

  const rememberTool = {
    name: REMEMBER_TOOL,
    description: '把稳定、可复用的信息写入某位员工的长期记忆。只记录真实偏好、事实、经验、关系或工作流，不记录空洞总结。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['staff', 'text'],
      properties: {
        staff: { type: 'string', enum: employees.map((item) => item.id) },
        kind: { type: 'string', enum: ['preference', 'lesson', 'project', 'fact', 'relationship', 'workflow'] },
        text: { type: 'string', minLength: 3 },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 12 },
        importance: { type: 'number', minimum: 1, maximum: 5 },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: `已写入${value.staffName}长期记忆：${value.text}` }] } },
    isConcurrencySafe: () => true,
    async execute(args: any, exec?: any) {
      rememberAgent(exec)
      const employee = requireEmployee(args.staff)
      const memory = await store.remember(employee.id, { kind: (args.kind || 'lesson') as MemoryKind, text: String(args.text), tags: Array.isArray(args.tags) ? args.tags.map(String) : [], importance: Number(args.importance || 3) })
      return { staffId: employee.id, staffName: employee.name, memoryId: memory.id, kind: memory.kind, text: memory.text, importance: memory.importance }
    },
  }

  const skillLearnTool = {
    name: SKILL_TOOL,
    description: '让员工把已经发现的运行时工具、MCP、Cordis 插件或经验登记成自己的技能。该工具不安装不存在的插件，也不会因为你说"成功了"就给技能升级：等级只由真实执行证据决定。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['staff', 'name'],
      properties: {
        staff: { type: 'string', enum: employees.map((item) => item.id) },
        name: { type: 'string', minLength: 2 },
        category: { type: 'string' },
        summary: { type: 'string' },
        source: { type: 'string', enum: ['experience', 'plugin', 'manual'] },
        toolNames: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20, description: 'source=plugin 时必填：这项技能真正依赖的工具名，必须能在当前 Tool Registry 里找到。' },
        pluginNames: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        success: { type: 'boolean', description: '自述成败，仅作参考：不会写入证据、不会影响等级。真实证据请走 Smoke Test / staff_skill_evidence。' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: `${value.staffName} 已登记技能：${value.skill.name} Lv.${value.skill.level}（${value.note}）` }] } },
    isConcurrencySafe: () => true,
    async execute(args: any, exec?: any) {
      rememberAgent(exec)
      const employee = requireEmployee(args.staff)
      const catalog = await runtimeCapabilities(tools)
      const requested = Array.isArray(args.toolNames) ? args.toolNames.map(String) : []
      const verified = requested.filter((name: string) => catalog.some((item) => item.name === name) || INTERNAL_TOOL_NAMES.has(name))
      const source = args.source === 'manual' ? 'manual' : args.source === 'plugin' ? 'plugin' : 'experience'
      // 洞：toolNames 可选 + 空数组会整个绕过 Tool Registry 校验，于是「学会某插件」不需要任何真实工具存在。
      // 插件类技能必须点名至少一个真实存在的工具，否则就是在给不存在的能力发证书。
      if (source === 'plugin' && !verified.length) {
        throw new Error(`插件类技能必须至少点名一个当前 Tool Registry 里真实存在的工具。${requested.length ? `你给的 ${requested.join('、')} 一个都不存在。` : '你一个工具都没给。'}先用 ${CAPABILITY_TOOL} 看看现在到底有什么工具。`)
      }
      const skill = await store.learnSkill(employee.id, {
        name: String(args.name), category: String(args.category || '扩展能力'), summary: String(args.summary || ''), source,
        // 需求文档 6.1：自述的 success 一律不下传 —— 它会变成一条 SkillEvidence 并直接抬高等级，
        // 连调十几次就能自刷到 Lv.6。等级只能由宿主真实观测到的执行结果产生。
        toolNames: verified, pluginNames: Array.isArray(args.pluginNames) ? args.pluginNames.map(String) : [], success: undefined,
      })
      return {
        staffId: employee.id, staffName: employee.name, verifiedTools: verified,
        ignoredTools: requested.filter((name: string) => !verified.includes(name)),
        evidenceRecorded: false,
        ignoredSuccessClaim: typeof args.success === 'boolean' ? args.success : undefined,
        note: '技能已登记，但等级不会因为这次调用变化：自述成败不算证据，等级只由真实执行结果（Smoke Test 真实返回、安装命令真实退出码、真实工具调用）推导。',
        skill,
      }
    },
  }

  const reflectTool = {
    name: REFLECT_TOOL,
    description: '员工完成任务后进行真实复盘，沉淀可复用经验并增加成长经验值。避免空洞自夸。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['staff', 'task', 'outcome', 'lesson'],
      properties: {
        staff: { type: 'string', enum: employees.map((item) => item.id) },
        task: { type: 'string', minLength: 2 },
        outcome: { type: 'string', enum: ['success', 'partial', 'blocked', 'failed'] },
        lesson: { type: 'string', minLength: 3 },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 12 },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: `${value.staffName} 已完成复盘 · Lv.${value.level.level} ${value.level.title}` }] } },
    isConcurrencySafe: () => true,
    async execute(args: any, exec?: any) {
      rememberAgent(exec)
      const employee = requireEmployee(args.staff)
      await store.reflect(employee.id, { task: String(args.task), outcome: args.outcome, lesson: String(args.lesson), tags: Array.isArray(args.tags) ? args.tags.map(String) : [] })
      const profile = await store.profile(employee.id)
      return { staffId: employee.id, staffName: employee.name, xp: profile.xp, memories: profile.memories.length, skills: profile.skills.length, level: evolutionLevel(profile.xp) }
    },
  }

  const profileTool = {
    name: PROFILE_TOOL,
    description: '查看某位员工的成长档案：等级、经验、长期记忆数量、技能、已绑定插件和最近复盘。',
    parameters: { type: 'object', additionalProperties: false, required: ['staff'], properties: { staff: { type: 'string', enum: employees.map((item) => item.id) } } },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] } },
    isConcurrencySafe: () => true,
    async execute(args: any, exec?: any) {
      rememberAgent(exec)
      const employee = requireEmployee(args.staff)
      await ensureSeedSkills(store, employee)
      const profile = await store.profile(employee.id)
      const pluginNames = Array.from(new Set(profile.skills.flatMap((skill) => skill.pluginNames)))
      return {
        staffId: employee.id, staffName: employee.name, role: employee.role, level: evolutionLevel(profile.xp), xp: profile.xp, revision: profile.revision,
        memoryCount: profile.memories.length, skillCount: profile.skills.length, pluginNames,
        skills: profile.skills.slice().sort((a, b) => b.level - a.level).slice(0, 20).map((skill) => ({ name: skill.name, level: skill.level, source: skill.source, tools: skill.toolNames, plugins: skill.pluginNames, successes: skill.successes, failures: skill.failures })),
        recentReflections: profile.reflections.slice(-5).reverse(),
      }
    },
  }

  const snapshotTool = {
    name: SNAPSHOT_TOOL,
    description: '一次性读取整家赛博公司的持久化状态：全部员工的等级、经验、统计、技能、插件绑定、模型能力与最近履历。前端打开一个全新的空 Session 时用它 hydrate 出历史数据。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        taskLimit: { type: 'number', minimum: 1, maximum: 50, description: '每位员工返回多少条最近履历，默认 12。' },
        memoryLimit: { type: 'number', minimum: 1, maximum: 30, description: '每位员工返回多少条最重要的记忆，默认 8。' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: JSON.stringify(value) }] } },
    isConcurrencySafe: () => true,
    async execute(args: any, exec?: any) {
      rememberAgent(exec)
      return snapshot({ taskLimit: Number(args?.taskLimit), memoryLimit: Number(args?.memoryLimit) })
    },
  }

  const capabilityScanTool = {
    name: CAPABILITY_TOOL,
    description: '扫描当前 DSH 运行时真实已经暴露的工具能力，包括 Cordis 插件、MCP、创意工具、外部连接器等；用于员工发现可学习插件。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        staff: { type: 'string', enum: employees.map((item) => item.id) },
        query: { type: 'string' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] } },
    isConcurrencySafe: () => true,
    async execute(args: any, exec?: any) {
      rememberAgent(exec)
      const query = String(args.query || '').toLowerCase()
      const catalog = await runtimeCapabilities(tools)
      const visible = query ? catalog.filter((item) => (item.name + ' ' + item.source + ' ' + (item.description || '')).toLowerCase().includes(query)) : catalog
      const grouped: Record<string, RuntimeCapability[]> = {}
      for (const item of visible.slice(0, 120)) (grouped[item.source] ||= []).push(item)
      return { staffId: args.staff ? String(args.staff) : undefined, count: visible.length, groups: grouped, note: '这里只列出当前运行时能发现的真实工具；市场插件安装后会在下一次扫描中出现。' }
    },
  }

  const staffTool = {
    name: STAFF_TOOL,
    description: '老板点名后直连一名真实、独立、可持续成长的数字员工。员工复用持续会话，并拥有持久记忆和技能档案。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['staff', 'message'],
      properties: {
        staff: { type: 'string', enum: routableEmployees.map((employee) => employee.id), description: '员工 id，必须来自赛博公司员工名册。' },
        message: { type: 'string', minLength: 1, description: '老板发给员工的完整原话或任务，不要改写成秘书口吻。' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, required: ['kind', 'staffId', 'staffName', 'subagentId', 'reply'], properties: { kind: { type: 'string', enum: ['continuable', 'foreground'] }, staffId: { type: 'string' }, staffName: { type: 'string' }, subagentId: { type: 'string' }, reply: { type: 'string' } } },
      render(_args: any, value: any) {
        const employee = byId.get(value.staffId) || { id: value.staffId, name: value.staffName }
        const tag = marker(employee, value.subagentId, value.kind === 'continuable' ? 'accepted' : 'replied')
        return [{ type: 'text', text: value.reply ? `${tag}\n${value.staffName}回复：\n${value.reply}` : `${tag}\n已建立老板与${value.staffName}的直连通道，等待本人回复。` }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args: any, exec: any) {
      const parent = rememberAgent(exec)
      if (!parent) throw new Error('staff_chat requires a live parent agent')
      const employee = requireEmployee(args.staff)
      const message = String(args.message || '').trim()
      if (!message) throw new Error('staff_chat message must not be empty')
      const signal: AbortSignal = exec.signal || new AbortController().signal
      const parentId = String(parent.session.id)
      const source = { kind: 'coordinator', form: 'relay', senderSessionId: parent.session.id }
      await ensureSeedSkills(store, employee)
      const memoryDigest = await store.digestWithEvidence(employee.id, message, 5)
      const enrichedMessage = `[系统私有上下文：以下是你的长期记忆摘要，只用于帮助本次工作，不要机械复述。]\n${memoryDigest.text}\n\n[老板原话]\n${message}`

      let childId = await resolveChild(parentId, employee, signal)
      if (childId) {
        // 同一个持续会话接受新一轮任务 ⇒ 上一轮已经结束，先如实结掉上一轮的履历再开新单。
        await settlePending(childId)
        const taskId = await openTask(employee, { title: message, description: message, source: 'web' })
        let handle: any
        try {
          handle = await subagents.followup(parent, childId, [{ type: 'text', text: enrichedMessage }], { source, signal })
        } catch (error) {
          // 派不出去就没有这次工作，履历不能永远挂在「进行中」。
          await closeTask(taskId, employee.id, { outcome: 'failed', summary: `派活失败：${describeError(error)}` })
          throw error
        }
        // enrichedMessage 真的送出去了，这批记忆才算注入过（派活失败的那一路一条都不记）。
        store.recordMemoryInjection({
          employeeId: employee.id, query: message, memoryIds: memoryDigest.memoryIds, reflectionIds: memoryDigest.reflectionIds,
          taskId: taskId || undefined, childId,
        })
        trackContinuable(childId, employee.id, taskId, handle)
        return { kind: 'continuable', staffId: employee.id, staffName: employee.name, subagentId: String(childId), reply: '' }
      }

      const continuableProvider = selectProvider(subagents, true)
      if (continuableProvider) {
        const taskId = await openTask(employee, { title: message, description: message, source: 'web' })
        // persona 提前造好：记账要用它带回来的那批 id，而且只有 startContinuable 真成功了才记。
        const persona = await employeePersona(employee, store, message)
        let started: any
        try {
          started = await subagents.startContinuable({
            provider: continuableProvider,
            label: employeeLabel(employee),
            request: { prompt: [{ type: 'text', text: message }], parent, persona: persona.text, maxDepth: 3 },
            signal,
          })
        } catch (error) {
          await closeTask(taskId, employee.id, { outcome: 'failed', summary: `派活失败：${describeError(error)}` })
          throw error
        }
        childId = String(started.childId)
        store.recordMemoryInjection({
          employeeId: employee.id, query: persona.query, memoryIds: persona.memoryIds, reflectionIds: persona.reflectionIds,
          taskId: taskId || undefined, childId,
        })
        childCache.set(`${parentId}:${employee.id}`, childId)
        trackContinuable(childId, employee.id, taskId, started)
        return { kind: 'continuable', staffId: employee.id, staffName: employee.name, subagentId: childId, reply: '' }
      }

      const taskId = await openTask(employee, { title: message, description: message, source: 'web' })
      let run: EmployeeRun
      try {
        run = await runEmployeeOnce(parent, employee, { label: employeeLabel(employee), prompt: message, signal, taskId })
      } catch (error) {
        await closeTask(taskId, employee.id, { outcome: 'failed', summary: `子代理异常：${describeError(error)}` })
        throw error
      }
      // 履历成败只看真实 stopReason / isError，不看子代理自己怎么说。
      await closeTask(taskId, employee.id, { outcome: outcomeOfRun(run), summary: run.reply || `子代理结束原因：${run.stopReason || '未知'}`, tools: run.tools })
      if (run.stopReason !== 'completed') throw new Error(`${employee.name} 子代理异常结束：${run.stopReason}${run.reply ? `\n${run.reply}` : ''}`)
      await store.remember(employee.id, { kind: 'project', text: `完成任务「${clip(message, 72)}」；交付摘要：${clip(run.reply, 160)}`, tags: ['任务记录'], importance: 2 })
      return { kind: 'foreground', staffId: employee.id, staffName: employee.name, subagentId: run.runId, reply: run.reply }
    },
  }

  /** 会议里的一轮真实发言。异常与非正常结束都会先把这位同事的履历如实结掉再抛。 */
  const runMeetingTurn = async (parent: any, employee: Employee, prompt: string, signal: AbortSignal, taskId: string | null): Promise<EmployeeRun> => {
    let run: EmployeeRun
    try {
      run = await runEmployeeOnce(parent, employee, { label: `赛博公司会议:${employee.id}:${employee.name}`, prompt, signal, taskId })
    } catch (error) {
      await closeTask(taskId, employee.id, { outcome: 'failed', summary: `会议发言异常：${describeError(error)}` })
      throw error
    }
    if (run.stopReason !== 'completed') {
      await closeTask(taskId, employee.id, { outcome: outcomeOfRun(run), summary: run.reply || `结束原因：${run.stopReason || '未知'}`, tools: run.tools })
      throw new Error(`${employee.name} 会议发言异常结束：${run.stopReason}${run.reply ? `\n${run.reply}` : ''}`)
    }
    return run
  }

  const staffMeetingTool = {
    name: STAFF_MEETING_TOOL,
    description: '让老板点名的 2 至 4 名真实独立员工围绕同一主题开短会，并读取前序同事观点依次回应。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['staff', 'topic'],
      properties: {
        staff: { type: 'array', minItems: 2, maxItems: 4, uniqueItems: true, items: { type: 'string', enum: routableEmployees.map((employee) => employee.id) } },
        topic: { type: 'string', minLength: 1 },
      },
    },
    output: { schema: { type: 'object', additionalProperties: false, required: ['kind', 'topic', 'turns'], properties: { kind: { type: 'string', enum: ['meeting'] }, topic: { type: 'string' }, turns: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['staffId', 'staffName', 'reply'], properties: { staffId: { type: 'string' }, staffName: { type: 'string' }, reply: { type: 'string' } } } } } }, render(_args: any, value: any) { return [{ type: 'text', text: meetingMarker(value) }] } },
    isConcurrencySafe: () => false,
    async execute(args: any, exec: any) {
      const parent = rememberAgent(exec)
      if (!parent) throw new Error('staff_meeting requires a live parent agent')
      const rawIds: string[] = (Array.isArray(args.staff) ? args.staff : []).map((value: unknown) => String(value))
      const participants = Array.from(new Set<string>(rawIds)).slice(0, 4).map((id) => byId.get(id)).filter((item): item is Employee => !!item && item.id !== 'secretary')
      if (participants.length < 2) throw new Error('staff_meeting requires at least two valid employees')
      const topic = String(args.topic || '').trim()
      if (!topic) throw new Error('staff_meeting topic must not be empty')
      const signal: AbortSignal = exec.signal || new AbortController().signal
      const turns: Array<{ staffId: string; staffName: string; reply: string }> = []
      const lead = participants[0]
      // 每位参会人一条真实履历。首位发言人还要做总结，所以他的单子留到总结跑完再结。
      let leadTaskId: string | null = null
      let leadTools: string[] = []
      for (const employee of participants) {
        const transcript = turns.length ? `\n\n前序同事观点：\n${turns.map((turn) => `${turn.staffName}：${turn.reply}`).join('\n')}` : ''
        const taskId = await openTask(employee, { title: `会议：${topic}`, description: topic, source: 'web' })
        const run = await runMeetingTurn(parent, employee, `老板让你与 ${participants.filter((item) => item.id !== employee.id).map((item) => item.name).join('、')} 围绕以下主题开短会：\n${topic}${transcript}\n\n请从你的岗位和长期经验出发回应前序观点，提出明确建议，控制在 180 字内。`, signal, taskId)
        turns.push({ staffId: employee.id, staffName: employee.name, reply: run.reply })
        if (employee.id === lead.id) { leadTaskId = taskId; leadTools = run.tools }
        else await closeTask(taskId, employee.id, { outcome: outcomeOfRun(run), summary: run.reply, tools: run.tools })
      }
      const recap = await runMeetingTurn(parent, lead, `你刚与同事围绕“${topic}”开会。完整发言如下：\n${turns.map((turn) => `${turn.staffName}：${turn.reply}`).join('\n')}\n\n请作为首位发言人用不超过 140 字给出共同结论和下一步。`, signal, leadTaskId)
      await closeTask(leadTaskId, lead.id, { outcome: outcomeOfRun(recap), summary: recap.reply, tools: leadTools.concat(recap.tools) })
      turns.push({ staffId: lead.id, staffName: lead.name, reply: recap.reply })
      return { kind: 'meeting', topic, turns }
    },
  }

  const PLATFORM_LABEL: Record<string, string> = { feishu: '飞书', qq: 'QQ', wechat: '微信', web: '工作台', system: '系统' }

  /**
   * 可编程派活入口（Phase 6 的 EmployeeDispatcher 就是它）。
   *
   * 与 staff_chat 共用同一条真实子代理链路（runEmployeeOnce）、同一份 persona、同一份记忆与技能，
   * 所以飞书来的消息落到的就是名册里那位员工本人，不存在「飞书老王」。
   * 这里必须拿到真实回复，所以走一次性前台子代理（continuable 分支不返回文本，外部渠道用不了）。
   */
  const dispatch = async (input: StaffDispatchInput): Promise<StaffDispatchOutcome> => {
    const employeeId = String(input.employeeId || '')
    const employee = byId.get(employeeId)
    const fail = (error: string, outcome: TaskOutcome = 'blocked'): StaffDispatchOutcome =>
      ({ ok: false, employeeId, employeeName: employee?.name || employeeId, reply: '', error, tools: [], outcome })
    if (!employee) return fail(`赛博公司名册里没有 ${employeeId || '（空）'} 这位员工。`)
    const text = String(input.text || '').trim()
    if (!text) return fail('消息内容为空，没有可派的活。')
    const parent = resolveAgent(input.agent)
    if (!parent) {
      // 绝不伪造一个 parent，也绝不编一句员工回复：如实说明为什么现在跑不了。
      return fail('赛博公司还没有可用的执行根：DSH 只在工具执行上下文里提供 agent，请老板先在工作台里与公司交互一次（任意一个 staff_* 工具即可），之后外部渠道的消息才能真实派给员工。')
    }
    const signal = input.signal || new AbortController().signal
    const source: TaskSource = input.source || 'system'
    const writeAllowed = input.writeGate ? input.writeGate.allowed : input.writeAllowed !== false
    const platform = PLATFORM_LABEL[String(input.platform || source)] || String(input.platform || source)
    const prompt = [
      `[外部渠道消息 · ${platform}]`,
      `发信人：${input.senderName || '未署名'}${input.permissionMode ? `（权限档位：${input.permissionMode}）` : ''}`,
      writeAllowed
        ? '本渠道允许写操作，但仍以老板的原话为准，不要擅自扩大改动范围。'
        : '本渠道是只读档位：禁止任何写操作（改文件、执行命令、安装插件、外发消息）。做不到就如实说明，不要绕道，也不要假装已经做完。',
      '你的回复会被原样转发回这个渠道，直接以你本人的身份回答，不要写成给秘书的转述。',
      '',
      '[原始消息]',
      text,
    ].join('\n')

    const taskId = await openTask(employee, { title: text, description: text, source, channelId: input.channelId })
    let run: EmployeeRun
    try {
      run = await runEmployeeOnce(parent, employee, { label: `赛博公司外部消息:${employee.id}:${employee.name}`, prompt, personaTask: text, signal, taskId })
    } catch (error) {
      const message = describeError(error)
      await closeTask(taskId, employee.id, { outcome: 'failed', summary: `子代理异常：${message}` })
      return { ok: false, employeeId: employee.id, employeeName: employee.name, reply: '', error: message, tools: [], outcome: 'failed', taskId: taskId || undefined }
    }
    // 只读渠道：闸门只能拦住走它的调用，子代理到底动没动手只能按真实观测判定。
    // 这里如实把观测到的工具全部上报，Router.auditWrite 会据此判越权并拦掉回复。
    const gate = input.writeGate
    const violations = gate && !gate.allowed ? run.tools.filter((tool) => gate.isWriteTool(tool)) : []
    const outcome: TaskOutcome = violations.length ? 'blocked' : outcomeOfRun(run)
    await closeTask(taskId, employee.id, {
      outcome,
      summary: violations.length ? `只读渠道下观测到写工具调用：${violations.join('、')}` : (run.reply || `子代理结束原因：${run.stopReason || '未知'}`),
      tools: run.tools,
    })
    if (run.stopReason && run.stopReason !== 'completed') {
      return { ok: false, employeeId: employee.id, employeeName: employee.name, reply: run.reply, error: `子代理异常结束：${run.stopReason}`, tools: run.tools, outcome, taskId: taskId || undefined }
    }
    return { ok: true, employeeId: employee.id, employeeName: employee.name, reply: run.reply, tools: run.tools, outcome, taskId: taskId || undefined }
  }

  systemPrompt.section({ name: 'dsh-org-panel:dispatcher', order: -10, text: buildDispatcherPrompt(employees) })
  tools.register(memoryRecallTool)
  tools.register(rememberTool)
  tools.register(skillLearnTool)
  tools.register(reflectTool)
  tools.register(profileTool)
  tools.register(capabilityScanTool)
  tools.register(snapshotTool)
  tools.register(staffTool)
  tools.register(staffMeetingTool)

  // 迁移只在首次读盘时发生；这里顺带把结果写进日志，让老板知道 V1 档案已备份。
  void store.profile('secretary').then(() => {
    if (store.migratedFrom) ctx?.logger?.info?.(`dsh-org-panel: evolution store migrated v${store.migratedFrom} → v2, backup: ${store.backupPath || 'failed'}`)
    // 档案损坏是必须让老板立刻看到的事：要么已经备份，要么本次运行拒绝写入。
    if (store.corruptBackupPath) ctx?.logger?.warn?.(`dsh-org-panel: ${store.filePath} 解析失败，损坏原文已备份到 ${store.corruptBackupPath}，本次以空档案继续运行`)
    if (store.writeBlocked) ctx?.logger?.error?.(`dsh-org-panel: ${store.writeBlocked}`)
  }).catch((error: unknown) => ctx?.logger?.warn?.(`dsh-org-panel: evolution store 初始化失败：${describeError(error)}`))

  return {
    store, company, employees, roster, snapshot, dispatch,
    memoryEndpoints: memoryEndpoints({ store, roster }),
    bindAgent: (agent: unknown) => { if (agent) lastAgent = agent },
    hasAgent: () => !!resolveAgent(),
  }
}
