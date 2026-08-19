// 「赛博公司」client-v9 消息层：把真实 DSH 会话节点映射为公司群聊消息。
// 硬规则：聊天内容必须来自真实 Agent / SubAgent 执行结果，禁止生成假聊天。
import type { CompanyMessage, GrowthEvent, MarketPluginItem, SkillQueueItem, StaffDef } from './types'
import {
  assistantMaterial,
  cleanSettlementReply,
  cleanStaffResult,
  clip,
  extractText,
  isRouterOnlyMessage,
  isStaffRoutingAssistant,
  messageSource,
  nodeTime,
  parseArgs,
  parseStaffMarker,
  parseStaffMeeting,
  settlementEvent,
  settlementMaterial,
  staffChildIndex,
  staffOf,
  stripRouterSentinels,
} from './selectors'

let messageSeq = 0

function nextId(prefix: string, node: any): string {
  messageSeq += 1
  return `${prefix}-${String(node?.seq ?? 'x')}-${messageSeq}`
}

export function extractMentions(text: string, staff: StaffDef[]): string[] {
  const hits: string[] = []
  for (const employee of staff) {
    if (text.includes(`@${employee.name}`)) hits.push(employee.id)
  }
  return hits
}

function cleanBossMessage(text: string): string {
  const normalized = text
    .replaceAll('\u7eaf\u725b\u9a6c', '赛博公司')
    .replaceAll('\u6715\u7684\u6c5f\u5c71', '赛博公司')
  return normalized.match(/老板消息：([\s\S]*)$/)?.[1]?.trim() || normalized
}

function cleanPublicReply(text: string): string {
  return text
    .replaceAll('\u7eaf\u725b\u9a6c', '赛博公司')
    .replaceAll('\u6715\u7684\u6c5f\u5c71', '赛博公司')
    .replace(/^(?:The user|The boss|This is|I am|I should)[\s\S]*?\n(?=[\u3400-\u9fff])/i, '')
    .trim()
}

/**
 * 可公开正文：路由哨兵一律剥掉，剥完还剩真实内容就照常上屏。
 * 只有「剥完什么都不剩」或整条本来就是路由话术时才返回空串（= 不产生这条消息）。
 */
function publicBody(text: string): string {
  return isRouterOnlyMessage(text) ? '' : stripRouterSentinels(text)
}

/** 把会话节点流映射为公司群聊消息（老板/员工本人/秘书/工具卡/会议/系统事件）。 */
export function buildCompanyMessages(nodes: any[], staff: StaffDef[]): CompanyMessage[] {
  const out: CompanyMessage[] = []
  const children = staffChildIndex(nodes || [])

  for (const node of nodes || []) {
    const time = nodeTime(node) ?? Date.now()

    if (node?.kind === 'user' || node?.kind === 'steering') {
      const source = messageSource(node)
      if (source?.kind === 'subagent-settled' && source.senderSessionId) {
        const routed = children.get(String(source.senderSessionId))
        const employee = routed ? staffOf(routed.staffId, staff) : undefined
        if (employee) {
          const text = publicBody(cleanSettlementReply(extractText(node.content)))
          if (text) {
            out.push({
              id: nextId('reply', node), channelId: '', node,
              sender: { type: 'employee', staffId: employee.id },
              content: text, mentions: extractMentions(text, staff),
              kind: 'message', createdAt: time,
            })
          }
          continue
        }
      }
      const text = cleanBossMessage(extractText(node.content) || '（非文本消息）')
      out.push({
        id: nextId('boss', node), channelId: '', node,
        sender: { type: 'boss' },
        content: text, mentions: extractMentions(text, staff),
        kind: 'message', createdAt: time,
      })
      continue
    }

    if (node?.kind === 'assistant') {
      if (isStaffRoutingAssistant(node)) continue
      const material = assistantMaterial(node.blocks || [])
      if (!material.text && !material.images) continue
      // 秘书那条消息可能是「哨兵 + 真实交代」混排，剥完还剩内容就必须显示，只有全是哨兵才整条隐藏。
      const body = publicBody(material.text)
      if (!body && !material.images) continue
      out.push({
        id: nextId('sec', node), channelId: '', node,
        sender: { type: 'secretary' },
        content: body || (material.images ? `（附 ${material.images} 张图片）` : ''),
        mentions: extractMentions(body, staff),
        kind: 'message', createdAt: time,
        reasoning: material.reasoning || undefined,
      })
      continue
    }

    const settled = settlementEvent(node)
    if (settled) {
      const routed = children.get(settled.childId)
      const employee = routed ? staffOf(routed.staffId, staff) : undefined
      if (employee) {
        const material = settlementMaterial(settled.reply)
        const body = publicBody(material.text)
        if (body) {
          out.push({
            id: nextId('staff', node), channelId: '', node,
            sender: { type: 'employee', staffId: employee.id },
            content: cleanPublicReply(body), mentions: extractMentions(body, staff),
            kind: 'message', createdAt: time,
            reasoning: material.reasoning || undefined,
          })
        }
        continue
      }
    }

    if (node?.kind === 'tool-result') {
      const text = extractText(node.content)

      const meeting = parseStaffMeeting(text)
      if (meeting) {
        out.push({
          id: nextId('meet-start', node), channelId: '', node,
          sender: { type: 'secretary' },
          content: `会议开始 · ${meeting.topic}`, mentions: [],
          kind: 'system', createdAt: time,
        })
        meeting.turns.forEach((turn, index) => {
          const employee = staffOf(turn.staffId, staff)
          out.push({
            id: nextId(`meet-turn-${index}`, node), channelId: '', node,
            sender: employee ? { type: 'employee', staffId: employee.id } : { type: 'secretary' },
            content: turn.reply, mentions: extractMentions(turn.reply, staff),
            kind: 'message', createdAt: time,
          })
        })
        out.push({
          id: nextId('meet-end', node), channelId: '', node,
          sender: { type: 'secretary' },
          content: '形成结论', mentions: [],
          kind: 'system', createdAt: time,
        })
        continue
      }

      const routed = parseStaffMarker(text)
      if (routed) {
        const employee = staffOf(routed.staffId, staff)
        // state === 'accepted' 表示员工正在独立子代理中处理，用“正在输入”呈现，不产生消息。
        if (employee && routed.state === 'replied') {
          const reply = publicBody(cleanStaffResult(text))
          if (reply) {
            out.push({
              id: nextId('direct', node), channelId: '', node,
              sender: { type: 'employee', staffId: employee.id },
              content: cleanPublicReply(reply), mentions: extractMentions(reply, staff),
              kind: 'message', createdAt: time,
            })
          }
        }
        continue
      }

      const toolName = String(node.call?.name || '')
      if (toolName) {
        const lead = clip(text.replace(/\s+/g, ' ').trim(), 90)
        out.push({
          id: nextId('tool', node), channelId: '', node,
          sender: { type: 'secretary' },
          content: lead || '(无输出)', mentions: [],
          kind: 'tool', createdAt: time,
          toolName, reasoning: text || undefined,
        })
      }
      continue
    }

    if (node?.kind === 'turn-error') {
      out.push({
        id: nextId('err', node), channelId: '', node,
        sender: { type: 'secretary' },
        content: `本轮执行失败：${node.message || node.code || '未知错误'}`, mentions: [],
        kind: 'system', createdAt: time,
      })
    }
  }

  return out
}

/** 收集 assistant tool-call 的参数表，用于把 tool-result 归因到员工。 */
function collectCallArgs(nodes: any[]): Record<string, Record<string, any>> {
  const callArgs: Record<string, Record<string, any>> = {}
  for (const node of nodes || []) {
    if (node?.kind !== 'assistant' || !Array.isArray(node.blocks)) continue
    for (const block of node.blocks as any[]) {
      if (block?.kind === 'tool-call' && block.callId) callArgs[block.callId] = parseArgs(block.argsRaw)
    }
  }
  return callArgs
}

const GROWTH_TOOLS = ['staff_skill_learn', 'staff_reflect', 'staff_memory_remember']

/** 员工成长动态：来自真实的技能学习 / 复盘 / 记忆沉淀工具结果。 */
export function extractGrowthEvents(nodes: any[], staff: StaffDef[]): GrowthEvent[] {
  const callArgs = collectCallArgs(nodes)
  const out: GrowthEvent[] = []
  for (const node of nodes || []) {
    if (node?.kind !== 'tool-result' || !node.callId || node.isError) continue
    const tool = String(node.call?.name || '')
    if (!GROWTH_TOOLS.includes(tool)) continue
    const args = callArgs[node.callId] || parseArgs(node.call?.argsRaw)
    const rawStaff = typeof args.staff === 'string' ? args.staff : ''
    const employee = rawStaff ? staffOf(rawStaff, staff) : undefined
    let text: string
    if (tool === 'staff_skill_learn') {
      text = `学会了「${clip(String(args.skill || args.name || args.topic || '新技能'), 24)}」`
    } else if (tool === 'staff_reflect') {
      text = `完成复盘：${clip(String(args.lesson || args.task || extractText(node.content)), 42)}`
    } else {
      text = `沉淀了一条长期记忆：${clip(String(args.text || args.content || extractText(node.content)), 42)}`
    }
    out.push({
      id: `growth-${node.callId}`,
      staffId: employee?.id,
      tool,
      text,
      time: nodeTime(node),
    })
  }
  return out.slice(-10).reverse()
}

/** 技能学习队列：staff_skill_learn 的调用记录（含进行中）。 */
export function extractSkillQueue(nodes: any[], runningCalls: any[], staff: StaffDef[]): SkillQueueItem[] {
  const callArgs = collectCallArgs(nodes)
  const doneResults = new Set<string>()
  for (const node of nodes || []) {
    if (node?.kind === 'tool-result' && String(node.call?.name || '') === 'staff_skill_learn' && node.callId) {
      doneResults.add(node.callId)
    }
  }
  const seen = new Set<string>()
  const out: SkillQueueItem[] = []
  const push = (callId: string, args: Record<string, any>, running: boolean, time: number | null) => {
    if (!callId || seen.has(callId)) return
    seen.add(callId)
    const rawStaff = typeof args.staff === 'string' ? args.staff : ''
    out.push({
      callId,
      staffId: rawStaff ? staffOf(rawStaff, staff)?.id : undefined,
      skill: clip(String(args.skill || args.name || args.topic || '新技能'), 24),
      running,
      time,
    })
  }
  for (const node of nodes || []) {
    if (node?.kind !== 'tool-result' || String(node.call?.name || '') !== 'staff_skill_learn' || !node.callId) continue
    push(node.callId, callArgs[node.callId] || parseArgs(node.call?.argsRaw), false, nodeTime(node))
  }
  for (const call of runningCalls || []) {
    if (String(call?.name || '') !== 'staff_skill_learn') continue
    push(call.callId, callArgs[call.callId] || parseArgs(call.argsRaw), true, nodeTime(call))
  }
  return out.slice(-8).reverse()
}

function parseJsonLoose(text: string): any {
  try {
    return JSON.parse(text)
  } catch { /* 尝试从文本中提取首个 JSON 对象/数组 */ }
  const match = text.match(/[{\[][\s\S]*[}\]]/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

/** 插件市场精选：来自真实的 staff_plugin_market_search 结果，无结果时保持空态。 */
export function extractMarketPlugins(nodes: any[]): MarketPluginItem[] {
  const found: MarketPluginItem[] = []
  for (const node of nodes || []) {
    if (node?.kind !== 'tool-result' || node.isError) continue
    if (String(node.call?.name || '') !== 'staff_plugin_market_search') continue
    const parsed = parseJsonLoose(extractText(node.content))
    const list: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.results)
        ? parsed.results
        : Array.isArray(parsed?.plugins)
          ? parsed.plugins
          : Array.isArray(parsed?.items)
            ? parsed.items
            : []
    for (const item of list) {
      if (!item || typeof item !== 'object' || !item.name) continue
      found.push({
        name: String(item.name),
        owner: item.owner ? String(item.owner) : undefined,
        description: clip(String(item.description || ''), 72),
        stars: typeof item.stars === 'number' ? item.stars : undefined,
        url: item.url ? String(item.url) : undefined,
        install: item.install ? String(item.install) : undefined,
      })
    }
  }
  const dedup = new Map<string, MarketPluginItem>()
  for (const item of found) dedup.set(item.name, item)
  return [...dedup.values()].slice(-6).reverse()
}
