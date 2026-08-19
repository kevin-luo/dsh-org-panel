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
import { buildSettingsActions, SOURCE_LABEL, useOrgPanel, useSessionEventChannel } from './company-bridge'
import { usePersistentGrowthRefresh } from './growth-snapshot-sync'
import { useRecentWorkgroups } from './work-sessions'
import { composerTextarea, joinDraft, scheduleFocus, writeDraft } from './composer'
import type { OrgPanelRpc } from './rpc'

const SNAPSHOT_REFRESH_PROMPT = '请调用 company_snapshot，返回完整实时 Company Snapshot。'
const SNAPSHOT_REFRESH_RESULT = ' 系统会返回实时 Company Snapshot，面板将用真实持久化数据刷新。'

export function CompanyView(props: any) {
  const useSession = props?.useSession
  const inputActions = props?.inputActions
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
  const [chatHeight, setChatHeight] = useState(260)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [zoomIdx, setZoomIdx] = useState(0)
  const [railOpen, setRailOpen] = useState(false)
  const [leftOpen, setLeftOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const pulseId = window.setInterval(() => setTick((value) => value + 1), 2400)
    const clockId = window.setInterval(() => setNow(new Date()), 1000)
    return () => { window.clearInterval(pulseId); window.clearInterval(clockId) }
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
  useSessionEventChannel(nodes, runningCalls, roles, staff)
  const orgPanel = useOrgPanel(nodes, rpc, settingsOpen)
  const workgroups = useRecentWorkgroups(rpc, `${messages.length}:${running ? 1 : 0}`)
  usePersistentGrowthRefresh(orgPanel.refresh)
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

  const draftComposer = (text: string, focus = true) => {
    setChatCollapsed(false)
    const next = joinDraft(composerTextarea()?.value || '', text)
    const route = writeDraft(inputActions, next)
    if (route === 'none' && typeof console !== 'undefined') console.warn('[dsh-org-panel] 草稿没写进去：宿主既没给 inputActions.setDraft，也没找到 [data-composer-seat] textarea')
    if (focus) scheduleFocus()
  }
  const toggleStaff = (staffId: string) => setActiveStaffId((current) => current === staffId ? null : staffId)
  const profileStaff = profileId ? staff.find((item) => item.id === profileId) || null : null

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
  const settingsActions = buildSettingsActions({
    channel: orgPanel.channel,
    rpc,
    refresh: async () => {
      const result = await orgPanel.refresh()
      if (result.ok) return result.message
      draftComposer(SNAPSHOT_REFRESH_PROMPT, false)
      return `${result.message}${SNAPSHOT_REFRESH_RESULT}`
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
      h('div', { className: `cy9-left-wrap${leftOpen ? ' open' : ''}`, style: leftOpen ? { transform: 'translateX(0)' } : undefined },
        h(EmployeeList, { staff, statuses, tasksMap, activeStaffId, tick, onSelect: (staffId: string) => { toggleStaff(staffId); setLeftOpen(false) }, onMention: (employee: StaffDef) => { draftComposer(`@${employee.name} `); setLeftOpen(false) } }),
      ),
      h('main', { className: 'cy9-center' },
        h(OfficeWorld, {
          staff, statuses, tasksMap, tick, snapshot, activeStaffId, zoomIdx,
          onZoom: setZoomIdx, onSelect: toggleStaff,
          onTalk: (employee: StaffDef) => draftComposer(`@${employee.name} `),
          onOpenProfile: setProfileId,
          onTrain: (employee: StaffDef) => draftComposer(`@${employee.name} 结合你的长期记忆、最近任务履历和真实技能证据，先盘点当前能力缺口；优先复用公司已安装插件和 DSH 社区能力。提出一个最值得练习的成长任务，说明要使用的真实工具/插件、成功标准和预期沉淀的技能证据。不要为了升级虚构执行结果。`),
        }),
        h(CollaborationPanel, {
          channels: DEFAULT_CHANNELS, channelId, onChannel: setChannelId, messages, staff, runningCalls, typingStaff, running, promptError, workgroups,
          activeStaffId, onClearStaffFilter: () => setActiveStaffId(null), collapsed: chatCollapsed, onToggleCollapsed: () => setChatCollapsed((value) => !value),
          height: chatHeight, onHeight: setChatHeight, thread, onOpenThread: setThread, onCloseThread: () => setThread(null),
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
