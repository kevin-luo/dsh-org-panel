// 「赛博公司」公司设置中心视觉层（需求文档三十七~四十三）。
// 本文件 = 设置中心的 CSS + 与 CSS 一一对应的基础组件，六个设置页共用，避免同一套按钮/状态点写六遍。
// 约束：
//   1. 只做展示，不持有任何业务数据；数据一律由各页 props 传入（需求文档四十八：状态必须来自真实 Runtime）。
//   2. 未知数据一律 '—'，空集合一律「暂无」，绝不写死假 KPI。
//   3. Secret 只渲染掩码与「是否已配置」，永远不接收也不显示完整值（需求文档三十一）。
import { createElement as h, useState, type ReactNode } from 'react'
import { describeSecretRef } from '../../integrations/im/types'
import type { SecretRef } from '../../persistence/types'

const STYLE_ID = 'dsh-org-panel-cy9-settings'

export const DASH = '—'

export const CY9_SETTINGS_CSS = String.raw`
.cy9-set-overlay{position:fixed;inset:0;z-index:210;display:grid;place-items:center;padding:20px;background:rgba(1,4,10,.76);backdrop-filter:blur(8px);--set-panel:#0a1323;--set-line:rgba(133,159,202,.17);--set-text:#edf4ff;--set-muted:#8c9bb5;--set-dim:#586780;--set-cyan:#43d9ff;--set-violet:#a36bff;--set-green:#4de2a1;--set-amber:#f0b55e;--set-red:#ff6f86;color:var(--set-text);font:13px/1.45 Inter,"Segoe UI","PingFang SC",sans-serif}
.cy9-set-overlay *{box-sizing:border-box}.cy9-set-overlay *{scrollbar-width:thin;scrollbar-color:#31415d transparent}.cy9-set-overlay *::-webkit-scrollbar{width:6px;height:6px}.cy9-set-overlay *::-webkit-scrollbar-thumb{border-radius:8px;background:#31415d}
.cy9-set{width:min(1100px,96vw);height:min(780px,90vh);display:grid;grid-template-rows:auto minmax(0,1fr);border:1px solid rgba(67,217,255,.3);border-radius:13px;background:radial-gradient(circle at 78% -30%,rgba(90,68,180,.18),transparent 46%),var(--set-panel);box-shadow:0 30px 90px rgba(0,0,0,.7);overflow:hidden}
.cy9-set-head{height:56px;display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid var(--set-line);background:rgba(5,9,20,.7)}.cy9-set-head-copy{min-width:0;margin-right:auto}.cy9-set-head b{display:block;font-size:15px}.cy9-set-head span{display:block;color:var(--set-muted);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cy9-set-close{width:30px;height:30px;border:1px solid var(--set-line);border-radius:8px;background:transparent;color:var(--set-muted);font:inherit;cursor:pointer}.cy9-set-close:hover{border-color:rgba(255,111,134,.45);color:var(--set-red)}
.cy9-set-body{min-height:0;display:grid;grid-template-columns:176px minmax(0,1fr)}
.cy9-set-nav{min-height:0;display:flex;flex-direction:column;gap:2px;padding:10px 8px;border-right:1px solid var(--set-line);background:rgba(5,10,19,.6);overflow:auto}
.cy9-set-nav-label{padding:6px 10px 4px;color:var(--set-dim);font-size:9px;letter-spacing:.12em;text-transform:uppercase}
.cy9-set-nav button{display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--set-muted);font:inherit;text-align:left;white-space:nowrap;cursor:pointer}.cy9-set-nav button:hover{background:rgba(255,255,255,.035)}.cy9-set-nav button.on{border-color:rgba(67,217,255,.4);background:linear-gradient(90deg,rgba(67,217,255,.14),rgba(163,107,255,.06));color:#e6fbff}.cy9-set-nav button em{margin-left:auto;font:700 10px ui-monospace,Consolas,monospace;font-style:normal;color:var(--set-dim)}
.cy9-set-scroll{min-height:0;display:flex;flex-direction:column;overflow:hidden}
.cy9-set-alerts{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;padding:14px 14px 0}
.cy9-set-main{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;padding:14px;overflow:auto}
.cy9-set-card{flex:none;border:1px solid var(--set-line);border-radius:10px;background:rgba(9,17,31,.9);overflow:hidden}
.cy9-set-card-head{min-height:40px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--set-line);background:rgba(13,23,39,.7)}.cy9-set-card-head b{font-size:12px}.cy9-set-card-head>span{color:var(--set-muted);font-size:10px}.cy9-set-card-actions{margin-left:auto;display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.cy9-set-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:10px 12px;border-top:1px solid rgba(133,159,202,.09)}.cy9-set-row:first-child{border-top:0}
.cy9-set-row-main{min-width:0}.cy9-set-row-main b{display:block;font-size:12px}.cy9-set-row-main b .cy9-set-pill{margin-left:6px;font-weight:400}.cy9-set-row-main>span{display:block;margin-top:2px;color:var(--set-muted);font-size:10px;word-break:break-word}
.cy9-set-row-side{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px}
.cy9-set-pill{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border:1px solid var(--set-line);border-radius:20px;background:rgba(255,255,255,.03);color:var(--set-muted);font-size:10px;white-space:nowrap}.cy9-set-pill i{font-style:normal}
.cy9-set-pill.ok{border-color:rgba(77,226,161,.35);color:var(--set-green)}.cy9-set-pill.warn{border-color:rgba(240,181,94,.35);color:var(--set-amber)}.cy9-set-pill.bad{border-color:rgba(255,111,134,.35);color:var(--set-red)}.cy9-set-pill.info{border-color:rgba(67,217,255,.35);color:var(--set-cyan)}.cy9-set-pill.off{color:var(--set-dim)}
.cy9-set-btn{height:27px;padding:0 10px;border:1px solid var(--set-line);border-radius:7px;background:rgba(255,255,255,.03);color:var(--set-text);font:inherit;font-size:11px;cursor:pointer}.cy9-set-btn:hover:not(:disabled){border-color:rgba(67,217,255,.45);background:rgba(67,217,255,.1)}.cy9-set-btn.primary{border-color:rgba(67,217,255,.4);background:rgba(67,217,255,.12);color:#dff9ff}.cy9-set-btn.danger{border-color:rgba(255,111,134,.35);background:rgba(255,111,134,.08);color:var(--set-red)}.cy9-set-btn:disabled{opacity:.45;cursor:not-allowed}
.cy9-set-action{display:inline-flex;align-items:center;gap:6px;max-width:100%}.cy9-set-result{max-width:280px;font-style:normal;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cy9-set-result.ok{color:var(--set-green)}.cy9-set-result.bad{color:var(--set-red)}
.cy9-set-empty{padding:16px 12px;color:var(--set-muted);font-size:11px;text-align:center}
.cy9-set-note{padding:8px 12px;border-top:1px dashed rgba(133,159,202,.16);color:var(--set-dim);font-size:10px}
.cy9-set-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:1px;background:rgba(133,159,202,.09)}.cy9-set-kv>div{padding:9px 12px;background:rgba(9,17,31,.94)}.cy9-set-kv label{display:block;margin-bottom:3px;color:var(--set-muted);font-size:10px}.cy9-set-kv-value{font-size:12px;word-break:break-word}
.cy9-set-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.cy9-set-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:8px 12px;border-bottom:1px solid var(--set-line)}.cy9-set-tabs button{height:27px;padding:0 11px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--set-muted);font:inherit;font-size:11px;cursor:pointer}.cy9-set-tabs button.on{border-color:rgba(163,107,255,.4);background:rgba(163,107,255,.14);color:#efe7ff}
.cy9-set-field{display:inline-flex;align-items:center;gap:6px;max-width:100%}.cy9-set-field>label{color:var(--set-muted);font-size:10px;white-space:nowrap}
.cy9-set-select,.cy9-set-input{height:27px;max-width:100%;padding:0 8px;border:1px solid var(--set-line);border-radius:7px;background:#0b1424;color:var(--set-text);font:inherit;font-size:11px}.cy9-set-select:disabled,.cy9-set-input:disabled{opacity:.45;cursor:not-allowed}
.cy9-set-toggle{height:27px;padding:0 10px;border:1px solid var(--set-line);border-radius:20px;background:rgba(255,255,255,.03);color:var(--set-muted);font:inherit;font-size:11px;cursor:pointer}.cy9-set-toggle.on{border-color:rgba(77,226,161,.4);background:rgba(77,226,161,.12);color:var(--set-green)}.cy9-set-toggle:disabled{opacity:.45;cursor:not-allowed}
.cy9-set-split{flex:1;min-height:0;display:grid;grid-template-columns:214px minmax(0,1fr);gap:12px}
.cy9-set-roster{min-height:0;overflow:auto;border:1px solid var(--set-line);border-radius:10px;background:rgba(9,17,31,.9)}
.cy9-set-roster button{width:100%;display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 10px;border:0;border-top:1px solid rgba(133,159,202,.09);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.cy9-set-roster button:first-child{border-top:0}.cy9-set-roster button:hover{background:rgba(255,255,255,.035)}.cy9-set-roster button.on{background:linear-gradient(90deg,rgba(67,217,255,.13),transparent);box-shadow:inset 3px 0 0 var(--set-cyan)}
.cy9-set-avatar{width:28px;height:28px;border-radius:7px;overflow:hidden;background:#131f34}.cy9-set-avatar img,.cy9-set-avatar .cy9-asset-fallback{width:100%;height:100%;object-fit:cover}
.cy9-set-roster-copy{min-width:0}.cy9-set-roster-copy b{display:block;font-size:11px}.cy9-set-roster-copy span{display:block;color:var(--set-muted);font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cy9-set-detail{min-height:0;display:flex;flex-direction:column;gap:12px;overflow:auto}
.cy9-set-chips{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px}.cy9-set-chips>span{padding:4px 8px;border:1px solid var(--set-line);border-radius:6px;background:rgba(255,255,255,.025);font-size:10px}
.cy9-set-banner{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:9px 12px;border:1px solid rgba(240,181,94,.3);border-radius:9px;background:rgba(240,181,94,.07);color:var(--set-amber);font-size:11px}.cy9-set-banner.bad{border-color:rgba(255,111,134,.32);background:rgba(255,111,134,.07);color:var(--set-red)}.cy9-set-banner.info{border-color:rgba(67,217,255,.28);background:rgba(67,217,255,.06);color:var(--set-cyan)}
.cy9-set-search{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px}.cy9-set-search .cy9-set-input{flex:1;min-width:180px}
@media(max-width:900px){.cy9-set{height:min(820px,94vh)}.cy9-set-body{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.cy9-set-nav{flex-direction:row;border-right:0;border-bottom:1px solid var(--set-line);overflow-x:auto}.cy9-set-nav-label{display:none}.cy9-set-nav button em{display:none}.cy9-set-split{grid-template-columns:minmax(0,1fr)}.cy9-set-roster{max-height:190px}}
@media(prefers-reduced-motion:reduce){.cy9-set-overlay *{animation:none!important;transition:none!important}}
`

export function installSettingsStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CY9_SETTINGS_CSS
  document.head.appendChild(style)
}

// ---------------------------------------------------------------------------
// 纯展示辅助
// ---------------------------------------------------------------------------

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || String(error)
  return error === undefined || error === null ? '操作失败' : String(error)
}

/** 已知数字显示数字（含 0），未知显示 '—'（需求文档四十八）。 */
export function countText(value: number | null | undefined, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : DASH
}

export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return DASH
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1 }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

export function formatDateTime(time: number | null | undefined): string {
  if (!time) return DASH
  try { return new Date(time).toLocaleString('zh-CN', { hour12: false }) } catch { return DASH }
}

export function secretRefText(ref: SecretRef | string | undefined): string {
  if (!ref) return DASH
  return /^(env|secret):.+/.test(ref) ? describeSecretRef(ref as SecretRef) : String(ref)
}

// ---------------------------------------------------------------------------
// 基础组件
// ---------------------------------------------------------------------------

export type PillTone = 'ok' | 'warn' | 'bad' | 'off' | 'info'

const PILL_GLYPH: Record<PillTone, string> = { ok: '●', warn: '⚠', bad: '✕', off: '○', info: '●' }

export function StatusPill(props: { tone: PillTone; label: string; title?: string }) {
  return h('span', { className: `cy9-set-pill ${props.tone}`, title: props.title }, h('i', null, PILL_GLYPH[props.tone]), props.label)
}

export function SettingsCard(props: { title: string; meta?: string; actions?: ReactNode; note?: string; children?: ReactNode }) {
  return h('section', { className: 'cy9-set-card' },
    h('div', { className: 'cy9-set-card-head' },
      h('b', null, props.title),
      props.meta ? h('span', null, props.meta) : null,
      props.actions ? h('div', { className: 'cy9-set-card-actions' }, props.actions) : null,
    ),
    props.children,
    props.note ? h('div', { className: 'cy9-set-note' }, props.note) : null,
  )
}

export function SettingsRow(props: { title: ReactNode; desc?: ReactNode; side?: ReactNode }) {
  return h('div', { className: 'cy9-set-row' },
    h('div', { className: 'cy9-set-row-main' }, h('b', null, props.title), props.desc ? h('span', null, props.desc) : null),
    h('div', { className: 'cy9-set-row-side' }, props.side),
  )
}

export function Empty(props: { text: string }) {
  return h('div', { className: 'cy9-set-empty' }, props.text)
}

export function KeyValues(props: { items: Array<{ label: string; value: ReactNode; mono?: boolean }> }) {
  return h('div', { className: 'cy9-set-kv' }, props.items.map((item, index) => h('div', { key: `${item.label}-${index}` },
    h('label', null, item.label),
    h('div', { className: `cy9-set-kv-value${item.mono ? ' cy9-set-mono' : ''}` }, item.value === undefined || item.value === null || item.value === '' ? DASH : item.value),
  )))
}

/** Secret 展示位：只出现引用名、来源与掩码，任何情况下都拿不到完整值（需求文档三十一）。 */
export function SecretChip(props: { secretRef?: SecretRef | string; configured?: boolean; masked?: string; source?: string }) {
  if (!props.secretRef) return h(StatusPill, { tone: 'off', label: '未配置密钥' })
  const tone: PillTone = props.configured ? 'ok' : 'bad'
  const label = props.configured ? (props.masked || '已配置') : '引用存在但未取到值'
  return h('span', { className: 'cy9-set-field' },
    h('span', { className: 'cy9-set-pill off cy9-set-mono', title: String(props.secretRef) }, secretRefText(props.secretRef)),
    h(StatusPill, { tone, label, title: props.source ? `来源：${props.source}（只显示掩码）` : '只显示掩码' }),
  )
}

/**
 * 动作按钮：run 缺失即视为「该操作尚未接线」——按钮禁用并说明原因，绝不假装成功。
 * run 返回字符串时把它当成成功提示原样显示（如「连接成功 · 412ms」）。
 */
export function ActionButton(props: {
  label: string
  run?: () => unknown | Promise<unknown>
  tone?: 'default' | 'primary' | 'danger'
  hint?: string
  confirm?: string
  busyLabel?: string
  onDone?: (ok: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const missing = typeof props.run !== 'function'
  const click = async () => {
    if (typeof props.run !== 'function' || busy) return
    if (props.confirm && typeof window !== 'undefined' && !window.confirm(props.confirm)) return
    setBusy(true)
    setResult(null)
    try {
      const value = await props.run()
      setResult({ ok: true, text: typeof value === 'string' && value ? value : '已完成' })
      props.onDone?.(true)
    } catch (error) {
      setResult({ ok: false, text: errorText(error) })
      props.onDone?.(false)
    } finally {
      setBusy(false)
    }
  }
  return h('span', { className: 'cy9-set-action' },
    h('button', {
      type: 'button', className: `cy9-set-btn ${props.tone || 'default'}`, disabled: missing || busy,
      title: missing ? (props.hint || '当前运行时未提供该操作') : undefined, onClick: click,
    }, busy ? (props.busyLabel || '处理中…') : props.label),
    result ? h('em', { className: `cy9-set-result ${result.ok ? 'ok' : 'bad'}`, title: result.text }, result.text) : null,
  )
}

/** 开关：on 为 undefined 表示运行时没给这个字段，显示 '—' 且不可点。 */
export function Toggle(props: {
  on?: boolean
  labels?: [string, string]
  onChange?: (next: boolean) => unknown | Promise<unknown>
  hint?: string
  onDone?: (ok: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [onLabel, offLabel] = props.labels || ['已启用', '已停用']
  if (typeof props.on !== 'boolean') return h('span', { className: 'cy9-set-pill off', title: props.hint || '运行时未提供该字段' }, DASH)
  const missing = typeof props.onChange !== 'function'
  const click = async () => {
    if (typeof props.onChange !== 'function' || busy) return
    setBusy(true)
    setFailed(null)
    try { await props.onChange(!props.on); props.onDone?.(true) } catch (error) { setFailed(errorText(error)); props.onDone?.(false) } finally { setBusy(false) }
  }
  return h('span', { className: 'cy9-set-action' },
    h('button', {
      type: 'button', className: `cy9-set-toggle${props.on ? ' on' : ''}`, disabled: missing || busy,
      title: missing ? (props.hint || '当前运行时未提供该操作') : undefined, onClick: click,
    }, busy ? '处理中…' : props.on ? onLabel : offLabel),
    failed ? h('em', { className: 'cy9-set-result bad', title: failed }, failed) : null,
  )
}

/** 下拉选择：onChange 缺失即只读展示当前值。 */
export function SelectField(props: {
  label?: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange?: (value: string) => unknown | Promise<unknown>
  hint?: string
  onDone?: (ok: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const missing = typeof props.onChange !== 'function'
  const change = async (next: string) => {
    if (typeof props.onChange !== 'function' || busy) return
    setBusy(true)
    setFailed(null)
    try { await props.onChange(next); props.onDone?.(true) } catch (error) { setFailed(errorText(error)); props.onDone?.(false) } finally { setBusy(false) }
  }
  return h('span', { className: 'cy9-set-field' },
    props.label ? h('label', null, props.label) : null,
    h('select', {
      className: 'cy9-set-select', value: props.value, disabled: missing || busy,
      title: missing ? (props.hint || '当前运行时未提供该操作') : undefined,
      onChange: (event: any) => change(String(event?.target?.value ?? '')),
    }, props.options.map((option) => h('option', { key: option.value, value: option.value }, option.label))),
    failed ? h('em', { className: 'cy9-set-result bad', title: failed }, failed) : null,
  )
}

export function Tabs(props: { items: Array<[string, string]>; value: string; onChange: (value: string) => void }) {
  return h('div', { className: 'cy9-set-tabs' }, props.items.map(([id, label]) => h('button', {
    key: id, type: 'button', className: props.value === id ? 'on' : '', onClick: () => props.onChange(id),
  }, label)))
}
