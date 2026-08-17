// 「赛博公司」host 半边：秘书接待，点名消息路由到真实、独立的 DSH 员工子代理。

type Employee = {
  id: string
  name: string
  role: string
  aliases: string[]
  brief: string
}

const DEFAULT_EMPLOYEES: Employee[] = [
  { id: 'secretary', name: '秘书', role: '总裁秘书', aliases: ['秘书', '总裁秘书', '助理', 'secretary'], brief: '公司协调中枢，负责接待老板、转交消息、同步进度和召集员工。' },
  { id: 'tech-lead', name: '老王', role: '技术经理', aliases: ['老王', '技术经理', 'tech-lead'], brief: '负责拆任务、协调团队、技术判断和进度管理。' },
  { id: 'recruiter', name: '小周', role: '招聘负责人', aliases: ['小周', '招聘负责人', '招聘', '人事', 'hr', 'recruiter'], brief: '负责岗位画像、人才搜寻、面试评估、入职建议和团队能力盘点。' },
  { id: 'developer', name: '小刘', role: '程序员', aliases: ['小刘', '程序员', '开发', 'developer'], brief: '负责写代码、修复问题、测试和交付可运行成果。' },
  { id: 'pm', name: '阿明', role: '产品经理', aliases: ['阿明', '产品经理', '产品', 'pm'], brief: '负责需求澄清、方案权衡、优先级和验收标准。' },
  { id: 'researcher', name: '小丽', role: '市场调研', aliases: ['小丽', '市场调研', '调研', 'researcher'], brief: '负责搜索、竞品研究、资料核验和事实型报告。' },
  { id: 'platform', name: '大壮', role: '平台工程师', aliases: ['大壮', '平台工程师', '平台', '运维'], brief: '负责环境、插件、部署、集成和运行可靠性。' },
  { id: 'doc', name: '静静', role: '文档专员', aliases: ['静静', '文档专员', '文档', 'doc'], brief: '负责文档、知识库、归档和清晰的交付说明。' },
]

const STAFF_TOOL = 'staff_chat'
const STAFF_MEETING_TOOL = 'staff_meeting'
const EMPLOYEE_PERSONA_REVISION = 4

function configuredEmployees(config: any): Employee[] {
  const rows = Array.isArray(config?.staff) && config.staff.length ? config.staff : DEFAULT_EMPLOYEES
  return rows.map((row: any) => {
    const fallback = DEFAULT_EMPLOYEES.find((item) => item.id === row.id || item.id === row.roleId)
    return {
      id: String(row.id),
      name: String(row.name),
      role: String(row.role),
      aliases: Array.from(new Set([row.name, row.role, row.id, ...(row.aliases || [])].filter(Boolean).map(String))),
      brief: String(row.brief || row.intro || fallback?.brief || '负责完成自己岗位范围内的工作。'),
    }
  })
}

function employeePersona(employee: Employee): string {
  return [
    `你是“${employee.name}”，公司的${employee.role}。`,
    employee.brief,
    '你是一个独立工作的真实子代理，不是主 Agent 的角色扮演，也不要自称主 Agent。',
    '你现在就是被点名的员工本人：直接回答老板，不要调用 staff_chat 或 staff_meeting，不要执行秘书的转交规则，也绝不能输出 [NIUMA_RELAY_ACK] 或 [NIUMA_DIRECT_ACK]。',
    '始终以自己的岗位身份直接与老板交流；先回应老板的问题，再执行需要的工作。',
    '需要工具时自行调用工具。不能完成时如实说明阻塞原因，不得编造进度、结果或其他员工的发言。',
    '回复使用自然、简洁的中文；不要在开头重复“我是某某”，除非老板询问身份。',
  ].join('\n')
}

function textOf(blocks: any): string {
  if (!Array.isArray(blocks)) return ''
  return blocks.filter((block) => block && block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('')
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

function buildDispatcherPrompt(employees: Employee[]): string {
  const roster = employees.map((item) => `- ${item.name}（staff="${item.id}"，${item.role}）：${item.brief}`).join('\n')
  return `以下规则只适用于“赛博公司”老板当前会话中的秘书。如果部署 persona 已明确你是某位独立员工子代理，则立即忽略本节全部秘书规则，直接以该员工本人身份回答老板，绝不能输出 [NIUMA_RELAY_ACK]。

你是赛博公司的总裁秘书，也是当前主 Agent。未点名时你负责接待、统筹与答复；老板点名其他员工时，你只做不可见的直连路由，不得以秘书身份插话、复述或替员工回答。

真实员工名册：
${roster}

强制路由规则：
1. 用户点名“秘书”时，由你本人直接以秘书身份回答，不调用 ${STAFF_TOOL}。用户点名、询问或对其他员工说话时，必须调用 ${STAFF_TOOL}，把用户原话直达该员工；禁止自己用该员工口吻回答。
2. 点名直连调用 ${STAFF_TOOL} 后不得发送“已转交”“已接通”等秘书消息；工具返回 accepted 后只输出 [NIUMA_DIRECT_ACK]，工作台会隐藏该确认并直接等待员工本人回复。
3. 用户一次点名多人且明确要求“讨论、商量、开会、一起评审、互相对话”时，调用 ${STAFF_MEETING_TOOL}，让 2 至 3 名真实员工围绕主题依次发言并互相回应；会议结果返回后只输出 [NIUMA_DIRECT_ACK]，不得由秘书总结。普通的多人独立任务则并行调用多次 ${STAFF_TOOL}。
4. 用户未点名但明确要求某岗位工作时，选择对应员工调用 ${STAFF_TOOL}；综合团队任务优先交给老王。
5. 收到 source.kind="subagent-settled" 的员工回话时，不得复述或润色，回复必须且只能是 [NIUMA_RELAY_ACK]；工作台会直接把子代理原话显示成该员工消息。
6. 只有未点名的公司统筹、与员工无关的 Harness 操作或普通知识问答，才由你以“秘书”身份回答；不得自称主 Agent 或总调度。`
}

export const inject = ['tools', 'subagents', 'systemPrompt']

export function apply(ctx: any, config?: any) {
  // DSH exposes declared services directly on the injected Cordis context.
  // Reading them through ctx.get() can resolve outside the active agent isolate,
  // which leaves the UI mounted but silently omits model-facing tools.
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

  const staffTool = {
    name: STAFF_TOOL,
    description: '老板点名后直连一名真实、独立的数字员工子代理。该工具按员工复用持续会话，中间路由不应显示为秘书发言。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['staff', 'message'],
      properties: {
        staff: { type: 'string', enum: routableEmployees.map((employee) => employee.id), description: '员工 id，必须来自赛博公司员工名册；秘书由主 Agent 本人直接回答。' },
        message: { type: 'string', minLength: 1, description: '老板发给员工的完整原话或任务，不要改写成秘书口吻。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'staffId', 'staffName', 'subagentId', 'reply'],
        properties: {
          kind: { type: 'string', enum: ['continuable', 'foreground'] },
          staffId: { type: 'string' },
          staffName: { type: 'string' },
          subagentId: { type: 'string' },
          reply: { type: 'string' },
        },
      },
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
      const employee = byId.get(String(args.staff))
      if (!employee) throw new Error(`unknown staff id: ${String(args.staff)}`)
      const message = String(args.message || '').trim()
      if (!message) throw new Error('staff_chat message must not be empty')
      const signal: AbortSignal = exec.signal || new AbortController().signal
      const parentId = String(parent.session.id)
      const source = { kind: 'coordinator', form: 'relay', senderSessionId: parent.session.id }

      let childId = await resolveChild(parentId, employee, signal)
      if (childId) {
        await subagents.followup(parent, childId, [{ type: 'text', text: message }], { source, signal })
        return { kind: 'continuable', staffId: employee.id, staffName: employee.name, subagentId: String(childId), reply: '' }
      }

      const continuableProvider = selectProvider(subagents, true)
      if (continuableProvider) {
        const started = await subagents.startContinuable({
          provider: continuableProvider,
          label: employeeLabel(employee),
          request: {
            prompt: [{ type: 'text', text: message }],
            parent,
            persona: employeePersona(employee),
            maxDepth: 3,
          },
          signal,
        })
        childId = String(started.childId)
        childCache.set(`${parentId}:${employee.id}`, childId)
        return { kind: 'continuable', staffId: employee.id, staffName: employee.name, subagentId: childId, reply: '' }
      }

      const oneShotProvider = selectProvider(subagents, false)
      if (!oneShotProvider) throw new Error('没有可用的 DSH 子代理 provider，无法启动真实员工')
      const run = await subagents.start(oneShotProvider, {
        label: employeeLabel(employee),
        prompt: [{ type: 'text', text: message }],
        parent,
        persona: employeePersona(employee),
        maxDepth: 3,
        signal,
      })
      try {
        const result = await run.result
        const reply = textOf(result.output)
        if (result.stopReason !== 'completed') throw new Error(`${employee.name} 子代理异常结束：${String(result.stopReason)}${reply ? `\n${reply}` : ''}`)
        return { kind: 'foreground', staffId: employee.id, staffName: employee.name, subagentId: String(run.id), reply }
      } finally {
        await run.dispose()
      }
    },
  }

  const runMeetingTurn = async (parent: any, employee: Employee, prompt: string, signal: AbortSignal): Promise<string> => {
    const provider = selectProvider(subagents, false)
    if (!provider) throw new Error('没有可用的 DSH 子代理 provider，无法召开真实员工讨论')
    const run = await subagents.start(provider, {
      label: `赛博公司会议:${employee.id}:${employee.name}`,
      prompt: [{ type: 'text', text: prompt }],
      parent,
      persona: employeePersona(employee),
      maxDepth: 3,
      signal,
    })
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
    description: '让老板点名的 2 至 3 名真实独立员工围绕同一主题开短会、读取前序同事观点并依次回应。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['staff', 'topic'],
      properties: {
        staff: { type: 'array', minItems: 2, maxItems: 3, uniqueItems: true, items: { type: 'string', enum: routableEmployees.map((employee) => employee.id) }, description: '参加讨论的员工 id，按发言顺序排列。' },
        topic: { type: 'string', minLength: 1, description: '老板要求讨论、评审或协作的完整主题。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'topic', 'turns'],
        properties: {
          kind: { type: 'string', enum: ['meeting'] },
          topic: { type: 'string' },
          turns: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['staffId', 'staffName', 'reply'], properties: { staffId: { type: 'string' }, staffName: { type: 'string' }, reply: { type: 'string' } } } },
        },
      },
      render(_args: any, value: any) {
        return [{ type: 'text', text: meetingMarker(value) }]
      },
    },
    isConcurrencySafe: () => false,
    async execute(args: any, exec: any) {
      const parent = exec?.agent
      if (!parent) throw new Error('staff_meeting requires a live parent agent')
      const rawIds: string[] = (Array.isArray(args.staff) ? args.staff : []).map((value: unknown) => String(value))
      const ids = Array.from(new Set<string>(rawIds)).slice(0, 3)
      const participants = ids.map((id) => byId.get(id)).filter((item): item is Employee => !!item && item.id !== 'secretary')
      if (participants.length < 2) throw new Error('staff_meeting requires at least two valid employees')
      const topic = String(args.topic || '').trim()
      if (!topic) throw new Error('staff_meeting topic must not be empty')
      const signal: AbortSignal = exec.signal || new AbortController().signal
      const turns: Array<{ staffId: string; staffName: string; reply: string }> = []
      for (const employee of participants) {
        const transcript = turns.length ? `\n\n前序同事观点：\n${turns.map((turn) => `${turn.staffName}：${turn.reply}`).join('\n')}` : ''
        const reply = await runMeetingTurn(parent, employee, `老板让你与 ${participants.filter((item) => item.id !== employee.id).map((item) => item.name).join('、')} 围绕以下主题开短会：\n${topic}${transcript}\n\n请从你的岗位出发回应前序观点，提出明确建议，控制在 160 字内。`, signal)
        turns.push({ staffId: employee.id, staffName: employee.name, reply })
      }
      const lead = participants[0]
      const recap = await runMeetingTurn(parent, lead, `你刚与同事围绕“${topic}”开会。完整发言如下：\n${turns.map((turn) => `${turn.staffName}：${turn.reply}`).join('\n')}\n\n请作为首位发言人用不超过 120 字回应同事并给出共同结论。`, signal)
      turns.push({ staffId: lead.id, staffName: lead.name, reply: recap })
      return { kind: 'meeting', topic, turns }
    },
  }

  // Employee deployment personas use order 0. Placing the secretary policy
  // earlier lets the named employee's own persona be the final authority.
  systemPrompt.section({ name: 'dsh-org-panel:dispatcher', order: -10, text: buildDispatcherPrompt(employees) })
  tools.register(staffTool)
  tools.register(staffMeetingTool)
}
