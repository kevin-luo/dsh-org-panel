// 「纯牛马」DSH 插件 —— client 半边 v2
// 设计原则：真实派活数据驱动 + 可交互群聊 + 可筛选/可搜索 + 可通过 composition 配置扩展。
import { createElement, useEffect, useMemo, useRef, useState } from 'react'

const CSS = `
.dsh-org { height: 100%; overflow-y: auto; box-sizing: border-box; padding: 16px 20px 30px; color: var(--dsw-alias-label-primary); font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.dsh-org-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.dsh-org-title { font-size: 16px; font-weight: 700; }
.dsh-org-sub { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.dsh-org-stats { font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dsh-org-boss { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 14px; }
.dsh-org-boss-emoji { width: 34px; height: 34px; border-radius: 9px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); display: flex; align-items: center; justify-content: center; font-size: 18px; flex: none; }
.dsh-org-boss-bubble { padding: 9px 13px; border-radius: 12px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-left: 3px solid var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; max-width: 94%; }
.dsh-org-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.dsh-org-filters { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dsh-org-filter { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 24px; padding: 0 10px; border-radius: 999px; cursor: pointer; transition: all .12s ease; }
.dsh-org-filter:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-brand-primary); }
.dsh-org-filter.active { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); font-weight: 650; }
.dsh-org-search { display: flex; align-items: center; gap: 6px; margin-left: auto; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 999px; padding: 0 10px; height: 26px; }
.dsh-org-search input { border: none; outline: none; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12px; width: 170px; }
.dsh-org-focus { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-org-focus button { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 999px; padding: 2px 10px; font-size: 12px; cursor: pointer; }
.dsh-org-body { display: flex; gap: 16px; align-items: flex-start; }
.dsh-org-main { flex: 1; min-width: 0; }
.dsh-org-side { width: 300px; flex: none; position: sticky; top: 0; }
.dsh-org-section-title { font-size: 12px; font-weight: 700; color: var(--dsw-alias-label-secondary); margin-bottom: 10px; letter-spacing: .02em; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dsh-org-section-title span { font-weight: 400; }
.dsh-org-empty { text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 14px; border: 1px dashed var(--dsw-alias-border-l1); border-radius: 10px; margin-bottom: 12px; }
.dsh-org-staff { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
.dsh-org-staff-card { position: relative; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; padding: 13px 12px 11px; background: var(--dsw-alias-bg-layer-1); cursor: pointer; transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease; display: flex; flex-direction: column; gap: 9px; }
.dsh-org-staff-card:hover { transform: translateY(-3px); box-shadow: 0 8px 22px rgba(0,0,0,0.12); }
.dsh-org-staff-card.running { border-color: var(--dsw-alias-brand-primary); }
.dsh-org-staff-card.done { border-color: var(--dsw-alias-state-success-primary); }
.dsh-org-staff-card.error { border-color: var(--dsw-alias-state-error-primary); }
.dsh-org-staff-card.dimmed { opacity: .48; }
.dsh-org-staff-top { display: flex; align-items: center; gap: 10px; }
.dsh-org-staff-emoji { width: 42px; height: 42px; border-radius: 12px; background: var(--dsw-alias-bg-layer-2); display: flex; align-items: center; justify-content: center; font-size: 24px; flex: none; }
.dsh-org-staff-id { flex: 1; min-width: 0; }
.dsh-org-staff-name { font-size: 14px; font-weight: 700; }
.dsh-org-staff-role { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-org-chip { font-size: 11px; padding: 0 7px; border-radius: 999px; border: 1px solid currentColor; line-height: 18px; flex: none; }
.dsh-org-staff-bubble { font-size: 12px; line-height: 1.5; padding: 7px 10px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); word-break: break-word; }
.dsh-org-staff-hint { font-size: 10px; color: var(--dsw-alias-label-secondary); text-align: center; opacity: .85; }
.dsh-org-task { border-top: 1px dashed var(--dsw-alias-border-l1); padding-top: 8px; }
.dsh-org-task-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.dsh-org-task-desc { font-size: 12px; font-weight: 600; line-height: 1.4; flex: 1; min-width: 0; word-break: break-word; }
.dsh-org-task-lead { font-size: 11px; color: var(--dsw-alias-label-primary); line-height: 1.5; margin-top: 6px; background: var(--dsw-alias-bg-layer-2); padding: 6px 8px; border-radius: 8px; word-break: break-word; }
.dsh-org-task-points { margin-top: 4px; }
.dsh-org-task-point { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.dsh-org-task-meta { font-size: 10px; color: var(--dsw-alias-label-secondary); margin-top: 5px; opacity: .85; }
.dsh-org-task-toggle { margin-top: 6px; border: none; background: transparent; color: var(--dsw-alias-brand-primary); font-size: 11px; padding: 0; cursor: pointer; }
.dsh-org-progress { height: 4px; border-radius: 2px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; margin-top: 6px; }
.dsh-org-progress-bar { height: 100%; width: 40%; border-radius: 2px; background: var(--dsw-alias-brand-primary); animation: dsh-org-progress 1.2s ease-in-out infinite; }
@keyframes dsh-org-progress { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
.dsh-org-chat-panel { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; background: var(--dsw-alias-bg-layer-1); height: 520px; max-height: 520px; }
.dsh-org-chat-head { padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); text-align: center; }
.dsh-org-chat-title { font-weight: 700; font-size: 13px; color: var(--dsw-alias-label-primary); }
.dsh-org-chat-notice { display: block; font-weight: 400; font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.dsh-org-chat-body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-base); min-height: 0; }
.dsh-org-sys { align-self: center; font-size: 11px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); padding: 2px 9px; border-radius: 999px; max-width: 92%; text-align: center; }
.dsh-org-chat-msg { display: flex; align-items: flex-end; gap: 6px; }
.dsh-org-chat-msg.me { flex-direction: row-reverse; }
.dsh-org-chat-avatar { width: 28px; height: 28px; border-radius: 7px; display: flex; align-items: center; justify-content: center; font-size: 16px; background: var(--dsw-alias-bg-layer-2); flex: none; }
.dsh-org-chat-wrap { max-width: 74%; display: flex; flex-direction: column; }
.dsh-org-chat-msg.me .dsh-org-chat-wrap { align-items: flex-end; }
.dsh-org-chat-name { font-size: 10px; color: var(--dsw-alias-label-secondary); margin: 0 4px 2px; }
.dsh-org-chat-bubble { padding: 6px 10px; border-radius: 10px; font-size: 12px; line-height: 1.5; word-break: break-word; }
.dsh-org-chat-msg.me .dsh-org-chat-bubble { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); border-bottom-right-radius: 2px; }
.dsh-org-chat-msg.them .dsh-org-chat-bubble { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-bottom-left-radius: 2px; }
.dsh-org-chat-quick { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 10px 0; }
.dsh-org-chat-quick button { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 11px; padding: 3px 9px; border-radius: 999px; cursor: pointer; }
.dsh-org-chat-quick button:hover { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dsh-org-chat-input { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dsh-org-chat-input input { flex: 1; min-width: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 12px; padding: 6px 12px; outline: none; }
.dsh-org-chat-input input:focus { border-color: var(--dsw-alias-brand-primary); }
.dsh-org-chat-input button { border: none; border-radius: 999px; background: var(--dsw-alias-brand-primary); color: #fff; font-size: 12px; padding: 6px 14px; cursor: pointer; }
.dsh-org-chat-input button:disabled { opacity: .5; cursor: default; }
.dsh-org-modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 1100; display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.dsh-org-modal { width: 420px; max-width: 92vw; max-height: 82vh; overflow-y: auto; border-radius: 16px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); box-shadow: 0 20px 60px rgba(0,0,0,0.28); }
.dsh-org-modal-head { display: flex; align-items: center; gap: 12px; padding: 16px 16px 12px; }
.dsh-org-modal-emoji { width: 56px; height: 56px; border-radius: 16px; background: var(--dsw-alias-bg-layer-1); display: flex; align-items: center; justify-content: center; font-size: 32px; flex: none; }
.dsh-org-modal-id { flex: 1; min-width: 0; }
.dsh-org-modal-name { font-size: 16px; font-weight: 700; }
.dsh-org-modal-role { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.dsh-org-modal-close { margin-left: auto; cursor: pointer; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 18px; padding: 4px 8px; border-radius: 6px; }
.dsh-org-modal-close:hover { background: var(--dsw-alias-bg-layer-1); }
.dsh-org-modal-body { padding: 0 16px 16px; }
.dsh-org-modal-intro { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); margin-bottom: 12px; }
.dsh-org-modal-label { font-size: 11px; font-weight: 700; color: var(--dsw-alias-label-secondary); margin: 10px 0 6px; }
.dsh-org-modal-tools { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-org-tool { font-size: 11px; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; padding: 2px 8px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }
.dsh-org-skill-row { font-size: 12px; padding: 6px 0; border-bottom: 1px dashed var(--dsw-alias-border-l1); }
.dsh-org-skill-row:last-child { border-bottom: none; }
.dsh-org-skill-name { font-weight: 600; }
.dsh-org-skill-desc { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.45; margin-top: 2px; }
.dsh-org-note { font-size: 12px; color: var(--dsw-alias-label-secondary); padding: 8px 0; }
.dsh-org-focus-action { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-brand-primary); border-radius: 8px; padding: 5px 10px; font-size: 12px; cursor: pointer; margin-left: 8px; }
@media (max-width: 980px) {
  .dsh-org-body { flex-direction: column; }
  .dsh-org-side { width: 100%; position: static; }
  .dsh-org-search { margin-left: 0; width: 100%; }
  .dsh-org-search input { width: 100%; }
}
`

export type SkillDef = { name: string; desc?: string }
export type RoleDef = { id: string; tools: string[]; skills: SkillDef[]; keywords?: string[] }
export type StaffDef = {
  id: string
  name: string
  role: string
  emoji: string
  intro: string
  roleId: string
  aliases?: string[]
  lines?: { [key: string]: string[] | undefined }
}
export type OrgPanelConfig = {
  tabLabel?: string
  companyName?: string
  chatEnabled?: boolean
  roles?: RoleDef[]
  staff?: StaffDef[]
}

const DEFAULT_ROLES: RoleDef[] = [
  { id: 'tech-lead', tools: ['subagent', 'subagent_fork', 'workflow', 'ralph', 'send_message', 'list_agents', 'create_goal', 'get_goal', 'update_goal', 'todo_write'], skills: [{ name: '多智能体调度', desc: '拆解任务、指派下级、盯进度' }], keywords: ['派', '调度', '协调', '分配', '安排', '进度', '排期', '统筹', '管理'] },
  { id: 'developer', tools: ['bash', 'pwsh', 'edit', 'write', 'grep', 'glob', 'read_image', 'job_list', 'codex', 'apply_patch'], skills: [{ name: '工程实现', desc: '写代码、改文件、跑命令' }], keywords: ['代码', '写', '实现', '开发', '编程', '修', 'bug', '接口', '前端', '后端', '测试', '命令', '脚本', '重构', '编译', '构建'] },
  { id: 'pm', tools: ['ask_user_question'], skills: [{ name: '需求分析', desc: '梳理需求、向用户提问确认' }], keywords: ['需求', '文案', '方案', '产品', '设计', 'prd', '提问', '决策', '用户反馈', '优先级'] },
  { id: 'researcher', tools: ['web_search', 'web_fetch'], skills: [{ name: '情报调研', desc: '联网搜索、查竞品、写报告' }], keywords: ['调研', '搜索', '查', '情报', '分析', '市场', '竞品', '联网', '抓取', '资料', '行业', '报告'] },
  { id: 'platform', tools: ['cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine', 'cordis_inspect_list'], skills: [{ name: 'Cordis 插件开发', desc: '定义/运行/检查动态插件与扩展' }], keywords: ['部署', '插件', '环境', '配置', 'cordis', '扩展', '集成', '平台', '安装', '上线', '容器', '服务'] },
  { id: 'doc', tools: ['read', 'skill', 'write_doc'], skills: [{ name: '文档与知识库', desc: '读写文档、整理资料、加载技能' }], keywords: ['文档', '知识', '整理', '手册', '读写', '技能', '教程', '说明', '归档', '笔记'] },
]

const DEFAULT_STAFF: StaffDef[] = [
  { id: 'tech-lead', name: '老王', role: '技术经理', emoji: '👔', roleId: 'tech-lead', aliases: ['老王', '技术经理', 'tech-lead', 'tech lead'], intro: '团队的大脑，负责拆任务、调人手、盯进度，出了事他扛。', lines: { idle: ['摸会儿鱼，等老板派活', '盯着排期发呆', '今天谁点奶茶？'], running: ['收到！这就拆任务分配下去', '大家按排期来，别慌', '进度我盯着'], done: ['团队交付了，漂亮', '活儿干完，可以松口气'], wait: ['老板，这方向得你拍板', '资源不够，等你批预算'] } },
  { id: 'developer', name: '小刘', role: '程序员', emoji: '💻', roleId: 'developer', aliases: ['小刘', '程序员', 'developer', '开发'], intro: '码农本农，能写会改，最怕的就是需求变更。', lines: { idle: ['等需求，先刷会儿代码', 'IDE 开着，假装很忙'], running: ['收到，开写！', '这需求怎么又变了…', '在写了在写了，别催'], done: ['搞定，测试过了', '交付！谁请奶茶'], wait: ['接口还没给我，卡住了', '编译报错，等个环境'] } },
  { id: 'pm', name: '阿明', role: '产品经理', emoji: '📋', roleId: 'pm', aliases: ['阿明', '产品经理', 'pm', '产品'], intro: '天天想需求、写 PRD，老板的传声筒，背锅侠。', lines: { idle: ['想下一个需求', '和用户聊聊反馈'], running: ['需求我理好了，发群里', '这个功能老板要的，加一下'], done: ['PRD 写完了', '需求落地了'], wait: ['老板，这个优先级你定', '用户反馈等确认'] } },
  { id: 'researcher', name: '小丽', role: '市场调研', emoji: '🔎', roleId: 'researcher', aliases: ['小丽', '市场调研', 'researcher', '调研'], intro: '情报担当，搜竞品、查资料、写报告，消息最灵。', lines: { idle: ['逛会儿论坛找素材', '等调研任务'], running: ['正在搜竞品情报', '查到几条关键信息'], done: ['调研报告出来了', '情报整理好了'], wait: ['搜索方向要确认下'] } },
  { id: 'platform', name: '大壮', role: '平台工程师', emoji: '🛠', roleId: 'platform', aliases: ['大壮', '平台工程师', 'platform', '平台', '运维'], intro: '管环境、装插件、搞扩展，闷头干大事。', lines: { idle: ['插件环境守着', '等部署任务'], running: ['环境在部署了', '插件装好了'], done: ['环境就绪', '扩展上线'], wait: ['权限要开通下'] } },
  { id: 'doc', name: '静静', role: '文档专员', emoji: '📖', roleId: 'doc', aliases: ['静静', '文档专员', 'doc', '文档'], intro: '知识库守门人，写文档、理资料、记笔记。', lines: { idle: ['整理文档库', '等写作任务'], running: ['文档写着呢', '资料整理中'], done: ['文档更新好了', '手册写完了'], wait: ['缺素材，等资料'] } },
]

// 不设置任何虚构群聊内容。
// 群聊只展示真实派活动态，以及老板通过输入框发起的真实交互消息。

const STATUS_LABEL: Record<string, string> = {
  running: '干活中',
  done: '已交付',
  wait: '卡住了',
  idle: '待命中',
}

const STATUS_COLOR: Record<string, string> = {
  running: 'var(--dsw-alias-brand-primary)',
  done: 'var(--dsw-alias-state-success-primary)',
  wait: 'var(--dsw-alias-state-error-primary)',
  idle: 'var(--dsw-alias-label-secondary)',
}

type ChatMessage = { key: string; who: string; emoji: string; me: boolean; text: string }

type Delegation = {
  callId: string
  tool: string
  desc: string
  running: boolean
  isError: boolean
  lead: string
  points: string[]
  startTime: number | null
  endTime: number | null
  duration: number | null
  roleId: string
  staffId: string
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

function parseArgs(raw: unknown): Record<string, any> {
  if (typeof raw !== 'string') return raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  try { return JSON.parse(raw) } catch { return {} }
}

function nodeTime(n: any): number | null {
  const t = n && (n.time ?? n.ts ?? n.createdAt)
  if (typeof t === 'number') return t
  if (typeof t === 'string') { const p = Date.parse(t); return isNaN(p) ? null : p }
  return null
}

function collectUserRequests(nodes: any[]): string[] {
  const out: string[] = []
  for (const n of nodes) {
    if (n && n.kind === 'user') {
      const t = extractText(n.content)
      if (t) out.push(t)
    }
  }
  return out
}

function summarizeResult(text: string): { lead: string; points: string[] } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return { lead: '', points: [] }
  const lead = clip(lines[0], 110)
  const points: string[] = []
  for (let i = 1; i < lines.length && points.length < 4; i++) {
    const l = lines[i]
    if (/^[-*•]|\d+[.)]/.test(l)) points.push(clip(l.replace(/^[-*•\s]+/, '').replace(/^\d+[.)]\s*/, ''), 80))
  }
  if (points.length === 0) for (let i = 1; i < lines.length && points.length < 4; i++) points.push(clip(lines[i], 80))
  return { lead, points }
}

function isDispatchTool(name: string): boolean {
  if (!name) return false
  return name === 'workflow' || name.startsWith('subagent')
}

function extractDelegations(nodes: any[], runningCalls: any[], roles: RoleDef[], staff: StaffDef[]): Delegation[] {
  const calls: Record<string, { name: string; args: Record<string, any>; startTime: number | null }> = {}
  const results: Record<string, { text: string; isError: boolean; endTime: number | null }> = {}
  for (const n of nodes || []) {
    if (n && n.kind === 'assistant' && Array.isArray(n.blocks)) {
      for (const b of n.blocks as any[]) {
        if (b && b.kind === 'tool-call' && b.callId) calls[b.callId] = { name: b.name, args: parseArgs(b.argsRaw), startTime: nodeTime(n) }
      }
    } else if (n && n.kind === 'tool-result' && n.callId) {
      results[n.callId] = { text: extractText(n.content), isError: !!n.isError, endTime: nodeTime(n) }
      if (n.call && !calls[n.callId]) calls[n.callId] = { name: n.call.name, args: parseArgs(n.call.argsRaw), startTime: nodeTime(n) }
    }
  }
  for (const rc of runningCalls || []) {
    if (rc && rc.callId && !calls[rc.callId]) calls[rc.callId] = { name: rc.name, args: parseArgs(rc.argsRaw), startTime: nodeTime(rc) }
  }
  const out: Delegation[] = []
  for (const callId of Object.keys(calls)) {
    const c = calls[callId]
    if (!isDispatchTool(c.name)) continue
    const res = results[callId]
    const rawDesc = c.name === 'workflow'
      ? (c.args?.meta?.name || c.args?.name || c.args?.description || '')
      : (c.args?.description || c.args?.prompt || c.args?.task || c.args?.instruction || '')
    const desc = clip(rawDesc || '(未命名任务)', 160)
    const summary = res ? summarizeResult(res.text) : { lead: '', points: [] }
    const roleId = assignRoleId(rawDesc, c.name, c.args, roles, staff)
    const staffId = staffForRole(roleId, staff)
    out.push({
      callId, tool: c.name, desc,
      running: !res,
      isError: res ? res.isError : false,
      lead: summary.lead, points: summary.points,
      startTime: c.startTime, endTime: res ? res.endTime : null,
      duration: c.startTime && res && res.endTime ? Math.max(0, res.endTime - c.startTime) : null,
      roleId, staffId,
    })
  }
  return out
}

function assignRoleId(desc: string, tool: string, args: Record<string, any>, roles: RoleDef[], staff: StaffDef[]): string {
  const text = ` ${desc || ''} ${args?.description || ''} ${args?.prompt || ''} ${args?.meta?.name || ''} ${args?.agent || ''} ${args?.role || ''} `.toLowerCase()
  for (const st of staff) {
    if ((st.aliases || []).some((a) => a && text.includes(a.toLowerCase()))) return st.roleId || st.id
  }
  if (args?.role && typeof args.role === 'string') {
    const hit = roles.find((r) => r.id === args.role || (r.keywords || []).some((k) => args.role.toLowerCase().includes(k)))
    if (hit) return hit.id
  }
  let best = roles[0]?.id || 'tech-lead'
  let bestScore = -1
  for (const role of roles) {
    let score = 0
    for (const k of role.keywords || []) {
      if (text.includes(k.toLowerCase())) score += k.length
    }
    if ((role.tools || []).includes(tool)) score += 2
    if (score > bestScore) { bestScore = score; best = role.id }
  }
  return best
}

function staffForRole(roleId: string, staff: StaffDef[]): string {
  const hit = staff.find((s) => s.roleId === roleId || s.id === roleId)
  return hit ? hit.id : (staff[0]?.id || roleId)
}

function roleOf(id: string, roles: RoleDef[]): RoleDef {
  return roles.find((r) => r.id === id) || { id, tools: [], skills: [] }
}

function staffOf(id: string, staff: StaffDef[]): StaffDef | undefined {
  return staff.find((s) => s.id === id || s.roleId === id)
}

function tasksFor(staffId: string, delegations: Delegation[]): Delegation[] {
  return delegations.filter((d) => d.staffId === staffId || d.roleId === staffId)
}

function statusFromTasks(tasks: Delegation[]): string {
  if (tasks.some((t) => t.running)) return 'running'
  if (tasks.some((t) => t.isError)) return 'wait'
  if (tasks.some((t) => !t.running && !t.isError)) return 'done'
  return 'idle'
}

function lineOf(staff: StaffDef | undefined, status: string, tick: number): string {
  const arr = status === 'idle' ? undefined : staff?.lines?.[status]
  if (arr && arr.length > 0) return arr[tick % arr.length]
  const fallback: Record<string, string> = {
    idle: '待命中：等真实派活',
    running: '干活中：进度见任务卡',
    done: '已交付：结果见任务卡',
    wait: '卡住了：等待处理',
  }
  return fallback[status] || fallback.idle
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
  if (ms < 0) return '刚刚'
  const s = Math.round(ms / 1000)
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return m + ' 分钟前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时前'
  return Math.floor(h / 24) + ' 天前'
}

function bossLine(requests: string[], delegations: Delegation[], staff: StaffDef[]): string {
  if (delegations.length === 0) return requests.length > 0 ? '收到需求，我先想想怎么拆。' : '还没接到需求，都先歇着。'
  const req = requests.length > 0 ? clip(requests[requests.length - 1], 48) : ''
  const running = delegations.filter((d) => d.running)
  const done = delegations.filter((d) => !d.running && !d.isError)
  const error = delegations.filter((d) => d.isError)
  const parts = [`收到需求${req ? '「' + req + '」' : ''}，拆了 ${delegations.length} 个活`]
  const name = (d: Delegation) => staffOf(d.staffId, staff)?.name || '员工'
  if (running.length) parts.push(running.length + ' 个在干：' + running.map((d) => name(d) + '·' + clip(d.desc, 14)).join('、'))
  if (done.length) parts.push(done.length + ' 个已交付：' + done.map((d) => name(d) + '·' + clip(d.desc, 14)).join('、'))
  if (error.length) parts.push(error.length + ' 个卡住：' + error.map((d) => name(d) + '·' + clip(d.desc, 14)).join('、'))
  return parts.join('；')
}

function systemEvents(delegations: Delegation[], staff: StaffDef[]): string[] {
  const events: string[] = []
  if (delegations.length) events.push('👑 老板派了 ' + delegations.length + ' 个活')
  for (const d of delegations) {
    const name = staffOf(d.staffId, staff)?.name || '员工'
    if (!d.running && !d.isError) events.push('✅ ' + name + ' 交付了：' + clip(d.desc, 18))
    else if (d.isError) events.push('⚠️ ' + name + ' 卡住了：' + clip(d.desc, 18))
    else events.push('🔨 ' + name + ' 正在干：' + clip(d.desc, 18))
  }
  return events.slice(0, 8)
}

function baseChatMessages(): ChatMessage[] {
  return []
}

function statusReport(delegations: Delegation[], staff: StaffDef[]): string {
  const running = delegations.filter((d) => d.running)
  const done = delegations.filter((d) => !d.running && !d.isError)
  const errors = delegations.filter((d) => d.isError)
  const parts = [`当前 ${delegations.length} 个活：`]
  if (running.length) parts.push(running.length + ' 个在干（' + running.map((d) => staffOf(d.staffId, staff)?.name).join('、') + '）')
  if (done.length) parts.push(done.length + ' 个已交付')
  if (errors.length) parts.push(errors.length + ' 个卡住')
  if (delegations.length === 0) parts.push('暂时没有真实派活记录')
  return parts.join('，')
}

function idleReport(statuses: Record<string, string>, staff: StaffDef[]): string {
  const idle = staff.filter((s) => (statuses[s.id] || 'idle') === 'idle').map((s) => s.name)
  const busy = staff.filter((s) => (statuses[s.id] || 'idle') !== 'idle').map((s) => s.name)
  if (idle.length === 0) return '现在没有人摸鱼，全都在忙。'
  return '待命中的有：' + idle.join('、') + '。' + (busy.length ? '正在忙的：' + busy.join('、') + '。' : '')
}

function deliveryReport(delegations: Delegation[], staff: StaffDef[]): string {
  const done = delegations.filter((d) => !d.running && !d.isError)
  if (done.length === 0) return '还没有交付记录，继续催。'
  return '已交付 ' + done.length + ' 个：' + done.map((d) => staffOf(d.staffId, staff)?.name + '·' + clip(d.desc, 16)).join('、')
}

function dispatchTemplate(staff: StaffDef | undefined): string {
  if (!staff) return ''
  return `派 ${staff.name}（${staff.role}）去做：`
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {}
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

function makeReply(text: string, delegations: Delegation[], statuses: Record<string, string>, staff: StaffDef[], tick: number): ChatMessage {
  const q = text.trim()
  let responder = staff.find((s) => s.roleId === 'tech-lead') || staff[0]
  let replyText = ''
  if (/进度|汇报|status|怎么样|如何/.test(q)) {
    replyText = statusReport(delegations, staff)
  } else if (/摸鱼|谁在|待命|idle|闲/.test(q)) {
    replyText = idleReport(statuses, staff)
  } else if (/交付|完成|done|干完|交付清单/.test(q)) {
    replyText = deliveryReport(delegations, staff)
  } else if (/卡住|问题|error|异常|失败/.test(q)) {
    const errors = delegations.filter((d) => d.isError)
    replyText = errors.length ? '卡住 ' + errors.length + ' 个：' + errors.map((d) => clip(d.desc, 20)).join('、') : '暂时没有卡住的任务。'
    responder = staff.find((s) => (statuses[s.id] || 'idle') === 'wait') || responder
  } else if (/派活|安排|拆|subagent|工作流/.test(q)) {
    replyText = '这里只播报真实派活，不会伪造任务。点开员工卡，用「复制派活指令」粘贴到主对话发起真实派活。'
  } else {
    const mentioned = staff.find((s) => (s.aliases || []).concat([s.name]).some((a) => q.includes(a)))
    responder = mentioned || staff.find((s) => (statuses[s.id] || 'idle') === 'running') || responder
    const st = statuses[responder.id] || 'idle'
    const tasks = tasksFor(responder.id, delegations)
    const detail = tasks.length ? '当前手上有 ' + tasks.length + ' 个活：' + clip(tasks[0].desc, 24) : ''
    replyText = [lineOf(responder, st, tick), detail].filter(Boolean).join('。')
  }
  return { key: 'reply-' + Date.now() + '-' + Math.random(), who: responder?.name || '老王', emoji: responder?.emoji || '👔', me: false, text: replyText || '收到。' }
}

function BossBubble(props: { text: string; companyName: string }) {
  return createElement('div', { className: 'dsh-org-boss' },
    createElement('span', { className: 'dsh-org-boss-emoji' }, '👑'),
    createElement('div', { className: 'dsh-org-boss-bubble' }, props.text),
  )
}

function TaskRow(props: { task: Delegation; staff: StaffDef | undefined }) {
  const t = props.task
  const [open, setOpen] = useState(false)
  const st = t.running ? 'running' : t.isError ? 'wait' : 'done'
  const meta: string[] = []
  if (!t.running && t.duration) meta.push('用时 ' + formatDuration(t.duration))
  else if (!t.running && t.endTime) meta.push(formatAgo(t.endTime))
  else if (t.running && t.startTime) meta.push(formatAgo(t.startTime) + ' 开始')
  return createElement('div', { className: 'dsh-org-task' },
    createElement('div', { className: 'dsh-org-task-head' },
      createElement('span', { className: 'dsh-org-task-desc' }, t.desc),
      createElement('span', { className: 'dsh-org-chip', style: { color: STATUS_COLOR[st] } }, STATUS_LABEL[st]),
    ),
    t.running ? createElement('div', { className: 'dsh-org-progress' }, createElement('div', { className: 'dsh-org-progress-bar' })) : null,
    meta.length ? createElement('div', { className: 'dsh-org-task-meta' }, meta.join(' · ')) : null,
    open && t.lead ? createElement('div', { className: 'dsh-org-task-lead' }, '📦 ' + t.lead) : null,
    open && t.points.length ? createElement('div', { className: 'dsh-org-task-points' }, t.points.map((p, i) => createElement('div', { className: 'dsh-org-task-point', key: i }, '· ' + p))) : null,
    (t.lead || t.points.length) ? createElement('button', {
      type: 'button', className: 'dsh-org-task-toggle',
      onClick: (e: any) => { e.stopPropagation(); setOpen((v) => !v) },
    }, open ? '收起交付摘要' : '查看交付摘要') : null,
  )
}

function StaffCard(props: {
  staff: StaffDef; tasks: Delegation[]; status: string; tick: number; index: number;
  query: string; onOpen: (s: StaffDef) => void
}) {
  const { staff, tasks, status, tick, index, query, onOpen } = props
  const q = query.trim().toLowerCase()
  const shownTasks = q ? tasks.filter((t) => t.desc.toLowerCase().includes(q) || t.lead.toLowerCase().includes(q)) : tasks
  const st = STATUS_LABEL[status] || STATUS_LABEL.idle
  const color = STATUS_COLOR[status] || STATUS_COLOR.idle
  const dimmed = !!q && shownTasks.length === 0 && !(staff.name + staff.role).toLowerCase().includes(q)
  return createElement('div', { className: 'dsh-org-staff-card ' + status + (dimmed ? ' dimmed' : ''), onClick: () => onOpen(staff) },
    createElement('div', { className: 'dsh-org-staff-top' },
      createElement('span', { className: 'dsh-org-staff-emoji' }, staff.emoji),
      createElement('div', { className: 'dsh-org-staff-id' },
        createElement('div', { className: 'dsh-org-staff-name' }, staff.name),
        createElement('div', { className: 'dsh-org-staff-role' }, staff.role),
      ),
      createElement('span', { className: 'dsh-org-chip', style: { color } }, st),
    ),
    shownTasks.length ? shownTasks.slice(0, 3).map((t) => createElement(TaskRow, { key: t.callId, task: t, staff }))
      : createElement('div', { className: 'dsh-org-staff-bubble' }, lineOf(staff, status, tick + index)),
    createElement('div', { className: 'dsh-org-staff-hint' }, tasks.length ? '点击看档案 · ' + tasks.length + ' 个任务' : '点击看档案'),
  )
}

function ChatPanel(props: {
  messages: ChatMessage[]; events: string[]; chatEnabled: boolean;
  onSend: (text: string) => void
}) {
  const { messages, events, chatEnabled, onSend } = props
  const [text, setText] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, events])
  const submit = (e: any) => {
    e.preventDefault()
    const value = text.trim()
    if (!value) return
    onSend(value)
    setText('')
  }
  return createElement('div', { className: 'dsh-org-chat-panel' },
    createElement('div', { className: 'dsh-org-chat-head' },
      createElement('span', { className: 'dsh-org-chat-title' }, '💬 牛马工作群'),
      createElement('span', { className: 'dsh-org-chat-notice' }, '群公告：本群只播报真实动态，不演戏'),
    ),
    createElement('div', { className: 'dsh-org-chat-body', ref: bodyRef },
      events.map((e, i) => createElement('div', { className: 'dsh-org-sys', key: 'sys-' + i }, e)),
        messages.length === 0 ? createElement('div', { className: 'dsh-org-sys' }, '暂无真实派活。可在下方发消息，或到主对话发起 subagent / workflow。') : null,
      messages.map((m) => createElement('div', { className: 'dsh-org-chat-msg ' + (m.me ? 'me' : 'them'), key: m.key },
        createElement('span', { className: 'dsh-org-chat-avatar' }, m.emoji),
        createElement('div', { className: 'dsh-org-chat-wrap' },
          createElement('div', { className: 'dsh-org-chat-name' }, m.who),
          createElement('div', { className: 'dsh-org-chat-bubble' }, m.text),
        ),
      )),
    ),
    chatEnabled ? createElement('div', { className: 'dsh-org-chat-quick' },
      ['进度', '谁在待命', '交付清单'].map((q) => createElement('button', { type: 'button', key: q, onClick: () => onSend(q) }, q)),
    ) : null,
    chatEnabled ? createElement('form', { className: 'dsh-org-chat-input', onSubmit: submit },
      createElement('input', { value: text, onChange: (e: any) => setText(e.target.value), placeholder: '以老板身份发消息…' }),
      createElement('button', { type: 'submit', disabled: !text.trim() }, '发送'),
    ) : createElement('div', { className: 'dsh-org-note', style: { padding: '0 12px 10px' } }, '群聊交互已关闭'),
  )
}

function StaffDetail(props: {
  staff: StaffDef; status: string; tasks: Delegation[]; roles: RoleDef[];
  onClose: () => void; onFocus: (id: string) => void
}) {
  const { staff, status, tasks, roles, onClose, onFocus } = props
  const [copied, setCopied] = useState(false)
  const role = roleOf(staff.roleId || staff.id, roles)
  return createElement('div', { className: 'dsh-org-modal-mask', onClick: onClose },
    createElement('div', { className: 'dsh-org-modal', onClick: (e: any) => e.stopPropagation() },
      createElement('div', { className: 'dsh-org-modal-head' },
        createElement('span', { className: 'dsh-org-modal-emoji' }, staff.emoji),
        createElement('div', { className: 'dsh-org-modal-id' },
          createElement('div', { className: 'dsh-org-modal-name' }, staff.name),
          createElement('div', { className: 'dsh-org-modal-role' }, staff.role + ' · ' + (STATUS_LABEL[status] || STATUS_LABEL.idle)),
        ),
        createElement('button', { type: 'button', className: 'dsh-org-modal-close', 'aria-label': '关闭', onClick: onClose }, '✕'),
      ),
      createElement('div', { className: 'dsh-org-modal-body' },
        createElement('div', { className: 'dsh-org-modal-intro' }, staff.intro),
        createElement('div', { className: 'dsh-org-modal-label' }, '当前工位'),
        tasks.length ? tasks.slice(0, 3).map((t) => createElement(TaskRow, { key: t.callId, task: t, staff }))
          : createElement('div', { className: 'dsh-org-note' }, '暂无任务'),
        createElement('button', { type: 'button', className: 'dsh-org-focus-action', onClick: () => onFocus(staff.id) }, '只看 TA 的工位'),
          createElement('button', { type: 'button', className: 'dsh-org-focus-action', onClick: () => { void copyText(dispatchTemplate(staff)); setCopied(true); window.setTimeout(() => setCopied(false), 2000) } }, copied ? '已复制，去主对话粘贴' : '复制派活指令'),
        createElement('div', { className: 'dsh-org-modal-label' }, '它会的能力'),
        role.tools.length ? createElement('div', { className: 'dsh-org-modal-tools' }, role.tools.map((t) => createElement('span', { className: 'dsh-org-tool', key: t }, t)))
          : createElement('div', { className: 'dsh-org-note' }, '暂无记录的工具'),
        createElement('div', { className: 'dsh-org-modal-label' }, '它会的方法'),
        role.skills.length ? role.skills.map((s) => createElement('div', { className: 'dsh-org-skill-row', key: s.name },
            createElement('div', { className: 'dsh-org-skill-name' }, s.name),
            s.desc ? createElement('div', { className: 'dsh-org-skill-desc' }, s.desc) : null,
          ))
          : createElement('div', { className: 'dsh-org-note' }, '暂无关联的技能'),
      ),
    ),
  )
}

function normalizeConfig(config?: OrgPanelConfig): Required<Pick<OrgPanelConfig, 'tabLabel' | 'companyName' | 'chatEnabled'>> & { roles: RoleDef[]; staff: StaffDef[] } {
  const cfg = config || {}
  const roles = (cfg.roles && cfg.roles.length ? cfg.roles : DEFAULT_ROLES).map((r) => ({
    id: r.id,
    tools: r.tools || [],
    skills: r.skills || [],
    keywords: r.keywords || [],
  }))
  const staff = (cfg.staff && cfg.staff.length ? cfg.staff : DEFAULT_STAFF).map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    emoji: s.emoji,
    intro: s.intro,
    roleId: s.roleId || s.id,
    aliases: s.aliases || [],
    lines: s.lines || {},
  }))
  return {
    tabLabel: cfg.tabLabel || '纯牛马',
    companyName: cfg.companyName || '朕的江山',
    chatEnabled: cfg.chatEnabled !== false,
    roles,
    staff,
  }
}

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'running', label: '干活中' },
  { id: 'done', label: '已交付' },
  { id: 'wait', label: '卡住' },
  { id: 'idle', label: '待命' },
]

export function OrgView(props: any) {
  const useSession = props?.useSession
  const timer = props?.timer
  const config = normalizeConfig(props?.config as OrgPanelConfig | undefined)
  const staff = config.staff
  const roles = config.roles

  const [tick, setTick] = useState(0)
  const [selected, setSelected] = useState<StaffDef | null>(null)
  const [focusStaff, setFocusStaff] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [extraMessages, setExtraMessages] = useState<ChatMessage[]>([])
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    if (!timer || typeof timer.interval !== 'function') return
    const off = timer.interval(() => setTick((t) => t + 1), 4000)
    return () => { if (typeof off === 'function') off() }
  }, [timer])

  useEffect(() => () => {
    timersRef.current.forEach((t) => clearTimeout(t))
  }, [])

  const useSessionSafe = typeof useSession === 'function' ? useSession : () => undefined
  const nodes = useSessionSafe((s: any) => s?.nodes)
  const runningCalls = useSessionSafe((s: any) => s?.runningCalls)

  const requests = useMemo(() => collectUserRequests(nodes || []), [nodes])
  const delegations = useMemo(() => extractDelegations(nodes || [], runningCalls || [], roles, staff), [nodes, runningCalls, roles, staff])
  const events = useMemo(() => systemEvents(delegations, staff), [delegations, staff])

  const statuses: Record<string, string> = {}
  const tasksMap: Record<string, Delegation[]> = {}
  let runningCount = 0, doneCount = 0, waitCount = 0, idleCount = 0
  for (const st of staff) {
    const tasks = tasksFor(st.id, delegations)
    tasksMap[st.id] = tasks
    const status = statusFromTasks(tasks)
    statuses[st.id] = status
    if (status === 'running') runningCount++
    else if (status === 'done') doneCount++
    else if (status === 'wait') waitCount++
    else idleCount++
  }

  const visibleStaff = useMemo(() => {
    const q = query.trim().toLowerCase()
    return staff.filter((st) => {
      if (focusStaff && st.id !== focusStaff) return false
      const status = statuses[st.id] || 'idle'
      if (filter !== 'all' && status !== filter) return false
      if (q) {
        const tasks = tasksMap[st.id] || []
        const inName = (st.name + st.role).toLowerCase().includes(q)
        const inTask = tasks.some((t) => t.desc.toLowerCase().includes(q) || t.lead.toLowerCase().includes(q))
        if (!inName && !inTask) return false
      }
      return true
    })
  }, [staff, focusStaff, filter, query, delegations])

  const sendMessage = (raw: string) => {
    const value = raw.trim()
    if (!value) return
    const userMsg: ChatMessage = { key: 'me-' + Date.now(), who: '老板', emoji: '👑', me: true, text: value }
    setExtraMessages((prev) => {
      const next = prev.concat([userMsg])
      return next.length > 40 ? next.slice(next.length - 40) : next
    })
    const timeout = setTimeout(() => {
      const reply = makeReply(value, delegations, statuses, staff, Math.floor(Date.now() / 1000))
      setExtraMessages((prev) => {
        const next = prev.concat([reply])
        return next.length > 40 ? next.slice(next.length - 40) : next
      })
    }, 500 + Math.round(Math.random() * 600))
    timersRef.current.push(timeout)
  }

  const baseMessages = useMemo(() => baseChatMessages(), [])
  const chatMessages = useMemo(() => {
    const merged = baseMessages.concat(extraMessages)
    return merged.length > 40 ? merged.slice(merged.length - 40) : merged
  }, [baseMessages, extraMessages])

  return createElement('div', { className: 'dsh-org' },
    createElement('style', null, CSS),
    createElement('div', { className: 'dsh-org-head' },
      createElement('div', null,
        createElement('div', { className: 'dsh-org-title' }, '👑 ' + config.companyName + ' · 牛马'),
        createElement('div', { className: 'dsh-org-sub' }, '只展示真实派活 · 不演戏 · 群聊可交互'),
      ),
      createElement('div', { className: 'dsh-org-stats' }, `${runningCount} 干活 · ${waitCount} 卡住 · ${doneCount} 已交付 · ${idleCount} 待命`),
    ),
    createElement(BossBubble, { text: bossLine(requests, delegations, staff), companyName: config.companyName }),
    createElement('div', { className: 'dsh-org-toolbar' },
      createElement('div', { className: 'dsh-org-filters' },
        FILTERS.map((f) => createElement('button', {
          type: 'button', key: f.id, className: 'dsh-org-filter' + (filter === f.id ? ' active' : ''),
          onClick: () => setFilter(f.id),
        }, f.label)),
      ),
      createElement('div', { className: 'dsh-org-search' },
        createElement('input', { value: query, onChange: (e: any) => setQuery(e.target.value), placeholder: '搜索员工 / 任务 / 交付…' }),
      ),
    ),
    focusStaff ? createElement('div', { className: 'dsh-org-focus' },
      createElement('span', null, '只看 ' + (staffOf(focusStaff, staff)?.name || '员工') + ' 的工位'),
      createElement('button', { type: 'button', onClick: () => setFocusStaff(null) }, '返回全部'),
    ) : null,
    createElement('div', { className: 'dsh-org-body' },
      createElement('div', { className: 'dsh-org-main' },
        createElement('div', { className: 'dsh-org-section-title' },
          createElement('span', null, '牛马办公室'),
          createElement('span', null, visibleStaff.length + ' / ' + staff.length + ' 人'),
        ),
        delegations.length === 0 ? createElement('div', { className: 'dsh-org-empty' }, '暂无真实派活。插件不会生成演示任务；请到主对话发起 subagent / workflow，或点开员工卡复制派活指令。') : null,
        visibleStaff.length === 0 ? createElement('div', { className: 'dsh-org-empty' }, '没有符合条件的员工，换个筛选或搜索词试试。') : null,
        createElement('div', { className: 'dsh-org-staff' },
          visibleStaff.map((st, i) => createElement(StaffCard, {
            key: st.id, staff: st, tasks: tasksMap[st.id] || [], status: statuses[st.id] || 'idle', tick, index: i, query, onOpen: setSelected,
          })),
        ),
      ),
      createElement('div', { className: 'dsh-org-side' },
        createElement(ChatPanel, { messages: chatMessages, events, chatEnabled: config.chatEnabled, onSend: sendMessage }),
      ),
    ),
    selected ? createElement(StaffDetail, {
      staff: selected, status: statuses[selected.id] || 'idle', tasks: tasksMap[selected.id] || [], roles,
      onClose: () => setSelected(null),
      onFocus: (id: string) => { setFocusStaff(id); setSelected(null) },
    }) : null,
  )
}

export function apply(ctx: any, config?: OrgPanelConfig) {
  const slots = ctx && ctx.get ? ctx.get('slots') : undefined
  if (slots === undefined) return
  const timer = ctx && ctx.get ? ctx.get('timer') : undefined
  const normalized = normalizeConfig(config)
  slots.inject('conversation.view', () => slots.register(
    { name: 'conversation.view', id: 'realm', order: 20, label: () => normalized.tabLabel },
    (props: any) => createElement(OrgView, Object.assign({}, props, { timer, config: normalized })),
  ))
}
