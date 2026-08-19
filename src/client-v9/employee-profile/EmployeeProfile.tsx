// 「赛博公司」员工档案：概览 / 成长 / 技能 / 记忆 / 插件 / 履历。
//
// 数据铁律（四十八 / 五十九条）：
//   1. 所有数字只来自 CompanySnapshot（持久化）或 CompanyRuntime（真实事件），
//      两者都没有就显示 — / 0 / 暂无，绝不写死任何 KPI。
//   2. 快照是「空 Session 也能看到历史」的唯一来源：
//      host 侧桥接层拿到快照后调 setCompanySnapshot()，本模块的所有 UI 自动 hydrate。
//   3. 本模块只读不写业务状态，不生成时间戳，不制造任务或晋升记录。
import { createElement as h, useMemo, useState, useSyncExternalStore } from 'react'
import type { OrgPanelConfig, StaffDef } from '../types'
import { roleOf } from '../selectors'
import { staffProfile } from '../asset-map'
import { AssetImage } from '../components/AssetImage'
import { companyEventBus } from '../../runtime/event-bus'
import { EMPLOYEE_RUNTIME_LABEL, type CompanyRuntime, type EmployeeRuntimeState } from '../../runtime/company-events'
import type { CompanySnapshot, EmployeeMemory, EmployeeSnapshot, MemoryKind } from '../../persistence/types'
import { OverviewTab } from './OverviewTab'
import { GrowthTab } from './GrowthTab'
import { SkillsTab } from './SkillsTab'
import { MemoryTab } from './MemoryTab'
import { PluginsTab } from './PluginsTab'
import { HistoryTab } from './HistoryTab'

// ---------------------------------------------------------------------------
// CompanySnapshot 客户端存放点
// 独立于会话节点流：Session 是空的也不影响，只要 host 推过一次快照，档案就有历史数据。
// ---------------------------------------------------------------------------

let snapshotState: CompanySnapshot | null = null
const snapshotListeners = new Set<() => void>()

/** host→client 桥接层唯一入口：拿到新的 CompanySnapshot 就推进来。传 null 表示尚未取到。 */
export function setCompanySnapshot(next: CompanySnapshot | null): void {
  if (snapshotState === next) return
  snapshotState = next
  for (const listener of [...snapshotListeners]) {
    try { listener() } catch { /* 单个订阅者出错不许拖垮整次 hydrate */ }
  }
}

export function readCompanySnapshot(): CompanySnapshot | null { return snapshotState }

export function subscribeCompanySnapshot(listener: () => void): () => void {
  snapshotListeners.add(listener)
  return () => { snapshotListeners.delete(listener) }
}

/** React 订阅入口。引用稳定，可直接喂 useSyncExternalStore。 */
export function useCompanySnapshot(): CompanySnapshot | null {
  return useSyncExternalStore(subscribeCompanySnapshot, readCompanySnapshot, readCompanySnapshot)
}

/** 校验并接收一份 host 下发的快照（对象或 JSON 文本）。结构不合法直接拒绝，不半信半疑地渲染。 */
export function applyCompanySnapshot(raw: unknown): boolean {
  let value: any = raw
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw) } catch { return false }
  }
  if (!value || typeof value !== 'object') return false
  if (Number(value.version) !== 2 || !Array.isArray(value.employees)) return false
  setCompanySnapshot(value as CompanySnapshot)
  return true
}

export function employeeSnapshotOf(snapshot: CompanySnapshot | null, employeeId: string): EmployeeSnapshot | null {
  if (!snapshot) return null
  return snapshot.employees.find((item) => item.employeeId === employeeId) || null
}

// ---------------------------------------------------------------------------
// Company Event Bus 订阅（真实事件驱动的当前状态）
// ---------------------------------------------------------------------------

const subscribeBus = (listener: () => void) => companyEventBus.subscribe(listener)
const readBus = (): CompanyRuntime => companyEventBus.snapshot()

export function useCompanyRuntime(): CompanyRuntime {
  return useSyncExternalStore(subscribeBus, readBus, readBus)
}

// ---------------------------------------------------------------------------
// 记忆分页加载
// ---------------------------------------------------------------------------

export type MemoryPageQuery = { employeeId: string; kind: MemoryKind; offset: number; limit: number }
export type MemoryPage = { items: EmployeeMemory[]; total: number; hasMore: boolean }
/** 由 host 桥接层提供的真实分页加载器。不提供时档案只翻快照里已带回的那几条，并如实说明。 */
export type MemoryLoader = (query: MemoryPageQuery) => Promise<MemoryPage>

// ---------------------------------------------------------------------------
// 样式：自带一份幂等注入，员工档案与成长轨迹一起维护。
// ---------------------------------------------------------------------------

const PROFILE_STYLE_ID = 'dsh-org-panel-cy9-profile'

export const PROFILE_CSS = String.raw`
.cy9-ep-overlay{position:fixed;inset:0;z-index:210;display:grid;place-items:center;padding:20px;background:rgba(1,4,10,.76);backdrop-filter:blur(8px)}
.cy9-ep{position:relative;display:flex;flex-direction:column;width:min(900px,96vw);max-height:88vh;border:1px solid rgba(67,217,255,.3);border-radius:12px;background:#0a1323;box-shadow:0 30px 90px rgba(0,0,0,.7);overflow:hidden}
.cy9-ep-close{position:absolute;right:12px;top:12px;z-index:3;border:0;background:transparent;color:var(--muted);font-size:11px;cursor:pointer}
.cy9-ep-head{display:grid;grid-template-columns:88px minmax(0,1fr);gap:14px;padding:16px 16px 12px;border-bottom:1px solid var(--line)}
.cy9-ep-head>img,.cy9-ep-head>.cy9-asset-fallback{width:88px;height:88px;border-radius:12px;object-fit:contain;background:#07101e}
.cy9-ep-id{min-width:0;display:flex;flex-direction:column;gap:5px;justify-content:center}
.cy9-ep-name{display:flex;align-items:baseline;gap:9px;padding-right:44px}
.cy9-ep-name b{font-size:20px}.cy9-ep-name span{min-width:0;color:var(--cyan);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cy9-ep-lv{margin-left:auto;flex:none;padding:2px 8px;border:1px solid rgba(163,107,255,.35);border-radius:999px;background:rgba(163,107,255,.1);color:#efe7ff;font:700 10px ui-monospace,Consolas,monospace}
.cy9-ep-state{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:10px}
.cy9-ep-dot{display:inline-block;flex:none;width:7px;height:7px;border-radius:50%;background:#667085;vertical-align:middle}
.cy9-ep-dot.working,.cy9-ep-dot.available{background:var(--green);box-shadow:0 0 8px var(--green)}
.cy9-ep-dot.blocked,.cy9-ep-dot.missing{background:var(--red)}
.cy9-ep-dot.meeting,.cy9-ep-dot.degraded,.cy9-ep-dot.installing{background:var(--amber)}
.cy9-ep-dot.vision,.cy9-ep-dot.done{background:var(--cyan)}
.cy9-ep-bar{height:4px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden}
.cy9-ep-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--cyan),var(--violet))}
.cy9-ep-xp{display:grid;gap:4px}.cy9-ep-xp em{color:var(--dim);font-size:9px;font-style:normal}
.cy9-ep-tabs{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;padding:8px 12px;border-bottom:1px solid var(--line);background:#0b1423}
.cy9-ep-tabs button{height:30px;border:0;border-radius:6px;background:transparent;color:var(--muted);font-size:11px;cursor:pointer}
.cy9-ep-tabs button.on{background:rgba(67,217,255,.12);color:#dff8ff}
.cy9-ep-body{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 16px}
.cy9-ep-foot{display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px;border-top:1px solid var(--line)}
.cy9-ep-foot button{padding:8px 12px;border:1px solid rgba(67,217,255,.3);border-radius:7px;background:rgba(67,217,255,.07);font-size:11px;cursor:pointer}
.cy9-ep-foot em{margin-left:auto;align-self:center;color:var(--dim);font-size:9px;font-style:normal}
.cy9-ep-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.cy9-ep-kpis+.cy9-ep-kpis{margin-top:8px}
.cy9-ep-kpi{padding:10px 6px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.02);text-align:center}
.cy9-ep-kpi b{display:block;font:800 18px ui-monospace,Consolas,monospace}
.cy9-ep-kpi span{color:var(--muted);font-size:9px}
.cy9-ep-kpi em{display:block;margin-top:2px;color:var(--dim);font-size:8px;font-style:normal}
.cy9-ep-kpi.good b{color:var(--green)}.cy9-ep-kpi.bad b{color:var(--red)}.cy9-ep-kpi.warn b{color:var(--amber)}
.cy9-ep-sec{margin-top:14px}
.cy9-ep-sec>label{display:flex;align-items:center;gap:6px;margin-bottom:6px;color:var(--muted);font-size:10px}
.cy9-ep-sec>label i{margin-left:auto;color:var(--dim);font-size:9px;font-style:normal}
.cy9-ep-chips{display:flex;flex-wrap:wrap;gap:6px}
.cy9-ep-chips span{padding:4px 7px;border:1px solid var(--line);border-radius:6px;background:rgba(255,255,255,.025);font-size:10px}
.cy9-ep-chips .mono{color:var(--muted);font-family:ui-monospace,Consolas,monospace}
.cy9-ep-empty{padding:22px 12px;border:1px dashed var(--line);border-radius:8px;color:var(--muted);font-size:10px;line-height:1.8;text-align:center}
.cy9-ep-note{margin-top:8px;color:var(--dim);font-size:9px;text-align:center}
.cy9-ep-line{display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.02);font-size:10px}
.cy9-ep-line b{font-size:11px}.cy9-ep-line span{color:var(--muted)}.cy9-ep-line em{margin-left:auto;color:var(--dim);font-size:9px;font-style:normal}
.cy9-ep-item{display:block;width:100%;margin-bottom:8px;padding:10px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.02);color:inherit;text-align:left}
button.cy9-ep-item{cursor:pointer}
button.cy9-ep-item.on{border-color:rgba(163,107,255,.4);background:rgba(163,107,255,.07)}
.cy9-ep-item-head{display:flex;align-items:center;gap:8px}
.cy9-ep-item-head b{font-size:11px}
.cy9-ep-item-head span{color:var(--muted);font-size:9px}
.cy9-ep-item-head .lv{margin-left:auto;flex:none;color:var(--violet);font:700 10px ui-monospace,Consolas,monospace}
.cy9-ep-item p{margin:6px 0 0;color:var(--muted);font-size:10px}
.cy9-ep-item .cy9-ep-bar{margin-top:7px}
.cy9-ep-ev{display:grid;grid-template-columns:14px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 2px;border-top:1px solid rgba(133,159,202,.09);font-size:10px}
.cy9-ep-ev i{font-style:normal}.cy9-ep-ev i.ok{color:var(--green)}.cy9-ep-ev i.no{color:var(--red)}
.cy9-ep-ev em{color:var(--dim);font-size:9px;font-style:normal;white-space:nowrap}
.cy9-ep-groups{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.cy9-ep-groups button{padding:5px 9px;border:1px solid var(--line);border-radius:999px;background:transparent;color:var(--muted);font-size:10px;cursor:pointer}
.cy9-ep-groups button.on{border-color:rgba(67,217,255,.45);background:rgba(67,217,255,.1);color:#dff8ff}
.cy9-ep-groups button[disabled]{opacity:.4;cursor:default}
.cy9-ep-more{width:100%;height:30px;border:1px dashed var(--line);border-radius:7px;background:transparent;color:var(--muted);font-size:10px;cursor:pointer}
.cy9-ep-more[disabled]{opacity:.5;cursor:default}
.cy9-ep-mem p{margin:0 0 5px;font-size:11px;line-height:1.6}
.cy9-ep-mem .tags{display:inline-flex;flex-wrap:wrap;gap:4px;margin-left:6px;vertical-align:middle}
.cy9-ep-mem .tags span{padding:0 4px;border-radius:3px;background:rgba(255,255,255,.05);color:var(--muted);font-size:8px}
.cy9-ep-day{margin:14px 0 4px;color:var(--dim);font-size:9px;letter-spacing:.08em}
.cy9-ep-day:first-child{margin-top:0}
.cy9-ep-task{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:9px;align-items:start;padding:9px 2px;border-top:1px solid rgba(133,159,202,.09)}
.cy9-ep-task>time{color:var(--dim);font:10px ui-monospace,Consolas,monospace}
.cy9-ep-task b{display:block;font-size:11px;font-weight:600}
.cy9-ep-task q{display:block;margin-top:2px;color:var(--muted);font-size:9px;quotes:none}
.cy9-ep-src{display:inline-block;margin-right:6px;padding:1px 5px;border-radius:4px;background:rgba(94,141,255,.14);color:var(--blue);font-size:8px;vertical-align:middle}
.cy9-ep-out{flex:none;padding:2px 6px;border-radius:4px;background:rgba(96,116,149,.14);color:var(--muted);font-size:9px;white-space:nowrap}
.cy9-ep-out.success,.cy9-ep-out.available{color:var(--green)}.cy9-ep-out.failed,.cy9-ep-out.missing{color:var(--red)}.cy9-ep-out.blocked,.cy9-ep-out.degraded{color:var(--amber)}.cy9-ep-out.partial{color:var(--cyan)}.cy9-ep-out.disabled{color:var(--dim)}
.cy9-ep-act{margin-top:8px;padding:5px 8px;border:1px solid rgba(163,107,255,.3);border-radius:5px;background:rgba(163,107,255,.08);color:inherit;font-size:9px;cursor:pointer}
/* 成长页：个人空间是持久化能力的视觉投影；时间线只画真实带时间戳的事实。 */
.cy9-growth-space{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(0,1.4fr);gap:10px;padding:10px;border:1px solid rgba(163,107,255,.22);border-radius:10px;background:linear-gradient(135deg,rgba(163,107,255,.07),rgba(67,217,255,.025))}
.cy9-growth-room{display:flex;flex-direction:column;justify-content:center;min-height:92px;padding:10px;border:1px solid rgba(67,217,255,.16);border-radius:8px;background:rgba(4,11,22,.65)}
.cy9-growth-room b{color:#dff8ff;font-size:14px}.cy9-growth-room span{margin-top:5px;color:var(--cyan);font-size:9px}.cy9-growth-room small{margin-top:8px;color:var(--dim);font-size:8px;line-height:1.5}
.cy9-growth-equipment{display:flex;align-content:flex-start;flex-wrap:wrap;gap:6px}
.cy9-growth-equipment span{align-self:flex-start;padding:5px 7px;border:1px solid var(--line);border-radius:6px;background:rgba(255,255,255,.025);font-size:9px}
.cy9-growth-equipment span.on{border-color:rgba(98,226,163,.25);color:#bff8dc}.cy9-growth-equipment span.off{opacity:.55}.cy9-growth-equipment span.skill{border-color:rgba(163,107,255,.25);color:#e8ddff}
.cy9-career-timeline{position:relative;margin-top:2px;padding-left:4px}
.cy9-career-timeline:before{content:'';position:absolute;left:14px;top:10px;bottom:10px;width:1px;background:linear-gradient(180deg,rgba(67,217,255,.32),rgba(163,107,255,.12))}
.cy9-career-row{position:relative;display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:8px;align-items:start;padding:9px 0;border-bottom:1px solid rgba(133,159,202,.08)}
.cy9-career-icon{position:relative;z-index:1;display:grid;place-items:center;width:22px;height:22px;margin-left:0;border:1px solid rgba(133,159,202,.24);border-radius:50%;background:#0a1323;color:var(--muted);font-size:10px}
.cy9-career-row.ok .cy9-career-icon{border-color:rgba(98,226,163,.4);color:var(--green)}.cy9-career-row.warn .cy9-career-icon{border-color:rgba(255,190,70,.4);color:var(--amber)}.cy9-career-row.bad .cy9-career-icon{border-color:rgba(255,94,105,.4);color:var(--red)}.cy9-career-row.info .cy9-career-icon{border-color:rgba(67,217,255,.4);color:var(--cyan)}
.cy9-career-main{min-width:0}.cy9-career-title{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.cy9-career-title b{font-size:10px}.cy9-career-main p{margin:4px 0 0;color:var(--muted);font-size:9px;line-height:1.5}.cy9-career-row>time{color:var(--dim);font:9px ui-monospace,Consolas,monospace;white-space:nowrap}
.cy9-rail-emp{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:8px;align-items:center;width:100%;padding:8px 9px;border:0;border-bottom:1px solid rgba(133,159,202,.09);background:transparent;color:inherit;text-align:left;cursor:pointer}
.cy9-rail-emp:hover{background:rgba(255,255,255,.03)}
.cy9-rail-emp>img,.cy9-rail-emp>.cy9-asset-fallback{width:28px;height:28px;border-radius:6px;object-fit:cover}
.cy9-rail-emp b{display:block;font-size:10px}
.cy9-rail-emp em{color:var(--dim);font-size:8px;font-style:normal}
.cy9-rail-emp .lv{flex:none;color:var(--violet);font:700 10px ui-monospace,Consolas,monospace}
.cy9-rail .cy9-status-card{flex:0 0 auto}
.cy9-rail-sub{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:0 8px 8px}
.cy9-rail-sub>div{padding:6px 4px;border-radius:6px;background:rgba(255,255,255,.025);text-align:center}
.cy9-rail-sub b{display:block;font:800 12px ui-monospace,Consolas,monospace}
.cy9-rail-sub span{color:var(--muted);font-size:8px}
@media(max-width:720px){.cy9-ep-head{grid-template-columns:1fr}.cy9-ep-head>img,.cy9-ep-head>.cy9-asset-fallback{margin:auto}.cy9-ep-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.cy9-ep-tabs{grid-template-columns:repeat(3,1fr)}.cy9-growth-space{grid-template-columns:1fr}.cy9-career-row{grid-template-columns:28px minmax(0,1fr)}.cy9-career-row>time{grid-column:2}}
`

/** 幂等注入档案样式。多次调用只会插一次 <style>。 */
export function installProfileStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(PROFILE_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = PROFILE_STYLE_ID
  style.textContent = PROFILE_CSS
  document.head.appendChild(style)
}

installProfileStyles()

// ---------------------------------------------------------------------------
// 档案本体
// ---------------------------------------------------------------------------

export type ProfileTab = 'overview' | 'growth' | 'skills' | 'memory' | 'plugins' | 'history'

const TAB_LABELS: Array<[ProfileTab, string]> = [
  ['overview', '概览'], ['growth', '成长'], ['skills', '技能'], ['memory', '记忆'], ['plugins', '插件'], ['history', '履历'],
]

export function EmployeeProfile(props: {
  staff: StaffDef
  config: OrgPanelConfig
  onClose: () => void
  onTalk: (staff: StaffDef) => void
  onDraft: (text: string) => void
  /** 不传则自动取全局快照；传 null 表示调用方明确知道没有快照。 */
  snapshot?: EmployeeSnapshot | null
  /** 不传则自动读 Company Event Bus。 */
  runtime?: EmployeeRuntimeState | null
  loadMemories?: MemoryLoader
}) {
  const { staff, config, onClose, onTalk, onDraft, loadMemories } = props
  installProfileStyles()
  const [tab, setTab] = useState<ProfileTab>('overview')
  const company = useCompanySnapshot()
  const busRuntime = useCompanyRuntime()
  const snapshot = props.snapshot !== undefined ? props.snapshot : employeeSnapshotOf(company, staff.id)
  const runtime = props.runtime !== undefined ? props.runtime : busRuntime.employees[staff.id] || null
  const role = useMemo(() => roleOf(staff.roleId, config.roles || []), [staff.roleId, config.roles])
  const level = snapshot?.level
  const stateLabel = runtime ? runtime.activity || EMPLOYEE_RUNTIME_LABEL[runtime.status] : '暂无实时事件'

  return h('div', { className: 'cy9-ep-overlay', onClick: onClose },
    h('div', { className: 'cy9-ep', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${staff.name} 员工档案`, onClick: (event: any) => event.stopPropagation() },
      h('button', { type: 'button', className: 'cy9-ep-close', onClick: onClose }, '关闭'),
      h('div', { className: 'cy9-ep-head' },
        h(AssetImage, { src: staffProfile(staff.id), alt: staff.name, fallback: staff.name, loading: 'eager' }),
        h('div', { className: 'cy9-ep-id' },
          h('div', { className: 'cy9-ep-name' },
            h('b', null, staff.name),
            h('span', null, `${staff.role} · ${staff.department || '赛博公司'}`),
            h('span', { className: 'cy9-ep-lv' }, level ? `Lv.${level.level}` : 'Lv.—'),
          ),
          h('div', { className: 'cy9-ep-state' }, h('i', { className: `cy9-ep-dot ${runtime?.status || ''}` }), stateLabel),
          h('div', { className: 'cy9-ep-xp' },
            h('div', { className: 'cy9-ep-bar' }, h('i', { style: { width: `${Math.round((level?.progress || 0) * 100)}%` } })),
            h('em', null, level ? `${level.title} · XP ${snapshot?.xp ?? 0} · 升到 Lv.${level.level + 1} 已完成 ${Math.round(level.progress * 100)}%` : '尚未取到持久化档案，等级与经验暂不可用'),
          ),
        ),
      ),
      h('div', { className: 'cy9-ep-tabs' }, TAB_LABELS.map(([id, label]) => h('button', {
        key: id, type: 'button', className: tab === id ? 'on' : '', onClick: () => setTab(id),
      }, label))),
      h('div', { className: 'cy9-ep-body' },
        tab === 'overview' ? h(OverviewTab, { key: staff.id, staff, role, snapshot, runtime }) : null,
        tab === 'growth' ? h(GrowthTab, { key: staff.id, snapshot }) : null,
        tab === 'skills' ? h(SkillsTab, { key: staff.id, snapshot }) : null,
        tab === 'memory' ? h(MemoryTab, { key: staff.id, employeeId: staff.id, snapshot, loadMemories }) : null,
        tab === 'plugins' ? h(PluginsTab, { key: staff.id, staff, snapshot, onDraft }) : null,
        tab === 'history' ? h(HistoryTab, { key: staff.id, snapshot }) : null,
      ),
      h('div', { className: 'cy9-ep-foot' },
        h('button', { type: 'button', onClick: () => { onTalk(staff); onClose() } }, `@${staff.name} 直接对话`),
        h('button', { type: 'button', onClick: () => { onDraft(`@${staff.name} 结合你的长期记忆、任务履历和真实技能证据，复盘最近工作并提出一个最值得补强的能力；先扫描公司现有能力和插件，不要虚构升级。`); onClose() } }, '安排成长复盘'),
        h('em', null, snapshot ? `档案更新于 ${new Date(snapshot.updatedAt).toLocaleString('zh-CN')}` : '档案数据来自本机 evolution.json'),
      ),
    ),
  )
}
