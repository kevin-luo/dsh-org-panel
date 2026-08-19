// 「赛博公司」Task Team Runtime：把“秘书 → 子员工”的星型路由改成任务驱动的临时工作组。
//
// 产品语义：
// - root session 只是不可见的调度内核，不是任何一名员工，也不对老板做业务汇报；
// - 每条工作任务按内容自动选择 1~4 名真实员工；明确 @ 的员工优先锁定；
// - 每位员工看到同一份老板任务 + 前序同事的真实公开输出，可以补充、质疑、接棒；
// - 员工在回复里明确 @ 另一位同事时，运行时会把对方动态加入当前工作组；
// - 每位员工仍走 core.dispatch，因此长期记忆、TaskHistory、SkillEvidence、插件/模型绑定全部沿用本人档案。
//
// 底线：调度可以是技术上的 root，但产品里不存在“主 Agent 员工”。秘书只是名册中的普通岗位。
import { ROLE_BLUEPRINTS } from '../org-blueprints'
import type { Employee, OrgPanelCore } from '../host-v2'
import type { CompanyEvent } from '../runtime/company-events'

export const COMPANY_WORK_TOOL = 'company_work'
const MAX_TEAM = 4

export type TeamRoute = {
  employeeId: string
  employeeName: string
  role: string
  score: number
  reasons: string[]
  explicit: boolean
}

export type TeamPlan = {
  task: string
  members: TeamRoute[]
  explicit: string[]
  mode: 'solo' | 'team'
}

export type TeamTurn = {
  staffId: string
  staffName: string
  role: string
  reply: string
  outcome: string
  taskId?: string
  tools: string[]
}

export type TeamWorkResult = {
  kind: 'meeting'
  topic: string
  task: string
  teamId: string
  participants: Array<{ staffId: string; staffName: string; role: string; reason: string }>
  turns: Array<{ staffId: string; staffName: string; reply: string }>
  details: TeamTurn[]
}

export type TeamRuntimeHandle = {
  toolName: typeof COMPANY_WORK_TOOL
  plan(task: string, maxTeam?: number): TeamPlan
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
  // 秘书只在真正的行政/总裁办工作里有默认权重；普通工作任务不会因为“协调”两个字就默认接管。
  { id: 'secretary', match: /(日程|提醒|通知全员|会议安排|行政|总裁办|秘书|预约|行程)/i, label: '行政协调', weight: 72 },
]

const COMPLEX_TASK = /(完整|系统|全流程|从.+到|一起|协作|评审|方案|规划|设计并|实现并|分析并|先.+再|同时|多个|端到端|一整套)/i

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)]
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
    if (!key) continue
    if (value.includes(`@${key}`)) return true
  }
  // 人名本身允许自然点名；“开发/产品/图片”这种岗位泛词不算显式点名。
  const name = normalized(employee.name)
  return !!name && name.length >= 2 && value.includes(name)
}

function scoreEmployee(task: string, employee: Employee): TeamRoute {
  const explicit = explicitMention(task, employee)
  let score = explicit ? 1000 : 0
  const reasons: string[] = explicit ? ['老板明确点名'] : []
  const value = normalized(task)

  for (const rule of DOMAIN_RULES) {
    if (rule.id !== employee.id || !rule.match.test(task)) continue
    score += rule.weight
    reasons.push(rule.label)
  }

  for (const keyword of roleKeywords(employee)) {
    const key = normalized(keyword)
    if (!key || key.length < 2 || !value.includes(key)) continue
    // 岗位/能力关键词只做辅助，不压过领域规则和明确 @。
    score += Math.min(18, 6 + key.length)
    if (reasons.length < 4) reasons.push(`命中“${keyword}”`)
  }

  // 秘书没有行政命中时不参与兜底竞争，彻底去掉“默认主 Agent”特权。
  if (employee.id === 'secretary' && !explicit && !reasons.length) score -= 100

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    role: employee.role,
    score,
    reasons: uniq(reasons),
    explicit,
  }
}

export function planTaskTeam(task: string, employees: readonly Employee[], maxTeam = 3): TeamPlan {
  const text = String(task || '').trim()
  if (!text) return { task: '', members: [], explicit: [], mode: 'solo' }
  const limit = Math.max(1, Math.min(MAX_TEAM, Math.floor(Number(maxTeam) || 3)))
  const ranked = employees.map((employee) => scoreEmployee(text, employee))
    .sort((a, b) => b.score - a.score || a.employeeName.localeCompare(b.employeeName))
  const explicit = ranked.filter((item) => item.explicit && item.score > 0)
  const picked: TeamRoute[] = explicit.slice(0, limit)

  const add = (candidate?: TeamRoute) => {
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
    // 老板点名的人先锁定；跨岗位任务继续按真实相关性补人直到团队上限。
    // 只补一位会让“角色设计 + 传播方案”被泛产品角色占掉唯一名额，真正的增长同事反而进不来。
    for (const peer of ranked) {
      if (peer.explicit || picked.some((chosen) => chosen.employeeId === peer.employeeId)) continue
      if (peer.score < 22) break
      add(peer)
      if (picked.length >= limit) break
    }
  }

  if (!picked.length) {
    // company_work 只处理“工作任务”；语义完全模糊时让产品经理先澄清，比固定让秘书接管更合理。
    add(ranked.find((item) => item.employeeId === 'pm') || ranked.find((item) => item.employeeId !== 'secretary') || ranked[0])
    if (picked[0]) picked[0] = { ...picked[0], reasons: uniq(['任务意图需要先澄清', ...picked[0].reasons]) }
  }

  return {
    task: text,
    members: picked,
    explicit: explicit.map((item) => item.employeeId),
    mode: picked.length > 1 ? 'team' : 'solo',
  }
}

/** 员工回复里明确请求另一位同事时动态入场；只认人名/别名的明确邀请，不靠模型猜。 */
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

function clip(value: unknown, max: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function teamMarker(value: TeamWorkResult): string {
  // 先复用已经稳定的 NIUMA_MEETING 展示协议：UI 会把 turns 展平成真实员工消息。
  // topic 明确写“临时工作组”，避免把它误解成固定的 staff_meeting 业务会议。
  return `[[NIUMA_MEETING state="done"]]\n${JSON.stringify(value)}`
}

function rosterText(employees: readonly Employee[]): string {
  return employees.map((item) => `${item.name}（${item.role}）`).join('、')
}

function transcriptText(turns: readonly TeamTurn[]): string {
  const visible = turns.filter((turn) => turn.reply.trim())
  if (!visible.length) return '（你是本工作组第一位发言人）'
  return visible.map((turn) => `${turn.staffName}（${turn.role}）：${turn.reply}`).join('\n\n')
}

function workPrompt(task: string, employee: Employee, allEmployees: readonly Employee[], turns: readonly TeamTurn[], planned: readonly TeamRoute[]): string {
  const team = planned.map((item) => `${item.employeeName}（${item.role}）`).join('、') || employee.name
  return [
    '[赛博公司临时工作组]',
    `老板原始任务：${task}`,
    `当前工作组：${team}`,
    `你现在以“${employee.name} / ${employee.role}”身份加入同一个工作群。你和其他员工是平级同事，没有主 Agent / 子 Agent 的产品角色差异。`,
    '',
    '前序同事真实公开输出：',
    transcriptText(turns),
    '',
    '请直接从自己的岗位职责处理你该负责的部分：可以补充、质疑、接棒或基于前序结果继续执行真实工具。不要复述一遍所有同事的话，也不要替别的员工发言。',
    `如果当前任务确实需要另一位尚未入场的同事，请明确写“@姓名 + 需要他做什么”。可邀请的员工：${rosterText(allEmployees)}。不要为了热闹随便拉人。`,
    '你的公开回复会直接显示在公司工作群里，不经过秘书转述。',
  ].join('\n')
}

export function registerTeamRuntime(ctx: any, core: OrgPanelCore, options: { events?: EventSink } = {}): TeamRuntimeHandle {
  const tools = ctx?.tools
  const systemPrompt = ctx?.systemPrompt
  if (!tools || !systemPrompt) throw new Error('Task Team Runtime requires tools + systemPrompt')

  const plan = (task: string, maxTeam = 3) => planTaskTeam(task, core.employees, maxTeam)

  const teamTool = {
    name: COMPANY_WORK_TOOL,
    description: '赛博公司的默认工作入口。根据老板原始任务自动选择最匹配的 1~4 名持久化数字员工组成临时工作组；员工共享前序同事的真实输出，并可通过 @同事 动态邀请新角色加入。不要由秘书代答。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['task'],
      properties: {
        task: { type: 'string', minLength: 1, description: '老板的完整原话，尽量逐字传入，不要先替员工改写。' },
        maxTeam: { type: 'number', minimum: 1, maximum: MAX_TEAM, description: '最多同时激活几名员工；默认 3。只有任务确实跨岗位才用 4。' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args: any, value: TeamWorkResult) { return [{ type: 'text', text: teamMarker(value) }] },
    },
    isConcurrencySafe: () => false,
    async execute(args: any, exec: any): Promise<TeamWorkResult> {
      const task = String(args?.task || '').trim()
      if (!task) throw new Error('company_work task must not be empty')
      const maxTeam = Math.max(1, Math.min(MAX_TEAM, Math.floor(Number(args?.maxTeam) || 3)))
      const initial = plan(task, maxTeam)
      if (!initial.members.length) throw new Error('没有可路由的数字员工')

      // 这一次 tool-call 自己就拿到了真实 root agent；绑定它，后续所有 core.dispatch 都作为平级员工从同一工作根启动。
      if (exec?.agent) core.bindAgent(exec.agent)
      const teamId = `team-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const queue = initial.members.map((item) => item.employeeId)
      const joined = new Set<string>()
      const planned = new Map(initial.members.map((item) => [item.employeeId, item]))
      const turns: TeamTurn[] = []

      const publish = (event: CompanyEvent) => options.events?.publish(event, 'team-runtime')
      if (queue.length > 1) {
        publish({ id: `${teamId}:meeting:start`, type: 'meeting.started', at: Date.now(), meetingId: teamId, participants: queue.slice(), topic: `临时工作组：${clip(task, 80)}` })
      }

      while (queue.length && joined.size < maxTeam) {
        const employeeId = queue.shift()!
        if (joined.has(employeeId)) continue
        const employee = core.employees.find((item) => item.id === employeeId)
        if (!employee) continue
        joined.add(employeeId)

        // 动态邀请的员工也要在办公室产生真实“加入协作”事件。
        if (joined.size > initial.members.length && joined.size > 1) {
          publish({ id: `${teamId}:meeting:join:${employee.id}`, type: 'meeting.started', at: Date.now(), meetingId: teamId, participants: [employee.id], topic: `临时工作组：${clip(task, 80)}` })
        }

        const prompt = workPrompt(task, employee, core.employees, turns, [...planned.values()])
        const startedAt = Date.now()
        publish({ id: `${teamId}:task:assigned:${employee.id}`, type: 'task.assigned', at: startedAt, employeeId: employee.id, taskId: `${teamId}:${employee.id}`, title: clip(task, 60), source: 'web', channelId: teamId })
        publish({ id: `${teamId}:task:started:${employee.id}`, type: 'task.started', at: startedAt + 1, employeeId: employee.id, taskId: `${teamId}:${employee.id}`, title: clip(task, 60) })

        const outcome = await core.dispatch({
          employeeId: employee.id,
          text: prompt,
          source: 'web',
          channelId: teamId,
          platform: 'web',
          senderName: '老板 / 公司工作群',
          agent: exec?.agent,
          signal: exec?.signal,
        })

        const reply = String(outcome.reply || '').trim()
        const detail: TeamTurn = {
          staffId: employee.id,
          staffName: employee.name,
          role: employee.role,
          reply,
          outcome: outcome.outcome,
          taskId: outcome.taskId,
          tools: outcome.tools || [],
        }
        turns.push(detail)

        if (outcome.outcome === 'blocked') {
          publish({ id: `${teamId}:task:blocked:${employee.id}`, type: 'task.blocked', at: Date.now(), employeeId: employee.id, taskId: `${teamId}:${employee.id}`, reason: outcome.error || '员工本轮被阻塞' })
        } else {
          publish({ id: `${teamId}:task:completed:${employee.id}`, type: 'task.completed', at: Date.now(), employeeId: employee.id, taskId: `${teamId}:${employee.id}`, outcome: outcome.outcome, summary: reply ? clip(reply, 180) : outcome.error })
        }

        // 员工可以在公开回复里拉另一位同事进群。只接受名册里的明确 @/“请XX”请求，并受 maxTeam 上限约束。
        if (reply && joined.size < maxTeam) {
          for (const peer of requestedPeers(reply, core.employees)) {
            if (joined.has(peer.id) || queue.includes(peer.id)) continue
            const peerRoute = scoreEmployee(`${task}\n${reply}`, peer)
            planned.set(peer.id, { ...peerRoute, reasons: uniq(['同事在工作群中明确邀请', ...peerRoute.reasons]), score: Math.max(peerRoute.score, 500) })
            queue.push(peer.id)
            if (joined.size + queue.length >= maxTeam) break
          }
        }
      }

      const participantIds = [...joined]
      if (participantIds.length > 1) {
        publish({ id: `${teamId}:meeting:finish`, type: 'meeting.finished', at: Date.now(), meetingId: teamId, participants: participantIds, summary: '临时工作组本轮协作完成' })
      }

      const participants = participantIds.map((staffId) => {
        const employee = core.employees.find((item) => item.id === staffId)!
        const route = planned.get(staffId)
        return { staffId, staffName: employee.name, role: employee.role, reason: route?.reasons.join(' · ') || '任务匹配' }
      })

      return {
        kind: 'meeting',
        topic: `临时工作组 · ${clip(task, 72)}`,
        task,
        teamId,
        participants,
        // 复用现有群聊协议，只把真正有公开回复的员工变成消息；调度错误不会伪装成员工发言。
        turns: turns.filter((turn) => turn.reply).map((turn) => ({ staffId: turn.staffId, staffName: turn.staffName, reply: turn.reply })),
        details: turns,
      }
    },
  }

  tools.register(teamTool)

  // 这一节显式覆盖 host-v2 里遗留的“秘书是主 Agent”规则。底层 root 仍是 DSH 必需的执行根，
  // 但它现在只是不可见 scheduler；业务发言必须由 company_work 里的真实员工产生。
  const roster = core.employees.map((item) => `- ${item.name}（${item.role}）：${item.brief}`).join('\n')
  systemPrompt.section({
    name: 'dsh-org-panel:task-team-runtime',
    order: -100,
    text: `【赛博公司 Task Team Runtime｜本节优先于旧 dispatcher 规则】\n\n你在老板当前会话中的身份是“不可见调度内核”，不是秘书，也不是任何一名数字员工。底层 DSH 需要一个 root session 只是技术事实，产品里不存在“主 Agent 员工 / 子 Agent 员工”的等级关系。\n\n真实员工名册：\n${roster}\n\n强制规则：\n1. 老板发来的产品、技术、设计、创作、搜索、调研、运营、数据、招聘、文档、插件/部署等工作任务，默认调用 ${COMPANY_WORK_TOOL}，task 尽量逐字传老板原话。不要先由秘书回答、拆完再汇报。\n2. 老板明确 @ 某员工时仍走 ${COMPANY_WORK_TOOL}；运行时会锁定被点名的人，并在复杂跨岗位任务里自动补相关同事。\n3. 不再把“未点名任务”默认交给秘书或老王。员工由任务内容动态选择；秘书只有日程、通知、行政、会议安排等总裁办任务命中时才作为普通员工入场。\n4. ${COMPANY_WORK_TOOL} 内的员工共享前序同事公开输出；员工可在自己的回复里 @ 另一位同事，触发对方动态加入同一工作组。\n5. 调用 ${COMPANY_WORK_TOOL} 后，你不得总结、润色、转述或冒充员工补一句结论；回复必须且只能是 [NIUMA_DIRECT_ACK]。工作台会直接展示真实员工的发言。\n6. staff_chat / staff_meeting 仅保留兼容旧会话，不再作为默认路由。除非 ${COMPANY_WORK_TOOL} 本身不可用，否则不要使用它们。\n7. 只有与“公司员工执行工作”无关的 Harness 设置、插件自身配置、纯系统诊断，才允许由调度内核直接处理；调度内核的业务观点不应出现在公司群聊里。`,
  })

  return { toolName: COMPANY_WORK_TOOL, plan }
}
