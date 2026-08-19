import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function source(path) { return readFile(new URL(`../${path}`, import.meta.url), 'utf8') }

test('2.0 架构：生产业务主链不再注册 staff_chat / staff_meeting', async () => {
  const files = [
    'src/host-v2.ts',
    'src/host-v3.ts',
    'src/collaboration/work-orchestrator.ts',
    'src/integrations/im/work-router.ts',
  ]
  for (const file of files) {
    const text = await source(file)
    assert.equal(/name:\s*['"]staff_chat['"]/.test(text), false, `${file} 不应再注册 staff_chat`)
    assert.equal(/name:\s*['"]staff_meeting['"]/.test(text), false, `${file} 不应再注册 staff_meeting`)
    assert.equal(/当前主 Agent|秘书\s*=\s*主 Agent/.test(text), false, `${file} 不应残留秘书主 Agent 语义`)
  }
})

test('2.0 架构：Host 只把 IM dispatcher 接到 Work Orchestrator', async () => {
  const host = await source('src/host-v3.ts')
  assert.match(host, /communication\.setDispatcher\(orchestrator/)
  assert.doesNotMatch(host, /core\.dispatch\(\{\s*employeeId:\s*['"]secretary/)
})

test('2.0 架构：Employee Runtime 自身不承担业务选人', async () => {
  const core = await source('src/host-v2.ts')
  assert.doesNotMatch(core, /planWorkgroup|scoreEmployee|allowedEmployeeIds|defaultTarget/)
  assert.match(core, /dispatch\(input: StaffDispatchInput\)/)
})

test('2.0 文案：公司工作台刷新不再让秘书当数据代理', async () => {
  const view = await source('src/client-v9/company-view.tsx')
  assert.doesNotMatch(view, /由秘书调用|秘书会返回|秘书.*Company Snapshot/)
  assert.match(view, /请调用 company_snapshot/)
})
