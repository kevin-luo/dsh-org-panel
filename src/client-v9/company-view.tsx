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
import { buildSettingsActions, REFRESH_PROMPT, REFRESH_RESULT, SOURCE_LABEL, useOrgPanel, useSessionEventChannel } from './company-bridge'
import type { OrgPanelRpc } from './rpc'

export function CompanyView(props: any) {
  const useSession = props?.useSession
  const inputActions = props?.inputActions
  // client→host 的 `/org-panel` 调用器（client-v9/index.tsx 从 ctx.get('connection') 取）。
  // 没有就是 null：所有写操作不下发，设置页照旧禁用并说明原因。
  const rpc: OrgPanelRpc | null = props?.rpc || null
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
  // 持久化快照 hydrate + 设置中心数据，三级优先级：`/org-panel` RPC > 本 Session 快照 > 本机缓存。
  const orgPanel = useOrgPanel(nodes, rpc, settingsOpen)
  const snapshot = orgPanel.snapshot
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
  // focus=false 用于弹窗还开着的场景：把焦点移到弹窗背后的 textarea 会让老板以为界面卡了。
  const draftComposer = (text: string, focus = true) => {
    setChatCollapsed(false)
    const actions: any = inputActions
    if (actions && typeof actions.setDraft === 'function') {
      try { actions.setDraft(text) } catch { /* 草稿写入失败时也照样聚焦，让老板自己补内容 */ }
    }
    if (!focus) return
    // 只读定位原生 Composer 的 textarea（seat 是赛博公司 Tab 的同级兄弟节点），不做任何 DOM 搬运。
    window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-composer-seat] textarea')?.focus())
  }
  const toggleStaff = (staffId: string) => setActiveStaffId((current) => current === staffId ? null : staffId)
  const profileStaff = profileId ? staff.find((item) => item.id === profileId) || null : null

  // 设置中心数据：真实快照 + `/org-panel` 读回来的真实台账 + 本会话真实搜索到的市场插件。
  // 依然没有写通道的那些能力（测试连接 / 导出备份 / 渠道启停）不传 action，
  // CompanySettings 会把按钮禁用并在 title 里说明原因，绝不假装成功。
  // 数据来源必须上屏：降级了就说降级了，别让老板对着一屏「未知」自己猜原因。
  const sourceText = orgPanel.channel === 'offline'
    ? `${SOURCE_LABEL[orgPanel.source]} · host 未提供 /org-panel 频道，面板读不到实时台账`
    : orgPanel.source === 'none' ? undefined : SOURCE_LABEL[orgPanel.source]
  const settingsData = useMemo(() => settingsDataFromSnapshot(snapshot, Object.assign({}, orgPanel.extra, {
    companyName: config.companyName,
    source: sourceText,
    loading: orgPanel.loading,
    error: orgPanel.error,
    plugins: Object.assign({ market: plugins, channelProbing: orgPanel.channel === 'unknown' }, orgPanel.extra.plugins),
  })), [snapshot, plugins, config.companyName, sourceText, orgPanel.extra, orgPanel.loading, orgPanel.error, orgPanel.channel])
  // 不用 useMemo：draftComposer 每次渲染都会重建，缓存住会闭包到旧的 inputActions。
  const settingsActions = buildSettingsActions({
    channel: orgPanel.channel,
    rpc,
    // 刷新优先走 RPC；通道不通时退回「把指令写进原生 Composer 草稿」这条老路，
    // 并如实说明为什么走了降级路径。弹窗开着，所以不抢焦点。
    refresh: async () => {
      const result = await orgPanel.refresh()
      if (result.ok) return result.message
      draftComposer(REFRESH_PROMPT, false)
      return `${result.message}${REFRESH_RESULT}`
    },
    openProfile: (employeeId: string) => { setSettingsOpen(false); setProfileId(employeeId) },
  })
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
