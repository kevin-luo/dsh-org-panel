// 「赛博公司」Plugin Runtime（需求文档第八、九章）。
// 完整链路：缺能力 → 搜市场 → 展示（插件/用途/Stars/仓库/权限/风险/安装命令）→ 等老板明确批准 →
// 真实安装 → Capability Scan → Smoke Test → PluginBinding → SkillEvidence → 才算学会。
//
// 三条不可协商的安全约束：
// 1. 审批只能来自人类动作。approve() 是给 UI / CLI 调用的，任何工具参数都无法把请求变成「已批准」，
//    LLM 没有任何一条路径可以自己给自己批准。
// 2. 安装只走当前环境真实可用的 DSH 插件管理工具或 shell 工具（Tool Registry 里的真工具），
//    因此天然经过 DSH 权限模式；运行时没有暴露这类工具时，宁可让老板手动装，也绝不从 host 里绕开权限直接起进程。
// 3. 任何一步没过（Tool 没出现 / Smoke Test 没过），一律不写技能、不记成功证据，只如实标 missing/degraded。
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { EMPLOYEE_BLUEPRINTS } from '../org-blueprints'
import { EvolutionStore } from '../persistence/evolution-store'
import { readCtxService } from '../runtime/ctx-service'
import type { PluginBinding, PluginSource, PluginStatus } from '../persistence/types'
import {
  INTERNAL_TOOL_NAMES, findCommandExecutor, invokeTool, newCapabilities, scanToolRegistry, stringifyToolValue, toolNameSet,
  type CommandExecutor, type RuntimeCapability,
} from './registry'
import { pluginSkillName, skillsUsingPlugin } from './skills'
import { recordExecutionEvidence, recordPluginEvidence, type ExecutionChain, type StepAttestation } from './skill-evidence'

const REQUEST_TOOL = 'staff_plugin_install_request'
const APPLY_TOOL = 'staff_plugin_install_apply'
const VERIFY_TOOL = 'staff_plugin_verify'
const HEALTH_TOOL = 'staff_plugin_health_check'
const EVIDENCE_TOOL = 'staff_skill_evidence'

const DEFAULT_TTL_MS = 7 * 86_400_000
const DEFAULT_INSTALL_TIMEOUT = 180_000
const DEFAULT_SMOKE_TIMEOUT = 45_000
const HEALTH_REFRESH_MS = 3_600_000

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 审批渠道：全部是人类动作。ui = 公司设置里的批准按钮，cli = 运维手动，config = 老板写在 cordis 配置里，host-prompt = DSH 原生审批弹窗。 */
export type ApprovalChannel = 'ui' | 'cli' | 'config' | 'host-prompt'

export type ApprovalDecision = { by: string; at: number; channel: ApprovalChannel; note?: string }

export type SmokeTestSpec = { tool: string; args?: Record<string, unknown>; expect?: string }

export type InstallRequestStatus = 'pending' | 'approved' | 'rejected' | 'installed' | 'verified' | 'failed' | 'expired'

export type InstallRecord = {
  at: number
  ok: boolean
  /** tool:<name> = 走运行时工具（受 DSH 权限模式约束）；manual = 老板自己装；skipped = 配置禁用了自动安装。 */
  via: string
  command: string
  output?: string
  error?: string
}

export type SmokeRecord = { ran: boolean; ok: boolean; tool?: string; via?: string; durationMs?: number; error?: string; output?: string }

export type VerificationRecord = {
  at: number
  status: PluginStatus
  toolsFound: string[]
  toolsMissing: string[]
  newTools: string[]
  /** 声明了、当前也确实存在，但批准那一刻就已经存在 —— 不是这个插件带来的，不许算成它的能力。 */
  rejectedTools?: string[]
  smoke: SmokeRecord
  learned: boolean
  skill?: { id: string; name: string; level: number }
  reason?: string
}

export type InstallRequest = {
  requestId: string
  employeeId: string
  employeeName?: string
  pluginName: string
  packageName: string
  version?: string
  source: PluginSource
  repository?: string
  homepage?: string
  stars?: number
  purpose: string
  permissions: string[]
  risks: string[]
  installCommand: string
  expectedTools: string[]
  smokeTest?: SmokeTestSpec
  skillName: string
  category: string
  createdAt: number
  updatedAt: number
  status: InstallRequestStatus
  decision?: ApprovalDecision
  /**
   * 批准那一刻 Tool Registry 的真实快照。
   * 「现在有、批准时没有」才是这个插件真正新增的能力 —— Smoke Test 的可调用范围就以这个差集为准，
   * 所以 bash / edit 这类批准前就存在的通用工具永远进不了白名单。
   */
  baselineTools?: string[]
  baselineAt?: number
  install?: InstallRecord
  verification?: VerificationRecord
}

/**
 * Phase 3 Company Event Bus 消费的插件/技能事件。这里用结构类型而不是直接 import，
 * 避免 capabilities 与 runtime 互相耦合；host 接线时把 bus.publish 传进 emit 即可。
 */
export type PluginRuntimeEvent =
  | { id: string; type: 'plugin.discovered'; at: number; origin?: string; employeeId?: string; pluginName: string; pluginId?: string; source?: string }
  | { id: string; type: 'plugin.install.started'; at: number; origin?: string; employeeId: string; pluginName: string; pluginId?: string }
  | { id: string; type: 'plugin.installed'; at: number; origin?: string; employeeId: string; pluginName: string; pluginId?: string; ok: boolean }
  | { id: string; type: 'skill.updated'; at: number; origin?: string; employeeId: string; skillName: string; skillId?: string; level?: number; source?: string }

/** 事件草稿：id / at / origin 由 runtime 填。用分发式条件类型保证联合的每一支单独 Omit。 */
export type PluginRuntimeEventDraft = PluginRuntimeEvent extends infer T ? T extends PluginRuntimeEvent ? Omit<T, 'id' | 'at' | 'origin'> : never : never

export type PluginRuntimeConfig = {
  /** 强烈建议传入 host 侧共享的 EvolutionStore 实例；不传则按同一路径新建一个（两个实例并发写同一文件有风险）。 */
  store?: EvolutionStore
  memoryFile?: string
  approvalsFile?: string
  staff?: Array<{ id?: string; name?: string; role?: string }>
  pluginInstall?: {
    /** auto = 有运行时工具就用（默认）；tool = 只允许运行时工具；none = 只登记不自动执行，由老板手动安装。 */
    executor?: 'auto' | 'tool' | 'none'
    timeoutMs?: number
    smokeTimeoutMs?: number
    /** 老板写在 cordis 配置里的预批准包名（人类编辑配置文件即为显式批准）。 */
    preapproved?: string[]
    /**
     * 是否探测 DSH 原生审批弹窗。**默认 false**：DSH 侧并未证实存在 ctx.approvals 一族 API，
     * 把一个恰好叫 request()、恰好返回 true 的对象当成老板签字太危险。
     * 显式打开后仍要求：宿主对象自己声明 isHumanApproval / kind:'human-approval'，
     * 且返回结构化结果（回带 requestId + 人类操作者）。裸 true 一律不算批准。
     */
    probeHostApproval?: boolean
    requestTtlMs?: number
  }
  healthCheckOnStart?: boolean
  /** 真实事件出口：接 Phase 3 的 CompanyEventBus.publish，办公室只消费真实事件。 */
  emit?: (event: PluginRuntimeEvent) => void
}

export type HealthReport = {
  checkedAt: number
  catalogSize: number
  employees: Array<{
    employeeId: string
    plugins: Array<{ pluginId: string; packageName: string; before: PluginStatus; status: PluginStatus; missingTools: string[]; skills: string[] }>
  }>
  changed: number
}

// ---------------------------------------------------------------------------
// 安装命令校验：只允许真实包管理器 + 白名单动作，杜绝命令拼接。
// ---------------------------------------------------------------------------

const SHELL_METACHARS = /[;&|`$<>\n\r\\"']/
const ALLOWED_ACTIONS: Record<string, string[]> = {
  dsh: ['add', 'install'],
  npm: ['install', 'i', 'add'],
  pnpm: ['add', 'install'],
  yarn: ['add'],
  bun: ['add'],
}
const ALLOWED_FLAGS = new Set(['-g', '--global', '--save', '--save-dev', '--save-exact', '-D', '-E', '--dev', '--prod'])
const VALUE_FLAGS = new Set(['--profile'])

// 包名只认两种形态。旧的宽松正则会放行 https://…/payload.tgz、git+ssh://…、file:../../evil，
// 而 `npm install <tarball-url>` 会执行该包的 install 脚本 —— 那是彻头彻尾的任意远程代码执行。
const NPM_PACKAGE_PATTERN = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/
const GITHUB_PACKAGE_PATTERN = /^github:[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/
const VERSION_RANGE_PATTERN = /^[A-Za-z0-9][\w.^~*+-]{0,39}$/

export type PackageToken = { name: string; version?: string }

/**
 * 归一化一个包标识。**只**接受 npm 包名（可带 @version）与 github:owner/repo；
 * 任何 URL、协议前缀（file: / git+ssh: / http(s): …）、相对或绝对路径、tarball 一律返回 null。
 */
export function normalizePackageToken(raw: string): PackageToken | null {
  const token = String(raw || '').trim()
  if (!token || token.length > 214) return null
  if (GITHUB_PACKAGE_PATTERN.test(token)) return { name: token }
  // scope 的 @ 在 0 号位；只有 0 号位之后的 @ 才是版本分隔符。
  const at = token.lastIndexOf('@')
  const name = at > 0 ? token.slice(0, at) : token
  const version = at > 0 ? token.slice(at + 1) : undefined
  if (version !== undefined && !VERSION_RANGE_PATTERN.test(version)) return null
  if (!NPM_PACKAGE_PATTERN.test(name)) return null
  return { name, version }
}

/** 校验并归一化，失败时给出人话解释（拒绝的原因要能直接贴给老板看）。 */
export function assertPackageToken(raw: string, label = '包名'): PackageToken {
  const token = String(raw || '').trim()
  const parsed = normalizePackageToken(token)
  if (parsed) return parsed
  if (/:\/\//.test(token) || /^(file|git|git\+ssh|git\+https|http|https|ssh|ftp|npm|registry|data):/i.test(token)) {
    throw new Error(`${label}不允许是 URL 或带协议前缀的地址（${token}）：远程 tarball / git 仓库会在安装时执行任意脚本。只允许 npm 包名或 github:owner/repo。`)
  }
  if (/^github:/i.test(token)) {
    throw new Error(`不合法的 github 引用（${token}）：只允许 github:owner/repo，不接受分支 / 子路径 / 提交号 / URL。`)
  }
  if (/^[.~/]/.test(token) || token.includes('..') || /[/\\]/.test(token.replace(/^@[^/]+\//, ''))) {
    throw new Error(`${label}不允许是文件路径（${token}）：本地路径安装等于直接执行本地任意代码。只允许 npm 包名或 github:owner/repo。`)
  }
  throw new Error(`不合法的${label}：${token || '(空)'}。只允许 npm 包名（可带 @version）或 github:owner/repo。`)
}

export type ParsedInstallCommand = { binary: string; action: string; packages: string[]; tokens: string[] }

/** 解析并校验安装命令；任何不认识的形状一律拒绝，绝不把老板批准的命令行当成自由 shell。 */
export function parseInstallCommand(command: string): ParsedInstallCommand {
  const text = String(command || '').trim()
  if (!text) throw new Error('安装命令不能为空')
  if (text.length > 400) throw new Error('安装命令过长，拒绝执行')
  if (SHELL_METACHARS.test(text)) throw new Error('安装命令包含 shell 元字符或引号，拒绝执行')
  const tokens = text.split(/\s+/)
  const binary = tokens[0]
  const actions = ALLOWED_ACTIONS[binary]
  if (!actions) throw new Error(`只允许 ${Object.keys(ALLOWED_ACTIONS).join(' / ')} 安装插件，收到：${binary}`)
  let index = 1
  if (binary === 'dsh') {
    if (tokens[1] !== 'plugin') throw new Error('dsh 安装命令必须是 dsh plugin ... add <package>')
    index = 2
  }
  let action = ''
  const packages: string[] = []
  while (index < tokens.length) {
    const token = tokens[index]
    if (VALUE_FLAGS.has(token)) {
      const value = tokens[index + 1] || ''
      if (!/^[\w.-]+$/.test(value)) throw new Error(`参数 ${token} 的取值不合法：${value || '(空)'}`)
      index += 2
      continue
    }
    if (token.startsWith('-')) {
      if (!ALLOWED_FLAGS.has(token)) throw new Error(`不允许的安装参数：${token}`)
      index += 1
      continue
    }
    if (!action && actions.includes(token)) { action = token; index += 1; continue }
    assertPackageToken(token, '安装命令里的包名')
    packages.push(token)
    index += 1
  }
  if (!action) throw new Error(`安装命令缺少 ${actions.join(' / ')} 动作`)
  if (!packages.length) throw new Error('安装命令没有指定要安装的包')
  return { binary, action, packages, tokens }
}

/**
 * 老板批准的是 packageName，真正执行的却是 installCommand —— 两者必须指向同一个包。
 * 不校验的话，「预批准 safe-plugin + installCommand: npm install evil-pkg」就能把 evil-pkg 装进来。
 */
export function assertCommandTargetsPackage(command: string, packageName: string, version?: string): ParsedInstallCommand {
  const parsed = parseInstallCommand(command)
  const approved = assertPackageToken(packageName, '被批准的包名')
  if (parsed.packages.length !== 1) {
    throw new Error(`安装命令只能安装被批准的那一个包，但它要装 ${parsed.packages.length} 个：${parsed.packages.join('、')}。拒绝执行。`)
  }
  const target = assertPackageToken(parsed.packages[0], '安装命令里的包名')
  if (normalizeKey(target.name) !== normalizeKey(approved.name)) {
    throw new Error(`安装命令要装的是 ${target.name}，老板批准的却是 ${approved.name}，两者不一致，拒绝执行。`)
  }
  // 老板批准的如果是一个被钉住的版本，命令就必须把同一个版本钉住。
  // 只在「两边都写了版本」时才比对是不够的：批准 foo@1.0.0、执行 `npm install foo`
  // 会装到 latest，披露卡片给老板看的却是 1.0.0 —— 批的和装的不是同一个东西。
  const wanted = String(version || approved.version || '').trim()
  if (wanted) {
    if (!target.version) {
      throw new Error(`老板批准的是被钉住的版本 ${approved.name}@${wanted}，安装命令却没有指定版本（会装成 latest），拒绝执行。`)
    }
    if (normalizeKey(target.version) !== normalizeKey(wanted)) {
      throw new Error(`安装命令指定的版本 ${target.version} 与被批准的版本 ${wanted} 不一致，拒绝执行。`)
    }
  }
  return parsed
}

// ---------------------------------------------------------------------------
// Smoke Test 边界：staff_plugin_verify 绝不能变成「任意工具 + 任意参数」的调用原语。
// ---------------------------------------------------------------------------

/** 通用 / 高危工具永远不可能是「某个插件本次新增的能力」，一律不许当 Smoke Test 目标。 */
const SMOKE_TOOL_DENY: RegExp[] = [
  /^(bash|sh|zsh|fish|shell|cmd|pwsh|powershell|terminal|console|exec|process|spawn|eval|sudo)$/i,
  /^(run|execute)[_-]?(command|shell|bash|script|code|python|node|js|sql)?$/i,
  /^(edit|write|create|delete|remove|move|copy|rename)[_-]?(file|files|dir|directory|path)?$/i,
  /^(multi[_-]?edit|apply[_-]?patch|str[_-]?replace\w*|notebook[_-]?edit|patch)$/i,
  /^(read|open|cat)[_-]?file$/i,
  /(^|[_-])(rm|rmdir|kill|chmod|chown|curl|wget)([_-]|$)/i,
]
const TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]{0,80}$/
const SMOKE_ARG_MAX_KEYS = 12
const SMOKE_ARG_MAX_BYTES = 2_000
const SMOKE_ARG_MAX_DEPTH = 3
const SMOKE_ARG_MAX_STRING = 512
const SMOKE_ARG_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,39}$/
const SMOKE_ARG_KEY_DENY = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Smoke Test 参数白名单：只允许标量与浅层数组/对象，键名、条数、字符串长度、总字节全部设限。
 * 参数由 LLM 填，所以这里当成不可信输入处理，不给它留一条能塞任意 payload 的通道。
 */
export function sanitizeSmokeArgs(args: unknown): Record<string, unknown> {
  if (args == null) return {}
  if (typeof args !== 'object' || Array.isArray(args)) throw new Error('Smoke Test 参数必须是一个对象')
  const walk = (value: unknown, depth: number, path: string): unknown => {
    if (value === null) return null
    if (typeof value === 'string') {
      if (value.length > SMOKE_ARG_MAX_STRING) throw new Error(`Smoke Test 参数 ${path} 过长（>${SMOKE_ARG_MAX_STRING} 字符）`)
      return value
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`Smoke Test 参数 ${path} 不是有限数字`)
      return value
    }
    if (typeof value === 'boolean') return value
    if (depth >= SMOKE_ARG_MAX_DEPTH) throw new Error(`Smoke Test 参数 ${path} 嵌套过深（最多 ${SMOKE_ARG_MAX_DEPTH} 层）`)
    if (Array.isArray(value)) {
      if (value.length > SMOKE_ARG_MAX_KEYS) throw new Error(`Smoke Test 参数 ${path} 数组过长（最多 ${SMOKE_ARG_MAX_KEYS} 项）`)
      return value.map((item, index) => walk(item, depth + 1, `${path}[${index}]`))
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
      if (entries.length > SMOKE_ARG_MAX_KEYS) throw new Error(`Smoke Test 参数 ${path || '根对象'} 字段过多（最多 ${SMOKE_ARG_MAX_KEYS} 个）`)
      const out: Record<string, unknown> = Object.create(null)
      for (const [key, item] of entries) {
        const full = path ? `${path}.${key}` : key
        if (SMOKE_ARG_KEY_DENY.has(key)) throw new Error(`Smoke Test 参数名不允许：${full}`)
        if (!SMOKE_ARG_KEY_PATTERN.test(key)) throw new Error(`Smoke Test 参数名不合法：${full}`)
        out[key] = walk(item, depth + 1, full)
      }
      return out
    }
    throw new Error(`Smoke Test 参数 ${path} 类型不被允许（只允许字符串 / 数字 / 布尔 / null 与浅层数组、对象）`)
  }
  const clean = walk(args, 0, '') as Record<string, unknown>
  const size = JSON.stringify(clean)?.length ?? 0
  if (size > SMOKE_ARG_MAX_BYTES) throw new Error(`Smoke Test 参数过大（${size} > ${SMOKE_ARG_MAX_BYTES} 字节）`)
  return { ...clean }
}

/** 归一化 Smoke Test 声明：工具名形状 + 通用工具黑名单 + 参数白名单。真正的「是不是这个插件新增的」在验证时按差集判。 */
export function sanitizeSmokeSpec(spec: SmokeTestSpec | undefined | null): SmokeTestSpec | undefined {
  if (!spec || !spec.tool) return undefined
  const tool = String(spec.tool).trim()
  if (!TOOL_NAME_PATTERN.test(tool)) throw new Error(`不合法的 Smoke Test 工具名：${tool}`)
  if (INTERNAL_TOOL_NAMES.has(tool)) throw new Error(`Smoke Test 不允许调用赛博公司自己的工具：${tool}`)
  if (SMOKE_TOOL_DENY.some((pattern) => pattern.test(tool))) {
    throw new Error(`Smoke Test 不允许调用通用 / 高危工具 ${tool}：它不可能是这个插件本次新增的能力，staff_plugin_verify 也不是任意工具调用入口。`)
  }
  return { tool, args: sanitizeSmokeArgs(spec.args), expect: spec.expect ? clip(String(spec.expect), 200) : undefined }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function now() { return Date.now() }
function newId(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }
function unique(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
}
function clip(value: unknown, max = 1200): string {
  const text = String(value ?? '').trim()
  return text.length > max ? text.slice(0, max) + '…' : text
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function normalizeKey(value: string) { return String(value || '').trim().toLowerCase() }

function splitVersion(packageName: string): { name: string; version?: string } {
  const text = String(packageName || '').trim()
  const at = text.lastIndexOf('@')
  if (at > 0 && /^[\w.^~>=<-]+$/.test(text.slice(at + 1))) return { name: text.slice(0, at), version: text.slice(at + 1) }
  return { name: text }
}

function isStoreLike(value: unknown): value is EvolutionStore {
  const store = value as any
  return !!store && typeof store.bindPlugin === 'function' && typeof store.addEvidence === 'function' && typeof store.learnSkill === 'function'
}

function rosterOf(config?: PluginRuntimeConfig): Array<{ id: string; name: string }> {
  const rows = Array.isArray(config?.staff) && config?.staff?.length ? config!.staff! : EMPLOYEE_BLUEPRINTS
  return rows
    .map((row: any) => ({ id: String(row?.id || row?.roleId || ''), name: String(row?.name || row?.id || '') }))
    .filter((row) => !!row.id)
}

// ---------------------------------------------------------------------------
// 审批台账：独立文件，不写 evolution.json，也永远不含任何密钥。
// ---------------------------------------------------------------------------

type LedgerFile = { version: 1; requests: InstallRequest[] }

class ApprovalLedger {
  readonly filePath: string
  private queue: Promise<void> = Promise.resolve()

  constructor(filePath?: string) {
    this.filePath = filePath || process.env.DSH_ORG_PANEL_PLUGIN_APPROVALS_FILE || join(homedir(), '.dsh-org-panel', 'plugin-approvals.json')
  }

  /** 每次都重新读盘：UI / CLI / 另一个进程写进来的批准结果必须立刻可见。 */
  async read(ttlMs: number): Promise<InstallRequest[]> {
    let raw = ''
    try { raw = await readFile(this.filePath, 'utf-8') } catch { raw = '' }
    if (!raw.trim()) return []
    let parsed: any
    try { parsed = JSON.parse(raw) } catch { return [] }
    const rows = Array.isArray(parsed?.requests) ? parsed.requests : []
    const time = now()
    return rows.map((row: any) => sanitizeRequest(row, time, ttlMs)).filter(Boolean) as InstallRequest[]
  }

  /** 串行读改写，避免并发覆盖；写入走 tmp + rename 原子替换。 */
  mutate<T>(ttlMs: number, work: (rows: InstallRequest[]) => Promise<T> | T): Promise<T> {
    let resolveResult: (value: T | PromiseLike<T>) => void = () => undefined
    let rejectResult: (reason?: unknown) => void = () => undefined
    const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
    this.queue = this.queue.then(async () => {
      try {
        const rows = await this.read(ttlMs)
        const value = await work(rows)
        await this.persist(rows)
        resolveResult(value)
      } catch (error) {
        rejectResult(error)
      }
    })
    return result
  }

  private async persist(rows: InstallRequest[]) {
    const file: LedgerFile = { version: 1, requests: rows.slice(-200) }
    await mkdir(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.tmp`
    await writeFile(temp, JSON.stringify(file, null, 2), 'utf-8')
    await rename(temp, this.filePath)
  }
}

const REQUEST_STATUS: InstallRequestStatus[] = ['pending', 'approved', 'rejected', 'installed', 'verified', 'failed', 'expired']
const PLUGIN_SOURCES: PluginSource[] = ['dsh-market', 'github', 'mcp', 'builtin']
const APPROVAL_CHANNELS: ApprovalChannel[] = ['ui', 'cli', 'config', 'host-prompt']
/** 只有这些状态代表「老板批准过、并且已经进入安装流程」，也只有它们能验证。 */
const VERIFIABLE_STATUS: ReadonlySet<InstallRequestStatus> = new Set<InstallRequestStatus>(['approved', 'installed', 'verified', 'failed'])
/** 带审批记录、但还没走完验证的状态：批准是有有效期的，逾期未验证一律作废重走审批。 */
const APPROVAL_WINDOW_STATUS: ReadonlySet<InstallRequestStatus> = new Set<InstallRequestStatus>(['approved', 'installed', 'failed'])
const BASELINE_LIMIT = 600

function sanitizeRequest(raw: any, time: number, ttlMs: number): InstallRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const requestId = String(raw.requestId || '').trim()
  const employeeId = String(raw.employeeId || '').trim()
  const packageName = String(raw.packageName || '').trim()
  if (!requestId || !employeeId || !packageName) return null
  const decision = raw.decision && typeof raw.decision === 'object' && APPROVAL_CHANNELS.includes(raw.decision.channel)
    ? { by: String(raw.decision.by || 'boss'), at: Number(raw.decision.at) || time, channel: raw.decision.channel as ApprovalChannel, note: raw.decision.note ? String(raw.decision.note) : undefined }
    : undefined
  let status: InstallRequestStatus = REQUEST_STATUS.includes(raw.status) ? raw.status : 'pending'
  // 台账里没有合法审批记录却写着已批准/已安装 —— 一律降级回 pending，防止被伪造。
  if (status !== 'pending' && status !== 'rejected' && status !== 'expired' && !decision) status = 'pending'
  const createdAt = Number(raw.createdAt) > 0 ? Number(raw.createdAt) : time
  if (status === 'pending' && ttlMs > 0 && time - createdAt > ttlMs) status = 'expired'
  // 批准同样有 TTL：批准 → 安装 → 验证必须在窗口内走完。
  // 否则一条陈年批准就是一张永久有效的「可以调用这个插件工具」的通行证，老板早就忘了它的存在。
  if (ttlMs > 0 && decision && APPROVAL_WINDOW_STATUS.has(status) && time - decision.at > ttlMs) status = 'expired'
  return {
    requestId, employeeId,
    employeeName: raw.employeeName ? String(raw.employeeName) : undefined,
    pluginName: String(raw.pluginName || packageName),
    packageName,
    version: raw.version ? String(raw.version) : undefined,
    source: PLUGIN_SOURCES.includes(raw.source) ? raw.source : 'dsh-market',
    repository: raw.repository ? String(raw.repository) : undefined,
    homepage: raw.homepage ? String(raw.homepage) : undefined,
    stars: Number(raw.stars) > 0 ? Number(raw.stars) : undefined,
    purpose: String(raw.purpose || ''),
    permissions: Array.isArray(raw.permissions) ? unique(raw.permissions) : [],
    risks: Array.isArray(raw.risks) ? unique(raw.risks) : [],
    installCommand: String(raw.installCommand || ''),
    expectedTools: Array.isArray(raw.expectedTools) ? unique(raw.expectedTools) : [],
    smokeTest: raw.smokeTest && typeof raw.smokeTest === 'object' && raw.smokeTest.tool
      ? { tool: String(raw.smokeTest.tool), args: raw.smokeTest.args && typeof raw.smokeTest.args === 'object' ? raw.smokeTest.args : undefined, expect: raw.smokeTest.expect ? String(raw.smokeTest.expect) : undefined }
      : undefined,
    skillName: String(raw.skillName || raw.pluginName || packageName),
    category: String(raw.category || '插件能力'),
    createdAt,
    updatedAt: Number(raw.updatedAt) > 0 ? Number(raw.updatedAt) : createdAt,
    status, decision,
    baselineTools: Array.isArray(raw.baselineTools) ? unique(raw.baselineTools).slice(0, BASELINE_LIMIT) : undefined,
    baselineAt: Number(raw.baselineAt) > 0 ? Number(raw.baselineAt) : undefined,
    install: raw.install && typeof raw.install === 'object' ? raw.install as InstallRecord : undefined,
    verification: raw.verification && typeof raw.verification === 'object' ? raw.verification as VerificationRecord : undefined,
  }
}

/**
 * 宿主必须显式声明「这个通道后面站着一个真人」。
 * 没有这个标记，我们就无法区分「人类审批框」和「一个恰好叫 request() 的普通函数」。
 */
export function isDeclaredHumanApprovalChannel(owner: any): boolean {
  if (!owner || typeof owner !== 'object') return false
  return owner.isHumanApproval === true || owner.humanApproval === true
    || owner.kind === 'human-approval' || owner.channel === 'human-approval'
}

/**
 * 从宿主审批通道的返回值里读出「人真的点了同意」。
 * 裸 true / 'approved' / 缺 requestId / 缺人类操作者，一律不算批准 —— API 恰好返回真值不是老板的意思表示。
 */
export function readHumanApproval(value: unknown, requestId: string): ApprovalDecision | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const approved = row.approved === true || row.decision === 'approved' || row.result === 'approved'
  if (!approved) return null
  if (String(row.requestId || '').trim() !== String(requestId || '').trim()) return null
  const by = String(row.by || row.actor || row.user || '').trim()
  if (!by) return null
  return { by, at: now(), channel: 'host-prompt', note: row.note ? clip(String(row.note), 200) : undefined }
}

/** 老板看到的披露卡片：插件 / 用途 / Stars / 仓库 / 权限 / 风险 / 安装命令（需求文档第八章）。 */
export function renderProposalCard(request: InstallRequest): string {
  const lines = [
    `[[NIUMA_PLUGIN_APPROVAL id="${request.requestId}" status="${request.status}"]]`,
    `插件：${request.pluginName}（${request.packageName}${request.version ? '@' + request.version : ''}）`,
    `申请人：${request.employeeName || request.employeeId}`,
    `用途：${request.purpose || '未说明'}`,
    `Stars：${typeof request.stars === 'number' ? request.stars : '未知'}`,
    `仓库：${request.repository || request.homepage || '未提供'}`,
    `权限：${request.permissions.length ? request.permissions.join('、') : '插件未声明'}`,
    `风险：${request.risks.length ? request.risks.join('、') : '未评估（第三方代码默认按不可信处理）'}`,
    `安装命令：${request.installCommand}`,
    `预期出现的工具：${request.expectedTools.length ? request.expectedTools.join('、') : '未声明（将按安装前后的 Tool Registry 差集判定）'}`,
    `Smoke Test：${request.smokeTest ? `${request.smokeTest.tool}(${JSON.stringify(request.smokeTest.args || {})})` : '未提供（没有冒烟测试就不会标记为已学会）'}`,
  ]
  if (request.status === 'pending') lines.push('', '⚠ 现在还没有安装。需要老板在「公司设置 → 插件」点击批准（或运维显式批准）后，员工才能执行 staff_plugin_install_apply。')
  if (request.decision) lines.push('', `审批：${request.status === 'rejected' ? '已拒绝' : '已批准'} · ${request.decision.by} · ${request.decision.channel}${request.decision.note ? ' · ' + request.decision.note : ''}`)
  if (request.install) lines.push('', `安装：${request.install.ok ? '成功' : '失败'} · ${request.install.via}${request.install.error ? ' · ' + request.install.error : ''}`)
  if (request.verification) {
    const verification = request.verification
    lines.push('', `验证：status=${verification.status} · 工具${verification.toolsFound.length ? '：' + verification.toolsFound.join('、') : '未出现'} · Smoke=${verification.smoke.ran ? (verification.smoke.ok ? '通过' : '失败') : '未执行'} · ${verification.learned ? `已计入技能 ${verification.skill?.name} Lv.${verification.skill?.level}` : '未标记为已学会'}`)
    if (verification.reason) lines.push(`说明：${verification.reason}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Plugin Runtime
// ---------------------------------------------------------------------------

export class PluginRuntime {
  private readonly ctx: any
  private readonly tools: any
  private readonly store: EvolutionStore
  private readonly ledger: ApprovalLedger
  private readonly config: PluginRuntimeConfig
  private readonly ttlMs: number

  constructor(ctx: any, config: PluginRuntimeConfig = {}) {
    this.ctx = ctx
    this.tools = ctx?.tools
    this.config = config
    // 结构判断而不是 instanceof：打包后可能存在两份类定义，instanceof 失手会静默造出第二个写者，
    // 两个 EvolutionStore 实例写同一个 evolution.json 会互相覆盖。
    this.store = isStoreLike(config.store) ? config.store : new EvolutionStore(config.memoryFile)
    this.ledger = new ApprovalLedger(config.approvalsFile)
    this.ttlMs = Number(config.pluginInstall?.requestTtlMs) > 0 ? Number(config.pluginInstall?.requestTtlMs) : DEFAULT_TTL_MS
  }

  get approvalsFile() { return this.ledger.filePath }

  /** 往公司事件总线投一条真实事件；监听方抛错不影响插件流程。 */
  private emit(event: PluginRuntimeEventDraft) {
    const sink = this.config.emit
    if (typeof sink !== 'function') return
    try { sink({ ...event, id: newId('evt'), at: now(), origin: 'host' } as PluginRuntimeEvent) } catch (error) {
      this.ctx?.logger?.debug?.(`dsh-org-panel: plugin event sink failed: ${errorText(error)}`)
    }
  }

  async catalog(includeInternal = false): Promise<RuntimeCapability[]> {
    return scanToolRegistry(this.tools, { includeInternal })
  }

  async requests(filter: { employeeId?: string; status?: InstallRequestStatus } = {}): Promise<InstallRequest[]> {
    const rows = await this.ledger.read(this.ttlMs)
    return rows.filter((row) => (!filter.employeeId || row.employeeId === filter.employeeId) && (!filter.status || row.status === filter.status))
  }

  async request(requestId: string): Promise<InstallRequest | null> {
    const rows = await this.ledger.read(this.ttlMs)
    return rows.find((row) => row.requestId === requestId) || null
  }

  /** 登记一条安装申请。只披露、只落台账，绝不安装。 */
  async submit(input: {
    employeeId: string
    employeeName?: string
    pluginName: string
    packageName: string
    version?: string
    source?: PluginSource
    repository?: string
    homepage?: string
    stars?: number
    purpose: string
    permissions?: string[]
    risks?: string[]
    installCommand: string
    expectedTools?: string[]
    smokeTest?: SmokeTestSpec
    skillName?: string
    category?: string
  }): Promise<InstallRequest> {
    const employeeId = String(input.employeeId || '').trim()
    if (!employeeId) throw new Error('plugin install request requires employeeId')
    // S2 / S3：包名必须是合法 npm 包名或 github:owner/repo，且安装命令要装的就是这个包 —— 审批与执行必须同一个目标。
    const split = assertPackageToken(input.packageName, '包名')
    assertCommandTargetsPackage(input.installCommand, split.name, input.version || split.version)
    const smokeTest = sanitizeSmokeSpec(input.smokeTest)
    // 批准前先拍一张 Tool Registry 快照：之后只有「快照里没有、现在有」的工具才算这个插件带来的能力。
    const baselineTools = Array.from(await toolNameSet(this.tools)).slice(0, BASELINE_LIMIT)
    const time = now()
    const request: InstallRequest = {
      requestId: newId('req'),
      employeeId,
      employeeName: input.employeeName,
      pluginName: String(input.pluginName || split.name).trim() || split.name,
      packageName: split.name,
      version: input.version || split.version,
      source: PLUGIN_SOURCES.includes(input.source as PluginSource) ? (input.source as PluginSource) : 'dsh-market',
      repository: input.repository,
      homepage: input.homepage,
      stars: Number(input.stars) > 0 ? Number(input.stars) : undefined,
      purpose: String(input.purpose || '').trim(),
      permissions: unique(input.permissions || []),
      risks: unique(input.risks || []),
      installCommand: String(input.installCommand).trim(),
      expectedTools: unique(input.expectedTools || []),
      smokeTest,
      skillName: pluginSkillName({ skillName: input.skillName, pluginName: input.pluginName, packageName: split.name }),
      category: String(input.category || '插件能力'),
      createdAt: time, updatedAt: time, status: 'pending',
      baselineTools, baselineAt: time,
    }
    await this.ledger.mutate(this.ttlMs, (rows) => { rows.push(request); return request })
    this.emit({ type: 'plugin.discovered', employeeId: request.employeeId, pluginName: request.pluginName, pluginId: request.packageName, source: request.source })
    const preapproved = this.preapprovalOf(request)
    if (preapproved) return this.approve(request.requestId, preapproved)
    const hostDecision = await this.askHostApproval(request)
    if (hostDecision) return this.approve(request.requestId, hostDecision)
    return request
  }

  /** 老板在配置文件里预先批准的包名 —— 编辑配置文件本身就是人类动作。 */
  private preapprovalOf(request: InstallRequest): ApprovalDecision | null {
    const rows = unique(this.config.pluginInstall?.preapproved || [])
    if (!rows.length) return null
    const target = normalizeKey(request.packageName)
    const hit = rows.some((row) => {
      const key = normalizeKey(row)
      return key === target || key === `${target}@${normalizeKey(request.version || '')}`
    })
    return hit ? { by: 'boss', at: now(), channel: 'config', note: 'cordis 配置内预批准' } : null
  }

  /**
   * 探测 DSH 原生审批弹窗。**默认关闭**（probeHostApproval 必须显式写 true）。
   *
   * 之前这里是一个洞：任意鸭子类型对象（ctx.approvals/approval/permissions/permission）随便返回个裸 true，
   * 就被当成「老板点了同意」。而 DSH 侧根本没有被证实存在这些 API（侦察简报里没有），
   * 一个恰好叫 request()、恰好返回 true 的普通函数就能替老板签字。
   *
   * 现在两道门都得过：
   * 1. 宿主必须**显式声明**这个通道是人类审批（isHumanApproval / kind:'human-approval' 之类的标记），
   *    没声明的对象一律不问；
   * 2. 返回值必须是结构化对象，回带本次 requestId 并给出人类操作者。裸 true / 'approved' / 空对象一律不算。
   *
   * 为什么本轮**没有删掉它**：赛博公司现在确实有了真实的人类审批通道（/org-panel RPC 频道 →
   * 老板在「公司设置 → 插件」点击批准），但那条通道要求宿主提供 connection 传输层。
   * 不满足的部署形态下，宿主自带的原生审批弹窗仍然是唯一可能的人类通道。
   * 它默认关闭、且两道自证门槛不动，保留它不放宽任何审批语义。
   *
   * 探测本身必须 crash-safe：真实 cordis Context 上直接读 `ctx.approvals` 会抛
   * `cannot get property "approvals" without inject`，所以一律走 readCtxService。
   */
  private async askHostApproval(request: InstallRequest): Promise<ApprovalDecision | null> {
    if (this.config.pluginInstall?.probeHostApproval !== true) return null
    const owners: Array<[any, string]> = [
      [readCtxService(this.ctx, 'approvals'), 'request'], [readCtxService(this.ctx, 'approval'), 'request'],
      [readCtxService(this.ctx, 'permissions'), 'request'], [readCtxService(this.ctx, 'permission'), 'request'],
    ]
    const payload = {
      kind: 'plugin-install',
      requestId: request.requestId,
      title: `安装第三方插件：${request.pluginName}`,
      description: renderProposalCard(request),
      command: request.installCommand,
      packageName: request.packageName,
      permissions: request.permissions,
      risks: request.risks,
    }
    for (const [owner, key] of owners) {
      const fn = owner?.[key]
      if (typeof fn !== 'function') continue
      if (!isDeclaredHumanApprovalChannel(owner)) {
        this.ctx?.logger?.debug?.('dsh-org-panel: host approval channel is not declared as human approval, skipped')
        continue
      }
      try {
        const decision = readHumanApproval(await Promise.resolve(fn.call(owner, payload)), request.requestId)
        if (decision) return decision
        this.ctx?.logger?.debug?.('dsh-org-panel: host approval channel did not return a human decision, treated as not approved')
        return null
      } catch (error) {
        this.ctx?.logger?.debug?.(`dsh-org-panel: host approval probe failed: ${errorText(error)}`)
      }
    }
    return null
  }

  /**
   * 批准安装。只能被真实的人类动作触发（公司设置里的按钮 / 运维 CLI / 配置预批准 / DSH 原生弹窗），
   * 没有任何工具参数能走到这里 —— LLM 无法自我批准。
   */
  async approve(requestId: string, actor: Partial<ApprovalDecision> = {}): Promise<InstallRequest> {
    const channel: ApprovalChannel = APPROVAL_CHANNELS.includes(actor.channel as ApprovalChannel) ? (actor.channel as ApprovalChannel) : 'ui'
    // 批准这一刻的 Tool Registry 才是真正的基线：批准之后新出现的工具，才可能是这个插件带来的。
    const baselineTools = Array.from(await toolNameSet(this.tools)).slice(0, BASELINE_LIMIT)
    return this.ledger.mutate(this.ttlMs, (rows) => {
      const request = rows.find((row) => row.requestId === requestId)
      if (!request) throw new Error(`unknown plugin install request: ${requestId}`)
      if (request.status !== 'pending') throw new Error(`该安装申请当前状态为 ${request.status}，不能重复审批`)
      // 批准的是「这个包 + 这条命令」的组合，落锤前再校一次，避免台账被改成批 A 装 B。
      assertCommandTargetsPackage(request.installCommand, request.packageName, request.version)
      request.status = 'approved'
      request.decision = { by: String(actor.by || 'boss'), at: Number(actor.at) > 0 ? Number(actor.at) : now(), channel, note: actor.note }
      request.baselineTools = baselineTools
      request.baselineAt = now()
      request.updatedAt = now()
      return request
    })
  }

  async reject(requestId: string, actor: Partial<ApprovalDecision> = {}): Promise<InstallRequest> {
    const channel: ApprovalChannel = APPROVAL_CHANNELS.includes(actor.channel as ApprovalChannel) ? (actor.channel as ApprovalChannel) : 'ui'
    return this.ledger.mutate(this.ttlMs, (rows) => {
      const request = rows.find((row) => row.requestId === requestId)
      if (!request) throw new Error(`unknown plugin install request: ${requestId}`)
      request.status = 'rejected'
      request.decision = { by: String(actor.by || 'boss'), at: now(), channel, note: actor.note }
      request.updatedAt = now()
      return request
    })
  }

  private async patch(requestId: string, patch: Partial<InstallRequest>): Promise<InstallRequest> {
    return this.ledger.mutate(this.ttlMs, (rows) => {
      const request = rows.find((row) => row.requestId === requestId)
      if (!request) throw new Error(`unknown plugin install request: ${requestId}`)
      Object.assign(request, patch, { updatedAt: now() })
      return request
    })
  }

  /** 执行安装：必须已经批准；只走运行时真实工具，因此天然受 DSH 权限模式约束。 */
  async install(requestId: string): Promise<InstallRequest> {
    const request = await this.request(requestId)
    if (!request) throw new Error(`unknown plugin install request: ${requestId}`)
    if (request.status === 'pending') throw new Error(`安装申请 ${requestId} 还没有得到老板批准，禁止安装。请把披露卡片交给老板，由老板在「公司设置 → 插件」点击批准。`)
    if (request.status === 'rejected') throw new Error(`安装申请 ${requestId} 已被老板拒绝。`)
    if (request.status === 'expired') throw new Error(`安装申请 ${requestId} 已过期，请重新提交并重新获得批准。`)
    if (!request.decision) throw new Error(`安装申请 ${requestId} 没有有效的审批记录，拒绝安装。`)
    if (request.status === 'verified') return request
    // 执行前最后一道闸：真正要装的包必须就是老板批准的那个包。
    assertCommandTargetsPackage(request.installCommand, request.packageName, request.version)
    const before = await toolNameSet(this.tools)
    this.emit({ type: 'plugin.install.started', employeeId: request.employeeId, pluginName: request.pluginName, pluginId: request.packageName })
    const record = request.status === 'installed' && request.install?.ok ? request.install : await this.runInstall(request)
    const updated = await this.patch(requestId, { install: record, status: record.ok ? 'installed' : 'failed' })
    this.emit({ type: 'plugin.installed', employeeId: request.employeeId, pluginName: request.pluginName, pluginId: request.packageName, ok: record.ok })
    if (!record.ok) return updated
    return this.verifyRequest(requestId, before)
  }

  private async runInstall(request: InstallRequest): Promise<InstallRecord> {
    const mode = this.config.pluginInstall?.executor || 'auto'
    const time = now()
    if (mode === 'none') {
      return { at: time, ok: false, via: 'skipped', command: request.installCommand, error: '当前配置为只登记不自动安装，请老板手动执行安装命令后运行 staff_plugin_verify。' }
    }
    const catalog = await scanToolRegistry(this.tools, { includeInternal: true })
    const executor: CommandExecutor | null = findCommandExecutor(this.tools, catalog)
    if (!executor) {
      return {
        at: time, ok: false, via: 'manual', command: request.installCommand,
        error: '当前运行时没有暴露 DSH 插件管理工具或 shell 工具，host 不会绕开 DSH 权限模式自己起进程。请老板在终端执行该命令后运行 staff_plugin_verify。',
      }
    }
    const timeoutMs = Number(this.config.pluginInstall?.timeoutMs) > 0 ? Number(this.config.pluginInstall?.timeoutMs) : DEFAULT_INSTALL_TIMEOUT
    const invocation = await invokeTool(this.tools, executor.name, { [executor.argumentKey]: request.installCommand }, { timeoutMs })
    // 这是宿主亲自发起的一次真实调用 → 可以给技能证据背书。
    if (invocation.via !== 'none') this.pushSignal(executor.name, invocation.ok, `install:${request.packageName}`, invocation.durationMs)
    return {
      at: time, ok: invocation.ok, via: `tool:${executor.name}(${invocation.via})`, command: request.installCommand,
      output: clip(stringifyToolValue(invocation.value)), error: invocation.error,
    }
  }

  /**
   * Capability Scan + Smoke Test + PluginBinding + SkillEvidence。before 为空表示是重启后的补验证。
   *
   * 状态闸门（S1a）：光看 decision 存不存在是错的 —— reject() 同样会写 decision，
   * 那等于「被老板拒绝的申请照样能验证」，而验证会真的去调工具。所以这里必须看 status。
   */
  async verifyRequest(requestId: string, before?: ReadonlySet<string>, overrideSmoke?: SmokeTestSpec): Promise<InstallRequest> {
    const request = await this.request(requestId)
    if (!request) throw new Error(`unknown plugin install request: ${requestId}`)
    if (!request.decision) throw new Error(`安装申请 ${requestId} 没有审批记录，拒绝验证。`)
    if (request.status === 'rejected') {
      throw new Error(`安装申请 ${requestId} 已被老板拒绝，禁止验证。（被拒绝的申请同样带有 decision 记录，decision 存在不等于批准。）`)
    }
    if (request.status === 'expired') throw new Error(`安装申请 ${requestId} 的批准已过期，请重新提交并重新获得批准。`)
    if (!VERIFIABLE_STATUS.has(request.status)) {
      throw new Error(`安装申请 ${requestId} 当前状态为 ${request.status}，只有老板已批准并进入安装流程的申请才能验证。`)
    }
    const smokeSpec = sanitizeSmokeSpec(overrideSmoke?.tool ? overrideSmoke : request.smokeTest)
    const verification = await this.runVerification(request, smokeSpec, before)
    return this.patch(requestId, {
      verification, smokeTest: smokeSpec,
      status: verification.status === 'available' ? 'verified' : request.install?.ok ? 'installed' : request.status,
    })
  }

  private async runVerification(request: InstallRequest, smokeSpec: SmokeTestSpec | undefined, before?: ReadonlySet<string>): Promise<VerificationRecord> {
    const time = now()
    const catalog = await scanToolRegistry(this.tools, { includeInternal: true })
    const present = new Set(catalog.map((item) => item.name))
    const baseline = new Set(request.baselineTools || [])
    const expected = unique(request.expectedTools)
    const appeared = before ? newCapabilities(before, catalog).map((item) => item.name) : []
    const priorTools = unique([...(request.verification?.newTools || []), ...(request.verification?.toolsFound || [])])

    // 能力归属：现在真的存在 + 批准那一刻还不存在 = 这个插件带来的。
    // expectedTools 是 LLM 写、老板在披露卡片上看过的，只有存在基线快照能证明「批准时确实没有」时才采信；
    // 没有基线快照就只认安装前后的真实差集，宁可少认也不许把 bash 认成插件能力。
    const attributable = (name: string) => present.has(name) && !INTERNAL_TOOL_NAMES.has(name) && !baseline.has(name)
    const claimed = unique([...appeared, ...priorTools, ...(baseline.size ? expected : [])])
    const attributed = claimed.filter(attributable)
    const rejectedTools = claimed.filter((name) => present.has(name) && !attributable(name))
    const toolsMissing = expected.filter((name) => !attributed.includes(name))
    // Smoke Test 只能打这个插件真实新增的工具，再叠一层通用/高危工具黑名单。
    const smokeAllowed = attributed.filter((name) => !SMOKE_TOOL_DENY.some((pattern) => pattern.test(name)))

    const smoke: SmokeRecord = { ran: false, ok: false, tool: smokeSpec?.tool }
    let status: PluginStatus = 'missing'
    let reason: string | undefined

    if (!attributed.length) {
      reason = expected.length
        ? `Capability Scan 未在 Tool Registry 找到可归属于本插件的新工具（声明的是：${expected.join('、')}）。插件可能需要重启 DSH 才会加载，重启后请再运行 ${VERIFY_TOOL}。`
        : `Capability Scan 没有发现任何新工具。插件可能需要重启 DSH 才会加载，重启后请再运行 ${VERIFY_TOOL}。`
      if (rejectedTools.length) reason += `（${rejectedTools.join('、')} 在批准之前就已经存在，不是这个插件带来的，不予计入。）`
    } else if (!smokeSpec?.tool) {
      status = 'degraded'
      reason = `工具已出现（${attributed.join('、')}），但没有提供 Smoke Test，按未验证处理，不计入技能。请带上 smokeTest 重新运行 ${VERIFY_TOOL}。`
    } else if (!present.has(smokeSpec.tool)) {
      status = 'degraded'
      reason = `Smoke Test 指定的工具 ${smokeSpec.tool} 不在当前 Tool Registry 中。`
    } else if (!smokeAllowed.includes(smokeSpec.tool)) {
      // 这是 S1b：不命中就直接拒绝，绝不调用。staff_plugin_verify 不是任意工具调用入口。
      status = 'degraded'
      reason = `Smoke Test 只允许调用本插件本次真实新增的工具（当前可选：${smokeAllowed.join('、') || '无'}），${smokeSpec.tool} 不在其中，已拒绝调用。`
    } else {
      const timeoutMs = Number(this.config.pluginInstall?.smokeTimeoutMs) > 0 ? Number(this.config.pluginInstall?.smokeTimeoutMs) : DEFAULT_SMOKE_TIMEOUT
      const invocation = await invokeTool(this.tools, smokeSpec.tool, sanitizeSmokeArgs(smokeSpec.args), { timeoutMs })
      smoke.ran = invocation.via !== 'none'
      smoke.ok = invocation.ok
      smoke.via = invocation.via
      smoke.durationMs = invocation.durationMs
      smoke.error = invocation.error
      smoke.output = clip(stringifyToolValue(invocation.value), 800)
      // 真实调用过 → 记一条执行信号，这是 staff_skill_evidence 唯一能引用的东西。
      if (smoke.ran) this.pushSignal(smokeSpec.tool, smoke.ok, 'smoke-test', invocation.durationMs)
      if (!smoke.ran) { status = 'degraded'; reason = `当前运行时无法从 host 侧发起 Smoke Test（${invocation.error || '缺少调用入口'}），保持未验证状态。` }
      else if (!smoke.ok) { status = 'degraded'; reason = `Smoke Test 失败：${invocation.error || '未知错误'}` }
      else status = 'available'
    }

    const split = splitVersion(request.packageName)
    await this.store.bindPlugin(request.employeeId, {
      pluginId: split.name || request.packageName,
      packageName: request.packageName,
      version: request.version || split.version,
      source: request.source,
      tools: attributed,
      status,
      installedAt: request.install?.at || time,
      lastVerifiedAt: time,
    })

    const record: VerificationRecord = {
      at: time, status, toolsFound: attributed, toolsMissing, newTools: appeared,
      rejectedTools: rejectedTools.length ? rejectedTools : undefined,
      smoke, learned: false, reason,
    }
    if (status === 'available') {
      const skill = await this.store.learnSkill(request.employeeId, {
        name: request.skillName, category: request.category,
        summary: `${request.pluginName}：${request.purpose}`.trim(),
        source: 'plugin', toolNames: attributed, pluginNames: [request.packageName],
      })
      const row = await recordPluginEvidence(this.store, {
        employeeId: request.employeeId, skillName: request.skillName, packageName: request.packageName,
        tool: smoke.tool, success: true, durationMs: smoke.durationMs,
      })
      record.learned = true
      record.skill = { id: row?.skillId || skill.id, name: request.skillName, level: row?.level ?? skill.level }
      this.emit({ type: 'skill.updated', employeeId: request.employeeId, skillName: request.skillName, skillId: record.skill.id, level: record.skill.level, source: 'plugin' })
    } else if (smoke.ran && !smoke.ok) {
      // Smoke Test 真实失败也是真实证据；但技能不存在时不会凭空新建（未验证不许显示已学会）。
      await recordPluginEvidence(this.store, {
        employeeId: request.employeeId, skillName: request.skillName, packageName: request.packageName,
        tool: smoke.tool, success: false, durationMs: smoke.durationMs,
      })
    }
    return record
  }

  /** 重启后 / 手动安装后的补验证：按员工 + 插件定位最近一条**仍然有效**的已批准申请（被拒 / 过期的不算）。 */
  async verifyBinding(employeeId: string, pluginId: string, smoke?: SmokeTestSpec): Promise<InstallRequest> {
    const rows = await this.requests({ employeeId })
    const key = normalizeKey(pluginId)
    const matched = rows.filter((row) => normalizeKey(row.packageName) === key || normalizeKey(row.pluginName) === key)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const request = matched.find((row) => !!row.decision && VERIFIABLE_STATUS.has(row.status))
    if (!request) {
      const seen = matched.length ? `（找到 ${matched.length} 条同名申请，状态分别是：${matched.map((row) => row.status).join('、')}）` : ''
      throw new Error(`没有找到 ${employeeId} 对 ${pluginId} 仍然有效的已批准安装申请，无法验证。${seen}`)
    }
    return this.verifyRequest(request.requestId, undefined, smoke)
  }

  /**
   * 插件健康检查（需求文档第九章）：每次 Runtime 启动扫一次当前 Tool Registry，
   * 绑定里的工具全在 = available，部分在 = degraded，全不在 = missing。
   * 技能历史一律保留，只更新可用性；手动 disabled 的绑定不自动翻转。
   */
  /**
   * 最近一次真实跑过的健康检查结果。
   * 从来没跑过就是 null —— 设置页会显示「未检查」，不会拿 catalog 大小冒充一次检查。
   */
  lastHealthReport(): HealthReport | null { return this.lastReport }
  private lastReport: HealthReport | null = null

  async healthCheck(employeeIds?: string[]): Promise<HealthReport> {
    const catalog = await scanToolRegistry(this.tools, { includeInternal: true })
    const present = new Set(catalog.map((item) => item.name))
    const profiles = await this.store.profiles(employeeIds && employeeIds.length ? employeeIds : undefined)
    const time = now()
    const report: HealthReport = { checkedAt: time, catalogSize: catalog.length, employees: [], changed: 0 }
    for (const [employeeId, profile] of Object.entries(profiles)) {
      const bindings: PluginBinding[] = profile.pluginBindings || []
      if (!bindings.length) continue
      const rows: HealthReport['employees'][number]['plugins'] = []
      for (const binding of bindings) {
        if (binding.status === 'disabled') { rows.push({ pluginId: binding.pluginId, packageName: binding.packageName, before: binding.status, status: binding.status, missingTools: [], skills: [] }); continue }
        const lost = binding.tools.filter((name) => !present.has(name))
        const status: PluginStatus = !binding.tools.length ? 'missing' : lost.length === binding.tools.length ? 'missing' : lost.length ? 'degraded' : 'available'
        const stale = time - binding.lastVerifiedAt > HEALTH_REFRESH_MS
        if (status !== binding.status || stale) {
          await this.store.updatePluginStatus(employeeId, binding.pluginId, status, time)
          if (status !== binding.status) report.changed += 1
        }
        rows.push({
          pluginId: binding.pluginId, packageName: binding.packageName, before: binding.status, status, missingTools: lost,
          skills: skillsUsingPlugin(profile.skills || [], binding).map((skill) => `${skill.name} Lv.${skill.level}`),
        })
      }
      report.employees.push({ employeeId, plugins: rows })
    }
    this.lastReport = report
    return report
  }

  // -------------------------------------------------------------------------
  // 真实执行信号台账（需求文档 6.1）
  //
  // 「工具名在 Tool Registry 里存在」只证明这个工具能被调用，不证明本次真的调用过、更不证明真的成功了。
  // 所以能给技能证据背书的，只有 runtime **自己亲手发起过**的调用：Smoke Test 的真实返回、安装命令的真实退出。
  // 这个台账只由 pushSignal 写入，没有任何工具参数能往里塞东西 —— LLM 自述的 success 永远进不来。
  // -------------------------------------------------------------------------

  private readonly signals: Array<{ tool: string; success: boolean; durationMs?: number; at: number; source: string }> = []
  private static readonly SIGNAL_LIMIT = 200
  private static readonly SIGNAL_TTL_MS = 3_600_000

  private pushSignal(tool: string | undefined, success: boolean, source: string, durationMs?: number) {
    const name = String(tool || '').trim()
    if (!name) return
    this.signals.push({ tool: name, success, durationMs, at: now(), source })
    const overflow = this.signals.length - PluginRuntime.SIGNAL_LIMIT
    if (overflow > 0) this.signals.splice(0, overflow)
  }

  /**
   * 取一条尚未被引用的真实信号。**用掉即销毁**：一次真实执行只能兑换一条证据，
   * 否则模型只要把同一步复制 20 遍就能把等级刷上去。成败以信号为准，step.success 不参与匹配。
   */
  private consumeSignal(tool: string | undefined): StepAttestation | null {
    const name = String(tool || '').trim()
    if (!name) return null
    const time = now()
    const index = this.signals.findIndex((row) => row.tool === name && time - row.at <= PluginRuntime.SIGNAL_TTL_MS)
    if (index < 0) return null
    const [signal] = this.signals.splice(index, 1)
    return { success: signal.success, source: signal.source, durationMs: signal.durationMs }
  }

  /**
   * 真实执行链路 → SkillEvidence。
   * 两道门：工具名要在 Tool Registry 命中，**并且**这一步要能对上一条 runtime 亲自观测到的执行信号。
   * 对不上的步骤只会出现在报告的 unattested 里，不写证据、不影响等级。
   */
  async recordEvidence(chain: ExecutionChain) {
    const catalog = await scanToolRegistry(this.tools, { includeInternal: true })
    const present = new Set(catalog.map((item) => item.name))
    const report = await recordExecutionEvidence(this.store, chain, {
      verifyTool: (name) => present.has(name),
      attest: (step) => this.consumeSignal(step.tool),
    })
    for (const row of report.evidence) {
      this.emit({ type: 'skill.updated', employeeId: report.employeeId, skillName: row.skillName, skillId: row.skillId, level: row.level, source: 'evidence' })
    }
    return report
  }
}

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------

export type PluginRuntimeHandle = {
  runtime: PluginRuntime
  requests: PluginRuntime['requests']
  request: PluginRuntime['request']
  /** 供 UI / CLI 的人类动作调用；工具链路里没有任何入口能调到它。 */
  approve: PluginRuntime['approve']
  reject: PluginRuntime['reject']
  install: PluginRuntime['install']
  verifyRequest: PluginRuntime['verifyRequest']
  verifyBinding: PluginRuntime['verifyBinding']
  healthCheck: PluginRuntime['healthCheck']
  /** 最近一次真实健康检查的结果；没跑过就是 null。只读，不会顺手替 UI 触发一次检查。 */
  lastHealthReport: PluginRuntime['lastHealthReport']
  catalog: PluginRuntime['catalog']
  recordEvidence: PluginRuntime['recordEvidence']
  approvalsFile: string
}

export function registerPluginRuntime(ctx: any, config: PluginRuntimeConfig = {}): PluginRuntimeHandle | null {
  const tools = ctx?.tools
  if (!tools) {
    ctx?.logger?.warn?.('dsh-org-panel: plugin runtime unavailable because tools service is missing')
    return null
  }
  const runtime = new PluginRuntime(ctx, config)
  const roster = rosterOf(config)
  const staffIds = roster.map((item) => item.id)
  const nameOf = (id: string) => roster.find((item) => item.id === id)?.name || id
  const staffParam = { type: 'string', enum: staffIds, description: '员工 id，必须来自赛博公司员工名册。' }

  const requestTool = {
    name: REQUEST_TOOL,
    description: '员工发现能力缺口、并在插件市场找到候选后，向老板提交插件安装申请。只披露不安装：把插件、用途、Stars、仓库、权限、风险、安装命令、预期工具与 Smoke Test 完整交给老板审批。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['staff', 'pluginName', 'packageName', 'purpose', 'installCommand'],
      properties: {
        staff: staffParam,
        pluginName: { type: 'string', minLength: 1, description: '插件展示名。' },
        packageName: { type: 'string', minLength: 1, maxLength: 214, description: 'npm 包名（可带 @version）或 github:owner/repo。禁止 URL、tarball 地址、git+ssh、file: 与任何本地路径。' },
        version: { type: 'string' },
        source: { type: 'string', enum: PLUGIN_SOURCES },
        repository: { type: 'string', description: '仓库地址，必须来自市场搜索结果，不要编造。' },
        homepage: { type: 'string' },
        stars: { type: 'number', minimum: 0 },
        purpose: { type: 'string', minLength: 4, description: '这个插件用来补齐哪个具体能力缺口。' },
        permissions: { type: 'array', items: { type: 'string' }, maxItems: 20, description: '插件声明需要的权限（文件、网络、密钥等）。' },
        risks: { type: 'array', items: { type: 'string' }, maxItems: 20, description: '已知风险：来源不明、star 很少、需要 API Key、会执行网络请求等。' },
        installCommand: { type: 'string', minLength: 4, maxLength: 400, description: '真实安装命令，只允许 dsh / npm / pnpm / yarn / bun 的 add|install 形式，且只能安装 packageName 指定的那一个包。' },
        expectedTools: { type: 'array', items: { type: 'string' }, maxItems: 20, description: '安装后预期在 Tool Registry 出现的工具名。批准之前就已经存在的工具不会被认定为本插件的能力。' },
        smokeTest: {
          type: 'object', additionalProperties: false, required: ['tool'],
          properties: {
            tool: { type: 'string', maxLength: 80, description: '只能是这个插件安装后新出现的工具。bash / shell / edit / write 这类通用工具一律拒绝。' },
            args: { type: 'object', additionalProperties: true, maxProperties: SMOKE_ARG_MAX_KEYS, description: `最小可用参数：只允许标量与浅层数组/对象，最多 ${SMOKE_ARG_MAX_KEYS} 个字段、总计 ${SMOKE_ARG_MAX_BYTES} 字节。` },
            expect: { type: 'string', maxLength: 200 },
          },
          description: '安装后用来验证插件真的能跑的最小调用；没有它插件不会被标记为已学会。它不是通用工具调用入口，只能打这个插件自己新增的工具。',
        },
        skillName: { type: 'string', description: '验证通过后要沉淀的技能名。' },
        category: { type: 'string' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: String(value?.card || '') }] } },
    isConcurrencySafe: () => true,
    async execute(args: any) {
      const employeeId = String(args.staff || '')
      const request = await runtime.submit({
        employeeId, employeeName: nameOf(employeeId),
        pluginName: String(args.pluginName), packageName: String(args.packageName), version: args.version ? String(args.version) : undefined,
        source: args.source, repository: args.repository, homepage: args.homepage, stars: args.stars,
        purpose: String(args.purpose), permissions: args.permissions, risks: args.risks,
        installCommand: String(args.installCommand), expectedTools: args.expectedTools, smokeTest: args.smokeTest,
        skillName: args.skillName, category: args.category,
      })
      return {
        requestId: request.requestId, status: request.status, approved: request.status === 'approved',
        installed: false, learned: false, card: renderProposalCard(request),
        next: request.status === 'approved'
          ? `老板已批准（${request.decision?.channel}），可以执行 ${APPLY_TOOL}。`
          : `等待老板批准。批准前禁止安装，也禁止声称已经学会。老板批准后再执行 ${APPLY_TOOL}。`,
      }
    },
  }

  const applyTool = {
    name: APPLY_TOOL,
    description: '在老板批准之后执行真实安装，并自动完成 Capability Scan 与 Smoke Test。没有批准记录时会直接报错。安装只通过当前运行时真实暴露的 DSH 插件管理工具或 shell 工具执行，遵循 DSH 权限模式。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['requestId'],
      properties: { requestId: { type: 'string', minLength: 4, description: `${REQUEST_TOOL} 返回的申请 id。` } },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: String(value?.card || '') }] } },
    isConcurrencySafe: () => false,
    async execute(args: any) {
      const request = await runtime.install(String(args.requestId))
      const verification = request.verification
      return {
        requestId: request.requestId, status: request.status,
        installed: !!request.install?.ok, installVia: request.install?.via, installError: request.install?.error,
        pluginStatus: verification?.status, toolsFound: verification?.toolsFound || [], toolsMissing: verification?.toolsMissing || [],
        smoke: verification?.smoke, learned: !!verification?.learned, skill: verification?.skill,
        reason: verification?.reason, card: renderProposalCard(request),
      }
    },
  }

  const verifyTool = {
    name: VERIFY_TOOL,
    description: '重新验证一个已批准的插件：扫描 Tool Registry 并执行 Smoke Test。用于 DSH 重启后把 missing 转正，或补做冒烟测试。验证不通过就保持未学会状态。'
      + '注意：它只能验证「老板已批准且已进入安装流程」的申请，被拒绝 / 待审批 / 已过期的一律报错；Smoke Test 也只能调用该插件本次真实新增的工具，不是通用工具调用入口。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        requestId: { type: 'string' },
        staff: staffParam,
        pluginId: { type: 'string', description: '插件包名，与 staff 一起用来定位已批准的申请。' },
        smokeTest: {
          type: 'object', additionalProperties: false, required: ['tool'],
          properties: {
            tool: { type: 'string', maxLength: 80, description: '只能是这个插件安装后新出现的工具；通用 / 高危工具会被直接拒绝。' },
            args: { type: 'object', additionalProperties: true, maxProperties: SMOKE_ARG_MAX_KEYS },
            expect: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: String(value?.card || '') }] } },
    isConcurrencySafe: () => false,
    async execute(args: any) {
      const request = args.requestId
        ? await runtime.verifyRequest(String(args.requestId), undefined, args.smokeTest)
        : await runtime.verifyBinding(String(args.staff || ''), String(args.pluginId || ''), args.smokeTest)
      const verification = request.verification
      return {
        requestId: request.requestId, status: request.status, pluginStatus: verification?.status,
        toolsFound: verification?.toolsFound || [], toolsMissing: verification?.toolsMissing || [],
        smoke: verification?.smoke, learned: !!verification?.learned, skill: verification?.skill,
        reason: verification?.reason, card: renderProposalCard(request),
      }
    },
  }

  const healthTool = {
    name: HEALTH_TOOL,
    description: '插件健康检查：扫描当前 Tool Registry，把员工已绑定插件里找不到的工具标记为 missing/degraded。技能历史保留，只更新当前可用性。',
    parameters: { type: 'object', additionalProperties: false, properties: { staff: staffParam } },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args: any, value: any) {
        const rows = Array.isArray(value?.employees) ? value.employees : []
        const body = rows.flatMap((row: any) => (row.plugins || []).map((plugin: any) => `${row.employeeId} · ${plugin.packageName}：${plugin.status}${plugin.missingTools?.length ? '（缺失工具：' + plugin.missingTools.join('、') + '）' : ''}${plugin.skills?.length ? ' · 相关技能：' + plugin.skills.join('、') : ''}`))
        return [{ type: 'text', text: body.length ? body.join('\n') : '当前没有任何已绑定插件。' }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args: any) {
      return runtime.healthCheck(args.staff ? [String(args.staff)] : undefined)
    },
  }

  const evidenceTool = {
    name: EVIDENCE_TOOL,
    description: '把一次真实执行链路记成技能证据。等级由证据按公式重算，员工不能自述等级。'
      + '硬约束：只有赛博公司运行时**亲自发起过**的调用（Smoke Test 的真实返回、安装命令的真实退出）才能作为证据；'
      + '你在参数里写的 success 只是对照信息，宿主观测不到对应执行信号的步骤一律不写入证据、不影响等级，并会在 unattested 里如实列出。'
      + '所以：不要指望用它给自己刷级，如实记录即可。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['staff', 'steps'],
      properties: {
        staff: staffParam,
        taskId: { type: 'string', description: '关联的 TaskHistory id（有就带上）。' },
        skills: { type: 'array', items: { type: 'string' }, maxItems: 8, description: '这次执行支撑了哪些技能；不传则按工具名推断。' },
        steps: {
          type: 'array', minItems: 1, maxItems: 20,
          items: {
            type: 'object', additionalProperties: false, required: ['success'],
            properties: {
              tool: { type: 'string', description: '真实调用过的工具名。' },
              action: { type: 'string', description: '动作名，如 Edit / Build / Test。' },
              plugin: { type: 'string' },
              model: { type: 'string' },
              success: { type: 'boolean', description: '自述成败，仅作对照。真正写进证据的成败取自宿主观测到的真实执行信号。' },
              durationMs: { type: 'number', minimum: 0 },
              detail: { type: 'string' },
            },
          },
        },
        summary: { type: 'string' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args: any, value: any) {
        const rows = Array.isArray(value?.evidence) ? value.evidence : []
        if (rows.length) {
          const lines = rows.map((row: any) => `${row.skillName} → Lv.${row.level}（${row.success ? '成功' : '失败'}证据）`)
          if (value?.reason) lines.push(String(value.reason))
          return [{ type: 'text', text: lines.join('\n') }]
        }
        return [{ type: 'text', text: `没有写入任何技能证据。${value?.reason ? '\n' + String(value.reason) : ''}` }]
      },
    },
    isConcurrencySafe: () => false,
    async execute(args: any) {
      return runtime.recordEvidence({
        employeeId: String(args.staff || ''), taskId: args.taskId ? String(args.taskId) : undefined,
        skills: Array.isArray(args.skills) ? args.skills.map(String) : undefined,
        steps: (Array.isArray(args.steps) ? args.steps : []).map((step: any) => ({
          tool: step?.tool ? String(step.tool) : undefined, action: step?.action ? String(step.action) : undefined,
          plugin: step?.plugin ? String(step.plugin) : undefined, model: step?.model ? String(step.model) : undefined,
          success: !!step?.success, durationMs: Number(step?.durationMs) > 0 ? Number(step.durationMs) : undefined,
          detail: step?.detail ? String(step.detail) : undefined,
        })),
        summary: args.summary ? String(args.summary) : undefined,
      })
    },
  }

  for (const tool of [requestTool, applyTool, verifyTool, healthTool, evidenceTool]) {
    try { tools.register(tool) } catch (error) { ctx?.logger?.warn?.(`dsh-org-panel: register ${tool.name} failed: ${errorText(error)}`) }
  }

  ctx?.systemPrompt?.section?.({
    name: 'dsh-org-panel:plugin-runtime',
    order: -3,
    text: [
      '【赛博公司 · 插件安装与技能验证制度】',
      `1. 能力缺口先用 staff_capability_scan 确认，再用 staff_plugin_market_search 找候选，然后调用 ${REQUEST_TOOL} 把插件、用途、Stars、仓库、权限、风险、安装命令、预期工具和 Smoke Test 完整交给老板。`,
      '2. 提交申请不等于批准。批准是老板的人类动作（公司设置里的批准按钮 / DSH 审批弹窗 / 配置预批准），你没有任何办法自己批准自己，也不许声称老板已经同意。',
      `3. 老板批准后才调用 ${APPLY_TOOL}。安装只会通过当前运行时真实暴露的插件管理工具或 shell 工具执行，遵循 DSH 权限模式；运行时没有这类工具时，请如实告诉老板需要手动执行安装命令。`,
      `4. 安装完成后必须通过 Capability Scan（Tool Registry 真的出现新工具）与 Smoke Test（真的调用成功）才算学会。任何一步没过，插件状态只会是 missing / degraded，禁止对外说已经学会，也禁止用它承诺任务。`,
      `5. 重启 DSH 或手动安装之后，用 ${VERIFY_TOOL} 补验证；怀疑插件失效时用 ${HEALTH_TOOL} 复查。${VERIFY_TOOL} 只对「已批准且已进入安装流程」的申请生效，Smoke Test 也只能打该插件本次真实新增的工具 —— 它不是通用工具调用入口，别拿它去调 bash / edit / write。`,
      `6. 技能等级只能来自真实执行证据：用 ${EVIDENCE_TOOL} 如实记录链路。你写的 success 只是对照，等级只认赛博公司运行时自己观测到的真实执行信号；对不上信号的步骤会被丢弃，等级不会动。别声称自己涨级了。`,
    ].join('\n'),
  })

  if (config.healthCheckOnStart !== false) {
    void Promise.resolve()
      .then(() => runtime.healthCheck())
      .then((report) => {
        if (report.changed) ctx?.logger?.info?.(`dsh-org-panel: plugin health check updated ${report.changed} binding(s) across ${report.employees.length} employee(s)`)
      })
      .catch((error) => ctx?.logger?.warn?.(`dsh-org-panel: plugin health check failed: ${errorText(error)}`))
  }

  return {
    runtime,
    requests: runtime.requests.bind(runtime),
    request: runtime.request.bind(runtime),
    approve: runtime.approve.bind(runtime),
    reject: runtime.reject.bind(runtime),
    install: runtime.install.bind(runtime),
    verifyRequest: runtime.verifyRequest.bind(runtime),
    verifyBinding: runtime.verifyBinding.bind(runtime),
    healthCheck: runtime.healthCheck.bind(runtime),
    lastHealthReport: runtime.lastHealthReport.bind(runtime),
    catalog: runtime.catalog.bind(runtime),
    recordEvidence: runtime.recordEvidence.bind(runtime),
    approvalsFile: runtime.approvalsFile,
  }
}
