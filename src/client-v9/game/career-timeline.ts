// 员工成长轨迹：把持久化档案里的真实事实投影成时间线。
//
// 不制造“晋升时间”、不把当前等级倒推成历史事件；只有 Task / SkillEvidence / Plugin / Reflection / Memory
// 里真的带时间戳的事实才能进入轨迹。
import type { EmployeeSnapshot, TaskOutcome } from '../../persistence/types'

export type CareerEventKind = 'task' | 'skill' | 'plugin' | 'reflection' | 'memory'

export type CareerEvent = {
  id: string
  kind: CareerEventKind
  at: number
  title: string
  detail?: string
  tone: 'ok' | 'info' | 'warn' | 'bad' | 'muted'
  source?: string
  outcome?: TaskOutcome
}

function validTime(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function taskTone(outcome: TaskOutcome): CareerEvent['tone'] {
  if (outcome === 'success') return 'ok'
  if (outcome === 'failed') return 'bad'
  if (outcome === 'blocked') return 'warn'
  return 'info'
}

function sourceLabel(source: string): string {
  if (source === 'web') return 'Web'
  if (source === 'feishu') return '飞书'
  if (source === 'qq') return 'QQ'
  if (source === 'wechat') return '微信'
  if (source === 'system') return '系统'
  return source
}

export function careerTimeline(snapshot?: EmployeeSnapshot | null, limit = 80): CareerEvent[] {
  if (!snapshot) return []
  const rows: CareerEvent[] = []

  for (const task of snapshot.recentTasks || []) {
    const at = validTime(task.completedAt || task.startedAt)
    if (!at) continue
    rows.push({
      id: `task:${task.id}:${at}`,
      kind: 'task', at,
      title: task.completedAt ? `完成任务 · ${task.title}` : `开始任务 · ${task.title}`,
      detail: [task.summary, task.tools?.length ? `工具 ${task.tools.join('、')}` : '', task.plugins?.length ? `插件 ${task.plugins.join('、')}` : ''].filter(Boolean).join(' · ') || undefined,
      tone: task.completedAt ? taskTone(task.outcome) : 'info',
      source: sourceLabel(task.source),
      outcome: task.outcome,
    })
  }

  for (const skill of snapshot.skills || []) {
    const learnedAt = validTime(skill.createdAt)
    if (learnedAt) rows.push({
      id: `skill-created:${skill.id}:${learnedAt}`,
      kind: 'skill', at: learnedAt,
      title: `学会技能 · ${skill.name}`,
      detail: skill.summary || `来源 ${skill.source}`,
      tone: 'info',
    })
    for (const evidence of skill.recentEvidence || []) {
      const at = validTime(evidence.createdAt)
      if (!at) continue
      rows.push({
        id: `skill-evidence:${evidence.id}`,
        kind: 'skill', at,
        title: `${evidence.success ? '技能验证成功' : '技能验证失败'} · ${skill.name}`,
        detail: [evidence.tool ? `工具 ${evidence.tool}` : '', evidence.plugin ? `插件 ${evidence.plugin}` : '', evidence.model ? `模型 ${evidence.model}` : ''].filter(Boolean).join(' · ') || undefined,
        tone: evidence.success ? 'ok' : 'bad',
      })
    }
  }

  for (const plugin of snapshot.plugins || []) {
    const at = validTime(plugin.installedAt)
    if (!at) continue
    rows.push({
      id: `plugin:${plugin.pluginId}:${at}`,
      kind: 'plugin', at,
      title: `获得插件 · ${plugin.packageName || plugin.pluginId}`,
      detail: [plugin.version ? `v${plugin.version}` : '', plugin.tools?.length ? `新增 ${plugin.tools.length} 个工具` : '', plugin.status !== 'available' ? `当前 ${plugin.status}` : ''].filter(Boolean).join(' · ') || undefined,
      tone: plugin.status === 'available' ? 'ok' : plugin.status === 'degraded' ? 'warn' : plugin.status === 'missing' ? 'bad' : 'muted',
    })
  }

  for (const reflection of snapshot.recentReflections || []) {
    const at = validTime(reflection.createdAt)
    if (!at) continue
    rows.push({
      id: `reflection:${reflection.id}`,
      kind: 'reflection', at,
      title: `完成复盘 · ${reflection.task}`,
      detail: reflection.lesson,
      tone: reflection.outcome === 'success' ? 'ok' : reflection.outcome === 'failed' ? 'bad' : reflection.outcome === 'blocked' ? 'warn' : 'info',
      outcome: reflection.outcome,
    })
  }

  for (const memory of snapshot.recentMemories || []) {
    const at = validTime(memory.updatedAt || memory.createdAt)
    if (!at) continue
    rows.push({
      id: `memory:${memory.id}:${at}`,
      kind: 'memory', at,
      title: `${memory.updatedAt > memory.createdAt ? '更新长期记忆' : '形成长期记忆'} · ${memory.kind}`,
      detail: memory.text,
      tone: 'muted',
    })
  }

  return rows
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, Math.min(200, limit)))
}

export function careerEventIcon(kind: CareerEventKind): string {
  if (kind === 'task') return '✓'
  if (kind === 'skill') return '↗'
  if (kind === 'plugin') return '◆'
  if (kind === 'reflection') return '◎'
  return '●'
}
