// 对抗式复审第二轮遗留的三个洞（S2 / S4a / S5a）的回归测试。
// 每条都先造出「修复前会通过」的攻击输入，断言现在被挡住。
import test from 'node:test'
import assert from 'node:assert/strict'

const lib = await import('../lib/index.js')

// ---------------------------------------------------------------------------
// S2：审批钉住了版本，安装命令却不钉 → 会装成 latest
// 批的是 foo@1.0.0，披露卡片给老板看的也是 1.0.0，实际装 latest = 批的和装的不是同一个东西。
// ---------------------------------------------------------------------------

// 绝不写「未导出就跳过」的分支：那样测试会在真正失效时依然变绿。
// 这两个符号是安全边界原语，拿不到就应当让整个测试文件失败。
assert.equal(typeof lib.assertCommandTargetsPackage, 'function', 'assertCommandTargetsPackage 必须从包入口导出，否则安全边界无法被验证')
assert.equal(typeof lib.createWriteGate, 'function', 'createWriteGate 必须从包入口导出，否则写闸门契约无法被验证')

test('S2: 批准钉住版本时，不指定版本的安装命令必须被拒', () => {
  const fn = lib.assertCommandTargetsPackage
  // 修复前：wanted 有值但 target.version 为空 → 不进比对分支 → 放行
  assert.throws(
    () => fn('npm install foo', 'foo@1.0.0'),
    /没有指定版本|latest/,
    '批准 foo@1.0.0 却执行 npm install foo，必须拒绝',
  )
  // 版本一致仍然放行
  assert.doesNotThrow(() => fn('npm install foo@1.0.0', 'foo@1.0.0'))
  // 版本不一致继续拒绝
  assert.throws(() => fn('npm install foo@2.0.0', 'foo@1.0.0'), /不一致/)
  // 批准未钉版本时，命令带不带版本都不该因为这条规则被拒
  assert.doesNotThrow(() => fn('npm install foo', 'foo'))
})

// ---------------------------------------------------------------------------
// S4a：appId/appSecret 解析失败时，verificationToken 根本不会被读出来，
// 于是 token 校验静默消失，handleEvent warn 一次后永久放行伪造事件。
// ---------------------------------------------------------------------------

function ctxWith() {
  const tools = []
  return {
    tools: { register: (tool) => tools.push(tool), list: () => tools.map((t) => t.name) },
    logger: { warn() {}, info() {}, error() {} },
    effect: (fn) => fn(),
    _tools: tools,
  }
}

function feishuMessageEvent(token) {
  const payload = {
    header: { event_type: 'im.message.receive_v1', event_id: 'evt_forged' },
    event: {
      sender: { sender_id: { open_id: 'ou_boss' } },
      message: {
        message_id: 'om_forged', chat_id: 'oc_dev', chat_type: 'group', message_type: 'text',
        create_time: '1787000000000', content: JSON.stringify({ text: '伪造的老板指令' }),
      },
    },
  }
  if (token !== undefined) payload.token = token
  return payload
}

test('S4a: appSecret 缺失时 verificationToken 仍然生效，伪造事件被拒', async () => {
  process.env.DSH_TEST_FS_TOKEN = 'the-real-token'
  const manager = lib.registerCommunication(ctxWith(), {
    communication: {
      adapters: [{
        id: 'feishu', platform: 'feishu', enabled: true, connectionMode: 'webhook',
        // 故意不注入 appId/appSecret —— 修复前这会让 ensureCredentials 直接 return null，
        // verificationToken 永远不被解析，整条校验消失。
        credentials: { appId: 'env:DSH_TEST_ABSENT_ID', appSecret: 'env:DSH_TEST_ABSENT_SECRET', verificationToken: 'env:DSH_TEST_FS_TOKEN' },
        access: { actors: [{ userId: 'ou_boss', role: 'owner' }], conversations: [{ conversationId: 'oc_dev' }] },
      }],
    },
  })
  const adapter = manager.feishuAdapter()
  assert.ok(adapter, '应当装配出 FeishuAdapter')

  const captured = []
  adapter.onMessage((m) => captured.push(m))

  // 不带 token 的伪造事件：必须丢弃
  assert.deepEqual(await adapter.handleEvent(feishuMessageEvent(undefined)), { ok: false })
  // token 错误：必须丢弃
  assert.deepEqual(await adapter.handleEvent(feishuMessageEvent('wrong-token')), { ok: false })
  assert.equal(captured.length, 0, '伪造事件一条都不许进入消息流')

  // token 正确：正常放行
  const ok = await adapter.handleEvent(feishuMessageEvent('the-real-token'))
  assert.equal(ok.ok, true)
  assert.equal(captured.length, 1, 'token 正确的事件应当正常归一化')

  await manager.stop?.()
  delete process.env.DSH_TEST_FS_TOKEN
})

test('S4a: 既无 token 也无 encryptKey 时，handleEvent 一律 fail-closed', async () => {
  const manager = lib.registerCommunication(ctxWith(), {
    communication: {
      adapters: [{
        id: 'feishu', platform: 'feishu', enabled: true, connectionMode: 'webhook',
        credentials: { appId: 'env:DSH_TEST_ABSENT_ID', appSecret: 'env:DSH_TEST_ABSENT_SECRET' },
        access: { actors: [{ userId: 'ou_boss', role: 'owner' }], conversations: [{ conversationId: 'oc_dev' }] },
      }],
    },
  })
  const adapter = manager.feishuAdapter()
  const captured = []
  adapter.onMessage((m) => captured.push(m))

  // 修复前：warn 一次后放行，且 url_verification 还能被用来探测端点是否存在。
  assert.deepEqual(await adapter.handleEvent({ type: 'url_verification', challenge: 'probe' }), { ok: false })
  assert.deepEqual(await adapter.handleEvent(feishuMessageEvent(undefined)), { ok: false })
  // 连续多次都必须继续拒绝，不能因为 warn 去重就变成放行
  assert.deepEqual(await adapter.handleEvent(feishuMessageEvent(undefined)), { ok: false })
  assert.equal(captured.length, 0, '无法验真的事件一条都不许进入消息流')

  await manager.stop?.()
})

test('S4a: 显式 allowUnverifiedEvents 才放行，且必须是显式 true', async () => {
  const make = (options) => {
    const manager = lib.registerCommunication(ctxWith(), {
      communication: {
        adapters: [{
          id: 'feishu', platform: 'feishu', enabled: true, connectionMode: 'webhook',
          credentials: { appId: 'env:DSH_TEST_ABSENT_ID', appSecret: 'env:DSH_TEST_ABSENT_SECRET' },
          access: { actors: [{ userId: 'ou_boss', role: 'owner' }], conversations: [{ conversationId: 'oc_dev' }] },
          options,
        }],
      },
    })
    return manager
  }
  // 真值但不是 true（例如字符串）不算显式开启
  const loose = make({ allowUnverifiedEvents: 'yes' })
  assert.deepEqual(await loose.feishuAdapter().handleEvent({ type: 'url_verification', challenge: 'x' }), { ok: false })
  await loose.stop?.()

  const explicit = make({ allowUnverifiedEvents: true })
  assert.deepEqual(await explicit.feishuAdapter().handleEvent({ type: 'url_verification', challenge: 'x' }), { ok: true, challenge: 'x' })
  await explicit.stop?.()
})

// ---------------------------------------------------------------------------
// S5a：写闸门的真实能力边界。
// DSH 子代理 API 不接受工具白名单，所以只读渠道是「事后观测 + 拦掉结果」，
// 不是预防式拦截。这条测试把该契约钉死，避免以后有人误以为它能预防。
// ---------------------------------------------------------------------------

test('S5a: 写闸门契约本身可用，但明确是事后拦截而非预防', () => {
  const gate = lib.createWriteGate(false)
  assert.equal(gate.allowed, false)
  assert.equal(gate.isWriteTool('file_write'), true)
  assert.equal(gate.isWriteTool('read_file'), false)
  // assert() 会 throw 并记账
  assert.throws(() => gate.assert('file_write'), /只读/)
  assert.ok(gate.denied.includes('file_write'))
  // filterTools 会真剔除
  assert.deepEqual(gate.filterTools(['read_file', 'file_write', 'bash']), ['read_file'])

  // 允许写的闸门不拦
  const open = lib.createWriteGate(true)
  assert.doesNotThrow(() => open.assert('file_write'))
  assert.deepEqual(open.filterTools(['read_file', 'file_write']), ['read_file', 'file_write'])
})
