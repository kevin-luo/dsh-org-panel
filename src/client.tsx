// 「纯牛马」正式 DSH 插件 —— client 半边（纯 client，免 RPC）
// 编译：pnpm build（见 README）。产物 lib/client.js 由 package.json 的 dsh.client 声明接入。
import { createElement, useState, useEffect, useRef } from 'react'

const CSS = `
.dsh-org { height: 100%; overflow-y: auto; box-sizing: border-box; padding: 18px 22px 30px; color: var(--dsw-alias-label-primary); font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.dsh-org-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.dsh-org-title { font-size: 16px; font-weight: 650; }
.dsh-org-sub { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-org-stats { font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dsh-org-boss { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 16px; }
.dsh-org-boss-emoji { width: 34px; height: 34px; border-radius: 9px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); display: flex; align-items: center; justify-content: center; font-size: 18px; flex: none; }
.dsh-org-boss-bubble { padding: 9px 13px; border-radius: 12px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-left: 3px solid var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; max-width: 92%; }
.dsh-org-body { display: flex; gap: 16px; align-items: flex-start; }
.dsh-org-main { flex: 1; min-width: 0; }
.dsh-org-side { width: 280px; flex: none; position: sticky; top: 0; }
.dsh-org-section-title { font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); margin-bottom: 10px; letter-spacing: .02em; }
.dsh-org-empty { text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 14px; border: 1px dashed var(--dsw-alias-border-l1); border-radius: 10px; margin-bottom: 12px; }
.dsh-org-staff { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.dsh-org-staff-card { position: relative; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; padding: 13px 12px 11px; background: var(--dsw-alias-bg-layer-1); cursor: pointer; transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease; display: flex; flex-direction: column; gap: 9px; }
.dsh-org-staff-card:hover { transform: translateY(-3px); box-shadow: 0 8px 22px rgba(0,0,0,0.12); }
.dsh-org-staff-card.running { border-color: var(--dsw-alias-brand-primary); }
.dsh-org-staff-card.done { border-color: var(--dsw-alias-state-success-primary); }
.dsh-org-staff-card.error { border-color: var(--dsw-alias-state-error-primary); }
.dsh-org-staff-top { display: flex; align-items: center; gap: 10px; }
.dsh-org-staff-emoji { width: 42px; height: 42px; border-radius: 12px; background: var(--dsw-alias-bg-layer-2); display: flex; align-items: center; justify-content: center; font-size: 24px; flex: none; }
.dsh-org-staff-id { flex: 1; min-width: 0; }
.dsh-org-staff-name { font-size: 14px; font-weight: 650; }
.dsh-org-staff-role { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-org-chip { font-size: 11px; padding: 0 7px; border-radius: 999px; border: 1px solid currentColor; line-height: 18px; flex: none; }
.dsh-org-staff-bubble { font-size: 12px; line-height: 1.5; padding: 7px 10px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-org-staff-hint { font-size: 10px; color: var(--dsw-alias-label-secondary); text-align: center; opacity: .8; }
.dsh-org-task { border-top: 1px dashed var(--dsw-alias-border-l1); padding-top: 8px; }
.dsh-org-task-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.dsh-org-task-desc { font-size: 12px; font-weight: 600; line-height: 1.4; flex: 1; min-width: 0; word-break: break-word; }
.dsh-org-task-lead { font-size: 11px; color: var(--dsw-alias-label-primary); line-height: 1.5; margin-top: 5px; }
.dsh-org-task-points { margin-top: 4px; }
.dsh-org-task-point { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.dsh-org-task-meta { font-size: 10px; color: var(--dsw-alias-label-secondary); margin-top: 5px; opacity: .85; }
.dsh-org-progress { height: 4px; border-radius: 2px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; margin-top: 6px; }
.dsh-org-progress-bar { height: 100%; width: 40%; border-radius: 2px; background: var(--dsw-alias-brand-primary); animation: dsh-org-progress 1.2s ease-in-out infinite; }
@keyframes dsh-org-progress { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
.dsh-org-chat-panel { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; background: var(--dsw-alias-bg-layer-1); height: 460px; max-height: 460px; }
.dsh-org-chat-head { padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); text-align: center; }
.dsh-org-chat-title { font-weight: 650; font-size: 13px; color: var(--dsw-alias-label-primary); }
.dsh-org-chat-notice { display: block; font-weight: 400; font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.dsh-org-chat-body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-base); }
.dsh-org-sys { align-self: center; font-size: 11px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); padding: 2px 9px; border-radius: 999px; }
.dsh-org-chat-msg { display: flex; align-items: flex-end; gap: 6px; }
.dsh-org-chat-msg.me { flex-direction: row-reverse; }
.dsh-org-chat-avatar { width: 28px; height: 28px; border-radius: 7px; display: flex; align-items: center; justify-content: center; font-size: 16px; background: var(--dsw-alias-bg-layer-2); flex: none; }
.dsh-org-chat-wrap { max-width: 74%; display: flex; flex-direction: column; }
.dsh-org-chat-msg.me .dsh-org-chat-wrap { align-items: flex-end; }
.dsh-org-chat-name { font-size: 10px; color: var(--dsw-alias-label-secondary); margin: 0 4px 2px; }
.dsh-org-chat-bubble { padding: 6px 10px; border-radius: 10px; font-size: 12px; line-height: 1.5; word-break: break-word; }
.dsh-org-chat-msg.me .dsh-org-chat-bubble { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); border-bottom-right-radius: 2px; }
.dsh-org-chat-msg.them .dsh-org-chat-bubble { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-bottom-left-radius: 2px; }
.dsh-org-modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 1100; display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.dsh-org-modal { width: 380px; max-width: 92vw; max-height: 80vh; overflow-y: auto; border-radius: 16px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); box-shadow: 0 20px 60px rgba(0,0,0,0.28); }
.dsh-org-modal-head { display: flex; align-items: center; gap: 12px; padding: 16px 16px 12px; }
.dsh-org-modal-emoji { width: 56px; height: 56px; border-radius: 16px; background: var(--dsw-alias-bg-layer-1); display: flex; align-items: center; justify-content: center; font-size: 32px; flex: none; }
.dsh-org-modal-id { flex: 1; min-width: 0; }
.dsh-org-modal-name { font-size: 16px; font-weight: 650; }
.dsh-org-modal-role { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.dsh-org-modal-close { margin-left: auto; cursor: pointer; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 18px; padding: 4px 8px; border-radius: 6px; }
.dsh-org-modal-close:hover { background: var(--dsw-alias-bg-layer-1); }
.dsh-org-modal-body { padding: 0 16px 16px; }
.dsh-org-modal-intro { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); margin-bottom: 12px; }
.dsh-org-modal-label { font-size: 11px; font-weight: 650; color: var(--dsw-alias-label-secondary); margin: 10px 0 6px; }
.dsh-org-modal-tools { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-org-tool { font-size: 11px; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; padding: 2px 8px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }
.dsh-org-skill-row { font-size: 12px; padding: 6px 0; border-bottom: 1px dashed var(--dsw-alias-border-l1); }
.dsh-org-skill-row:last-child { border-bottom: none; }
.dsh-org-skill-name { font-weight: 600; }
.dsh-org-skill-desc { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.45; margin-top: 2px; }
.dsh-org-note { font-size: 12px; color: var(--dsw-alias-label-secondary); padding: 8px 0; }
`

// 岗位 → 能力（内联映射，替代 host 端实时枚举）。
// 如需「实时枚举生态工具/技能」，保留 host 半边 + typert @Remote RPC（见 README「进阶」）。
type SkillDef = { name: string; desc: string }
const ROLES: Array<{ id: string; tools: string[]; skills: SkillDef[] }> = [
  { id: 'tech-lead', tools: ['subagent', 'subagent_fork', 'workflow', 'ralph', 'send_message', 'list_agents', 'create_goal', 'get_goal', 'update_goal', 'todo_write'], skills: [{ name: '多智能体调度', desc: '拆解任务、指派下级、盯进度' }] },
  { id: 'developer', tools: ['bash', 'pwsh', 'edit', 'write', 'grep', 'glob', 'read_image', 'job_list'], skills: [{ name: '工程实现', desc: '写代码、改文件、跑命令' }] },
  { id: 'pm', tools: ['ask_user_question'], skills: [{ name: '需求分析', desc: '梳理需求、向用户提问确认' }] },
  { id: 'researcher', tools: ['web_search', 'web_fetch'], skills: [{ name: '情报调研', desc: '联网搜索、查竞品、写报告' }] },
  { id: 'platform', tools: ['cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine', 'cordis_inspect_list'], skills: [{ name: 'Cordis 插件开发', desc: '定义/运行/检查动态插件与扩展' }] },
  { id: 'doc', tools: ['read', 'skill'], skills: [{ name: '文档与知识库', desc: '读写文档、整理资料、加载技能' }] },
]

const STAFF = [
  { id: 'tech-lead', name: '老王', role: '技术经理', emoji: '👔', intro: '团队的大脑，负责拆任务、调人手、盯进度，出了事他扛。',
    lines: { idle: ['摸会儿鱼，等老板派活', '盯着排期发呆', '今天谁点奶茶？'], running: ['收到！这就拆任务分配下去', '大家按排期来，别慌', '进度我盯着'], done: ['团队交付了，漂亮', '活儿干完，可以松口气'], wait: ['老板，这方向得你拍板', '资源不够，等你批预算'] } },
  { id: 'developer', name: '小刘', role: '程序员', emoji: '💻', intro: '码农本农，能写会改，最怕的就是需求变更。',
    lines: { idle: ['等需求，先刷会儿代码', 'IDE 开着，假装很忙'], running: ['收到，开写！', '这需求怎么又变了…', '在写了在写了，别催'], done: ['搞定，测试过了', '交付！谁请奶茶'], wait: ['接口还没给我，卡住了', '编译报错，等个环境'] } },
  { id: 'pm', name: '阿明', role: '产品经理', emoji: '📋', intro: '天天想需求、写 PRD，老板的传声筒，背锅侠。',
    lines: { idle: ['想下一个需求', '和用户聊聊反馈'], running: ['需求我理好了，发群里', '这个功能老板要的，加一下'], done: ['PRD 写完了', '需求落地了'], wait: ['老板，这个优先级你定', '用户反馈等确认'] } },
  { id: 'researcher', name: '小丽', role: '市场调研', emoji: '🔎', intro: '情报担当，搜竞品、查资料、写报告，消息最灵。',
    lines: { idle: ['逛会儿论坛找素材', '等调研任务'], running: ['正在搜竞品情报', '查到几条关键信息'], done: ['调研报告出来了', '情报整理好了'], wait: ['搜索方向要确认下'] } },
  { id: 'platform', name: '大壮', role: '平台工程师', emoji: '🛠', intro: '管环境、装插件、搞扩展，闷头干大事。',
    lines: { idle: ['插件环境守着', '等部署任务'], running: ['环境在部署了', '插件装好了'], done: ['环境就绪', '扩展上线'], wait: ['权限要开通下'] } },
  { id: 'doc', name: '静静', role: '文档专员', emoji: '📖', intro: '知识库守门人，写文档、理资料、记笔记。',
    lines: { idle: ['整理文档库', '等写作任务'], running: ['文档写着呢', '资料整理中'], done: ['文档更新好了', '手册写完了'], wait: ['缺素材，等资料'] } },
]

const CHAT = [
  { who: '小刘', emoji: '💻', me: false, text: '@阿明 需求又改了？' },
  { who: '阿明', emoji: '📋', me: false, text: '@小刘 老板要的，加一下' },
  { who: '大壮', emoji: '🛠', me: false, text: '环境我部署好了，谁测一下' },
  { who: '小丽', emoji: '🔎', me: false, text: '查到一个关键竞品动态' },
  { who: '静静', emoji: '📖', me: false, text: '文档同步到知识库了' },
  { who: '老板', emoji: '👑', me: true, text: '这周的活都盯紧点' },
  { who: '老王', emoji: '👔', me: false, text: '大家按排期来，别乱' },
  { who: '小刘', emoji: '💻', me: false, text: '改到第 18 版了，谁懂' },
  { who: '老板', emoji: '👑', me: true, text: '今晚交付，辛苦大家' },
  { who: '大壮', emoji: '🛠', me: false, text: '插件版本升了，注意兼容' },
  { who: '静静', emoji: '📖', me: false, text: '需求文档我归档好了' },
  { who: '小丽', emoji: '🔎', me: false, text: '竞品报告发群里了' },
]

const STAFF_STATUS: Record<string, { label: string; color: string }> = {
  running: { label: '干活中', color: 'var(--dsw-alias-brand-primary)' },
  done: { label: '已交付', color: 'var(--dsw-alias-state-success-primary)' },
  wait: { label: '卡住了', color: 'var(--dsw-alias-state-error-primary)' },
  idle: { label: '待命中', color: 'var(--dsw-alias-label-secondary)' },
}

function clip(s: unknown, n: number): string {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

function extractText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const b of blocks as Array<{ text?: unknown }>) {
    if (b && typeof b.text === 'string' && b.text.trim()) parts.push(b.text)
  }
  return parts.join('\n').trim()
}

function parseArgs(raw: string): Record<string, any> {
  try { return JSON.parse(raw) } catch { return {} }
}

function collectRequests(nodes: any[]): string[] {
  const out: string[] = []
  for (const n of nodes) {
    if (n.kind === 'user') {
      const t = extractText(n.content)
      if (t) out.push(t)
    }
  }
  return out
}

function summarizeResult(text: string): { lead: string; points: string[] } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return { lead: '', points: [] }
  const lead = clip(lines[0], 90)
  const points: string[] = []
  for (let i = 1; i < lines.length && points.length < 4; i++) {
    const l = lines[i]
    if (/^[-*•]|\d+[.)]/.test(l)) points.push(clip(l.replace(/^[-*•\s]+/, '').replace(/^\d+[.)]\s*/, ''), 70))
  }
  if (points.length === 0) for (let i = 1; i < lines.length && points.length < 4; i++) points.push(clip(lines[i], 70))
  return { lead, points }
}

type Delegation = { callId: string; tool: string; desc: string; running: boolean; isError: boolean; lead: string; points: string[]; startTime: number | null; endTime: number | null; duration: number | null }

function extractDelegations(nodes: any[], runningCalls: any[]): Delegation[] {
  const calls: Record<string, { name: string; args: Record<string, any>; startTime?: number }> = {}
  const results: Record<string, { text: string; isError: boolean; endTime?: number }> = {}
  for (const n of nodes) {
    if (n.kind === 'assistant' && Array.isArray(n.blocks)) {
      for (const b of n.blocks as any[]) {
        if (b && b.kind === 'tool-call' && b.callId) calls[b.callId] = { name: b.name, args: parseArgs(b.argsRaw), startTime: n.time }
      }
    } else if (n.kind === 'tool-result') {
      results[n.callId] = { text: extractText(n.content), isError: !!n.isError, endTime: n.time }
      if (n.call && !calls[n.callId]) calls[n.callId] = { name: n.call.name, args: parseArgs(n.call.argsRaw) }
    }
  }
  for (const rc of runningCalls as any[]) {
    if (!calls[rc.callId]) calls[rc.callId] = { name: rc.name, args: parseArgs(rc.argsRaw), startTime: rc.time }
  }
  const out: Delegation[] = []
  for (const callId in calls) {
    const c = calls[callId]
    if (c.name !== 'subagent' && c.name !== 'subagent_fork' && c.name !== 'workflow') continue
    const res = results[callId]
    const desc = c.name === 'workflow' ? (c.args?.meta?.name || '工作流任务') : (c.args?.description || c.args?.prompt || '')
    const running = !res
    const summary = res ? summarizeResult(res.text) : { lead: '', points: [] }
    out.push({
      callId, tool: c.name, desc: desc || '(未命名任务)', running,
      isError: res ? res.isError : false, lead: summary.lead, points: summary.points,
      startTime: c.startTime || null, endTime: res ? res.endTime : null,
      duration: (c.startTime && res && res.endTime) ? (res.endTime - c.startTime) : null,
    })
  }
  return out
}

function guessRoleId(label: string): string {
  const l = label.toLowerCase()
  if (/代码|写|实现|开发|编程|修|bug|接口|前端|后端|测试|命令|脚本/.test(l)) return 'developer'
  if (/调研|搜索|查|情报|分析|市场|竞品|联网|抓取|资料/.test(l)) return 'researcher'
  if (/需求|文案|方案|产品|设计|prd|提问|决策/.test(l)) return 'pm'
  if (/部署|插件|环境|配置|cordis|扩展|集成|平台|安装/.test(l)) return 'platform'
  if (/文档|知识|整理|手册|读写|技能/.test(l)) return 'doc'
  return 'tech-lead'
}

function staffNameOf(id: string): string {
  for (const s of STAFF) if (s.id === id) return s.name
  return '员工'
}

function roleOf(id: string): { tools: string[]; skills: SkillDef[] } {
  for (const r of ROLES) if (r.id === id) return r
  return { tools: [], skills: [] }
}

function tasksFor(id: string, delegations: Delegation[]): Delegation[] {
  return delegations.filter((d) => guessRoleId(d.desc) === id)
}

function statusFromTasks(tasks: Delegation[]): string {
  if (tasks.some((t) => t.running)) return 'running'
  if (tasks.some((t) => t.isError)) return 'wait'
  if (tasks.some((t) => !t.running && !t.isError)) return 'done'
  return 'idle'
}

function lineOf(staff: any, status: string, tick: number): string {
  const arr = staff.lines[status] || staff.lines.idle
  if (!arr || arr.length === 0) return ''
  return arr[tick % arr.length]
}

function formatDuration(ms: number | null): string {
  if (ms == null || isNaN(ms)) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return s + ' 秒'
  const m = Math.floor(s / 60)
  if (m < 60) return m + ' 分 ' + (s % 60) + ' 秒'
  return Math.floor(m / 60) + ' 小时'
}

function formatAgo(time: number | null): string {
  if (time == null) return ''
  const ms = Date.now() - time
  if (ms < 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return m + ' 分钟前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时前'
  return Math.floor(h / 24) + ' 天前'
}

function bossLine(requests: string[], delegations: Delegation[]): string {
  if (delegations.length === 0) return requests.length > 0 ? '收到需求，我先想想怎么拆。' : '还没接到需求，都先歇着。'
  const req = requests.length > 0 ? clip(requests[requests.length - 1], 40) : ''
  const running = delegations.filter((d) => d.running)
  const done = delegations.filter((d) => !d.running && !d.isError)
  const error = delegations.filter((d) => d.isError)
  const parts = [`收到需求${req ? '「' + req + '」' : ''}，拆了 ${delegations.length} 个活`]
  if (running.length) parts.push(running.length + ' 个在干：' + running.map((d) => staffNameOf(guessRoleId(d.desc)) + '·' + clip(d.desc, 12)).join('、'))
  if (done.length) parts.push(done.length + ' 个已交付：' + done.map((d) => staffNameOf(guessRoleId(d.desc)) + '·' + clip(d.desc, 12)).join('、'))
  if (error.length) parts.push(error.length + ' 个卡住：' + error.map((d) => staffNameOf(guessRoleId(d.desc)) + '·' + clip(d.desc, 12)).join('、'))
  return parts.join('；')
}

function systemEvents(delegations: Delegation[]): string[] {
  const events: string[] = []
  if (delegations.length) events.push('👑 老板派了 ' + delegations.length + ' 个活')
  for (const d of delegations) {
    if (!d.running && !d.isError) events.push('✅ ' + staffNameOf(guessRoleId(d.desc)) + ' 交付了：' + clip(d.desc, 16))
    else if (d.isError) events.push('⚠️ ' + staffNameOf(guessRoleId(d.desc)) + ' 卡住了：' + clip(d.desc, 16))
  }
  return events
}

function BossBubble(props: { text: string }) {
  return createElement('div', { className: 'dsh-org-boss' },
    createElement('span', { className: 'dsh-org-boss-emoji' }, '👑'),
    createElement('div', { className: 'dsh-org-boss-bubble' }, props.text),
  )
}

function TaskRow(props: { task: Delegation }) {
  const t = props.task
  const st = t.running
    ? { label: '干活中', color: 'var(--dsw-alias-brand-primary)' }
    : t.isError ? { label: '卡住了', color: 'var(--dsw-alias-state-error-primary)' }
    : { label: '已交付', color: 'var(--dsw-alias-state-success-primary)' }
  const meta: string[] = []
  if (!t.running && t.duration) meta.push('用时 ' + formatDuration(t.duration))
  else if (!t.running && t.endTime) meta.push(formatAgo(t.endTime))
  else if (t.running && t.startTime) meta.push(formatAgo(t.startTime) + ' 开始')
  return createElement('div', { className: 'dsh-org-task' },
    createElement('div', { className: 'dsh-org-task-head' },
      createElement('span', { className: 'dsh-org-task-desc' }, t.desc),
      createElement('span', { className: 'dsh-org-chip', style: { color: st.color } }, st.label),
    ),
    t.running ? createElement('div', { className: 'dsh-org-progress' }, createElement('div', { className: 'dsh-org-progress-bar' })) : null,
    t.lead ? createElement('div', { className: 'dsh-org-task-lead' }, t.lead) : null,
    t.points.length ? createElement('div', { className: 'dsh-org-task-points' }, t.points.map((p, i) => createElement('div', { className: 'dsh-org-task-point', key: i }, '· ' + p))) : null,
    meta.length ? createElement('div', { className: 'dsh-org-task-meta' }, meta.join(' · ')) : null,
  )
}

function StaffCard(props: { staff: any; tasks: Delegation[]; status: string; tick: number; index: number; onOpen: (s: any) => void }) {
  const { staff, tasks, status, tick, index, onOpen } = props
  const st = STAFF_STATUS[status] || STAFF_STATUS.idle
  return createElement('div', { className: 'dsh-org-staff-card ' + status, onClick: () => onOpen(staff) },
    createElement('div', { className: 'dsh-org-staff-top' },
      createElement('span', { className: 'dsh-org-staff-emoji' }, staff.emoji),
      createElement('div', { className: 'dsh-org-staff-id' },
        createElement('div', { className: 'dsh-org-staff-name' }, staff.name),
        createElement('div', { className: 'dsh-org-staff-role' }, staff.role),
      ),
      createElement('span', { className: 'dsh-org-chip', style: { color: st.color } }, st.label),
    ),
    tasks.length ? tasks.map((t) => createElement(TaskRow, { key: t.callId, task: t }))
      : createElement('div', { className: 'dsh-org-staff-bubble' }, lineOf(staff, status, tick + index)),
    createElement('div', { className: 'dsh-org-staff-hint' }, '点我看档案'),
  )
}

function ChatPanel(props: { chat: any[]; events: string[] }) {
  const { chat, events } = props
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat, events])
  return createElement('div', { className: 'dsh-org-chat-panel' },
    createElement('div', { className: 'dsh-org-chat-head' },
      createElement('span', { className: 'dsh-org-chat-title' }, '💬 牛马摸鱼群'),
      createElement('span', { className: 'dsh-org-chat-notice' }, '群公告：摸鱼勿 @全体成员'),
    ),
    createElement('div', { className: 'dsh-org-chat-body', ref: bodyRef },
      events.map((e, i) => createElement('div', { className: 'dsh-org-sys', key: 'e' + i }, e)),
      chat.map((m, i) => createElement('div', { className: 'dsh-org-chat-msg ' + (m.me ? 'me' : 'them'), key: 'm' + i },
        createElement('span', { className: 'dsh-org-chat-avatar' }, m.emoji),
        createElement('div', { className: 'dsh-org-chat-wrap' },
          createElement('div', { className: 'dsh-org-chat-name' }, m.who),
          createElement('div', { className: 'dsh-org-chat-bubble' }, m.text),
        ),
      )),
    ),
  )
}

function StaffDetail(props: { staff: any; status: string; onClose: () => void }) {
  const { staff, status, onClose } = props
  const st = STAFF_STATUS[status] || STAFF_STATUS.idle
  const role = roleOf(staff.id)
  return createElement('div', { className: 'dsh-org-modal-mask', onClick: onClose },
    createElement('div', { className: 'dsh-org-modal', onClick: (e: any) => e.stopPropagation() },
      createElement('div', { className: 'dsh-org-modal-head' },
        createElement('span', { className: 'dsh-org-modal-emoji' }, staff.emoji),
        createElement('div', { className: 'dsh-org-modal-id' },
          createElement('div', { className: 'dsh-org-modal-name' }, staff.name),
          createElement('div', { className: 'dsh-org-modal-role' }, staff.role + ' · ' + st.label),
        ),
        createElement('button', { type: 'button', className: 'dsh-org-modal-close', 'aria-label': '关闭', onClick: onClose }, '✕'),
      ),
      createElement('div', { className: 'dsh-org-modal-body' },
        createElement('div', { className: 'dsh-org-modal-intro' }, staff.intro),
        createElement('div', { className: 'dsh-org-modal-label' }, '它会的工具'),
        role.tools.length ? createElement('div', { className: 'dsh-org-modal-tools' }, role.tools.map((t) => createElement('span', { className: 'dsh-org-tool', key: t }, t)))
          : createElement('div', { className: 'dsh-org-note' }, '暂无记录的工具'),
        createElement('div', { className: 'dsh-org-modal-label' }, '它会的技能'),
        role.skills.length ? role.skills.map((s) => createElement('div', { className: 'dsh-org-skill-row', key: s.name },
            createElement('div', { className: 'dsh-org-skill-name' }, s.name),
            s.desc ? createElement('div', { className: 'dsh-org-skill-desc' }, s.desc) : null,
          ))
          : createElement('div', { className: 'dsh-org-note' }, '暂无关联的技能'),
      ),
    ),
  )
}

function OrgView(props: any) {
  const useSession = props.useSession
  const timer = props.timer

  const [tick, setTick] = useState(0)
  const [chat, setChat] = useState<any[]>([
    { who: '老板', emoji: '👑', me: true, text: '都到齐了吗？' },
    { who: '老王', emoji: '👔', me: false, text: '到了，等活儿' },
  ])
  const [selected, setSelected] = useState<any>(null)

  useEffect(() => {
    if (!timer || typeof timer.interval !== 'function') return
    return timer.interval(() => setTick((t) => t + 1), 4000)
  }, [timer])

  useEffect(() => {
    if (!timer || typeof timer.interval !== 'function') return
    return timer.interval(() => {
      setChat((c) => {
        const line = CHAT[Math.floor(Math.random() * CHAT.length)]
        const next = c.concat([line])
        return next.length > 20 ? next.slice(next.length - 20) : next
      })
    }, 6500)
  }, [timer])

  const nodes = useSession((s: any) => s.nodes)
  const runningCalls = useSession((s: any) => s.runningCalls)

  const requests = nodes ? collectRequests(nodes) : []
  const delegations = extractDelegations(nodes || [], runningCalls || [])
  const events = systemEvents(delegations)

  const statuses: Record<string, string> = {}
  const tasksMap: Record<string, Delegation[]> = {}
  let runningCount = 0, doneCount = 0, waitCount = 0, idleCount = 0
  for (const st of STAFF) {
    const tasks = tasksFor(st.id, delegations)
    tasksMap[st.id] = tasks
    const status = statusFromTasks(tasks)
    statuses[st.id] = status
    if (status === 'running') runningCount++
    else if (status === 'done') doneCount++
    else if (status === 'wait') waitCount++
    else idleCount++
  }

  return createElement('div', { className: 'dsh-org' },
    createElement('style', null, CSS),
    createElement('div', { className: 'dsh-org-head' },
      createElement('div', null,
        createElement('div', { className: 'dsh-org-title' }, '👑 朕的江山 · 牛马'),
        createElement('div', { className: 'dsh-org-sub' }, '老板派活 · 牛马干活 · 交付提炼'),
      ),
      createElement('div', { className: 'dsh-org-stats' }, `${runningCount} 干活 · ${waitCount} 卡住 · ${doneCount} 已交付 · ${idleCount} 待命`),
    ),
    createElement(BossBubble, { text: bossLine(requests, delegations) }),
    createElement('div', { className: 'dsh-org-body' },
      createElement('div', { className: 'dsh-org-main' },
        createElement('div', { className: 'dsh-org-section-title' }, '牛马办公室'),
        delegations.length === 0 ? createElement('div', { className: 'dsh-org-empty' }, '暂无派活。在对话框里让老板派活（如「派小丽去调研 X」），这里会实时出现任务与进度。') : null,
        createElement('div', { className: 'dsh-org-staff' },
          STAFF.map((st, i) => createElement(StaffCard, {
            key: st.id, staff: st, tasks: tasksMap[st.id], status: statuses[st.id], tick, index: i, onOpen: setSelected,
          })),
        ),
      ),
      createElement('div', { className: 'dsh-org-side' }, createElement(ChatPanel, { chat, events })),
    ),
    selected ? createElement(StaffDetail, { staff: selected, status: statuses[selected.id], onClose: () => setSelected(null) }) : null,
  )
}

export function apply(ctx: any) {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  const timer = ctx.get('timer')
  slots.inject('conversation.view', () => slots.register(
    { name: 'conversation.view', id: 'realm', order: 20, label: () => '纯牛马' },
    (props: any) => createElement(OrgView, Object.assign({}, props, { timer })),
  ))
}
