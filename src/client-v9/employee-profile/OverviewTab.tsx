// 员工档案 · 概览（需求文档四十四条）：累计任务 / 成功 / 失败 / Blocked / 长期记忆 / 真实插件 / 模型能力。
// 所有数字来自 EmployeeSnapshot.statistics（持久化累计），没有快照就一律显示「—」，不猜、不补。
// 例外（需求文档四十八）：「真实插件」不读 statistics.pluginCount ——
// migrations.refreshDerivedStatistics 把 available + degraded 一起算进了那个字段，
// 而 degraded 意味着声明的工具已经有一部分从 Tool Registry 消失了，不能叫「真实可用」。
// 这里改为现算真实绑定列表，degraded 单独显示在副标里。
import { createElement as h } from 'react'
import type { RoleDef, StaffDef } from '../types'
import { formatAgo, formatDuration } from '../selectors'
import { EMPLOYEE_RUNTIME_LABEL, type EmployeeRuntimeState } from '../../runtime/company-events'
import type { EmployeeSnapshot } from '../../persistence/types'
import { tallyModels, tallyPlugins } from './PluginsTab'

const OUTCOME_LABEL: Record<string, string> = { success: '成功', partial: '部分完成', blocked: '卡住', failed: '失败' }

function Kpi(props: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' | 'warn' }) {
  return h('div', { className: `cy9-ep-kpi${props.tone ? ` ${props.tone}` : ''}` },
    h('b', null, props.value),
    h('span', null, props.label),
    props.hint ? h('em', null, props.hint) : null,
  )
}

export function OverviewTab(props: {
  staff: StaffDef
  role: RoleDef
  snapshot: EmployeeSnapshot | null
  runtime: EmployeeRuntimeState | null
}) {
  const { staff, role, snapshot, runtime } = props
  const stats = snapshot?.statistics
  const num = (value: number | undefined) => (stats && Number.isFinite(value) ? String(value) : '—')
  const rate = stats && stats.totalTasks > 0 ? `${Math.round((stats.successCount / stats.totalTasks) * 100)}% 成功率` : undefined
  const avg = stats && stats.totalTasks > 0 ? `均时 ${formatDuration(Math.round(stats.totalDurationMs / stats.totalTasks)) || '—'}` : undefined
  const plugins = snapshot ? tallyPlugins(snapshot.plugins) : null
  const models = snapshot ? tallyModels(snapshot.models) : null

  return h('div', null,
    h('div', { className: 'cy9-ep-kpis' },
      h(Kpi, { label: '累计任务', value: num(stats?.totalTasks), hint: avg }),
      h(Kpi, { label: '成功', value: num(stats?.successCount), hint: rate, tone: 'good' }),
      h(Kpi, { label: '失败', value: num(stats?.failedCount), tone: 'bad' }),
      h(Kpi, { label: 'Blocked', value: num(stats?.blockedCount), tone: 'warn' }),
    ),
    h('div', { className: 'cy9-ep-kpis' },
      h(Kpi, { label: '长期记忆', value: num(stats?.memoryCount) }),
      h(Kpi, {
        label: '可用插件',
        value: plugins ? String(plugins.available) : '—',
        hint: plugins ? `降级 ${plugins.degraded} · 缺失 ${plugins.missing} · 共绑定 ${plugins.total}` : undefined,
      }),
      h(Kpi, { label: '模型能力', value: models ? String(models.available) : '—', hint: models ? `共绑定 ${models.total}` : undefined }),
      h(Kpi, { label: '已学技能', value: num(stats?.skillCount), hint: stats ? `${stats.evidenceCount} 条证据` : undefined }),
    ),
    snapshot ? null : h('p', { className: 'cy9-ep-note' }, '尚未取到持久化档案（CompanySnapshot），以上为占位。真实数据存在本机 evolution.json，由 host 下发后自动恢复。'),

    h('div', { className: 'cy9-ep-sec' },
      h('label', null, '当前状态', stats?.lastTaskAt ? h('i', null, `最近任务 ${formatAgo(stats.lastTaskAt)}`) : null),
      h('div', { className: 'cy9-ep-line' },
        h('i', { className: `cy9-ep-dot ${runtime?.status || ''}` }),
        h('b', null, runtime ? EMPLOYEE_RUNTIME_LABEL[runtime.status] : '暂无实时事件'),
        h('span', null, runtime?.task?.title || runtime?.tool?.label || runtime?.meeting?.topic || (runtime ? runtime.activity : '真实事件发生后这里会更新')),
        runtime && runtime.pending > 0 ? h('em', null, `待开工 ${runtime.pending}`) : null,
      ),
      runtime?.block ? h('div', { className: 'cy9-ep-line', style: { marginTop: '6px' } }, h('i', { className: 'cy9-ep-dot blocked' }), h('b', null, '卡住原因'), h('span', null, runtime.block.reason)) : null,
    ),

    h('div', { className: 'cy9-ep-sec' },
      h('label', null, '最近复盘', snapshot ? h('i', null, `共 ${snapshot.recentReflections.length} 条`) : null),
      snapshot && snapshot.recentReflections.length
        ? snapshot.recentReflections.slice(0, 3).map((item) => h('div', { key: item.id, className: 'cy9-ep-item' },
          h('div', { className: 'cy9-ep-item-head' },
            h('b', null, item.task || '未命名任务'),
            h('span', { className: `cy9-ep-out ${item.outcome}` }, OUTCOME_LABEL[item.outcome] || item.outcome),
            h('span', { className: 'lv' }, formatAgo(item.createdAt)),
          ),
          h('p', null, item.lesson),
        ))
        : h('div', { className: 'cy9-ep-empty' }, '暂无复盘记录。', h('br'), '员工真实完成任务并调用 staff_reflect 后会写入这里。'),
    ),

    h('div', { className: 'cy9-ep-sec' },
      h('label', null, '岗位能力'),
      h('div', { className: 'cy9-ep-chips' }, (role.skills || []).length
        ? (role.skills || []).map((skill) => h('span', { key: skill.name, title: skill.desc }, skill.name))
        : h('span', null, '未定义')),
    ),
    h('div', { className: 'cy9-ep-sec' },
      h('label', null, '常用工具', h('i', null, `${(role.tools || []).length} 个`)),
      h('div', { className: 'cy9-ep-chips' }, (role.tools || []).length
        ? (role.tools || []).slice(0, 12).map((tool) => h('span', { key: tool, className: 'mono' }, tool))
        : h('span', null, '未定义')),
    ),
    h('div', { className: 'cy9-ep-sec' },
      h('label', null, '岗位说明'),
      h('div', { className: 'cy9-ep-line' }, h('span', null, staff.intro || '未填写')),
    ),
  )
}
