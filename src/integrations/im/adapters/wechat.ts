// 微信 Adapter —— 骨架，**尚未实现**（需求文档二十八：第一版只做飞书；微信属于 Phase 7）。
// 同样不写任何假连接逻辑：状态如实为 degraded，发送直接抛「未实现」。
// 未来接企业微信 / 第三方 Adapter 时，消息仍然必须归一化成 ExternalMessage 走 Gateway → Router，
// 不允许出现「微信小刘」这种第二身份（需求文档二十九）。
import { type AdapterRuntime, type AdapterStatus, type CommunicationAdapterConfig, type ExternalMessage, type IMAdapter, type OutgoingMessage } from '../types'

const NOT_IMPLEMENTED = '微信 Adapter 尚未实现（计划在 Phase 7 接入企业微信 / Adapter）'

export class WeChatAdapter implements IMAdapter {
  readonly id: string
  readonly platform = 'wechat' as const

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

export function createWeChatAdapter(config: CommunicationAdapterConfig, runtime: AdapterRuntime): WeChatAdapter {
  return new WeChatAdapter(config, runtime)
}
