// QQ Adapter —— 骨架，**尚未实现**（需求文档二十八：第一版只做飞书；QQ 属于 Phase 7）。
// 这里刻意不写任何假连接逻辑：不伪造 connected 状态、不伪造消息、不伪造发送成功。
// 未来实现时只需要填 start/stop/send 与事件归一化，路由、权限、hops 全部复用 Gateway + Router，
// 绝不允许在这里另写一套 Agent 逻辑或另建一份「QQ 员工」身份（需求文档二十一 / 二十九）。
import { type AdapterRuntime, type AdapterStatus, type CommunicationAdapterConfig, type ExternalMessage, type IMAdapter, type OutgoingMessage } from '../types'

const NOT_IMPLEMENTED = 'QQ Adapter 尚未实现（计划在 Phase 7 接入 QQ Bot / OneBot）'

export class QQAdapter implements IMAdapter {
  readonly id: string
  readonly platform = 'qq' as const

  private handler: ((message: ExternalMessage) => void) | null = null
  private state: AdapterStatus['state'] = 'idle'

  constructor(private readonly config: CommunicationAdapterConfig, private readonly runtime: AdapterRuntime) {
    this.id = config.id
  }

  onMessage(handler: (message: ExternalMessage) => void): void {
    this.handler = handler
  }

  status(): AdapterStatus {
    return { id: this.id, platform: this.platform, state: this.state, detail: NOT_IMPLEMENTED, receivedCount: 0, sentCount: 0 }
  }

  async start(): Promise<void> {
    // 安静降级：只提示一次，不连接、不报错刷屏。
    this.state = 'degraded'
    if (this.config.enabled) this.runtime.logger?.info?.(`dsh-org-panel: ${NOT_IMPLEMENTED}，渠道 ${this.config.name} 保持未连接`)
    void this.handler
  }

  async stop(): Promise<void> {
    this.state = 'stopped'
  }

  async send(_conversationId: string, _message: OutgoingMessage): Promise<void> {
    throw new Error(NOT_IMPLEMENTED)
  }
}

export function createQQAdapter(config: CommunicationAdapterConfig, runtime: AdapterRuntime): QQAdapter {
  return new QQAdapter(config, runtime)
}
