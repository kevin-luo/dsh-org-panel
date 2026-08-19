import { createElement as h, useEffect, useMemo, useRef } from 'react'
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
  thread: CompanyMessage | null
  onOpenThread: (message: CompanyMessage) => void
  onCloseThread: () => void
}) {
  // 工作群只负责「看」：频道 / 消息流 / 临时工作组 / Tool Trace / thread / typing。
  // 「写」全部交给 DSH 原生 Composer（本面板下方的 [data-composer-seat]），这里没有任何自制输入控件。
  const { channels, channelId, onChannel, messages, staff, runningCalls, typingStaff, running, promptError,
    activeStaffId, onClearStaffFilter, collapsed, onToggleCollapsed, height, onHeight,
    thread, onOpenThread, onCloseThread } = props
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
  useEffect(() => {
    const el = bodyRef.current
    if (el && followRef.current) el.scrollTop = el.scrollHeight
  }, [visible.length, runningCalls?.length, running, typingStaff])

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
          visible.length === 0 && !runningCalls?.length && !typingStaff ? h('div', { className: 'cy9-chat-empty' }, '工作群已连接当前 DSH 会话。直接在下方输入任务，系统会按任务内容自动拉合适的员工进工作组；输入 @姓名 可以锁定指定员工。') : null,
          visible.map((message) => h(ChatMessage, { key: message.id, message, staff, onOpenThread })),
          (runningCalls || []).map((call: any) => h('div', { key: call.callId, className: 'cy9-msg-tool running' },
            h('span', { className: 'cy9-msg-tool-icon' }, 'RUN'), h('span', { className: 'cy9-msg-tool-main' }, h('b', null, String(call.name || 'tool')), h('span', null, '正在执行真实工具…')),
          )),
          typingStaff ? h('div', { className: 'cy9-msg-typing' }, h(AssetImage, { src: staffThumb(typingStaff.id), alt: typingStaff.name, fallback: typingStaff.name }), `${typingStaff.name} 正在输入`, h('span', null, h('i'), h('i'), h('i'))) : running ? h('div', { className: 'cy9-msg-typing' }, '正在根据任务组队并推进工作', h('span', null, h('i'), h('i'), h('i'))) : null,
        ),
        // 输入位说明：真正的输入框是下方 DSH 原生 Composer，这里只做一行只读指引。
        h('div', { className: 'cy9-chat-hint' }, `直接发任务会自动组队 · 输入 @ 可锁定员工${channel ? ` · 当前 # ${channel.name}` : ''}`),
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