// 「赛博公司」技能视图：把 LearnedSkill 与 PluginBinding、当前 Tool Registry 的真实可用性对齐。
// 需求文档第九章：技能历史不能删除，但当前可用性必须准确 —— 档案页要能显示
// 「历史熟练度 Lv.5 / 插件已缺失」。本文件是纯函数，不 import node:*，client 侧可直接复用。
import { skillLevelFrom, type LearnedSkill, type PluginBinding, type PluginStatus, type SkillEvidence } from '../persistence/types'

export type SkillAvailability = 'available' | 'degraded' | 'missing' | 'unverified'

export type SkillAvailabilityView = {
  skillId: string
  name: string
  /** 历史熟练度：证据算出来的等级，永远不因插件缺失而回退。 */
  historicalLevel: number
  availability: SkillAvailability
  /** 声明依赖但当前 Tool Registry 里找不到的工具。 */
  missingTools: string[]
  /** 声明依赖但绑定状态为 missing/disabled 的插件。 */
  missingPlugins: string[]
  /** 声明依赖但根本没有审批绑定记录的插件（未验证，绝不能显示为已学会）。 */
  unverifiedPlugins: string[]
  bindings: PluginBinding[]
  /** UI 主标签，例如「插件已缺失」。 */
  label: string
  /** UI 副标题，例如「历史熟练度 Lv.5 · 插件已缺失：stable-diffusion」。 */
  note: string
}

const PLUGIN_STATUS_LABEL: Record<PluginStatus, string> = {
  available: '可用',
  degraded: '部分可用',
  missing: '插件已缺失',
  disabled: '已停用',
}

const AVAILABILITY_LABEL: Record<SkillAvailability, string> = {
  available: '可用',
  degraded: '部分可用',
  missing: '插件已缺失',
  unverified: '未验证',
}

export function pluginStatusLabel(status: PluginStatus): string {
  return PLUGIN_STATUS_LABEL[status] || String(status)
}

export function availabilityLabel(availability: SkillAvailability): string {
  return AVAILABILITY_LABEL[availability] || String(availability)
}

function normalize(value: string): string {
  return String(value || '').trim().toLowerCase()
}

/** 插件技能的统一命名：优先老板/员工指定的技能名，其次插件展示名，最后包名。 */
export function pluginSkillName(input: { skillName?: string; pluginName?: string; packageName?: string }): string {
  const candidates = [input.skillName, input.pluginName, input.packageName]
  for (const candidate of candidates) {
    const text = String(candidate || '').trim()
    if (text) return text
  }
  return '插件能力'
}

/** 一个插件绑定被哪些技能引用（pluginId 与 packageName 都算）。 */
export function skillsUsingPlugin(skills: readonly LearnedSkill[], binding: Pick<PluginBinding, 'pluginId' | 'packageName'>): LearnedSkill[] {
  const keys = new Set([normalize(binding.pluginId), normalize(binding.packageName)].filter(Boolean))
  return skills.filter((skill) => skill.pluginNames.some((name) => keys.has(normalize(name))))
}

function bindingsForSkill(skill: LearnedSkill, bindings: readonly PluginBinding[]): { matched: PluginBinding[]; unverified: string[] } {
  const matched: PluginBinding[] = []
  const unverified: string[] = []
  for (const raw of skill.pluginNames) {
    const key = normalize(raw)
    if (!key) continue
    const binding = bindings.find((item) => normalize(item.pluginId) === key || normalize(item.packageName) === key)
    if (binding) matched.push(binding)
    else unverified.push(raw)
  }
  return { matched, unverified }
}

/**
 * 计算一个技能当前的真实可用性。availableTools 传当前 Tool Registry 的工具名集合；
 * 传空集合表示「本次未扫描工具」，此时只按插件绑定判断，不会误报工具缺失。
 */
export function skillAvailability(skill: LearnedSkill, bindings: readonly PluginBinding[] = [], availableTools?: Iterable<string>): SkillAvailabilityView {
  const present = availableTools ? new Set(Array.from(availableTools)) : null
  const { matched, unverified } = bindingsForSkill(skill, bindings)
  const lostTools = present ? skill.toolNames.filter((name) => name && !present.has(name)) : []
  const missingPlugins = matched.filter((item) => item.status === 'missing' || item.status === 'disabled').map((item) => item.packageName || item.pluginId)
  const degradedPlugins = matched.filter((item) => item.status === 'degraded').map((item) => item.packageName || item.pluginId)
  let availability: SkillAvailability = 'available'
  if (unverified.length) availability = 'unverified'
  if (missingPlugins.length || (present && skill.toolNames.length > 0 && lostTools.length === skill.toolNames.length)) availability = 'missing'
  else if (availability !== 'unverified' && (degradedPlugins.length || lostTools.length)) availability = 'degraded'
  const label = availabilityLabel(availability)
  const details: string[] = []
  if (missingPlugins.length) details.push(`插件已缺失：${missingPlugins.join('、')}`)
  if (degradedPlugins.length) details.push(`插件部分可用：${degradedPlugins.join('、')}`)
  if (unverified.length) details.push(`未验证插件：${unverified.join('、')}`)
  if (lostTools.length) details.push(`工具不在当前运行时：${lostTools.join('、')}`)
  return {
    skillId: skill.id,
    name: skill.name,
    historicalLevel: skill.level,
    availability,
    missingTools: lostTools,
    missingPlugins,
    unverifiedPlugins: unverified,
    bindings: matched,
    label,
    note: [`历史熟练度 Lv.${skill.level}`, ...details].join(' · '),
  }
}

export function skillAvailabilityMap(skills: readonly LearnedSkill[], bindings: readonly PluginBinding[] = [], availableTools?: Iterable<string>): Record<string, SkillAvailabilityView> {
  const present = availableTools ? Array.from(availableTools) : undefined
  const out: Record<string, SkillAvailabilityView> = {}
  for (const skill of skills) out[skill.id] = skillAvailability(skill, bindings, present)
  return out
}

/** 只读地重算一个技能「按当前证据应有的等级」，用于对账，不写盘。 */
export function projectedLevel(skill: LearnedSkill, evidence: readonly SkillEvidence[], time = Date.now()): number {
  return skillLevelFrom(skill, evidence as SkillEvidence[], time)
}

/** 一名员工的技能健康摘要，档案页顶部用。 */
export function summarizeSkills(skills: readonly LearnedSkill[], bindings: readonly PluginBinding[] = [], availableTools?: Iterable<string>) {
  const views = Object.values(skillAvailabilityMap(skills, bindings, availableTools))
  return {
    total: views.length,
    available: views.filter((item) => item.availability === 'available').length,
    degraded: views.filter((item) => item.availability === 'degraded').length,
    missing: views.filter((item) => item.availability === 'missing').length,
    unverified: views.filter((item) => item.availability === 'unverified').length,
    topLevel: views.reduce((max, item) => Math.max(max, item.historicalLevel), 0),
    views,
  }
}
