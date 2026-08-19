import { useEffect, useState } from 'react'
import { callOrgPanel, type OrgPanelRpc } from './rpc'

export type WorkgroupSummary = {
  id: string
  key: string
  goal: string
  status: 'active' | 'blocked' | 'completed'
  origin?: { source?: string; platform?: string; conversationId?: string; senderName?: string }
  participants?: Array<{ employeeId: string; employeeName: string; role: string }>
  messageCount?: number
  turnCount?: number
  lastTurn?: { employeeId?: string; employeeName?: string; role?: string; reply?: string; outcome?: string; at?: number }
  createdAt: number
  updatedAt: number
}

export type WorkgroupFeed = {
  loaded: boolean
  available: boolean
  sessions: WorkgroupSummary[]
  reason?: string
}

const EMPTY: WorkgroupFeed = { loaded: false, available: false, sessions: [] }

/**
 * 持久工作组只读投影。它跟聊天 Session 本身解耦：刷新页面、打开新 Session，
 * 仍然能看到 host 上真实存在的微信 / QQ / 飞书 / Web 工作组。
 */
export function useRecentWorkgroups(rpc: OrgPanelRpc | null | undefined, revision: string | number): WorkgroupFeed {
  const [state, setState] = useState<WorkgroupFeed>(EMPTY)

  useEffect(() => {
    if (!rpc) { setState({ loaded: true, available: false, sessions: [], reason: '当前没有 client↔host RPC 通道。' }); return }
    const controller = new AbortController()
    let disposed = false
    const load = async () => {
      const outcome = await callOrgPanel<any>(rpc, 'work/sessions', { limit: 8 }, controller.signal)
      if (disposed) return
      if (outcome.state !== 'ok') {
        setState({ loaded: true, available: false, sessions: [], reason: outcome.state === 'unavailable' ? 'host /org-panel 通道不可用。' : outcome.message })
        return
      }
      const value = outcome.value as any
      if (!value || value.available === false) {
        setState({ loaded: true, available: false, sessions: [], reason: String(value?.reason || 'host 没有返回工作组数据。') })
        return
      }
      const sessions = Array.isArray(value.sessions) ? value.sessions.filter((item: any) => item && typeof item.id === 'string') : []
      setState({ loaded: true, available: true, sessions })
    }
    void load()
    // 外部 IM 可能在当前 Web Session 没有节点变化；页面可见时低频补一次即可。
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void load()
    }, 30000)
    return () => { disposed = true; controller.abort(); window.clearInterval(timer) }
  }, [rpc, revision])

  return state
}

export function workgroupPlatformLabel(value?: string): string {
  if (value === 'wechat') return '微信'
  if (value === 'feishu') return '飞书'
  if (value === 'qq') return 'QQ'
  if (value === 'web') return 'Web'
  return value || '未知来源'
}
