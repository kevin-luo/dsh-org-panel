// 需求文档五十八条第 5 项：Model fallback。
//
// 被测口径来自需求文档十一 / 十二 / 十三 / 十五 + 五十七条：
//   · 没有任何可用视觉供应商时，抛错并原样带出文档十五的引导文案，绝不返回任何图片描述（不编造）；
//   · 按 ModelBinding.priority 路由，一家失败自动降级到下一家，每一次尝试都如实记录；
//   · 可重试错误才继续往下走，不可重试错误立刻停链；
//   · 任何回传 / 日志里都不许出现完整 API Key；
//   · 配置类失败（缺密钥）不算员工技能失败，只把模型绑定标成 missing。
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { PIXEL_PNG_IMAGE, scratch } from './_helpers.mjs'

const { CompanyStore, EvolutionStore, ModelGateway } = await import('../lib/index.js')

/** 文档十五要求员工原样转达的那段话。这里写死一份，等于给这段承诺上锁。 */
const VISION_UNAVAILABLE = [
  '我目前没有可用的图片理解模型。',
  '',
  '可以在：',
  '公司设置 → 模型 → 视觉模型',
  '',
  '配置一个多模态模型后再让我分析。',
].join('\n')

async function bench(name) {
  const dir = await scratch(name)
  const evolution = new EvolutionStore(join(dir, 'evolution.json'))
  const company = new CompanyStore(evolution, join(dir, 'company.json'))
  const registry = {
    adapters: new Map(),
    get(vendor) { return this.adapters.get(vendor) },
  }
  const warnings = []
  const gateway = new ModelGateway({
    company, evolution, registry,
    vaultFile: join(dir, 'vault.enc'),
    logger: { warn: (message) => warnings.push(message) },
  })
  return { dir, evolution, company, registry, gateway, warnings }
}

/**
 * 拿到网关内部的 ModelGatewayError 类。它没有从包入口导出，但网关会真的抛出它，
 * 于是从一次真实抛错里取构造器 —— 这样测试用的错误和生产代码抛的是同一个类，
 * code / retryable 的判定路径完全一致，不是另造一个假错误。
 */
async function gatewayErrorClass(gateway) {
  try {
    await gateway.analyzeVision({ images: [] })
  } catch (error) {
    return error.constructor
  }
  throw new Error('analyzeVision 收到空图片列表时必须抛错')
}

/** 造一个只认 vision 的假适配器；behavior 决定它这次是成功还是以某种错误失败。 */
function stubAdapter(vendor, behavior, calls) {
  return {
    vendor,
    label: `stub-${vendor}`,
    supports: (capability) => capability === 'vision',
    async analyzeVision(input) {
      calls.push({ providerId: input.config.id, model: input.config.model, apiKey: input.apiKey, images: input.images.length, mode: input.mode })
      return behavior(input)
    },
  }
}

test('Model fallback: 一家没配就抛文档十五原文，绝不返回任何图片描述', async () => {
  const { gateway } = await bench('model-none')
  await assert.rejects(
    () => gateway.analyzeVision({ images: [PIXEL_PNG_IMAGE] }),
    (error) => {
      assert.equal(error.code, 'not-configured')
      assert.equal(error.message, VISION_UNAVAILABLE, '错误文案必须与需求文档十五逐字一致')
      assert.equal(error.guidance, VISION_UNAVAILABLE)
      assert.equal(gateway.visionUnavailableMessage(), VISION_UNAVAILABLE)
      return true
    },
  )
  const status = await gateway.capabilityStatus('vision')
  assert.equal(status.configured, false)
  assert.deepEqual(status.providers, [])
})

test('Model fallback: 首选限流 → 自动降到备选并成功，尝试链如实记录', async () => {
  const { company, gateway, registry, warnings } = await bench('model-chain')
  const ErrorClass = await gatewayErrorClass(gateway)
  const calls = []
  process.env.DSH_TEST_KEY_PRIMARY = 'sk-primary-1111-2222'
  process.env.DSH_TEST_KEY_BACKUP = 'sk-backup-3333-4444'

  await company.upsertModelProvider({ id: 'primary', type: 'vision', provider: 'openai-compatible', model: 'm-primary', baseUrl: 'https://primary.invalid/v1', apiKeyRef: 'env:DSH_TEST_KEY_PRIMARY', enabled: true })
  await company.upsertModelProvider({ id: 'backup', type: 'vision', provider: 'gemini', model: 'm-backup', baseUrl: 'https://backup.invalid/v1', apiKeyRef: 'env:DSH_TEST_KEY_BACKUP', enabled: true })
  await company.upsertModelProvider({ id: 'disabled', type: 'vision', provider: 'custom', model: 'm-off', baseUrl: 'https://off.invalid', enabled: false })

  registry.adapters.set('openai-compatible', stubAdapter('openai-compatible', () => { throw new ErrorClass('rate-limit', '供应商返回 HTTP 429', { providerId: 'primary' }) }, calls))
  registry.adapters.set('gemini', stubAdapter('gemini', () => ({ text: '{"description":"一张 1×1 的透明测试图","confidence":0.3}', model: 'm-backup-0925' }), calls))
  registry.adapters.set('custom', stubAdapter('custom', () => ({ text: '{"description":"不该被调用"}' }), calls))

  const analysis = await gateway.analyzeVision({ images: [PIXEL_PNG_IMAGE], mode: 'ui' })

  assert.equal(analysis.result.providerId, 'backup')
  assert.equal(analysis.result.model, 'm-backup-0925', '模型名要用供应商真实回报的那个')
  assert.equal(analysis.result.description, '一张 1×1 的透明测试图')
  assert.equal(analysis.result.confidence, 0.3)
  assert.equal(analysis.imageCount, 1)
  assert.equal(analysis.mode, 'ui')

  assert.equal(analysis.attempts.length, 2, '两次真实尝试都要留痕')
  assert.deepEqual(analysis.attempts.map((item) => [item.providerId, item.ok, item.code]), [
    ['primary', false, 'rate-limit'],
    ['backup', true, undefined],
  ])

  assert.deepEqual(calls.map((item) => item.providerId), ['primary', 'backup'], '停用的供应商不许进 fallback 链')
  assert.equal(calls[0].apiKey, 'sk-primary-1111-2222', '解析出的密钥只交给适配器')
  assert.equal(calls[1].mode, 'ui')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /vision provider primary failed \(rate-limit\)/)
})

test('Model fallback: 缺密钥的供应商根本不会被调用，直接换下一家', async () => {
  const { company, gateway, registry } = await bench('model-missing-key')
  const calls = []
  delete process.env.DSH_TEST_KEY_ABSENT
  await company.upsertModelProvider({ id: 'nokey', type: 'vision', provider: 'openai-compatible', model: 'm-nokey', baseUrl: 'https://nokey.invalid/v1', apiKeyRef: 'env:DSH_TEST_KEY_ABSENT', enabled: true })
  await company.upsertModelProvider({ id: 'local', type: 'vision', provider: 'custom', model: 'm-local', baseUrl: 'http://127.0.0.1:1/v1', enabled: true })

  registry.adapters.set('openai-compatible', stubAdapter('openai-compatible', () => ({ text: '{"description":"不该被调用"}' }), calls))
  registry.adapters.set('custom', stubAdapter('custom', () => ({ text: '本地模型：一张纯色小图' }), calls))

  const analysis = await gateway.analyzeVision({ images: [PIXEL_PNG_IMAGE] })
  assert.equal(analysis.result.providerId, 'local')
  assert.equal(analysis.result.description, '本地模型：一张纯色小图', '不是 JSON 就整段当描述，不许自己补内容')
  assert.deepEqual(calls.map((item) => item.providerId), ['local'], '密钥解析不到就不该发请求')
  assert.deepEqual(analysis.attempts.map((item) => [item.providerId, item.ok, item.code]), [
    ['nokey', false, 'missing-key'],
    ['local', true, undefined],
  ])
  assert.equal(calls[0].apiKey, undefined, '没配 apiKeyRef 的本地模型不该被塞进一个密钥')
})

test('Model fallback: 全都失败就抛错，错误里带完整尝试链且不泄漏密钥', async () => {
  const { company, gateway, registry } = await bench('model-allfail')
  const ErrorClass = await gatewayErrorClass(gateway)
  const calls = []
  const secret = 'sk-super-secret-9876543210'
  process.env.DSH_TEST_KEY_LEAK = secret

  await company.upsertModelProvider({ id: 'first', type: 'vision', provider: 'openai-compatible', model: 'm1', baseUrl: 'https://a.invalid/v1', apiKeyRef: 'env:DSH_TEST_KEY_LEAK', enabled: true })
  await company.upsertModelProvider({ id: 'second', type: 'vision', provider: 'gemini', model: 'm2', baseUrl: 'https://b.invalid/v1', apiKeyRef: 'env:DSH_TEST_KEY_LEAK', enabled: true })

  registry.adapters.set('openai-compatible', stubAdapter('openai-compatible', () => { throw new ErrorClass('timeout', '请求在 45000ms 内没有返回', { providerId: 'first' }) }, calls))
  // 供应商把请求体原样回显了 —— 密钥必须在出错路径上被抹掉。
  registry.adapters.set('gemini', stubAdapter('gemini', () => { throw new ErrorClass('server', `供应商返回 HTTP 500：{"key":"${secret}"}`, { providerId: 'second' }) }, calls))

  await assert.rejects(
    () => gateway.analyzeVision({ images: [PIXEL_PNG_IMAGE] }),
    (error) => {
      assert.equal(error.code, 'server')
      assert.match(error.message, /first\(timeout\) → second\(server\)/)
      assert.equal(error.message.includes(secret), false, 'API Key 绝不允许出现在错误信息里')
      assert.match(error.message, /\*\*\*\*/)
      return true
    },
  )
  assert.deepEqual(calls.map((item) => item.providerId), ['first', 'second'])
})

test('Model fallback: 不可重试的错误立刻停链，不再拖着后面的供应商陪跑', async () => {
  const { company, gateway, registry } = await bench('model-stop')
  const ErrorClass = await gatewayErrorClass(gateway)
  const calls = []
  await company.upsertModelProvider({ id: 'strict', type: 'vision', provider: 'openai-compatible', model: 'm1', baseUrl: 'https://a.invalid/v1', enabled: true })
  await company.upsertModelProvider({ id: 'never', type: 'vision', provider: 'gemini', model: 'm2', baseUrl: 'https://b.invalid/v1', enabled: true })

  registry.adapters.set('openai-compatible', stubAdapter('openai-compatible', () => { throw new ErrorClass('invalid-input', '这张图的格式该供应商不支持') }, calls))
  registry.adapters.set('gemini', stubAdapter('gemini', () => ({ text: '{"description":"不该被调用"}' }), calls))

  await assert.rejects(() => gateway.analyzeVision({ images: [PIXEL_PNG_IMAGE] }), /这张图的格式该供应商不支持/)
  assert.deepEqual(calls.map((item) => item.providerId), ['strict'], 'invalid-input 不在可重试白名单里，必须当场停')
})

test('Model fallback: 员工绑定的优先级说了算，绑到不存在的供应商如实标 missing', async () => {
  const { company, evolution, gateway, registry } = await bench('model-priority')
  await company.upsertModelProvider({ id: 'cheap', type: 'vision', provider: 'openai-compatible', model: 'm-cheap', baseUrl: 'https://cheap.invalid/v1', enabled: true })
  await company.upsertModelProvider({ id: 'strong', type: 'vision', provider: 'gemini', model: 'm-strong', baseUrl: 'https://strong.invalid/v1', enabled: true })
  registry.adapters.set('openai-compatible', stubAdapter('openai-compatible', () => ({ text: 'x' }), []))
  registry.adapters.set('gemini', stubAdapter('gemini', () => ({ text: 'x' }), []))

  // 公司级顺序是 cheap 在前；阿搜把 strong 绑成第一优先级，他自己的链就该反过来。
  await evolution.bindModel('search-specialist', { capability: 'vision', providerId: 'strong', priority: 1 })
  const chain = await gateway.router.resolve('vision', 'search-specialist')
  assert.deepEqual(chain.map((item) => [item.config.id, item.bound]), [['strong', true], ['cheap', false]])

  const companyChain = await gateway.router.resolve('vision')
  assert.deepEqual(companyChain.map((item) => item.config.id), ['cheap', 'strong'], '不带员工时走公司级顺序')

  // 绑定指向一个已经被删掉的供应商：不能假装还能用。
  await evolution.bindModel('search-specialist', { capability: 'vision', providerId: 'deleted-provider', priority: 1 })
  const afterGhost = await gateway.router.resolve('vision', 'search-specialist')
  assert.equal(afterGhost.some((item) => item.config.id === 'deleted-provider'), false)
  const ghost = (await evolution.modelBindings('search-specialist')).find((item) => item.providerId === 'deleted-provider')
  assert.equal(ghost.status, 'missing')
})

test('Model fallback: 配置类失败不算员工技能失败，执行类失败才写失败证据', async () => {
  const { evolution, gateway } = await bench('model-usage')
  await evolution.bindModel('search-specialist', { capability: 'vision', providerId: 'primary', priority: 1 })

  // 缺密钥是老板的配置问题：只把绑定标 missing，不往员工头上记一笔失败。
  await gateway.recordVisionUsage({ employeeId: 'search-specialist', providerId: 'primary', success: false, code: 'missing-key' })
  assert.deepEqual(await evolution.evidence('search-specialist'), [])
  assert.equal((await evolution.modelBindings('search-specialist'))[0].status, 'missing')

  // 真正跑挂了（服务端 500）才算一次失败证据。
  await gateway.recordVisionUsage({ employeeId: 'search-specialist', providerId: 'primary', model: 'm-primary', success: false, code: 'server', durationMs: 1200 })
  const failures = await evidenceOf(evolution)
  assert.equal(failures.length, 1)
  assert.equal(failures[0].success, false)
  assert.equal(failures[0].tool, 'vision_analyze')

  // 成功一次：写成功证据 + 把绑定恢复成 available。
  await gateway.recordVisionUsage({ employeeId: 'search-specialist', providerId: 'primary', model: 'm-primary', success: true, durationMs: 900 })
  const all = await evidenceOf(evolution)
  assert.equal(all.length, 2)
  assert.equal(all.filter((item) => item.success).length, 1)
  assert.equal((await evolution.modelBindings('search-specialist'))[0].status, 'available')

  const skill = (await evolution.skills('search-specialist')).find((item) => item.name === '视觉理解')
  assert.ok(skill, '视觉使用记录应当落到「视觉理解」这项技能上')
  assert.equal(skill.successes, 1)
  assert.equal(skill.failures, 1)
})

async function evidenceOf(evolution) {
  return evolution.evidence('search-specialist', { limit: 50 })
}
