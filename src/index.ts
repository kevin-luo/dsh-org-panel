// 「赛博公司」host 入口。
// 当前架构：全渠道 Work Orchestrator + 持久化员工 Runtime + 插件 / 模型 / 通讯能力层。
export { inject, apply, type OrgPanelHost, type OrgPanelHostFields } from './host-v3'
export type { OrgPanelCore } from './host-v2'

// Work Orchestrator：root 只做不可见调度，Web / 飞书 / QQ / 微信统一进入同一套动态工作组。
export { COMPANY_WORK_TOOL, MAX_WORKGROUP_SIZE, planWorkgroup, requestedPeers, registerWorkOrchestrator } from './collaboration/work-orchestrator'
export type { WorkAttachment, WorkOrchestrator, WorkPlan, WorkPolicy, WorkRequest, WorkResult, WorkRoute, WorkTurn } from './collaboration/work-orchestrator'
export { WorkSessionStore, WORK_SESSION_LIMITS, WORK_SESSION_VERSION } from './collaboration/work-session-store'
export type { WorkSession, WorkSessionMessage, WorkSessionOrigin, WorkSessionParticipant, WorkSessionStatus, WorkSessionTurn } from './collaboration/work-session-store'

// /org-panel RPC 频道。
export { ORG_PANEL_CHANNEL, CHANNEL_REQUIRES, registerOrgPanelChannel, createDispatcher, type EndpointMap, type OrgPanelChannelHandle } from './host/org-panel-rpc'
export { readEndpoints, type OrgPanelDeps, type StorageFileEntry } from './host/org-panel-read'
export { writeEndpoints } from './host/org-panel-write'

export { readCtxService, firstCtxService } from './runtime/ctx-service'

// 持久化员工档案。
export { EvolutionStore } from './persistence/evolution-store'
export { CompanyStore } from './persistence/company-store'
export { migrateStoreFile, detectStoreVersion, refreshDerivedStatistics, STORE_LIMITS } from './persistence/migrations'
export { computeSkillLevel, computeRecentUsageBonus, evolutionLevel, skillLevelFrom, isSecretRef } from './persistence/types'
export type {
  CompanySnapshot, EmployeeSnapshot, EmployeeEvolutionV2, EmployeeMemory, EmployeeStatistics,
  LearnedSkill, ModelBinding, ModelProviderConfig, PluginBinding, SkillEvidence, TaskHistory,
} from './persistence/types'

// 运行时事件总线。
export { CompanyEventBus, companyEventBus, SESSION_CHANNEL } from './runtime/event-bus'
export { reduceCompanyRuntime, emptyCompanyRuntime } from './runtime/company-events'
export type { CompanyEvent, CompanyRuntime, EmployeeRuntimeState } from './runtime/company-events'

// 能力层入口。
export { registerModelGateway, ModelGateway } from './models/gateway'
export { registerPluginRuntime, PluginRuntime } from './capabilities/plugin-runtime'
export { registerCommunication, CommunicationManager } from './integrations/im/manager'

// 安全边界原语。
export { assertCommandTargetsPackage, assertPackageToken, normalizePackageToken } from './capabilities/plugin-runtime'
export { createWriteGate, isWriteToolName } from './integrations/im/types'
export type { WriteGate } from './integrations/im/types'
