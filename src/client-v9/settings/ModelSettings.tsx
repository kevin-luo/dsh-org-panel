// 公司设置 → 模型：公司能力供应商 + 员工真实 DSH 文本模型路由。
import { createElement as h, useMemo, useState } from 'react'
import type { ModelBinding, ModelCapability, ModelProviderConfig, ModelProviderSummary, ModelProviderType, ModelProviderVendor } from '../../persistence/types'
import { CAPABILITY_PROVIDER_TYPE } from '../../models/types'
import { ActionButton, Empty, SecretChip, SettingsCard, SettingsRow, SelectField, StatusPill, Toggle, formatDateTime, type PillTone } from './styles'

const CAPABILITY_OF_TYPE = Object.fromEntries(Object.entries(CAPABILITY_PROVIDER_TYPE).map(([capability, type]) => [type, capability])) as Record<ModelProviderType, ModelCapability>
const GROUPS: Array<{ type: ModelProviderType; label: string }> = [
  { type: 'text', label: '文本模型' }, { type: 'vision', label: '视觉模型' }, { type: 'image', label: '图片生成' },
  { type: 'video', label: '视频生成' }, { type: 'embedding', label: 'Embedding' },
]
const VENDORS: Array<{ value: ModelProviderVendor; label: string }> = [
  { value: 'openai-compatible', label: 'OpenAI Compatible' }, { value: 'gemini', label: 'Gemini' }, { value: 'custom', label: 'Custom' },
]

export type ModelProviderRow = ModelProviderSummary & {
  adapter?: string | null
  apiKeySource?: string
  apiKeyMasked?: string
  isDefault?: boolean
  lastTestAt?: number
  lastTestOk?: boolean
  lastTestMessage?: string
  dshRouteAvailable?: boolean
}
export type ModelEmployeeRow = { id: string; name: string; role?: string; bindings?: ModelBinding[] }
export type ModelSettingsData = {
  providers?: ModelProviderRow[]
  employees?: ModelEmployeeRow[]
  capabilities?: Partial<Record<ModelCapability, { configured: boolean; providerIds?: string[] }>>
  dshProviders?: Array<{ id: string; name?: string }>
  reason?: string
  loaded?: boolean
}
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
  dshProvider: string
  baseUrl: string
  apiKeyRef: string
  timeout: string
  enabled: boolean
}
function emptyDraft(type: ModelProviderType = 'text'): ProviderDraft { return { id: '', type, provider: 'openai-compatible', model: '', dshProvider: '', baseUrl: '', apiKeyRef: '', timeout: '45000', enabled: true } }
function draftOf(row: ModelProviderRow): ProviderDraft { return { id: row.id, type: row.type, provider: row.provider, model: row.model, dshProvider: row.dshProvider || '', baseUrl: row.baseUrl || '', apiKeyRef: row.apiKeyRef ? String(row.apiKeyRef) : '', timeout: '', enabled: row.enabled } }
function providerOf(draft: ProviderDraft): ModelProviderConfig {
  const id = draft.id.trim(), model = draft.model.trim(), dshProvider = draft.dshProvider.trim(), baseUrl = draft.baseUrl.trim(), apiKeyRef = draft.apiKeyRef.trim()
  if (!id) throw new Error('供应商 ID 不能为空')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) throw new Error('供应商 ID 只允许字母、数字、点、下划线和短横线')
  if (!model) throw new Error('模型名称不能为空')
  if (draft.type === 'text' && !dshProvider) throw new Error('文本模型必须选择/填写一个真实 DSH Provider Route')
  if (apiKeyRef && !/^(env|secret):.+/.test(apiKeyRef)) throw new Error('API Key 只能填写 env:XXX 或 secret:XXX 引用，不能填明文密钥')
  const timeout = Number(draft.timeout)
  return { id, type: draft.type, provider: draft.provider, model, dshProvider: draft.type === 'text' ? dshProvider : undefined, baseUrl: baseUrl || undefined, apiKeyRef: apiKeyRef ? apiKeyRef as ModelProviderConfig['apiKeyRef'] : undefined, timeout: draft.timeout.trim() && Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : undefined, enabled: draft.enabled }
}

function providerState(row: ModelProviderRow): { tone: PillTone; label: string; title?: string } {
  if (!row.enabled) return { tone: 'off', label: '已禁用' }
  if (row.type === 'text') {
    if (!row.dshProvider) return { tone: 'warn', label: '未绑定 DSH route', title: '文本员工模型必须映射到 DSH LlmRuntime 中真实注册的 provider route。' }
    if (row.dshRouteAvailable === false) return { tone: 'bad', label: 'DSH route 不存在', title: `当前 DSH 没有注册 ${row.dshProvider}` }
    if (row.dshRouteAvailable === true) return { tone: 'ok', label: 'DSH route 可用', title: `${row.dshProvider} / ${row.model} 会真实传给员工子代理 agentOptions` }
    return { tone: 'warn', label: 'DSH route 未探测' }
  }
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
    const fallback = result.checked === 'config-only' ? '只核对了配置与密钥，没有发真实请求' : '连接成功'
    return `${result.message || fallback}${suffix}`
  }
  return '连接成功'
}
function FormField(props: { label: string; hint?: string; children?: any }) {
  return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, color: 'var(--set-muted)', fontSize: 10 } }, h('span', null, props.label), props.children, props.hint ? h('small', { style: { color: 'var(--set-dim)', fontSize: 9, lineHeight: 1.35 } }, props.hint) : null)
}

function ProviderEditor(props: { row?: ModelProviderRow; initialType?: ModelProviderType; dshProviders?: Array<{ id: string; name?: string }>; upsert?: ModelSettingsActions['upsert']; onClose(): void; onSaved?(): void }) {
  const editing = !!props.row
  const [draft, setDraft] = useState<ProviderDraft>(() => props.row ? draftOf(props.row) : emptyDraft(props.initialType))
  const patch = <K extends keyof ProviderDraft,>(key: K, value: ProviderDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const input = (key: keyof ProviderDraft, placeholder = '', disabled = false) => h('input', { className: 'cy9-set-input', value: String(draft[key] ?? ''), placeholder, disabled, onChange: (event: any) => patch(key as any, String(event?.target?.value ?? '') as any), style: { width: '100%', height: 32 } })
  const dshProviders = props.dshProviders || []
  const routeHint = dshProviders.length ? `当前 DSH 已注册：${dshProviders.map((item) => item.id).join('、')}` : '当前 host 没探测到可用 DSH provider route；保存后该文本模型不会伪装成已生效。'
  return h(SettingsCard, {
    title: editing ? `编辑模型 · ${props.row!.id}` : '添加模型供应商', meta: editing ? '供应商 ID 创建后锁定' : '保存后写入 company.json，重启仍保留',
    actions: [h('button', { key: 'cancel', type: 'button', className: 'cy9-set-btn', onClick: props.onClose }, '取消'), h(ActionButton, { key: 'save', label: editing ? '保存修改' : '添加模型', busyLabel: '保存中…', tone: 'primary', run: props.upsert ? (() => props.upsert!(providerOf(draft))) : undefined, hint: '当前 /org-panel 通道没有模型写入能力', onDone: (ok) => { if (ok) { props.onSaved?.(); props.onClose() } } })],
    note: draft.type === 'text' ? '文本员工模型由 DSH 自己管理凭证；这里的 DSH Provider Route 会真实传入 subagents.start(...agentOptions)。' : 'API Key 只填写 SecretRef，例如 env:OPENAI_API_KEY 或 secret:model-main；完整密钥不会写进 company.json。',
  }, h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, padding: 12 } },
    h(FormField, { label: '供应商 ID', hint: editing ? 'ID 用于员工绑定，编辑时不可修改。' : '这是公司内部稳定 ID。' }, input('id', 'coder-main', editing)),
    h(FormField, { label: '能力类型' }, h('select', { className: 'cy9-set-select', value: draft.type, disabled: editing, onChange: (event: any) => patch('type', String(event?.target?.value || 'text') as ModelProviderType), style: { width: '100%', height: 32 } }, GROUPS.map((group) => h('option', { key: group.type, value: group.type }, group.label)))),
    h(FormField, { label: '协议' }, h('select', { className: 'cy9-set-select', value: draft.provider, onChange: (event: any) => patch('provider', String(event?.target?.value || 'openai-compatible') as ModelProviderVendor), style: { width: '100%', height: 32 } }, VENDORS.map((vendor) => h('option', { key: vendor.value, value: vendor.value }, vendor.label)))),
    h(FormField, { label: '模型名称', hint: draft.type === 'text' ? '真实传给 DSH agentOptions.model。' : '填写供应商真实模型 ID。' }, input('model', 'gpt-5.6 / deepseek-...')),
    draft.type === 'text' ? h(FormField, { label: 'DSH Provider Route', hint: routeHint }, dshProviders.length ? h('select', { className: 'cy9-set-select', value: draft.dshProvider, onChange: (event: any) => patch('dshProvider', String(event?.target?.value || '')), style: { width: '100%', height: 32 } }, [h('option', { key: '', value: '' }, '请选择真实 DSH route'), ...dshProviders.map((route) => h('option', { key: route.id, value: route.id }, `${route.id}${route.name && route.name !== route.id ? ` · ${route.name}` : ''}`))]) : input('dshProvider', '例如 deepseek / openai')) : null,
    draft.type !== 'text' ? h(FormField, { label: 'Base URL', hint: 'OpenAI Compatible / Custom 通常需要。' }, input('baseUrl', 'https://api.example.com/v1')) : null,
    draft.type !== 'text' ? h(FormField, { label: 'API Key 引用', hint: editing ? '留空表示保持当前引用；填写新 env:/secret: 会替换。' : '只接受 env: / secret:。' }, input('apiKeyRef', 'env:MODEL_API_KEY')) : null,
    draft.type !== 'text' ? h(FormField, { label: '超时（ms）', hint: editing ? '留空表示保持原超时。' : undefined }, input('timeout', '45000')) : null,
    h(FormField, { label: '启用状态' }, h('button', { type: 'button', className: `cy9-set-toggle${draft.enabled ? ' on' : ''}`, onClick: () => patch('enabled', !draft.enabled), style: { alignSelf: 'flex-start' } }, draft.enabled ? '已启用' : '已禁用')),
  ))
}

function BindingPanel(props: { capability: ModelCapability; providers: ModelProviderRow[]; employees: ModelEmployeeRow[]; bind?: ModelSettingsActions['bind']; onDone?: () => void }) {
  const { capability, providers, employees, bind, onDone } = props
  if (!employees.length) return h(Empty, { text: '暂无员工名册，无法配置绑定。' })
  const options = [{ value: '', label: '不绑定（用公司兜底链）' }].concat(providers.map((row) => ({ value: row.id, label: `${row.id} · ${row.model}${row.enabled ? '' : '（已禁用）'}` })))
  return h('div', null, employees.map((employee) => {
    const binding = (employee.bindings || []).filter((item) => item.capability === capability).sort((a, b) => a.priority - b.priority)[0]
    const missing = binding && !providers.some((row) => row.id === binding.providerId)
    return h(SettingsRow, { key: employee.id, title: employee.name, desc: employee.role || undefined, side: [
      binding ? h(StatusPill, { key: 'state', tone: missing || binding.status === 'missing' ? 'bad' : binding.status === 'disabled' ? 'off' : 'ok', label: missing ? '绑定的供应商已不存在' : binding.status === 'missing' ? 'missing' : binding.status === 'disabled' ? 'disabled' : '显式绑定' }) : h(StatusPill, { key: 'fallback', tone: 'off', label: '公司兜底' }),
      h(SelectField, { key: 'select', value: binding ? binding.providerId : '', options: missing && binding ? options.concat([{ value: binding.providerId, label: `${binding.providerId}（已缺失）` }]) : options, onChange: bind ? ((value: string) => Promise.resolve(bind(employee.id, capability, value || null)).then(() => onDone?.())) : undefined, hint: '当前运行时未提供员工模型绑定写入能力' }),
    ] })
  }))
}

export function ModelSettings(props: { data?: ModelSettingsData; actions?: ModelSettingsActions; onRefresh?: () => void }) {
  const { data, actions, onRefresh } = props
  const providers = data?.providers || [], employees = data?.employees || [], dshProviders = data?.dshProviders || []
  const [openBinding, setOpenBinding] = useState<ModelProviderType | null>(null)
  const [editor, setEditor] = useState<{ row?: ModelProviderRow; type?: ModelProviderType } | null>(null)
  const grouped = useMemo(() => { const map = new Map<ModelProviderType, ModelProviderRow[]>(); for (const row of providers) map.set(row.type, [...(map.get(row.type) || []), row]); return map }, [providers])

  return h('div', { className: 'cy9-set-main' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } }, h('div', { style: { marginRight: 'auto' } }, h('b', { style: { display: 'block', fontSize: 13 } }, '公司模型能力'), h('span', { style: { color: 'var(--set-muted)', fontSize: 10 } }, '文本模型真实路由到 DSH 子代理；视觉/生成能力继续走公司 Model Gateway。')), h('button', { type: 'button', className: 'cy9-set-btn primary', disabled: !actions?.upsert, title: actions?.upsert ? '添加模型供应商' : '当前 /org-panel 通道没有模型写入能力', onClick: () => setEditor({ type: 'text' }) }, '+ 添加模型')),
    data?.reason ? h('div', { className: 'cy9-set-banner' }, `面板没有拿到模型供应商清单 —— host 的原话：${data.reason}`) : null,
    !data?.reason && data?.loaded && !providers.length ? h('div', { className: 'cy9-set-banner info' }, '公司还没有模型供应商。现在可以直接点击“添加模型”完成配置。') : null,
    editor ? h(ProviderEditor, { key: editor.row?.id || `new-${editor.type || 'text'}`, row: editor.row, initialType: editor.type, dshProviders, upsert: actions?.upsert, onClose: () => setEditor(null), onSaved: onRefresh }) : null,
    GROUPS.map((group) => {
      const rows = grouped.get(group.type) || [], capability = CAPABILITY_OF_TYPE[group.type], status = data?.capabilities?.[capability]
      const defaultId = rows.find((row) => row.isDefault)?.id || rows.find((row) => row.enabled)?.id
      const headerActions: any[] = [h('button', { key: 'add', type: 'button', className: 'cy9-set-btn', disabled: !actions?.upsert, title: actions?.upsert ? `添加${group.label}` : '当前 /org-panel 通道没有模型写入能力', onClick: () => setEditor({ type: group.type }) }, '添加')]
      if (rows.length) headerActions.push(h('button', { key: 'binding', type: 'button', className: 'cy9-set-btn', onClick: () => setOpenBinding((current) => current === group.type ? null : group.type) }, openBinding === group.type ? '收起员工绑定' : '员工绑定'))
      return h(SettingsCard, { key: group.type, title: group.label, meta: rows.length ? `${rows.length} 个供应商${group.type === 'text' ? ` · DSH routes ${dshProviders.length}` : status ? (status.configured ? ' · 能力可用' : ' · 能力当前不可用') : ''}` : '未配置', actions: headerActions, note: rows.length ? (group.type === 'text' ? '员工显式绑定优先；没有绑定时按公司文本供应商顺序兜底。只有真实注册的 DSH route 才会进入 agentOptions。' : '默认 = 公司级兜底链首位；员工显式绑定优先于兜底链。') : undefined },
        rows.length ? rows.map((row) => {
          const state = providerState(row), isDefault = row.id === defaultId
          return h(SettingsRow, { key: row.id, title: h('span', null, row.id, isDefault ? h(StatusPill, { tone: 'info', label: '默认' }) : null), desc: h('span', null, h('span', { className: 'cy9-set-mono' }, row.type === 'text' ? `${row.dshProvider || '未绑定 route'} · ${row.model}` : `${row.provider} · ${row.model}${row.baseUrl ? ` · ${row.baseUrl}` : ''}`), row.lastTestAt ? h('span', null, ` · 上次测试 ${formatDateTime(row.lastTestAt)}${row.lastTestOk === false ? `（失败：${row.lastTestMessage || '未说明'}）` : '（成功）'}`) : null), side: [
            h(StatusPill, { key: 'state', tone: state.tone, label: state.label, title: state.title }),
            row.type !== 'text' ? h(SecretChip, { key: 'secret', secretRef: row.apiKeyRef, configured: row.apiKeyConfigured, masked: row.apiKeyMasked, source: row.apiKeySource }) : null,
            row.type !== 'text' ? h(ActionButton, { key: 'test', label: '测试', busyLabel: '测试中…', run: actions?.test ? (() => Promise.resolve(actions.test!(row.id)).then(testMessage)) : undefined, hint: '当前运行时未提供模型连通性测试', onDone: () => onRefresh?.() }) : null,
            h('button', { key: 'edit', type: 'button', className: 'cy9-set-btn', disabled: !actions?.upsert, title: actions?.upsert ? '编辑模型供应商' : '当前运行时未提供模型编辑能力', onClick: () => setEditor({ row }) }, '编辑'),
            h(Toggle, { key: 'enabled', on: row.enabled, labels: ['已启用', '已禁用'], onChange: actions?.setEnabled ? ((next: boolean) => actions.setEnabled!(row.id, next)) : undefined, hint: '当前运行时未提供启用/禁用写入能力', onDone: () => onRefresh?.() }),
            h(ActionButton, { key: 'default', label: '设为默认', run: actions?.setDefault && !isDefault && row.enabled ? (() => actions.setDefault!(row.id)) : undefined, hint: isDefault ? '已经是默认供应商' : !row.enabled ? '已禁用的供应商不能设为默认' : '当前运行时未提供默认供应商写入能力', onDone: () => onRefresh?.() }),
            h(ActionButton, { key: 'remove', label: '删除', tone: 'danger', run: actions?.remove ? (() => actions.remove!(row.id)) : undefined, hint: '当前运行时未提供删除供应商能力', confirm: `确认删除模型供应商“${row.id}”吗？员工历史绑定不会被静默清除，相关绑定会显示为 missing。`, onDone: (ok) => { if (ok) { if (editor?.row?.id === row.id) setEditor(null); onRefresh?.() } } }),
          ] })
        }) : h('div', { className: 'cy9-set-empty' }, h('span', null, `还没有配置${group.label}。`), actions?.upsert ? h('button', { type: 'button', className: 'cy9-set-btn', style: { marginLeft: 8 }, onClick: () => setEditor({ type: group.type }) }, '立即配置') : null),
        rows.length && openBinding === group.type ? h(BindingPanel, { capability, providers: rows, employees, bind: actions?.bind, onDone: onRefresh }) : null)
    })
  )
}
