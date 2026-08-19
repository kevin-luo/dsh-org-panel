// 「赛博公司」host 装配入口 v3。
//
// 分层：host-v2 负责员工 / 记忆 / 技能 / 路由这套核心，
// 这里在它之上把 v2.0 的能力层挂上去，全部复用 host-v2 已经建好的 Store 实例：
//   1. Community Market —— 真实 DSH 社区插件搜索（只披露不安装）
//   2. Task Team Runtime —— 任务自动组队；root 只做不可见调度，不再把秘书当主 Agent
//   3. Task Skill Growth —— 真实任务结果自动沉淀 SkillEvidence
//   4. Model Gateway    —— 多模型能力路由 + vision_analyze（没配模型就如实报错，绝不脑补图片）
//   5. Plugin Runtime   —— 插件安装申请 / 人类审批 / 真实验证 / 技能证据
//   6. Communication    —— 飞书 / QQ / 微信 外部渠道（未配置时安静降级）
// 再加一条 /org-panel RPC 频道，把上面能力层的真实台账直接送到浏览器里的设置中心。
//
// 铁律：同一份 evolution.json / company.json 只能有一个写入者。任何新增能力层都必须
// 通过 core.store / core.company 复用实例，不允许自己 new 一个。
import { apply as applyCore, inject as coreInject, type Employee, type OrgPanelCore } from './host-v2'
import { registerCommunityMarket } from './community-market'
import { registerTeamRuntime, type TeamRuntimeHandle } from './collaboration/team-runtime'
import { installTaskSkillGrowth, type TaskSkillGrowthRuntime } from './capabilities/task-skill-growth'
import { registerModelGateway, type ModelGateway } from './models/gateway'
import { registerPluginRuntime, type PluginRuntimeHandle } from './capabilities/plugin-runtime'
import { registerCommunication, type CommunicationManager } from './integrations/im/manager'
import type { EmployeeDispatcher, RosterEntry } from './integrations/im/types'
import { readEndpoints, type OrgPanelDeps } from './host/org-panel-read'
import { writeEndpoints } from './host/org-panel-write'
import { registerOrgPanelChannel, type OrgPanelChannelHandle } from './host/org-panel-rpc'
import { companyEventBus } from './runtime/event-bus'
import type { CompanyEvent } from './runtime/company-events'

export const inject = coreInject

/** 装配好的能力层实例。宿主与测试拿它做断言，运行时不依赖它。 */
export type OrgPanelHostFields = {
  core: OrgPanelCore
  team?: TeamRuntimeHandle
  growth?: TaskSkillGrowthRuntime
  gateway?: ModelGateway
  plugins?: PluginRuntimeHandle | null
  communication?: CommunicationManager
  /** /org-panel RPC 频道句柄；registered() === false 表示这套部署没有 connection 传输层（原因看 pendingReason()）。 */
  channel?: OrgPanelChannelHandle
}

/**
 * apply() 的返回值。
 *
 * 为什么是「函数 + 属性」而不是普通对象：cordis 会把插件 apply() 的返回值当 **effect** 处理
 * （lib/index.js 的 `_execute`：函数 → 当 disposer 收走；nullable → 忽略；thenable / iterable →
 * 按序展开；**其余一律 `throw new TypeError('Invalid effect')`**）。
 * 之前这里返回的是普通对象 `{core, gateway, …}`，于是每一次真实装载都让 fiber 直接进入失败态，
 * 连带 /org-panel 频道、systemPrompt 段落全都不会生效 —— 这就是老板看到「模型 0 / 插件 0」的原因之一。
 *
 * 改成 dispose 函数之后：cordis 拿到的是一个合法 disposer（顺带把卸载清理补上了），
 * 而 `assert.ok(host)`、`host.core`、`host.gateway` 这些既有用法一个字都不用改。
 */
export type OrgPanelHost = OrgPanelHostFields & (() => Promise<void>)

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

  // Company Event Bus：host 侧生产者（自动组队 / 自动成长 / Plugin Runtime / 通讯层）统一往这里投真实事件。
  // 所有生产者都走显式依赖，不往 cordis ctx 上挂第二真相来源。
  companyEventBus.setEmployeeIds(core.employees.map((item) => item.id))

  // Task Team Runtime：产品层彻底取消“秘书 = 主 Agent”。底层 root 只作为 DSH 执行根和调度内核，
  // company_work 会根据任务自动选择员工，并让员工共享前序同事的真实公开输出；员工还能 @ 新同事动态入场。
  let team: TeamRuntimeHandle | undefined
  try {
    team = registerTeamRuntime(ctx, core, { events: companyEventBus })
  } catch (error) {
    warn(ctx, 'Task Team Runtime', error)
  }

  // 真实任务 → SkillEvidence：直接包住 core.store 的结单入口，所以 company_work、staff_chat、会议、外部 IM
  // 和系统回填共用同一条成长链。只有首次完成、且 outcome 可判定为 success/failed 才记证据。
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
      // 顺序要紧：先统一名册，再接员工运行时，最后外部消息才有真实的人可派。
      communication.setRoster(rosterOf(core.employees))
      communication.setDispatcher(createDispatcher(core))
    }
  } catch (error) {
    warn(ctx, '外部通讯层', error)
  }

  // /org-panel RPC 频道：把上面能力层的真实状态直接送到浏览器里的设置中心。
  // 无条件调用；没有 connection 时它自己安静降级，绝不抛。
  let channel: OrgPanelChannelHandle | undefined
  try {
    const deps: OrgPanelDeps = { core, gateway, plugins, communication, config }
    // core.memoryEndpoints 是记忆证据台账 + 记忆分页（见 host/org-panel-memory.ts）。
    // 它读的是 core 自己的运行时台账，所以由 core 提供、在这里并进同一条频道。
    channel = registerOrgPanelChannel(ctx, { ...readEndpoints(deps), ...writeEndpoints(deps), ...core.memoryEndpoints })
  } catch (error) {
    warn(ctx, '/org-panel RPC 频道', error)
  }

  // 返回值必须是 cordis 合法 effect（见 OrgPanelHost 的注释）：这是一个 dispose 函数，
  // 能力层实例挂在它的属性上。卸载时撤 RPC，并恢复被自动成长包装过的 Store 方法，
  // 避免热重载后同一个结单被两层 wrapper 重复记证据。
  const host = (async () => {
    try { await channel?.dispose() } catch { /* 卸载失败不许拖住整个插件的卸载 */ }
    try { growth?.dispose() } catch { /* 恢复失败同样不阻断卸载 */ }
  }) as OrgPanelHost
  host.core = core
  host.team = team
  host.growth = growth
  host.gateway = gateway
  host.plugins = plugins
  host.communication = communication
  host.channel = channel
  return host
}
