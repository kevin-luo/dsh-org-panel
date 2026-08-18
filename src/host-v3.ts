// 「赛博公司」host 装配入口 v3。
//
// 分层：host-v2 负责员工 / 记忆 / 技能 / 路由这套核心（8 个工具原样保留），
// 这里在它之上把 v2.0 的四个能力层挂上去，全部复用 host-v2 已经建好的 Store 实例：
//   1. Community Market —— 真实 DSH 社区插件搜索（只披露不安装）
//   2. Model Gateway    —— 多模型能力路由 + vision_analyze（没配模型就如实报错，绝不脑补图片）
//   3. Plugin Runtime   —— 插件安装申请 / 人类审批 / 真实验证 / 技能证据
//   4. Communication    —— 飞书 / QQ / 微信 外部渠道（未配置时安静降级）
//
// 铁律：同一份 evolution.json / company.json 只能有一个写入者。任何新增能力层都必须
// 通过 core.store / core.company 复用实例，不允许自己 new 一个。
import { apply as applyCore, inject as coreInject, type Employee, type OrgPanelCore } from './host-v2'
import { registerCommunityMarket } from './community-market'
import { registerModelGateway, type ModelGateway } from './models/gateway'
import { registerPluginRuntime, type PluginRuntimeHandle } from './capabilities/plugin-runtime'
import { registerCommunication, type CommunicationManager } from './integrations/im/manager'
import type { EmployeeDispatcher, RosterEntry } from './integrations/im/types'
import { companyEventBus } from './runtime/event-bus'
import type { CompanyEvent } from './runtime/company-events'

export const inject = coreInject

/** 装配结果；便于宿主 / 测试拿到各层实例，运行时不依赖它。 */
export type OrgPanelHost = {
  core: OrgPanelCore
  gateway?: ModelGateway
  plugins?: PluginRuntimeHandle | null
  communication?: CommunicationManager
}

function warn(ctx: any, layer: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  // 单层挂载失败不能拖垮整个插件：员工核心已经可用，缺的那层如实写进日志。
  ctx?.logger?.warn?.(`dsh-org-panel: ${layer} 未能挂载，该能力本次运行不可用：${detail}`)
}

/**
 * 名册只能有一份。通讯层自己也能从 config 推一遍（rosterFromConfig），但那是第二个真相来源：
 * 一旦 host-v2 的 configuredEmployees 与它的回退规则出现分歧，Web 与飞书就会看到两份名册。
 * 所以这里把 core.employees 原样翻译成 RosterEntry 覆盖下去。
 */
function rosterOf(employees: Employee[]): RosterEntry[] {
  return employees.map((item) => ({
    id: item.id,
    name: item.name,
    role: item.role,
    emoji: item.emoji,
    department: item.department,
    brief: item.brief,
    aliases: item.aliases,
    // auto 路由的关键词就用员工真实声明的能力，不另编一套。
    keywords: item.capabilities,
  }))
}

/**
 * 把 host-v2 的可编程派活入口接成通讯层的 EmployeeDispatcher。
 * 这是 Phase 6 端到端可达的关键一环：没有它，Router 只会回「当前没有可用的员工运行时」。
 */
function createDispatcher(core: OrgPanelCore): EmployeeDispatcher {
  return async (request) => {
    const outcome = await core.dispatch({
      employeeId: request.employeeId,
      text: request.text,
      // 履历来源直接用 Router 给的平台口径，员工档案里的「[飞书]」标签就是从这里来的。
      source: request.taskSource,
      channelId: request.companyChannelId || request.conversationId,
      platform: request.platform,
      senderName: request.senderName || request.senderId,
      permissionMode: request.permissionMode,
      writeAllowed: request.writeAllowed,
      writeGate: request.writeGate,
    })
    return {
      ok: outcome.ok,
      text: outcome.reply,
      error: outcome.error,
      // 真实观测到的工具调用如实上报，只读渠道的越权审计（Router.auditWrite）靠它。
      usedTools: outcome.tools,
    }
  }
}

export function apply(ctx: any, config?: any): OrgPanelHost | undefined {
  const core = applyCore(ctx, config)
  // 核心装配失败时整个插件不可用：市场工具也不能留在 Tool Registry 里，
  // 否则老板会看到一个「能搜插件、但没有任何员工能学」的半截能力。
  if (!core) return undefined
  registerCommunityMarket(ctx)

  // Company Event Bus：host 侧生产者（Plugin Runtime / 通讯层）统一往这里投真实事件。
  // 挂到 ctx 上是为了让 registerCommunication 的 resolveEventSink 能自动发现它。
  if (!ctx.companyEventBus) ctx.companyEventBus = companyEventBus
  companyEventBus.setEmployeeIds(core.employees.map((item) => item.id))

  let gateway: ModelGateway | undefined
  try {
    gateway = registerModelGateway(ctx, config, {
      company: core.company,
      evolution: core.store,
      staffIds: core.employees.map((item) => item.id),
    })
  } catch (error) {
    warn(ctx, 'Model Gateway', error)
  }

  let plugins: PluginRuntimeHandle | null = null
  try {
    plugins = registerPluginRuntime(ctx, {
      store: core.store,
      memoryFile: config?.memoryFile,
      approvalsFile: config?.approvalsFile,
      staff: core.employees.map((item) => ({ id: item.id, name: item.name, role: item.role })),
      pluginInstall: config?.pluginInstall,
      healthCheckOnStart: config?.healthCheckOnStart,
      emit: (event) => companyEventBus.publish(event as CompanyEvent, 'host'),
    })
  } catch (error) {
    warn(ctx, 'Plugin Runtime', error)
  }

  let communication: CommunicationManager | undefined
  try {
    communication = registerCommunication(ctx, config)
    if (communication) {
      // 顺序要紧：先统一名册，再接员工运行时，最后外部消息才有真实的人可派。
      communication.setRoster(rosterOf(core.employees))
      communication.setDispatcher(createDispatcher(core))
    }
  } catch (error) {
    warn(ctx, '外部通讯层', error)
  }

  return { core, gateway, plugins, communication }
}
