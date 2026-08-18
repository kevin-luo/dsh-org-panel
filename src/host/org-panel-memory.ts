// 「赛博公司」/org-panel 频道的**记忆**端点：证据台账 + 真实分页。
//
// 这两个端点各自回答一句老板的话：
//   memory/evidence —— 「你凭什么说老王越来越懂我的代码库？」
//                       答：这一轮真的把这 3 条记忆、2 条复盘写进了他的 prompt，原文在这儿。
//   memory/page     —— 「档案里 82 条记忆我要往下翻。」
//                       答：一页 10 条按 offset 取，不是一次把 120 条全塞给浏览器（文档四十四条）。
//
// 三条硬规矩：
//   1. 只读，无副作用。employeeId 必须在真实名册里 —— 否则 EvolutionStore.profileRef() 会顺手
//      给一个不存在的 id 建空档案，等于让 RPC 调用方往公司里凭空塞员工。
//   2. 证据只来自 EvolutionStore 的注入台账，也就是**真的发出去过**的那批 id。
//      「可能相关的记忆」不是证据，这里一条都不算。
//   3. 台账是本进程内存态：重启后查不到就如实回空数组，前端表现为「没有 chip」，
//      绝不退化成「显示 0 条」——「读不到」和「没有」不许长一个样。
import type { EvolutionStore, MemoryEvidenceView } from '../persistence/evolution-store'
import type { EmployeeIdentity, MemoryKind } from '../persistence/types'
import { MEMORY_KINDS } from '../persistence/types'
import type { EndpointMap } from './org-panel-rpc'

export type MemoryEndpointDeps = {
  store: EvolutionStore
  /** 真实名册。端点只认这里面的 employeeId。 */
  roster: EmployeeIdentity[]
}

/** 一次 memory/evidence 最多回多少条台账。再多也不会让老板看得更清楚。 */
const EVIDENCE_MAX = 10

export function memoryEndpoints(deps: MemoryEndpointDeps): EndpointMap {
  const { store } = deps
  const known = new Set(deps.roster.map((item) => item.id))

  const requireEmployeeId = (value: unknown): string => {
    const employeeId = String(value ?? '').trim()
    if (!employeeId) throw new Error('memory 端点必须带 employeeId')
    if (!known.has(employeeId)) throw new Error(`名册里没有 ${employeeId} 这位员工`)
    return employeeId
  }

  const memoryPage = async (payload: any) => {
    const employeeId = requireEmployeeId(payload?.employeeId)
    const rawKind = String(payload?.kind ?? '').trim()
    if (rawKind && !MEMORY_KINDS.includes(rawKind as MemoryKind)) throw new Error(`不认识的记忆分组：${rawKind}`)
    const page = await store.memoryPage(employeeId, {
      kind: rawKind ? (rawKind as MemoryKind) : undefined,
      offset: Number(payload?.offset) || 0,
      limit: Number(payload?.limit) || 10,
    })
    return { available: true, employeeId, kind: rawKind || undefined, ...page }
  }

  const memoryEvidence = async (payload: any) => {
    const limit = Math.min(Math.max(Math.floor(Number(payload?.limit) || 1), 1), EVIDENCE_MAX)
    const injectionId = String(payload?.injectionId ?? '').trim()
    if (injectionId) {
      const view = await store.memoryEvidence(injectionId)
      // 台账里没有这条 = 这次运行没记过它（多半是重启过）。如实回空，不编。
      return { available: true, injections: view ? [view] : [] }
    }
    const employeeId = payload?.employeeId === undefined || payload?.employeeId === null || payload?.employeeId === ''
      ? undefined
      : requireEmployeeId(payload.employeeId)
    const records = store.memoryInjections({
      employeeId,
      taskId: String(payload?.taskId ?? '').trim() || undefined,
      childId: String(payload?.childId ?? '').trim() || undefined,
      limit,
    })
    const injections: MemoryEvidenceView[] = []
    for (const record of records) {
      const view = await store.memoryEvidence(record.id)
      if (view) injections.push(view)
    }
    return { available: true, injections }
  }

  return {
    'memory/page': memoryPage,
    'memory/evidence': memoryEvidence,
  }
}
