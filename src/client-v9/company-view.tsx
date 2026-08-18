import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { CompanyMessage, OrgPanelConfig, StaffDef } from './types'
import { DEFAULT_CHANNELS } from './types'
import { buildCompanyStatuses, extractDelegations, latestDirectEmployee, nodeTime } from './selectors'
import { buildCompanyMessages, extractGrowthEvents, extractMarketPlugins, extractSkillQueue } from './messages'
import { CompanyHeader } from './components/CompanyHeader'
import { EmployeeList } from './components/EmployeeList'
import { OfficeWorld } from './components/OfficeWorld'
import { CollaborationPanel } from './components/CollaborationPanel'
import { RightRail } from './components/RightRail'
import { EmployeeProfile } from './employee-profile/EmployeeProfile'
import { CompanySettings, settingsDataFromSnapshot } from './settings/CompanySettings'
import { REFRESH_PROMPT, REFRESH_RESULT, useCompanyHydration, useSessionEventChannel } from './company-bridge'

export function CompanyView(props: any) {
  const useSession = props?.useSession
  const inputActions = props?.inputActions
  const config: OrgPanelConfig = props?.config || {}
  const staff = config.staff || []
  const roles = config.roles || []
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState(() => new Date())
  const [channelId, setChannelId] = useState('general')
  const [activeStaffId, setActiveStaffId] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [thread, setThread] = useState<CompanyMessage | null>(null)
  const [chatHeight, setChatHeight] = useState(260) // 文档四十六条视觉权重：办公室仍是第一视觉，工作群约占中栏三分之一
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [zoomIdx, setZoomIdx] = useState(0)
  const [railOpen, setRailOpen] = useState(false)
  const [leftOpen, setLeftOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const walkId = window.setInterval(() => setTick((value) => value + 1), 2400)
    const clockId = window.setInterval(() => setNow(new Date()), 1000)
    return () => { window.clearInterval(walkId); window.clearInterval(clockId) }
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
  // 会话节点流 → Company Event Bus：办公室 / 右栏 / 员工档案统一从总线读实时状态。
  useSessionEventChannel(nodes, runningCalls, roles, staff)
  // 持久化快照 hydrate：本 Session 跑过 company_snapshot 就用它，否则用上次缓存的同一份真实数据。
  const { snapshot } = useCompanyHydration(nodes)
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

  // 全局唯一的「插入 @员工」出口：只写 DSH 官方草稿（InputActions.setDraft），再把焦点交还原生 Composer。
  // 绝不调用 submit —— 发不发、怎么改，由老板在原生输入框里决定。
  const draftComposer = (text: string) => {
    setChatCollapsed(false)
    const actions: any = inputActions
    if (actions && typeof actions.setDraft === 'function') {
      try { actions.setDraft(text) } catch { /* 草稿写入失败时也照样聚焦，让老板自己补内容 */ }
    }
    // 只读定位原生 Composer 的 textarea（seat 是赛博公司 Tab 的同级兄弟节点），不做任何 DOM 搬运。
    window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-composer-seat] textarea')?.focus())
  }
  const toggleStaff = (staffId: string) => setActiveStaffId((current) => current === staffId ? null : staffId)
  const profileStaff = profileId ? staff.find((item) => item.id === profileId) || null : null

  // 设置中心数据：全部来自真实快照 + 本会话真实搜索到的市场插件。
  // 没有 host 写通道的那些能力（测试连接 / 审批 / 导出备份）不传 action，
  // CompanySettings 会把按钮禁用并在 title 里说明原因，绝不假装成功。
  const settingsData = useMemo(() => settingsDataFromSnapshot(snapshot, {
    companyName: config.companyName,
    plugins: { market: plugins },
  }), [snapshot, plugins, config.companyName])
  // 不用 useMemo：draftComposer 每次渲染都会重建，缓存住会闭包到旧的 inputActions。
  const settingsActions = {
    refresh: () => { draftComposer(REFRESH_PROMPT); return REFRESH_RESULT },
    employees: { openProfile: (employeeId: string) => { setSettingsOpen(false); setProfileId(employeeId) } },
  }
  const stats = { total: staff.length, online: staff.length - counts.idle, running: counts.running, done: counts.done, wait: counts.wait, idle: counts.idle, since }

  return h('div', { className: 'cy9' },
    h(CompanyHeader, {
      companyName: config.companyName || '赛博公司 · AI 员工总部', stats, now,
      onMarket: () => draftComposer('@大壮 去 DSH 插件市场搜索适合当前团队的新能力，列出用途、风险、仓库和安装命令；不要安装。'),
      onSettings: () => setSettingsOpen(true),
    }),
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
          height: chatHeight, onHeight: setChatHeight,
          thread, onOpenThread: setThread, onCloseThread: () => setThread(null),
        }),
      ),
      h(RightRail, { staff, stats, delegations, growth, skills, plugins, sessionRunning: running, now: now.getTime(), open: railOpen, onClose: () => setRailOpen(false), onDraft: draftComposer, onOpenProfile: setProfileId }),
    ),
    h('button', { type: 'button', className: 'cy9-staff-toggle', onClick: () => setLeftOpen((value) => !value), title: '打开员工通讯录' }, '员工'),
    h('button', { type: 'button', className: 'cy9-rail-toggle', onClick: () => setRailOpen((value) => !value), title: '打开经营侧栏' }, '经营'),
    profileStaff ? h(EmployeeProfile, { staff: profileStaff, config, onClose: () => setProfileId(null), onTalk: (employee: StaffDef) => draftComposer(`@${employee.name} `), onDraft: draftComposer }) : null,
    settingsOpen ? h(CompanySettings, { open: true, data: settingsData, actions: settingsActions, onClose: () => setSettingsOpen(false) }) : null,
  )
}
