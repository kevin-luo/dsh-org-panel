// 赛博公司 Host 装配入口。
//
// 运行时只有一条业务执行主链：
//   channel/web input -> Work Orchestrator -> real employees -> shared workgroup -> persistence/events
//
// host-v2 继续承担低层 Employee Runtime / Store 实现，但它旧的“秘书 dispatcher”Prompt 与
// staff_chat / staff_meeting 公共工具会在装配边界被物理屏蔽，不再进入真实 Tool Registry。
import { apply as applyCore, inject as coreInject, type Employee, type OrgPanelCore } from './host-v2'
import { registerCommunityMarket } from './community-market'
import { registerWorkOrchestrator, type WorkOrchestrator } from './collaboration/work-orchestrator'
import { installTaskSkillGrowth, type TaskSkillGrowthRuntime } from './capabilities/task-skill-growth'
import { registerModelGateway, type ModelGateway } from './models/gateway'
import { registerPluginRuntime, type PluginRuntimeHandle } from './capabilities/plugin-runtime'
import { registerCommunication, type CommunicationManager } from './integrations/im/manager'
import type { RosterEntry } from './integrations/im/types'
import { readEndpoints, type OrgPanelDeps } from './host/org-panel-read'
import { writeEndpoints } from './host/org-panel-write'
import { registerOrgPanelChannel, type OrgPanelChannelHandle } from './host/org-panel-rpc'
import { companyEventBus } from './runtime/event-bus'
import type { CompanyEvent } from './runtime/company-events'

export const inject = coreInject

export type OrgPanelHostFields = {
  core: OrgPanelCore
  orchestrator?: WorkOrchestrator
  growth?: TaskSkillGrowthRuntime
  gateway?: ModelGateway
  plugins?: PluginRuntimeHandle | null
  communication?: CommunicationManager
  channel?: OrgPanelChannelHandle
}

export type OrgPanelHost = OrgPanelHostFields & (() => Promise<void>)

const LEGACY_ROUTING_TOOLS = new Set(['staff_chat', 'staff_meeting'])

function bound<T extends object>(target: T, property: PropertyKey): any {
  const value = (target as any)[property]
  return typeof value === 'function' ? value.bind(target) : value
}

/**
 * host-v2 仍包含历史实现代码，但真实装载时不允许它把旧协调器暴露出来。
 * 这里不是“Prompt 覆盖”：旧 dispatcher section 与两枚星型路由工具根本不会进入宿主 Registry。
 */
function coreRuntimeContext(ctx: any): any {
  const realTools = ctx?.tools
  const realPrompt = ctx?.systemPrompt
  const tools = realTools ? new Proxy(realTools, {
    get(target, property) {
      if (property === 'register') {
        return (tool: any) => {
          if (LEGACY_ROUTING_TOOLS.has(String(tool?.name || ''))) return
          return target.register(tool)
        }
      }
      return bound(target, property)
    },
  }) : realTools
  const systemPrompt = realPrompt ? new Proxy(realPrompt, {
    get(target, property) {
      if (property === 'section') {
        return (section: any) => {
          if (String(section?.name || '') === 'dsh-org-panel:dispatcher') return
          return target.section(section)
        }
      }
      return bound(target, property)
    },
  }) : realPrompt

  // 只暴露 host-v2 真正会用到的宿主服务。get 仍绑定真实 cordis Context，
  // readCtxService 因此可以安全探测 agent / agents 等可选能力。
  return {
    tools,
    subagents: ctx?.subagents,
    systemPrompt,
    logger: ctx?.logger,
    get: typeof ctx?.get === 'function' ? ctx.get.bind(ctx) : undefined,
    on: typeof ctx?.on === 'function' ? ctx.on.bind(ctx) : undefined,
  }
}

function warn(ctx: any, layer: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  ctx?.logger?.warn?.(`dsh-org-panel: ${layer} 未能挂载，该能力本次运行不可用：${detail}`)
}

function rosterOf(employees: Employee[]): RosterEntry[] {
  return employees.map((item) => ({
    id: item.id,
    name: item.name,
    role: item.role,
    emoji: item.emoji,
    department: item.department,
    brief: item.brief,
    aliases: item.aliases,
    keywords: item.capabilities,
  }))
}

export function apply(ctx: any, config?: any): OrgPanelHost | undefined {
  // Employee Runtime 只负责“跑某个员工本人”。旧秘书协调器在这个边界直接被拿掉。
  const core = applyCore(coreRuntimeContext(ctx), config)
  if (!core) return undefined
  registerCommunityMarket(ctx)

  companyEventBus.setEmployeeIds(core.employees.map((item) => item.id))

  let orchestrator: WorkOrchestrator | undefined
  try {
    orchestrator = registerWorkOrchestrator(ctx, core, { events: companyEventBus })
  } catch (error) {
    warn(ctx, 'Work Orchestrator', error)
  }

  // 所有工作入口最终都通过 core.dispatch 结单，因此自动成长只需要包住这一份 Store。
  let growth: TaskSkillGrowthRuntime | undefined
  try {
    growth = installTaskSkillGrowth(core.store, {
      emit: (event) => companyEventBus.publish(event as CompanyEvent, 'host'),
      onError: (error, task) => warn(ctx, task ? `自动技能成长（${task.employeeId}/${task.id}）` : '自动技能成长', error),
    })
  } catch (error) {
    warn(ctx, '自动技能成长', error)
  }

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
    communication = registerCommunication(ctx, config, { events: companyEventBus })
    if (communication) {
      communication.setRoster(rosterOf(core.employees))
      // 外部渠道不再拿 employeeId 逐个派活；整条消息直接进入同一套 Work Orchestrator。
      communication.setDispatcher(orchestrator ? ((request) => orchestrator!.run(request)) : null)
    }
  } catch (error) {
    warn(ctx, '外部通讯层', error)
  }

  let channel: OrgPanelChannelHandle | undefined
  try {
    const deps: OrgPanelDeps = { core, gateway, plugins, communication, config }
    channel = registerOrgPanelChannel(ctx, { ...readEndpoints(deps), ...writeEndpoints(deps), ...core.memoryEndpoints })
  } catch (error) {
    warn(ctx, '/org-panel RPC 频道', error)
  }

  const host = (async () => {
    try { await channel?.dispose() } catch {}
    try { growth?.dispose() } catch {}
  }) as OrgPanelHost
  host.core = core
  host.orchestrator = orchestrator
  host.growth = growth
  host.gateway = gateway
  host.plugins = plugins
  host.communication = communication
  host.channel = channel
  return host
}
