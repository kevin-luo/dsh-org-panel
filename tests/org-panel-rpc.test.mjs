// /org-panel RPC 频道（本轮 T2 / T3 的 host 侧）。
//
// 这条频道要回答的是老板打开「公司设置」时的第一个问题：我的数据到底在不在。
// 在此之前面板只能从会话里的 tool-result 反推，空 Session 下六个页签全是 0 / 未知。
//
// 安全前提（A2 用例专门证明它）：**LLM 没有 RPC**。模型能碰到的只有 Tool Registry，
// 而 /org-panel 是 host 侧 cordis 服务上的 HTTP 频道，工具执行上下文里够不着。
// 所以这条通道不是审批的后门，它反而是第一次在传输层把「人类点击」和「模型调用」分开。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { dshWebStack, realCordisCtx, scratch, settleFiber } from './_helpers.mjs'

const { apply, inject, CHANNEL_REQUIRES, readCtxService } = await import('../lib/index.js')

/**
 * 在真 cordis root 上装一次插件，传输层按真实 DSH 形态铺（见 _helpers 的 dshWebStack）。
 * options.webServer / options.connection / options.connectionInject 决定这次部署形态。
 */
async function boot(name, { webServer = true, connection = true, connectionInject = true, config = {} } = {}) {
  const dir = await scratch(name)
  const { root, logs, registered } = realCordisCtx()
  const web = await dshWebStack(root, { webServer, connection, connectionInject })

  let host
  let pluginCtx
  const load = () => {
    let captured
    const fiber = root.plugin({
      name: 'dsh-org-panel',
      inject,
      apply(ctx, cfg) { pluginCtx = ctx; captured = apply(ctx, cfg); return captured },
    }, {
      memoryFile: join(dir, 'evolution.json'),
      companyFile: join(dir, 'company.json'),
      approvalsFile: join(dir, 'plugin-approvals.json'),
      healthCheckOnStart: false,
      ...config,
    })
    return settleFiber(fiber).then(() => { host = captured; return fiber })
  }
  const fiber = await load()
  return { dir, root, fiber, get host() { return host }, get pluginCtx() { return pluginCtx }, logs, registered, web, load }
}

/** 直接打频道的 handler：这就是浏览器发过来的那一次调用真正会走到的函数。 */
async function call(ctx, endpoint, payload = {}) {
  const route = ctx.web.routes[0]
  assert.ok(route, '频道没有注册，无法调用')
  return route.handler(endpoint, payload, new AbortController().signal)
}

// ---------------------------------------------------------------------------
// R0（本轮 405 事故的回归用例）：频道的 inject 只能写宿主真实提供得出来的服务名
//
// 事故经过：这里曾经写的是 ctx.inject(['httpServer', 'connection'], …)。
// 而真实 DSH 的 web 服务叫 **webServer**（dsh-host-webserver 的 super(ctx,'webServer')），
// 只有一份早已过期的 0.0.1-rc.1 .d.ts 里写着 httpServer。cordis 的 inject 全是必需依赖：
// 多写一个宿主没有的名字，子 fiber 就永远停在 PENDING、回调一次都不执行、**没有任何人报错**，
// 表现只有浏览器控制台里的 16 条 405。
// 当时的夹具跟着同一份过期 typings 也用了 httpServer，于是两边一起错、单测一路绿。
// 这条用例把「名字」本身变成断言对象。
// ---------------------------------------------------------------------------

test('R0 CHANNEL_REQUIRES 里的每个名字都必须是真实宿主提供得出来的服务', async () => {
  const ctx = await boot('rpc-requires')

  assert.deepEqual([...ctx.host.channel.requires], [...CHANNEL_REQUIRES], 'handle 暴露的依赖必须就是代码里那一份，不许两处各写一遍')
  for (const name of CHANNEL_REQUIRES) {
    assert.notEqual(
      readCtxService(ctx.root, name), undefined,
      `宿主里没有名为 ${name} 的服务：子 fiber 会永远停在 PENDING，而且不会有任何人报错`,
    )
  }

  // 反面：DSH 的 web 服务名是 webServer。把 httpServer 写进 inject 就是这次 405 的根因。
  assert.notEqual(readCtxService(ctx.root, 'webServer'), undefined, '夹具必须按真实 DSH 提供 webServer')
  assert.equal(readCtxService(ctx.root, 'httpServer'), undefined, 'httpServer 在任何一版真实 DSH 运行时里都不存在')
  assert.equal(CHANNEL_REQUIRES.includes('httpServer'), false)

  // 我们自己这个 fiber 读不到 webServer —— 而且**本来就不该读得到**：
  // connection.rpc.handle() 是靠 cordis 的 shadow 机制回自己的 fiber 取的。
  assert.throws(() => ctx.pluginCtx.webServer, /without inject/)
  assert.equal(ctx.host.channel.registered(), true, '读不到 webServer 完全不妨碍频道挂上')
})

// ---------------------------------------------------------------------------
// R1：传输层不全的部署形态必须安静降级
// ---------------------------------------------------------------------------

test('R1 connection 在但它读不到 webServer 时不注册、不抛错，host 照常完整', async () => {
  // connectionInject:false = 残缺宿主：connection 服务起来了，但 handle() 里的
  // owner.webServer 读不到，effect 当场抛。这一抛必须被我们接住，不能拖垮插件。
  const ctx = await boot('rpc-no-web', { webServer: false, connectionInject: false })
  assert.equal(ctx.fiber.state, 2, 'fiber 必须仍然活跃：没有 RPC 只是少一条读数据的路，不是装配失败')
  assert.ok(ctx.host.core, '员工核心必须照常可用')
  assert.ok(ctx.host.gateway)
  assert.equal(ctx.host.channel.registered(), false, '路由没挂上就不许自称已注册')
  assert.equal(ctx.web.routes.length, 0)
  assert.match(ctx.host.channel.pendingReason(), /without inject|webServer/, '必须说出真实原因，不许回「未知错误」')
  const declared = ctx.logs.filter(([, text]) => text.includes('已声明 /org-panel 频道'))
  assert.equal(declared.length, 1, '必须留一行日志说明为什么没有频道，不许悄无声息')
})

test('R1b 完全没有 connection 服务时同样安静降级，并写清楚缺的是哪个服务', async () => {
  const ctx = await boot('rpc-no-conn', { connection: false })
  assert.equal(ctx.fiber.state, 2)
  assert.equal(ctx.host.channel.registered(), false)
  assert.equal(ctx.web.routes.length, 0)
  assert.match(ctx.host.channel.pendingReason(), /connection/)
  // watchdog：子 fiber 停在 PENDING 时必须有一行日志点名缺的服务，否则又是一次「安静的 405」。
  const warned = ctx.logs.filter(([level, text]) => level === 'warn' && text.includes('没有提供 connection'))
  assert.equal(warned.length, 1, '永久 PENDING 必须留下点名到服务的告警')
})

// ---------------------------------------------------------------------------
// R2：传输层齐备时真的注册，且卸载后不残留
// ---------------------------------------------------------------------------

test('R2 真实 DSH 形态下注册一条 /org-panel 路由，连载两次不重复注册', async () => {
  const ctx = await boot('rpc-register')
  assert.equal(ctx.host.channel.registered(), true)
  assert.equal(ctx.host.channel.pendingReason(), null)
  assert.equal(ctx.web.routes.length, 1)
  assert.equal(ctx.web.routes[0].path, '/org-panel')
  assert.equal(ctx.web.calls.length, 1)
  // loopback：DSH 对该档位把 trustedHosts 置空，非回环来源一律 403。设置中心是本机操作，不放宽。
  assert.equal(ctx.web.calls[0].options.authority, 'loopback')

  await ctx.fiber.dispose()
  assert.equal(ctx.web.routes.length, 0, 'disposer 必须真的把 HTTP 路由撤掉，否则热重载会叠加')

  await ctx.load()
  assert.equal(ctx.web.routes.length, 1, '重载后只能有一条路由')
})

test('R2b DSH 再次给 web 服务改名也不该波及本频道（我们从不 inject 它）', async () => {
  // 把服务名换成一个谁都没见过的名字：connection 自己 inject 它、自己读它，
  // 我们这边一个字都不用改，频道照样挂得上。这就是「只 inject connection」的价值。
  const ctx = await boot('rpc-renamed', { webServer: true })
  assert.equal(ctx.host.channel.registered(), true)

  const dir = await scratch('rpc-renamed-2')
  const { root } = realCordisCtx()
  const web = await dshWebStack(root, { webServerName: 'someFutureWebService' })
  let host
  const fiber = root.plugin({ name: 'dsh-org-panel', inject, apply(ctx2, cfg) { host = apply(ctx2, cfg); return host } }, {
    memoryFile: join(dir, 'evolution.json'),
    companyFile: join(dir, 'company.json'),
    approvalsFile: join(dir, 'plugin-approvals.json'),
    healthCheckOnStart: false,
  })
  await settleFiber(fiber)
  assert.equal(host.channel.registered(), true, 'web 服务改名不该让 /org-panel 掉线')
  assert.equal(web.routes.length, 1)
  assert.equal(web.routes[0].path, '/org-panel')
})

// ---------------------------------------------------------------------------
// R3：错误面 —— 未知 endpoint 与 handler 抛异常都必须落进 ok:false，不许静默吞掉
// ---------------------------------------------------------------------------

test('R3 未知 endpoint 返回 bad-request，handler 抛异常返回 internal 且带真实原因', async () => {
  const ctx = await boot('rpc-errors')

  const unknown = await call(ctx, 'does/not-exist')
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'bad-request')
  assert.match(unknown.error.message, /does\/not-exist/)
  assert.deepEqual(unknown.error.details, { issues: [] })

  // 缺必填参数：真实原因原样带出去，不改写成「操作失败」这种既没信息又像在遮掩的话术。
  const missing = await call(ctx, 'plugins/approve', {})
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'internal')
  assert.match(missing.error.message, /requestId/)

  const ok = await call(ctx, 'company/snapshot', {})
  assert.equal(ok.ok, true)
  assert.ok(ok.value)
})

// ---------------------------------------------------------------------------
// R4：只读端点在能力层缺席时如实缺席
// ---------------------------------------------------------------------------

test('R4 通讯层没配时 communication/summary 如实说未挂载，不伪造「已连接」', async () => {
  const ctx = await boot('rpc-read-honesty')

  const comm = await call(ctx, 'communication/summary')
  assert.equal(comm.ok, true)
  assert.equal(comm.value.available, true, '通讯层本身挂上了（只是没配渠道）')
  assert.equal(comm.value.configured, false)
  assert.deepEqual(comm.value.adapters, [])

  const security = await call(ctx, 'security/policy')
  assert.equal(security.ok, true)
  // 没写 preapproved、executor 缺省 → 每次都要人类审批。这是从真实配置推的，不是默认值。
  assert.equal(security.value.pluginApproval.mode, 'always')
  assert.equal(security.value.pluginApproval.executor, 'auto')
  assert.equal(security.value.pluginApproval.pendingCount, 0)

  const models = await call(ctx, 'models/providers')
  assert.equal(models.ok, true)
  assert.deepEqual(models.value.providers, [], '一个模型都没配就是空数组，不许塞示例供应商')
  assert.equal(models.value.capabilities.vision.configured, false)

  const health = await call(ctx, 'plugins/health')
  assert.equal(health.ok, true)
  assert.equal(health.value.checkedAt, undefined, '从没跑过健康检查就不许编一个检查时间')
  assert.ok(health.value.catalogSize > 0)
})

test('R4b 别名 endpoint 与正名走同一份实现', async () => {
  const ctx = await boot('rpc-alias')
  const canonical = await call(ctx, 'models/providers')
  const alias = await call(ctx, 'model/list')
  assert.equal(alias.ok, true)
  assert.deepEqual(alias.value.providers, canonical.value.providers)
})

// ---------------------------------------------------------------------------
// R5：存储台账必须是真实的字节数与真实的修改时间
// ---------------------------------------------------------------------------

test('R5 storage/inventory 返回真实 path / bytes / mtime；文件不存在时 exists:false 且不填 0 字节', async () => {
  const ctx = await boot('rpc-storage')

  const before = await call(ctx, 'storage/inventory')
  assert.equal(before.ok, true)
  assert.equal(before.value.dataDir, ctx.dir)
  const approvalsBefore = before.value.files.find((row) => row.key === 'approvals')
  assert.equal(approvalsBefore.exists, false, '还没有人提交过安装申请，台账文件就是不存在')
  assert.equal(approvalsBefore.bytes, undefined, '不存在的文件不许显示成 0 字节 —— 那看起来像「有文件但空的」')

  // 写一条真实申请，台账文件就该出现，且字节数与磁盘一致。
  await ctx.host.plugins.runtime.submit({
    employeeId: 'developer', employeeName: '小刘', pluginName: 'markdown-tools',
    packageName: '@acme/markdown-tools', purpose: '把周报转成 markdown',
    installCommand: 'npm install @acme/markdown-tools', expectedTools: ['md_render'],
  })
  const after = await call(ctx, 'storage/inventory')
  const approvals = after.value.files.find((row) => row.key === 'approvals')
  const real = await stat(join(ctx.dir, 'plugin-approvals.json'))
  assert.equal(approvals.exists, true)
  assert.equal(approvals.bytes, real.size, 'bytes 必须是磁盘上的真实大小')
  assert.equal(approvals.updatedAt, Math.round(real.mtimeMs), 'updatedAt 必须是文件的真实 mtime')

  const evolution = after.value.files.find((row) => row.key === 'evolution')
  assert.equal(evolution.path, join(ctx.dir, 'evolution.json'))
})

// ---------------------------------------------------------------------------
// A2（安全反向用例）：有了 RPC 也**没有**放宽审批语义
//
// 这是本轮唯一一条专门用来证明「我们没有给模型开后门」的用例。
// 写 endpoint 之前先写它；改 org-panel-write.ts 之前先让它继续绿。
// ---------------------------------------------------------------------------

test('A2 Tool Registry 里没有任何一个工具能把 pending 变成 approved', async () => {
  const ctx = await boot('rpc-llm-isolation')
  const runtime = ctx.host.plugins.runtime
  const request = await runtime.submit({
    employeeId: 'developer', employeeName: '小刘', pluginName: 'markdown-tools',
    packageName: '@acme/markdown-tools', purpose: '把周报转成 markdown',
    installCommand: 'npm install @acme/markdown-tools', expectedTools: ['md_render'],
  })
  assert.equal(request.status, 'pending')

  // 1. 结构层面：没有任何一个注册进 Tool Registry 的工具在实现里调 approve/reject。
  for (const [name, tool] of ctx.registered) {
    const source = String(tool.execute)
    assert.doesNotMatch(source, /\.approve\s*\(/, `${name} 的实现里出现了 approve() 调用`)
    assert.doesNotMatch(source, /\.reject\s*\(/, `${name} 的实现里出现了 reject() 调用`)
  }

  // 2. 行为层面：把 requestId 喂给每一个插件相关工具，状态必须纹丝不动。
  for (const name of ['staff_plugin_install_request', 'staff_plugin_install_apply', 'staff_plugin_verify', 'staff_plugin_health_check']) {
    const tool = ctx.registered.get(name)
    assert.ok(tool, `${name} 应当已注册`)
    try {
      await tool.execute({
        requestId: request.requestId, staff: 'developer', pluginId: '@acme/markdown-tools',
        approved: true, status: 'approved', decision: { by: '老板', channel: 'ui' },
      }, {})
    } catch { /* 报错正是期望：没批准就不许装 */ }
    const now = await runtime.request(request.requestId)
    assert.equal(now.status, 'pending', `${name} 把申请状态改动了 —— 模型自我批准的洞`)
  }

  // 3. 工具执行上下文里拿不到 connection，也就打不到 /org-panel。
  assert.equal(ctx.registered.has('org_panel_approve'), false)
})

// ---------------------------------------------------------------------------
// A3：老板在 UI 上点「批准」，台账里必须留下真实的人和真实的渠道
// ---------------------------------------------------------------------------

test('A3 走 /org-panel 的 plugins/approve 落库为 approved + channel:ui + 真实操作者', async () => {
  const ctx = await boot('rpc-approve')
  const runtime = ctx.host.plugins.runtime
  const request = await runtime.submit({
    employeeId: 'developer', employeeName: '小刘', pluginName: 'markdown-tools',
    packageName: '@acme/markdown-tools', purpose: '把周报转成 markdown',
    installCommand: 'npm install @acme/markdown-tools', expectedTools: ['md_render'],
  })

  const result = await call(ctx, 'plugins/approve', { requestId: request.requestId, by: '老板', note: '看过披露卡片' })
  assert.equal(result.ok, true)
  assert.equal(result.value.request.status, 'approved')

  const ledger = JSON.parse(await readFile(join(ctx.dir, 'plugin-approvals.json'), 'utf-8'))
  assert.ok(Array.isArray(ledger.requests), 'plugin-approvals.json 的真实结构是 { version, requests[] }')
  const row = ledger.requests.find((item) => item.requestId === request.requestId)
  assert.ok(row, '审批结果必须真的落到 plugin-approvals.json，而不是只活在内存里')
  assert.equal(row.status, 'approved')
  assert.equal(row.decision.channel, 'ui', '必须记成 ui：这一下确实是人在设置中心点的')
  assert.equal(row.decision.by, '老板')
  assert.equal(row.decision.note, '看过披露卡片')

  // 重复批准要如实报错，不能悄悄成功。
  const again = await call(ctx, 'plugins/approve', { requestId: request.requestId, by: '老板' })
  assert.equal(again.ok, false)
  assert.match(again.error.message, /不能重复审批/)
})

test('A3b plugins/reject 同样落真实操作者，且拒绝后不能再批准', async () => {
  const ctx = await boot('rpc-reject')
  const request = await ctx.host.plugins.runtime.submit({
    employeeId: 'developer', pluginName: 'markdown-tools', packageName: '@acme/markdown-tools',
    purpose: '把周报转成 markdown', installCommand: 'npm install @acme/markdown-tools', expectedTools: ['md_render'],
  })
  const rejected = await call(ctx, 'plugins/reject', { requestId: request.requestId, by: '老板', note: '来源不明' })
  assert.equal(rejected.ok, true)
  assert.equal(rejected.value.request.status, 'rejected')
  assert.equal(rejected.value.request.decision.channel, 'ui')

  const approve = await call(ctx, 'plugins/approve', { requestId: request.requestId, by: '老板' })
  assert.equal(approve.ok, false, '已拒绝的申请不许再被批准')
})

// ---------------------------------------------------------------------------
// 模型写端点：写的是同一份 company.json，且明文密钥依然被拒
// ---------------------------------------------------------------------------

test('W1 models/upsert + models/bind 写进同一份 company.json / evolution.json', async () => {
  const ctx = await boot('rpc-models')

  const created = await call(ctx, 'models/upsert', {
    provider: { id: 'vision-1', type: 'vision', provider: 'openai-compatible', model: 'gpt-4o-mini', baseUrl: 'http://127.0.0.1:1/v1', apiKeyRef: 'env:TEST_KEY' },
  })
  assert.equal(created.ok, true)
  assert.equal(created.value.provider.id, 'vision-1')

  const onDisk = JSON.parse(await readFile(join(ctx.dir, 'company.json'), 'utf-8'))
  assert.ok((onDisk.modelProviders || []).some((item) => item.id === 'vision-1'), '必须写进 host 已有的那份 company.json，不许另起一个写入者')

  const bound = await call(ctx, 'models/bind', { employeeId: 'developer', capability: 'vision', providerId: 'vision-1' })
  assert.equal(bound.ok, true)
  assert.equal(bound.value.binding.providerId, 'vision-1')
  // 绑定不等于可用：没测过连接就是 missing，不许默认 available。
  assert.equal(bound.value.binding.status, 'missing')

  const listed = await call(ctx, 'models/providers')
  assert.equal(listed.value.providers.length, 1)
  assert.equal(listed.value.capabilities.vision.configured, true)

  const unbound = await call(ctx, 'models/bind', { employeeId: 'developer', capability: 'vision', providerId: '' })
  assert.equal(unbound.ok, true)
  assert.equal(unbound.value.binding, null)
})

test('W2 明文密钥经 RPC 写入同样被拒绝，错误如实回传', async () => {
  const ctx = await boot('rpc-models-secret')
  const result = await call(ctx, 'models/upsert', {
    provider: { id: 'leak', type: 'vision', provider: 'openai-compatible', model: 'm', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-plain-text-key' },
  })
  assert.equal(result.ok, false, 'RPC 不是绕开密钥规则的后门')
  assert.equal(result.error.code, 'internal')

  const onDisk = JSON.parse(await readFile(join(ctx.dir, 'company.json'), 'utf-8').catch(() => '{}'))
  assert.equal(JSON.stringify(onDisk).includes('sk-plain-text-key'), false, '明文密钥一个字节都不许落盘')
})

test('W3 未知员工 / 未知供应商的绑定请求如实报错，不静默写入', async () => {
  const ctx = await boot('rpc-bind-guard')
  const badEmployee = await call(ctx, 'models/bind', { employeeId: 'nobody', capability: 'vision', providerId: 'x' })
  assert.equal(badEmployee.ok, false)
  assert.match(badEmployee.error.message, /未知员工/)

  const badProvider = await call(ctx, 'models/bind', { employeeId: 'developer', capability: 'vision', providerId: 'ghost' })
  assert.equal(badProvider.ok, false)
  assert.match(badProvider.error.message, /未知的模型供应商/)
})

// ---------------------------------------------------------------------------
// plugins/healthCheck 是写操作：只在老板点击时跑，不由只读端点顺手触发
// ---------------------------------------------------------------------------

test('W4 plugins/health 只读不触发检查，plugins/healthCheck 才真的跑一次', async () => {
  const ctx = await boot('rpc-health')
  const readonly = await call(ctx, 'plugins/health')
  assert.equal(readonly.value.checkedAt, undefined)

  const ran = await call(ctx, 'plugins/healthCheck', {})
  assert.equal(ran.ok, true)
  assert.ok(ran.value.checkedAt > 0)

  const again = await call(ctx, 'plugins/health')
  assert.equal(again.value.checkedAt, ran.value.checkedAt, '跑过之后只读端点要报真实的那次检查时间')
})

// ---------------------------------------------------------------------------
// 频道名与端点名必须符合 DSH 的校验规则（否则注册期就会被 assertChannel 打回）
// ---------------------------------------------------------------------------

test('R6 频道名与全部 endpoint 名符合 DSH 的 CHANNEL / ENDPOINT 规则', async () => {
  const ctx = await boot('rpc-naming')
  assert.match('/org-panel', /^\/[A-Za-z0-9._~-]+$/)
  assert.notEqual('/org-panel', '/api')

  // DSH 按 '/' 切段，每段必须匹配 /^[A-Za-z0-9_$.-]+$/，且不能是 '' / '.' / '..'。
  const segment = /^[A-Za-z0-9_$.-]+$/
  const endpoints = [
    'company/snapshot', 'plugins/approvals', 'plugins/health', 'communication/summary',
    'security/policy', 'models/providers', 'storage/inventory',
    'plugins/approve', 'plugins/reject', 'plugins/verify', 'plugins/healthCheck',
    'models/upsert', 'models/setEnabled', 'models/test', 'models/bind',
  ]
  for (const endpoint of endpoints) {
    for (const part of endpoint.split('/')) {
      assert.ok(part && part !== '.' && part !== '..' && segment.test(part), `endpoint 段非法：${endpoint}`)
    }
    const result = await call(ctx, endpoint, {})
    assert.notEqual(result.error?.code, 'bad-request', `${endpoint} 没有被分发器认出来`)
  }

  await writeFile(join(ctx.dir, 'noop.txt'), 'x', 'utf-8')
})
