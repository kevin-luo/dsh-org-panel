// 「赛博公司」/org-panel 频道的**只读**端点。
//
// 这一组端点回答的是老板打开「公司设置」时的六个问题：
//   公司现在什么样 / 有谁在申请装插件 / 插件还活着吗 / 飞书接没接通 / 安全策略是什么 /
//   模型配了没有 / **我的数据到底在哪、有多大、什么时候写的**。
//
// 两条硬规矩：
//   1. 全部只读，无副作用。想跑一次真实健康检查请走 org-panel-write.ts 的 plugins/healthCheck
//      —— 「打开设置页顺手改一遍插件状态」是老板没同意过的写操作。
//   2. 拿不到就如实缺席：available:false / exists:false / undefined。
//      绝不用 0、'已加密'、'always' 这类「看起来最安全 / 最好看」的默认值填充。
import { readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { OrgPanelCore } from '../host-v2'
import type { PluginRuntimeHandle } from '../capabilities/plugin-runtime'
import type { CommunicationManager } from '../integrations/im/manager'
import type { ModelGateway } from '../models/gateway'
import { MODEL_CAPABILITIES, type ModelCapability } from '../models/types'
import { companyEventBus, type CompanyEventBus } from '../runtime/event-bus'
import type { EndpointMap } from './org-panel-rpc'

export type OrgPanelDeps = {
  core: OrgPanelCore
  gateway?: ModelGateway
  plugins?: PluginRuntimeHandle | null
  communication?: CommunicationManager
  /** cordis 里那份原始配置；安全页的审批策略只能从它推，不许现编。 */
  config?: any
  /** host 侧事件总线。默认就是本 bundle 的全局单例，注入只是为了让测试能拿到干净的一条。 */
  events?: CompanyEventBus
}

/** events/since 单次最多回多少条。再多也不会让老板看得更清楚，只会把一次应答撑大。 */
const EVENT_PAGE_MAX = 300

/** 一个数据文件的真实台账行。文件不存在时 exists:false，**不填 0 字节**。 */
export type StorageFileEntry = {
  key: string
  label: string
  path: string
  exists: boolean
  bytes?: number
  updatedAt?: number
  /** 读取失败（权限等）时如实带出原因，UI 不会把它显示成「正常」。 */
  error?: string
}

async function fileEntry(key: string, label: string, path?: string): Promise<StorageFileEntry | null> {
  if (!path) return null
  try {
    const info = await stat(path)
    return { key, label, path, exists: true, bytes: info.size, updatedAt: Math.round(info.mtimeMs) }
  } catch (error: any) {
    // ENOENT = 真的还没写过这个文件，这是一条有用的事实；其他错误如实带出。
    if (error?.code === 'ENOENT') return { key, label, path, exists: false }
    return { key, label, path, exists: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 附件目录：只统计文件数量与总字节，不读内容、不列文件名。 */
async function attachmentUsage(dir: string): Promise<{ dir: string; count?: number; bytes?: number }> {
  try {
    const names = await readdir(dir)
    let bytes = 0
    let count = 0
    for (const name of names) {
      try {
        const info = await stat(join(dir, name))
        if (!info.isFile()) continue
        count += 1
        bytes += info.size
      } catch { /* 单个文件读不到就跳过，不影响其他统计 */ }
    }
    return { dir, count, bytes }
  } catch {
    // 目录还没建 = 一次附件都没收过。这也是事实，如实说而不是报错。
    return { dir }
  }
}

/**
 * 插件审批策略：只能从 cordis 里那份真实配置推。
 * mode 的判定顺序与 PluginRuntime 的实际行为一致：
 *   executor === 'none' → 只登记不安装；有 preapproved 清单 → 配置内预批准；否则每次都要人类审批。
 */
function approvalPolicy(config: any): { mode: 'always' | 'preapproved' | 'none'; preapproved: string[]; executor: 'auto' | 'tool' | 'none' } {
  const install = config?.pluginInstall || {}
  const executor: 'auto' | 'tool' | 'none' = install.executor === 'tool' || install.executor === 'none' ? install.executor : 'auto'
  const preapproved = Array.isArray(install.preapproved) ? install.preapproved.map(String).filter(Boolean) : []
  const mode = executor === 'none' ? 'none' : preapproved.length ? 'preapproved' : 'always'
  return { mode, preapproved, executor }
}

export function readEndpoints(deps: OrgPanelDeps): EndpointMap {
  const { core, gateway, plugins, communication, config } = deps
  const events = deps.events || companyEventBus

  const companySnapshot = async (payload: any) => core.snapshot({
    taskLimit: Number(payload?.taskLimit) || undefined,
    memoryLimit: Number(payload?.memoryLimit) || undefined,
  })

  const pluginApprovals = async (payload: any) => {
    if (!plugins) return { available: false, requests: [], pendingCount: 0, reason: '插件运行时没有挂载（缺 tools 服务），本次运行没有审批台账。' }
    const requests = await plugins.requests({
      employeeId: payload?.employeeId ? String(payload.employeeId) : undefined,
      status: payload?.status ? String(payload.status) as any : undefined,
    })
    const pending = payload?.status ? await plugins.requests({ status: 'pending' }) : requests.filter((row) => row.status === 'pending')
    return { available: true, requests, pendingCount: pending.length, approvalsFile: plugins.approvalsFile }
  }

  const pluginHealth = async () => {
    if (!plugins) return { available: false, reason: '插件运行时没有挂载（缺 tools 服务）。' }
    const report = plugins.lastHealthReport()
    // 从没跑过检查就只报当前 Tool Registry 规模，checkedAt / changed 保持缺席 —— UI 会显示「未检查」。
    if (!report) {
      const catalog = await plugins.catalog(true)
      return { available: true, catalogSize: catalog.length, checkedAt: undefined, changed: undefined, employees: [] }
    }
    return { available: true, catalogSize: report.catalogSize, checkedAt: report.checkedAt, changed: report.changed, employees: report.employees }
  }

  const communicationSummary = async (payload: any) => {
    if (!communication) return { available: false, configured: false, adapters: [], channelBindings: [], reason: '通讯层未挂载：cordis 配置里没有 communication 段，或该段配置无效（详见启动日志）。' }
    const summary = await communication.summary()
    return {
      available: true,
      ...summary,
      timeline: communication.timeline(Math.min(Math.max(Number(payload?.timeline) || 20, 1), 50)),
      employees: core.roster.map((item) => ({ id: item.id, name: item.name })),
    }
  }

  const securityPolicy = async () => {
    const policy = approvalPolicy(config)
    const pending = plugins ? (await plugins.requests({ status: 'pending' })).length : undefined
    const summary = communication ? await communication.summary() : null
    const enabled = summary?.adapters?.filter((item) => item.enabled) || []
    const external = summary
      ? {
        channels: summary.adapters.length,
        connected: summary.adapters.filter((item) => item.state === 'connected').length,
        defaultPermission: enabled[0]?.access?.defaultPermissionMode || summary.adapters[0]?.access?.defaultPermissionMode,
        allowUnknownUsers: summary.adapters.some((item) => item.access?.allowUnknownUsers),
      }
      : undefined
    return {
      // pendingCount 只有插件运行时真的挂上了才是数字；没挂上就缺席，UI 显示「未知」。
      pluginApproval: { mode: policy.mode, preapproved: policy.preapproved, executor: policy.executor, pendingCount: pending },
      external,
      secretStorage: gateway ? await gateway.secretStorage() : null,
      maxEmployeeHops: summary?.maxEmployeeHops,
      // 一个渠道都没有时 summary.maxEmployeeHops 只是缺省回落值，必须如实标注。
      hopsFallback: summary ? summary.adapters.length === 0 : undefined,
    }
  }

  const modelsProviders = async () => {
    if (!gateway) return { available: false, providers: [], employees: [], capabilities: {}, reason: 'Model Gateway 未挂载（详见启动日志）。' }
    const providers = await gateway.providerSummaries()
    const capabilities: Partial<Record<ModelCapability, { configured: boolean; providerIds: string[] }>> = {}
    for (const capability of MODEL_CAPABILITIES) {
      const status = await gateway.capabilityStatus(capability)
      capabilities[capability] = { configured: status.configured, providerIds: status.providers.map((item) => item.providerId) }
    }
    const employees = []
    for (const identity of core.roster) {
      employees.push({
        id: identity.id, name: identity.name, role: identity.role,
        bindings: await core.store.modelBindings(identity.id),
      })
    }
    return { available: true, providers, employees, capabilities, secretStorage: await gateway.secretStorage() }
  }

  const storageInventory = async () => {
    const memoryFile = core.store.filePath
    const companyFile = core.company.filePath
    const dataDir = dirname(memoryFile)
    const rows = await Promise.all([
      fileEntry('evolution', '员工档案 / 记忆 / 技能 / 履历', memoryFile),
      fileEntry('company', '公司档案 / 模型供应商', companyFile),
      fileEntry('approvals', '插件安装审批台账', plugins?.approvalsFile),
      fileEntry('secrets', '本地密钥库（只显示路径，不显示内容）', config?.secretsFile || join(dataDir, 'secrets.json')),
    ])
    const files = rows.filter((row): row is StorageFileEntry => !!row)
    const snapshot: any = await core.snapshot({ taskLimit: 1, memoryLimit: 1 })
    const totals = snapshot?.totals || {}
    return {
      dataDir,
      files,
      secretsFile: files.find((row) => row.key === 'secrets')?.path,
      attachments: await attachmentUsage(config?.attachmentDir ? String(config.attachmentDir) : join(dataDir, 'attachments')),
      // 摊平一份给存储页直接用（StorageSettingsData 的字段名），totals 原样保留给别处对账。
      employees: totals.employees, memories: totals.memories, tasks: totals.tasks, skills: totals.skills,
      totals,
      generatedAt: snapshot?.generatedAt,
    }
  }

  /**
   * host→client 事件推送的唯一出口。
   *
   * 为什么需要它：companyEventBus 在 host bundle 与 browser bundle 里是**两个独立单例**
   * （tsdown 两个 entry），host 侧 publish 的飞书来信 / 插件安装 / 识图事件永远飘不到浏览器。
   * 前台的 🔔、机房的装插件、多媒体工作台的识图这三套视觉语言在真实链路里因此全是死代码。
   *
   * 契约是 unary RPC，没有 server push，所以只能由 client 拉。**必须带游标只取增量**：
   * 每次全量既浪费带宽，又会让前端反复收到同一批事件（虽然总线会去重，但那是在拿浪费换正确）。
   *
   * 只读：拉一次事件不会改变 host 上的任何状态，也不会把事件从 feed 里删掉 ——
   * 多个标签页各拉各的，谁都不会吃掉别人的那一份。
   */
  const eventsSince = async (payload: any) => {
    const cursor = Number(payload?.cursor)
    const limit = Number(payload?.limit)
    const page = events.since(
      Number.isFinite(cursor) && cursor > 0 ? cursor : 0,
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, EVENT_PAGE_MAX) : EVENT_PAGE_MAX,
    )
    return { available: true, ...page }
  }

  const map: EndpointMap = {
    'events/since': eventsSince,
    'company/snapshot': companySnapshot,
    'plugins/approvals': pluginApprovals,
    'plugins/health': pluginHealth,
    'communication/summary': communicationSummary,
    'security/policy': securityPolicy,
    'models/providers': modelsProviders,
    'storage/inventory': storageInventory,
  }
  // 兼容别名：接线简报里用的是单数 / 短名。同一个实现，两个名字都能打通，避免前后端各写一半。
  map['plugin/approvals'] = pluginApprovals
  map['plugin/health'] = pluginHealth
  map['model/list'] = modelsProviders
  map['comm/status'] = communicationSummary
  return map
}
