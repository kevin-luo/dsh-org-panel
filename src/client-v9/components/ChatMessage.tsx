import { createElement as h } from 'react'
import type { CompanyMessage, StaffDef } from '../types'
import { staffThumb } from '../asset-map'
import { formatClock, staffOf } from '../selectors'
import { AssetImage } from './AssetImage'

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
  return h('article', { className: `cy9-msg${message.sender.type === 'boss' ? ' from-boss' : ''}`, onDoubleClick: () => onOpenThread(message) },
    info.staffId
      ? h('div', { className: 'cy9-msg-avatar' }, h(AssetImage, { src: staffThumb(info.staffId), alt: info.name, fallback: info.name }))
      : h('div', { className: 'cy9-msg-avatar boss' }, 'B'),
    h('div', { className: 'cy9-msg-main' },
      h('div', { className: 'cy9-msg-meta' }, h('b', null, info.name), h('span', null, info.role), h('em', null, formatClock(message.createdAt))),
      h('div', { className: 'cy9-msg-bubble' }, publicContent(message.content)),
      message.reasoning ? h('details', { className: 'cy9-msg-thinking' },
        h('summary', null, '工作轨迹摘要'), h('p', null, safeTraceSummary(message)),
      ) : null,
    ),
  )
}
