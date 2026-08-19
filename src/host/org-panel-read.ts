// 「赛博公司」/org-panel 频道的只读端点。
// 全部只读、无副作用；拿不到就如实缺席，不用漂亮默认值伪造状态。
import { readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { OrgPanelCore } from '../host-v2'
import type { WorkOrchestrator } from '../collaboration/work-orchestrator'
import type { PluginRuntimeHandle } from '../capabilities/plugin-runtime'
import type { CommunicationManager } from '../integrations/im/manager'
import type { ModelGateway } from '../models/gateway'
import type { DshProviderRoute } from '../models/employee-agent-route'
import { MODEL_CAPABILITIES, type ModelCapability } from '../models/types'
import { companyEventBus, type CompanyEventBus } from '../runtime/event-bus'
import type { EndpointMap } from './org-panel-rpc'

export type OrgPanelDeps = {
  core: OrgPanelCore
  orchestrator?: WorkOrchestrator
  gateway?: ModelGateway
  plugins?: PluginRuntimeHandle | null
  communication?: CommunicationManager
  config?: any
  events?: CompanyEventBus
  dshProviders?: DshProviderRoute[]
}

const EVENT_PAGE_MAX = 300

export type StorageFileEntry = {
  key: string
  label: string
  path: string
  exists: boolean
  bytes?: number
  updatedAt?: number
  error?: string
}

async function fileEntry(key: string, label: string, path?: string): Promise<StorageFileEntry | null> {
  if (!path) return null
  try {
    const info = await stat(path)
    return { key, label, path, exists: true, bytes: info.size, updatedAt: Math.round(info.mtimeMs) }
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { key, label, path, exists: false }
    return { key, label, path, exists: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function attachmentUsage(dir: string): Promise<{ dir: string; count?: number; bytes?: number }> {
  try {
    const names = await readdir(dir)
    let bytes = 0, count = 0
    for (const name of names) {
      try { const info = await stat(join(dir, name)); if (!info.isFile()) continue; count += 1; bytes += info.size } catch {}
    }
    return { dir, count, bytes }
  } catch { return { dir } }
}

function approvalPolicy(config: any): { mode: 'always' | 'preapproved' | 'none'; preapproved: string[]; executor: 'auto' | 'tool' | 'none' } {
  const install = config?.pluginInstall || {}
  const executor: 'auto' | 'tool' | 'none' = install.executor === 'tool' || install.executor === 'none' ? install.executor : 'auto'
  const preapproved = Array.isArray(install.preapproved) ? install.preapproved.map(String).filter(Boolean) : []
  const mode = executor === 'none' ? 'none' : preapproved.length ? 'preapproved' : 'always'
  return { mode, preapproved, executor }
}

export function readEndpoints(deps: OrgPanelDeps): EndpointMap {
  const { core, orchestrator, gateway, plugins, communication, config } = deps
  const events = deps.events || companyEventBus
  const companySnapshot = async (payload: any) => core.snapshot({ taskLimit: Number(payload?.taskLimit) || undefined, memoryLimit: Number(payload?.memoryLimit) || undefined })

  const pluginApprovals = async (payload: any) => {
    if (!plugins) return { available: false, requests: [], pendingCount: 0, reason: '插件运行时没有挂载（缺 tools 服务），本次运行没有审批台账。' }
    const requests = await plugins.requests({ employeeId: payload?.employeeId ? String(payload.employeeId) : undefined, status: payload?.status ? String(payload.status) as any : undefined })
    const pending = payload?.status ? await plugins.requests({ status: 'pending' }) : requests.filter((row) => row.status === 'pending')
    return { available: true, requests, pendingCount: pending.length, approvalsFile: plugins.approvalsFile }
  }

  const pluginHealth = async () => {
    if (!plugins) return { available: false, reason: '插件运行时没有挂载（缺 tools 服务）。' }
    const report = plugins.lastHealthReport()
    if (!report) { const catalog = await plugins.catalog(true); return { available: true, catalogSize: catalog.length, checkedAt: undefined, changed: undefined, employees: [] } }
    return { available: true, catalogSize: report.catalogSize, checkedAt: report.checkedAt, changed: report.changed, employees: report.employees }
  }

  const communicationSummary = async (payload: any) => {
    if (!communication) return { available: false, configured: false, adapters: [], channelBindings: [], reason: '通讯层未挂载：cordis 配置里没有 communication 段，或该段配置无效（详见启动日志）。' }
    const summary = await communication.summary()
    return { available: true, ...summary, timeline: communication.timeline(Math.min(Math.max(Number(payload?.timeline) || 20, 1), 50)), employees: core.roster.map((item) => ({ id: item.id, name: item.name })) }
  }

  const workSessions = async (payload: any) => {
    if (!orchestrator) return { available: false, sessions: [], reason: 'Work Orchestrator 未挂载，本次运行没有可读取的工作组。' }
    const rows = await orchestrator.sessions.recent(Math.min(Math.max(Number(payload?.limit) || 20, 1), 50))
    return { available: true, sessions: rows.map((session) => ({ id: session.id, key: session.key, goal: session.goal, currentTask: session.currentTask, status: session.status, origin: session.origin, participants: session.participants, messageCount: session.messages.length, turnCount: session.turns.length, lastTurn: session.turns.length ? session.turns[session.turns.length - 1] : undefined, createdAt: session.createdAt, updatedAt: session.updatedAt })) }
  }

  const workSession = async (payload: any) => {
    if (!orchestrator) return { available: false, reason: 'Work Orchestrator 未挂载。' }
    const id = String(payload?.id || '').trim(), key = String(payload?.key || '').trim()
    if (!id && !key) return { available: false, reason: 'work/session 需要 id 或 key。' }
    const session = id ? await orchestrator.sessions.get(id) : await orchestrator.sessions.getByKey(key)
    return session ? { available: true, session } : { available: false, reason: '没有找到这个工作组。' }
  }

  const securityPolicy = async () => {
    const policy = approvalPolicy(config)
    const pending = plugins ? (await plugins.requests({ status: 'pending' })).length : undefined
    const summary = communication ? await communication.summary() : null
    const enabled = summary?.adapters?.filter((item) => item.enabled) || []
    const external = summary ? { channels: summary.adapters.length, connected: summary.adapters.filter((item) => item.state === 'connected').length, defaultPermission: enabled[0]?.access?.defaultPermissionMode || summary.adapters[0]?.access?.defaultPermissionMode, allowUnknownUsers: summary.adapters.some((item) => item.access?.allowUnknownUsers) } : undefined
    return { pluginApproval: { mode: policy.mode, preapproved: policy.preapproved, executor: policy.executor, pendingCount: pending }, external, secretStorage: gateway ? await gateway.secretStorage() : null, maxWorkgroupSize: summary?.maxWorkgroupSize }
  }

  const modelsProviders = async () => {
    if (!gateway) return { available: false, providers: [], employees: [], capabilities: {}, dshProviders: deps.dshProviders || [], reason: 'Model Gateway 未挂载（详见启动日志）。' }
    // Gateway 摘要负责协议/密钥/连通性；CompanyStore 摘要负责持久的 dshProvider 映射。两者按 id 合并。
    const [runtimeProviders, persistedProviders] = await Promise.all([gateway.providerSummaries(), core.company.modelProviderSummaries()])
    const runtimeById = new Map(runtimeProviders.map((item) => [item.id, item]))
    const dshRoutes = deps.dshProviders || []
    const dshSet = new Set(dshRoutes.map((item) => item.id))
    const providers = persistedProviders.map((persisted) => {
      const runtime = runtimeById.get(persisted.id)
      return {
        ...(runtime || {}),
        ...persisted,
        dshRouteAvailable: persisted.type === 'text' && persisted.dshProvider ? dshSet.has(persisted.dshProvider) : undefined,
      }
    })
    const capabilities: Partial<Record<ModelCapability, { configured: boolean; providerIds: string[] }>> = {}
    for (const capability of MODEL_CAPABILITIES) {
      const status = await gateway.capabilityStatus(capability)
      capabilities[capability] = { configured: status.configured, providerIds: status.providers.map((item) => item.providerId) }
    }
    const employees = []
    for (const identity of core.roster) employees.push({ id: identity.id, name: identity.name, role: identity.role, bindings: await core.store.modelBindings(identity.id) })
    return { available: true, providers, employees, capabilities, dshProviders: dshRoutes, secretStorage: await gateway.secretStorage() }
  }

  const storageInventory = async () => {
    const memoryFile = core.store.filePath, companyFile = core.company.filePath, dataDir = dirname(memoryFile)
    const rows = await Promise.all([
      fileEntry('evolution', '员工档案 / 记忆 / 技能 / 履历', memoryFile),
      fileEntry('work-sessions', '持久工作组 / 跨渠道协作上下文', orchestrator?.sessions.filePath),
      fileEntry('company', '公司档案 / 模型供应商', companyFile),
      fileEntry('approvals', '插件安装审批台账', plugins?.approvalsFile),
      fileEntry('secrets', '本地密钥库（只显示路径，不显示内容）', config?.secretsFile || join(dataDir, 'secrets.json')),
    ])
    const files = rows.filter((row): row is StorageFileEntry => !!row)
    const snapshot: any = await core.snapshot({ taskLimit: 1, memoryLimit: 1 }), totals = snapshot?.totals || {}
    return { dataDir, files, secretsFile: files.find((row) => row.key === 'secrets')?.path, attachments: await attachmentUsage(config?.attachmentDir ? String(config.attachmentDir) : join(dataDir, 'attachments')), employees: totals.employees, memories: totals.memories, tasks: totals.tasks, skills: totals.skills, totals, generatedAt: snapshot?.generatedAt }
  }

  const eventsSince = async (payload: any) => {
    const cursor = Number(payload?.cursor), limit = Number(payload?.limit)
    const page = events.since(Number.isFinite(cursor) && cursor > 0 ? cursor : 0, Number.isFinite(limit) && limit > 0 ? Math.min(limit, EVENT_PAGE_MAX) : EVENT_PAGE_MAX)
    return { available: true, ...page }
  }

  const map: EndpointMap = {
    'events/since': eventsSince, 'company/snapshot': companySnapshot, 'work/sessions': workSessions, 'work/session': workSession,
    'plugins/approvals': pluginApprovals, 'plugins/health': pluginHealth, 'communication/summary': communicationSummary,
    'security/policy': securityPolicy, 'models/providers': modelsProviders, 'storage/inventory': storageInventory,
  }
  map['plugin/approvals'] = pluginApprovals; map['plugin/health'] = pluginHealth; map['model/list'] = modelsProviders; map['comm/status'] = communicationSummary
  return map
}
