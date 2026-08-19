// 赛博公司 Host 装配入口。
//
// 唯一业务主链：
//   Web / IM -> Work Orchestrator -> Employee Runtime.dispatch -> persistence / events
//
// Employee Runtime 只负责跑某一位真实员工；所有选人、组队、动态邀请都只存在于 Work Orchestrator。
import { apply as applyCore, type Employee, type OrgPanelCore } from './host-v2'
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

// Host 自己需要 systemPrompt 来注册不可见调度内核规则；Employee Runtime 本身不依赖 systemPrompt。
export const inject = ['tools', 'subagents', 'systemPrompt']

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
  const core = applyCore(ctx, config)
  if (!core) return undefined
  registerCommunityMarket(ctx)

  companyEventBus.setEmployeeIds(core.employees.map((item) => item.id))

  let orchestrator: WorkOrchestrator | undefined
  try {
    orchestrator = registerWorkOrchestrator(ctx, core, {
      events: companyEventBus,
      sessionFile: config?.workSessionFile,
    })
  } catch (error) {
    warn(ctx, 'Work Orchestrator', error)
  }

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
      communication.setDispatcher(orchestrator ? ((request) => orchestrator!.run(request)) : null)
    }
  } catch (error) {
    warn(ctx, '外部通讯层', error)
  }

  let channel: OrgPanelChannelHandle | undefined
  try {
    const deps: OrgPanelDeps = { core, orchestrator, gateway, plugins, communication, config }
    channel = registerOrgPanelChannel(ctx, { ...readEndpoints(deps), ...writeEndpoints(deps), ...core.memoryEndpoints })
  } catch (error) {
    warn(ctx, '/org-panel RPC 频道', error)
  }

  const host = (async () => {
    try { await channel?.dispose() } catch {}
    try { await communication?.stop() } catch {}
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
