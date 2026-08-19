// Work Orchestrator：全渠道唯一业务协作入口。
//
// root session 只是不可见调度内核；真实业务输出来自具体数字员工。
// Web / 飞书 / QQ / 微信都把任务交到这里：自动组队、共享上下文、动态邀请、真实履历与成长。
import { ROLE_BLUEPRINTS } from '../org-blueprints'
import type { Employee, OrgPanelCore } from '../host-v2'
import type { TaskSource } from '../persistence/types'
import type { CompanyEvent } from '../runtime/company-events'
import { WorkSessionStore, type WorkSessionTurn } from './work-session-store'

export const COMPANY_WORK_TOOL = 'company_work'
export const MAX_WORKGROUP_SIZE = 4

export type WorkAttachment = {
  id?: string
  type?: string
  mime?: string
  name?: string
  localPath?: string
  url?: string
  size?: number
}

export type WorkPolicy = {
  allowed: boolean
  isWriteTool(tool: string): boolean
}

export type WorkRequest = {
  task: string
  source?: TaskSource
  platform?: string
  channelId?: string
  conversationId?: string
  messageId?: string
  threadId?: string
  senderId?: string
  senderName?: string
  /** 显式会话键优先；缺省按 platform/conversation/thread 自动复用长期工作组。 */
  sessionKey?: string
  permissionMode?: string
  attachments?: readonly WorkAttachment[]
  allowedEmployeeIds?: readonly string[]
  maxTeam?: number
  writePolicy?: WorkPolicy
  agent?: unknown
  signal?: AbortSignal
}

export type WorkRoute = {
  employeeId: string
  employeeName: string
  role: string
  score: number
  reasons: string[]
  explicit: boolean
}

export type WorkPlan = {
  task: string
  members: WorkRoute[]
  explicit: string[]
  mode: 'solo' | 'team'
}

export type WorkTurn = {
  staffId: string
  staffName: string
  role: string
  reply: string
  outcome: string
  taskId?: string
  tools: string[]
  error?: string
  policyViolation: boolean
}

export type WorkResult = {
  kind: 'meeting'
  topic: string
  task: string
  /** 稳定工作组 ID：同一外部会话 / Web Session 跨轮复用。 */
  teamId: string
  source: TaskSource
  platform: string
  participants: Array<{ staffId: string; staffName: string; role: string; reason: string }>
  turns: Array<{ staffId: string; staffName: string; reply: string }>
  details: WorkTurn[]
}

export type WorkOrchestrator = {
  toolName: typeof COMPANY_WORK_TOOL
  sessions: WorkSessionStore
  plan(task: string, options?: { maxTeam?: number; allowedEmployeeIds?: readonly string[] }): WorkPlan
  run(request: WorkRequest): Promise<WorkResult>
}

type EventSink = { publish(event: CompanyEvent, origin?: string): void }
type DomainRule = { id: string; match: RegExp; label: string; weight: number }

const DOMAIN_RULES: DomainRule[] = [
  { id: 'developer', match: /(代码|开发|编程|bug|修复|接口|前端|后端|数据库|重构|测试|构建|typescript|javascript|php|python|swift|react|api)/i, label: '工程实现', weight: 80 },
  { id: 'tech-lead', match: /(架构|技术方案|技术选型|复杂系统|性能|安全|重构|评审|多模块|协作|排期|风险)/i, label: '技术统筹', weight: 58 },
  { id: 'pm', match: /(需求|产品|prd|交互|流程|功能|优先级|用户体验|验收|方案|原型|产品设计)/i, label: '产品方案', weight: 62 },
  { id: 'image-creator', match: /(图片|生图|视觉|海报|封面|插画|角色设计|人物形象|logo|图标|ui设计|界面设计|配图|修图)/i, label: '视觉设计', weight: 82 },
  { id: 'video-producer', match: /(视频|分镜|镜头|剪辑|短片|短视频|字幕|配音|动画|成片|remotion|ffmpeg)/i, label: '视频制作', weight: 82 },
  { id: 'novelist', match: /(小说|故事|剧情|人物弧|世界观|章节|网文|剧本|对白|伏笔)/i, label: '剧情创作', weight: 78 },
  { id: 'social-editor', match: /(公众号|小红书|抖音|推特|twitter|帖子|自媒体|标题|爆款|内容矩阵|文案|选题)/i, label: '内容创作', weight: 78 },
  { id: 'growth', match: /(增长|推广|获客|运营|转化|渠道|投放|留存|传播|营销|起号)/i, label: '增长运营', weight: 74 },
  { id: 'data-analyst', match: /(数据|指标|报表|sql|统计|分析|可视化|转化率|留存率|实验数据)/i, label: '数据分析', weight: 74 },
  { id: 'search-specialist', match: /(搜索|检索|查证|资料|联网|找一下|搜一下|最新|来源|链接)/i, label: '搜索核验', weight: 68 },
  { id: 'researcher', match: /(调研|竞品|市场|行业|研究|报告|情报|趋势|对比)/i, label: '市场调研', weight: 62 },
  { id: 'platform', match: /(插件|mcp|cordis|部署|服务器|环境|配置|接入|集成|安装|运维|dsh|harness)/i, label: '平台与集成', weight: 76 },
  { id: 'doc', match: /(文档|知识库|手册|教程|说明|归档|交接|readme)/i, label: '文档沉淀', weight: 68 },
  { id: 'recruiter', match: /(招聘|候选人|简历|面试|岗位|人才|入职|hc|人事)/i, label: '招聘', weight: 76 },
  { id: 'secretary', match: /(日程|提醒|通知全员|会议安排|行政|总裁办|秘书|预约|行程)/i, label: '行政协调', weight: 72 },
]

const COMPLEX_TASK = /(完整|系统|全流程|从.+到|一起|协作|评审|方案|规划|设计并|实现并|分析并|先.+再|同时|多个|端到端|一整套)/i

function normalized(value: unknown): string { return String(value ?? '').trim().toLowerCase() }
function uniq<T>(values: T[]): T[] { return [...new Set(values)] }
function clip(value: unknown, max: number): string { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max)}…` : text }

function roleKeywords(employee: Employee): string[] {
  const blueprint = ROLE_BLUEPRINTS.find((item) => item.id === employee.id)
  return uniq([...(blueprint?.keywords || []), ...(employee.capabilities || []), ...(employee.aliases || []), employee.role]
    .map(String).map((item) => item.trim()).filter((item) => item.length >= 2))
}

function explicitMention(task: string, employee: Employee): boolean {
  const value = normalized(task)
  const names = uniq([employee.name, ...(employee.aliases || [])].map(String).map((item) => item.trim()).filter(Boolean))
  for (const name of names) if (value.includes(`@${normalized(name)}`)) return true
  const name = normalized(employee.name)
  return !!name && name.length >= 2 && value.includes(name)
}

function scoreEmployee(task: string, employee: Employee): WorkRoute {
  const explicit = explicitMention(task, employee)
  let score = explicit ? 1000 : 0
  const reasons: string[] = explicit ? ['明确点名'] : []
  const value = normalized(task)
  for (const rule of DOMAIN_RULES) {
    if (rule.id !== employee.id || !rule.match.test(task)) continue
    score += rule.weight
    reasons.push(rule.label)
  }
  for (const keyword of roleKeywords(employee)) {
    const key = normalized(keyword)
    if (!key || !value.includes(key)) continue
    score += Math.min(18, 6 + key.length)
    if (reasons.length < 4) reasons.push(`命中“${keyword}”`)
  }
  if (employee.id === 'secretary' && !explicit && !reasons.length) score -= 100
  return { employeeId: employee.id, employeeName: employee.name, role: employee.role, score, reasons: uniq(reasons), explicit }
}

export function planWorkgroup(task: string, employees: readonly Employee[], options: { maxTeam?: number; allowedEmployeeIds?: readonly string[] } = {}): WorkPlan {
  const text = String(task || '').trim()
  if (!text) return { task: '', members: [], explicit: [], mode: 'solo' }
  const limit = Math.max(1, Math.min(MAX_WORKGROUP_SIZE, Math.floor(Number(options.maxTeam) || 3)))
  const allow = options.allowedEmployeeIds?.length ? new Set(options.allowedEmployeeIds.map(String)) : null
  const pool = employees.filter((employee) => !allow || allow.has(employee.id))
  const ranked = pool.map((employee) => scoreEmployee(text, employee)).sort((a, b) => b.score - a.score || a.employeeName.localeCompare(b.employeeName))
  const explicit = ranked.filter((item) => item.explicit && item.score > 0)
  const picked: WorkRoute[] = explicit.slice(0, limit)
  const add = (candidate?: WorkRoute) => { if (candidate && picked.length < limit && !picked.some((item) => item.employeeId === candidate.employeeId)) picked.push(candidate) }

  if (!picked.length) {
    const top = ranked.find((item) => item.score > 0)
    add(top)
    if (top) {
      add(ranked.find((item) => item.employeeId !== top.employeeId && item.score >= Math.max(18, top.score * .42)))
      if (COMPLEX_TASK.test(text)) add(ranked.find((item) => !picked.some((chosen) => chosen.employeeId === item.employeeId) && item.score >= Math.max(14, top.score * .28)))
    }
  } else if (COMPLEX_TASK.test(text)) {
    for (const peer of ranked) {
      if (peer.explicit || picked.some((chosen) => chosen.employeeId === peer.employeeId)) continue
      if (peer.score < 22) break
      add(peer)
      if (picked.length >= limit) break
    }
  }

  if (!picked.length) {
    add(ranked.find((item) => item.employeeId === 'pm') || ranked.find((item) => item.employeeId !== 'secretary') || ranked[0])
    if (picked[0]) picked[0] = { ...picked[0], reasons: uniq(['任务意图需要先澄清', ...picked[0].reasons]) }
  }
  return { task: text, members: picked, explicit: explicit.map((item) => item.employeeId), mode: picked.length > 1 ? 'team' : 'solo' }
}

export function requestedPeers(text: string, employees: readonly Employee[]): Employee[] {
  const value = String(text || '')
  const lower = normalized(value)
  return employees.filter((employee) => {
    const names = uniq([employee.name, ...(employee.aliases || [])].map(String).map((item) => item.trim()).filter(Boolean))
    return names.some((name) => lower.includes(`@${normalized(name)}`)
      || (name === employee.name && (value.includes(`需要${name}`) || value.includes(`请${name}`) || value.includes(`让${name}`) || value.includes(`交给${name}`))))
  })
}

function attachmentText(attachments: readonly WorkAttachment[] = []): string {
  if (!attachments.length) return '（无附件）'
  return attachments.map((item, index) => `${index + 1}. ${item.name || item.type || '附件'}${item.mime ? ` · ${item.mime}` : ''} · ${item.localPath || item.url || item.id || '无可读取地址'}`).join('\n')
}

function historyText(history: readonly WorkSessionTurn[], current: readonly WorkTurn[]): string {
  const rows = [
    ...history.filter((turn) => turn.reply && !turn.policyViolation).slice(-12).map((turn) => `${turn.employeeName}（${turn.role}）：${turn.reply}`),
    ...current.filter((turn) => turn.reply && !turn.policyViolation).map((turn) => `${turn.staffName}（${turn.role}）：${turn.reply}`),
  ]
  return rows.length ? rows.join('\n\n') : '（这是这个工作组的第一条公开员工输出）'
}

function rosterText(employees: readonly Employee[]): string { return employees.map((item) => `${item.name}（${item.role}）`).join('、') }

function workPrompt(request: WorkRequest, employee: Employee, allEmployees: readonly Employee[], currentTurns: readonly WorkTurn[], history: readonly WorkSessionTurn[], planned: readonly WorkRoute[]): string {
  const team = planned.map((item) => `${item.employeeName}（${item.role}）`).join('、') || employee.name
  return [
    '[赛博公司持久工作组]',
    `任务来源：${request.platform || request.source || 'web'}${request.senderName ? ` · ${request.senderName}` : ''}`,
    `老板 / 外部会话本轮原话：${request.task}`,
    `本轮计划成员：${team}`,
    `你以“${employee.name} / ${employee.role}”身份加入。所有员工是平级同事；不存在主 Agent / 子 Agent 的产品等级。`,
    request.permissionMode ? `当前渠道权限：${request.permissionMode}` : '',
    request.writePolicy && !request.writePolicy.allowed ? '当前来源为只读权限：禁止执行写操作；做不到就明确说明。' : '',
    '', '附件：', attachmentText(request.attachments), '',
    '这个工作组此前与本轮前序同事的真实公开输出：', historyText(history, currentTurns), '',
    '处理你岗位范围内真正有增量的部分。可以补充、质疑、接棒并使用真实工具；不要复述同事已经说过的话。',
    `确实需要尚未入场的同事时，明确写“@姓名 + 需要他做什么”。可邀请：${rosterText(allEmployees)}。`,
    '你的回复会直接进入同一个工作群 / 外部会话，不经过秘书转述。',
  ].filter(Boolean).join('\n')
}

function marker(value: WorkResult): string { return `[[NIUMA_MEETING state="done"]]\n${JSON.stringify(value)}` }
function sessionIdOf(agent: any): string | undefined { return String(agent?.session?.id || agent?.id || '').trim() || undefined }

export function registerWorkOrchestrator(ctx: any, core: OrgPanelCore, options: { events?: EventSink; sessionFile?: string } = {}): WorkOrchestrator {
  const tools = ctx?.tools
  const systemPrompt = ctx?.systemPrompt
  if (!tools || !systemPrompt) throw new Error('Work Orchestrator requires tools + systemPrompt')
  const sessions = new WorkSessionStore(options.sessionFile)
  const plan = (task: string, routeOptions?: { maxTeam?: number; allowedEmployeeIds?: readonly string[] }) => planWorkgroup(task, core.employees, routeOptions)

  const run = async (request: WorkRequest): Promise<WorkResult> => {
    const task = String(request.task || '').trim()
    if (!task) throw new Error('work task must not be empty')
    const source: TaskSource = request.source || 'web'
    const platform = String(request.platform || source)
    const maxTeam = Math.max(1, Math.min(MAX_WORKGROUP_SIZE, Math.floor(Number(request.maxTeam) || 3)))
    const initial = plan(task, { maxTeam, allowedEmployeeIds: request.allowedEmployeeIds })
    if (!initial.members.length) throw new Error('当前权限范围内没有可路由的数字员工')
    if (request.agent) core.bindAgent(request.agent)

    const conversationId = request.conversationId || (source === 'web' ? sessionIdOf(request.agent) : undefined) || request.channelId || 'workspace'
    const sessionKey = request.sessionKey || `${platform}:${conversationId}:${request.threadId || 'main'}`
    const session = await sessions.open({
      key: sessionKey, goal: task, source, platform, channelId: request.channelId, conversationId,
      threadId: request.threadId, senderId: request.senderId, senderName: request.senderName,
      messageId: request.messageId, messageText: task,
    })
    const history = session.turns.slice(-12)
    const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const queue = initial.members.map((item) => item.employeeId)
    const joined = new Set<string>()
    const planned = new Map(initial.members.map((item) => [item.employeeId, item]))
    const turns: WorkTurn[] = []
    const allowed = request.allowedEmployeeIds?.length ? new Set(request.allowedEmployeeIds.map(String)) : null
    const publish = (event: CompanyEvent) => options.events?.publish(event, 'work-orchestrator')

    if (queue.length > 1) publish({ id: `${runId}:meeting:start`, type: 'meeting.started', at: Date.now(), meetingId: runId, participants: queue.slice(), topic: `动态工作组：${clip(task, 80)}` })

    while (queue.length && joined.size < maxTeam) {
      const employeeId = queue.shift()!
      if (joined.has(employeeId)) continue
      const employee = core.employees.find((item) => item.id === employeeId)
      if (!employee || (allowed && !allowed.has(employee.id))) continue
      joined.add(employeeId)
      const route = planned.get(employee.id)
      await sessions.join(session.id, { employeeId: employee.id, employeeName: employee.name, role: employee.role, reason: route?.reasons.join(' · ') || '任务匹配' })

      const prompt = workPrompt(request, employee, core.employees.filter((item) => !allowed || allowed.has(item.id)), turns, history, [...planned.values()])
      const startedAt = Date.now()
      publish({ id: `${runId}:task:assigned:${employee.id}`, type: 'task.assigned', at: startedAt, employeeId: employee.id, taskId: `${runId}:${employee.id}`, title: clip(task, 60), source, channelId: request.channelId || session.id })
      publish({ id: `${runId}:task:started:${employee.id}`, type: 'task.started', at: startedAt + 1, employeeId: employee.id, taskId: `${runId}:${employee.id}`, title: clip(task, 60) })

      const policy = request.writePolicy
      const outcome = await core.dispatch({
        employeeId: employee.id,
        text: prompt,
        taskTitle: task,
        taskDescription: task,
        source,
        channelId: request.channelId || session.id,
        platform,
        senderId: request.senderId,
        senderName: request.senderName || (source === 'web' ? '老板 / 公司工作群' : '外部会话'),
        conversationId,
        messageId: request.messageId,
        threadId: request.threadId,
        workgroupId: session.id,
        permissionMode: request.permissionMode,
        writeAllowed: policy ? policy.allowed : true,
        writeGate: policy ? { allowed: policy.allowed, isWriteTool: policy.isWriteTool } : undefined,
        agent: request.agent,
        signal: request.signal,
      })

      const toolsUsed = outcome.tools || []
      const policyViolation = !!policy && !policy.allowed && toolsUsed.some((tool) => policy.isWriteTool(tool))
      const reply = String(outcome.reply || '').trim()
      const detail: WorkTurn = { staffId: employee.id, staffName: employee.name, role: employee.role, reply, outcome: outcome.outcome, taskId: outcome.taskId, tools: toolsUsed, error: outcome.error, policyViolation }
      turns.push(detail)
      await sessions.appendTurn(session.id, { employeeId: employee.id, employeeName: employee.name, role: employee.role, reply, outcome: outcome.outcome, taskId: outcome.taskId, tools: toolsUsed, policyViolation })

      if (outcome.outcome === 'blocked' || policyViolation) {
        publish({ id: `${runId}:task:blocked:${employee.id}`, type: 'task.blocked', at: Date.now(), employeeId: employee.id, taskId: `${runId}:${employee.id}`, reason: policyViolation ? `只读来源观测到写工具：${toolsUsed.filter((tool) => policy?.isWriteTool(tool)).join('、')}` : (outcome.error || '员工本轮被阻塞') })
      } else {
        publish({ id: `${runId}:task:completed:${employee.id}`, type: 'task.completed', at: Date.now(), employeeId: employee.id, taskId: `${runId}:${employee.id}`, outcome: outcome.outcome, summary: reply ? clip(reply, 180) : outcome.error })
      }

      if (reply && !policyViolation && joined.size < maxTeam) {
        for (const peer of requestedPeers(reply, core.employees)) {
          if ((allowed && !allowed.has(peer.id)) || joined.has(peer.id) || queue.includes(peer.id)) continue
          const peerRoute = scoreEmployee(`${task}\n${reply}`, peer)
          planned.set(peer.id, { ...peerRoute, reasons: uniq(['同事在工作群中明确邀请', ...peerRoute.reasons]), score: Math.max(peerRoute.score, 500) })
          queue.push(peer.id)
          if (joined.size + queue.length >= maxTeam) break
        }
      }
    }

    const participantIds = [...joined]
    if (participantIds.length > 1) publish({ id: `${runId}:meeting:finish`, type: 'meeting.finished', at: Date.now(), meetingId: runId, participants: participantIds, summary: '动态工作组本轮协作完成' })
    await sessions.setStatus(session.id, turns.some((item) => item.outcome === 'blocked' || item.policyViolation) ? 'blocked' : 'active')

    return {
      kind: 'meeting', topic: `动态工作组 · ${clip(task, 72)}`, task, teamId: session.id, source, platform,
      participants: participantIds.map((staffId) => {
        const employee = core.employees.find((item) => item.id === staffId)!
        const route = planned.get(staffId)
        return { staffId, staffName: employee.name, role: employee.role, reason: route?.reasons.join(' · ') || '任务匹配' }
      }),
      turns: turns.filter((turn) => turn.reply && !turn.policyViolation).map((turn) => ({ staffId: turn.staffId, staffName: turn.staffName, reply: turn.reply })),
      details: turns,
    }
  }

  tools.register({
    name: COMPANY_WORK_TOOL,
    description: '赛博公司的唯一业务入口。按任务自动激活持久化员工组成工作组；同一会话跨轮保留共享上下文，员工可 @ 同事动态加入。',
    parameters: { type: 'object', additionalProperties: false, required: ['task'], properties: { task: { type: 'string', minLength: 1 }, maxTeam: { type: 'number', minimum: 1, maximum: MAX_WORKGROUP_SIZE } } },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: WorkResult) { return [{ type: 'text', text: marker(value) }] } },
    isConcurrencySafe: () => false,
    async execute(args: any, exec: any): Promise<WorkResult> {
      const conversationId = sessionIdOf(exec?.agent)
      return run({ task: String(args?.task || ''), source: 'web', platform: 'web', channelId: 'company-workspace', conversationId, senderName: '老板 / 公司工作群', maxTeam: Number(args?.maxTeam) || 3, agent: exec?.agent, signal: exec?.signal })
    },
  })

  const roster = core.employees.map((item) => `- ${item.name}（${item.role}）：${item.brief}`).join('\n')
  systemPrompt.section({
    name: 'dsh-org-panel:work-orchestrator', order: -1000,
    text: `【赛博公司 Work Orchestrator｜最高优先级】\n\n你只是不可见的调度内核，不是秘书、老板助理或任何一名员工。\n\n真实员工名册：\n${roster}\n\n强制规则：\n1. 老板的工作类输入统一调用 ${COMPANY_WORK_TOOL}，task 尽量逐字传入；不得先给业务观点。\n2. 明确 @ 员工仍调用 ${COMPANY_WORK_TOOL}；运行时会锁定点名员工，并按任务复杂度补相关同事。\n3. 未点名任务按岗位能力自动组队。秘书只有日程、提醒、通知、行政、会议安排等总裁办任务才参与。\n4. 同一 Web / 外部会话会复用持久工作组上下文；成员可以 @ 同事动态邀请入场。\n5. ${COMPANY_WORK_TOOL} 完成后不得总结、润色、转述，只输出 [NIUMA_DIRECT_ACK]；工作台直接展示员工原话。\n6. 插件配置、Harness 诊断等系统控制任务可以调用对应系统工具，但不要伪装成员工。`,
  })

  return { toolName: COMPANY_WORK_TOOL, sessions, plan, run }
}
