// 需求文档五十八条第 8 项：Company Event reducer。
//
// 被测口径来自需求文档三十二 / 三十三 / 三十四 + 五十九条禁止事项：
//   · 办公室状态只能由真实 CompanyEvent 推出来，reducer 必须是纯函数：同样的事件必然同样的结果；
//   · 绝不读系统时钟、绝不 tick、绝不随机走动 —— 没有事件的员工永远待在工位；
//   · 事件乱序 / 重复投递都要得到同一份状态；
//   · 前台未读要在同一会话真的回过之后才消失，不是定时清理。
import test from 'node:test'
import assert from 'node:assert/strict'

const { reduceCompanyRuntime, emptyCompanyRuntime, CompanyEventBus, SESSION_CHANNEL } = await import('../lib/index.js')

const T = 1_787_000_000_000
const at = (offset) => T + offset

test('Company Event reducer: 没有事件就全员待在工位，reducer 不读时钟也不随机', () => {
  const roster = ['secretary', 'tech-lead', 'developer']
  const first = reduceCompanyRuntime([], { employeeIds: roster })

  assert.deepEqual(Object.keys(first.employees).sort(), [...roster].sort(), '名册里的人零事件也要有一份状态')
  for (const id of roster) {
    assert.deepEqual(first.employees[id], {
      employeeId: id, status: 'idle', station: 'desk', activity: '工位待命',
      task: null, tool: null, meeting: null, vision: null, pluginInstall: null,
      block: null, lastSkill: null, lastOutcome: null, pending: 0, notices: [], updatedAt: 0,
    })
  }
  assert.equal(first.eventCount, 0)
  assert.equal(first.updatedAt, 0, '没有事件就没有时间，绝不能填 Date.now()')

  // 纯函数：同样输入必然同样输出（跑两次之间隔了真实时间，状态一动不动 = 没有 tick）
  const second = reduceCompanyRuntime([], { employeeIds: roster })
  assert.deepEqual(second, first)

  const empty = emptyCompanyRuntime()
  assert.deepEqual(empty.employees, {})
  assert.deepEqual(empty.reception, { notices: [], unread: 0, lastAt: 0 })
  assert.equal(empty.updatedAt, 0)
})

test('Company Event reducer: 任务生命周期 —— 派活 / 开工 / 交付 / 卡住', () => {
  const assigned = reduceCompanyRuntime([
    { id: 'e1', type: 'task.assigned', at: at(1), employeeId: 'developer', taskId: 't1', title: '修构建', source: 'web' },
  ])
  assert.equal(assigned.employees.developer.status, 'working')
  assert.equal(assigned.employees.developer.pending, 1)
  assert.equal(assigned.employees.developer.activity, '已接活 1 个，准备开工')
  assert.equal(assigned.employees.developer.task, null, '还没开工就不该有进行中的任务')

  const started = reduceCompanyRuntime([
    { id: 'e1', type: 'task.assigned', at: at(1), employeeId: 'developer', taskId: 't1', title: '修构建' },
    { id: 'e2', type: 'task.started', at: at(2), employeeId: 'developer', taskId: 't1', title: '修构建' },
  ])
  assert.equal(started.employees.developer.pending, 0, '开工后不该还挂在待办里')
  assert.deepEqual(started.employees.developer.task, { id: 't1', title: '修构建', startedAt: at(2), tool: undefined })
  assert.equal(started.employees.developer.activity, '处理任务：修构建')
  assert.equal(started.employees.developer.station, 'desk')

  const done = reduceCompanyRuntime([
    { id: 'e2', type: 'task.started', at: at(2), employeeId: 'developer', taskId: 't1', title: '修构建' },
    { id: 'e3', type: 'task.completed', at: at(3), employeeId: 'developer', taskId: 't1', outcome: 'success', summary: '改了配置' },
  ])
  assert.equal(done.employees.developer.status, 'done')
  assert.equal(done.employees.developer.task, null)
  assert.equal(done.employees.developer.lastOutcome, 'success')
  assert.equal(done.employees.developer.activity, '已交付：修构建')
  assert.equal(done.updatedAt, at(3), 'updatedAt 只能来自事件自己的 at')

  const stuck = reduceCompanyRuntime([
    { id: 'e2', type: 'task.started', at: at(2), employeeId: 'developer', taskId: 't1', title: '修构建' },
    { id: 'e4', type: 'task.blocked', at: at(4), employeeId: 'developer', taskId: 't1', reason: '缺少数据库口令' },
  ])
  assert.equal(stuck.employees.developer.status, 'blocked')
  assert.deepEqual(stuck.employees.developer.block, { taskId: 't1', reason: '缺少数据库口令', at: at(4) })
  assert.equal(stuck.employees.developer.lastOutcome, 'blocked')
  assert.equal(stuck.employees.developer.activity, '任务卡住：缺少数据库口令')
})

test('Company Event reducer: 位置优先级固定，员工只因真实事件离开工位', () => {
  const base = [
    { id: 'a1', type: 'task.started', at: at(1), employeeId: 'tech-lead', taskId: 't1', title: '排期' },
    { id: 'a2', type: 'tool.started', at: at(2), employeeId: 'tech-lead', callId: 'c1', tool: 'Bash' },
  ]
  const working = reduceCompanyRuntime(base)
  assert.equal(working.employees['tech-lead'].station, 'desk')
  assert.equal(working.employees['tech-lead'].activity, '执行命令中', '工具文案由映射表推导，不许现编')
  assert.equal(working.employees['tech-lead'].tool.name, 'Bash')

  const vision = reduceCompanyRuntime([...base, { id: 'a3', type: 'vision.started', at: at(3), employeeId: 'tech-lead', callId: 'v1', mode: 'ui', images: 2 }])
  assert.equal(vision.employees['tech-lead'].status, 'vision')
  assert.equal(vision.employees['tech-lead'].station, 'media-lab', '识图要去多媒体工作台')
  assert.equal(vision.employees['tech-lead'].activity, '多媒体工作台 · 识图中（ui）')

  const installing = reduceCompanyRuntime([...base,
    { id: 'a3', type: 'vision.started', at: at(3), employeeId: 'tech-lead', callId: 'v1', mode: 'ui' },
    { id: 'a4', type: 'plugin.install.started', at: at(4), employeeId: 'tech-lead', pluginName: 'stable-diffusion', pluginId: 'sd' },
  ])
  assert.equal(installing.employees['tech-lead'].status, 'installing')
  assert.equal(installing.employees['tech-lead'].station, 'server-room', '装插件要去机房')
  assert.equal(installing.employees['tech-lead'].activity, '服务器机房 · 安装插件 stable-diffusion')

  const meeting = reduceCompanyRuntime([...base,
    { id: 'a4', type: 'plugin.install.started', at: at(4), employeeId: 'tech-lead', pluginName: 'sd' },
    { id: 'a5', type: 'meeting.started', at: at(5), meetingId: 'm1', participants: ['tech-lead', 'developer'], topic: 'V2 方案' },
  ])
  assert.equal(meeting.employees['tech-lead'].status, 'meeting')
  assert.equal(meeting.employees['tech-lead'].station, 'meeting', '会议优先级最高')
  assert.equal(meeting.employees.developer.station, 'meeting', '参会的人都要进会议室')
  assert.equal(meeting.employees['tech-lead'].activity, '在会议室讨论：V2 方案')
  assert.deepEqual(Object.keys(meeting.meetings), ['m1'])

  // 会开完就回工位；工具跑完就不再显示在忙
  const after = reduceCompanyRuntime([...base,
    { id: 'a5', type: 'meeting.started', at: at(5), meetingId: 'm1', participants: ['tech-lead', 'developer'], topic: 'V2 方案' },
    { id: 'a6', type: 'meeting.finished', at: at(6), meetingId: 'm1', summary: '定了' },
    { id: 'a7', type: 'tool.completed', at: at(7), employeeId: 'tech-lead', callId: 'c1', tool: 'Bash', ok: true },
  ])
  assert.deepEqual(after.meetings, {})
  assert.equal(after.employees['tech-lead'].station, 'desk')
  assert.equal(after.employees['tech-lead'].activity, '处理任务：排期')
  assert.equal(after.employees.developer.station, 'desk')
  assert.equal(after.employees.developer.status, 'idle', '散会后没别的事就回到工位待命')
})

test('Company Event reducer: 乱序与重复投递得到同一份状态', () => {
  const ordered = [
    { id: 'x1', type: 'task.started', at: at(10), employeeId: 'doc', taskId: 't9', title: '写文档' },
    { id: 'x2', type: 'tool.started', at: at(20), employeeId: 'doc', callId: 'c9', tool: 'write' },
    { id: 'x3', type: 'tool.completed', at: at(30), employeeId: 'doc', callId: 'c9', tool: 'write', ok: true },
    { id: 'x4', type: 'task.completed', at: at(40), employeeId: 'doc', taskId: 't9', outcome: 'success' },
  ]
  const shuffled = [ordered[3], ordered[1], ordered[0], ordered[2], { ...ordered[1] }, { ...ordered[3] }]

  const a = reduceCompanyRuntime(ordered)
  const b = reduceCompanyRuntime(shuffled)
  assert.deepEqual(b, a, '乱序 + 重复投递必须和顺序投递结果完全一致')
  assert.equal(a.eventCount, 4)
  assert.equal(b.eventCount, 4, '同 id 只能算一条')
  assert.equal(a.employees.doc.status, 'done')
  assert.equal(a.updatedAt, at(40))
})

test('Company Event reducer: 前台未读要等同一会话真的回过才消失', () => {
  const events = [
    { id: 'r1', type: 'message.received', at: at(1), platform: 'feishu', conversationId: 'oc_dev', preview: '构建挂了', senderName: '老板', targetEmployeeId: 'tech-lead' },
    { id: 'r2', type: 'message.received', at: at(2), platform: 'feishu', conversationId: 'oc_ops', preview: '服务器告警', senderName: '运维' },
  ]
  const pending = reduceCompanyRuntime(events)
  assert.equal(pending.reception.unread, 2)
  assert.equal(pending.reception.lastAt, at(2))
  assert.equal(pending.employees['tech-lead'].notices.length, 1, '点名的消息要挂到那位员工头上')
  assert.equal(pending.employees['tech-lead'].notices[0].preview, '构建挂了')
  assert.equal(pending.employees['tech-lead'].status, 'idle', '收到消息本身不等于开工')

  const replied = reduceCompanyRuntime([
    ...events,
    { id: 'r3', type: 'message.sent', at: at(3), platform: 'feishu', conversationId: 'oc_dev', employeeId: 'tech-lead', preview: '我看下' },
  ])
  assert.equal(replied.reception.unread, 1, '回过的会话未读要消失')
  assert.equal(replied.reception.notices[0].conversationId, 'oc_ops')
  assert.deepEqual(replied.employees['tech-lead'].notices, [], '员工头上的提示也要一起清掉')

  // 未读上限：只保留最近 N 条，不会无限堆积
  const many = Array.from({ length: 10 }, (_, index) => ({
    id: `m${index}`, type: 'message.received', at: at(index), platform: 'qq', conversationId: `c${index}`, preview: `第 ${index} 条`,
  }))
  const capped = reduceCompanyRuntime(many, { noticeLimit: 3 })
  assert.equal(capped.reception.unread, 3)
  assert.deepEqual(capped.reception.notices.map((item) => item.preview), ['第 7 条', '第 8 条', '第 9 条'])
})

test('Company Event reducer: 插件与技能只反映真实发生过的事', () => {
  const discovered = reduceCompanyRuntime([
    { id: 'p1', type: 'plugin.discovered', at: at(1), employeeId: 'image-creator', pluginName: 'stable-diffusion', pluginId: 'sd', source: 'dsh-market' },
  ])
  assert.deepEqual(discovered.discoveredPlugins, [{ pluginName: 'stable-diffusion', pluginId: 'sd', source: 'dsh-market', at: at(1) }])
  assert.equal(discovered.employees['image-creator'].status, 'idle', '只是看见了插件，不算在装')

  const installed = reduceCompanyRuntime([
    { id: 'p1', type: 'plugin.discovered', at: at(1), employeeId: 'image-creator', pluginName: 'stable-diffusion', pluginId: 'sd' },
    { id: 'p2', type: 'plugin.install.started', at: at(2), employeeId: 'image-creator', pluginName: 'stable-diffusion', pluginId: 'sd' },
    { id: 'p3', type: 'plugin.installed', at: at(3), employeeId: 'image-creator', pluginName: 'stable-diffusion', pluginId: 'sd', ok: true },
    { id: 'p4', type: 'skill.updated', at: at(4), employeeId: 'image-creator', skillName: 'AI 出图', skillId: 's1', level: 3, source: 'evidence' },
  ])
  assert.deepEqual(installed.discoveredPlugins, [], '装完了就不该还挂在待发现列表里')
  assert.equal(installed.employees['image-creator'].pluginInstall, null)
  assert.equal(installed.employees['image-creator'].station, 'desk', '装完回工位')
  assert.deepEqual(installed.employees['image-creator'].lastSkill, { name: 'AI 出图', level: 3, at: at(4) })

  // 安装失败：不许从待发现列表里抹掉，也不许伪造成已学会
  const failed = reduceCompanyRuntime([
    { id: 'p1', type: 'plugin.discovered', at: at(1), pluginName: 'stable-diffusion', pluginId: 'sd' },
    { id: 'p2', type: 'plugin.install.started', at: at(2), employeeId: 'image-creator', pluginName: 'stable-diffusion', pluginId: 'sd' },
    { id: 'p3', type: 'plugin.installed', at: at(3), employeeId: 'image-creator', pluginName: 'stable-diffusion', pluginId: 'sd', ok: false },
  ])
  assert.equal(failed.discoveredPlugins.length, 1)
  assert.equal(failed.employees['image-creator'].pluginInstall, null)
  assert.equal(failed.employees['image-creator'].lastSkill, null, '装失败不许留下任何技能痕迹')
})

test('Company Event reducer: 未知事件类型被忽略，不会把状态带歪', () => {
  const runtime = reduceCompanyRuntime([
    { id: 'k1', type: 'task.started', at: at(1), employeeId: 'pm', taskId: 't1', title: '写需求' },
    { id: 'k2', type: 'employee.wandered', at: at(2), employeeId: 'pm' },
    { id: '', type: 'task.completed', at: at(3), employeeId: 'pm', taskId: 't1', outcome: 'success' },
  ])
  assert.equal(runtime.eventCount, 2, '没有 id 的事件直接丢弃')
  assert.equal(runtime.employees.pm.status, 'working')
  assert.equal(runtime.employees.pm.activity, '处理任务：写需求')
})

test('CompanyEventBus: 多通道合并、幂等替换、快照引用稳定', () => {
  const bus = new CompanyEventBus()
  let notified = 0
  const unsubscribe = bus.subscribe(() => { notified += 1 })

  bus.setEmployeeIds(['secretary', 'developer'])
  assert.deepEqual(Object.keys(bus.snapshot().employees).sort(), ['developer', 'secretary'])
  assert.equal(notified, 1)

  const first = bus.snapshot()
  assert.equal(bus.snapshot(), first, '没有新事件时快照必须是同一个引用，否则 React 会死循环')

  // 会话通道：客户端每次重算都全量替换
  const sessionEvents = [{ id: 's1', type: 'task.started', at: at(1), employeeId: 'developer', taskId: 't1', title: '写代码' }]
  bus.setChannel(SESSION_CHANNEL, sessionEvents)
  assert.equal(notified, 2)
  assert.equal(bus.snapshot().employees.developer.status, 'working')

  // 内容没变 → 一次都不许通知
  bus.setChannel(SESSION_CHANNEL, [{ ...sessionEvents[0] }])
  assert.equal(notified, 2, '幂等替换不能触发重渲染')

  // host 侧通道（插件运行时 / 通讯层）与会话通道合并
  bus.publish({ id: 'h1', type: 'plugin.install.started', at: at(2), employeeId: 'developer', pluginName: 'sd' }, 'host')
  assert.equal(notified, 3)
  const merged = bus.snapshot()
  assert.equal(merged.employees.developer.station, 'server-room')
  assert.equal(bus.events().length, 2, '两个通道的事件要合并成一条流')

  // 同一条事件重复 publish 不算数
  bus.publish({ id: 'h1', type: 'plugin.install.started', at: at(2), employeeId: 'developer', pluginName: 'sd' }, 'host')
  assert.equal(notified, 3)

  bus.clearChannel('host')
  assert.equal(bus.snapshot().employees.developer.station, 'desk', '清掉 host 通道后只剩会话事件')
  assert.equal(bus.events().length, 1)

  bus.reset()
  assert.equal(bus.events().length, 0)
  assert.deepEqual(Object.keys(bus.snapshot().employees).sort(), ['developer', 'secretary'], '名册在 reset 之后仍然在工位上')

  unsubscribe()
  bus.publish({ id: 'h2', type: 'task.started', at: at(3), employeeId: 'developer', taskId: 't2', title: '再来一次' })
  assert.equal(notified, 5, '退订之后不该再收到通知')
})

test('CompanyEventBus: 单个订阅者抛错不许拖垮整条总线', () => {
  const bus = new CompanyEventBus()
  const seen = []
  bus.subscribe(() => { throw new Error('渲染炸了') })
  bus.subscribe(() => seen.push('ok'))
  bus.publish({ id: 'z1', type: 'task.started', at: at(1), employeeId: 'doc', taskId: 't1', title: '写文档' })
  assert.deepEqual(seen, ['ok'])
  assert.equal(bus.snapshot().employees.doc.status, 'working')
})
