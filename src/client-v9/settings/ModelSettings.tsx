// 公司设置 → 模型（需求文档十一 / 十二 / 三十九）。
// 按「文本 / 视觉 / 图片生成 / 视频生成 / Embedding」分组展示 company.json 里真实配置的供应商，
// 支持：测试连接 / 启用 / 禁用 / 设为默认 / 员工绑定。
// 铁律：密钥只显示掩码；某一类没有配置就显示「未配置」，绝不假装可用（需求文档四十八）。
import { createElement as h, useMemo, useState } from 'react'
import type { ModelBinding, ModelCapability, ModelProviderSummary, ModelProviderType } from '../../persistence/types'
import { CAPABILITY_PROVIDER_TYPE } from '../../models/types'
import { ActionButton, Empty, SecretChip, SettingsCard, SettingsRow, SelectField, StatusPill, Toggle, formatDateTime, type PillTone } from './styles'

/** type → capability 的反查表：正向表在 models/types.ts，这里反转，保证两侧永远一致。 */
const CAPABILITY_OF_TYPE = Object.fromEntries(
  Object.entries(CAPABILITY_PROVIDER_TYPE).map(([capability, type]) => [type, capability]),
) as Record<ModelProviderType, ModelCapability>

const GROUPS: Array<{ type: ModelProviderType; label: string }> = [
  { type: 'text', label: '文本模型' },
  { type: 'vision', label: '视觉模型' },
  { type: 'image', label: '图片生成' },
  { type: 'video', label: '视频生成' },
  { type: 'embedding', label: 'Embedding' },
]

export type ModelProviderRow = ModelProviderSummary & {
  /** 已注册的协议适配器名；null / undefined 表示 registry 里没有这个协议，供应商实际不可用。 */
  adapter?: string | null
  apiKeySource?: string
  apiKeyMasked?: string
  /** 由 host 明确指定的默认供应商；不传时按「兜底链首位」推断。 */
  isDefault?: boolean
  lastTestAt?: number
  lastTestOk?: boolean
  lastTestMessage?: string
}

export type ModelEmployeeRow = { id: string; name: string; role?: string; bindings?: ModelBinding[] }

export type ModelSettingsData = {
  providers?: ModelProviderRow[]
  employees?: ModelEmployeeRow[]
  /** Gateway.capabilityStatus 的结果：这项能力当前到底能不能用。 */
  capabilities?: Partial<Record<ModelCapability, { configured: boolean; providerIds?: string[] }>>
  loaded?: boolean
}

export type ModelTestResult = { ok: boolean; message?: string; durationMs?: number }

export type ModelSettingsActions = {
  test?(providerId: string): unknown | Promise<unknown>
  setEnabled?(providerId: string, enabled: boolean): unknown | Promise<unknown>
  setDefault?(providerId: string): unknown | Promise<unknown>
  bind?(employeeId: string, capability: ModelCapability, providerId: string | null): unknown | Promise<unknown>
}

function providerState(row: ModelProviderRow): { tone: PillTone; label: string; title?: string } {
  if (!row.enabled) return { tone: 'off', label: '已禁用' }
  // adapter 明确为 null 才是「registry 里没这个协议」；undefined 表示 host 没下发这个字段，不能据此判死。
  if (row.adapter === null) return { tone: 'bad', label: '协议未注册', title: `registry 里没有 ${row.provider} 协议适配器` }
  if (row.apiKeyRef && !row.apiKeyConfigured) return { tone: 'bad', label: '密钥未生效', title: '配置里写了引用，但运行时没取到值' }
  if (!row.apiKeyRef) return { tone: 'warn', label: '未配置密钥' }
  if (row.lastTestOk === false) return { tone: 'warn', label: '上次连接失败', title: row.lastTestMessage }
  return { tone: 'ok', label: '可用' }
}

function testMessage(value: unknown): string {
  if (typeof value === 'string' && value) return value
  const result = value as ModelTestResult | undefined
  if (result && typeof result === 'object' && typeof result.ok === 'boolean') {
    const suffix = typeof result.durationMs === 'number' ? ` · ${Math.round(result.durationMs)}ms` : ''
    if (!result.ok) throw new Error(result.message || '连接失败')
    return `${result.message || '连接成功'}${suffix}`
  }
  return '连接成功'
}

function BindingPanel(props: {
  capability: ModelCapability
  providers: ModelProviderRow[]
  employees: ModelEmployeeRow[]
  bind?: ModelSettingsActions['bind']
  onDone?: () => void
}) {
  const { capability, providers, employees, bind, onDone } = props
  if (!employees.length) return h(Empty, { text: '暂无员工名册，无法配置绑定。' })
  const options = [{ value: '', label: '不绑定（用公司兜底链）' }].concat(providers.map((row) => ({ value: row.id, label: `${row.id} · ${row.model}${row.enabled ? '' : '（已禁用）'}` })))
  return h('div', null, employees.map((employee) => {
    const binding = (employee.bindings || []).filter((item) => item.capability === capability).sort((a, b) => a.priority - b.priority)[0]
    const missing = binding && !providers.some((row) => row.id === binding.providerId)
    return h(SettingsRow, {
      key: employee.id,
      title: employee.name,
      desc: employee.role || undefined,
      side: [
        binding ? h(StatusPill, {
          key: 'state',
          tone: missing || binding.status === 'missing' ? 'bad' : binding.status === 'disabled' ? 'off' : 'ok',
          label: missing ? '绑定的供应商已不存在' : binding.status === 'missing' ? 'missing' : binding.status === 'disabled' ? 'disabled' : 'available',
        }) : null,
        h(SelectField, {
          key: 'select',
          value: binding ? binding.providerId : '',
          options: missing && binding ? options.concat([{ value: binding.providerId, label: `${binding.providerId}（已缺失）` }]) : options,
          onChange: bind ? ((value: string) => Promise.resolve(bind(employee.id, capability, value || null)).then(() => onDone?.())) : undefined,
          hint: '当前运行时未提供员工模型绑定写入能力',
        }),
      ],
    })
  }))
}

export function ModelSettings(props: { data?: ModelSettingsData; actions?: ModelSettingsActions; onRefresh?: () => void }) {
  const { data, actions, onRefresh } = props
  const providers = data?.providers || []
  const employees = data?.employees || []
  const [openBinding, setOpenBinding] = useState<ModelProviderType | null>(null)
  const grouped = useMemo(() => {
    const map = new Map<ModelProviderType, ModelProviderRow[]>()
    for (const row of providers) map.set(row.type, [...(map.get(row.type) || []), row])
    return map
  }, [providers])

  return h('div', { className: 'cy9-set-main' },
    !data?.loaded && !providers.length
      ? h('div', { className: 'cy9-set-banner info' }, '尚未读到模型配置。供应商写在 ~/.dsh-org-panel/company.json 的 modelProviders 中，apiKeyRef 只能是 env: / secret: 引用。')
      : null,
    GROUPS.map((group) => {
      const rows = grouped.get(group.type) || []
      const capability = CAPABILITY_OF_TYPE[group.type]
      const status = data?.capabilities?.[capability]
      const defaultId = rows.find((row) => row.isDefault)?.id || rows.find((row) => row.enabled)?.id
      return h(SettingsCard, {
        key: group.type,
        title: group.label,
        meta: rows.length ? `${rows.length} 个供应商${status ? (status.configured ? ' · 能力可用' : ' · 能力当前不可用') : ''}` : '未配置',
        actions: rows.length ? h('button', {
          type: 'button', className: 'cy9-set-btn', onClick: () => setOpenBinding((current) => current === group.type ? null : group.type),
        }, openBinding === group.type ? '收起员工绑定' : '员工绑定') : null,
        note: rows.length ? '默认 = 公司级兜底链首位；员工显式绑定优先于兜底链。密钥只显示掩码，完整值只在 host 侧解析。' : undefined,
      },
        rows.length ? rows.map((row) => {
          const state = providerState(row)
          return h(SettingsRow, {
            key: row.id,
            title: h('span', null, row.id, row.id === defaultId ? h(StatusPill, { tone: 'info', label: '默认' }) : null),
            desc: h('span', null,
              h('span', { className: 'cy9-set-mono' }, `${row.provider} · ${row.model}${row.baseUrl ? ` · ${row.baseUrl}` : ''}`),
              row.lastTestAt ? h('span', null, ` · 上次测试 ${formatDateTime(row.lastTestAt)}${row.lastTestOk === false ? `（失败：${row.lastTestMessage || '未说明'}）` : '（成功）'}`) : null,
            ),
            side: [
              h(StatusPill, { key: 'state', tone: state.tone, label: state.label, title: state.title }),
              h(SecretChip, { key: 'secret', secretRef: row.apiKeyRef, configured: row.apiKeyConfigured, masked: row.apiKeyMasked, source: row.apiKeySource }),
              h(ActionButton, {
                key: 'test', label: '测试连接', busyLabel: '连接中…',
                run: actions?.test ? (() => Promise.resolve(actions.test!(row.id)).then(testMessage)) : undefined,
                hint: '当前运行时未提供模型连通性测试',
                onDone: () => onRefresh?.(),
              }),
              h(Toggle, {
                key: 'enabled', on: row.enabled, labels: ['已启用', '已禁用'],
                onChange: actions?.setEnabled ? ((next: boolean) => actions.setEnabled!(row.id, next)) : undefined,
                hint: '当前运行时未提供启用/禁用写入能力', onDone: () => onRefresh?.(),
              }),
              h(ActionButton, {
                key: 'default', label: '设为默认',
                run: actions?.setDefault && row.id !== defaultId ? (() => actions.setDefault!(row.id)) : undefined,
                hint: row.id === defaultId ? '已经是默认供应商' : '当前运行时未提供默认供应商写入能力',
                onDone: () => onRefresh?.(),
              }),
            ],
          })
        }) : h(Empty, { text: '未配置。' }),
        rows.length && openBinding === group.type
          ? h(BindingPanel, { capability, providers: rows, employees, bind: actions?.bind, onDone: onRefresh })
          : null,
      )
    }),
  )
}
