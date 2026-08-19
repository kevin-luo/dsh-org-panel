// @xmanrui/dsh-im 可选桥回归：
// - 不 import 第三方包，只走 DSH connection.rpc；
// - 微信 / QQ / 飞书统一归一成同一个 Provider contract；
// - 扫码、手动凭证、verify / delete 等敏感动作必须发送精确 payload；
// - 第三方频道不存在不能被伪装成“未配置”。
import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const V9 = resolve(HERE, '..', 'src', 'client-v9')
const nodeRequire = createRequire(join(HERE, '..', 'package.json'))
const cache = new Map()

function resolveFile(from, spec) {
  const base = resolve(dirname(from), spec)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  throw new Error(`cannot resolve ${spec} from ${from}`)
}

function loadTs(file) {
  if (cache.has(file)) return cache.get(file)
  const output = ts.transpileModule(readFileSync(file, 'utf-8'), {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const box = { exports: {} }
  cache.set(file, box.exports)
  const req = (spec) => spec.startsWith('.') ? loadTs(resolveFile(file, spec)) : nodeRequire(spec)
  new Function('module', 'exports', 'require', output)(box, box.exports, req)
  cache.set(file, box.exports)
  return box.exports
}

const Rpc = loadTs(join(V9, 'rpc.ts'))
const Bridge = loadTs(join(V9, 'dsh-im-bridge.ts'))

test('cross-plugin RPC: /weixin 是独立频道，不会被硬编码成 /org-panel', async () => {
  const calls = []
  const rpc = {
    async call(channel, endpoint, payload) {
      calls.push({ channel, endpoint, payload })
      return { ok: true, value: { hello: 'world' } }
    },
  }
  const result = await Rpc.callRpcChannel(rpc, '/weixin', 'connection.status', {})
  assert.equal(result.state, 'ok')
  assert.deepEqual(calls, [{ channel: '/weixin', endpoint: 'connection.status', payload: {} }])
})

test('dsh-im Weixin: public status 归一化且不需要任何第三方 runtime import', async () => {
  const rpc = {
    async call(channel, endpoint) {
      assert.equal(channel, '/weixin')
      assert.equal(endpoint, 'connection.status')
      return { ok: true, value: {
        state: 'connected', revision: 7,
        totals: { configured: 1, connected: 1 },
        bots: [{
          botId: 'wx-1', connected: true, state: 'connected', workspace: '/tmp/project',
          bot: { name: '微信机器人', accountIdMasked: 'wxid_***123' },
          health: { summary: '微信连接正常' },
          stats: { messagesReceived: 8, messagesReplied: 7 },
        }],
      } }
    },
  }
  const outcome = await Bridge.probeDshIm(rpc, 'weixin')
  assert.equal(outcome.state, 'ok')
  assert.equal(outcome.value.connected, 1)
  assert.equal(outcome.value.accounts[0].name, '微信机器人')
  assert.equal(outcome.value.accounts[0].messagesReceived, 8)
})

test('dsh-im Weixin: 扫码/配对码/删除 payload 与公开 RPC 契约一致', async () => {
  const calls = []
  const rpc = {
    async call(channel, endpoint, payload) {
      calls.push({ channel, endpoint, payload })
      if (endpoint === 'provision.begin') return { ok: true, value: {
        attemptId: 'attempt-1', status: 'pending', expiresAt: Date.now() + 60_000,
        pollIntervalMs: 1000, qrCodeDataUrl: 'data:image/png;base64,AAAA',
      } }
      if (endpoint === 'provision.verify') return { ok: true, value: {
        attemptId: 'attempt-1', status: 'connecting', expiresAt: Date.now() + 60_000, pollIntervalMs: 1000,
      } }
      return { ok: true, value: {} }
    },
  }
  const actions = Bridge.createDshImWeixinActions(rpc)
  const started = await actions.begin()
  assert.equal(started.status, 'pending')
  await actions.verify('attempt-1', '123456')
  await actions.remove('wx-1')

  assert.deepEqual(calls[0], { channel: '/weixin', endpoint: 'provision.begin', payload: { locale: 'zh-CN' } })
  assert.deepEqual(calls[1], { channel: '/weixin', endpoint: 'provision.verify', payload: { attemptId: 'attempt-1', verifyCode: '123456' } })
  assert.deepEqual(calls[2], { channel: '/weixin', endpoint: 'bot.delete', payload: { botId: 'wx-1', confirm: true } })
})

test('dsh-im QQ: 扫码 + 手动凭证共用统一 Provider，并严格走 /qq', async () => {
  const calls = []
  const rpc = {
    async call(channel, endpoint, payload) {
      calls.push({ channel, endpoint, payload })
      if (endpoint === 'provision.begin') return { ok: true, value: {
        attemptId: 'qq-attempt', status: 'refreshing', expiresAt: Date.now() + 60_000,
        pollIntervalMs: 1200, qrCodeDataUrl: 'data:image/png;base64,AAAA',
      } }
      if (endpoint === 'bot.bind-credentials') return { ok: true, value: {
        revision: 2,
        bots: [{ botId: 'qq-1', connected: true, state: 'connected', bot: { name: 'QQ机器人', appIdMasked: '12***89' }, health: { summary: '正常' } }],
        totals: { configured: 1, connected: 1 },
      } }
      return { ok: true, value: {} }
    },
  }
  const actions = Bridge.createDshImChannelActions(rpc, 'qq')
  const started = await actions.begin()
  assert.equal(started.status, 'pending', 'QQ refreshing 属于继续等待二维码，不得显示失败')
  const connected = await actions.bindCredentials('123456', 'top-secret')
  assert.equal(connected.connected, 1)
  assert.equal(connected.accounts[0].name, 'QQ机器人')
  assert.deepEqual(calls[0], { channel: '/qq', endpoint: 'provision.begin', payload: { locale: 'zh-CN' } })
  assert.deepEqual(calls[1], { channel: '/qq', endpoint: 'bot.bind-credentials', payload: { appId: '123456', appSecret: 'top-secret' } })
})

test('dsh-im Feishu: connection.status 的二维码没有 status 字段时使用外层 provisioning 状态', () => {
  const status = Bridge.normalizeDshImStatus('feishu', {
    state: 'provisioning',
    revision: 3,
    bots: [], totals: { configured: 0, connected: 0 },
    provisioning: {
      attemptId: 'fs-attempt',
      qrCodeDataUrl: 'data:image/png;base64,AAAA',
      verificationUrl: 'https://open.feishu.cn/example',
      expiresAt: Date.now() + 60_000,
      pollIntervalMs: 1800,
    },
  })
  assert.equal(status.provisioning.status, 'pending')
  assert.equal(status.provisioning.attemptId, 'fs-attempt')
})

test('dsh-im Feishu: 扫码和已有 App 凭证端点与公开 contract 一致', async () => {
  const calls = []
  const rpc = {
    async call(channel, endpoint, payload) {
      calls.push({ channel, endpoint, payload })
      if (endpoint === 'provision.begin') return { ok: true, value: {
        status: 'pending', provisioning: {
          attemptId: 'fs-attempt', qrCodeDataUrl: 'data:image/png;base64,AAAA', expiresAt: Date.now() + 60_000, pollIntervalMs: 1800,
        },
      } }
      if (endpoint === 'bot.bind-credentials') return { ok: true, value: {
        state: 'connected', connected: true, configured: true,
        botId: 'legacy-default', bot: { name: '飞书机器人', appIdMasked: 'cli_***' }, health: { summary: '长连接运行正常' },
      } }
      return { ok: true, value: {} }
    },
  }
  const actions = Bridge.createDshImChannelActions(rpc, 'feishu')
  assert.equal((await actions.begin()).status, 'pending')
  const bound = await actions.bindCredentials('cli_123', 'secret-value')
  assert.equal(bound.connected, 1)
  assert.deepEqual(calls[0], { channel: '/feishu', endpoint: 'provision.begin', payload: { locale: 'zh-CN' } })
  assert.deepEqual(calls[1], { channel: '/feishu', endpoint: 'bot.bind-credentials', payload: { appId: 'cli_123', appSecret: 'secret-value' } })
})

test('dsh-im: root.snapshot 形状也能归一化，兼容 QQ public client contract', () => {
  const result = Bridge.normalizeDshImStatus('qq', {
    snapshot: {
      revision: 9,
      bots: [{ botId: 'qq-9', connected: false, state: 'offline', bot: { name: 'QQ九号' }, health: { summary: '离线' } }],
      totals: { configured: 1, connected: 0 },
    },
  })
  assert.equal(result.configured, 1)
  assert.equal(result.accounts[0].botId, 'qq-9')
})

test('dsh-im Weixin: 第三方频道不存在时返回 unavailable，不伪造成 0 个账号', async () => {
  const rpc = { async call() { throw new Error('HTTP 404') } }
  const outcome = await Bridge.probeDshIm(rpc, 'weixin')
  assert.equal(outcome.state, 'unavailable')
  assert.match(outcome.message, /\/weixin/)
})

test('dsh-im Weixin: 非法配对码在发 RPC 前被拒绝', async () => {
  let called = false
  const rpc = { async call() { called = true; return { ok: true, value: {} } } }
  const actions = Bridge.createDshImWeixinActions(rpc)
  await assert.rejects(() => actions.verify('attempt-1', '12ab'), /4～8/)
  assert.equal(called, false)
})

test('dsh-im: 工作区必须是绝对路径，非法值不得发 RPC', async () => {
  let called = false
  const rpc = { async call() { called = true; return { ok: true, value: {} } } }
  const actions = Bridge.createDshImChannelActions(rpc, 'qq')
  await assert.rejects(() => actions.setWorkspace('qq-1', 'relative/project'), /绝对路径/)
  assert.equal(called, false)
})
