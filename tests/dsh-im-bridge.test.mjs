// @xmanrui/dsh-im 可选桥回归：
// - 不 import 第三方包，只走 DSH connection.rpc；
// - /weixin 状态与扫码响应按 public contract 归一化；
// - verify / delete 等敏感动作必须发送精确 payload；
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
