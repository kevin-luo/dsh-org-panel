// 「赛博公司」公司设置中心：员工 / 模型 / 插件 / 通讯 / 存储 / 安全。
// 数据全部由真实 CompanySnapshot / Runtime 摘要注入；缺数据就显示未知，不制造状态。
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
  { id: 'employees', label: '员工' }, { id: 'models', label: '模型' }, { id: 'plugins', label: '插件' },
  { id: 'communication', label: '通讯' }, { id: 'storage', label: '存储' }, { id: 'security', label: '安全' },
]

export type CompanySettingsData = {
  companyName?: string
  generatedAt?: number
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

/** 通讯页与安全页共享 Work Orchestrator 的真实工作组上限。 */
export function summaryWorkgroup(summary?: CommunicationSettingsData): { maxWorkgroupSize?: number } {
  if (!summary || !Array.isArray(summary.adapters)) return {}
  const size = summary.maxWorkgroupSize
  if (typeof size !== 'number' || !Number.isFinite(size)) return {}
  return { maxWorkgroupSize: size }
}

function navCount(value: unknown[] | undefined): string {
  return Array.isArray(value) ? String(value.length) : ''
}

function mergeSection<T extends object>(base: T | undefined, extra: T | undefined): T | undefined {
  if (!extra) return base
  if (!base) return extra
  return Object.assign({}, base, extra)
}

export function settingsDataFromSnapshot(snapshot: CompanySnapshot | null | undefined, extra?: CompanySettingsData): CompanySettingsData {
  if (!snapshot) {
    if (!extra) return {}
    const only = summaryWorkgroup(extra.communication)
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
  const workgroup = summaryWorkgroup(extra?.communication)
  const base: CompanySettingsData = {
    companyName: snapshot.companyName,
    generatedAt: snapshot.generatedAt,
    employees: {
      loaded: true,
      employees: employees.map((employee) => ({
        id: employee.employeeId, name: employee.name, role: employee.role, department: employee.department,
        level: employee.level?.level, xp: employee.xp, models: employee.models, plugins: employee.plugins,
        stats: { tasks: employee.statistics?.totalTasks, memories: employee.statistics?.memoryCount, skills: employee.statistics?.skillCount, evidence: employee.statistics?.evidenceCount, lastActiveAt: employee.statistics?.lastActiveAt },
      })),
      providers: providers.map((provider) => ({ id: provider.id, type: provider.type, model: provider.model, enabled: provider.enabled })),
    },
    models: {
      loaded: true,
      providers: providers.map((provider) => Object.assign({}, provider)),
      employees: employees.map((employee) => ({ id: employee.employeeId, name: employee.name, role: employee.role, bindings: employee.models })),
    },
    plugins: { loaded: true, installed: [...installed.values()] },
    storage: { employees: snapshot.totals?.employees, memories: snapshot.totals?.memories, tasks: snapshot.totals?.tasks, skills: snapshot.totals?.skills },
    security: Object.assign({ secrets }, workgroup),
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
    employees: navCount(data?.employees?.employees), models: navCount(data?.models?.providers), plugins: navCount(data?.plugins?.installed),
    communication: Array.isArray(data?.communication?.adapters) ? String(data!.communication!.adapters!.filter((item) => item.state === 'connected').length) : '',
    storage: '', security: navCount(data?.security?.secrets),
  }

  return h('div', { className: 'cy9-set-overlay', onClick: onClose },
    h('div', { className: 'cy9-set', role: 'dialog', 'aria-modal': 'true', 'aria-label': '公司设置', onClick: (event: any) => event.stopPropagation() },
      h('div', { className: 'cy9-set-head' },
        h('div', { className: 'cy9-set-head-copy' },
          h('b', null, '公司设置'),
          h('span', { title: data?.source }, [data?.companyName || '赛博公司', data?.source || '', data?.generatedAt ? `数据时间 ${formatDateTime(data.generatedAt)}` : '尚未加载持久化快照'].filter(Boolean).join(' · ')),
        ),
        h(ActionButton, { label: '刷新', busyLabel: '读取中…', run: actions?.refresh ? (() => actions.refresh!()) : undefined, hint: '当前运行时未提供设置数据读取能力' }),
        h('button', { type: 'button', className: 'cy9-set-close', onClick: onClose, title: '关闭（Esc）' }, '✕'),
      ),
      h('div', { className: 'cy9-set-body' },
        h('nav', { className: 'cy9-set-nav' },
          h('div', { className: 'cy9-set-nav-label' }, '公司设置'),
          SETTINGS_SECTIONS.map((item) => h('button', { key: item.id, type: 'button', className: section === item.id ? 'on' : '', onClick: () => setSection(item.id) }, item.label, counts[item.id] ? h('em', null, counts[item.id]) : null)),
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
