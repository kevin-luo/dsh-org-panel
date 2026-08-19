import { createElement as h, useState } from 'react'
import type { CompanyMessage, StaffDef } from '../types'
import { staffThumb } from '../asset-map'
import { clip, formatClock, staffOf } from '../selectors'
import { AssetImage } from './AssetImage'
import { childIdOfNode, installMemoryEvidenceStyles, useMemoryEvidence, type MemoryEvidenceItem } from '../memory-evidence'

function senderInfo(message: CompanyMessage, staff: StaffDef[]) {
  if (message.sender.type === 'boss') return { name: '老板', role: '公司指挥席', staffId: '' }
  if (message.sender.type === 'employee') {
    const employee = staffOf(message.sender.staffId, staff)
    return { name: employee?.name || '员工', role: employee?.role || '', staffId: employee?.id || 'developer' }
  }
  const secretary = staffOf('secretary', staff)
  return { name: secretary?.name || '秘书', role: '主 Agent · 总裁秘书', staffId: 'secretary' }
}

function publicContent(text: string): string {
  let value = text
    .replaceAll('\u7eaf\u725b\u9a6c', '赛博公司')
    .replaceAll('\u6715\u7684\u6c5f\u5c71', '赛博公司')
    .trim()
  const wrapped = value.match(/老板消息：([\s\S]*)$/)
  if (wrapped) value = wrapped[1].trim()
  value = value.replace(/^(?:The user|The boss|This is|I am|I should)[\s\S]*?\n(?=[\u3400-\u9fff])/i, '')
  return value
}

function safeTraceSummary(message: CompanyMessage): string {
  const source = `${message.toolName || ''} ${message.reasoning || ''}`
  const labels: Record<string, string> = {
    read: '读取资料', edit: '编辑文件', bash: '执行命令', web_search: '网络检索', image: '处理图像',
    staff_chat: '员工直聊', staff_meeting: '多人会议', subagent: '独立员工执行', workflow: '工作流',
  }
  const found = Object.keys(labels).filter((key) => source.toLowerCase().includes(key)).map((key) => labels[key])
  return found.length ? `执行摘要：${[...new Set(found)].join(' · ')}` : '已完成必要分析并形成公开答复；私有推理过程不展示。'
}

const OUTCOME_LABEL: Record<string, string> = { success: '成功', partial: '部分完成', blocked: '卡住', failed: '失败' }
const KIND_LABEL: Record<string, string> = {
  preference: '用户偏好', project: '项目事实', workflow: '工作流', lesson: '经验', relationship: '关系', fact: '事实',
}

function stamp(time: number): string {
  if (!time) return '时间未知'
  try {
    return new Date(time).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return '时间未知'
  }
}

function evidenceRow(item: MemoryEvidenceItem) {
  const label = item.type === 'reflection'
    ? `复盘${item.outcome ? ` · ${OUTCOME_LABEL[item.outcome] || item.outcome}` : ''}`
    : `记忆${item.kind ? ` · ${KIND_LABEL[item.kind] || item.kind}` : ''}`
  return h('div', { key: item.id, className: 'cy9-mem-row' },
    h('p', null, clip(item.text, 180)),
    h('div', null,
      h('em', null, label),
      h('span', null, stamp(item.updatedAt || item.createdAt)),
      // 复盘自带来源任务；记忆没有结构化来源，如实说未知，不拿这条消息的内容顶上去。
      h('span', null, item.sourceTask ? `来源任务：${clip(item.sourceTask, 40)}` : '来源任务未知'),
      ...(item.tags || []).slice(0, 4).map((tag) => h('span', { key: tag, className: 'cy9-mem-tag' }, tag)),
    ),
  )
}

/**
 * 记忆证据 chip（需求文档六十条前两句）。
 *
 * 只有 host 的注入台账真的记着「这一轮往这个子代理里注入过这些 id」时才出现，
 * 且注入 0 条 / 通道不通 / 台账里没有 —— 三种情况一律**什么都不渲染**。
 * 显示一个「0 条」的 chip 等于对老板宣称「这次系统查过历史但没找到」，
 * 而事实可能只是这条链路根本没记账；那是编造，不做。
 */
function MemoryEvidenceChip(props: { employeeId: string; childId: string }) {
  installMemoryEvidenceStyles()
  const [open, setOpen] = useState(false)
  const evidence = useMemoryEvidence(props.employeeId, props.childId)
  if (evidence.state !== 'ok') return null
  const { items, injection, missing } = evidence.view
  if (!items.length) return null
  const memories = items.filter((item) => item.type === 'memory').length
  const reflections = items.length - memories
  const parts: string[] = []
  if (memories) parts.push(`${memories} 条记忆`)
  if (reflections) parts.push(`${reflections} 条复盘`)

  return h('div', { className: 'cy9-mem-chip-wrap' },
    h('button', {
      type: 'button', className: 'cy9-mem-chip', 'aria-expanded': open,
      title: '这一轮真正写进他 prompt 的历史条目',
      onClick: (event: any) => { event.stopPropagation(); setOpen((value) => !value) },
    }, h('i', null), `引用了 ${parts.join(' · ')}`),
    open
      ? h('div', { className: 'cy9-mem-pop', onClick: (event: any) => event.stopPropagation() },
        h('header', null,
          h('b', null, '本轮真实注入'),
          h('span', null, stamp(injection.injectedAt)),
          injection.query ? h('span', null, `任务：${clip(injection.query, 30)}`) : null,
        ),
        items.map(evidenceRow),
        missing
          ? h('p', { className: 'cy9-mem-note' }, `另有 ${missing} 条当时注入的条目已经被档案淘汰，原文查不到了。`)
          : null,
      )
      : null,
  )
}

export function ChatMessage(props: {
  message: CompanyMessage
  staff: StaffDef[]
  onOpenThread: (message: CompanyMessage) => void
}) {
  const { message, staff, onOpenThread } = props
  if (message.kind === 'system' || message.kind === 'meeting') {
    return h('div', { className: 'cy9-msg-divider' }, h('span', null), h('b', null, publicContent(message.content)), h('span', null))
  }
  if (message.kind === 'tool') {
    return h('button', { type: 'button', className: 'cy9-msg-tool', onClick: () => onOpenThread(message) },
      h('span', { className: 'cy9-msg-tool-icon' }, 'RUN'),
      h('span', { className: 'cy9-msg-tool-main' },
        h('b', null, message.toolName || 'tool', h('em', null, formatClock(message.createdAt))),
        h('span', null, publicContent(message.content)),
      ),
    )
  }
  const info = senderInfo(message, staff)
  // 证据 chip 只挂在员工本人的消息上，且必须先从原始会话节点认出子代理 childId —— 认不出就不挂。
  const childId = message.sender.type === 'employee' ? childIdOfNode(message.node) : ''
  return h('article', { className: `cy9-msg${message.sender.type === 'boss' ? ' from-boss' : ''}`, onDoubleClick: () => onOpenThread(message) },
    info.staffId
      ? h('div', { className: 'cy9-msg-avatar' }, h(AssetImage, { src: staffThumb(info.staffId), alt: info.name, fallback: info.name }))
      : h('div', { className: 'cy9-msg-avatar boss' }, 'B'),
    h('div', { className: 'cy9-msg-main' },
      h('div', { className: 'cy9-msg-meta' }, h('b', null, info.name), h('span', null, info.role), h('em', null, formatClock(message.createdAt))),
      h('div', { className: 'cy9-msg-bubble' }, publicContent(message.content)),
      childId && message.sender.type === 'employee'
        ? h(MemoryEvidenceChip, { employeeId: message.sender.staffId, childId })
        : null,
      message.reasoning ? h('details', { className: 'cy9-msg-thinking' },
        h('summary', null, '工作轨迹摘要'), h('p', null, safeTraceSummary(message)),
      ) : null,
    ),
  )
}
