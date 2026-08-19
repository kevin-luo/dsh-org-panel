// 员工文本模型路由：把公司里的 text ModelBinding 映射到 DSH 真正注册的 LLM provider route。
//
// 关键边界：
// - company provider id 是我们的持久化 ID；dshProvider 才是 DSH LlmRuntime 的 provider route；
// - 只有 llm.listProviders() 当前真实存在的 route 才能进入 subagent agentOptions；
// - 显式绑定优先，随后按 company.json 同类型顺序走公司兜底；
// - route 丢失时绑定状态如实变 missing；恢复后下一次执行自动回 available；
// - 完全没有可用文本 route 时返回 undefined，让 DSH 子代理继承当前执行根模型，不伪造“员工专属模型”。
import type { CompanyStore } from '../persistence/company-store'
import type { EvolutionStore } from '../persistence/evolution-store'
import type { ModelBinding, ModelProviderConfig } from '../persistence/types'
import { readCtxService } from '../runtime/ctx-service'

export type DshProviderRoute = { id: string; name: string }

export type EmployeeAgentRoute = {
  providerId: string
  dshProvider: string
  model: string
  bound: boolean
  priority: number
  agentOptions: { provider: string; model: string }
}

type LlmRuntimeLike = {
  listProviders?(): Array<{ id?: unknown; name?: unknown }>
}

export function listDshProviderRoutes(ctx: any): DshProviderRoute[] {
  const llm = readCtxService<LlmRuntimeLike>(ctx, 'llm')
  if (!llm || typeof llm.listProviders !== 'function') return []
  try {
    const rows = llm.listProviders()
    if (!Array.isArray(rows)) return []
    const seen = new Set<string>()
    const out: DshProviderRoute[] = []
    for (const row of rows) {
      const id = typeof row?.id === 'string' ? row.id.trim() : ''
      const name = typeof row?.name === 'string' ? row.name.trim() : ''
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push({ id, name: name || id })
    }
    return out
  } catch {
    return []
  }
}

function bindingCandidates(bindings: ModelBinding[], providers: ModelProviderConfig[]): Array<{ config: ModelProviderConfig; binding?: ModelBinding; priority: number }> {
  const byId = new Map(providers.map((item) => [item.id, item]))
  const seen = new Set<string>()
  const out: Array<{ config: ModelProviderConfig; binding?: ModelBinding; priority: number }> = []
  for (const binding of bindings
    .filter((item) => item.capability === 'text' && item.status !== 'disabled')
    .sort((a, b) => a.priority - b.priority)) {
    const config = byId.get(binding.providerId)
    if (!config || seen.has(config.id)) continue
    seen.add(config.id)
    out.push({ config, binding, priority: binding.priority })
  }
  providers.forEach((config, index) => {
    if (seen.has(config.id)) return
    seen.add(config.id)
    out.push({ config, priority: 100 + index })
  })
  return out
}

export async function resolveEmployeeAgentRoute(input: {
  ctx: any
  company: CompanyStore
  store: EvolutionStore
  employeeId: string
}): Promise<EmployeeAgentRoute | undefined> {
  const providers = (await input.company.modelProviders('text')).filter((item) => item.enabled)
  if (!providers.length) return undefined
  const routes = new Set(listDshProviderRoutes(input.ctx).map((item) => item.id))
  if (!routes.size) return undefined
  const bindings = await input.store.modelBindings(input.employeeId).catch(() => [] as ModelBinding[])

  for (const candidate of bindingCandidates(bindings, providers)) {
    const route = candidate.config.dshProvider?.trim()
    const binding = candidate.binding
    if (!route || !routes.has(route)) {
      if (binding && binding.status !== 'missing') {
        await input.store.updateModelStatus(input.employeeId, 'text', binding.providerId, 'missing').catch(() => null)
      }
      continue
    }
    if (binding && binding.status !== 'available') {
      await input.store.updateModelStatus(input.employeeId, 'text', binding.providerId, 'available').catch(() => null)
    }
    return {
      providerId: candidate.config.id,
      dshProvider: route,
      model: candidate.config.model,
      bound: !!binding,
      priority: candidate.priority,
      agentOptions: { provider: route, model: candidate.config.model },
    }
  }
  return undefined
}
