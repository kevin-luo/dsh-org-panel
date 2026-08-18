import type {
  Delegation,
  EmployeeStatus,
  LegacyStatus,
  OfficePlacement,
  RoleDef,
  StaffDef,
  StaffMarker,
  StaffMeeting,
} from './types'
import { DEFAULT_HOME, MEETING_CENTER, STAFF_HOME, STATION_CENTER, stationSeat } from './office-layout'
import type {
  CompanyEvent,
  CompanyRuntime,
  EmployeeRuntimeState,
  EmployeeRuntimeStatus,
  EventPlatform,
} from '../runtime/company-events'
import { emptyEmployeeRuntime, reduceCompanyRuntime } from '../runtime/company-events'

export function clip(s: unknown, n: number): string {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

export function extractText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const b of blocks as Array<{ text?: unknown }>) {
    if (b && typeof b.text === 'string' && b.text.trim()) parts.push(b.text)
  }
  return parts.join('\n').trim()
}

export function parseArgs(raw: unknown): Record<string, any> {
  if (typeof raw !== 'string') return raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function nodeTime(n: any): number | null {
  const t = n && (n.time ?? n.ts ?? n.createdAt)
  if (typeof t === 'number') return t
  if (typeof t === 'string') {
    const p = Date.parse(t)
    return Number.isNaN(p) ? null : p
  }
  return null
}

export function collectUserRequests(nodes: any[]): string[] {
  const out: string[] = []
  for (const n of nodes) {
    const source = n?.source || n?.message?.source
    if (n && n.kind === 'user' && source?.kind !== 'subagent-settled') {
      const t = extractText(n.content)
      if (t) out.push(t)
    }
  }
  return out
}

export function summarizeResult(text: string): { lead: string; points: string[] } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return { lead: '', points: [] }
  const lead = clip(lines[0], 110)
  const points: string[] = []
  for (let i = 1; i < lines.length && points.length < 4; i++) {
    const l = lines[i]
    if (/^[-*•]|\d+[.)]/.test(l)) points.push(clip(l.replace(/^[-*•\s]+/, '').replace(/^\d+[.)]\s*/, ''), 80))
  }
  if (points.length === 0) for (let i = 1; i < lines.length && points.length < 4; i++) points.push(clip(lines[i], 80))
  return { lead, points }
}

export function isDispatchTool(name: string): boolean {
  if (!name) return false
  return name === 'workflow' || name === 'staff_chat' || name === 'staff_meeting' || name.startsWith('subagent')
}

export function parseStaffMarker(text: string): StaffMarker | null {
  const match = text.match(/\[\[NIUMA_STAFF id="([^"]+)" child="([^"]+)" state="([^"]+)"\]\]/)
  return match ? { staffId: match[1], childId: match[2], state: match[3] } : null
}

export function parseStaffMeeting(text: string): StaffMeeting | null {
  const marker = '[[NIUMA_MEETING state="done"]]'
  const position = text.indexOf(marker)
  if (position < 0) return null
  try {
    const value = JSON.parse(text.slice(position + marker.length).trim())
    return value?.kind === 'meeting' && Array.isArray(value.turns) ? (value as StaffMeeting) : null
  } catch {
    return null
  }
}

export function isRouterOnlyMessage(text: string): boolean {
  const value = text.trim()
  return /^\[NIUMA_(?:RELAY|DIRECT)_ACK\]$/.test(value)
    || /^(?:已接通|消息已转交给).*(?:独立子代理|本人回复|等.*回复)/.test(value)
    || /^老板已直连 .*?(?:正在处理|等待本人回复)/.test(value)
}

export function isStaffRoutingAssistant(node: any): boolean {
  return Array.isArray(node?.blocks) && node.blocks.some((block: any) => block?.kind === 'tool-call' && (block.name === 'staff_chat' || block.name === 'staff_meeting'))
}

export function messageSource(node: any): any {
  return node?.source || node?.message?.source || node?.data?.source
}

export function staffChildIndex(nodes: any[]): Map<string, StaffMarker> {
  const index = new Map<string, StaffMarker>()
  for (const node of nodes || []) {
    if (node?.kind !== 'tool-result') continue
    const parsed = parseStaffMarker(extractText(node.content))
    if (parsed) index.set(parsed.childId, parsed)
  }
  return index
}

export function settledChildIds(nodes: any[]): Set<string> {
  const ids = new Set<string>()
  for (const node of nodes || []) {
    const source = messageSource(node)
    if (source?.kind === 'subagent-settled' && source.senderSessionId) ids.add(String(source.senderSessionId))
    const event = settlementEvent(node)
    if (event) ids.add(event.childId)
  }
  return ids
}

export function cleanStaffResult(text: string): string {
  return text
    .replace(/\[\[NIUMA_STAFF[^\]]+\]\]\s*/g, '')
    .replace(/^[^\n]*回复：\s*/u, '')
    .trim()
}

export function cleanSettlementReply(text: string): string {
  const marker = 'Its closing message:'
  const position = text.indexOf(marker)
  if (position >= 0) return text.slice(position + marker.length).trim()
  return text
    .replace(/^Background subagent[^\n]*\n?/i, '')
    .replace(/^It left no closing message\.?/i, '员工本轮没有留下回复。')
    .trim()
}

export function settlementEvent(node: any): { childId: string; reply: string } | null {
  const text = extractText(node?.content)
  const match = text.match(/^Background subagent\s+([^\s]+)\s+finished[\s\S]*?Its closing message:\s*([\s\S]*)$/i)
  return match ? { childId: match[1], reply: match[2].trim() } : null
}

export function settlementMaterial(text: string): { text: string; reasoning: string } {
  const reply = cleanSettlementReply(text)
  const starts = ['\n老板，', '\n老板：', '\n收到，', '\n好的，', '\n我负责']
    .map((token) => reply.lastIndexOf(token))
    .filter((position) => position > 80)
  const start = starts.length ? Math.max(...starts) + 1 : -1
  return start > 0
    ? { reasoning: reply.slice(0, start).trim(), text: reply.slice(start).trim() }
    : { reasoning: '', text: reply }
}

/** 一次会话里的一条工具调用记录：调用参数 + 结果（没有结果就是仍在进行）。 */
export type ToolCallRecord = {
  callId: string
  name: string
  args: Record<string, any>
  startTime: number | null
  result: { text: string; isError: boolean; endTime: number | null } | null
  /** 该调用当前是否挂在 runningCalls 上（真实进行中，而非历史里未落结果的残留）。 */
  live: boolean
}

/**
 * 会话节点流 → 工具调用记录表。extractDelegations 与 deriveCompanyEvents 共用同一份采集，
 * 保证「事件化」之后对真实会话数据的识别口径和重构前完全一致。
 */
export function collectToolCalls(nodes: any[], runningCalls: any[]): ToolCallRecord[] {
  const calls: Record<string, { name: string; args: Record<string, any>; startTime: number | null; live: boolean }> = {}
  const results: Record<string, { text: string; isError: boolean; endTime: number | null }> = {}
  for (const n of nodes || []) {
    if (n && n.kind === 'assistant' && Array.isArray(n.blocks)) {
      for (const b of n.blocks as any[]) {
        if (b && b.kind === 'tool-call' && b.callId) calls[b.callId] = { name: b.name, args: parseArgs(b.argsRaw), startTime: nodeTime(n), live: false }
      }
    } else if (n && n.kind === 'tool-result' && n.callId) {
      results[n.callId] = { text: extractText(n.content), isError: !!n.isError, endTime: nodeTime(n) }
      if (n.call && !calls[n.callId]) calls[n.callId] = { name: n.call.name, args: parseArgs(n.call.argsRaw), startTime: nodeTime(n), live: false }
    }
  }
  for (const rc of runningCalls || []) {
    if (!rc || !rc.callId) continue
    if (!calls[rc.callId]) calls[rc.callId] = { name: rc.name, args: parseArgs(rc.argsRaw), startTime: nodeTime(rc), live: true }
    else calls[rc.callId].live = true
  }
  return Object.keys(calls).map((callId) => ({
    callId,
    name: calls[callId].name,
    args: calls[callId].args,
    startTime: calls[callId].startTime,
    live: calls[callId].live,
    result: results[callId] || null,
  }))
}

// ---------------------------------------------------------------------------
// 「卡住」的第二种来源：员工回复里的待决信号
//
// 为什么必须有：tool-result 只有 isError 一个硬信号。员工回一句
// 「我需要你确认用哪个数据库再继续」是一次**成功**的 tool-result ——
// 顶栏会把它计进「已交付」，办公室画成绿色 ✓。老板最该看见的那一类卡住，
// 恰恰是唯一看不见的一类。
//
// 这套规则是**启发式**，边界情况一定存在（反问句、复述老板原话、条件式表述、
// 把待决信号写在代码块或引用里，都可能骗过它）。所以口径定成「宁可漏判，不可误判」：
//   1. 纯正则匹配，不调模型、不猜语义 —— 规则可单测、可配置、可扩展（见 PENDING_SIGNAL_RULES）；
//   2. 必须命中「明确指向老板的请求」或「明确的阻塞词」，光出现「确认」「权限」不算；
//   3. 命中句先过一遍排除表，「已确认」「无需授权」「按老板确认的方案」这类回顾性表述直接放行；
//   4. reason 一律取**真实原句片段**（clip 到 60 字），不改写、不加情绪、不补充推测。
// 漏判的代价是「少标一个卡住」，误判的代价是「把一次正常交付标成卡住」——后者更伤信任。
// ---------------------------------------------------------------------------

/** 一条待决信号规则。pattern 不许带 g 标志（会带 lastIndex 状态，测试与生产结果会不一致）。 */
export type PendingSignalRule = { id: string; label: string; pattern: RegExp }

/** 命中的待决信号。reason 是员工原句片段，UI 直接照抄。 */
export type PendingSignal = { ruleId: string; label: string; reason: string }

/**
 * 默认规则表。调用方可以整表替换或追加（detectPendingDecision 的第二个参数），
 * 所以新增一类待决信号不需要改这里的判定逻辑。
 */
export const PENDING_SIGNAL_RULES: readonly PendingSignalRule[] = [
  // 「我需要你确认用哪个数据库再继续」：必须带明确的第二人称，否则「已完成，请确认。」这种
  // 极常见的交付结尾会被误判成卡住。
  { id: 'confirm', label: '等待确认', pattern: /(?:需要|请|麻烦|烦请)(?:您|你|老板)(?:先|再)?(?:帮忙|帮我)?(?:确认|拍板|定夺|敲定)/ },
  // 「请老板选一个方案」/「走哪个分支？」——后者要求带问号，避免「文档说明了该用哪个接口」被误判。
  { id: 'choose', label: '需要选择', pattern: /(?:需要|请|麻烦|烦请)(?:您|你|老板)(?:先)?(?:选择|选定|指定|挑一个|定一下)|(?:用|选|走|接|按)哪(?:一)?(?:个|种|条|套|版|份)[^。！？!?\n]{0,12}[?？]/ },
  { id: 'credential', label: '缺少凭据', pattern: /(?:缺少|缺失|没有|未提供|未配置|尚未提供|拿不到|需要)[^。！？!?\n]{0,12}(?:凭据|凭证|密钥|口令|密码|token|api[ _-]?key|access[ _-]?key|账号|账户|连接串|连接信息|授权码|secret)/i },
  { id: 'permission', label: '权限不足', pattern: /权限不足|无权(?:访问|读取|写入|操作|执行)|没有(?:访问)?权限[^。！？!?\n]{0,8}(?:访问|读取|写入|操作|执行|调用|打开|继续)|需要(?:先)?(?:申请|开通|获得)授权|permission denied|access denied/i },
  { id: 'decision', label: '需要老板拍板', pattern: /(?:等|等待|等候)(?:您|你|老板)(?:的)?(?:确认|回复|答复|指示|决定|拍板|指令)|由(?:您|你|老板)(?:来)?(?:决定|拍板|定夺)/ },
  { id: 'halt', label: '无法继续', pattern: /无法继续|不能继续|暂时无法(?:继续|进行|完成)|需要人工(?:介入|确认|处理)|先(?:暂停|停在这里)/ },
]

/** 排除表：命中句里出现这些回顾性 / 否定性表述，整句放行。宁可漏判。 */
const PENDING_EXCLUSIONS: readonly RegExp[] = [
  /已(?:经)?(?:确认|授权|拿到|获得|取得|完成|拍板|选定|修复|解决|绕过)/,
  /(?:无需|不需要|不用)(?:再)?(?:确认|授权|选择|等待|拍板)/,
  /(?:按|依据|根据)(?:您|你|老板)(?:之前|先前)?(?:的)?(?:确认|指定|选定|要求|指示)/,
  /没有(?:权限|授权)(?:问题|风险|障碍)/,
  /(?:如|若|如果|如需|若需|后续)[^。！？!?\n]{0,12}(?:需要|不确定|问题|调整)/,
]

/** 待决信号扫描时忽略的超长行：多半是贴进来的日志 / 代码块，不是员工在跟老板说话。 */
const PENDING_MAX_LINE = 120

/**
 * 员工回复 → 待决信号。命中返回原句片段，没命中返回 null。
 * 纯函数：同样的文本必然同样的结果，不读时钟、不调模型。
 */
export function detectPendingDecision(text: unknown, rules: readonly PendingSignalRule[] = PENDING_SIGNAL_RULES): PendingSignal | null {
  const source = typeof text === 'string' ? text : ''
  if (!source.trim()) return null
  for (const raw of source.split(/[。！？!?\n；;]+/)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line || line.length > PENDING_MAX_LINE) continue
    if (PENDING_EXCLUSIONS.some((exclusion) => exclusion.test(line))) continue
    for (const rule of rules) {
      if (rule.pattern.test(line)) return { ruleId: rule.id, label: rule.label, reason: clip(line, 60) }
    }
  }
  return null
}

/** 子代理结算回复索引：childId → 员工本人真正说的那段话。 */
export function settlementReplies(nodes: any[]): Map<string, string> {
  const replies = new Map<string, string>()
  for (const node of nodes || []) {
    const event = settlementEvent(node)
    if (event) {
      if (event.reply) replies.set(event.childId, event.reply)
      continue
    }
    const source = messageSource(node)
    if (source?.kind === 'subagent-settled' && source.senderSessionId) {
      const text = cleanSettlementReply(extractText(node.content))
      if (text) replies.set(String(source.senderSessionId), text)
    }
  }
  return replies
}

/**
 * 一条派活记录里「员工真正说的话」。
 * staff_chat 的 tool-result 只是接单回执（[[NIUMA_STAFF]] + 一句转交语），员工本人的话在
 * 子代理结算节点里，所以先按 childId 去 replies 取；取不到才退回回执正文。
 */
export function dispatchReplyText(record: ToolCallRecord, replies?: Map<string, string>): string {
  const res = record.result
  if (!res) return ''
  if (record.name === 'staff_chat') {
    const marker = parseStaffMarker(res.text)
    const settled = marker && replies ? replies.get(marker.childId) : undefined
    return settled || cleanStaffResult(res.text)
  }
  return res.text
}

/**
 * Delegation + 卡住信号。
 * types.ts 是公共类型文件（别的模块也在用），这里用交叉类型就地扩展，不去改它；
 * blocked 是可选字段，所以 Delegation[] 与 DelegationWithBlock[] 互相赋值都成立。
 */
export type DelegationWithBlock = Delegation & { blocked?: PendingSignal | null }

export function extractDelegations(nodes: any[], runningCalls: any[], roles: RoleDef[], staff: StaffDef[]): DelegationWithBlock[] {
  const out: DelegationWithBlock[] = []
  const settled = settledChildIds(nodes)
  const replies = settlementReplies(nodes)
  for (const record of collectToolCalls(nodes, runningCalls)) {
    const callId = record.callId
    const c = record
    if (!isDispatchTool(c.name)) continue
    const res = record.result
    if (c.name === 'staff_meeting') {
      const participantIds = Array.isArray(c.args?.staff) ? c.args.staff.map(String) : []
      const meetingDesc = clip(c.args?.topic || '员工短会', 160)
      const meetingSummary = res ? summarizeResult(res.text) : { lead: '', points: [] }
      for (const participantId of participantIds) {
        const participant = staffOf(participantId, staff)
        if (!participant) continue
        out.push({
          callId: `${callId}:${participantId}`,
          tool: c.name,
          desc: meetingDesc,
          running: !res,
          isError: res ? res.isError : false,
          blocked: null,
          lead: meetingSummary.lead,
          points: meetingSummary.points,
          startTime: c.startTime,
          endTime: res ? res.endTime : null,
          duration: c.startTime && res && res.endTime ? Math.max(0, res.endTime - c.startTime) : null,
          roleId: participant.roleId || participant.id,
          staffId: participant.id,
        })
      }
      continue
    }
    const rawDesc = c.name === 'staff_chat'
      ? (c.args?.message || '')
      : c.name === 'workflow'
        ? (c.args?.meta?.name || c.args?.name || c.args?.description || '')
        : (c.args?.description || c.args?.prompt || c.args?.task || c.args?.instruction || '')
    const desc = clip(rawDesc || '(未命名任务)', 160)
    const summary = res ? summarizeResult(res.text) : { lead: '', points: [] }
    const explicitStaff = c.name === 'staff_chat' && typeof c.args?.staff === 'string' ? c.args.staff : ''
    const roleId = explicitStaff ? (staffOf(explicitStaff, staff)?.roleId || explicitStaff) : assignRoleId(rawDesc, c.name, c.args, roles, staff)
    const staffId = explicitStaff || staffForRole(roleId, staff)
    const staffMarker = res ? parseStaffMarker(res.text) : null
    const waitingForEmployee = c.name === 'staff_chat' && !!staffMarker && staffMarker.state === 'accepted' && !settled.has(staffMarker.childId)
    // 交付成功的那一条也要再看一眼员工到底说了什么：成功的 tool-result 里可能写着「我需要你确认…」。
    const pending = res && !res.isError && !waitingForEmployee ? detectPendingDecision(dispatchReplyText(record, replies)) : null
    out.push({
      callId,
      tool: c.name,
      desc,
      running: !res || waitingForEmployee,
      isError: res ? res.isError : false,
      blocked: pending,
      lead: summary.lead,
      points: summary.points,
      startTime: c.startTime,
      endTime: res ? res.endTime : null,
      duration: c.startTime && res && res.endTime ? Math.max(0, res.endTime - c.startTime) : null,
      roleId,
      staffId,
    })
  }
  return out
}

export function assignRoleId(desc: string, tool: string, args: Record<string, any>, roles: RoleDef[], staff: StaffDef[]): string {
  const text = ` ${desc || ''} ${args?.description || ''} ${args?.prompt || ''} ${args?.meta?.name || ''} ${args?.agent || ''} ${args?.role || ''} `.toLowerCase()
  for (const st of staff) {
    if ((st.aliases || []).some((a) => a && text.includes(a.toLowerCase()))) return st.roleId || st.id
  }
  if (args?.role && typeof args.role === 'string') {
    const hit = roles.find((r) => r.id === args.role || (r.keywords || []).some((k) => args.role.toLowerCase().includes(k)))
    if (hit) return hit.id
  }
  let best = roles[0]?.id || 'tech-lead'
  let bestScore = -1
  for (const role of roles) {
    let score = 0
    for (const k of role.keywords || []) {
      if (text.includes(k.toLowerCase())) score += k.length
    }
    if ((role.tools || []).includes(tool)) score += 2
    if (score > bestScore) {
      bestScore = score
      best = role.id
    }
  }
  return best
}

export function staffForRole(roleId: string, staff: StaffDef[]): string {
  const hit = staff.find((s) => s.roleId === roleId || s.id === roleId)
  return hit ? hit.id : (staff[0]?.id || roleId)
}

export function roleOf(id: string, roles: RoleDef[]): RoleDef {
  return roles.find((r) => r.id === id) || { id, tools: [], skills: [] }
}

export function staffOf(id: string, staff: StaffDef[]): StaffDef | undefined {
  return staff.find((s) => s.id === id || s.roleId === id)
}

export function tasksFor<T extends Delegation>(staffId: string, delegations: readonly T[]): T[] {
  return delegations.filter((d) => d.staffId === staffId || d.roleId === staffId)
}

/** statusFromTasks 内部用的单人 id：派活记录本来就已经按人分好组了。 */
const SOLO_EMPLOYEE = '__solo__'

/**
 * 一个人的派活记录 → 旧四态。
 *
 * 这里**不再自己写一套状态优先级**：先把派活记录翻译成 CompanyEvent，再交给
 * runtime/company-events 的同一个 reducer 算。全公司只有那一份状态规则（G4 第 2 条）。
 * 因此「卡住」在这条路上也认 blocked 信号，不再只认 isError。
 * 与旧实现的唯一行为差异：同一个人既有卡住又有交付时，按**事件时间取最后一次**，
 * 而不是「只要有过错误就永远算卡住」——顶栏问的是「现在」，不是「历史上有没有出过错」。
 */
export function statusFromTasks(tasks: readonly DelegationWithBlock[]): LegacyStatus {
  const runtime = reduceCompanyRuntime(delegationEvents(tasks, () => SOLO_EMPLOYEE), { employeeIds: [SOLO_EMPLOYEE] })
  return runtimeToLegacyStatus(runtime.employees[SOLO_EMPLOYEE].status)
}

/**
 * 派活记录 → CompanyEvent[]（薄适配层）。
 * 会话节点流那条主路走 deriveCompanyEvents；这条只服务「总线里一条事件都没有」的降级形态，
 * 两条路最终都进同一个 reducer，所以不存在第二份状态真相。
 */
export function delegationEvents(
  delegations: readonly DelegationWithBlock[],
  ownerOf: (task: DelegationWithBlock) => string = (task) => task.staffId,
): CompanyEvent[] {
  const events: CompanyEvent[] = []
  const meetings = new Map<string, { topic: string; participants: string[]; start: number; end: number | null }>()
  for (const task of delegations || []) {
    const employeeId = ownerOf(task)
    if (!employeeId) continue
    const start = task.startTime ?? 0
    const end = task.endTime ?? start
    if (task.tool === 'staff_meeting') {
      // 会议记录是「一个参会人一条」，callId 形如 `${callId}:${staffId}`，先还原成同一场会。
      const meetingId = task.callId.includes(':') ? task.callId.slice(0, task.callId.lastIndexOf(':')) : task.callId
      const known = meetings.get(meetingId) || { topic: task.desc, participants: [], start, end: end }
      if (!known.participants.includes(employeeId)) known.participants.push(employeeId)
      known.start = Math.min(known.start, start)
      if (task.running) known.end = null
      else if (known.end !== null) known.end = Math.max(known.end, end)
      meetings.set(meetingId, known)
      continue
    }
    events.push({ id: `d:${task.callId}:assigned`, type: 'task.assigned', at: start, origin: 'delegation', employeeId, taskId: task.callId, title: task.desc, tool: task.tool })
    events.push({ id: `d:${task.callId}:started`, type: 'task.started', at: start, origin: 'delegation', employeeId, taskId: task.callId, title: task.desc, tool: task.tool })
    if (task.running) continue
    if (task.isError || task.blocked) {
      events.push({
        id: `d:${task.callId}:blocked`, type: 'task.blocked', at: end, origin: 'delegation', employeeId, taskId: task.callId,
        reason: task.blocked?.reason || clip(task.lead, 60) || '工具返回错误',
      })
    } else {
      events.push({ id: `d:${task.callId}:completed`, type: 'task.completed', at: end, origin: 'delegation', employeeId, taskId: task.callId, outcome: 'success', summary: clip(task.lead, 120) })
    }
  }
  for (const [meetingId, meeting] of meetings) {
    events.push({ id: `d:meeting:${meetingId}:start`, type: 'meeting.started', at: meeting.start, origin: 'delegation', meetingId, participants: meeting.participants, topic: meeting.topic })
    if (meeting.end !== null) events.push({ id: `d:meeting:${meetingId}:end`, type: 'meeting.finished', at: meeting.end, origin: 'delegation', meetingId, participants: meeting.participants })
  }
  return events
}

export function lineOf(staff: StaffDef | undefined, status: string, tick: number): string {
  const arr = status === 'idle' ? undefined : staff?.lines?.[status]
  if (arr && arr.length > 0) return arr[tick % arr.length]
  const fallback: Record<string, string> = {
    idle: '待命中：等真实派活',
    running: '干活中：进度见任务卡',
    done: '已交付：结果见任务卡',
    wait: '卡住了：等待处理',
  }
  return fallback[status] || fallback.idle
}

export function formatDuration(ms: number | null): string {
  if (ms == null || Number.isNaN(ms)) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分 ${s % 60} 秒`
  return `${Math.floor(m / 60)} 小时`
}

export function formatAgo(time: number | null): string {
  if (time == null) return ''
  const ms = Date.now() - time
  if (ms < 0) return '刚刚'
  const s = Math.round(ms / 1000)
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

export function formatClock(time: number | null): string {
  if (time == null) return ''
  try {
    return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function bossLine(requests: string[], delegations: Delegation[], staff: StaffDef[]): string {
  if (delegations.length === 0) {
    return requests.length > 0
      ? '秘书已收到消息，正在判断是直接回复还是召集对应员工。'
      : '赛博公司已开门：秘书在前台，全员到岗，等老板下达第一条业务指令。'
  }
  const req = requests.length > 0 ? clip(requests[requests.length - 1], 48) : ''
  const running = delegations.filter((d) => d.running)
  const done = delegations.filter((d) => !d.running && !d.isError)
  const error = delegations.filter((d) => d.isError)
  const parts = [`收到需求${req ? `「${req}」` : ''}，拆了 ${delegations.length} 个活`]
  const name = (d: Delegation) => staffOf(d.staffId, staff)?.name || '员工'
  if (running.length) parts.push(`${running.length} 个在干：${running.map((d) => `${name(d)}·${clip(d.desc, 14)}`).join('、')}`)
  if (done.length) parts.push(`${done.length} 个已交付：${done.map((d) => `${name(d)}·${clip(d.desc, 14)}`).join('、')}`)
  if (error.length) parts.push(`${error.length} 个卡住：${error.map((d) => `${name(d)}·${clip(d.desc, 14)}`).join('、')}`)
  return parts.join('；')
}

export function systemEvents(delegations: Delegation[], staff: StaffDef[]): string[] {
  const events: string[] = []
  if (delegations.length) events.push(`👑 老板派了 ${delegations.length} 个活`)
  for (const d of delegations) {
    const name = staffOf(d.staffId, staff)?.name || '员工'
    if (!d.running && !d.isError) events.push(`✅ ${name} 交付了：${clip(d.desc, 18)}`)
    else if (d.isError) events.push(`⚠️ ${name} 卡住了：${clip(d.desc, 18)}`)
    else events.push(`🔨 ${name} 正在干：${clip(d.desc, 18)}`)
  }
  return events.slice(0, 8)
}

export function dispatchTemplate(staff: StaffDef | undefined): string {
  if (!staff) return ''
  return `@${staff.name} `
}

export function assistantMaterial(blocks: any[]): { text: string; reasoning: string; images: number } {
  const text: string[] = []
  const reasoning: string[] = []
  let images = 0
  for (const block of blocks || []) {
    if (block?.kind === 'text' && typeof block.text === 'string' && block.text.trim()) text.push(block.text)
    else if (block?.kind === 'reasoning' && typeof block.text === 'string' && block.text.trim()) reasoning.push(block.text)
    else if (block?.kind === 'image') images++
  }
  return { text: text.join('\n').trim(), reasoning: reasoning.join('\n').trim(), images }
}

export function flowKind(node: any): 'chat' | 'trace' {
  if (messageSource(node)?.kind === 'subagent-settled') return 'chat'
  if (settlementEvent(node)) return 'chat'
  if (node?.kind === 'tool-result' && parseStaffMarker(extractText(node.content))) return 'chat'
  if (node?.kind === 'tool-result' && parseStaffMeeting(extractText(node.content))) return 'chat'
  return node?.kind === 'user' || node?.kind === 'steering' || node?.kind === 'assistant' ? 'chat' : 'trace'
}

export function latestDirectEmployee(nodes: any[], staff: StaffDef[]): StaffDef | null {
  for (let index = (nodes || []).length - 1; index >= 0; index--) {
    const node = nodes[index]
    if (node?.kind !== 'user' && node?.kind !== 'steering') continue
    if (messageSource(node)?.kind === 'subagent-settled') continue
    const text = extractText(node.content)
    return staff.find((employee) => employee.id !== 'secretary' && text.includes(`@${employee.name}`)) || null
  }
  return null
}

export function nodeStaffIds(node: any, staff: StaffDef[]): string[] {
  const ids = new Set<string>()
  const text = extractText(node?.content) || ''
  for (const employee of staff) {
    if (text.includes(`@${employee.name}`)) ids.add(employee.id)
  }
  if (node?.kind === 'tool-result') {
    const marker = parseStaffMarker(text)
    if (marker) ids.add(marker.staffId)
    const meeting = parseStaffMeeting(text)
    if (meeting) meeting.turns.forEach((turn) => ids.add(turn.staffId))
  }
  const settled = settlementEvent(node)
  if (settled) {
    for (const [, marker] of staffChildIndex([node])) ids.add(marker.staffId)
  }
  if (node?.kind === 'assistant' && Array.isArray(node.blocks)) {
    for (const block of node.blocks) {
      if (block?.kind === 'tool-call' && block.name === 'staff_chat' && block.argsRaw) {
        try {
          const args = JSON.parse(block.argsRaw)
          if (args.staff) ids.add(String(args.staff))
        } catch { /* ignore */ }
      }
    }
  }
  return [...ids]
}

export function channelMatchesNode(node: any, channelId: string, staff: StaffDef[]): boolean {
  if (channelId === 'general' || channelId === 'random') return true
  const channelDepartments: Record<string, string[]> = {
    engineering: ['产品研发部', '管理层', '平台与自动化'],
    product: ['产品研发部'],
    content: ['知识与内容部', '创意工作室', '市场与知识部'],
    growth: ['增长运营部'],
    data: ['数据智能部', '市场与情报部'],
  }
  const departments = channelDepartments[channelId]
  if (!departments) return true
  const related = nodeStaffIds(node, staff)
  if (!related.length) return channelId === 'engineering'
  return related.some((id) => {
    const employee = staffOf(id, staff)
    return employee && departments.includes(employee.department || '')
  })
}

/** 员工固定工位。同一个员工任何时候查到的都是同一个坐标，没有随机、没有 tick。 */
export function staffHome(item: StaffDef): { x: number; y: number; zone: string } {
  return STAFF_HOME[item.id] || STAFF_HOME[item.roleId] || DEFAULT_HOME
}

/**
 * 兼容旧签名的落位函数（company-view / OfficeWorld 仍在用）。
 * 需求文档三十四条：idle = 待在工位，位置完全不变；tick 参数保留只为签名兼容，
 * **绝不参与任何位置计算**，原来那段 (tick + id.length) % 18 跑茶水间的逻辑已整段删除。
 */
export function officePlacement(
  item: StaffDef,
  status: LegacyStatus,
  tick: number,
  task?: Delegation,
): OfficePlacement {
  void tick
  const home = staffHome(item)
  if (status === 'running' && task?.tool === 'staff_meeting') {
    const seat = stationSeat(MEETING_CENTER, meetingSeatIndex(item.id))
    return { ...seat, activity: '在会议室讨论' }
  }
  if (status === 'running') return { ...home, activity: '处理真实任务' }
  // 卡住的人留在自己工位。把人挪去会议室「等待决策」属于办公室自己编业务状态（三十三条），已删除。
  if (status === 'wait') return { ...home, activity: '任务卡住，等老板决策' }
  if (status === 'done') return { ...home, activity: '整理交付' }
  return { ...home, activity: '工位待命' }
}

/** 无参会人名单时的确定性席位号：只由 id 决定，进程重启也一样。 */
function meetingSeatIndex(employeeId: string): number {
  let hash = 0
  for (let index = 0; index < employeeId.length; index++) hash = (hash * 31 + employeeId.charCodeAt(index)) >>> 0
  return hash % 6
}

// ---------------------------------------------------------------------------
// 事件驱动办公室（需求文档三十二 / 三十三）
// 会话节点流 → CompanyEvent[] → reducer → 状态。办公室只读最后一步。
// ---------------------------------------------------------------------------

const EXTERNAL_PLATFORMS = ['feishu', 'qq', 'wechat']
const VISION_TOOLS = ['vision_analyze']
const PLUGIN_INSTALL_RE = /plugin[_.-]?install|install[_.-]?plugin/i
const PLUGIN_SEARCH_TOOLS = ['staff_plugin_market_search']
const SKILL_TOOLS = ['staff_skill_learn']

function fallbackEmployeeId(staff: StaffDef[]): string {
  return staff.find((item) => item.id === 'secretary')?.id || staff[0]?.id || 'secretary'
}

/** 工具调用的归属员工：优先看参数里的真实 staff/employeeId，取不到就归主 Agent（秘书）。 */
function callOwner(args: Record<string, any>, staff: StaffDef[]): string {
  const raw = typeof args?.staff === 'string' ? args.staff
    : typeof args?.employeeId === 'string' ? args.employeeId
      : typeof args?.employee === 'string' ? args.employee : ''
  return (raw ? staffOf(raw, staff)?.id : undefined) || fallbackEmployeeId(staff)
}

function parseJsonLoose(text: string): any {
  try {
    return JSON.parse(text)
  } catch { /* 退化成从文本中截首个 JSON 片段 */ }
  const match = text.match(/[{[][\s\S]*[}\]]/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

/** 外部平台标记：只有节点真的带了 feishu/qq/wechat 才认，绝不凭空造 external.message。 */
export function externalPlatform(node: any): EventPlatform | null {
  const source = messageSource(node)
  const raw = String(source?.platform || source?.channelPlatform || node?.external?.platform || '')
  return EXTERNAL_PLATFORMS.includes(raw) ? (raw as EventPlatform) : null
}

/**
 * 会话节点流 → CompanyEvent[]。
 * 任务 / 会议部分完全复用 extractDelegations 的归属口径（staff_chat / staff_meeting /
 * subagent* / workflow 与 [[NIUMA_STAFF]] 标记），事件化之后识别结果不变。
 */
export function deriveCompanyEvents(nodes: any[], runningCalls: any[], roles: RoleDef[], staff: StaffDef[]): CompanyEvent[] {
  const events: CompanyEvent[] = []
  const settled = settledChildIds(nodes)
  const replies = settlementReplies(nodes)
  const records = collectToolCalls(nodes, runningCalls)

  for (const record of records) {
    const start = record.startTime ?? 0
    const res = record.result
    const end = res ? (res.endTime ?? start) : start

    if (record.name === 'staff_meeting') {
      const participants: string[] = []
      for (const raw of Array.isArray(record.args?.staff) ? record.args.staff : []) {
        const participant = staffOf(String(raw), staff)
        if (participant && !participants.includes(participant.id)) participants.push(participant.id)
      }
      if (!participants.length) continue
      const topic = clip(record.args?.topic || '员工短会', 160)
      events.push({ id: `meeting:${record.callId}:start`, type: 'meeting.started', at: start, origin: 'session', meetingId: record.callId, participants, topic })
      if (res) events.push({ id: `meeting:${record.callId}:end`, type: 'meeting.finished', at: end, origin: 'session', meetingId: record.callId, participants, summary: clip(res.text, 120) })
      continue
    }

    if (isDispatchTool(record.name)) {
      const rawDesc = record.name === 'staff_chat'
        ? (record.args?.message || '')
        : record.name === 'workflow'
          ? (record.args?.meta?.name || record.args?.name || record.args?.description || '')
          : (record.args?.description || record.args?.prompt || record.args?.task || record.args?.instruction || '')
      const title = clip(rawDesc || '(未命名任务)', 160)
      const explicitStaff = record.name === 'staff_chat' && typeof record.args?.staff === 'string' ? record.args.staff : ''
      const roleId = explicitStaff ? (staffOf(explicitStaff, staff)?.roleId || explicitStaff) : assignRoleId(rawDesc, record.name, record.args, roles, staff)
      const employeeId = explicitStaff || staffForRole(roleId, staff)
      const marker = res ? parseStaffMarker(res.text) : null
      const waiting = record.name === 'staff_chat' && !!marker && marker.state === 'accepted' && !settled.has(marker.childId)
      const running = !res || waiting
      events.push({ id: `task:${record.callId}:assigned`, type: 'task.assigned', at: start, origin: 'session', employeeId, taskId: record.callId, title, tool: record.name, source: 'web' })
      events.push({ id: `task:${record.callId}:started`, type: 'task.started', at: start, origin: 'session', employeeId, taskId: record.callId, title, tool: record.name })
      if (!running && res) {
        // 卡住有两种来源：① 工具真的报错；② 工具成功、但员工回复里写着明确的待决信号
        //（「我需要你确认用哪个数据库」）。只认 ① 会让老板最该看见的那类卡住变成绿色 ✓。
        const pending = res.isError ? null : detectPendingDecision(dispatchReplyText(record, replies))
        if (res.isError) events.push({ id: `task:${record.callId}:blocked`, type: 'task.blocked', at: end, origin: 'session', employeeId, taskId: record.callId, reason: clip(res.text, 80) || '工具返回错误' })
        else if (pending) events.push({ id: `task:${record.callId}:blocked`, type: 'task.blocked', at: end, origin: 'session', employeeId, taskId: record.callId, reason: pending.reason })
        else events.push({ id: `task:${record.callId}:completed`, type: 'task.completed', at: end, origin: 'session', employeeId, taskId: record.callId, outcome: 'success', summary: clip(res.text, 120) })
      }
      continue
    }

    // 非派活工具：没有结果又不在 runningCalls 上的，属于历史残留，不允许让人一直「工作中」。
    if (!res && !record.live) continue
    const employeeId = callOwner(record.args, staff)

    if (VISION_TOOLS.includes(record.name)) {
      const images = Array.isArray(record.args?.images) ? record.args.images.length : undefined
      events.push({ id: `vision:${record.callId}:start`, type: 'vision.started', at: start, origin: 'session', employeeId, callId: record.callId, mode: typeof record.args?.mode === 'string' ? record.args.mode : undefined, images })
      if (res) events.push({ id: `vision:${record.callId}:end`, type: 'vision.completed', at: end, origin: 'session', employeeId, callId: record.callId, ok: !res.isError, description: clip(res.text, 120) })
      continue
    }

    if (PLUGIN_INSTALL_RE.test(record.name)) {
      const pluginName = clip(String(record.args?.plugin || record.args?.name || record.args?.packageName || '插件'), 48)
      events.push({ id: `plugin:${record.callId}:start`, type: 'plugin.install.started', at: start, origin: 'session', employeeId, pluginName, pluginId: typeof record.args?.pluginId === 'string' ? record.args.pluginId : undefined })
      if (res) events.push({ id: `plugin:${record.callId}:end`, type: 'plugin.installed', at: end, origin: 'session', employeeId, pluginName, pluginId: typeof record.args?.pluginId === 'string' ? record.args.pluginId : undefined, ok: !res.isError })
      continue
    }

    if (PLUGIN_SEARCH_TOOLS.includes(record.name)) {
      events.push({ id: `tool:${record.callId}:start`, type: 'tool.started', at: start, origin: 'session', employeeId, callId: record.callId, tool: record.name })
      if (res) {
        events.push({ id: `tool:${record.callId}:end`, type: 'tool.completed', at: end, origin: 'session', employeeId, callId: record.callId, tool: record.name, ok: !res.isError })
        if (!res.isError) {
          const parsed = parseJsonLoose(res.text)
          const list: any[] = Array.isArray(parsed) ? parsed
            : Array.isArray(parsed?.results) ? parsed.results
              : Array.isArray(parsed?.plugins) ? parsed.plugins
                : Array.isArray(parsed?.items) ? parsed.items : []
          list.forEach((item, index) => {
            if (!item || typeof item !== 'object' || !item.name) return
            events.push({ id: `plugin-found:${record.callId}:${index}`, type: 'plugin.discovered', at: end, origin: 'session', employeeId, pluginName: String(item.name), source: item.owner ? String(item.owner) : undefined })
          })
        }
      }
      continue
    }

    events.push({ id: `tool:${record.callId}:start`, type: 'tool.started', at: start, origin: 'session', employeeId, callId: record.callId, tool: record.name })
    if (res) {
      events.push({ id: `tool:${record.callId}:end`, type: 'tool.completed', at: end, origin: 'session', employeeId, callId: record.callId, tool: record.name, ok: !res.isError })
      if (SKILL_TOOLS.includes(record.name) && !res.isError) {
        const skillName = clip(String(record.args?.skill || record.args?.name || record.args?.topic || '新技能'), 24)
        events.push({ id: `skill:${record.callId}`, type: 'skill.updated', at: end, origin: 'session', employeeId, skillName, source: record.name })
      }
    }
  }

  // 外部平台消息：只有节点真的带平台标记才发 message.received（Phase 6 Adapter 会直接投更完整的事件）。
  for (const node of nodes || []) {
    const platform = externalPlatform(node)
    if (!platform) continue
    if (node?.kind !== 'user' && node?.kind !== 'steering') continue
    const source = messageSource(node)
    const at = nodeTime(node) ?? 0
    const text = extractText(node.content)
    const target = staff.find((employee) => employee.id !== 'secretary' && text.includes(`@${employee.name}`))
    events.push({
      id: `im:${platform}:${String(source?.messageId || node?.seq || at)}`,
      type: 'message.received', at, origin: 'session',
      platform, conversationId: String(source?.conversationId || source?.chatId || platform),
      preview: clip(text, 60), senderName: source?.senderName ? String(source.senderName) : undefined,
      targetEmployeeId: target?.id,
      mentions: target ? [target.id] : [],
    })
  }

  return events
}

/** 会话节点流 → 公司运行时状态（事件化全链路的成品，办公室直接消费这个）。 */
export function buildCompanyRuntime(nodes: any[], runningCalls: any[], roles: RoleDef[], staff: StaffDef[]): CompanyRuntime {
  return reduceCompanyRuntime(deriveCompanyEvents(nodes, runningCalls, roles, staff), { employeeIds: staff.map((item) => item.id) })
}

const RUNTIME_TO_EMPLOYEE: Record<EmployeeRuntimeStatus, EmployeeStatus> = {
  idle: 'idle', working: 'working', meeting: 'meeting', blocked: 'blocked', done: 'done',
  // 识图 / 装插件在视觉上仍是「在干活」，用 working 复用现有精灵样式，具体做什么看 activity 文案。
  vision: 'working', installing: 'working',
}

const RUNTIME_TO_LEGACY: Record<EmployeeRuntimeStatus, LegacyStatus> = {
  idle: 'idle', working: 'running', meeting: 'running', blocked: 'wait', done: 'done',
  vision: 'running', installing: 'running',
}

export function runtimeToEmployeeStatus(status: EmployeeRuntimeStatus): EmployeeStatus {
  return RUNTIME_TO_EMPLOYEE[status] || 'idle'
}

export function runtimeToLegacyStatus(status: EmployeeRuntimeStatus): LegacyStatus {
  return RUNTIME_TO_LEGACY[status] || 'idle'
}

/**
 * 运行时状态 → 办公室坐标。位置只由 state.station 决定，
 * 没有事件 → station 恒为 'desk' → 坐标恒为工位，放 10 分钟也纹丝不动。
 */
export function officePlacementFromRuntime(item: StaffDef, state?: EmployeeRuntimeState | null): OfficePlacement {
  const runtime = state || emptyEmployeeRuntime(item.id)
  const home = staffHome(item)
  if (runtime.station === 'desk') return { ...home, activity: runtime.activity }
  const center = STATION_CENTER[runtime.station]
  const roster = runtime.station === 'meeting' ? (runtime.meeting?.participants || []) : []
  const index = roster.indexOf(item.id)
  const seat = stationSeat(center, index >= 0 ? index : meetingSeatIndex(item.id))
  return { ...seat, activity: runtime.activity }
}

/** 运行时状态 → 旧版 statuses/tasksMap 中的 statuses 形态，便于渐进接线。 */
export function statusesFromRuntime(staff: StaffDef[], runtime: CompanyRuntime): Record<string, LegacyStatus> {
  const statuses: Record<string, LegacyStatus> = {}
  for (const item of staff) {
    const state = runtime.employees[item.id]
    statuses[item.id] = state ? runtimeToLegacyStatus(state.status) : 'idle'
  }
  return statuses
}

/**
 * 派活推导（薄适配层）。
 * 状态本身由 statusFromTasks → delegationEvents → reduceCompanyRuntime 算出来，
 * 这里只负责「按人分组」和秘书那一条真实覆盖，自己不写任何状态优先级。
 */
export function buildCompanyStatuses(
  staff: StaffDef[],
  delegations: readonly DelegationWithBlock[],
  sessionRunning: boolean,
): { statuses: Record<string, LegacyStatus>; tasksMap: Record<string, DelegationWithBlock[]> } {
  const statuses: Record<string, LegacyStatus> = {}
  const tasksMap: Record<string, DelegationWithBlock[]> = {}
  for (const st of staff) {
    const tasks = tasksFor(st.id, delegations)
    tasksMap[st.id] = tasks
    // 秘书 = 主 Agent。会话在跑是宿主给的真实布尔（不是编的），所以照实覆盖；
    // 会话停了就回落到派活推导，而不是硬写成 idle —— 那会把刚交付的结果抹掉。
    statuses[st.id] = st.id === 'secretary' && sessionRunning ? 'running' : statusFromTasks(tasks)
  }
  return { statuses, tasksMap }
}

// ---------------------------------------------------------------------------
// 「现在」的单一答案位（G4 第 2 / 3 条）
//
// 顶栏 / 办公室 / 左栏 / 右栏以前各扫各的：顶栏数 buildCompanyStatuses 的四态，
// 右栏优先读 Event Bus，办公室两边都读。同一时刻四个地方可以给出四个不同答案。
// 现在四处一律调 companyPresence()，输入同一份 CompanyRuntime 就必然得到同一份计数。
// ---------------------------------------------------------------------------

/** 没有事件时的兜底口径：旧四态（会议要靠 tool 才能和「工作中」区分开）。 */
export type PresenceFallback = LegacyStatus | { status?: LegacyStatus; tool?: string }

export type CompanyPresence = {
  ids: string[]
  /** 每个人的运行时状态，UI 一律读这个，不要再自己判。 */
  status: Record<string, EmployeeRuntimeStatus>
  /** 同一份状态的旧四态投影，给还在用 LegacyStatus 的筛选器 / 图例用。 */
  legacy: Record<string, LegacyStatus>
  working: string[]
  meeting: string[]
  blocked: string[]
  done: string[]
  idle: string[]
  /** 卡住的人 → 真实原因原句。取不到原因就是空串，绝不编一条。 */
  reasons: Record<string, string>
  counts: { total: number; working: number; meeting: number; blocked: number; done: number; idle: number; active: number }
  /** true = 计数来自真实事件；false = 总线是空的，走的是派活推导兜底。 */
  eventDriven: boolean
}

/** 旧四态（+ 会议工具）→ 运行时状态。事件缺席时唯一的一条映射。 */
export function legacyToRuntimeStatus(status: LegacyStatus | undefined, tool?: string): EmployeeRuntimeStatus {
  if (status === 'running') return tool === 'staff_meeting' ? 'meeting' : 'working'
  if (status === 'wait') return 'blocked'
  if (status === 'done') return 'done'
  return 'idle'
}

/**
 * 名册 + 运行时 → 全公司「现在」的状态与计数。纯函数，不读时钟、不依赖 tick。
 * 取值规则只有一条：总线里有真实事件且这个人不是 idle，就以事件为准；否则用兜底四态。
 * 这与办公室原来的落位规则完全一致，现在被抽出来给四处共用。
 */
export function companyPresence(
  ids: readonly string[],
  runtime?: CompanyRuntime | null,
  fallback?: Record<string, PresenceFallback | undefined>,
): CompanyPresence {
  const eventDriven = !!runtime && runtime.eventCount > 0
  const roster = ids && ids.length ? [...ids] : eventDriven ? Object.keys(runtime!.employees) : []
  const status: Record<string, EmployeeRuntimeStatus> = {}
  const legacy: Record<string, LegacyStatus> = {}
  const reasons: Record<string, string> = {}
  const working: string[] = []
  const meeting: string[] = []
  const blocked: string[] = []
  const done: string[] = []
  const idle: string[] = []
  for (const id of roster) {
    const state = eventDriven ? runtime!.employees[id] : undefined
    const hint = fallback ? fallback[id] : undefined
    const current: EmployeeRuntimeStatus = state && state.status !== 'idle'
      ? state.status
      : typeof hint === 'string' ? legacyToRuntimeStatus(hint) : legacyToRuntimeStatus(hint?.status, hint?.tool)
    status[id] = current
    legacy[id] = runtimeToLegacyStatus(current)
    if (current === 'blocked') { blocked.push(id); reasons[id] = state?.block?.reason || '' }
    else if (current === 'meeting') meeting.push(id)
    else if (current === 'done') done.push(id)
    else if (current === 'idle') idle.push(id)
    else working.push(id) // working / vision / installing 在「现在」这一行里都算工作中
  }
  return {
    ids: roster, status, legacy, working, meeting, blocked, done, idle, reasons, eventDriven,
    counts: {
      total: roster.length,
      working: working.length, meeting: meeting.length, blocked: blocked.length,
      done: done.length, idle: idle.length, active: roster.length - idle.length,
    },
  }
}
