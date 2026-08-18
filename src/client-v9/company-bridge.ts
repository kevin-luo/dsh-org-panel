// 「赛博公司」client 侧 host↔UI 桥接层（集成 Phase）。
//
// 解决需求文档 2.1 点名的 bug：打开一个全新的空 Session 时，工作台不能只剩本 Session 的
// Tool Event，必须能显示真实的历史成长数据（等级 / 经验 / 技能 / 插件 / 履历）。
//
// 现实约束（已实读 @deepseek-ai/dsh-client-ui-conversation 的 slot 契约）：
//   conversation.view 拿到的 props 只有 useSession / inputActions / renderSlots 等，
//   **DSH 这一版没有给插件 client→host 的 RPC 通道**，client 无法主动调用 host 工具。
// 因此 hydrate 只有两条真实来源，本文件把它们接起来，一条都不伪造：
//   A. 本 Session 里 company_snapshot 工具真实跑过 → 从 tool-result 节点解析（权威、最新）。
//   B. 上一次 A 命中时写进 localStorage 的同一份快照 → 空 Session 冷启动时先用它，
//      UI 上以 snapshot.generatedAt 如实标注「数据时间」，不假装它是此刻的状态。
// 两者都没有 → 交出 null，各个面板显示 0 / — / 暂无（文档四十八条），绝不编造数字。
import { useEffect, useMemo } from 'react'
import type { CompanySnapshot } from '../persistence/types'
import type { RoleDef, StaffDef } from './types'
import { applyCompanySnapshot, readCompanySnapshot, setCompanySnapshot, useCompanySnapshot } from './employee-profile/EmployeeProfile'
import { deriveCompanyEvents } from './selectors'
import { companyEventBus, SESSION_CHANNEL } from '../runtime/event-bus'

/** host 侧 host-v2.ts 注册的快照工具名。改名必须两边一起改。 */
export const SNAPSHOT_TOOL = 'company_snapshot'

const CACHE_KEY = 'dsh-org-panel:company-snapshot:v2'
/** 超过这个体积就不进 localStorage：宁可下次重新拉，也不要把老板的存储塞爆。 */
const CACHE_LIMIT = 2 * 1024 * 1024

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    // Safari 隐私模式 / 被策略禁用：当作没有缓存，不报错。
    return null
  }
}

/** 结构校验后再落缓存；坏数据不写盘，也不覆盖上一份好数据。 */
function isSnapshot(value: any): value is CompanySnapshot {
  return !!value && typeof value === 'object' && Number(value.version) === 2 && Array.isArray(value.employees)
}

export function readCachedSnapshot(): CompanySnapshot | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return isSnapshot(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeCachedSnapshot(snapshot: CompanySnapshot): void {
  const store = storage()
  if (!store) return
  try {
    const raw = JSON.stringify(snapshot)
    if (raw.length > CACHE_LIMIT) return
    store.setItem(CACHE_KEY, raw)
  } catch {
    // 配额满或被禁用：缓存只是加速手段，失败不影响本 Session 的真实数据。
  }
}

export function clearCachedSnapshot(): void {
  try { storage()?.removeItem(CACHE_KEY) } catch { /* 同上 */ }
}

function textOfNode(node: any): string {
  const blocks = node?.content
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const block of blocks) if (block && typeof block.text === 'string') parts.push(block.text)
  return parts.join('\n').trim()
}

/**
 * 从会话节点流里取出最近一次 company_snapshot 的真实结果。
 * 只认 company_snapshot 的成功 tool-result，其它工具一律不当快照用。
 */
export function extractCompanySnapshot(nodes: any[]): CompanySnapshot | null {
  let latest: CompanySnapshot | null = null
  for (const node of nodes || []) {
    if (node?.kind !== 'tool-result' || node.isError) continue
    if (String(node.call?.name || '') !== SNAPSHOT_TOOL) continue
    const text = textOfNode(node)
    if (!text) continue
    try {
      const parsed = JSON.parse(text)
      if (isSnapshot(parsed)) latest = parsed
    } catch {
      // 输出被截断或不是 JSON：跳过这一条，继续找更早的完整快照。
    }
  }
  return latest
}

export type CompanyHydration = {
  snapshot: CompanySnapshot | null
  /** true 表示当前这份来自 localStorage 缓存，而不是本 Session 刚跑出来的。 */
  cached: boolean
}

/**
 * hydrate 主入口：会话里有新快照就用新的并写缓存，没有就用缓存兜底。
 * 结果同时推进 employee-profile 的全局 store，OfficeWorld / RightRail / 员工档案 / 设置中心
 * 都通过 useCompanySnapshot() 自动拿到同一份数据，不需要各自传 prop。
 */
export function useCompanyHydration(nodes: any[]): CompanyHydration {
  const fromSession = useMemo(() => extractCompanySnapshot(nodes), [nodes])

  useEffect(() => {
    if (fromSession) {
      setCompanySnapshot(fromSession)
      writeCachedSnapshot(fromSession)
      return
    }
    // 会话里还没有快照：只在全局 store 为空时用缓存冷启动，绝不覆盖已有的新数据。
    if (readCompanySnapshot()) return
    const cached = readCachedSnapshot()
    if (cached) applyCompanySnapshot(cached)
  }, [fromSession])

  const snapshot = useCompanySnapshot()
  return { snapshot, cached: !!snapshot && !fromSession }
}

/**
 * 会话节点流 → Company Event Bus 的 'session' 通道。
 * 幂等全量替换：内容没变就不通知，React 不会因此死循环（见 event-bus.setChannel）。
 * 办公室 / 右栏 / 档案统一从总线读状态，不再各自从 nodes 推导。
 */
export function useSessionEventChannel(nodes: any[], runningCalls: any[], roles: RoleDef[], staff: StaffDef[]): void {
  const events = useMemo(
    () => deriveCompanyEvents(nodes, runningCalls, roles, staff),
    [nodes, runningCalls, roles, staff],
  )
  useEffect(() => {
    companyEventBus.setEmployeeIds(staff.map((item) => item.id))
    companyEventBus.setChannel(SESSION_CHANNEL, events)
  }, [events, staff])
}

/**
 * 「刷新公司数据」：client 没有 RPC，唯一诚实的做法是把指令写进原生 Composer 草稿，
 * 由老板自己按回车。绝不自动提交，也不假装已经刷新成功。
 */
export const REFRESH_PROMPT = '调用 company_snapshot 读取赛博公司当前的完整持久化状态，然后用一句话概括即可。'
export const REFRESH_RESULT = '已把刷新指令写进下方输入框，按回车让秘书执行 company_snapshot 后工作台会自动更新。'
