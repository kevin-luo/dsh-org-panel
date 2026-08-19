// 员工档案 · 技能（需求文档四十四条）：等级进度条 + 点开显示 SkillEvidence。
// 等级只来自持久层 computeSkillLevel 的真实成功/失败证据（六十条：不让 LLM 自己定级），
// 这里纯展示，绝不在前端重算或美化等级。
import { createElement as h, useState } from 'react'
import { formatAgo, formatDuration } from '../selectors'
import type { EmployeeSnapshot, SkillEvidence, SkillSnapshot } from '../../persistence/types'

const SOURCE_LABEL: Record<string, string> = { seed: '岗位内置', experience: '实战沉淀', plugin: '插件带来', manual: '人工录入' }
const MAX_LEVEL = 10

function evidenceLabel(item: SkillEvidence): string {
  const parts = [item.tool, item.plugin, item.model].filter(Boolean) as string[]
  if (parts.length) return parts.join(' · ')
  return item.taskId ? `任务 ${item.taskId}` : '真实执行记录'
}

function SkillRow(props: { skill: SkillSnapshot; open: boolean; onToggle: () => void }) {
  const { skill, open, onToggle } = props
  const total = skill.successes + skill.failures
  return h('button', {
    type: 'button', className: `cy9-ep-item${open ? ' on' : ''}`, onClick: onToggle,
    'aria-expanded': open,
  },
    h('div', { className: 'cy9-ep-item-head' },
      h('b', null, skill.name),
      h('span', null, `${skill.category || '通用'} · ${SOURCE_LABEL[skill.source] || skill.source}`),
      h('span', { className: 'lv' }, `Lv.${skill.level}`),
    ),
    h('div', { className: 'cy9-ep-bar' }, h('i', { style: { width: `${Math.round((Math.min(skill.level, MAX_LEVEL) / MAX_LEVEL) * 100)}%` } })),
    h('p', null, `成功 ${skill.successes} · 失败 ${skill.failures} · 证据 ${skill.evidenceCount} 条${skill.lastUsedAt ? ` · 最近 ${formatAgo(skill.lastUsedAt)}` : ''}`),
    skill.summary ? h('p', null, skill.summary) : null,
    open ? h('div', null,
      h('p', null, `Evidence（最近 ${skill.recentEvidence.length} / 共 ${skill.evidenceCount} 条）`),
      skill.recentEvidence.length
        ? skill.recentEvidence.map((item) => h('div', { key: item.id, className: 'cy9-ep-ev' },
          h('i', { className: item.success ? 'ok' : 'no' }, item.success ? '✓' : '✕'),
          h('span', null, evidenceLabel(item)),
          h('em', null, `${item.duration ? `${formatDuration(item.duration)} · ` : ''}${formatAgo(item.createdAt)}`),
        ))
        : h('div', { className: 'cy9-ep-ev' }, h('i', null, '·'), h('span', null, '这条技能还没有留下可展示的证据'), h('em', null, '')),
      total === 0 ? h('p', null, '尚无成功/失败记录，等级维持在初始值。') : null,
    ) : null,
  )
}

export function SkillsTab(props: { snapshot: EmployeeSnapshot | null }) {
  const { snapshot } = props
  const [openId, setOpenId] = useState<string | null>(null)
  if (!snapshot) return h('div', { className: 'cy9-ep-empty' }, '尚未取到持久化档案（CompanySnapshot）。', h('br'), '技能与证据存在本机 evolution.json，由 host 下发后自动恢复。')
  if (!snapshot.skills.length) return h('div', { className: 'cy9-ep-empty' }, '暂无已学技能。', h('br'), '员工真实完成任务、装上并验证插件后，技能与等级才会出现。')
  return h('div', null,
    h('div', { className: 'cy9-ep-sec', style: { marginTop: 0 } },
      h('label', null, '技能等级', h('i', null, `共 ${snapshot.statistics.skillCount} 项 · ${snapshot.statistics.evidenceCount} 条证据`)),
      snapshot.skills.map((skill) => h(SkillRow, {
        key: skill.id, skill, open: openId === skill.id,
        onToggle: () => setOpenId((current) => (current === skill.id ? null : skill.id)),
      })),
    ),
  )
}
