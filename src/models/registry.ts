// 供应商适配器注册表。接新厂商 = 新增 providers/xxx.ts + 在这里 register，gateway 一行都不用改。
// 网关只通过 vendor 找适配器，不写任何 if (provider === '某家厂商') 分支。
import { customAdapter } from './providers/custom'
import { geminiAdapter } from './providers/gemini'
import { openAiCompatibleAdapter } from './providers/openai-compatible'
import { ModelGatewayError, type ModelCapability, type ModelProviderVendor, type ProviderAdapter } from './types'

export class ProviderRegistry {
  private readonly adapters = new Map<ModelProviderVendor, ProviderAdapter>()

  register(adapter: ProviderAdapter): this {
    this.adapters.set(adapter.vendor, adapter)
    return this
  }

  has(vendor: ModelProviderVendor): boolean { return this.adapters.has(vendor) }

  get(vendor: ModelProviderVendor): ProviderAdapter | undefined { return this.adapters.get(vendor) }

  /** 找不到适配器时抛归一化错误，让 fallback 链继续走下一家，而不是整条链崩掉。 */
  require(vendor: ModelProviderVendor, providerId?: string): ProviderAdapter {
    const adapter = this.adapters.get(vendor)
    if (!adapter) throw new ModelGatewayError('unsupported', `没有注册 provider="${vendor}" 的适配器。`, { providerId })
    return adapter
  }

  list(): ProviderAdapter[] { return Array.from(this.adapters.values()) }

  supporting(capability: ModelCapability): ProviderAdapter[] { return this.list().filter((adapter) => adapter.supports(capability)) }
}

/** 内置三类协议：OpenAI 兼容、Gemini 协议、自定义 HTTP。都是协议实现，不是某一家厂商。 */
export const BUILTIN_ADAPTERS: ProviderAdapter[] = [openAiCompatibleAdapter, geminiAdapter, customAdapter]

export function createProviderRegistry(extra: ProviderAdapter[] = []): ProviderRegistry {
  const registry = new ProviderRegistry()
  for (const adapter of BUILTIN_ADAPTERS) registry.register(adapter)
  for (const adapter of extra) registry.register(adapter)
  return registry
}

/** 默认注册表；调用方也可以自己 createProviderRegistry 注入额外适配器。 */
export const defaultProviderRegistry: ProviderRegistry = createProviderRegistry()
