// 员工档案 · 记忆（需求文档四十四条）：按 用户偏好 / 项目事实 / 事实 / 工作流 / 经验 / 关系 分组，分页加载。
// 硬约束：不要一次拉 120 条。快照只带回最近的少量记忆，其余靠 loadMemories 按页取；
// 没有分页加载器时如实说明「还有 N 条未加载」，绝不假装已经全部显示。
import { createElement as h, useState } from 'react'
import { formatAgo } from '../selectors'
import type { EmployeeMemory, EmployeeSnapshot, MemoryKind } from '../../persistence/types'
import type { MemoryLoader } from './EmployeeProfile'

const PAGE_SIZE = 10

/** 分组顺序照抄文档，末尾补上持久层实际存在但文档没列的 fact。 */
const KIND_ORDER: MemoryKind[] = ['preference', 'project', 'workflow', 'lesson', 'relationship', 'fact']

const KIND_LABEL: Record<MemoryKind, string> = {
  preference: '用户偏好', project: '项目事实', workflow: '工作流', lesson: '经验', relationship: '关系', fact: '事实',
}

function mergeById(base: EmployeeMemory[], extra: EmployeeMemory[]): EmployeeMemory[] {
  if (!extra.length) return base
  const seen = new Set(base.map((item) => item.id))
  return base.concat(extra.filter((item) => !seen.has(item.id)))
}

export function MemoryTab(props: {
  employeeId: string
  snapshot: EmployeeSnapshot | null
  loadMemories?: MemoryLoader
}) {
  const { employeeId, snapshot, loadMemories } = props
  const counts = snapshot?.memoryCounts
  const [kind, setKind] = useState<MemoryKind>(() => KIND_ORDER.find((item) => (counts?.[item] || 0) > 0) || 'preference')
  const [extra, setExtra] = useState<Record<string, EmployeeMemory[]>>({})
  const [visible, setVisible] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!snapshot || !counts) return h('div', { className: 'cy9-ep-empty' }, '尚未取到持久化档案（CompanySnapshot）。', h('br'), '长期记忆存在本机 evolution.json，由 host 下发后自动恢复。')

  const total = counts[kind] || 0
  const loaded = mergeById(snapshot.recentMemories.filter((item) => item.kind === kind), extra[kind] || [])
  const limit = visible[kind] || PAGE_SIZE
  const shown = loaded.slice(0, limit)
  const hasLocal = loaded.length > shown.length
  const hasRemote = total > loaded.length
  const canLoadMore = hasLocal || (hasRemote && !!loadMemories)

  const loadMore = () => {
    setError('')
    if (hasLocal) { setVisible((current) => ({ ...current, [kind]: limit + PAGE_SIZE })); return }
    if (!loadMemories || !hasRemote || busy) return
    setBusy(true)
    Promise.resolve(loadMemories({ employeeId, kind, offset: loaded.length, limit: PAGE_SIZE }))
      .then((page) => {
        const items = Array.isArray(page?.items) ? page.items : []
        setExtra((current) => ({ ...current, [kind]: mergeById(current[kind] || [], items) }))
        setVisible((current) => ({ ...current, [kind]: limit + Math.max(items.length, PAGE_SIZE) }))
      })
      .catch((reason: any) => setError(String(reason?.message || reason || '加载失败')))
      .then(() => setBusy(false))
  }

  return h('div', null,
    h('div', { className: 'cy9-ep-groups' }, KIND_ORDER.map((item) => h('button', {
      key: item, type: 'button', className: kind === item ? 'on' : '', disabled: (counts[item] || 0) === 0,
      onClick: () => setKind(item),
    }, `${KIND_LABEL[item]} ${counts[item] || 0}`))),

    shown.length
      ? shown.map((memory) => h('div', { key: memory.id, className: 'cy9-ep-item cy9-ep-mem' },
        h('p', null, memory.text),
        h('div', { className: 'cy9-ep-item-head' },
          h('span', null, `重要度 ${memory.importance} · 被用 ${memory.useCount} 次 · ${formatAgo(memory.updatedAt)}`),
          memory.tags.length ? h('span', { className: 'tags' }, memory.tags.slice(0, 6).map((tag) => h('span', { key: tag }, tag))) : null,
        ),
      ))
      : h('div', { className: 'cy9-ep-empty' }, total > 0 ? '这一组的记忆还没有下发到前端。' : `暂无「${KIND_LABEL[kind]}」记忆。`, h('br'), '员工调用 staff_memory_remember 沉淀下来的内容会出现在这里。'),

    error ? h('p', { className: 'cy9-ep-note' }, `加载失败：${error}`) : null,
    canLoadMore
      ? h('button', { type: 'button', className: 'cy9-ep-more', disabled: busy, onClick: loadMore }, busy ? '加载中…' : `加载更多（已显示 ${shown.length} / ${total}）`)
      : hasRemote
        ? h('p', { className: 'cy9-ep-note' }, `本机还有 ${total - loaded.length} 条「${KIND_LABEL[kind]}」记忆未下发，需要 host 提供分页接口后才能翻阅。`)
        : shown.length ? h('p', { className: 'cy9-ep-note' }, `已显示全部 ${total} 条。`) : null,
  )
}
