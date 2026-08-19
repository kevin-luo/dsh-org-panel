// 公司设置 → 模型（Settings Control Plane / Milestone A）。
// 按「文本 / 视觉 / 图片生成 / 视频生成 / Embedding」分组展示 company.json 里真实配置的供应商，
// 支持：新增 / 编辑 / 删除 / 测试连接 / 启用禁用 / 设为默认 / 员工绑定。
// 铁律：密钥只写 SecretRef；某一类没有配置就给真实的「添加」入口，不再把编辑 company.json 当主路径。
import { createElement as h, useMemo, useState } from 'react'
import type {
  ModelBinding, ModelCapability, ModelProviderConfig, ModelProviderSummary, ModelProviderType, ModelProviderVendor,
} from '../../persistence/types'
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

const VENDORS: Array<{ value: ModelProviderVendor; label: string }> = [
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'custom', label: 'Custom' },
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
  /** host 明确回答「Model Gateway 本次没挂上」时给的真实原因。有它就原样上屏，绝不显示成「一个都没配」。 */
  reason?: string
  loaded?: boolean
}

/** checked 区分「真的发过一次请求」和「只核对了配置与密钥」；后者绝不许说成「连接成功」。 */
export type ModelTestResult = { ok: boolean; message?: string; durationMs?: number; checked?: 'config-only' | 'live-call' }

export type ModelSettingsActions = {
  upsert?(provider: ModelProviderConfig): unknown | Promise<unknown>
  remove?(providerId: string): unknown | Promise<unknown>
  test?(providerId: string): unknown | Promise<unknown>
  setEnabled?(providerId: string, enabled: boolean): unknown | Promise<unknown>
  setDefault?(providerId: string): unknown | Promise<unknown>
  bind?(employeeId: string, capability: ModelCapability, providerId: string | null): unknown | Promise<unknown>
}

type ProviderDraft = {
  id: string
  type: ModelProviderType
  provider: ModelProviderVendor
  model: string
  baseUrl: string
  apiKeyRef: string
  timeout: string
  enabled: boolean
}

function emptyDraft(type: ModelProviderType = 'text'): ProviderDraft {
  return { id: '', type, provider: 'openai-compatible', model: '', baseUrl: '', apiKeyRef: '', timeout: '45000', enabled: true }
}

function draftOf(row: ModelProviderRow): ProviderDraft {
  return {
    id: row.id,
    type: row.type,
    provider: row.provider,
    model: row.model,
    baseUrl: row.baseUrl || '',
    apiKeyRef: row.apiKeyRef ? String(row.apiKeyRef) : '',
    timeout: '',
    enabled: row.enabled,
  }
}

function providerOf(draft: ProviderDraft): ModelProviderConfig {
  const id = draft.id.trim()
  const model = draft.model.trim()
  const baseUrl = draft.baseUrl.trim()
  const apiKeyRef = draft.apiKeyRef.trim()
  if (!id) throw new Error('供应商 ID 不能为空')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) throw new Error('供应商 ID 只允许字母、数字、点、下划线和短横线')
  if (!model) throw new Error('模型名称不能为空')
  if (apiKeyRef && !/^(env|secret):.+/.test(apiKeyRef)) throw new Error('API Key 只能填写 env:XXX 或 secret:XXX 引用，不能填明文密钥')
  const timeout = Number(draft.timeout)
  return {
    id,
    type: draft.type,
    provider: draft.provider,
    model,
    baseUrl: baseUrl || undefined,
    apiKeyRef: apiKeyRef ? apiKeyRef as ModelProviderConfig['apiKeyRef'] : undefined,
    timeout: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : undefined,
    enabled: draft.enabled,
  }
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
    // host 没给文案时的兜底也必须分清楚：config-only 只是配置核对通过，不代表这个模型真的能用。
    const fallback = result.checked === 'config-only' ? '只核对了配置与密钥，没有发真实请求' : '连接成功'
    return `${result.message || fallback}${suffix}`
  }
  return '连接成功'
}

function FormField(props: { label: string; hint?: string; children: any }) {
  return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, color: 'var(--set-muted)', fontSize: 10 } },
    h('span', null, props.label),
    props.children,
    props.hint ? h('small', { style: { color: 'var(--set-dim)', fontSize: 9, lineHeight: 1.35 } }, props.hint) : null,
  )
}

function ProviderEditor(props: {
  row?: ModelProviderRow
  initialType?: ModelProviderType
  upsert?: ModelSettingsActions['upsert']
  onClose(): void
  onSaved?(): void
}) {
  const editing = !!props.row
  const [draft, setDraft] = useState<ProviderDraft>(() => props.row ? draftOf(props.row) : emptyDraft(props.initialType))
  const patch = <K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const input = (key: keyof ProviderDraft, placeholder = '', disabled = false) => h('input', {
    className: 'cy9-set-input', value: String(draft[key] ?? ''), placeholder, disabled,
    onChange: (event: any) => patch(key as any, String(event?.target?.value ?? '') as any),
    style: { width: '100%', height: 32 },
  })
  return h(SettingsCard, {
    title: editing ? `编辑模型 · ${props.row!.id}` : '添加模型供应商',
    meta: editing ? '供应商 ID 创建后锁定' : '保存后写入 company.json，重启仍保留',
    actions: [
      h('button', { key: 'cancel', type: 'button', className: 'cy9-set-btn', onClick: props.onClose }, '取消'),
      h(ActionButton, {
        key: 'save', label: editing ? '保存修改' : '添加模型', busyLabel: '保存中…', tone: 'primary',
        run: props.upsert ? (() => props.upsert!(providerOf(draft))) : undefined,
        hint: '当前 /org-panel 通道没有模型写入能力',
        onDone: (ok) => { if (ok) { props.onSaved?.(); props.onClose() } },
      }),
    ],
    note: 'API Key 这里只填写 SecretRef，例如 env:OPENAI_API_KEY 或 secret:openai-main。完整密钥不会写进 company.json。',
  },
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, padding: 12 } },
      h(FormField, { label: '供应商 ID', hint: editing ? 'ID 用于员工绑定，编辑时不可修改。' : '建议使用 openai-main / gemini-vision 这类稳定 ID。' }, input('id', 'openai-main', editing)),
      h(FormField, { label: '能力类型' }, h('select', {
        className: 'cy9-set-select', value: draft.type, disabled: editing,
        onChange: (event: any) => patch('type', String(event?.target?.value || 'text') as ModelProviderType),
        style: { width: '100%', height: 32 },
      }, GROUPS.map((group) => h('option', { key: group.type, value: group.type }, group.label)))),
      h(FormField, { label: '协议' }, h('select', {
        className: 'cy9-set-select', value: draft.provider,
        onChange: (event: any) => patch('provider', String(event?.target?.value || 'openai-compatible') as ModelProviderVendor),
        style: { width: '100%', height: 32 },
      }, VENDORS.map((vendor) => h('option', { key: vendor.value, value: vendor.value }, vendor.label)))),
      h(FormField, { label: '模型名称', hint: '填写供应商真实模型 ID，不在前端写死默认模型。' }, input('model', 'gpt-5 / gemini-...')),
      h(FormField, { label: 'Base URL', hint: 'OpenAI Compatible / Custom 通常需要；Gemini 可按部署配置填写。' }, input('baseUrl', 'https://api.example.com/v1')),
      h(FormField, { label: 'API Key 引用', hint: '只接受 env: / secret:；可留空用于无需密钥的本地服务。' }, input('apiKeyRef', 'env:OPENAI_API_KEY')),
      h(FormField, { label: '超时（ms）' }, input('timeout', '45000')),
      h(FormField, { label: '启用状态' }, h('button', {
        type: 'button', className: `cy9-set-toggle${draft.enabled ? ' on' : ''}`, onClick: () => patch('enabled', !draft.enabled),
        style: { alignSelf: 'flex-start' },
      }, draft.enabled ? '已启用' : '已禁用')),
    ),
  )
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
          label: missing ? '绑定的供应商已不存在' : binding.status === 'missing' ? 'missing' : binding.status === 'disabled' ? 'disabled' : '显式绑定',
        }) : h(StatusPill, { key: 'fallback', tone: 'off', label: '公司兜底' }),
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
  const [editor, setEditor] = useState<{ row?: ModelProviderRow; type?: ModelProviderType } | null>(null)
  const grouped = useMemo(() => {
    const map = new Map<ModelProviderType, ModelProviderRow[]>()
    for (const row of providers) map.set(row.type, [...(map.get(row.type) || []), row])
    return map
  }, [providers])

  return h('div', { className: 'cy9-set-main' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
      h('div', { style: { marginRight: 'auto' } },
        h('b', { style: { display: 'block', fontSize: 13 } }, '公司模型能力'),
        h('span', { style: { color: 'var(--set-muted)', fontSize: 10 } }, '供应商配置、公司兜底顺序和员工专属绑定统一在这里管理。'),
      ),
      h('button', {
        type: 'button', className: 'cy9-set-btn primary', disabled: !actions?.upsert,
        title: actions?.upsert ? '添加模型供应商' : '当前 /org-panel 通道没有模型写入能力',
        onClick: () => setEditor({ type: 'text' }),
      }, '+ 添加模型'),
    ),
    data?.reason ? h('div', { className: 'cy9-set-banner' }, `面板没有拿到模型供应商清单 —— host 的原话：${data.reason}`) : null,
    !data?.reason && data?.loaded && !providers.length ? h('div', { className: 'cy9-set-banner info' },
      '公司还没有模型供应商。现在可以直接点击“添加模型”完成配置，不需要手动编辑 company.json。',
    ) : null,
    editor ? h(ProviderEditor, {
      key: editor.row?.id || `new-${editor.type || 'text'}`,
      row: editor.row,
      initialType: editor.type,
      upsert: actions?.upsert,
      onClose: () => setEditor(null),
      onSaved: onRefresh,
    }) : null,
    GROUPS.map((group) => {
      const rows = grouped.get(group.type) || []
      const capability = CAPABILITY_OF_TYPE[group.type]
      const status = data?.capabilities?.[capability]
      const defaultId = rows.find((row) => row.isDefault)?.id || rows.find((row) => row.enabled)?.id
      const headerActions = [
        h('button', {
          key: 'add', type: 'button', className: 'cy9-set-btn', disabled: !actions?.upsert,
          title: actions?.upsert ? `添加${group.label}` : '当前 /org-panel 通道没有模型写入能力',
          onClick: () => setEditor({ type: group.type }),
        }, '添加'),
      ]
      if (rows.length) headerActions.push(h('button', {
        key: 'binding', type: 'button', className: 'cy9-set-btn', onClick: () => setOpenBinding((current) => current === group.type ? null : group.type),
      }, openBinding === group.type ? '收起员工绑定' : '员工绑定'))
      return h(SettingsCard, {
        key: group.type,
        title: group.label,
        meta: rows.length ? `${rows.length} 个供应商${status ? (status.configured ? ' · 能力可用' : ' · 能力当前不可用') : ''}` : '未配置',
        actions: headerActions,
        note: rows.length ? '默认 = 公司级兜底链首位；员工显式绑定优先于兜底链。密钥只保存引用，完整值不会下发到前端。' : undefined,
      },
        rows.length ? rows.map((row) => {
          const state = providerState(row)
          const isDefault = row.id === defaultId
          return h(SettingsRow, {
            key: row.id,
            title: h('span', null, row.id, isDefault ? h(StatusPill, { tone: 'info', label: '默认' }) : null),
            desc: h('span', null,
              h('span', { className: 'cy9-set-mono' }, `${row.provider} · ${row.model}${row.baseUrl ? ` · ${row.baseUrl}` : ''}`),
              row.lastTestAt ? h('span', null, ` · 上次测试 ${formatDateTime(row.lastTestAt)}${row.lastTestOk === false ? `（失败：${row.lastTestMessage || '未说明'}）` : '（成功）'}`) : null,
            ),
            side: [
              h(StatusPill, { key: 'state', tone: state.tone, label: state.label, title: state.title }),
              h(SecretChip, { key: 'secret', secretRef: row.apiKeyRef, configured: row.apiKeyConfigured, masked: row.apiKeyMasked, source: row.apiKeySource }),
              h(ActionButton, {
                key: 'test', label: '测试', busyLabel: '测试中…',
                run: actions?.test ? (() => Promise.resolve(actions.test!(row.id)).then(testMessage)) : undefined,
                hint: '当前运行时未提供模型连通性测试', onDone: () => onRefresh?.(),
              }),
              h('button', {
                key: 'edit', type: 'button', className: 'cy9-set-btn', disabled: !actions?.upsert,
                title: actions?.upsert ? '编辑模型供应商' : '当前运行时未提供模型编辑能力',
                onClick: () => setEditor({ row }),
              }, '编辑'),
              h(Toggle, {
                key: 'enabled', on: row.enabled, labels: ['已启用', '已禁用'],
                onChange: actions?.setEnabled ? ((next: boolean) => actions.setEnabled!(row.id, next)) : undefined,
                hint: '当前运行时未提供启用/禁用写入能力', onDone: () => onRefresh?.(),
              }),
              h(ActionButton, {
                key: 'default', label: '设为默认',
                run: actions?.setDefault && !isDefault && row.enabled ? (() => actions.setDefault!(row.id)) : undefined,
                hint: isDefault ? '已经是默认供应商' : !row.enabled ? '已禁用的供应商不能设为默认' : '当前运行时未提供默认供应商写入能力',
                onDone: () => onRefresh?.(),
              }),
              h(ActionButton, {
                key: 'remove', label: '删除', tone: 'danger',
                run: actions?.remove ? (() => actions.remove!(row.id)) : undefined,
                hint: '当前运行时未提供删除供应商能力',
                confirm: `确认删除模型供应商“${row.id}”吗？员工历史绑定不会被静默清除，相关绑定会显示为 missing。`,
                onDone: (ok) => { if (ok) { if (editor?.row?.id === row.id) setEditor(null); onRefresh?.() } },
              }),
            ],
          })
        }) : h('div', { className: 'cy9-set-empty' },
          h('span', null, `还没有配置${group.label}。`),
          actions?.upsert ? h('button', {
            type: 'button', className: 'cy9-set-btn', style: { marginLeft: 8 }, onClick: () => setEditor({ type: group.type }),
          }, '立即配置') : null,
        ),
        rows.length && openBinding === group.type
          ? h(BindingPanel, { capability, providers: rows, employees, bind: actions?.bind, onDone: onRefresh })
          : null,
      )
    }),
  )
}
