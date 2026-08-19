// 「赛博公司」/org-panel 频道的**写**端点。
//
// ---------------------------------------------------------------------------
// 隔离原理（这段是本文件存在的全部理由，不要删）
// ---------------------------------------------------------------------------
// 这里的每一个端点都只能被**人类在浏览器里的一次点击**触发，原因不是我们在代码里加了检查，
// 而是传输层本身把两类调用者分开了：
//
//   · 模型（LLM）能碰到的入口只有 Tool Registry。它调工具，工具执行在 agent 上下文里，
//     那里既没有 `ctx.connection`，也没有任何办法向 host 的 HTTP 频道发起请求。
//   · 老板能碰到的入口是浏览器里的设置中心。它走 ClientConnectionRpc.call('/org-panel', …)，
//     经 DSH 的 loopback 信任闸门到达这里。
//
// 所以「有了 RPC 就等于放宽了审批」是反的：在此之前，PluginRuntime.approve() 唯一可能的
// 人类入口是「老板自己去改 cordis 配置写 preapproved」或宿主原生弹窗；现在它多了一条
// 真实、且模型走不通的路。审批语义一个字都没动 ——
// approve() 仍然只由 UI / CLI / 配置预批准调用，`decision.channel` 如实记成 'ui'。
//
// 反向证明写在 tests/org-panel-rpc.test.mjs 的 A2：遍历 host 注册的全部工具，
// 断言没有任何一个工具能把一条 pending 变成 approved。改这里之前先让那条用例继续绿。
//
// 另外两条规矩：
//   · 本轮只做「决定」不做「申请」：plugins/search 与 requestInstall 不在这里 ——
//     「员工申请、老板批准」的语义边界要保持干净。
//   · 密钥永远只以 env: / secret: 引用形式写入。明文密钥由 CompanyStore.assertNoRawSecret 拒绝，
//     这里不做任何绕过。
import type { PluginRuntimeHandle } from '../capabilities/plugin-runtime'
import { toModelCapability, type ModelBindingStatus, type ModelProviderConfig } from '../models/types'
import type { EndpointMap } from './org-panel-rpc'
import type { OrgPanelDeps } from './org-panel-read'

function requireText(payload: any, field: string): string {
  const value = payload?.[field]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`缺少必填参数 ${field}`)
  return value.trim()
}

/**
 * 操作者。面板可以带上真实操作者名；带不上时记 'boss'（与 PluginRuntime.approve 的既有默认一致）。
 * 绝不编造一个「系统」「自动」之类看起来像流程、其实掩盖了「谁签的字」的名字。
 */
function actorOf(payload: any): { by: string; note?: string } {
  const by = typeof payload?.by === 'string' && payload.by.trim() ? payload.by.trim() : 'boss'
  const note = typeof payload?.note === 'string' && payload.note.trim() ? payload.note.trim() : undefined
  return { by, note }
}

function requirePlugins(plugins?: PluginRuntimeHandle | null): PluginRuntimeHandle {
  if (!plugins) throw new Error('插件运行时没有挂载（缺 tools 服务），本次运行无法审批。')
  return plugins
}

export function writeEndpoints(deps: OrgPanelDeps): EndpointMap {
  const { core, gateway, plugins } = deps

  // -------------------------------------------------------------------------
  // 插件审批闭环：批准 / 拒绝 / 重新验证 / 健康检查
  // -------------------------------------------------------------------------
  const approve = async (payload: any) => {
    const runtime = requirePlugins(plugins)
    const actor = actorOf(payload)
    // channel 固定为 'ui'：这一下确实是人在设置中心点的，台账要能查出来是谁、从哪点的。
    const request = await runtime.approve(requireText(payload, 'requestId'), { by: actor.by, note: actor.note, channel: 'ui' })
    return { request }
  }

  const reject = async (payload: any) => {
    const runtime = requirePlugins(plugins)
    const actor = actorOf(payload)
    const request = await runtime.reject(requireText(payload, 'requestId'), { by: actor.by, note: actor.note, channel: 'ui' })
    return { request }
  }

  const verify = async (payload: any) => {
    const runtime = requirePlugins(plugins)
    const request = payload?.requestId
      ? await runtime.verifyRequest(String(payload.requestId), undefined, payload?.smokeTest)
      : await runtime.verifyBinding(requireText(payload, 'employeeId'), requireText(payload, 'pluginId'), payload?.smokeTest)
    return { request }
  }

  const healthCheck = async (payload: any) => {
    const runtime = requirePlugins(plugins)
    const ids = Array.isArray(payload?.employeeIds) ? payload.employeeIds.map(String).filter(Boolean) : undefined
    return runtime.healthCheck(ids && ids.length ? ids : undefined)
  }

  // -------------------------------------------------------------------------
  // 模型供应商：CRUD / 默认顺序 / 测连接 / 绑定到员工
  // 写的是同一份 company.json / evolution.json（复用 core 的实例，不新起写入者）。
  // -------------------------------------------------------------------------
  // 写的是 core.company —— host-v3 传给 Model Gateway 的同一个 CompanyStore 实例。
  // 绝不 new 第二个：同一份 company.json 只能有一个写入者。
  const upsert = async (payload: any) => {
    const input = payload?.provider && typeof payload.provider === 'object' ? payload.provider : payload
    if (!input || typeof input !== 'object') throw new Error('缺少 provider 配置对象')
    // sanitizeModelProvider / assertNoRawSecret 在 CompanyStore 里，明文密钥会被直接拒绝。
    const provider = await core.company.upsertModelProvider(input as ModelProviderConfig)
    return { provider }
  }

  const remove = async (payload: any) => {
    const providerId = requireText(payload, 'providerId')
    const removed = await core.company.removeModelProvider(providerId)
    if (!removed) throw new Error(`未知的模型供应商：${providerId}`)
    // 员工的 ModelBinding 故意不在这里级联删除：绑定会在 Router 里变成 missing，
    // 员工档案仍然能解释“以前绑定过什么、为什么现在不可用”。
    return { removed: true, providerId }
  }

  const setDefault = async (payload: any) => {
    const providerId = requireText(payload, 'providerId')
    const list = await core.company.modelProviders()
    const current = list.find((item) => item.id === providerId)
    if (!current) throw new Error(`未知的模型供应商：${providerId}`)
    if (!current.enabled) throw new Error(`供应商 ${providerId} 当前已禁用，不能设为默认；请先启用。`)
    const provider = await core.company.setDefaultModelProvider(providerId)
    return { provider }
  }

  const setEnabled = async (payload: any) => {
    const providerId = requireText(payload, 'providerId')
    const list = await core.company.modelProviders()
    const current = list.find((item) => item.id === providerId)
    if (!current) throw new Error(`未知的模型供应商：${providerId}`)
    const provider = await core.company.upsertModelProvider({ ...current, enabled: !!payload?.enabled })
    return { provider }
  }

  const test = async (payload: any, signal?: AbortSignal) => {
    if (!gateway) throw new Error('Model Gateway 未挂载，无法测试连接。')
    // live 默认 true：老板点「测试连接」要的就是真的发一次请求。
    // 结果里的 checked 字段会如实区分 live-call 与 config-only，UI 不许把后者说成「已连通」。
    return gateway.testProvider(requireText(payload, 'providerId'), { signal, live: payload?.live !== false })
  }

  const bind = async (payload: any) => {
    const employeeId = requireText(payload, 'employeeId')
    const capability = toModelCapability(payload?.capability)
    if (!capability) throw new Error(`未知的模型能力：${String(payload?.capability)}`)
    if (!core.roster.some((item) => item.id === employeeId)) throw new Error(`未知员工 id：${employeeId}`)
    const providerId = typeof payload?.providerId === 'string' ? payload.providerId.trim() : ''
    if (!providerId) {
      const removed = await core.store.unbindModel(employeeId, capability)
      return { unbound: removed, binding: null }
    }
    const providers = await core.company.modelProviders()
    if (!providers.some((item) => item.id === providerId)) throw new Error(`未知的模型供应商：${providerId}`)
    const binding = await core.store.bindModel(employeeId, {
      capability, providerId,
      priority: Number(payload?.priority) > 0 ? Number(payload.priority) : undefined,
      // status 不接受调用方随手给的 'available'：绑定是否真的可用要靠 models/test 验证过才算。
      status: payload?.status === 'disabled' ? ('disabled' as ModelBindingStatus) : undefined,
    })
    return { binding }
  }

  const map: EndpointMap = {
    'plugins/approve': approve,
    'plugins/reject': reject,
    'plugins/verify': verify,
    'plugins/healthCheck': healthCheck,
    'models/upsert': upsert,
    'models/remove': remove,
    'models/setDefault': setDefault,
    'models/setEnabled': setEnabled,
    'models/test': test,
    'models/bind': bind,
  }
  // 兼容别名（同 org-panel-read.ts）。
  map['plugin/approve'] = approve
  map['plugin/reject'] = reject
  map['plugin/verify'] = verify
  map['model/upsert'] = upsert
  map['model/remove'] = remove
  map['model/setDefault'] = setDefault
  map['model/test'] = test
  map['model/bind'] = bind
  return map
}
