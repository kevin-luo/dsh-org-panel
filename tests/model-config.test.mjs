// Phase 4 的端到端可达性 + SecretVault 的诚实性。
//
// 这个文件盯的是审计里两条「编译过但跑不到 / 名不副实」的洞：
//   · registerModelGateway 必须真的读 cordis composition config 里的 models: 段并落库，
//     否则那条写得很完整的多供应商 fallback 链在真实运行中永远走不到；
//   · 老板必须能在会话里查看 / 配置 / 自检 / 绑定模型，且写入路径只收 SecretRef，不收明文；
//   · 本地密钥库到底是「真加密」还是「仅本机混淆」，能力标志必须跟实现一致 ——
//     这里用「换一个进程实例还能不能解开」来验证这个标志没有说谎。
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PIXEL_PNG_BASE64, scratch } from './_helpers.mjs'

const { CompanyStore, EvolutionStore, registerModelGateway } = await import('../lib/index.js')

const STAFF = ['designer', 'search-specialist']
const DATA_URL = `data:image/png;base64,${PIXEL_PNG_BASE64}`
const POSIX = process.platform !== 'win32'

/** 只有 tools.register / logger / systemPrompt 的假 ctx，形态与 DSH 挂载时一致。 */
function toolCtx() {
  const registered = new Map()
  const logs = []
  return {
    logs,
    registered,
    tools: { register: (tool) => registered.set(tool.name, tool), list: () => Array.from(registered.keys()).map((name) => ({ name })) },
    systemPrompt: { section: () => undefined },
    logger: { info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]), error: (m) => logs.push(['error', m]) },
  }
}

async function bench(name, config = {}) {
  const dir = await scratch(name)
  const evolution = new EvolutionStore(join(dir, 'evolution.json'))
  const company = new CompanyStore(evolution, join(dir, 'company.json'))
  const ctx = toolCtx()
  const gateway = registerModelGateway(ctx, { secretsFile: join(dir, 'secrets', 'vault.enc'), ...config }, { company, evolution, staffIds: STAFF })
  const summary = await gateway.configReady
  return { dir, evolution, company, ctx, gateway, summary, tool: (toolName) => ctx.registered.get(toolName) }
}

/** 假 HTTP：只按 URL 分发，返回 requestJson 真正会用到的那几个成员。 */
function fakeFetch(routes) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const target = String(url)
    calls.push({ url: target, headers: init?.headers || {}, body: init?.body ? JSON.parse(init.body) : undefined })
    const route = Object.keys(routes).find((prefix) => target.startsWith(prefix))
    if (!route) throw new Error(`fetch 打到了没有预置的地址：${target}`)
    const { status = 200, body = '' } = routes[route]
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => 'application/json' },
      text: async () => body,
    }
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

const geminiReply = (description) => JSON.stringify({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ description }) }] } }],
  modelVersion: 'm-backup-real',
})

const openAiReply = (description) => JSON.stringify({
  model: 'm-primary-real',
  choices: [{ message: { content: JSON.stringify({ description }) } }],
})

// ---------------------------------------------------------------------------
// 一、cordis models: 段真的被读入并落库
// ---------------------------------------------------------------------------

test('Model config: cordis models: 段启动时落库，company_model_* 工具全部注册', async () => {
  process.env.DSH_TEST_VISION_KEY = 'sk-vision-1111-2222'
  const { gateway, company, evolution, summary, ctx, dir } = await bench('model-config-load', {
    // 需求文档十一的 YAML 示例，逐字段照抄成对象形式。
    models: {
      'vision-fast': { type: 'vision', provider: 'openai-compatible', baseUrl: 'https://fast.invalid/v1', model: 'xxx-vision', apiKeyRef: 'env:DSH_TEST_VISION_KEY' },
      'vision-quality': { type: 'vision', provider: 'gemini', baseUrl: 'https://quality.invalid', model: 'xxx', apiKeyRef: 'env:DSH_TEST_VISION_KEY' },
      'text-main': { type: 'text', provider: 'openai-compatible', baseUrl: 'https://text.invalid/v1', model: 'xxx-text' },
    },
    modelBindings: { designer: { vision: ['vision-quality', 'vision-fast'] } },
  })

  assert.deepEqual(summary.errors, [], '示例配置不该产生任何错误')
  assert.deepEqual(summary.providers.map((item) => item.id).sort(), ['text-main', 'vision-fast', 'vision-quality'])

  // 落库：不是只在内存里转一圈。
  const stored = await company.modelProviders('vision')
  assert.deepEqual(stored.map((item) => item.id).sort(), ['vision-fast', 'vision-quality'])
  assert.equal(stored.find((item) => item.id === 'vision-fast').apiKeyRef, 'env:DSH_TEST_VISION_KEY')

  // 落盘：换一个 Store 实例读同一个文件也读得到。
  const reopened = new CompanyStore(new EvolutionStore(join(dir, 'evolution.json')), join(dir, 'company.json'))
  assert.equal((await reopened.modelProviders()).length, 3)

  // 员工绑定：数组顺序就是优先级顺序，状态按真实可用性写。
  const bindings = await evolution.modelBindings('designer')
  assert.deepEqual(bindings.map((item) => [item.providerId, item.priority, item.status]), [
    ['vision-quality', 1, 'available'],
    ['vision-fast', 2, 'available'],
  ])

  // 能力路由：配置读进来之后 vision 就真的可用了，且按员工绑定排序。
  const status = await gateway.capabilityStatus('vision', 'designer')
  assert.equal(status.configured, true)
  assert.deepEqual(status.providers.map((item) => item.providerId), ['vision-quality', 'vision-fast'])
  assert.equal(status.providers[0].apiKeyConfigured, true)
  assert.equal(status.providers[0].apiKeyMasked, 'sk-v****2222', '对外只给掩码')

  // 老板的会话入口：四个工具 + vision_analyze 都必须真的注册上。
  assert.deepEqual(
    ['vision_analyze', 'company_model_list', 'company_model_config', 'company_model_test', 'company_model_bind'].filter((name) => !ctx.registered.has(name)),
    [],
    '缺任何一个工具，Phase 4 在会话里就还是不可达',
  )
})

test('Model config: 空配置不写任何东西，坏行只记错误不阻断好行', async () => {
  const empty = await bench('model-config-empty')
  assert.deepEqual(empty.summary, { providers: [], bindings: [], errors: [] })
  assert.deepEqual(await empty.company.modelProviders(), [])

  const mixed = await bench('model-config-mixed', {
    models: {
      good: { type: 'vision', provider: 'gemini', baseUrl: 'https://good.invalid', model: 'm-good' },
      'no-model': { type: 'vision', provider: 'gemini', baseUrl: 'https://bad.invalid' },
      'not-an-object': 'gpt-whatever',
    },
    modelBindings: { designer: { telepathy: 'good' } },
  })
  assert.deepEqual(mixed.summary.providers.map((item) => item.id), ['good'], '坏行不能拖垮好行')
  assert.equal(mixed.summary.errors.length, 3)
  assert.ok(mixed.summary.errors.some((item) => item.includes('models.no-model')))
  assert.ok(mixed.summary.errors.some((item) => item.includes('models.not-an-object')))
  assert.ok(mixed.summary.errors.some((item) => item.includes('telepathy')), '认不出的能力要报出来，不许自己猜一个')
  assert.ok(mixed.ctx.logs.some(([level, message]) => level === 'warn' && message.includes('模型配置有问题')), '坏配置要进日志')
})

// ---------------------------------------------------------------------------
// 二、配置进来之后，vision_analyze 真的能沿 fallback 链跑通（假 HTTP，走真实适配器）
// ---------------------------------------------------------------------------

test('Model config: 配好 provider 后 vision_analyze 真的走 fallback 链（假 HTTP）', async () => {
  process.env.DSH_TEST_VISION_KEY = 'sk-vision-1111-2222'
  const { tool } = await bench('model-config-fallback', {
    models: {
      'vision-fast': { type: 'vision', provider: 'openai-compatible', baseUrl: 'https://fast.invalid/v1', model: 'xxx-vision', apiKeyRef: 'env:DSH_TEST_VISION_KEY' },
      'vision-quality': { type: 'vision', provider: 'gemini', baseUrl: 'https://quality.invalid', model: 'xxx', apiKeyRef: 'env:DSH_TEST_VISION_KEY' },
    },
  })
  const http = fakeFetch({
    'https://fast.invalid': { status: 429, body: '{"error":{"message":"rate limited"}}' },
    'https://quality.invalid': { status: 200, body: geminiReply('截图里是一个登录表单') },
  })
  try {
    const result = await tool('vision_analyze').execute({ images: [DATA_URL], mode: 'ui' })
    assert.equal(result.providerId, 'vision-quality', '首选 429 之后必须真的降级到备选')
    assert.equal(result.model, 'm-backup-real')
    assert.equal(result.description, '截图里是一个登录表单')
    assert.deepEqual(result.attempts.map((item) => [item.providerId, item.ok, item.code]), [
      ['vision-fast', false, 'rate-limit'],
      ['vision-quality', true, undefined],
    ])

    // 两次都真的发出去了，而且用的是配置里的 baseUrl / model / 密钥引用解析出的值。
    assert.equal(http.calls.length, 2)
    assert.equal(http.calls[0].url, 'https://fast.invalid/v1/chat/completions')
    assert.equal(http.calls[0].headers.authorization, 'Bearer sk-vision-1111-2222')
    assert.equal(http.calls[0].body.model, 'xxx-vision')
    assert.equal(http.calls[1].url, 'https://quality.invalid/models/xxx:generateContent')
    assert.equal(http.calls[1].headers['x-goog-api-key'], 'sk-vision-1111-2222')
    // 图片是真的被带上去的，不是只发了一段提示词。
    assert.equal(http.calls[1].body.contents[0].parts[1].inline_data.data, PIXEL_PNG_BASE64)
  } finally {
    http.restore()
  }
})

test('Model config: company_model_bind 写进去的绑定，真实运行时会被读出来用', async () => {
  process.env.DSH_TEST_VISION_KEY = 'sk-vision-1111-2222'
  const { tool, evolution, gateway } = await bench('model-config-bind', {
    models: {
      'vision-fast': { type: 'vision', provider: 'openai-compatible', baseUrl: 'https://fast.invalid/v1', model: 'xxx-vision', apiKeyRef: 'env:DSH_TEST_VISION_KEY' },
      'vision-quality': { type: 'vision', provider: 'gemini', baseUrl: 'https://quality.invalid', model: 'xxx', apiKeyRef: 'env:DSH_TEST_VISION_KEY' },
    },
  })
  // 公司级顺序是 vision-fast 在前；老板在会话里把小画绑到 vision-quality 上。
  const bound = await tool('company_model_bind').execute({ staff: 'designer', capability: 'vision', provider: 'vision-quality', priority: 1 })
  assert.equal(bound.binding.status, 'available')
  assert.deepEqual(bound.chain.map((item) => [item.providerId, item.bound]), [['vision-quality', true], ['vision-fast', false]])
  assert.deepEqual((await evolution.modelBindings('designer')).map((item) => item.providerId), ['vision-quality'], '绑定必须真的落到 evolution.json')

  const http = fakeFetch({
    'https://quality.invalid': { status: 200, body: geminiReply('小画看到的是一张设计稿') },
    'https://fast.invalid': { status: 200, body: openAiReply('不该被调用') },
  })
  try {
    const result = await tool('vision_analyze').execute({ images: [DATA_URL], staff: 'designer' })
    assert.equal(result.providerId, 'vision-quality')
    assert.equal(result.description, '小画看到的是一张设计稿')
    assert.deepEqual(http.calls.map((item) => item.url), ['https://quality.invalid/models/xxx:generateContent'], '绑定说了算，公司级首选不该被碰')
  } finally {
    http.restore()
  }

  // 没绑定的员工照旧走公司级顺序，绑定不会污染别人。
  const others = await gateway.router.resolve('vision', 'search-specialist')
  assert.deepEqual(others.map((item) => item.config.id), ['vision-fast', 'vision-quality'])

  // 解绑之后立刻回到公司级顺序。
  const unbound = await tool('company_model_bind').execute({ action: 'unbind', staff: 'designer', capability: 'vision' })
  assert.equal(unbound.removed, true)
  assert.deepEqual(unbound.chain.map((item) => item.providerId), ['vision-fast', 'vision-quality'])

  // 绑到一个不存在的供应商上要当场拒绝，而不是记一条永远走不到的绑定。
  await assert.rejects(
    () => tool('company_model_bind').execute({ staff: 'designer', capability: 'vision', provider: 'ghost' }),
    /没有 id 为「ghost」的模型供应商/,
  )
})

test('Model config: company_model_test 真发请求才说 live-call，发不了就如实说只查了配置', async () => {
  process.env.DSH_TEST_VISION_KEY = 'sk-vision-1111-2222'
  const { tool } = await bench('model-config-test', {
    models: {
      'vision-fast': { type: 'vision', provider: 'openai-compatible', baseUrl: 'https://fast.invalid/v1', model: 'xxx-vision', apiKeyRef: 'env:DSH_TEST_VISION_KEY' },
      'text-main': { type: 'text', provider: 'openai-compatible', baseUrl: 'https://text.invalid/v1', model: 'xxx-text' },
      'vision-off': { type: 'vision', provider: 'gemini', baseUrl: 'https://off.invalid', model: 'xxx', enabled: false },
      'vision-nokey': { type: 'vision', provider: 'gemini', baseUrl: 'https://nokey.invalid', model: 'xxx', apiKeyRef: 'env:DSH_TEST_KEY_NEVER_SET' },
    },
  })
  delete process.env.DSH_TEST_KEY_NEVER_SET

  const http = fakeFetch({ 'https://fast.invalid': { status: 200, body: openAiReply('ok') } })
  try {
    const live = await tool('company_model_test').execute({ id: 'vision-fast' })
    assert.equal(live.checked, 'live-call')
    assert.equal(live.ok, true)
    assert.equal(live.apiKeyMasked, 'sk-v****2222')
    assert.equal(JSON.stringify(live).includes('sk-vision-1111-2222'), false, '自检结果里绝不能出现完整密钥')
    assert.equal(http.calls.length, 1, 'vision 供应商必须真的发一次请求')

    const text = await tool('company_model_test').execute({ id: 'text-main' })
    assert.equal(text.checked, 'config-only')
    assert.match(text.message, /可用性尚未验证/, '不许把「配置齐全」说成「测试通过」')

    const off = await tool('company_model_test').execute({ id: 'vision-off' })
    assert.equal(off.ok, false)
    assert.equal(off.code, 'not-configured')

    const nokey = await tool('company_model_test').execute({ id: 'vision-nokey' })
    assert.equal(nokey.ok, false)
    assert.equal(nokey.code, 'missing-key')
    assert.equal(http.calls.length, 1, '缺密钥 / 已停用的供应商不该真发请求')

    await assert.rejects(() => tool('company_model_test').execute({ id: 'ghost' }), /没有 id 为「ghost」的模型供应商/)
  } finally {
    http.restore()
  }
})

// ---------------------------------------------------------------------------
// 三、写入路径只收 SecretRef，明文密钥一律拒绝
// ---------------------------------------------------------------------------

test('Model config: 明文密钥在配置段与写工具里都被拒绝，且不会被回显', async () => {
  const RAW = 'sk-plaintext-must-never-land-9876'
  const { summary, company, tool, dir } = await bench('model-config-plaintext', {
    models: {
      'sneaky-inline': { type: 'vision', provider: 'gemini', baseUrl: 'https://a.invalid', model: 'm', apiKey: RAW },
      'sneaky-ref': { type: 'vision', provider: 'gemini', baseUrl: 'https://b.invalid', model: 'm', apiKeyRef: RAW },
      'sneaky-token': { type: 'vision', provider: 'gemini', baseUrl: 'https://c.invalid', model: 'm', token: RAW },
      clean: { type: 'vision', provider: 'gemini', baseUrl: 'https://d.invalid', model: 'm', apiKeyRef: 'secret:vision-key' },
    },
  })

  assert.deepEqual(summary.providers.map((item) => item.id), ['clean'], '三种明文写法都不许落库')
  assert.equal(summary.errors.length, 3)
  assert.ok(summary.errors.some((item) => item.includes('sneaky-inline') && item.includes('apiKey')))
  assert.ok(summary.errors.some((item) => item.includes('apiKeyRef must look like')))
  assert.equal(JSON.stringify(summary).includes(RAW), false, '错误信息里不许回显被拒绝的明文密钥')

  const persisted = await readFile(join(dir, 'company.json'), 'utf-8')
  assert.equal(persisted.includes(RAW), false, 'company.json 里绝不允许出现明文密钥')
  assert.deepEqual((await company.modelProviders()).map((item) => item.id), ['clean'])

  // 会话里的写工具走的是同一份校验，不存在「配置文件严、工具松」的双标。
  await assert.rejects(
    () => tool('company_model_config').execute({ id: 'via-tool', type: 'vision', provider: 'gemini', baseUrl: 'https://e.invalid', model: 'm', apiKey: RAW }),
    (error) => {
      assert.match(error.message, /拒绝接收明文密钥字段/)
      assert.equal(error.message.includes(RAW), false)
      return true
    },
  )
  await assert.rejects(
    () => tool('company_model_config').execute({ id: 'via-tool', type: 'vision', provider: 'gemini', baseUrl: 'https://e.invalid', model: 'm', apiKeyRef: RAW }),
    (error) => {
      assert.match(error.message, /apiKeyRef must look like env:XXX or secret:XXX/)
      assert.equal(error.message.includes(RAW), false)
      return true
    },
  )
  assert.deepEqual((await company.modelProviders()).map((item) => item.id), ['clean'], '被拒绝的写入不许留下半条记录')

  // 新建时不许替老板猜 type/provider，否则会造出一个永远进不了正确 fallback 链的供应商。
  await assert.rejects(
    () => tool('company_model_config').execute({ id: 'half-baked', model: 'm' }),
    /新建供应商必须同时给出 type/,
  )

  // 合法写入照常工作，回来的摘要里只有掩码位。
  const saved = await tool('company_model_config').execute({ id: 'via-tool', type: 'vision', provider: 'gemini', baseUrl: 'https://e.invalid', model: 'm', apiKeyRef: 'env:DSH_TEST_VISION_KEY' })
  assert.equal(saved.provider.id, 'via-tool')
  assert.equal(saved.provider.apiKeyRef, 'env:DSH_TEST_VISION_KEY')
  assert.equal(Object.prototype.hasOwnProperty.call(saved.provider, 'apiKey'), false)
})

// ---------------------------------------------------------------------------
// 四、SecretVault 的能力标志必须与实现一致（审计 FAIL 项）
// ---------------------------------------------------------------------------

test('SecretVault: 没有口令时如实标 obfuscated —— 同机另一个实例确实能解开', async () => {
  const dir = await scratch('vault-obfuscated')
  const vaultFile = join(dir, 'secrets', 'vault.enc')
  const secret = 'sk-vault-value-1234-5678'
  const { gateway } = await bench('vault-obfuscated-gw', { secretsFile: vaultFile })

  const before = await gateway.secretStorage()
  assert.equal(before.mode, 'obfuscated')
  assert.equal(before.keySource, 'machine')
  assert.equal(before.label, '仅本机混淆存储')
  assert.equal(before.exists, false)
  assert.match(before.warning, /不是真正的密钥保护/)
  assert.match(before.warning, /DSH_ORG_PANEL_SECRETS_PASSPHRASE/, '要告诉老板怎么升级成真加密')

  const stored = await gateway.secrets.store('secret:vision-key', secret)
  assert.equal(stored.configured, true)
  assert.equal(stored.masked, 'sk-v****5678')
  assert.equal(JSON.stringify(stored).includes(secret), false)

  const after = await gateway.secretStorage()
  assert.equal(after.mode, 'obfuscated', '写完之后标志不许偷偷变成 encrypted')
  assert.equal(after.exists, true)
  assert.equal(after.entries, 1)

  // 至少没有把明文摊在磁盘上 —— obfuscated 也不是「什么都没做」。
  const raw = await readFile(vaultFile, 'utf-8')
  assert.equal(raw.includes(secret), false)

  // 关键一条：另起一个网关实例（等价于同机另一个进程），不需要任何口令就能解开。
  // 解得开 = 这份库确实只是混淆，能力标志说 obfuscated 是诚实的。
  const other = await bench('vault-obfuscated-other', { secretsFile: vaultFile })
  const revealed = await other.gateway.secrets.reveal('secret:vision-key')
  assert.equal(revealed.value, secret)
  assert.equal(revealed.source, 'vault')
  const otherStatus = await other.gateway.secretStorage()
  assert.equal(otherStatus.mode, 'obfuscated')

  // 顺带守住「来自 vault 的密钥要把保护等级带给 UI」这条。
  const refStatus = await other.gateway.secrets.status('secret:vision-key')
  assert.equal(refStatus.storage, 'obfuscated')
  assert.equal(refStatus.masked, 'sk-v****5678')
})

test('SecretVault: 密钥文件与目录必须是 0600 / 0700，且能力标志如实报告权限', async () => {
  if (!POSIX) return
  const dir = await scratch('vault-perm')
  const vaultFile = join(dir, 'secrets', 'vault.enc')
  const { gateway } = await bench('vault-perm-gw', { secretsFile: vaultFile })
  await gateway.secrets.store('secret:k', 'sk-permission-check-0001')

  const fileMode = (await stat(vaultFile)).mode & 0o777
  const dirMode = (await stat(join(dir, 'secrets'))).mode & 0o777
  assert.equal(fileMode.toString(8), '600', '同机其他用户不许读到密钥文件')
  assert.equal(dirMode.toString(8), '700')

  const status = await gateway.secretStorage()
  assert.equal(status.permissions, '600')
  assert.equal(status.ownerOnly, true)
  assert.equal(status.warning.includes('权限'), false, '权限已经收紧就不该再报权限警告')
})

test('SecretVault: 给了口令才算 encrypted，没有口令的实例解不开也不装作解开了', async () => {
  const dir = await scratch('vault-encrypted')
  const vaultFile = join(dir, 'secrets', 'vault.enc')
  const secret = 'sk-passphrase-protected-4321'
  const locked = await bench('vault-encrypted-gw', { secretsFile: vaultFile, secretsPassphrase: 'correct horse battery staple' })

  await locked.gateway.secrets.store('secret:vision-key', secret)
  const status = await locked.gateway.secretStorage()
  assert.equal(status.mode, 'encrypted')
  assert.equal(status.keySource, 'passphrase')
  assert.equal(status.label, '口令加密存储')
  assert.equal(status.warning, undefined, '真加密就不该再挂混淆警告')
  assert.equal((await locked.gateway.secrets.reveal('secret:vision-key')).value, secret)

  // 口令不落盘：文件里既没有明文密钥，也没有口令本身。
  const raw = await readFile(vaultFile, 'utf-8')
  assert.equal(raw.includes(secret), false)
  assert.equal(raw.includes('correct horse battery staple'), false)

  // 同一台机器、同一个用户、同一个文件，但没有口令 —— 必须解不开。
  const noPass = await bench('vault-encrypted-nopass', { secretsFile: vaultFile })
  const revealed = await noPass.gateway.secrets.reveal('secret:vision-key')
  assert.equal(revealed.value, undefined)
  assert.equal(revealed.source, 'none')
  assert.equal((await noPass.gateway.secrets.status('secret:vision-key')).configured, false)
  // 存着的东西确实是口令加密的，所以标志仍然是 encrypted，只是本进程读不了。
  assert.equal((await noPass.gateway.secretStorage()).mode, 'encrypted')

  // 口令错了同样解不开，绝不回落到本机混淆的密钥去猜。
  const wrongPass = await bench('vault-encrypted-wrong', { secretsFile: vaultFile, secretsPassphrase: 'wrong passphrase' })
  assert.equal((await wrongPass.gateway.secrets.reveal('secret:vision-key')).value, undefined)
})

test('SecretVault: 旧版本写出的宽权限密钥文件照样读得回，且读到就顺手收紧', async () => {
  const dir = await scratch('vault-legacy')
  const vaultFile = join(dir, 'secrets', 'vault.enc')
  const secret = 'sk-legacy-entry-5555-6666'
  const writer = await bench('vault-legacy-writer', { secretsFile: vaultFile })
  await writer.gateway.secrets.store('secret:legacy', secret)

  // 退回旧版本的形态：文件里没有 keySource 字段，权限是默认的 0644。
  const parsed = JSON.parse(await readFile(vaultFile, 'utf-8'))
  delete parsed.keySource
  for (const entry of Object.values(parsed.entries)) delete entry.keySource
  await writeFile(vaultFile, JSON.stringify(parsed), 'utf-8')
  if (POSIX) await chmod(vaultFile, 0o644)

  const reader = await bench('vault-legacy-reader', { secretsFile: vaultFile })
  assert.equal((await reader.gateway.secrets.reveal('secret:legacy')).value, secret, '升级不许弄丢老板已经存好的密钥')
  const status = await reader.gateway.secretStorage()
  assert.equal(status.mode, 'obfuscated')
  if (POSIX) {
    assert.equal(((await stat(vaultFile)).mode & 0o777).toString(8), '600', '读到宽权限的历史文件就该当场收紧')
    assert.equal(status.permissions, '600')
    assert.equal(status.ownerOnly, true)
  }
})

test('SecretVault: 能力标志随 company_model_list 一起下发给 UI，不许一律绿标', async () => {
  const { tool } = await bench('vault-flag-list')
  const listed = await tool('company_model_list').execute({})
  assert.equal(listed.secretStorage.mode, 'obfuscated')
  assert.equal(listed.secretStorage.label, '仅本机混淆存储')
  assert.ok(listed.secretStorage.warning, 'UI 必须拿得到这段说明才能如实显示')
  // 渲染出来的文字里也要带上真实等级，员工转述时不会说成「已加密」。
  const rendered = tool('company_model_list').output.render({}, listed)[0].text
  assert.match(rendered, /仅本机混淆存储/)
})
