// 「赛博公司」host 入口。
// v3：在 v2 真实员工体系之上接入自我进化、真实 DSH 社区插件市场、多模型网关、
// 插件运行时（申请→人类审批→真实安装→验证）与外部通讯渠道。
export { inject, apply, type OrgPanelHost, type OrgPanelHostFields } from './host-v3'
export type { OrgPanelCore } from './host-v2'

// /org-panel RPC 频道：设置中心直接读真实台账的那条管子。
// 频道名与端点表导出来，是为了让前端与回归测试用同一份常量，而不是两边各写一个字符串。
export { ORG_PANEL_CHANNEL, registerOrgPanelChannel, createDispatcher, type EndpointMap, type OrgPanelChannelHandle } from './host/org-panel-rpc'
export { readEndpoints, type OrgPanelDeps, type StorageFileEntry } from './host/org-panel-read'
export { writeEndpoints } from './host/org-panel-write'

// cordis Context 上「可选宿主能力」的安全读取口：裸读未声明属性会抛，一律走它。
export { readCtxService, firstCtxService } from './runtime/ctx-service'

// 持久化层：宿主与测试可以直接复用同一套 Store 与类型，不需要另起炉灶。
export { EvolutionStore } from './persistence/evolution-store'
export { CompanyStore } from './persistence/company-store'
export { migrateStoreFile, detectStoreVersion, refreshDerivedStatistics, STORE_LIMITS } from './persistence/migrations'
export { computeSkillLevel, computeRecentUsageBonus, evolutionLevel, skillLevelFrom, isSecretRef } from './persistence/types'
export type {
  CompanySnapshot, EmployeeSnapshot, EmployeeEvolutionV2, EmployeeMemory, EmployeeStatistics,
  LearnedSkill, ModelBinding, ModelProviderConfig, PluginBinding, SkillEvidence, TaskHistory,
} from './persistence/types'

// 运行时事件总线：host 侧生产者（插件运行时 / 通讯层）与前端消费同一套事件契约。
export { CompanyEventBus, companyEventBus, SESSION_CHANNEL } from './runtime/event-bus'
export { reduceCompanyRuntime, emptyCompanyRuntime } from './runtime/company-events'
export type { CompanyEvent, CompanyRuntime, EmployeeRuntimeState } from './runtime/company-events'

// 能力层入口：需要单独挂载某一层（例如只要视觉网关）的宿主可以直接调用。
export { registerModelGateway, ModelGateway } from './models/gateway'
export { registerPluginRuntime, PluginRuntime } from './capabilities/plugin-runtime'
export { registerCommunication, CommunicationManager } from './integrations/im/manager'

// 安全边界原语：宿主接线与回归测试都要能直接调到，不导出就没人能验证它们真的生效。
export { assertCommandTargetsPackage, assertPackageToken, normalizePackageToken } from './capabilities/plugin-runtime'
export { createWriteGate, isWriteToolName } from './integrations/im/types'
export type { WriteGate } from './integrations/im/types'
