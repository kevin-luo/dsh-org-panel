// 「赛博公司」client-v9 群聊消息行：老板/员工本人/秘书/工具卡/系统分隔条。
import { createElement as h } from 'react'
import type { CompanyMessage, StaffDef } from '../types'
import { staffPortrait } from '../asset-map'
import { formatClock, staffOf } from '../selectors'

function senderInfo(message: CompanyMessage, staff: StaffDef[]): { name: string; role: string; avatar: 'boss' | string } {
  if (message.sender.type === 'boss') return { name: '老板', role: '全权指挥', avatar: 'boss' }
  if (message.sender.type === 'employee') {
    const employee = staffOf(message.sender.staffId, staff)
    return employee
      ? { name: employee.name, role: employee.role, avatar: staffPortrait(employee.id) }
      : { name: '员工', role: '', avatar: staffPortrait('developer') }
  }
  const secretary = staffOf('secretary', staff)
  return { name: secretary?.name || '秘书', role: '主 Agent', avatar: staffPortrait('secretary') }
}

export function ChatMessage(props: {
  message: CompanyMessage
  staff: StaffDef[]
  onOpenThread: (message: CompanyMessage) => void
}) {
  const { message, staff, onOpenThread } = props

  if (message.kind === 'system' || message.kind === 'meeting') {
    return h('div', { className: 'cy9-msg-divider' }, h('b', null, message.content))
  }

  if (message.kind === 'tool') {
    return h('div', { className: 'cy9-msg-tool', onClick: () => onOpenThread(message), title: '点击查看详情' },
      h('div', { className: 'cy9-msg-tool-icon' }, '🔧'),
      h('div', { className: 'cy9-msg-tool-main' },
        h('b', null, message.toolName || 'tool', h('em', null, formatClock(message.createdAt))),
        h('p', null, message.content),
      ),
    )
  }

  const info = senderInfo(message, staff)
  return h('div', {
    className: `cy9-msg${message.sender.type === 'boss' ? ' from-boss' : ''}`,
    onClick: () => onOpenThread(message),
  },
    info.avatar === 'boss'
      ? h('div', { className: 'cy9-msg-avatar boss' }, '朕')
      : h('div', { className: 'cy9-msg-avatar' }, h('img', { src: info.avatar, alt: info.name })),
    h('div', { className: 'cy9-msg-main' },
      h('div', { className: 'cy9-msg-meta' },
        h('b', null, info.name),
        info.role ? h('span', null, info.role) : null,
        h('em', null, formatClock(message.createdAt)),
      ),
      h('div', { className: 'cy9-msg-bubble' }, message.content),
      message.reasoning ? h('details', { className: 'cy9-msg-thinking' },
        h('summary', null, '▾ 查看工作思路'),
        h('pre', null, message.reasoning),
      ) : null,
    ),
  )
}
