// 员工档案 · 插件（需求文档四十四条）：显示 Available / Missing 等真实绑定状态。
// 五十九条：插件未验证就不能显示成「已学会」——这里只照抄 PluginBinding.status 与 lastVerifiedAt，
// 前端不做任何「大概能用」的推断。
// 四十八条：计数一律现算自下面真实渲染的那份绑定列表，不用 statistics.pluginCount ——
// migrations.refreshDerivedStatistics 把 available + degraded 合并进了 pluginCount，
// 拿它当「可用」显示等于把「部分工具已经消失」的插件说成好的。
import { createElement as h } from 'react'
import type { StaffDef } from '../types'
import { formatAgo } from '../selectors'
import type { EmployeeSnapshot, ModelBinding, PluginBinding } from '../../persistence/types'

const STATUS_LABEL: Record<PluginBinding['status'], string> = { available: 'Available', degraded: 'Degraded', missing: 'Missing', disabled: 'Disabled' }
const SOURCE_LABEL: Record<PluginBinding['source'], string> = { 'dsh-market': 'DSH 插件市场', github: 'GitHub', mcp: 'MCP', builtin: '内置' }
const MODEL_STATUS_LABEL: Record<ModelBinding['status'], string> = { available: 'Available', missing: 'Missing', disabled: 'Disabled' }
const CAPABILITY_LABEL: Record<string, string> = { text: '文本', vision: '视觉', 'image-generation': '图片生成', 'video-generation': '视频生成', embedding: '向量' }

export type BindingTally = { available: number; degraded: number; missing: number; disabled: number; total: number }

/** 真实绑定分桶：degraded 单列一档，永远不并进「可用」。 */
export function tallyPlugins(plugins: PluginBinding[] | undefined): BindingTally {
  const tally: BindingTally = { available: 0, degraded: 0, missing: 0, disabled: 0, total: 0 }
  for (const plugin of plugins || []) {
    tally.total += 1
    if (plugin && plugin.status in tally) tally[plugin.status] += 1
  }
  return tally
}

/** 模型绑定只有 available / missing / disabled 三态，可用就是可用，没有中间档。 */
export function tallyModels(models: ModelBinding[] | undefined): { available: number; total: number } {
  const rows = models || []
  return { available: rows.filter((item) => item.status === 'available').length, total: rows.length }
}

/** 「N 个可用」这句话的诚实写法：降级、缺失、停用各自出现，不许被折叠掉。 */
export function pluginTallyText(tally: BindingTally): string {
  return [
    `可用 ${tally.available}`,
    tally.degraded ? `降级 ${tally.degraded}（部分工具已消失，不算可用）` : '',
    tally.missing ? `缺失 ${tally.missing}` : '',
    tally.disabled ? `停用 ${tally.disabled}` : '',
    `共 ${tally.total}`,
  ].filter(Boolean).join(' · ')
}

export function PluginsTab(props: {
  staff: StaffDef
  snapshot: EmployeeSnapshot | null
  onDraft: (text: string) => void
}) {
  const { staff, snapshot, onDraft } = props
  if (!snapshot) return h('div', { className: 'cy9-ep-empty' }, '尚未取到持久化档案（CompanySnapshot）。', h('br'), '插件绑定存在本机 evolution.json，由 host 下发后自动恢复。')
  const plugins = tallyPlugins(snapshot.plugins)
  const models = tallyModels(snapshot.models)

  return h('div', null,
    h('div', { className: 'cy9-ep-sec', style: { marginTop: 0 } },
      h('label', null, '已绑定插件', h('i', null, pluginTallyText(plugins))),
      snapshot.plugins.length
        ? snapshot.plugins.map((plugin) => h('div', { key: plugin.pluginId, className: 'cy9-ep-item' },
          h('div', { className: 'cy9-ep-item-head' },
            h('i', { className: `cy9-ep-dot ${plugin.status}` }),
            h('b', null, plugin.packageName || plugin.pluginId),
            h('span', null, `${SOURCE_LABEL[plugin.source] || plugin.source}${plugin.version ? ` · v${plugin.version}` : ''}`),
            h('span', { className: `cy9-ep-out lv ${plugin.status}` }, STATUS_LABEL[plugin.status] || plugin.status),
          ),
          h('p', null, plugin.lastVerifiedAt
            ? `安装于 ${formatAgo(plugin.installedAt)} · 最近验证 ${formatAgo(plugin.lastVerifiedAt)} · 提供 ${plugin.tools.length} 个工具`
            : `安装于 ${formatAgo(plugin.installedAt)} · 尚未通过 Tool Registry 验证，技能不计入`),
          plugin.tools.length ? h('div', { className: 'cy9-ep-chips', style: { marginTop: '6px' } }, plugin.tools.slice(0, 8).map((tool) => h('span', { key: tool, className: 'mono' }, tool))) : null,
          plugin.status === 'missing' || plugin.status === 'degraded'
            ? h('button', {
              type: 'button', className: 'cy9-ep-act',
              onClick: () => onDraft(`@大壮 ${staff.name} 绑定的插件「${plugin.packageName || plugin.pluginId}」当前状态是 ${STATUS_LABEL[plugin.status]}，请排查原因并给出修复方案；未经批准不要自行安装。`),
            }, '申请排查')
            : null,
        ))
        : h('div', { className: 'cy9-ep-empty' }, '暂无已安装插件。', h('br'), '插件需经老板批准、真实安装、通过 Tool Registry 验证与 Smoke Test 后才会绑定到员工。'),
    ),

    h('div', { className: 'cy9-ep-sec' },
      h('label', null, '模型能力', h('i', null, `可用 ${models.available} · 共 ${models.total}`)),
      snapshot.models.length
        ? snapshot.models.slice().sort((a, b) => a.priority - b.priority).map((model) => h('div', { key: `${model.capability}-${model.providerId}-${model.priority}`, className: 'cy9-ep-line', style: { marginBottom: '6px' } },
          h('i', { className: `cy9-ep-dot ${model.status}` }),
          h('b', null, CAPABILITY_LABEL[model.capability] || model.capability),
          h('span', null, `${model.providerId} · 优先级 ${model.priority}`),
          h('em', { className: `cy9-ep-out ${model.status}` }, MODEL_STATUS_LABEL[model.status] || model.status),
        ))
        : h('div', { className: 'cy9-ep-empty' }, '暂无模型能力绑定。', h('br'), '在「公司设置 → 模型」配置供应商并绑定给员工后，这里会显示真实可用状态。'),
    ),
  )
}
