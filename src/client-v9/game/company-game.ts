// 赛博公司经营养成层：只把真实持久化员工状态投影成“游戏可视化状态”。
//
// 铁律：这里不制造 XP、不随机升级、不伪造成就。所有数值都来自 CompanySnapshot / EmployeeSnapshot，
// UI 只是把长期记忆、技能证据、任务履历、插件与等级变成经营养成游戏能读懂的视觉语言。
import type { CompanySnapshot, EmployeeSnapshot, SkillSnapshot } from '../../persistence/types'

export type EmployeeGameState = {
  employeeId: string
  level: number
  title: string
  xp: number
  progress: number
  workspaceTier: string
  workspaceHint: string
  totalTasks: number
  successRate: number | null
  memories: number
  skills: number
  plugins: number
  models: number
  evidence: number
  topSkill?: { name: string; level: number; evidence: number }
  recentTask?: { title: string; outcome: string; completedAt?: number }
  badges: string[]
}

export type CompanyGameState = {
  xp: number
  employees: number
  averageLevel: number
  experts: number
  veterans: number
  totalTasks: number
  successRate: number | null
}

function memoryCount(employee: EmployeeSnapshot): number {
  return Object.values(employee.memoryCounts || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0)
}

function topSkillOf(skills: SkillSnapshot[]): EmployeeGameState['topSkill'] {
  const sorted = [...(skills || [])].sort((a, b) =>
    (b.level - a.level)
      || (b.evidenceCount - a.evidenceCount)
      || (b.successes - a.successes)
      || a.name.localeCompare(b.name),
  )
  const skill = sorted[0]
  return skill ? { name: skill.name, level: skill.level, evidence: skill.evidenceCount } : undefined
}

/** 个人空间等级只由真实员工等级派生，不单独存一份会漂移的假状态。 */
export function workspaceTier(level: number): { name: string; hint: string } {
  if (level >= 8) return { name: '专家工作室', hint: '领域专家专属空间' }
  if (level >= 6) return { name: '高级工作室', hint: '资深员工空间' }
  if (level >= 4) return { name: '专业工位', hint: '熟练员工空间' }
  if (level >= 2) return { name: '成长工位', hint: '持续积累真实任务经验' }
  return { name: '基础工位', hint: '新员工起始空间' }
}

function badgesOf(employee: EmployeeSnapshot, memories: number): string[] {
  const badges: string[] = []
  if (employee.statistics.totalTasks >= 10) badges.push('稳定交付')
  if (employee.statistics.successCount >= 20) badges.push('高产员工')
  if (memories >= 20) badges.push('长期记忆')
  if (employee.statistics.skillCount >= 5) badges.push('多面手')
  if (employee.statistics.pluginCount >= 3) badges.push('插件达人')
  if (employee.level.level >= 8) badges.push('领域专家')
  return badges.slice(0, 4)
}

export function employeeGameState(employee: EmployeeSnapshot): EmployeeGameState {
  const total = Math.max(0, employee.statistics.totalTasks || 0)
  const success = Math.max(0, employee.statistics.successCount || 0)
  const memories = memoryCount(employee)
  const space = workspaceTier(employee.level.level)
  const recent = employee.recentTasks?.[0]
  return {
    employeeId: employee.employeeId,
    level: employee.level.level,
    title: employee.level.title,
    xp: employee.xp,
    progress: employee.level.progress,
    workspaceTier: space.name,
    workspaceHint: space.hint,
    totalTasks: total,
    successRate: total > 0 ? success / total : null,
    memories,
    skills: employee.statistics.skillCount,
    plugins: employee.statistics.pluginCount,
    models: employee.statistics.modelCount,
    evidence: employee.statistics.evidenceCount,
    topSkill: topSkillOf(employee.skills),
    recentTask: recent ? { title: recent.title, outcome: recent.outcome, completedAt: recent.completedAt } : undefined,
    badges: badgesOf(employee, memories),
  }
}

export function employeeGameMap(snapshot?: CompanySnapshot | null): Record<string, EmployeeGameState> {
  return Object.fromEntries((snapshot?.employees || []).map((employee) => [employee.employeeId, employeeGameState(employee)]))
}

export function companyGameState(snapshot?: CompanySnapshot | null): CompanyGameState | null {
  if (!snapshot) return null
  const employees = snapshot.employees || []
  const totalTasks = employees.reduce((sum, employee) => sum + Math.max(0, employee.statistics.totalTasks || 0), 0)
  const success = employees.reduce((sum, employee) => sum + Math.max(0, employee.statistics.successCount || 0), 0)
  const levelSum = employees.reduce((sum, employee) => sum + Math.max(1, employee.level.level || 1), 0)
  return {
    xp: snapshot.totals.xp,
    employees: employees.length,
    averageLevel: employees.length ? levelSum / employees.length : 0,
    experts: employees.filter((employee) => employee.level.level >= 8).length,
    veterans: employees.filter((employee) => employee.level.level >= 6).length,
    totalTasks,
    successRate: totalTasks > 0 ? success / totalTasks : null,
  }
}

export function percent(value: number | null): string {
  return value === null ? '暂无样本' : `${Math.round(value * 100)}%`
}
