// 「赛博公司」公司设置中心（需求文档三十七）：员工 / 模型 / 插件 / 通讯 / 存储 / 安全。
// 本组件只做壳：分类导航 + 顶部状态 + 把 data/actions 分发给六个设置页。
// 数据全部由外部注入（真实 CompanySnapshot / Gateway / Plugin Runtime / Communication Manager），
// 组件内部不生成任何业务数据，缺数据就显示 0 / — / 暂无（需求文档四十八）。
import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { CompanySnapshot, PluginStatus } from '../../persistence/types'
import { installSettingsStyles, ActionButton, formatDateTime } from './styles'
import { EmployeeSettings, type EmployeeSettingsActions, type EmployeeSettingsData } from './EmployeeSettings'
import { ModelSettings, type ModelSettingsActions, type ModelSettingsData } from './ModelSettings'
import { PluginSettings, type InstalledPluginRow, type PluginSettingsActions, type PluginSettingsData } from './PluginSettings'
import { CommunicationSettings, type CommunicationSettingsActions, type CommunicationSettingsData } from './CommunicationSettings'
import { StorageSettings, type StorageSettingsActions, type StorageSettingsData } from './StorageSettings'
import { SecuritySettings, type SecuritySettingsActions, type SecuritySettingsData, type SecretInventoryRow } from './SecuritySettings'

export type SettingsSection = 'employees' | 'models' | 'plugins' | 'communication' | 'storage' | 'security'

export const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'employees', label: '员工' },
  { id: 'models', label: '模型' },
  { id: 'plugins', label: '插件' },
  { id: 'communication', label: '通讯' },
  { id: 'storage', label: '存储' },
  { id: 'security', label: '安全' },
]

export type CompanySettingsData = {
  companyName?: string
  /** 数据快照生成时间，让老板知道自己看的是什么时候的状态。 */
  generatedAt?: number
  /**
   * 这一屏数据的真实来源（host 实时读取 / 本会话工具结果 / 本机缓存）。
   * 降级必须上屏：老板有权知道自己看的是不是此刻的状态。
   */
  source?: string
  loading?: boolean
  error?: string | null
  employees?: EmployeeSettingsData
  models?: ModelSettingsData
  plugins?: PluginSettingsData
  communication?: CommunicationSettingsData
  storage?: StorageSettingsData
  security?: SecuritySettingsData
}

export type CompanySettingsActions = {
  refresh?(): unknown | Promise<unknown>
  employees?: EmployeeSettingsActions
  models?: ModelSettingsActions
  plugins?: PluginSettingsActions
  communication?: CommunicationSettingsActions
  storage?: StorageSettingsActions
  security?: SecuritySettingsActions
}

const PLUGIN_SEVERITY: Record<PluginStatus, number> = { available: 0, disabled: 1, degraded: 2, missing: 3 }

/**
 * 从通讯摘要里取「员工之间自动转交上限」的真实生效值，转成安全页认识的两个字段。
 * summary().maxEmployeeHops 在一个渠道都没有时会回落到代码里的缺省常量，
 * 那个数不是任何渠道真实生效的上限，必须打上 hopsFallback 标记，让 UI 显示成「未知（缺省 N 次）」。
 */
export function summaryHops(summary?: CommunicationSettingsData): { maxEmployeeHops?: number; hopsFallback?: boolean } {
  if (!summary || !Array.isArray(summary.adapters)) return {}
  const hops = summary.maxEmployeeHops
  if (typeof hops !== 'number' || !Number.isFinite(hops)) return {}
  return { maxEmployeeHops: hops, hopsFallback: summary.adapters.length === 0 }
}

/** 导航上的角标：没下发就不写数字，一个「0」会被老板读成「真的一个都没有」。 */
function navCount(value: unknown[] | undefined): string {
  return Array.isArray(value) ? String(value.length) : ''
}

function mergeSection<T extends object>(base: T | undefined, extra: T | undefined): T | undefined {
  if (!extra) return base
  if (!base) return extra
  return Object.assign({}, base, extra)
}

/**
 * 把 Phase 2 的 CompanySnapshot 直接映射成设置中心数据：员工、模型、已安装插件、存储计数、密钥清单。
 * 这里只做「搬运 + 聚合」，不补任何字段；host 有更细的数据（审批记录 / 通讯 / 磁盘占用）时通过 extra 覆盖。
 */
export function settingsDataFromSnapshot(snapshot: CompanySnapshot | null | undefined, extra?: CompanySettingsData): CompanySettingsData {
  if (!snapshot) {
    if (!extra) return {}
    // 没有快照也照样把通讯摘要里的真实转交上限接给安全页；接不到就一个字都不填。
    const only = summaryHops(extra.communication)
    return Object.keys(only).length ? Object.assign({}, extra, { security: Object.assign({}, extra.security, only) }) : extra
  }
  const providers = snapshot.models || []
  const employees = snapshot.employees || []
  const installed = new Map<string, InstalledPluginRow>()
  for (const employee of employees) {
    for (const plugin of employee.plugins || []) {
      const current = installed.get(plugin.pluginId)
      if (!current) { installed.set(plugin.pluginId, Object.assign({}, plugin, { employees: [employee.name] })); continue }
      current.employees = [...(current.employees || []), employee.name]
      if (PLUGIN_SEVERITY[plugin.status] > PLUGIN_SEVERITY[current.status]) current.status = plugin.status
      if (plugin.lastVerifiedAt > current.lastVerifiedAt) current.lastVerifiedAt = plugin.lastVerifiedAt
    }
  }
  const secrets: SecretInventoryRow[] = providers
    .filter((provider) => !!provider.apiKeyRef)
    .map((provider) => ({ ref: String(provider.apiKeyRef), configured: provider.apiKeyConfigured, usedBy: `模型 ${provider.id}` }))
  // 安全页的「员工之间自动转交上限」与通讯页必须是同一个真实生效值（CommunicationManager.summary()）。
  // 拿不到摘要就一个字都不填 —— SecuritySettings 会显示「未知」，而不是替配置显示一个好看的默认值。
  const summary = extra?.communication
  const hops = summaryHops(summary)
  const base: CompanySettingsData = {
    companyName: snapshot.companyName,
    generatedAt: snapshot.generatedAt,
    employees: {
      loaded: true,
      employees: employees.map((employee) => ({
        id: employee.employeeId,
        name: employee.name,
        role: employee.role,
        department: employee.department,
        level: employee.level?.level,
        xp: employee.xp,
        models: employee.models,
        plugins: employee.plugins,
        stats: {
          tasks: employee.statistics?.totalTasks,
          memories: employee.statistics?.memoryCount,
          skills: employee.statistics?.skillCount,
          evidence: employee.statistics?.evidenceCount,
          lastActiveAt: employee.statistics?.lastActiveAt,
        },
      })),
      providers: providers.map((provider) => ({ id: provider.id, type: provider.type, model: provider.model, enabled: provider.enabled })),
    },
    models: {
      loaded: true,
      providers: providers.map((provider) => Object.assign({}, provider)),
      employees: employees.map((employee) => ({ id: employee.employeeId, name: employee.name, role: employee.role, bindings: employee.models })),
    },
    plugins: { loaded: true, installed: [...installed.values()] },
    storage: {
      employees: snapshot.totals?.employees,
      memories: snapshot.totals?.memories,
      tasks: snapshot.totals?.tasks,
      skills: snapshot.totals?.skills,
    },
    security: Object.assign({ secrets }, hops),
  }
  if (!extra) return base
  return Object.assign({}, base, extra, {
    employees: mergeSection(base.employees, extra.employees),
    models: mergeSection(base.models, extra.models),
    plugins: mergeSection(base.plugins, extra.plugins),
    communication: mergeSection(base.communication, extra.communication),
    storage: mergeSection(base.storage, extra.storage),
    security: mergeSection(base.security, extra.security),
  })
}

export function CompanySettings(props: {
  open?: boolean
  section?: SettingsSection
  data?: CompanySettingsData
  actions?: CompanySettingsActions
  onSection?: (section: SettingsSection) => void
  onClose: () => void
  onRefresh?: () => void
}) {
  const { data, actions, onClose } = props
  const [innerSection, setInnerSection] = useState<SettingsSection>('employees')
  const section = props.section || innerSection
  const setSection = (next: SettingsSection) => { setInnerSection(next); props.onSection?.(next) }
  const refresh = props.onRefresh || (actions?.refresh ? () => { void actions.refresh!() } : undefined)
  useMemo(() => installSettingsStyles(), [])
  useEffect(() => {
    if (props.open === false || typeof document === 'undefined') return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [props.open, onClose])
  if (props.open === false) return null

  const counts: Record<SettingsSection, string> = {
    employees: navCount(data?.employees?.employees),
    models: navCount(data?.models?.providers),
    plugins: navCount(data?.plugins?.installed),
    communication: Array.isArray(data?.communication?.adapters) ? String(data!.communication!.adapters!.filter((item) => item.state === 'connected').length) : '',
    storage: '',
    security: navCount(data?.security?.secrets),
  }

  return h('div', { className: 'cy9-set-overlay', onClick: onClose },
    h('div', { className: 'cy9-set', role: 'dialog', 'aria-modal': 'true', 'aria-label': '公司设置', onClick: (event: any) => event.stopPropagation() },
      h('div', { className: 'cy9-set-head' },
        h('div', { className: 'cy9-set-head-copy' },
          h('b', null, '公司设置'),
          h('span', { title: data?.source }, [
            data?.companyName || '赛博公司',
            data?.source || '',
            data?.generatedAt ? `数据时间 ${formatDateTime(data.generatedAt)}` : '尚未加载持久化快照',
          ].filter(Boolean).join(' · ')),
        ),
        h(ActionButton, { label: '刷新', busyLabel: '读取中…', run: actions?.refresh ? (() => actions.refresh!()) : undefined, hint: '当前运行时未提供设置数据读取能力' }),
        h('button', { type: 'button', className: 'cy9-set-close', onClick: onClose, title: '关闭（Esc）' }, '✕'),
      ),
      h('div', { className: 'cy9-set-body' },
        h('nav', { className: 'cy9-set-nav' },
          h('div', { className: 'cy9-set-nav-label' }, '公司设置'),
          SETTINGS_SECTIONS.map((item) => h('button', {
            key: item.id, type: 'button', className: section === item.id ? 'on' : '', onClick: () => setSection(item.id),
          }, item.label, counts[item.id] ? h('em', null, counts[item.id]) : null)),
        ),
        h('div', { className: 'cy9-set-scroll' },
          data?.error || data?.loading ? h('div', { className: 'cy9-set-alerts' },
            data?.error ? h('div', { className: 'cy9-set-banner bad' }, data.error) : null,
            data?.loading ? h('div', { className: 'cy9-set-banner info' }, '正在读取真实公司数据…') : null,
          ) : null,
          section === 'employees' ? h(EmployeeSettings, { data: data?.employees, actions: actions?.employees, onRefresh: refresh }) : null,
          section === 'models' ? h(ModelSettings, { data: data?.models, actions: actions?.models, onRefresh: refresh }) : null,
          section === 'plugins' ? h(PluginSettings, { data: data?.plugins, actions: actions?.plugins, onRefresh: refresh }) : null,
          section === 'communication' ? h(CommunicationSettings, { data: data?.communication, actions: actions?.communication, onRefresh: refresh }) : null,
          section === 'storage' ? h(StorageSettings, { data: data?.storage, actions: actions?.storage, onRefresh: refresh }) : null,
          section === 'security' ? h(SecuritySettings, { data: data?.security, actions: actions?.security, onRefresh: refresh }) : null,
        ),
      ),
    ),
  )
}
