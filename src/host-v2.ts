// 「赛博公司」host v2：真实独立员工 + 持久记忆 + 技能进化 + 运行时插件发现。
import { EMPLOYEE_BLUEPRINTS, employeeById } from './org-blueprints'
import { EvolutionStore, evolutionLevel, type MemoryKind } from './evolution-store'

type Employee = {
  id: string
  name: string
  role: string
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
const EMPLOYEE_PERSONA_REVISION = 6
const MEMORY_TOOL = 'staff_memory_recall'
const REMEMBER_TOOL = 'staff_memory_remember'
const SKILL_TOOL = 'staff_skill_learn'
const REFLECT_TOOL = 'staff_reflect'
const PROFILE_TOOL = 'staff_profile'
const CAPABILITY_TOOL = 'staff_capability_scan'
const INTERNAL_TOOL_NAMES = new Set([STAFF_TOOL, STAFF_MEETING_TOOL, MEMORY_TOOL, REMEMBER_TOOL, SKILL_TOOL, REFLECT_TOOL, PROFILE_TOOL, CAPABILITY_TOOL])

const DEFAULT_EMPLOYEES: Employee[] = EMPLOYEE_BLUEPRINTS.map((item) => ({
  id: item.id,
  name: item.name,
  role: item.role,
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

async function employeePersona(employee: Employee, store: EvolutionStore, task = ''): Promise<string> {
  await ensureSeedSkills(store, employee)
  const digest = await store.digest(employee.id, task, 6)
  return [
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
    '5. 新学到的插件/工具必须先真实调用或验证，再把 success=true；失败也要记录，让后续任务少踩坑。',
    '6. 回复使用自然、简洁的中文；不要把私有记忆摘要原样复述给老板，除非它与回答直接相关。',
    '',
    '【你的长期记忆摘要】',
    digest,
  ].join('\n')
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
6. 老板询问员工成长、记忆、学会了什么或可用插件时，可以调用 ${PROFILE_TOOL} / ${CAPABILITY_TOOL} 后直接汇报事实。
7. 只有未点名的公司统筹、与员工无关的 Harness 操作或普通知识问答，才由你以“秘书”身份回答。`
}

export const inject = ['tools', 'subagents', 'systemPrompt']

export function apply(ctx: any, config?: any) {
  const tools = ctx?.tools
  const subagents = ctx?.subagents
  const systemPrompt = ctx?.systemPrompt
  if (!tools || !subagents || !systemPrompt) {
    ctx?.logger?.warn?.('dsh-org-panel: staff routing unavailable because tools/subagents/systemPrompt is missing')
    return
  }

  const employees = configuredEmployees(config)
  const routableEmployees = employees.filter((employee) => employee.id !== 'secretary')
  const byId = new Map(employees.map((employee) => [employee.id, employee]))
  const childCache = new Map<string, string>()
  const store = new EvolutionStore(config?.memoryFile)

  const requireEmployee = (value: unknown): Employee => {
    const employee = byId.get(String(value))
    if (!employee) throw new Error(`unknown staff id: ${String(value)}`)
    return employee
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
    async execute(args: any) {
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
    async execute(args: any) {
      const employee = requireEmployee(args.staff)
      const memory = await store.remember(employee.id, { kind: (args.kind || 'lesson') as MemoryKind, text: String(args.text), tags: Array.isArray(args.tags) ? args.tags.map(String) : [], importance: Number(args.importance || 3) })
      return { staffId: employee.id, staffName: employee.name, memoryId: memory.id, kind: memory.kind, text: memory.text, importance: memory.importance }
    },
  }

  const skillLearnTool = {
    name: SKILL_TOOL,
    description: '让员工把已经发现/验证过的运行时工具、MCP、Cordis 插件或经验沉淀为自己的技能。该工具不安装不存在的插件。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['staff', 'name'],
      properties: {
        staff: { type: 'string', enum: employees.map((item) => item.id) },
        name: { type: 'string', minLength: 2 },
        category: { type: 'string' },
        summary: { type: 'string' },
        source: { type: 'string', enum: ['experience', 'plugin', 'manual'] },
        toolNames: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        pluginNames: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        success: { type: 'boolean' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: `${value.staffName} 已更新技能：${value.skill.name} Lv.${value.skill.level}` }] } },
    isConcurrencySafe: () => true,
    async execute(args: any) {
      const employee = requireEmployee(args.staff)
      const catalog = await runtimeCapabilities(tools)
      const requested = Array.isArray(args.toolNames) ? args.toolNames.map(String) : []
      const verified = requested.filter((name: string) => catalog.some((item) => item.name === name) || INTERNAL_TOOL_NAMES.has(name))
      const skill = await store.learnSkill(employee.id, {
        name: String(args.name), category: String(args.category || '扩展能力'), summary: String(args.summary || ''), source: args.source === 'manual' ? 'manual' : args.source === 'plugin' ? 'plugin' : 'experience',
        toolNames: verified, pluginNames: Array.isArray(args.pluginNames) ? args.pluginNames.map(String) : [], success: typeof args.success === 'boolean' ? args.success : undefined,
      })
      return { staffId: employee.id, staffName: employee.name, verifiedTools: verified, ignoredTools: requested.filter((name: string) => !verified.includes(name)), skill }
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
    async execute(args: any) {
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
    async execute(args: any) {
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
    async execute(args: any) {
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
      const parent = exec?.agent
      if (!parent) throw new Error('staff_chat requires a live parent agent')
      const employee = requireEmployee(args.staff)
      const message = String(args.message || '').trim()
      if (!message) throw new Error('staff_chat message must not be empty')
      const signal: AbortSignal = exec.signal || new AbortController().signal
      const parentId = String(parent.session.id)
      const source = { kind: 'coordinator', form: 'relay', senderSessionId: parent.session.id }
      await ensureSeedSkills(store, employee)
      const memoryDigest = await store.digest(employee.id, message, 5)
      const enrichedMessage = `[系统私有上下文：以下是你的长期记忆摘要，只用于帮助本次工作，不要机械复述。]\n${memoryDigest}\n\n[老板原话]\n${message}`

      let childId = await resolveChild(parentId, employee, signal)
      if (childId) {
        await subagents.followup(parent, childId, [{ type: 'text', text: enrichedMessage }], { source, signal })
        return { kind: 'continuable', staffId: employee.id, staffName: employee.name, subagentId: String(childId), reply: '' }
      }

      const continuableProvider = selectProvider(subagents, true)
      if (continuableProvider) {
        const started = await subagents.startContinuable({
          provider: continuableProvider,
          label: employeeLabel(employee),
          request: { prompt: [{ type: 'text', text: message }], parent, persona: await employeePersona(employee, store, message), maxDepth: 3 },
          signal,
        })
        childId = String(started.childId)
        childCache.set(`${parentId}:${employee.id}`, childId)
        return { kind: 'continuable', staffId: employee.id, staffName: employee.name, subagentId: childId, reply: '' }
      }

      const oneShotProvider = selectProvider(subagents, false)
      if (!oneShotProvider) throw new Error('没有可用的 DSH 子代理 provider，无法启动真实员工')
      const run = await subagents.start(oneShotProvider, { label: employeeLabel(employee), prompt: [{ type: 'text', text: message }], parent, persona: await employeePersona(employee, store, message), maxDepth: 3, signal })
      try {
        const result = await run.result
        const reply = textOf(result.output)
        if (result.stopReason !== 'completed') throw new Error(`${employee.name} 子代理异常结束：${String(result.stopReason)}${reply ? `\n${reply}` : ''}`)
        await store.remember(employee.id, { kind: 'project', text: `完成任务「${clip(message, 72)}」；交付摘要：${clip(reply, 160)}`, tags: ['任务记录'], importance: 2 })
        return { kind: 'foreground', staffId: employee.id, staffName: employee.name, subagentId: String(run.id), reply }
      } finally {
        await run.dispose()
      }
    },
  }

  const runMeetingTurn = async (parent: any, employee: Employee, prompt: string, signal: AbortSignal): Promise<string> => {
    const provider = selectProvider(subagents, false)
    if (!provider) throw new Error('没有可用的 DSH 子代理 provider，无法召开真实员工讨论')
    const run = await subagents.start(provider, { label: `赛博公司会议:${employee.id}:${employee.name}`, prompt: [{ type: 'text', text: prompt }], parent, persona: await employeePersona(employee, store, prompt), maxDepth: 3, signal })
    try {
      const result = await run.result
      const reply = textOf(result.output)
      if (result.stopReason !== 'completed') throw new Error(`${employee.name} 会议发言异常结束：${String(result.stopReason)}${reply ? `\n${reply}` : ''}`)
      return reply
    } finally {
      await run.dispose()
    }
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
      const parent = exec?.agent
      if (!parent) throw new Error('staff_meeting requires a live parent agent')
      const rawIds: string[] = (Array.isArray(args.staff) ? args.staff : []).map((value: unknown) => String(value))
      const participants = Array.from(new Set<string>(rawIds)).slice(0, 4).map((id) => byId.get(id)).filter((item): item is Employee => !!item && item.id !== 'secretary')
      if (participants.length < 2) throw new Error('staff_meeting requires at least two valid employees')
      const topic = String(args.topic || '').trim()
      if (!topic) throw new Error('staff_meeting topic must not be empty')
      const signal: AbortSignal = exec.signal || new AbortController().signal
      const turns: Array<{ staffId: string; staffName: string; reply: string }> = []
      for (const employee of participants) {
        const transcript = turns.length ? `\n\n前序同事观点：\n${turns.map((turn) => `${turn.staffName}：${turn.reply}`).join('\n')}` : ''
        const reply = await runMeetingTurn(parent, employee, `老板让你与 ${participants.filter((item) => item.id !== employee.id).map((item) => item.name).join('、')} 围绕以下主题开短会：\n${topic}${transcript}\n\n请从你的岗位和长期经验出发回应前序观点，提出明确建议，控制在 180 字内。`, signal)
        turns.push({ staffId: employee.id, staffName: employee.name, reply })
      }
      const lead = participants[0]
      const recap = await runMeetingTurn(parent, lead, `你刚与同事围绕“${topic}”开会。完整发言如下：\n${turns.map((turn) => `${turn.staffName}：${turn.reply}`).join('\n')}\n\n请作为首位发言人用不超过 140 字给出共同结论和下一步。`, signal)
      turns.push({ staffId: lead.id, staffName: lead.name, reply: recap })
      return { kind: 'meeting', topic, turns }
    },
  }

  systemPrompt.section({ name: 'dsh-org-panel:dispatcher', order: -10, text: buildDispatcherPrompt(employees) })
  tools.register(memoryRecallTool)
  tools.register(rememberTool)
  tools.register(skillLearnTool)
  tools.register(reflectTool)
  tools.register(profileTool)
  tools.register(capabilityScanTool)
  tools.register(staffTool)
  tools.register(staffMeetingTool)
}
