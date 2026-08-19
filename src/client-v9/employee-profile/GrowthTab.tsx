import { createElement as h, useMemo } from 'react'
import type { EmployeeSnapshot } from '../../persistence/types'
import { careerEventIcon, careerTimeline } from '../game/career-timeline'
import { employeeGameState } from '../game/company-game'

function timeText(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

function outcomeText(value?: string): string {
  if (value === 'success') return '成功'
  if (value === 'partial') return '部分完成'
  if (value === 'blocked') return '卡住'
  if (value === 'failed') return '失败'
  return ''
}

export function GrowthTab(props: { snapshot?: EmployeeSnapshot | null }) {
  const snapshot = props.snapshot || null
  const growth = useMemo(() => snapshot ? employeeGameState(snapshot) : null, [snapshot])
  const timeline = useMemo(() => careerTimeline(snapshot, 80), [snapshot])

  if (!snapshot || !growth) return h('div', { className: 'cy9-ep-empty' }, '尚未读取到持久化员工档案，暂时无法生成成长轨迹。')

  return h('div', null,
    h('div', { className: 'cy9-ep-kpis' },
      h('div', { className: 'cy9-ep-kpi' }, h('b', null, `Lv.${growth.level}`), h('span', null, growth.title), h('em', null, `${growth.xp} XP`)),
      h('div', { className: 'cy9-ep-kpi' }, h('b', null, growth.workspaceTier), h('span', null, '个人空间'), h('em', null, growth.workspaceHint)),
      h('div', { className: 'cy9-ep-kpi good' }, h('b', null, growth.topSkill ? `Lv.${growth.topSkill.level}` : '—'), h('span', null, growth.topSkill?.name || '主技能'), h('em', null, growth.topSkill ? `${growth.topSkill.evidence} 条证据` : '暂无真实技能证据')),
      h('div', { className: 'cy9-ep-kpi' }, h('b', null, String(growth.evidence)), h('span', null, '成长证据'), h('em', null, '只计真实执行结果')),
    ),

    h('section', { className: 'cy9-ep-sec' },
      h('label', null, '个人空间 · 真实能力装备', h('i', null, '来自长期档案，不是装饰道具')),
      h('div', { className: 'cy9-growth-space' },
        h('div', { className: 'cy9-growth-room' },
          h('b', null, growth.workspaceTier),
          h('span', null, `等级 Lv.${growth.level} · ${Math.round(growth.progress * 100)}% 升级进度`),
          h('small', null, '后续办公室会把这里的真实能力映射成可视化设备与房间升级。'),
        ),
        h('div', { className: 'cy9-growth-equipment' },
          h('span', null, `🧠 长期记忆 ${growth.memories}`),
          h('span', null, `🛠 技能 ${growth.skills}`),
          h('span', null, `🔌 插件 ${growth.plugins}`),
          h('span', null, `◈ 模型 ${growth.models}`),
          ...(snapshot.plugins || []).slice(0, 5).map((plugin) => h('span', { key: plugin.pluginId, className: plugin.status === 'available' ? 'on' : 'off' }, `◆ ${plugin.packageName || plugin.pluginId}`)),
          ...(snapshot.skills || []).slice(0, 5).map((skill) => h('span', { key: skill.id, className: 'skill' }, `↗ ${skill.name} Lv.${skill.level}`)),
        ),
      ),
    ),

    growth.badges.length ? h('section', { className: 'cy9-ep-sec' },
      h('label', null, '真实里程碑'),
      h('div', { className: 'cy9-ep-chips' }, growth.badges.map((badge) => h('span', { key: badge }, `★ ${badge}`))),
    ) : null,

    h('section', { className: 'cy9-ep-sec' },
      h('label', null, '成长轨迹', h('i', null, `${timeline.length} 条近期事实`)),
      timeline.length ? h('div', { className: 'cy9-career-timeline' }, timeline.map((event) => h('div', { key: event.id, className: `cy9-career-row ${event.tone}` },
        h('div', { className: 'cy9-career-icon' }, careerEventIcon(event.kind)),
        h('div', { className: 'cy9-career-main' },
          h('div', { className: 'cy9-career-title' },
            h('b', null, event.title),
            event.source ? h('span', { className: 'cy9-ep-src' }, event.source) : null,
            event.outcome ? h('span', { className: `cy9-ep-out ${event.outcome}` }, outcomeText(event.outcome)) : null,
          ),
          event.detail ? h('p', null, event.detail) : null,
        ),
        h('time', null, timeText(event.at)),
      ))) : h('div', { className: 'cy9-ep-empty' }, '目前还没有可追溯的任务、技能证据、插件、复盘或长期记忆事件。'),
      h('div', { className: 'cy9-ep-note' }, '时间线只展示快照里真实存在的时间戳。当前等级不会被倒推成“某天晋升”，避免伪造成长历史。'),
    ),
  )
}
