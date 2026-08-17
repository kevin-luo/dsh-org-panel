// 「赛博公司」client-v9 根组件：三栏布局 + 真实会话数据编排。
// 数据层复用 selectors / messages，不重写已验证的业务逻辑。
import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import type { CompanyMessage, OrgPanelConfig, StaffDef } from './types'
import { DEFAULT_CHANNELS } from './types'
import { buildCompanyStatuses, extractDelegations, latestDirectEmployee, nodeTime, roleOf } from './selectors'
import { buildCompanyMessages, extractGrowthEvents, extractMarketPlugins, extractSkillQueue } from './messages'
import { staffPortrait, onAssetBaseChange } from './asset-map'
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
    h('div', { className: 'cy9-profile', onClick: (event: any) => event.stopPropagation() },
      h('button', { type: 'button', className: 'cy9-profile-close', onClick: onClose }, '✕'),
      h('div', { className: 'cy9-profile-head' },
        h('img', { src: staffPortrait(staff.id), alt: staff.name }),
        h('div', null,
          h('b', null, staff.name),
          h('span', null, `${staff.role} · ${staff.department || '赛博公司'}`),
          h('p', null, staff.intro),
        ),
      ),
      h('div', { className: 'cy9-profile-section' },
        h('label', null, '岗位能力'),
        h('div', { className: 'cy9-profile-chips' },
          (role.skills || []).map((skill) => h('span', { key: skill.name, title: skill.desc }, skill.name))),
      ),
      h('div', { className: 'cy9-profile-section' },
        h('label', null, '常用工具方向'),
        h('div', { className: 'cy9-profile-chips' },
          (role.tools || []).slice(0, 8).map((tool) => h('span', { key: tool, className: 'mono' }, tool))),
      ),
      h('div', { className: 'cy9-profile-actions' },
        h('button', { type: 'button', onClick: () => { onTalk(staff); onClose() } }, `@${staff.name} 派活`),
        h('button', {
          type: 'button',
          onClick: () => {
            onDraft(`查看 ${staff.name} 的成长档案：等级、最近长期记忆、技能熟练度、成功与失败经验。`)
            onClose()
          },
        }, '查看成长档案'),
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
  const [chatHeight, setChatHeight] = useState(310)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [zoomIdx, setZoomIdx] = useState(0)
  const [railOpen, setRailOpen] = useState(false)
  // 资产 base 可能在 probe 后才确定，命中时立即重渲染刷新全部图片。
  const [, setAssetVersion] = useState(0)

  useEffect(() => onAssetBaseChange(() => setAssetVersion((value) => value + 1)), [])

  useEffect(() => {
    const walkId = window.setInterval(() => setTick((value) => value + 1), 2000)
    const clockId = window.setInterval(() => setNow(new Date()), 1000)
    return () => { window.clearInterval(walkId); window.clearInterval(clockId) }
  }, [])

  const useSessionSafe = typeof useSession === 'function' ? useSession : () => undefined
  const nodes = useSessionSafe((s: any) => s?.nodes) || []
  const runningCalls = useSessionSafe((s: any) => s?.runningCalls) || []
  const partial = useSessionSafe((s: any) => s?.partial)
  const running = !!useSessionSafe((s: any) => s?.running)
  const promptError = useSessionSafe((s: any) => s?.promptError)

  const delegations = useMemo(() => extractDelegations(nodes, runningCalls, roles, staff), [nodes, runningCalls, roles, staff])
  const { statuses, tasksMap } = useMemo(() => buildCompanyStatuses(staff, delegations, running), [staff, delegations, running])
  const messages = useMemo(() => buildCompanyMessages(nodes, staff), [nodes, staff])
  const growth = useMemo(() => extractGrowthEvents(nodes, staff), [nodes, staff])
  const skills = useMemo(() => extractSkillQueue(nodes, runningCalls, staff), [nodes, runningCalls, staff])
  const plugins = useMemo(() => extractMarketPlugins(nodes), [nodes])
  const typingStaff = useMemo(() => (partial ? latestDirectEmployee(nodes, staff) : null), [partial, nodes, staff])

  const counts = useMemo(() => {
    let runningCount = 0, doneCount = 0, waitCount = 0, idleCount = 0
    for (const item of staff) {
      const status = statuses[item.id] || 'idle'
      if (status === 'running') runningCount++
      else if (status === 'done') doneCount++
      else if (status === 'wait') waitCount++
      else idleCount++
    }
    return { running: runningCount, done: doneCount, wait: waitCount, idle: idleCount }
  }, [staff, statuses])

  const since = useMemo(() => {
    const first = nodes?.[0]
    return first ? nodeTime(first) : null
  }, [nodes])

  const draftComposer = (text: string) => {
    if (inputActions && typeof inputActions.setDraft === 'function') inputActions.setDraft(text)
    window.requestAnimationFrame(() => {
      const scroll = rootRef.current?.closest('[data-conversation-scroll]')
      const input = scroll?.querySelector('[data-composer-seat] textarea') as HTMLTextAreaElement | null
      input?.focus()
    })
  }

  // 群聊发送：优先尝试原生提交能力，兜底写入原生输入框草稿并聚焦（与 v2 行为一致）。
  const sendChat = (text: string) => {
    const actions: any = inputActions
    for (const method of ['submitDraft', 'submit', 'send', 'prompt'] as const) {
      if (actions && typeof actions[method] === 'function') {
        try {
          actions[method](text)
          return
        } catch { /* 回退到草稿模式 */ }
      }
    }
    draftComposer(text)
  }

  const toggleStaff = (staffId: string) => setActiveStaffId((current) => (current === staffId ? null : staffId))
  const profileStaff = profileId ? staff.find((item: StaffDef) => item.id === profileId) || null : null

  const stats = {
    total: staff.length,
    online: staff.length - counts.idle,
    running: counts.running,
    done: counts.done,
    wait: counts.wait,
    idle: counts.idle,
    since,
  }

  return h('div', { className: 'cy9', ref: rootRef },
    h(CompanyHeader, {
      companyName: config.companyName || '赛博公司 · AI 员工总部',
      stats, now,
      onMarket: () => draftComposer('@大壮 去 DSH 社区插件市场搜索适合当前公司和各岗位的新插件。列出插件用途、stars、风险、仓库与安装命令；不要安装，等我批准。'),
    }),
    h('div', { className: 'cy9-body' },
      h(EmployeeList, {
        staff, statuses, tasksMap, activeStaffId, tick,
        onSelect: toggleStaff,
      }),
      h('main', { className: 'cy9-center' },
        h(OfficeWorld, {
          staff, statuses, tasksMap, tick, activeStaffId, zoomIdx,
          onZoom: setZoomIdx,
          onSelect: toggleStaff,
          onTalk: (employee: StaffDef) => draftComposer(`@${employee.name} `),
          onOpenProfile: setProfileId,
        }),
        h(CollaborationPanel, {
          channels: DEFAULT_CHANNELS, channelId, onChannel: setChannelId,
          messages, staff, runningCalls, typingStaff, running, promptError,
          activeStaffId, onClearStaffFilter: () => setActiveStaffId(null),
          collapsed: chatCollapsed, onToggleCollapsed: () => setChatCollapsed((value) => !value),
          height: chatHeight, onHeight: setChatHeight,
          onSend: sendChat,
          onOpenThread: setThread,
        }),
      ),
      h(RightRail, {
        staff, stats, delegations, growth, skills, plugins, thread,
        sessionRunning: running, now: now.getTime(),
        open: railOpen,
        onClose: () => setRailOpen(false),
        onCloseThread: () => setThread(null),
        onDraft: draftComposer,
      }),
    ),
    h('button', {
      type: 'button',
      className: 'cy9-rail-toggle',
      onClick: () => setRailOpen((value) => !value),
      title: '公司经营面板',
    }, '📊'),
    profileStaff ? h(StaffProfile, {
      staff: profileStaff, config,
      onClose: () => setProfileId(null),
      onTalk: (employee: StaffDef) => draftComposer(`@${employee.name} `),
      onDraft: draftComposer,
    }) : null,
  )
}
