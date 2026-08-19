// 公司设置 → 员工（需求文档三十八）。
// 左侧真实员工名册，右侧该员工的：启用状态、模型能力绑定、允许插件、权限模式。
// 所有数字来自持久化的 CompanySnapshot；运行时没给的字段一律显示 '—'，不猜、不补（需求文档四十八）。
import { createElement as h, useState } from 'react'
import type { ModelBinding, ModelCapability, ModelProviderType, PluginBinding, PluginStatus } from '../../persistence/types'
import { CAPABILITY_PROVIDER_TYPE } from '../../models/types'
import { staffThumb } from '../asset-map'
import { AssetImage } from '../components/AssetImage'
import { ActionButton, DASH, Empty, KeyValues, SelectField, SettingsCard, SettingsRow, StatusPill, Toggle, countText, formatDateTime, type PillTone } from './styles'

const CAPABILITIES: Array<{ id: ModelCapability; label: string }> = [
  { id: 'text', label: '文本' },
  { id: 'vision', label: '视觉' },
  { id: 'image-generation', label: '图片生成' },
  { id: 'video-generation', label: '视频生成' },
  { id: 'embedding', label: 'Embedding' },
]

const PERMISSION_OPTIONS = [
  { value: 'read-only', label: 'Read Only' },
  { value: 'workspace-write', label: 'Workspace Write' },
  { value: 'danger-full-access', label: 'Full Access' },
]

const PLUGIN_TONE: Record<PluginStatus, PillTone> = { available: 'ok', degraded: 'warn', missing: 'bad', disabled: 'off' }
const PLUGIN_LABEL: Record<PluginStatus, string> = { available: 'Available', degraded: 'Degraded', missing: 'Missing', disabled: 'Disabled' }

export type EmployeeProviderOption = { id: string; type: ModelProviderType; model: string; enabled: boolean }

export type EmployeeSettingsEntry = {
  id: string
  name: string
  role?: string
  department?: string
  /** 未提供表示运行时没有「停用员工」这个字段，UI 显示 '—' 而不是默认「已启用」。 */
  enabled?: boolean
  permissionMode?: string | null
  level?: number
  xp?: number
  models?: ModelBinding[]
  plugins?: PluginBinding[]
  stats?: { tasks?: number; memories?: number; skills?: number; evidence?: number; lastActiveAt?: number }
}

export type EmployeeSettingsData = {
  employees?: EmployeeSettingsEntry[]
  providers?: EmployeeProviderOption[]
  loaded?: boolean
}

export type EmployeeSettingsActions = {
  setEnabled?(employeeId: string, enabled: boolean): unknown | Promise<unknown>
  setPermission?(employeeId: string, mode: string): unknown | Promise<unknown>
  bindModel?(employeeId: string, capability: ModelCapability, providerId: string | null): unknown | Promise<unknown>
  setPluginAllowed?(employeeId: string, pluginId: string, allowed: boolean): unknown | Promise<unknown>
  verifyPlugin?(employeeId: string, pluginId: string): unknown | Promise<unknown>
  openProfile?(employeeId: string): void
}

function bindingOf(bindings: ModelBinding[] | undefined, capability: ModelCapability): ModelBinding | undefined {
  return (bindings || []).filter((item) => item.capability === capability).sort((a, b) => a.priority - b.priority)[0]
}

export function EmployeeSettings(props: { data?: EmployeeSettingsData; actions?: EmployeeSettingsActions; onRefresh?: () => void }) {
  const { data, actions, onRefresh } = props
  const employees = data?.employees || []
  const providers = data?.providers || []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 默认选中名册第一人：用派生值而不是 effect，名册变化时不会出现「先空一帧再补上」。
  const current = employees.find((item) => item.id === selectedId) || employees[0] || null

  if (!employees.length) {
    return h('div', { className: 'cy9-set-main' },
      h(SettingsCard, { title: '员工' }, h(Empty, { text: data?.loaded ? '公司当前没有员工。' : '尚未读到员工名册。' })),
    )
  }

  return h('div', { className: 'cy9-set-main' },
    h('div', { className: 'cy9-set-split' },
      h('div', { className: 'cy9-set-roster' }, employees.map((employee) => h('button', {
        key: employee.id, type: 'button', className: employee.id === current?.id ? 'on' : '', onClick: () => setSelectedId(employee.id),
      },
        h('span', { className: 'cy9-set-avatar' }, h(AssetImage, { src: staffThumb(employee.id), alt: employee.name, fallback: employee.name })),
        h('span', { className: 'cy9-set-roster-copy' }, h('b', null, employee.name), h('span', null, `${employee.role || DASH}${employee.department ? ` · ${employee.department}` : ''}`)),
        h(StatusPill, {
          tone: employee.enabled === false ? 'off' : employee.enabled === true ? 'ok' : 'off',
          label: employee.enabled === false ? '停用' : employee.enabled === true ? '启用' : DASH,
        }),
      ))),
      current ? h('div', { className: 'cy9-set-detail' },
        h(SettingsCard, {
          title: `${current.name} · ${current.role || DASH}`,
          meta: current.department || undefined,
          actions: [
            h(Toggle, {
              key: 'enabled', on: current.enabled, labels: ['● 启用', '○ 停用'],
              onChange: actions?.setEnabled ? ((next: boolean) => actions.setEnabled!(current.id, next)) : undefined,
              hint: '当前运行时未提供员工启用/停用写入能力', onDone: () => onRefresh?.(),
            }),
            actions?.openProfile ? h('button', { key: 'profile', type: 'button', className: 'cy9-set-btn', onClick: () => actions.openProfile!(current.id) }, '打开档案') : null,
          ],
        },
          h(KeyValues, {
            items: [
              { label: '等级', value: typeof current.level === 'number' ? `Lv.${current.level}` : DASH },
              { label: 'XP', value: countText(current.xp) },
              { label: '任务履历', value: countText(current.stats?.tasks, ' 条') },
              { label: '长期记忆', value: countText(current.stats?.memories, ' 条') },
              { label: '技能', value: countText(current.stats?.skills, ' 项') },
              { label: '技能证据', value: countText(current.stats?.evidence, ' 条') },
              { label: '最近活跃', value: formatDateTime(current.stats?.lastActiveAt) },
            ],
          }),
        ),
        h(SettingsCard, {
          title: '模型能力',
          meta: providers.length ? `${providers.length} 个可选供应商` : '公司尚未配置模型供应商',
          note: '员工绑定优先于公司兜底链；绑定指向的供应商被删除或停用时状态会如实标成 missing。',
        },
          CAPABILITIES.map((capability) => {
            const binding = bindingOf(current.models, capability.id)
            const options = providers.filter((item) => item.type === CAPABILITY_PROVIDER_TYPE[capability.id])
            const missing = !!binding && !options.some((item) => item.id === binding.providerId)
            const selectOptions = [{ value: '', label: options.length ? '不绑定（用公司兜底链）' : '公司未配置该类供应商' }]
              .concat(options.map((item) => ({ value: item.id, label: `${item.id} · ${item.model}${item.enabled ? '' : '（已禁用）'}` })))
              .concat(missing && binding ? [{ value: binding.providerId, label: `${binding.providerId}（已缺失）` }] : [])
            return h(SettingsRow, {
              key: capability.id,
              title: capability.label,
              desc: binding ? `providerId ${binding.providerId} · priority ${binding.priority}` : '未绑定',
              side: [
                binding ? h(StatusPill, {
                  key: 'state',
                  tone: missing || binding.status === 'missing' ? 'bad' : binding.status === 'disabled' ? 'off' : 'ok',
                  label: missing ? '供应商已不存在' : binding.status,
                }) : h(StatusPill, { key: 'state', tone: 'off', label: DASH }),
                h(SelectField, {
                  key: 'select', value: binding ? binding.providerId : '',
                  options: selectOptions,
                  onChange: actions?.bindModel && options.length ? ((value: string) => actions.bindModel!(current.id, capability.id, value || null)) : undefined,
                  hint: options.length ? '当前运行时未提供员工模型绑定写入能力' : '公司设置 → 模型 里还没有这一类供应商',
                  onDone: () => onRefresh?.(),
                }),
              ],
            })
          }),
        ),
        h(SettingsCard, {
          title: '允许插件',
          meta: current.plugins?.length ? `${current.plugins.length} 个已绑定` : '暂无',
          note: '插件必须经过老板审批、真实安装、Tool Registry 验证与 Smoke Test 才会出现在这里。',
        },
          current.plugins?.length ? current.plugins.map((plugin) => h(SettingsRow, {
            key: plugin.pluginId,
            title: plugin.packageName || plugin.pluginId,
            desc: `${plugin.source}${plugin.version ? ` · v${plugin.version}` : ''} · 工具 ${plugin.tools.length ? plugin.tools.join('、') : DASH} · 最近验证 ${formatDateTime(plugin.lastVerifiedAt)}`,
            side: [
              h(StatusPill, { key: 'state', tone: PLUGIN_TONE[plugin.status], label: PLUGIN_LABEL[plugin.status] }),
              h(ActionButton, {
                key: 'verify', label: '重新验证',
                run: actions?.verifyPlugin ? (() => actions.verifyPlugin!(current.id, plugin.pluginId)) : undefined,
                hint: '当前运行时未提供插件验证能力', onDone: () => onRefresh?.(),
              }),
              h(Toggle, {
                key: 'allowed', on: plugin.status !== 'disabled', labels: ['已允许', '已禁用'],
                onChange: actions?.setPluginAllowed ? ((next: boolean) => actions.setPluginAllowed!(current.id, plugin.pluginId, next)) : undefined,
                hint: '当前运行时未提供插件启停写入能力', onDone: () => onRefresh?.(),
              }),
            ],
          })) : h(Empty, { text: '暂无已学会的插件。' }),
        ),
        h(SettingsCard, { title: '权限', note: '这里只是员工侧上限，实际执行仍然受 DSH 自身权限模式约束（需求文档四十三）。' },
          h(SettingsRow, {
            title: '权限模式',
            desc: '决定该员工在外部渠道与工具调用时能拿到的最高档位。',
            side: h(SelectField, {
              value: current.permissionMode || '',
              options: [{ value: '', label: current.permissionMode ? '不限制' : DASH }].concat(PERMISSION_OPTIONS),
              onChange: actions?.setPermission ? ((value: string) => actions.setPermission!(current.id, value)) : undefined,
              hint: '当前运行时未提供员工权限写入能力',
              onDone: () => onRefresh?.(),
            }),
          }),
        ),
      ) : null,
    ),
  )
}
