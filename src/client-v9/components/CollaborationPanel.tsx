import { createElement as h, useEffect, useMemo, useRef } from 'react'
import type { Channel, CompanyMessage, StaffDef } from '../types'
import type { WorkgroupFeed } from '../work-sessions'
import { workgroupPlatformLabel } from '../work-sessions'
import { staffThumb } from '../asset-map'
import { channelMatchesNode, clip, formatClock, staffOf } from '../selectors'
import { AssetImage } from './AssetImage'
import { ChatMessage } from './ChatMessage'

const MIN_HEIGHT = 240
const MAX_HEIGHT = 420

const WORKGROUP_STYLES: Record<string, any> = {
  wrap: { display: 'grid', gap: 8, maxWidth: 720, margin: '2px auto 12px' },
  head: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '0 2px', color: 'var(--muted)' },
  card: { display: 'grid', gap: 6, padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8, background: 'linear-gradient(135deg,rgba(67,217,255,.055),rgba(163,107,255,.035))' },
  top: { display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', gap: 8, alignItems: 'center' },
  source: { padding: '2px 6px', border: '1px solid rgba(67,217,255,.28)', borderRadius: 5, color: 'var(--cyan)', fontSize: 9 },
  team: { display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' },
}

function relativeWorkTime(value: number): string {
  const delta = Date.now() - Number(value || 0)
  if (!Number.isFinite(delta) || delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))} 分钟前`
  if (delta < 86_400_000) return `${Math.max(1, Math.floor(delta / 3_600_000))} 小时前`
  return `${Math.max(1, Math.floor(delta / 86_400_000))} 天前`
}

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
  workgroups: WorkgroupFeed
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
  const { channels, channelId, onChannel, messages, staff, runningCalls, typingStaff, running, promptError, workgroups,
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
  const recentWorkgroups = !activeStaffId && visible.length === 0 && workgroups.available ? workgroups.sessions.slice(0, 3) : []

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
          recentWorkgroups.length ? h('div', { className: 'cy9-workgroups', style: WORKGROUP_STYLES.wrap },
            h('div', { className: 'cy9-workgroups-head', style: WORKGROUP_STYLES.head },
              h('b', { style: { color: 'var(--text)', fontSize: 11 } }, '持续工作组'),
              h('span', { style: { fontSize: 9 } }, 'host 持久档案 · 刷新页面也不会消失'),
            ),
            recentWorkgroups.map((group) => h('div', { key: group.id, className: `cy9-workgroup ${group.status}`, style: Object.assign({}, WORKGROUP_STYLES.card, group.status === 'blocked' ? { borderColor: 'rgba(255,111,134,.35)' } : {}) },
              h('div', { className: 'cy9-workgroup-top', style: WORKGROUP_STYLES.top },
                h('span', { className: 'cy9-workgroup-source', style: WORKGROUP_STYLES.source }, workgroupPlatformLabel(group.origin?.platform || group.origin?.source)),
                h('b', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 } }, clip(group.goal, 54)),
                h('time', { style: { color: 'var(--dim)', fontSize: 9 } }, relativeWorkTime(group.updatedAt)),
              ),
              h('div', { className: 'cy9-workgroup-team', style: WORKGROUP_STYLES.team },
                (group.participants || []).slice(0, 5).map((member) => h('span', { key: member.employeeId, style: { padding: '2px 5px', borderRadius: 5, background: 'rgba(255,255,255,.05)', color: '#cbd8eb', fontSize: 9 } }, member.employeeName)),
                h('em', { style: { marginLeft: 'auto', color: 'var(--dim)', fontSize: 9, fontStyle: 'normal' } }, `${group.turnCount || 0} 次员工交付 · ${group.messageCount || 0} 轮消息`),
              ),
              group.lastTurn?.reply ? h('p', { style: { margin: 0, color: 'var(--muted)', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, `${group.lastTurn.employeeName || '员工'}：${clip(group.lastTurn.reply, 100)}`) : null,
            )),
          ) : visible.length === 0 && !runningCalls?.length && !typingStaff ? h('div', { className: 'cy9-chat-empty' }, '工作群已连接当前 DSH 会话。直接在下方输入任务，系统会按任务内容自动拉合适的员工进工作组；输入 @姓名 可以锁定指定员工。') : null,
          visible.map((message) => h(ChatMessage, { key: message.id, message, staff, onOpenThread })),
          (runningCalls || []).map((call: any) => h('div', { key: call.callId, className: 'cy9-msg-tool running' },
            h('span', { className: 'cy9-msg-tool-icon' }, 'RUN'), h('span', { className: 'cy9-msg-tool-main' }, h('b', null, String(call.name || 'tool')), h('span', null, '正在执行真实工具…')),
          )),
          typingStaff ? h('div', { className: 'cy9-msg-typing' }, h(AssetImage, { src: staffThumb(typingStaff.id), alt: typingStaff.name, fallback: typingStaff.name }), `${typingStaff.name} 正在输入`, h('span', null, h('i'), h('i'), h('i'))) : running ? h('div', { className: 'cy9-msg-typing' }, '正在根据任务组队并推进工作', h('span', null, h('i'), h('i'), h('i'))) : null,
        ),
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
