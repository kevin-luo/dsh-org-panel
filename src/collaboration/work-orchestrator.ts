// 赛博公司 Work Orchestrator：全渠道唯一的任务协作入口。
//
// 架构约束：
// - DSH root session 只是不可见执行根，不属于员工名册，也不产生业务观点；
// - Web / 飞书 / QQ / 微信统一把任务交给本 Orchestrator；渠道层只负责传输、鉴权、回信；
// - 任务按语义自动选择 1~4 名真实员工，明确 @ 优先，跨岗位任务自动补人；
// - 员工共享同一工作组的前序真实输出，并可在公开回复中 @ 同事动态邀请加入；
// - 每位员工仍通过 core.dispatch 执行，因此长期记忆、履历、技能证据、插件/模型绑定都属于本人；
// - 秘书只是行政岗位。普通任务没有任何“秘书兜底 / 主 Agent”特权。
import { ROLE_BLUEPRINTS } from '../org-blueprints'
import type { Employee, OrgPanelCore } from '../host-v2'
import type { TaskSource } from '../persistence/types'
import type { CompanyEvent } from '../runtime/company-events'

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
  senderName?: string
  permissionMode?: string
  attachments?: readonly WorkAttachment[]
  /** 群权限可限制允许激活的员工；缺省表示整家公司可参与。 */
  allowedEmployeeIds?: readonly string[]
  maxTeam?: number
  /** 外部只读渠道把写策略传进来。Web 默认可写。 */
  writePolicy?: WorkPolicy
  /** Web tool-call 会显式传当前 root agent；外部渠道可复用 core 已记住的真实执行根。 */
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
  /** 只读来源真实观测到写工具时为 true；渠道层必须拦掉这条回复。 */
  policyViolation: boolean
}

export type WorkResult = {
  /** 继续复用现有 NIUMA_MEETING UI 协议；产品语义已经是动态工作组。 */
  kind: 'meeting'
  topic: string
  task: string
  teamId: string
  source: TaskSource
  platform: string
  participants: Array<{ staffId: string; staffName: string; role: string; reason: string }>
  turns: Array<{ staffId: string; staffName: string; reply: string }>
  details: WorkTurn[]
}

export type WorkOrchestrator = {
  toolName: typeof COMPANY_WORK_TOOL
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

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function clip(value: unknown, max: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function roleKeywords(employee: Employee): string[] {
  const blueprint = ROLE_BLUEPRINTS.find((item) => item.id === employee.id)
  return uniq([
    ...(blueprint?.keywords || []),
    ...(employee.capabilities || []),
    ...(employee.aliases || []),
    employee.role,
  ].map(String).map((item) => item.trim()).filter((item) => item.length >= 2))
}

function explicitMention(task: string, employee: Employee): boolean {
  const value = normalized(task)
  const names = uniq([employee.name, ...(employee.aliases || [])].map(String).map((item) => item.trim()).filter(Boolean))
  for (const name of names) {
    const key = normalized(name)
    if (key && value.includes(`@${key}`)) return true
  }
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
    if (!key || key.length < 2 || !value.includes(key)) continue
    score += Math.min(18, 6 + key.length)
    if (reasons.length < 4) reasons.push(`命中“${keyword}”`)
  }

  // 秘书只有行政语义命中或被明确点名时参与竞争。
  if (employee.id === 'secretary' && !explicit && !reasons.length) score -= 100

  return { employeeId: employee.id, employeeName: employee.name, role: employee.role, score, reasons: uniq(reasons), explicit }
}

export function planWorkgroup(
  task: string,
  employees: readonly Employee[],
  options: { maxTeam?: number; allowedEmployeeIds?: readonly string[] } = {},
): WorkPlan {
  const text = String(task || '').trim()
  if (!text) return { task: '', members: [], explicit: [], mode: 'solo' }
  const limit = Math.max(1, Math.min(MAX_WORKGROUP_SIZE, Math.floor(Number(options.maxTeam) || 3)))
  const allow = options.allowedEmployeeIds?.length ? new Set(options.allowedEmployeeIds.map(String)) : null
  const pool = employees.filter((employee) => !allow || allow.has(employee.id))
  const ranked = pool.map((employee) => scoreEmployee(text, employee))
    .sort((a, b) => b.score - a.score || a.employeeName.localeCompare(b.employeeName))
  const explicit = ranked.filter((item) => item.explicit && item.score > 0)
  const picked: WorkRoute[] = explicit.slice(0, limit)

  const add = (candidate?: WorkRoute) => {
    if (!candidate || picked.length >= limit || picked.some((item) => item.employeeId === candidate.employeeId)) return
    picked.push(candidate)
  }

  if (!picked.length) {
    const top = ranked.find((item) => item.score > 0)
    add(top)
    if (top) {
      const second = ranked.find((item) => item.employeeId !== top.employeeId && item.score >= Math.max(18, top.score * .42))
      if (second) add(second)
      if (COMPLEX_TASK.test(text)) {
        const third = ranked.find((item) => !picked.some((chosen) => chosen.employeeId === item.employeeId) && item.score >= Math.max(14, top.score * .28))
        if (third) add(third)
      }
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
    // 意图模糊时让产品岗位先澄清；秘书不承担通用兜底。
    add(ranked.find((item) => item.employeeId === 'pm') || ranked.find((item) => item.employeeId !== 'secretary') || ranked[0])
    if (picked[0]) picked[0] = { ...picked[0], reasons: uniq(['任务意图需要先澄清', ...picked[0].reasons]) }
  }

  return { task: text, members: picked, explicit: explicit.map((item) => item.employeeId), mode: picked.length > 1 ? 'team' : 'solo' }
}

/** 员工公开回复里明确 @ / 请 / 需要某同事时动态入场。 */
export function requestedPeers(text: string, employees: readonly Employee[]): Employee[] {
  const value = String(text || '')
  const lower = normalized(value)
  const out: Employee[] = []
  for (const employee of employees) {
    const names = uniq([employee.name, ...(employee.aliases || [])].map(String).map((item) => item.trim()).filter(Boolean))
    let hit = false
    for (const name of names) {
      const key = normalized(name)
      if (!key) continue
      if (lower.includes(`@${key}`)) { hit = true; break }
      if (name === employee.name && (value.includes(`需要${name}`) || value.includes(`请${name}`) || value.includes(`让${name}`) || value.includes(`交给${name}`))) { hit = true; break }
    }
    if (hit) out.push(employee)
  }
  return out
}

function attachmentText(attachments: readonly WorkAttachment[] = []): string {
  if (!attachments.length) return '（无附件）'
  return attachments.map((item, index) => {
    const locator = item.localPath || item.url || item.id || '无可读取地址'
    return `${index + 1}. ${item.name || item.type || '附件'}${item.mime ? ` · ${item.mime}` : ''} · ${locator}`
  }).join('\n')
}

function rosterText(employees: readonly Employee[]): string {
  return employees.map((item) => `${item.name}（${item.role}）`).join('、')
}

function transcriptText(turns: readonly WorkTurn[]): string {
  const visible = turns.filter((turn) => turn.reply.trim() && !turn.policyViolation)
  if (!visible.length) return '（你是本工作组第一位公开发言人）'
  return visible.map((turn) => `${turn.staffName}（${turn.role}）：${turn.reply}`).join('\n\n')
}

function workPrompt(request: WorkRequest, employee: Employee, allEmployees: readonly Employee[], turns: readonly WorkTurn[], planned: readonly WorkRoute[]): string {
  const team = planned.map((item) => `${item.employeeName}（${item.role}）`).join('、') || employee.name
  const source = request.platform || request.source || 'web'
  return [
    '[赛博公司动态工作组]',
    `任务来源：${source}${request.senderName ? ` · ${request.senderName}` : ''}`,
    `原始任务：${request.task}`,
    `当前工作组：${team}`,
    `你现在以“${employee.name} / ${employee.role}”身份加入同一个工作群。所有员工是平级同事；不存在主 Agent / 子 Agent 的产品等级。`,
    request.permissionMode ? `当前渠道权限：${request.permissionMode}` : '',
    request.writePolicy && !request.writePolicy.allowed ? '当前来源为只读权限：禁止执行任何写操作；做不到就明确说明。' : '',
    '',
    '附件：',
    attachmentText(request.attachments),
    '',
    '前序同事真实公开输出：',
    transcriptText(turns),
    '',
    '请从自己的岗位职责处理你该负责的部分。可以补充、质疑、接棒，并使用你真实可用的工具；不要把其他同事的话换个说法复述一遍。',
    `确实需要另一位尚未入场的同事时，明确写“@姓名 + 需要他做什么”。可邀请员工：${rosterText(allEmployees)}。`,
    '你的公开回复会直接进入同一个工作群 / 外部会话，不经过秘书转述。',
  ].filter(Boolean).join('\n')
}

function marker(value: WorkResult): string {
  return `[[NIUMA_MEETING state="done"]]\n${JSON.stringify(value)}`
}

export function registerWorkOrchestrator(ctx: any, core: OrgPanelCore, options: { events?: EventSink } = {}): WorkOrchestrator {
  const tools = ctx?.tools
  const systemPrompt = ctx?.systemPrompt
  if (!tools || !systemPrompt) throw new Error('Work Orchestrator requires tools + systemPrompt')

  const plan = (task: string, routeOptions?: { maxTeam?: number; allowedEmployeeIds?: readonly string[] }) =>
    planWorkgroup(task, core.employees, routeOptions)

  const run = async (request: WorkRequest): Promise<WorkResult> => {
    const task = String(request.task || '').trim()
    if (!task) throw new Error('work task must not be empty')
    const source: TaskSource = request.source || 'web'
    const platform = String(request.platform || source)
    const maxTeam = Math.max(1, Math.min(MAX_WORKGROUP_SIZE, Math.floor(Number(request.maxTeam) || 3)))
    const initial = plan(task, { maxTeam, allowedEmployeeIds: request.allowedEmployeeIds })
    if (!initial.members.length) throw new Error('当前权限范围内没有可路由的数字员工')

    if (request.agent) core.bindAgent(request.agent)
    const teamId = `work-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const queue = initial.members.map((item) => item.employeeId)
    const joined = new Set<string>()
    const planned = new Map(initial.members.map((item) => [item.employeeId, item]))
    const turns: WorkTurn[] = []
    const allowed = request.allowedEmployeeIds?.length ? new Set(request.allowedEmployeeIds.map(String)) : null
    const publish = (event: CompanyEvent) => options.events?.publish(event, 'work-orchestrator')

    if (queue.length > 1) {
      publish({ id: `${teamId}:meeting:start`, type: 'meeting.started', at: Date.now(), meetingId: teamId, participants: queue.slice(), topic: `动态工作组：${clip(task, 80)}` })
    }

    while (queue.length && joined.size < maxTeam) {
      const employeeId = queue.shift()!
      if (joined.has(employeeId)) continue
      const employee = core.employees.find((item) => item.id === employeeId)
      if (!employee || (allowed && !allowed.has(employee.id))) continue
      joined.add(employeeId)

      const prompt = workPrompt(request, employee, core.employees.filter((item) => !allowed || allowed.has(item.id)), turns, [...planned.values()])
      const startedAt = Date.now()
      publish({ id: `${teamId}:task:assigned:${employee.id}`, type: 'task.assigned', at: startedAt, employeeId: employee.id, taskId: `${teamId}:${employee.id}`, title: clip(task, 60), source, channelId: request.channelId || teamId })
      publish({ id: `${teamId}:task:started:${employee.id}`, type: 'task.started', at: startedAt + 1, employeeId: employee.id, taskId: `${teamId}:${employee.id}`, title: clip(task, 60) })

      const policy = request.writePolicy
      const outcome = await core.dispatch({
        employeeId: employee.id,
        text: prompt,
        source,
        channelId: request.channelId || teamId,
        platform,
        senderName: request.senderName || (source === 'web' ? '老板 / 公司工作群' : '外部会话'),
        permissionMode: request.permissionMode,
        writeAllowed: policy ? policy.allowed : true,
        writeGate: policy ? { allowed: policy.allowed, isWriteTool: policy.isWriteTool } : undefined,
        agent: request.agent,
        signal: request.signal,
      })

      const toolsUsed = outcome.tools || []
      const policyViolation = !!policy && !policy.allowed && toolsUsed.some((tool) => policy.isWriteTool(tool))
      const reply = String(outcome.reply || '').trim()
      const detail: WorkTurn = {
        staffId: employee.id,
        staffName: employee.name,
        role: employee.role,
        reply,
        outcome: outcome.outcome,
        taskId: outcome.taskId,
        tools: toolsUsed,
        error: outcome.error,
        policyViolation,
      }
      turns.push(detail)

      if (outcome.outcome === 'blocked' || policyViolation) {
        publish({ id: `${teamId}:task:blocked:${employee.id}`, type: 'task.blocked', at: Date.now(), employeeId: employee.id, taskId: `${teamId}:${employee.id}`, reason: policyViolation ? `只读来源观测到写工具：${toolsUsed.filter((tool) => policy?.isWriteTool(tool)).join('、')}` : (outcome.error || '员工本轮被阻塞') })
      } else {
        publish({ id: `${teamId}:task:completed:${employee.id}`, type: 'task.completed', at: Date.now(), employeeId: employee.id, taskId: `${teamId}:${employee.id}`, outcome: outcome.outcome, summary: reply ? clip(reply, 180) : outcome.error })
      }

      // 只有真实可公开回复才允许继续拉人；被安全策略拦下的文本不能成为协作上下文。
      if (reply && !policyViolation && joined.size < maxTeam) {
        const peers = requestedPeers(reply, core.employees)
        for (const peer of peers) {
          if ((allowed && !allowed.has(peer.id)) || joined.has(peer.id) || queue.includes(peer.id)) continue
          const peerRoute = scoreEmployee(`${task}\n${reply}`, peer)
          planned.set(peer.id, { ...peerRoute, reasons: uniq(['同事在工作群中明确邀请', ...peerRoute.reasons]), score: Math.max(peerRoute.score, 500) })
          queue.push(peer.id)
          if (joined.size + queue.length >= maxTeam) break
        }
      }
    }

    const participantIds = [...joined]
    if (participantIds.length > 1) {
      publish({ id: `${teamId}:meeting:finish`, type: 'meeting.finished', at: Date.now(), meetingId: teamId, participants: participantIds, summary: '动态工作组本轮协作完成' })
    }

    const participants = participantIds.map((staffId) => {
      const employee = core.employees.find((item) => item.id === staffId)!
      const route = planned.get(staffId)
      return { staffId, staffName: employee.name, role: employee.role, reason: route?.reasons.join(' · ') || '任务匹配' }
    })

    return {
      kind: 'meeting',
      topic: `动态工作组 · ${clip(task, 72)}`,
      task,
      teamId,
      source,
      platform,
      participants,
      turns: turns.filter((turn) => turn.reply && !turn.policyViolation).map((turn) => ({ staffId: turn.staffId, staffName: turn.staffName, reply: turn.reply })),
      details: turns,
    }
  }

  tools.register({
    name: COMPANY_WORK_TOOL,
    description: '赛博公司的唯一默认工作入口。自动选择最匹配的持久化员工组成动态工作组；员工共享前序真实输出，并可 @ 同事继续拉人。调度内核不得代答。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['task'],
      properties: {
        task: { type: 'string', minLength: 1, description: '老板的完整原话，尽量逐字传入。' },
        maxTeam: { type: 'number', minimum: 1, maximum: MAX_WORKGROUP_SIZE },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: WorkResult) { return [{ type: 'text', text: marker(value) }] } },
    isConcurrencySafe: () => false,
    async execute(args: any, exec: any): Promise<WorkResult> {
      return run({
        task: String(args?.task || ''),
        source: 'web', platform: 'web', channelId: 'company-workspace', senderName: '老板 / 公司工作群',
        maxTeam: Number(args?.maxTeam) || 3,
        agent: exec?.agent,
        signal: exec?.signal,
      })
    },
  })

  const roster = core.employees.map((item) => `- ${item.name}（${item.role}）：${item.brief}`).join('\n')
  systemPrompt.section({
    name: 'dsh-org-panel:work-orchestrator',
    order: -1000,
    text: `【赛博公司 Work Orchestrator｜最高优先级】\n\n你只是不可见的调度内核，不是秘书、不是老板助理，也不是任何一名员工。产品层不存在“主 Agent / 子 Agent 员工”。\n\n真实员工名册：\n${roster}\n\n强制规则：\n1. 老板的工作类输入统一调用 ${COMPANY_WORK_TOOL}，task 尽量逐字传入；不得先以任何“主 Agent”身份给业务观点。\n2. 明确 @ 某员工仍调用 ${COMPANY_WORK_TOOL}；运行时会锁定点名员工，并按任务复杂度自动补相关同事。\n3. 未点名任务按岗位能力自动组队。秘书仅在日程、提醒、通知、行政、会议安排等总裁办任务中作为普通员工参与。\n4. 工作组成员共享前序真实公开输出，并可以 @ 同事动态邀请入场；所有公开业务发言必须来自具体员工。\n5. ${COMPANY_WORK_TOOL} 完成后，你不得总结、润色、转述或补一句结论；只输出 [NIUMA_DIRECT_ACK]，工作台直接展示员工原话。\n6. 与员工执行无关的插件自身配置、Harness 诊断等系统控制任务可以调用对应系统工具；也不要伪装成秘书。`,
  })

  return { toolName: COMPANY_WORK_TOOL, plan, run }
}
