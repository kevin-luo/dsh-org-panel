#!/usr/bin/env node
// 「/org-panel 频道到底有没有挂上」的真机验收脚本。
//
// 为什么单独放一个脚本、而**不**塞进 npm test：它需要一台真的跑着的 dsh web。
// CI 上没有，塞进去只会让 CI 天天红，然后大家学会无视红灯 —— 那比没有这条检查更糟。
//
// 它存在的理由是一次真实事故：插件的 RPC 频道在真实 DSH 上从来没被挂成 HTTP 路由，
// 而 175 个单测全绿。单测能守住的是「代码按我们理解的宿主形态工作」，
// 守不住的是「我们对宿主形态的理解本身就是错的」（当时把 webServer 记成了 httpServer）。
// 后者只有真机能证伪。
//
// 用法：
//   dsh web --port 7788 &
//   node scripts/verify-dsh-channel.mjs            # 默认 127.0.0.1:7788
//   node scripts/verify-dsh-channel.mjs 3080
//
// 判读口径（这套 405/404 的区别是这次排障的关键，别改）：
//   405 = 请求落到了 SPA 静态兜底 handler（它只认 GET）→ **这条路径根本没有注册成路由**
//   404 = 请求进了 connection 的频道 handler，只是 endpoint 不认识 → 路由是挂上的
//   200 = 频道通了
import process from 'node:process'

const port = process.argv[2] ?? '7788'
const base = `http://127.0.0.1:${port}`

/** 一个肯定不存在的路径。它的状态码就是本机「未注册路由」的基准值。 */
const ABSENT_PATH = `/dsh-org-panel-absent-${Date.now().toString(36)}`

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, text }
}

const failures = []
function check(ok, label, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

console.log(`dsh-org-panel: 验收 ${base} 上的 /org-panel RPC 频道`)

let absent
try {
  absent = await post(ABSENT_PATH, {})
} catch (error) {
  console.error(`连不上 ${base}：${error instanceof Error ? error.message : String(error)}`)
  console.error('先起一个真实 DSH：dsh web --port ' + port)
  process.exit(2)
}
console.log(`  基准：不存在的路径 ${ABSENT_PATH} → ${absent.status}（这就是「没有注册」长什么样）`)

// 1. 频道路径必须不同于「未注册」的基准值。
const snapshot = await post('/org-panel/company/snapshot', {
  type: 'client-request',
  rpcId: 'verify-dsh-channel',
  method: 'company/snapshot',
  payload: {},
})
check(
  snapshot.status !== absent.status,
  `/org-panel/company/snapshot 已注册为 HTTP 路由`,
  `状态码 ${snapshot.status}（未注册时会是 ${absent.status}）`,
)
check(snapshot.status === 200, '频道应答 200', `实际 ${snapshot.status}`)

// 2. 返回体必须是真实台账，不是空壳。
let payload
try {
  payload = JSON.parse(snapshot.text)
} catch {
  check(false, '返回体是合法 JSON', snapshot.text.slice(0, 120))
}
if (payload) {
  check(payload.type === 'server-response', 'RPC 信封形状正确', `type=${payload.type}`)
  check(payload.result?.ok === true, '业务结果 ok:true', JSON.stringify(payload.result?.error ?? {}).slice(0, 160))
  const employees = payload.result?.value?.employees
  check(Array.isArray(employees) && employees.length > 0, '名册非空（设置中心不会再显示「尚未读到员工名册」）', `employees=${Array.isArray(employees) ? employees.length : typeof employees}`)
}

// 3. 未知 endpoint 也必须走到我们的分发器（bad-request），而不是掉进静态兜底。
const unknown = await post('/org-panel/does/not-exist', {
  type: 'client-request',
  rpcId: 'verify-dsh-channel-unknown',
  method: 'does/not-exist',
  payload: {},
})
let unknownBody
try { unknownBody = JSON.parse(unknown.text) } catch { /* 下面按 undefined 判 */ }
check(
  unknownBody?.result?.ok === false && unknownBody.result.error?.code === 'bad-request',
  '未知 endpoint 由我们的分发器如实回 bad-request',
  `status=${unknown.status} body=${unknown.text.slice(0, 120)}`,
)

console.log('')
if (failures.length) {
  console.error(`验收失败：${failures.length} 项`)
  console.error('若状态码与基准值相同（多半是 405），说明 /org-panel 压根没被注册成路由 ——')
  console.error('去看 host 日志里 dsh-org-panel 的那行 warn，它会点名缺的是哪个 cordis 服务。')
  process.exit(1)
}
console.log('验收通过：/org-panel 频道在真实 DSH 上已挂载且返回真实台账。')
