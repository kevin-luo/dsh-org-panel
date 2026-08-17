// 「赛博公司」client-v9 入口：组件化重构版。
// 不再嵌套 client-v2~v8 的 CSS wrapper，直接注册 conversation.view Tab 与 @ trigger。
import { createElement } from 'react'
import { EMPLOYEE_BLUEPRINTS, ROLE_BLUEPRINTS } from '../org-blueprints'
import type { OrgPanelConfig, RoleDef, StaffDef } from './types'
import { installStyles } from './styles'
import { CompanyView } from './company-view'

// 与 client-v5 保持一致的部门映射，保证频道过滤与组织架构口径不变。
const DEPARTMENT_BY_ROLE: Record<string, string> = {
  secretary: '总裁办',
  'tech-lead': '管理层',
  recruiter: '人才与文化',
  developer: '产品研发部',
  pm: '产品研发部',
  platform: '产品研发部',
  'data-analyst': '产品研发部',
  researcher: '市场与情报部',
  'search-specialist': '市场与情报部',
  doc: '知识与内容部',
  novelist: '知识与内容部',
  'social-editor': '知识与内容部',
  'image-creator': '创意工作室',
  'video-producer': '创意工作室',
  growth: '增长运营部',
}

function normalizedConfig(config?: OrgPanelConfig): Required<Pick<OrgPanelConfig, 'tabLabel' | 'companyName' | 'chatEnabled'>> & { roles: RoleDef[]; staff: StaffDef[] } {
  const cfg = config || {}
  const roles: RoleDef[] = (cfg.roles && cfg.roles.length ? cfg.roles : ROLE_BLUEPRINTS).map((role) => ({
    id: role.id,
    tools: role.tools || [],
    skills: role.skills || [],
    keywords: role.keywords || [],
  }))
  const staff: StaffDef[] = (cfg.staff && cfg.staff.length ? cfg.staff : EMPLOYEE_BLUEPRINTS).map((item) => ({
    id: item.id,
    name: item.name,
    role: item.role,
    emoji: item.emoji,
    intro: item.intro,
    roleId: item.roleId || item.id,
    department: DEPARTMENT_BY_ROLE[item.roleId || item.id] || item.department || '市场与情报部',
    reportsTo: item.reportsTo,
    aliases: item.aliases,
    lines: item.lines,
  }))
  return {
    tabLabel: cfg.tabLabel || '赛博公司',
    companyName: cfg.companyName || '赛博公司 · AI 员工总部',
    chatEnabled: cfg.chatEnabled !== false,
    roles,
    staff,
  }
}

export function apply(ctx: any, config?: OrgPanelConfig) {
  const slots = ctx && ctx.get ? ctx.get('slots') : undefined
  if (slots === undefined) return
  const timer = ctx && ctx.get ? ctx.get('timer') : undefined
  const inputTriggers = ctx && ctx.get ? ctx.get('inputTriggers') : undefined
  const normalized = normalizedConfig(config)

  installStyles()

  // 复用现有 @ trigger 机制，不重写 mention parser。
  if (inputTriggers && typeof inputTriggers.registerSource === 'function') {
    const source = {
      trigger: '@',
      name: 'niuma-staff',
      order: -20,
      candidates(_session: any, request: any) {
        const query = String(request?.query || '').toLowerCase()
        return Promise.resolve(normalized.staff
          .filter((employee) => !query || (employee.name + employee.role + (employee.aliases || []).join(' ')).toLowerCase().includes(query))
          .map((employee) => ({ name: employee.name, description: employee.id === 'secretary' ? `${employee.role} · 主 Agent` : `${employee.role} · 独立子代理`, icon: employee.emoji })))
      },
      lexicon() { return normalized.staff.map((employee) => employee.name) },
      onPick(pick: any) { return { text: `@${pick.candidate.name} ` } },
    }
    ctx.effect(() => inputTriggers.registerSource(source), 'dsh-org-panel: @赛博公司员工')
  }

  slots.inject('conversation.view', () => slots.register(
    { name: 'conversation.view', id: 'realm', order: 20, label: () => normalized.tabLabel },
    (props: any) => createElement(CompanyView, Object.assign({}, props, { timer, config: normalized })),
  ))
}
