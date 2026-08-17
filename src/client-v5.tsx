// v5 compatibility wrapper: keep the approved HQ v4 visual layer while fitting
// expanded employees into the organization groups understood by client-v2.
import { apply as applyV4 } from './client-v4'
import { EMPLOYEE_BLUEPRINTS, ROLE_BLUEPRINTS } from './org-blueprints'

const DEPARTMENT_BY_ROLE: Record<string, string> = {
  secretary: '总裁办',
  'tech-lead': '管理层',
  recruiter: '人才与文化',
  developer: '产品研发部',
  pm: '产品研发部',
  platform: '产品研发部',
  'data-analyst': '产品研发部',
  researcher: '市场与知识部',
  doc: '市场与知识部',
  'search-specialist': '市场与知识部',
  'image-creator': '市场与知识部',
  'video-producer': '市场与知识部',
  novelist: '市场与知识部',
  'social-editor': '市场与知识部',
  growth: '市场与知识部',
}

function expandedConfig(config?: any) {
  const next = { ...(config || {}) }
  if (!Array.isArray(next.staff) || next.staff.length === 0) {
    next.staff = EMPLOYEE_BLUEPRINTS.map((item) => ({
      id: item.id,
      name: item.name,
      role: item.role,
      emoji: item.emoji,
      intro: item.intro,
      roleId: item.roleId,
      department: DEPARTMENT_BY_ROLE[item.roleId] || item.department || '市场与知识部',
      reportsTo: item.reportsTo,
      aliases: item.aliases,
      lines: item.lines,
    }))
  }
  if (!Array.isArray(next.roles) || next.roles.length === 0) next.roles = ROLE_BLUEPRINTS
  return next
}

export function apply(ctx: any, config?: any) {
  applyV4(ctx, expandedConfig(config))
}
