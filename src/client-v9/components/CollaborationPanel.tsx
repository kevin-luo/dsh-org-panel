// 「赛博公司」client-v9 公司群聊：频道 + 真实消息流 + @员工 输入区。
// 消息只来自真实 Agent / SubAgent 执行结果，禁止假聊天。
import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import type { Channel, CompanyMessage, StaffDef } from '../types'
import { staffPortrait } from '../asset-map'
import { channelMatchesNode, formatClock, staffOf } from '../selectors'
import { ChatMessage } from './ChatMessage'

const MIN_HEIGHT = 240
const MAX_HEIGHT = 480

export function CollaborationPanel(props: {
  channels: Channel[]
  channelId: string
  onChannel: (id: string) => void
  messages: CompanyMessage[]
  staff: StaffDef[]
  runningCalls: any[]
  typingStaff: StaffDef | null
  running: boolean
  promptError: any
  activeStaffId: string | null
  onClearStaffFilter: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
  height: number
  onHeight: (height: number) => void
  onSend: (text: string) => void
  onOpenThread: (message: CompanyMessage) => void
}) {
  const {
    channels, channelId, onChannel, messages, staff, runningCalls, typingStaff, running,
    promptError, activeStaffId, onClearStaffFilter, collapsed, onToggleCollapsed,
    height, onHeight, onSend, onOpenThread,
  } = props

  const [text, setText] = useState('')
  const [mentionIdx, setMentionIdx] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const gripRef = useRef<{ startY: number; startH: number } | null>(null)

  const activeStaff = activeStaffId ? staffOf(activeStaffId, staff) : undefined

  const visible = useMemo(() => messages.filter((message) => {
    if (activeStaffId) {
      const mine = message.sender.type === 'employee' && message.sender.staffId === activeStaffId
      if (!mine && !message.mentions.includes(activeStaffId)) return false
    }
    return message.node ? channelMatchesNode(message.node, channelId, staff) : true
  }), [messages, activeStaffId, channelId, staff])

  const channelCount = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const channel of channels) {
      counts[channel.id] = channel.departments.length === 0
        ? staff.length
        : staff.filter((item) => channel.departments.includes(item.department || '')).length
    }
    return counts
  }, [channels, staff])

  const mentionQuery = useMemo(() => {
    const match = text.match(/@([^\s@#]{0,10})$/)
    return match ? match[1] : null
  }, [text])

  const mentionCandidates = useMemo(() => {
    if (mentionQuery == null) return []
    const query = mentionQuery.toLowerCase()
    return staff
      .filter((item) => !query
        || item.name.toLowerCase().includes(query)
        || (item.aliases || []).some((alias) => alias.toLowerCase().includes(query)))
      .slice(0, 6)
  }, [mentionQuery, staff])

  useEffect(() => { setMentionIdx(0) }, [mentionQuery])

  const signature = `${visible.length}:${runningCalls?.length || 0}:${running ? 1 : 0}`
  useEffect(() => {
    const el = bodyRef.current
    if (el && followRef.current) el.scrollTop = el.scrollHeight
  }, [signature])

  const pickMention = (employee: StaffDef) => {
    setText(text.replace(/@[^\s@#]{0,10}$/, `@${employee.name} `))
  }

  const send = () => {
    const value = text.trim()
    if (!value || running === undefined) return
    onSend(value)
    setText('')
  }

  const onKeyDown = (event: any) => {
    if (mentionCandidates.length > 0 && mentionQuery != null) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setMentionIdx((mentionIdx + 1) % mentionCandidates.length); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); setMentionIdx((mentionIdx - 1 + mentionCandidates.length) % mentionCandidates.length); return }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        pickMention(mentionCandidates[mentionIdx] || mentionCandidates[0])
        return
      }
      if (event.key === 'Escape') { setText(`${text} `); return }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  const onGripDown = (event: any) => {
    event.preventDefault()
    gripRef.current = { startY: event.clientY, startH: height }
    const move = (e: MouseEvent) => {
      const grip = gripRef.current
      if (!grip) return
      onHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, grip.startH + (grip.startY - e.clientY))))
    }
    const up = () => {
      gripRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const channel = channels.find((c) => c.id === channelId)

  return h('section', { className: `cy9-collab${collapsed ? ' collapsed' : ''}`, style: { height: collapsed ? 38 : height } },
    h('div', { className: 'cy9-collab-grip', onMouseDown: onGripDown }),
    h('div', { className: 'cy9-collab-head' },
      h('b', null, '团队协作'),
      h('span', null, channel ? `# ${channel.name}` : '公司群聊'),
      promptError ? h('span', { style: { color: '#ff8a96' } }, '发送或停止失败') : null,
      h('button', { type: 'button', className: 'cy9-collab-toggle', onClick: onToggleCollapsed }, collapsed ? '⌃ 展开' : '⌄ 折叠'),
    ),
    collapsed ? null : h('div', { className: 'cy9-collab-body' },
      h('div', { className: 'cy9-channels' },
        h('div', { className: 'cy9-channels-label' }, '协作频道'),
        channels.map((item) => h('button', {
          key: item.id,
          type: 'button',
          className: `cy9-channel${item.id === channelId ? ' on' : ''}`,
          onClick: () => onChannel(item.id),
        },
          h('i', null, '#'), item.name,
          h('em', null, String(channelCount[item.id] || 0)),
        )),
      ),
      h('div', { className: 'cy9-chat' },
        activeStaff ? h('div', { className: 'cy9-chat-filter' },
          `只看 ${activeStaff.name} 相关消息`,
          h('button', { type: 'button', onClick: onClearStaffFilter }, '✕ 清除'),
        ) : null,
        h('div', {
          className: 'cy9-chat-body', ref: bodyRef, role: 'log', 'aria-live': 'polite',
          onScroll: (e: any) => {
            const el = e.currentTarget as HTMLDivElement
            followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          },
        },
          visible.length === 0 && !(runningCalls || []).length && !typingStaff
            ? h('div', { className: 'cy9-chat-empty' },
              '赛博公司工作群已上线。在下方输入「@员工姓名」点名任意员工，本人会直接回复；多人讨论由秘书安排真实会议。')
            : null,
          visible.map((message) => h(ChatMessage, { key: message.id, message, staff, onOpenThread })),
          (runningCalls || []).map((call: any) => h('div', { key: `run-${call.callId}`, className: 'cy9-msg-tool' },
            h('div', { className: 'cy9-msg-tool-icon' }, '🔧'),
            h('div', { className: 'cy9-msg-tool-main' },
              h('b', null, String(call.name || 'tool'), h('em', null, formatClock(Date.now()))),
              h('p', null, '进行中…'),
            ),
          )),
          typingStaff ? h('div', { className: 'cy9-msg-typing' },
            h('img', { src: staffPortrait(typingStaff.id), alt: typingStaff.name }),
            `${typingStaff.name} 正在输入`,
            h('span', { className: 'cy9-typing-dots' }, h('i', null), h('i', null), h('i', null)),
          ) : running ? h('div', { className: 'cy9-msg-typing' },
            '秘书正在处理',
            h('span', { className: 'cy9-typing-dots' }, h('i', null), h('i', null), h('i', null)),
          ) : null,
        ),
        h('div', { className: 'cy9-chat-input' },
          mentionCandidates.length > 0 && mentionQuery != null ? h('div', { className: 'cy9-mention-pop' },
            mentionCandidates.map((employee, index) => h('button', {
              key: employee.id,
              type: 'button',
              className: `cy9-mention-item${index === mentionIdx ? ' on' : ''}`,
              onClick: () => pickMention(employee),
            },
              h('img', { src: staffPortrait(employee.id), alt: employee.name }),
              h('b', null, employee.name),
              h('span', null, employee.role),
            )),
          ) : null,
          h('textarea', {
            value: text,
            placeholder: `在 # ${channel?.name || '公司群聊'} 输入消息，@ 点名员工…`,
            onChange: (e: any) => setText(e.target.value),
            onKeyDown,
          }),
          h('span', { className: 'cy9-chat-hint' }, 'Enter 发送 / Shift+Enter 换行'),
          h('button', { type: 'button', className: 'cy9-chat-send', onClick: send }, '发送'),
        ),
      ),
    ),
  )
}
