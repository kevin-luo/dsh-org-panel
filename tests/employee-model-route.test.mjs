import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { scratch } from './_helpers.mjs'

const { apply } = await import('../lib/index.js')

async function bench(name, providers = [
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'openai', name: 'OpenAI' },
]) {
  const dir = await scratch(name)
  const registered = new Map()
  const starts = []
  const ctx = {
    tools: {
      register(tool) { registered.set(tool.name, tool) },
      list() { return [...registered.values()].map((item) => ({ name: item.name, description: item.description })) },
    },
    subagents: {
      list: () => ['spawn'],
      getProvider: (provider) => provider === 'spawn' ? { name: provider } : undefined,
      async start(provider, options) {
        starts.push({ provider, options })
        return {
          id: `run-${starts.length}`,
          result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: `done-${starts.length}` }] }),
          async dispose() {},
        }
      },
    },
    llm: { listProviders: () => providers },
    systemPrompt: { section() {} },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    on() {},
  }
  const host = apply(ctx, {
    memoryFile: join(dir, 'evolution.json'),
    companyFile: join(dir, 'company.json'),
    workSessionFile: join(dir, 'work-sessions.json'),
    approvalsFile: join(dir, 'plugin-approvals.json'),
    healthCheckOnStart: false,
  })
  assert.ok(host)
  host.core.bindAgent({ session: { id: 'root-session' } })
  return { host, starts }
}

test('员工文本模型：显式绑定真实 DSH route 会进入 subagents.start agentOptions', async () => {
  const { host, starts } = await bench('employee-model-route-explicit')
  await host.core.company.upsertModelProvider({
    id: 'coder-main', type: 'text', provider: 'custom', dshProvider: 'deepseek', model: 'deepseek-v3', enabled: true,
  })
  await host.core.store.bindModel('developer', { capability: 'text', providerId: 'coder-main', priority: 1 })

  const result = await host.core.dispatch({ employeeId: 'developer', text: '内部工作上下文', taskTitle: '修复登录问题', source: 'web' })
  assert.equal(result.ok, true)
  assert.deepEqual(starts[0].options.agentOptions, { provider: 'deepseek', model: 'deepseek-v3' })
  assert.deepEqual(result.model, { providerId: 'coder-main', dshProvider: 'deepseek', model: 'deepseek-v3', bound: true })

  const tasks = await host.core.store.tasks('developer')
  assert.equal(tasks[0].title, '修复登录问题')
  assert.deepEqual(tasks[0].models, ['deepseek/deepseek-v3'])
  const binding = (await host.core.store.modelBindings('developer')).find((item) => item.providerId === 'coder-main')
  assert.equal(binding.status, 'available', '真实 route 存在后绑定状态应由 missing 自动恢复 available')
  await host()
})

test('员工文本模型：两名员工可以真实使用不同 provider/model，不共享一个主 Agent 模型', async () => {
  const { host, starts } = await bench('employee-model-route-different')
  await host.core.company.upsertModelProvider({ id: 'coder', type: 'text', provider: 'custom', dshProvider: 'deepseek', model: 'deepseek-code', enabled: true })
  await host.core.company.upsertModelProvider({ id: 'writer', type: 'text', provider: 'custom', dshProvider: 'openai', model: 'gpt-writer', enabled: true })
  await host.core.store.bindModel('developer', { capability: 'text', providerId: 'coder', priority: 1 })
  await host.core.store.bindModel('social-editor', { capability: 'text', providerId: 'writer', priority: 1 })

  await host.core.dispatch({ employeeId: 'developer', text: '写代码', taskTitle: '实现接口', source: 'web' })
  await host.core.dispatch({ employeeId: 'social-editor', text: '写内容', taskTitle: '写发布文案', source: 'web' })

  assert.deepEqual(starts.map((item) => item.options.agentOptions), [
    { provider: 'deepseek', model: 'deepseek-code' },
    { provider: 'openai', model: 'gpt-writer' },
  ])
  await host()
})

test('员工文本模型：配置了不存在的 DSH route 时如实 missing，并继承 DSH 默认模型', async () => {
  const { host, starts } = await bench('employee-model-route-missing', [{ id: 'deepseek', name: 'DeepSeek' }])
  await host.core.company.upsertModelProvider({ id: 'ghost-model', type: 'text', provider: 'custom', dshProvider: 'ghost', model: 'ghost-v1', enabled: true })
  await host.core.store.bindModel('developer', { capability: 'text', providerId: 'ghost-model', priority: 1, status: 'available' })

  const result = await host.core.dispatch({ employeeId: 'developer', text: '继续工作', taskTitle: '真实降级测试', source: 'web' })
  assert.equal(result.ok, true, 'route 不存在不应伪造成员工无法工作；应继承当前 DSH 默认模型')
  assert.equal(starts[0].options.agentOptions, undefined)
  assert.equal(result.model, undefined)
  const binding = (await host.core.store.modelBindings('developer')).find((item) => item.providerId === 'ghost-model')
  assert.equal(binding.status, 'missing')
  const tasks = await host.core.store.tasks('developer')
  assert.deepEqual(tasks[0].models, [], '没有真实生效的员工模型时履历不能写一个假的模型名')
  await host()
})

test('员工文本模型：无显式绑定时按公司文本供应商顺序兜底，且标明 bound=false', async () => {
  const { host, starts } = await bench('employee-model-route-fallback')
  await host.core.company.upsertModelProvider({ id: 'company-default', type: 'text', provider: 'custom', dshProvider: 'openai', model: 'gpt-company', enabled: true })

  const result = await host.core.dispatch({ employeeId: 'researcher', text: '做调研', taskTitle: '行业调研', source: 'web' })
  assert.equal(result.ok, true)
  assert.deepEqual(starts[0].options.agentOptions, { provider: 'openai', model: 'gpt-company' })
  assert.equal(result.model.bound, false)
  assert.equal(result.model.providerId, 'company-default')
  await host()
})
