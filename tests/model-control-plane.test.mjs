// Settings Control Plane / Milestone A 回归：
// 1. 浏览器写端点可以新增/编辑模型，且编辑安全摘要不会把未下发字段静默抹掉；
// 2. “设为默认”真的改变 CompanyStore 的兜底顺序；
// 3. 删除供应商不级联抹掉员工历史绑定；
// 4. UI RPC 仍然不能写入明文密钥。
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { scratch } from './_helpers.mjs'

const { EvolutionStore, CompanyStore, writeEndpoints } = await import('../lib/index.js')

async function fixture(name) {
  const dir = await scratch(name)
  const store = new EvolutionStore(join(dir, 'evolution.json'))
  const company = new CompanyStore(store, join(dir, 'company.json'))
  const core = {
    store,
    company,
    roster: [{ id: 'developer', name: '小刘', role: '程序员' }],
  }
  return { store, company, endpoints: writeEndpoints({ core }) }
}

test('Model Control Plane: 新增/编辑会持久化，编辑缺失字段保持原值', async () => {
  const { company, endpoints } = await fixture('model-control-upsert')
  const upsert = endpoints['models/upsert']

  await upsert({ provider: {
    id: 'text-main', type: 'text', provider: 'openai-compatible', model: 'model-v1',
    baseUrl: 'https://example.invalid/v1', apiKeyRef: 'env:MODEL_KEY', timeout: 12345, enabled: true,
  } })

  // 模拟浏览器编辑表单：安全摘要没有 timeout，所以这里只提交它真实知道的字段。
  await upsert({ provider: {
    id: 'text-main', type: 'text', provider: 'openai-compatible', model: 'model-v2', enabled: true,
  } })

  const row = (await company.modelProviders('text'))[0]
  assert.equal(row.model, 'model-v2')
  assert.equal(row.baseUrl, 'https://example.invalid/v1', '未提交的 baseUrl 应保持原值')
  assert.equal(row.apiKeyRef, 'env:MODEL_KEY', '未提交的 SecretRef 应保持原值')
  assert.equal(row.timeout, 12345, '未提交的 timeout 应保持原值')
})

test('Model Control Plane: 设为默认会改变同类型 fallback 顺序', async () => {
  const { company, endpoints } = await fixture('model-control-default')
  const upsert = endpoints['models/upsert']
  await upsert({ provider: { id: 'text-a', type: 'text', provider: 'openai-compatible', model: 'a', enabled: true } })
  await upsert({ provider: { id: 'vision-a', type: 'vision', provider: 'gemini', model: 'vision', enabled: true } })
  await upsert({ provider: { id: 'text-b', type: 'text', provider: 'custom', model: 'b', enabled: true } })

  assert.deepEqual((await company.modelProviders('text')).map((row) => row.id), ['text-a', 'text-b'])
  await endpoints['models/setDefault']({ providerId: 'text-b' })
  assert.deepEqual((await company.modelProviders('text')).map((row) => row.id), ['text-b', 'text-a'])
  assert.deepEqual((await company.modelProviders('vision')).map((row) => row.id), ['vision-a'], '其它能力类型顺序不能被改坏')
})

test('Model Control Plane: 禁用供应商不能设为默认', async () => {
  const { endpoints } = await fixture('model-control-disabled-default')
  await endpoints['models/upsert']({ provider: { id: 'text-off', type: 'text', provider: 'custom', model: 'off', enabled: false } })
  await assert.rejects(() => endpoints['models/setDefault']({ providerId: 'text-off' }), /已禁用/)
})

test('Model Control Plane: 删除供应商保留员工历史绑定', async () => {
  const { store, endpoints } = await fixture('model-control-remove')
  await endpoints['models/upsert']({ provider: { id: 'text-main', type: 'text', provider: 'openai-compatible', model: 'main', enabled: true } })
  await endpoints['models/bind']({ employeeId: 'developer', capability: 'text', providerId: 'text-main' })
  assert.equal((await store.modelBindings('developer'))[0].providerId, 'text-main')

  await endpoints['models/remove']({ providerId: 'text-main' })
  const bindings = await store.modelBindings('developer')
  assert.equal(bindings.length, 1)
  assert.equal(bindings[0].providerId, 'text-main', '历史绑定要留下，Router 后续才能把它标成 missing')
})

test('Model Control Plane: /org-panel 写端点继续拒绝明文 API Key', async () => {
  const { endpoints } = await fixture('model-control-secret')
  await assert.rejects(
    () => endpoints['models/upsert']({ provider: {
      id: 'bad', type: 'text', provider: 'openai-compatible', model: 'bad', apiKey: 'sk-raw-secret', enabled: true,
    } }),
    /raw secret/i,
  )
})
