import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import type { Channel, CompanyMessage, StaffDef } from '../types'
import { staffThumb } from '../asset-map'
import { channelMatchesNode, clip, formatClock, staffOf } from '../selectors'
import { AssetImage } from './AssetImage'
import { ChatMessage } from './ChatMessage'

const MIN_HEIGHT = 240
const MAX_HEIGHT = 420

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
  draft: string
  onDraft: (value: string) => void
  onSend: (text: string) => void
  thread: CompanyMessage | null
  onOpenThread: (message: CompanyMessage) => void
  onCloseThread: () => void
}) {
  const { channels, channelId, onChannel, messages, staff, runningCalls, typingStaff, running, promptError,
    activeStaffId, onClearStaffFilter, collapsed, onToggleCollapsed, height, onHeight, draft, onDraft, onSend,
    thread, onOpenThread, onCloseThread } = props
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
  const channelCount = useMemo(() => Object.fromEntries(channels.map((channel) => [channel.id,
    channel.departments.length ? staff.filter((item) => channel.departments.includes(item.department || '')).length : staff.length,
  ])), [channels, staff])
  const mentionQuery = useMemo(() => draft.match(/@([^\s@#]{0,10})$/)?.[1] ?? null, [draft])
  const mentionCandidates = useMemo(() => mentionQuery == null ? [] : staff.filter((item) => {
    const query = mentionQuery.toLowerCase()
    return !query || item.name.toLowerCase().includes(query) || (item.aliases || []).some((alias) => alias.toLowerCase().includes(query))
  }).slice(0, 7), [mentionQuery, staff])
  useEffect(() => setMentionIdx(0), [mentionQuery])
  useEffect(() => {
    const el = bodyRef.current
    if (el && followRef.current) el.scrollTop = el.scrollHeight
  }, [visible.length, runningCalls?.length, running, typingStaff])

  const pickMention = (employee: StaffDef) => onDraft(draft.replace(/@[^\s@#]{0,10}$/, `@${employee.name} `))
  const send = () => { const value = draft.trim(); if (value) { onSend(value); onDraft('') } }
  const onKeyDown = (event: any) => {
    if (mentionCandidates.length && mentionQuery != null) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); setMentionIdx((mentionIdx + (event.key === 'ArrowDown' ? 1 : -1) + mentionCandidates.length) % mentionCandidates.length); return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault(); pickMention(mentionCandidates[mentionIdx] || mentionCandidates[0]); return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() }
  }
  const onGripDown = (event: any) => {
    event.preventDefault(); gripRef.current = { startY: event.clientY, startH: height }
    const move = (next: MouseEvent) => { if (gripRef.current) onHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, gripRef.current.startH + gripRef.current.startY - next.clientY))) }
    const up = () => { gripRef.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  const channel = channels.find((item) => item.id === channelId)

  return h('section', { className: `cy9-collab${collapsed ? ' collapsed' : ''}`, style: { height: collapsed ? 40 : height } },
    h('div', { className: 'cy9-collab-grip', onMouseDown: onGripDown }),
    h('div', { className: 'cy9-collab-head' },
      h('div', null, h('b', null, '公司工作群'), h('span', null, channel ? `# ${channel.name}` : '团队总览')),
      activeStaff ? h('button', { type: 'button', className: 'cy9-filter-chip', onClick: onClearStaffFilter }, `只看 ${activeStaff.name} ×`) : null,
      promptError ? h('span', { className: 'cy9-error' }, '发送失败') : null,
      h('button', { type: 'button', className: 'cy9-collab-toggle', onClick: onToggleCollapsed }, collapsed ? '展开' : '折叠'),
    ),
    collapsed ? null : h('div', { className: `cy9-collab-body${thread ? ' with-thread' : ''}` },
      h('nav', { className: 'cy9-channels', 'aria-label': '协作频道' },
        h('div', { className: 'cy9-channels-label' }, '频道'),
        channels.map((item) => h('button', { key: item.id, type: 'button', className: `cy9-channel${item.id === channelId ? ' on' : ''}`, onClick: () => onChannel(item.id) },
          h('i', null, '#'), h('span', null, item.name), h('em', null, String(channelCount[item.id] || 0)),
        )),
      ),
      h('div', { className: 'cy9-chat' },
        h('div', { className: 'cy9-chat-body', ref: bodyRef, role: 'log', 'aria-live': 'polite', onScroll: (event: any) => {
          const el = event.currentTarget as HTMLDivElement; followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        } },
          visible.length === 0 && !runningCalls?.length && !typingStaff ? h('div', { className: 'cy9-chat-empty' }, '工作群已连接当前 DSH 会话。输入 @员工姓名，消息会直达对应独立子代理。') : null,
          visible.map((message) => h(ChatMessage, { key: message.id, message, staff, onOpenThread })),
          (runningCalls || []).map((call: any) => h('div', { key: call.callId, className: 'cy9-msg-tool running' },
            h('span', { className: 'cy9-msg-tool-icon' }, 'RUN'), h('span', { className: 'cy9-msg-tool-main' }, h('b', null, String(call.name || 'tool')), h('span', null, '正在执行真实工具…')),
          )),
          typingStaff ? h('div', { className: 'cy9-msg-typing' }, h(AssetImage, { src: staffThumb(typingStaff.id), alt: typingStaff.name, fallback: typingStaff.name }), `${typingStaff.name} 正在输入`, h('span', null, h('i'), h('i'), h('i'))) : running ? h('div', { className: 'cy9-msg-typing' }, '秘书正在协调任务', h('span', null, h('i'), h('i'), h('i'))) : null,
        ),
        h('div', { className: 'cy9-chat-input' },
          mentionCandidates.length && mentionQuery != null ? h('div', { className: 'cy9-mention-pop' }, mentionCandidates.map((employee, index) => h('button', {
            key: employee.id, type: 'button', className: index === mentionIdx ? 'on' : '', onClick: () => pickMention(employee),
          }, h(AssetImage, { src: staffThumb(employee.id), alt: employee.name, fallback: employee.name }), h('b', null, employee.name), h('span', null, employee.role)))) : null,
          h('textarea', { 'data-cy9-composer': 'true', value: draft, placeholder: `在 # ${channel?.name || '团队总览'} 输入消息，@ 点名员工…`, onChange: (event: any) => onDraft(event.target.value), onKeyDown }),
          h('span', null, 'Enter 发送 · Shift+Enter 换行'),
          h('button', { type: 'button', className: 'cy9-chat-send', disabled: !draft.trim(), onClick: send }, '发送'),
        ),
      ),
      thread ? h('aside', { className: 'cy9-thread' },
        h('div', { className: 'cy9-thread-head' }, h('b', null, thread.kind === 'tool' ? '工具轨迹' : '讨论线程'), h('button', { type: 'button', onClick: onCloseThread }, '关闭')),
        h('div', { className: 'cy9-thread-body' },
          h('span', null, `${formatClock(thread.createdAt)} · ${thread.toolName || '消息上下文'}`),
          h('p', null, clip(thread.content
            .replaceAll('\u7eaf\u725b\u9a6c', '赛博公司')
            .replaceAll('\u6715\u7684\u6c5f\u5c71', '赛博公司'), 600)),
          thread.reasoning ? h('div', { className: 'cy9-thread-safe' }, '仅展示安全执行摘要；私有推理过程不会暴露。') : null,
        ),
      ) : null,
    ),
  )
}
