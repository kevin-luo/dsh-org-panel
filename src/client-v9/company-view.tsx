import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import type { CompanyMessage, OrgPanelConfig, StaffDef } from './types'
import { DEFAULT_CHANNELS } from './types'
import { buildCompanyStatuses, extractDelegations, latestDirectEmployee, nodeTime, roleOf } from './selectors'
import { buildCompanyMessages, extractGrowthEvents, extractMarketPlugins, extractSkillQueue } from './messages'
import { staffProfile } from './asset-map'
import { AssetImage } from './components/AssetImage'
import { CompanyHeader } from './components/CompanyHeader'
import { EmployeeList } from './components/EmployeeList'
import { OfficeWorld } from './components/OfficeWorld'
import { CollaborationPanel } from './components/CollaborationPanel'
import { RightRail } from './components/RightRail'

function StaffProfile(props: {
  staff: StaffDef
  config: OrgPanelConfig
  onClose: () => void
  onTalk: (staff: StaffDef) => void
  onDraft: (text: string) => void
}) {
  const { staff, config, onClose, onTalk, onDraft } = props
  const role = roleOf(staff.roleId, config.roles || [])
  return h('div', { className: 'cy9-profile-overlay', onClick: onClose },
    h('div', { className: 'cy9-profile', role: 'dialog', 'aria-modal': 'true', onClick: (event: any) => event.stopPropagation() },
      h('button', { type: 'button', className: 'cy9-profile-close', onClick: onClose }, '关闭'),
      h('div', { className: 'cy9-profile-head' },
        h(AssetImage, { src: staffProfile(staff.id), alt: staff.name, fallback: staff.name }),
        h('div', null, h('b', null, staff.name), h('span', null, `${staff.role} · ${staff.department || '赛博公司'}`), h('p', null, staff.intro)),
      ),
      h('div', { className: 'cy9-profile-section' }, h('label', null, '岗位能力'), h('div', { className: 'cy9-profile-chips' }, (role.skills || []).map((skill) => h('span', { key: skill.name, title: skill.desc }, skill.name)))),
      h('div', { className: 'cy9-profile-section' }, h('label', null, '常用工具'), h('div', { className: 'cy9-profile-chips' }, (role.tools || []).slice(0, 8).map((tool) => h('span', { key: tool, className: 'mono' }, tool)))),
      h('div', { className: 'cy9-profile-actions' },
        h('button', { type: 'button', onClick: () => { onTalk(staff); onClose() } }, `@${staff.name} 直接对话`),
        h('button', { type: 'button', onClick: () => { onDraft(`查看 ${staff.name} 的成长档案：等级、长期记忆、技能熟练度和最近经验。`); onClose() } }, '查看成长档案'),
      ),
    ),
  )
}

export function CompanyView(props: any) {
  const useSession = props?.useSession
  const inputActions = props?.inputActions
  const config: OrgPanelConfig = props?.config || {}
  const staff = config.staff || []
  const roles = config.roles || []
  const rootRef = useRef<HTMLDivElement>(null)
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState(() => new Date())
  const [channelId, setChannelId] = useState('general')
  const [activeStaffId, setActiveStaffId] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [thread, setThread] = useState<CompanyMessage | null>(null)
  const [chatHeight, setChatHeight] = useState(300)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [chatDraft, setChatDraft] = useState('')
  const [zoomIdx, setZoomIdx] = useState(0)
  const [railOpen, setRailOpen] = useState(false)
  const [leftOpen, setLeftOpen] = useState(false)

  useEffect(() => {
    const walkId = window.setInterval(() => setTick((value) => value + 1), 2400)
    const clockId = window.setInterval(() => setNow(new Date()), 1000)
    return () => { window.clearInterval(walkId); window.clearInterval(clockId) }
  }, [])

  // Hide only the host DSH composer while this conversation tab is mounted.
  useEffect(() => {
    let hiddenSeat: Element | null = null
    let attempts = 0
    const apply = () => {
      attempts += 1
      const seat = document.querySelector('[data-composer-seat]')
      if (seat && !rootRef.current?.contains(seat)) {
        hiddenSeat = seat
        hiddenSeat.classList.add('cy9-native-composer-hidden')
        return true
      }
      return attempts > 20
    }
    if (apply()) return () => hiddenSeat?.classList.remove('cy9-native-composer-hidden')
    const id = window.setInterval(() => { if (apply()) window.clearInterval(id) }, 120)
    return () => { window.clearInterval(id); hiddenSeat?.classList.remove('cy9-native-composer-hidden') }
  }, [])

  const useSessionSafe = typeof useSession === 'function' ? useSession : () => undefined
  const nodes = useSessionSafe((state: any) => state?.nodes) || []
  const runningCalls = useSessionSafe((state: any) => state?.runningCalls) || []
  const partial = useSessionSafe((state: any) => state?.partial)
  const running = !!useSessionSafe((state: any) => state?.running)
  const promptError = useSessionSafe((state: any) => state?.promptError)
  const delegations = useMemo(() => extractDelegations(nodes, runningCalls, roles, staff), [nodes, runningCalls, roles, staff])
  const { statuses, tasksMap } = useMemo(() => buildCompanyStatuses(staff, delegations, running), [staff, delegations, running])
  const messages = useMemo(() => buildCompanyMessages(nodes, staff), [nodes, staff])
  const growth = useMemo(() => extractGrowthEvents(nodes, staff), [nodes, staff])
  const skills = useMemo(() => extractSkillQueue(nodes, runningCalls, staff), [nodes, runningCalls, staff])
  const plugins = useMemo(() => extractMarketPlugins(nodes), [nodes])
  const typingStaff = useMemo(() => partial ? latestDirectEmployee(nodes, staff) : null, [partial, nodes, staff])
  const counts = useMemo(() => {
    let runningCount = 0, doneCount = 0, waitCount = 0, idleCount = 0
    for (const item of staff) {
      const status = statuses[item.id] || 'idle'
      if (status === 'running') runningCount += 1
      else if (status === 'done') doneCount += 1
      else if (status === 'wait') waitCount += 1
      else idleCount += 1
    }
    return { running: runningCount, done: doneCount, wait: waitCount, idle: idleCount }
  }, [staff, statuses])
  const since = useMemo(() => nodes?.[0] ? nodeTime(nodes[0]) : null, [nodes])

  const draftComposer = (text: string) => {
    setChatCollapsed(false)
    setChatDraft(text)
    window.requestAnimationFrame(() => rootRef.current?.querySelector<HTMLTextAreaElement>('[data-cy9-composer]')?.focus())
  }
  const sendChat = (text: string) => {
    const actions: any = inputActions
    // Official DSH InputActions contract: write the machine draft first, then submit it.
    if (actions && typeof actions.setDraft === 'function' && typeof actions.submit === 'function') {
      try {
        actions.setDraft(text)
        actions.submit()
        return
      } catch { /* fall through to compatibility methods */ }
    }
    for (const method of ['send', 'prompt'] as const) {
      if (actions && typeof actions[method] === 'function') {
        try { actions[method](text); return } catch { /* no-op */ }
      }
    }
    if (actions && typeof actions.setDraft === 'function') actions.setDraft(text)
  }
  const toggleStaff = (staffId: string) => setActiveStaffId((current) => current === staffId ? null : staffId)
  const profileStaff = profileId ? staff.find((item) => item.id === profileId) || null : null
  const stats = { total: staff.length, online: staff.length - counts.idle, running: counts.running, done: counts.done, wait: counts.wait, idle: counts.idle, since }

  return h('div', { className: 'cy9', ref: rootRef },
    h(CompanyHeader, { companyName: config.companyName || '赛博公司 · AI 员工总部', stats, now, onMarket: () => draftComposer('@大壮 去 DSH 插件市场搜索适合当前团队的新能力，列出用途、风险、仓库和安装命令；不要安装。') }),
    h('div', { className: 'cy9-body' },
      h('div', {
        className: `cy9-left-wrap${leftOpen ? ' open' : ''}`,
        style: leftOpen ? { transform: 'translateX(0)' } : undefined,
      },
        h(EmployeeList, {
          staff, statuses, tasksMap, activeStaffId, tick,
          onSelect: (staffId: string) => { toggleStaff(staffId); setLeftOpen(false) },
          onMention: (employee: StaffDef) => { draftComposer(`@${employee.name} `); setLeftOpen(false) },
        }),
      ),
      h('main', { className: 'cy9-center' },
        h(OfficeWorld, { staff, statuses, tasksMap, tick, activeStaffId, zoomIdx, onZoom: setZoomIdx, onSelect: toggleStaff, onTalk: (employee: StaffDef) => draftComposer(`@${employee.name} `), onOpenProfile: setProfileId }),
        h(CollaborationPanel, {
          channels: DEFAULT_CHANNELS, channelId, onChannel: setChannelId, messages, staff, runningCalls, typingStaff, running, promptError,
          activeStaffId, onClearStaffFilter: () => setActiveStaffId(null), collapsed: chatCollapsed, onToggleCollapsed: () => setChatCollapsed((value) => !value),
          height: chatHeight, onHeight: setChatHeight, draft: chatDraft, onDraft: setChatDraft, onSend: sendChat,
          thread, onOpenThread: setThread, onCloseThread: () => setThread(null),
        }),
      ),
      h(RightRail, { staff, stats, delegations, growth, skills, plugins, sessionRunning: running, now: now.getTime(), open: railOpen, onClose: () => setRailOpen(false), onDraft: draftComposer }),
    ),
    h('button', { type: 'button', className: 'cy9-staff-toggle', onClick: () => setLeftOpen((value) => !value), title: '打开员工通讯录' }, '员工'),
    h('button', { type: 'button', className: 'cy9-rail-toggle', onClick: () => setRailOpen((value) => !value), title: '打开经营侧栏' }, '经营'),
    profileStaff ? h(StaffProfile, { staff: profileStaff, config, onClose: () => setProfileId(null), onTalk: (employee: StaffDef) => draftComposer(`@${employee.name} `), onDraft: draftComposer }) : null,
  )
}
