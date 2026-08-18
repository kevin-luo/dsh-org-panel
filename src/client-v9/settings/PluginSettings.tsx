// 公司设置 → 插件（需求文档八 / 九 / 四十）。
// 四个子页：已安装 / 市场 / 审批记录 / 权限。
// 状态严格按 Plugin Runtime 的真实校验结果显示 Available / Degraded / Missing / Disabled，
// 未验证的插件绝不显示成「已学会」（需求文档五十九）。
// 审批口径（需求文档四十八）：面板拿到 actions.approve 时，「批准」就是真的能点 ——
// 它经 `/org-panel` RPC 把**老板的这一次点击**送到 host 的 PluginRuntime.approve。
// 拿不到时说明这次运行时没挂上那条通道，那就不摆一个禁用按钮假装「这里能批」，
// 而是把当下真正走得通的批准方式写出来（见 APPROVAL_OFFLINE_HINT）。
// 安全边界一个字都没放宽：这条通道只有浏览器里的人类能发起，LLM 手上只有 Tool Registry。
import { createElement as h, useState } from 'react'
import type { PluginBinding, PluginStatus } from '../../persistence/types'
import type { InstallRequest, InstallRequestStatus } from '../../capabilities/plugin-runtime'
import type { MarketPluginItem } from '../types'
import { ActionButton, DASH, Empty, KeyValues, SettingsCard, SettingsRow, StatusPill, Tabs, countText, formatDateTime, type PillTone } from './styles'

const PLUGIN_TONE: Record<PluginStatus, PillTone> = { available: 'ok', degraded: 'warn', missing: 'bad', disabled: 'off' }
const PLUGIN_LABEL: Record<PluginStatus, string> = { available: 'Available', degraded: 'Degraded', missing: 'Missing', disabled: 'Disabled' }

const REQUEST_TONE: Record<InstallRequestStatus, PillTone> = {
  pending: 'warn', approved: 'info', rejected: 'off', installed: 'info', verified: 'ok', failed: 'bad', expired: 'off',
}
const REQUEST_LABEL: Record<InstallRequestStatus, string> = {
  pending: '等待老板审批', approved: '已批准', rejected: '已拒绝', installed: '已安装待验证', verified: '已验证学会', failed: '失败', expired: '已过期',
}

export type InstalledPluginRow = PluginBinding & {
  /** 绑定了这个插件的员工（名字或 id，由 host 决定）。 */
  employees?: string[]
  missingTools?: string[]
  skills?: string[]
}

/** 未知 ≠ 没有。审批台账没下发时用它，绝不显示成「暂无待审批」。 */
const UNKNOWN = '未知'

/**
 * 面板此刻批不了时，必须给出真正走得通的路径，而不是把老板指回这个页面。
 *
 * 注意措辞的边界：**不是「DSH 没有这个能力」**（DSH 的 client↔host 通用 RPC 一直都在，
 * 就是 ctx.connection.rpc），而是「当前运行时没有提供 `/org-panel` 频道」。
 * 前一种说法是错的，而且它同时劝退老板和下一个改这块代码的人。
 */
export const APPROVAL_OFFLINE_HINT = [
  '面板此刻批不了：当前运行时没有提供 /org-panel RPC 频道（插件 host 未挂载，或这个部署形态没有 httpServer），浏览器里的按钮到不了 Plugin Runtime。',
  'host 把这条频道挂上之后，这里会直接出现真正能点的「批准」按钮 —— 那一下点击仍然是人类动作，模型永远走不到这条路。',
  '在通道恢复之前，走得通的批准方式有两条，两条也都是人类动作：',
  '① 在 cordis 配置的 pluginInstall.preapproved 里写上这个包名并重启，员工再次提交同一个包时会被自动批准；',
  '② 由运维在宿主进程里调用 PluginRuntime.approve(requestId, { by: "老板", channel: "cli" })。',
].join('\n')

/** 通道还在探测中：既不能说「能批」，也不能说「批不了」。 */
export const APPROVAL_PROBING_HINT = '正在确认面板与 host 之间的 /org-panel 通道是否可用，稍等一下再看这一页。'

export type PluginSettingsData = {
  installed?: InstalledPluginRow[]
  approvals?: InstallRequest[]
  /** 市场结果只能来自真实搜索（staff_plugin_market_search 或 actions.search），不内置任何清单。 */
  market?: MarketPluginItem[]
  health?: { checkedAt?: number; catalogSize?: number; changed?: number }
  /** true = 面板与 host 的 `/org-panel` 通道还在探测中，此刻既不能说能批也不能说批不了。 */
  channelProbing?: boolean
  /**
   * host 明确回答「这一项本次运行拿不到」时给的真实原因（如插件运行时没挂载）。
   * 有它就原样上屏 —— 「拿不到」和「一条都没有」是两回事，不许合并。
   */
  reason?: string
  loaded?: boolean
}

export type PluginSettingsActions = {
  search?(query: string): unknown | Promise<unknown>
  requestInstall?(item: MarketPluginItem): unknown | Promise<unknown>
  approve?(requestId: string): unknown | Promise<unknown>
  reject?(requestId: string): unknown | Promise<unknown>
  verify?(requestId: string): unknown | Promise<unknown>
  healthCheck?(): unknown | Promise<unknown>
}

/** 按真实绑定状态分桶。degraded 永远单列，绝不并进「可用」（migrations.pluginCount 把两者合并过，UI 不跟）。 */
export function countByStatus(rows: Array<{ status: PluginStatus }> | undefined): Record<PluginStatus, number> & { total: number } {
  const counts = { available: 0, degraded: 0, missing: 0, disabled: 0, total: 0 }
  for (const row of rows || []) {
    if (row && row.status in counts) counts[row.status] += 1
    counts.total += 1
  }
  return counts
}

function InstalledTab(props: { data?: PluginSettingsData; actions?: PluginSettingsActions; onRefresh?: () => void }) {
  const loaded = Array.isArray(props.data?.installed)
  const rows = props.data?.installed || []
  const counts = countByStatus(rows)
  const health = props.data?.health
  return h(SettingsCard, {
    title: '已安装',
    meta: loaded ? (rows.length ? `共 ${counts.total} 个 · 可用 ${counts.available} · 降级 ${counts.degraded} · 缺失 ${counts.missing} · 停用 ${counts.disabled}` : '暂无') : '未读取',
    actions: h(ActionButton, {
      label: '健康检查', busyLabel: '检查中…',
      run: props.actions?.healthCheck ? (() => props.actions!.healthCheck!()) : undefined,
      hint: '当前运行时未提供插件健康检查', onDone: () => props.onRefresh?.(),
    }),
    note: health?.checkedAt
      ? `最近一次健康检查：${formatDateTime(health.checkedAt)} · 工具目录 ${countText(health.catalogSize)} 个 · 状态变化 ${countText(health.changed)} 处`
      : '状态来自 Tool Registry 实时校验：工具消失即 Missing，部分工具缺失即 Degraded。',
  },
    rows.length ? rows.map((row) => h(SettingsRow, {
      key: `${row.pluginId}-${(row.employees || []).join(',')}`,
      title: row.packageName || row.pluginId,
      desc: [
        `${row.source}${row.version ? ` · v${row.version}` : ''}`,
        `工具 ${row.tools.length ? row.tools.join('、') : DASH}`,
        row.missingTools?.length ? `缺失 ${row.missingTools.join('、')}` : '',
        row.employees?.length ? `员工 ${row.employees.join('、')}` : '',
        row.skills?.length ? `技能 ${row.skills.join('、')}` : '',
        `安装 ${formatDateTime(row.installedAt)} · 验证 ${formatDateTime(row.lastVerifiedAt)}`,
      ].filter(Boolean).join(' · '),
      side: h(StatusPill, { tone: PLUGIN_TONE[row.status], label: PLUGIN_LABEL[row.status] }),
    })) : h(Empty, { text: loaded ? '暂无已安装插件。员工缺能力时会先搜市场并提交安装申请，等你批准。' : '面板没有拿到插件绑定（需要 host 下发 CompanySnapshot），这里不代表「一个插件都没装」。点右上角「刷新」重新读取一次；仍然读不到就是 host 侧没挂上 /org-panel 频道。' }),
  )
}

function MarketTab(props: { data?: PluginSettingsData; actions?: PluginSettingsActions; onRefresh?: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MarketPluginItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const rows = results || props.data?.market || []
  const search = async () => {
    if (!props.actions?.search || busy) return
    setBusy(true)
    setFailed(null)
    try {
      const value = await props.actions.search(query.trim())
      setResults(Array.isArray(value) ? (value as MarketPluginItem[]) : [])
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return h(SettingsCard, {
    title: '市场',
    meta: rows.length ? `${rows.length} 个结果` : '暂无结果',
    note: '市场结果只来自真实搜索。批准安装是人类动作：这里提交的是申请，安装、验证、Smoke Test 全部通过后才会变成员工技能。',
  },
    h('div', { className: 'cy9-set-search' },
      h('input', {
        className: 'cy9-set-input', value: query, placeholder: '搜索 DSH 插件市场，例如 github / browser / image',
        disabled: !props.actions?.search || busy,
        title: props.actions?.search ? undefined : '当前运行时未提供市场搜索；可让员工执行 staff_plugin_market_search，结果会出现在这里',
        onChange: (event: any) => setQuery(String(event?.target?.value ?? '')),
        onKeyDown: (event: any) => { if (event?.key === 'Enter') search() },
      }),
      h('button', {
        type: 'button', className: 'cy9-set-btn primary', disabled: !props.actions?.search || busy,
        title: props.actions?.search ? undefined : '当前运行时未提供市场搜索', onClick: search,
      }, busy ? '搜索中…' : '搜索'),
      failed ? h('em', { className: 'cy9-set-result bad', title: failed }, failed) : null,
    ),
    rows.length ? rows.map((item) => h(SettingsRow, {
      key: item.name,
      title: item.name,
      desc: [item.description || '', item.owner ? `作者 ${item.owner}` : '', typeof item.stars === 'number' ? `★ ${item.stars}` : '', item.install ? `安装命令 ${item.install}` : '', item.url || ''].filter(Boolean).join(' · '),
      side: h(ActionButton, {
        label: '提交安装申请',
        run: props.actions?.requestInstall ? (() => props.actions!.requestInstall!(item)) : undefined,
        hint: '当前运行时未提供安装申请提交能力', onDone: () => props.onRefresh?.(),
      }),
    })) : h(Empty, { text: props.actions?.search ? '暂无搜索结果。在上面的搜索框里输入关键词（如 github / browser / image）后回车，结果只来自真实市场搜索。' : '暂无搜索结果。让员工执行 staff_plugin_market_search 搜一次，真实结果会出现在这里。' }),
  )
}

function ApprovalTab(props: { data?: PluginSettingsData; actions?: PluginSettingsActions; onRefresh?: () => void }) {
  const loaded = Array.isArray(props.data?.approvals)
  const rows = [...(props.data?.approvals || [])].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
  const canApprove = typeof props.actions?.approve === 'function'
  // 通道还没探明时不许下任何结论：既不摆「批准」，也不宣布「此处无法审批」。
  const probing = !canApprove && props.data?.channelProbing === true
  const [openId, setOpenId] = useState<string | null>(null)
  return h(SettingsCard, {
    title: '审批记录',
    meta: loaded ? (rows.length ? `${rows.length} 条 · 待审批 ${rows.filter((item) => item.status === 'pending').length}` : '暂无') : '未读取',
    note: '批准只能来自人类点击：任何工具参数都无法把一条申请变成已批准。面板上的「批准」经 /org-panel RPC 把你的这次点击送到 host，模型够不到这条通道。',
  },
    canApprove ? null : probing
      ? h('div', { className: 'cy9-set-banner info' }, APPROVAL_PROBING_HINT)
      : h('div', { className: 'cy9-set-banner' }, APPROVAL_OFFLINE_HINT.split('\n').map((line, index) => h('div', { key: index }, line))),
    rows.length ? rows.map((request) => {
      const open = openId === request.requestId
      return h('div', { key: request.requestId },
        h(SettingsRow, {
          title: `${request.pluginName}`,
          desc: [
            request.packageName,
            request.employeeName || request.employeeId ? `申请人 ${request.employeeName || request.employeeId}` : '',
            `提交 ${formatDateTime(request.createdAt)}`,
            request.decision ? `${request.decision.by} 于 ${formatDateTime(request.decision.at)} 处理（${request.decision.channel}）` : '',
          ].filter(Boolean).join(' · '),
          side: [
            h(StatusPill, { key: 'state', tone: REQUEST_TONE[request.status], label: REQUEST_LABEL[request.status] }),
            h('button', { key: 'toggle', type: 'button', className: 'cy9-set-btn', onClick: () => setOpenId(open ? null : request.requestId) }, open ? '收起' : '详情'),
            // 没有写通道时不摆禁用按钮：那等于告诉老板「这里本该能批」。直接说明去哪儿批。
            request.status === 'pending' && !canApprove
              ? h(StatusPill, {
                key: 'offline', tone: 'off',
                label: probing ? '通道确认中' : '此处无法审批',
                title: probing ? APPROVAL_PROBING_HINT : APPROVAL_OFFLINE_HINT,
              })
              : null,
            request.status === 'pending' && canApprove ? h(ActionButton, {
              key: 'approve', label: '批准', tone: 'primary',
              confirm: `确认批准安装「${request.pluginName}」？将执行：${request.installCommand}`,
              run: () => props.actions!.approve!(request.requestId),
              onDone: () => props.onRefresh?.(),
            }) : null,
            request.status === 'pending' && props.actions?.reject ? h(ActionButton, {
              key: 'reject', label: '拒绝', tone: 'danger',
              run: () => props.actions!.reject!(request.requestId),
              onDone: () => props.onRefresh?.(),
            }) : null,
            request.status === 'installed' || request.status === 'failed' ? h(ActionButton, {
              key: 'verify', label: '重新验证',
              run: props.actions?.verify ? (() => props.actions!.verify!(request.requestId)) : undefined,
              hint: '当前运行时未提供插件验证能力', onDone: () => props.onRefresh?.(),
            }) : null,
          ],
        }),
        open ? h(KeyValues, {
          items: [
            { label: '用途', value: request.purpose },
            { label: '来源', value: `${request.source}${request.repository ? ` · ${request.repository}` : ''}${typeof request.stars === 'number' ? ` · ★ ${request.stars}` : ''}` },
            { label: '安装命令', value: request.installCommand, mono: true },
            { label: '期望工具', value: request.expectedTools.length ? request.expectedTools.join('、') : DASH, mono: true },
            { label: '权限', value: request.permissions.length ? request.permissions.join('、') : DASH },
            { label: '风险', value: request.risks.length ? request.risks.join('、') : DASH },
            { label: '目标技能', value: `${request.skillName}${request.category ? ` · ${request.category}` : ''}` },
            { label: '安装结果', value: request.install ? `${request.install.ok ? '成功' : '失败'} · ${request.install.via} · ${formatDateTime(request.install.at)}${request.install.error ? ` · ${request.install.error}` : ''}` : DASH },
            {
              label: '验证结果',
              value: request.verification
                ? `${PLUGIN_LABEL[request.verification.status]} · 工具到位 ${request.verification.toolsFound.length}/${request.verification.toolsFound.length + request.verification.toolsMissing.length}`
                  + ` · Smoke ${request.verification.smoke.ran ? (request.verification.smoke.ok ? '通过' : `未通过（${request.verification.smoke.error || '未说明'}）`) : '未执行'}`
                  + ` · ${request.verification.learned ? '已计入技能' : '未计入技能'}`
                : DASH,
            },
          ],
        }) : null,
      )
    }) : h(Empty, { text: loaded ? '暂无审批记录。员工在市场里找到需要的插件后会提交安装申请，申请会出现在这里等你批准。' : '面板没有拿到审批台账（host 未下发 plugins.approvals）：这里既不是「没有申请」，也不是「没有待审批」。台账真实存在 host 的 plugin-approvals.json 里。' }),
  )
}

function PermissionTab(props: { data?: PluginSettingsData }) {
  const installedLoaded = Array.isArray(props.data?.installed)
  const approvalsLoaded = Array.isArray(props.data?.approvals)
  const installed = props.data?.installed || []
  const approvals = props.data?.approvals || []
  const declaredOf = (row: InstalledPluginRow) => approvals.find((item) => item.packageName === row.packageName || item.pluginName === row.pluginId)
  return h('div', null,
    h(SettingsCard, {
      title: '插件权限',
      meta: installedLoaded ? (installed.length ? `${installed.length} 个插件` : '暂无') : '未读取',
      note: '权限与风险来自安装申请里声明的内容；插件工具的实际执行仍然受 DSH 权限模式约束。',
    },
      installed.length ? installed.map((row) => {
        const request = declaredOf(row)
        return h(SettingsRow, {
          key: `${row.pluginId}-perm`,
          title: row.packageName || row.pluginId,
          desc: [
            `声明权限 ${request?.permissions.length ? request.permissions.join('、') : DASH}`,
            `风险 ${request?.risks.length ? request.risks.join('、') : DASH}`,
            `可调用工具 ${row.tools.length ? row.tools.join('、') : DASH}`,
            `使用员工 ${row.employees?.length ? row.employees.join('、') : DASH}`,
          ].join(' · '),
          side: h(StatusPill, { tone: PLUGIN_TONE[row.status], label: PLUGIN_LABEL[row.status] }),
        })
      }) : h(Empty, { text: installedLoaded ? '暂无已安装插件，因此没有任何插件权限。先去「市场」页搜一个，员工提交申请、你批准之后它才会出现在这里。' : '面板没有拿到插件绑定，无法列出权限。点右上角「刷新」重新读取一次。' }),
    ),
    h(SettingsCard, {
      title: '待批准申请声明的权限',
      meta: approvalsLoaded ? (approvals.filter((item) => item.status === 'pending').length ? undefined : '暂无') : '未读取',
    },
      approvals.filter((item) => item.status === 'pending').length
        ? approvals.filter((item) => item.status === 'pending').map((request) => h(SettingsRow, {
          key: `${request.requestId}-perm`,
          title: request.pluginName,
          desc: `权限 ${request.permissions.length ? request.permissions.join('、') : DASH} · 风险 ${request.risks.length ? request.risks.join('、') : DASH} · 安装命令 ${request.installCommand}`,
          side: h(StatusPill, { tone: 'warn', label: '等待老板审批' }),
        }))
        : h(Empty, { text: approvalsLoaded ? '暂无待批准申请。员工提交安装申请后，它声明的权限与风险会先摊开在这里，再由你决定批不批。' : `是否有待批准申请：${UNKNOWN}（面板没有拿到审批台账）。` }),
    ),
  )
}

export function PluginSettings(props: { data?: PluginSettingsData; actions?: PluginSettingsActions; onRefresh?: () => void }) {
  const [tab, setTab] = useState('installed')
  // 没下发就不写数字：Tab 上的「0」会被读成「真的一个都没有」。
  const counts = {
    installed: Array.isArray(props.data?.installed) ? String(props.data!.installed!.length) : UNKNOWN,
    approvals: Array.isArray(props.data?.approvals) ? String(props.data!.approvals!.length) : UNKNOWN,
  }
  return h('div', { className: 'cy9-set-main' },
    // host 明确说了「本次运行拿不到插件台账」时，原样转述它的原话 ——
    // 那跟「一个插件都没装」是两回事，不许合并成同一句话。
    props.data?.reason
      ? h('div', { className: 'cy9-set-banner' }, `面板没有拿到插件台账 —— host 的原话：${props.data.reason}`)
      : null,
    h('div', { className: 'cy9-set-card' }, h(Tabs, {
      value: tab, onChange: setTab,
      items: [
        ['installed', `已安装 ${counts.installed}`],
        ['market', '市场'],
        ['approvals', `审批记录 ${counts.approvals}`],
        ['permissions', '权限'],
      ],
    })),
    tab === 'installed' ? h(InstalledTab, props) : null,
    tab === 'market' ? h(MarketTab, props) : null,
    tab === 'approvals' ? h(ApprovalTab, props) : null,
    tab === 'permissions' ? h(PermissionTab, { data: props.data }) : null,
  )
}
