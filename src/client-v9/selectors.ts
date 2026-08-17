import type {
  Delegation,
  LegacyStatus,
  OfficePlacement,
  RoleDef,
  StaffDef,
  StaffMarker,
  StaffMeeting,
} from './types'
import { BREAKROOM_CENTER, MEETING_CENTER, STAFF_HOME } from './office-layout'

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

export function extractDelegations(nodes: any[], runningCalls: any[], roles: RoleDef[], staff: StaffDef[]): Delegation[] {
  const calls: Record<string, { name: string; args: Record<string, any>; startTime: number | null }> = {}
  const results: Record<string, { text: string; isError: boolean; endTime: number | null }> = {}
  for (const n of nodes || []) {
    if (n && n.kind === 'assistant' && Array.isArray(n.blocks)) {
      for (const b of n.blocks as any[]) {
        if (b && b.kind === 'tool-call' && b.callId) calls[b.callId] = { name: b.name, args: parseArgs(b.argsRaw), startTime: nodeTime(n) }
      }
    } else if (n && n.kind === 'tool-result' && n.callId) {
      results[n.callId] = { text: extractText(n.content), isError: !!n.isError, endTime: nodeTime(n) }
      if (n.call && !calls[n.callId]) calls[n.callId] = { name: n.call.name, args: parseArgs(n.call.argsRaw), startTime: nodeTime(n) }
    }
  }
  for (const rc of runningCalls || []) {
    if (rc && rc.callId && !calls[rc.callId]) calls[rc.callId] = { name: rc.name, args: parseArgs(rc.argsRaw), startTime: nodeTime(rc) }
  }
  const out: Delegation[] = []
  const settled = settledChildIds(nodes)
  for (const callId of Object.keys(calls)) {
    const c = calls[callId]
    if (!isDispatchTool(c.name)) continue
    const res = results[callId]
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
    out.push({
      callId,
      tool: c.name,
      desc,
      running: !res || waitingForEmployee,
      isError: res ? res.isError : false,
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

export function tasksFor(staffId: string, delegations: Delegation[]): Delegation[] {
  return delegations.filter((d) => d.staffId === staffId || d.roleId === staffId)
}

export function statusFromTasks(tasks: Delegation[]): LegacyStatus {
  if (tasks.some((t) => t.running)) return 'running'
  if (tasks.some((t) => t.isError)) return 'wait'
  if (tasks.some((t) => !t.running && !t.isError)) return 'done'
  return 'idle'
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

export function officePlacement(
  item: StaffDef,
  status: LegacyStatus,
  tick: number,
  task?: Delegation,
): OfficePlacement {
  const home = STAFF_HOME[item.id] || STAFF_HOME[item.roleId] || { x: 600, y: 400, zone: 'rd' }
  if (status === 'running' && task?.tool === 'staff_meeting') {
    return { x: MEETING_CENTER.x + (tick % 3) * 28, y: MEETING_CENTER.y + (tick % 2) * 20, zone: MEETING_CENTER.zone, activity: '在会议室讨论' }
  }
  if (status === 'running') {
    return { ...home, activity: '处理真实任务' }
  }
  if (status === 'wait') {
    return { x: MEETING_CENTER.x, y: MEETING_CENTER.y + 40, zone: 'meeting', activity: '等待决策' }
  }
  const phase = (tick + item.id.length) % 18
  if (phase >= 12 && phase <= 14 && status === 'idle') {
    return { x: BREAKROOM_CENTER.x, y: BREAKROOM_CENTER.y, zone: BREAKROOM_CENTER.zone, activity: '茶水间休息' }
  }
  if (status === 'done') return { ...home, activity: '整理交付' }
  return { ...home, activity: '工位待命' }
}

export function buildCompanyStatuses(
  staff: StaffDef[],
  delegations: Delegation[],
  sessionRunning: boolean,
): { statuses: Record<string, LegacyStatus>; tasksMap: Record<string, Delegation[]> } {
  const statuses: Record<string, LegacyStatus> = {}
  const tasksMap: Record<string, Delegation[]> = {}
  for (const st of staff) {
    const tasks = tasksFor(st.id, delegations)
    tasksMap[st.id] = tasks
    statuses[st.id] = st.id === 'secretary' ? (sessionRunning ? 'running' : 'idle') : statusFromTasks(tasks)
  }
  return { statuses, tasksMap }
}
