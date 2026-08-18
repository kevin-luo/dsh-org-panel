// 「赛博公司」技能证据：等级只能来自真实执行链路（Edit → Build → Test → Success）。
// 本文件把一次真实执行折算成 SkillEvidence，写入 EvolutionStore.addEvidence 并触发 recomputeSkillLevel。
//
// 需求文档 6.1：等级绝不由 LLM 自述决定。光校验「工具名在 Tool Registry 里存在」是不够的 ——
// 名字存在只证明这个工具可以被调用，不证明本次真的调用过、更不证明真的成功了。
// 所以这里的口径是**执行信号（attestation）**：
//   · 只有宿主自己观测到的真实执行结果（Smoke Test 的真实返回、安装命令的真实退出、vision 的真实 HTTP 成败）
//     才能作为证据，且成败以执行信号为准，模型自述的 success 被直接丢弃；
//   · 拿不到执行信号的步骤一律记为 unattested：不写 evidence、不参与等级计算，只在报告里如实列出；
//   · attest 不传 = 一条信号都没有 = 整条链路拒绝写入（fail-closed）。想直连宿主真实遥测的调用方必须显式传 attest。
import type { EvolutionStore } from '../persistence/evolution-store'

export type ExecutionStep = {
  /** 真实调用过的工具名，必须能在当前 Tool Registry 找到才会被采信。 */
  tool?: string
  plugin?: string
  model?: string
  /** 人类可读的动作名，如 Edit / Build / Test。 */
  action?: string
  /** 模型自述的成败。**仅作对照**：真正写进证据的成败永远取自执行信号。 */
  success: boolean
  durationMs?: number
  detail?: string
}

/** 宿主观测到的一次真实执行。source 说明信号来自哪里（smoke-test / install-command / host-telemetry…）。 */
export type StepAttestation = { success: boolean; source: string; durationMs?: number }

/**
 * 执行信号回调：宿主对某一步给出真实执行结果，给不出就返回 null。
 * 绝不能把 step.success 原样回传 —— 那等于把自述当信号，这条洞就白修了。
 */
export type AttestStep = (step: ExecutionStep, index: number) => StepAttestation | null | undefined | false

/** 一步没拿到执行信号的原因，用于向老板/模型如实解释「为什么这次没涨级」。 */
export type UnattestedStep = { index: number; tool?: string; action?: string; reason: string }

export type ExecutionChain = {
  employeeId: string
  taskId?: string
  /** 本次执行支撑哪些技能；不传则按工具名推断。 */
  skills?: string[]
  steps: ExecutionStep[]
  summary?: string
}

export type ChainOutcome = {
  /** 链路成败 —— 只看拿到执行信号的步骤，且以信号里的成败为准。 */
  success: boolean
  steps: number
  /** 工具名在 Tool Registry 里命中的步骤（必要条件，但远不充分）。 */
  verifiedTools: string[]
  ignoredTools: string[]
  /** 拿到真实执行信号、真正能当证据用的工具。 */
  attestedTools: string[]
  attestedSteps: number
  /** 只有模型自述、宿主拿不到真实执行信号的步骤 —— 不写证据、不参与等级计算。 */
  unattested: UnattestedStep[]
  /** 这次证据分别来自哪些真实信号源。 */
  attestationSources: string[]
  /** 自述成败与真实执行信号对不上的步骤数（模型在吹牛或在自谦，两种都要记录）。 */
  contradicted: number
  plugins: string[]
  models: string[]
  durationMs: number
  failedAt?: string
}

export type SummarizeOptions = { verifyTool?: (name: string) => boolean; attest?: AttestStep }

/** 工具名 → 技能名的保守映射，只在调用方没有显式给出技能时作为兜底建议。 */
export const TOOL_SKILL_HINTS: Array<{ match: RegExp; skills: string[] }> = [
  { match: /^(edit|write|multi_edit|apply_patch|str_replace)/i, skills: ['工程实现'] },
  { match: /(build|compile|bundle|tsc|typecheck)/i, skills: ['构建与编译'] },
  { match: /(test|vitest|jest|pytest|spec)/i, skills: ['测试验证'] },
  { match: /(bash|shell|pwsh|terminal|exec)/i, skills: ['命令行运维'] },
  { match: /(grep|glob|search_files|read)/i, skills: ['代码检索'] },
  { match: /(browser|playwright|puppeteer|chrome)/i, skills: ['浏览器自动化'] },
  { match: /(image|vision|sd|diffusion|canva|figma)/i, skills: ['视觉创作'] },
  { match: /(video|ffmpeg|remotion)/i, skills: ['视频制作'] },
  { match: /(fetch|web_search|crawl)/i, skills: ['资料检索'] },
  { match: /(sql|database|supabase|postgres)/i, skills: ['数据处理'] },
]

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

export function suggestSkills(tools: readonly string[]): string[] {
  const out: string[] = []
  for (const tool of tools) for (const hint of TOOL_SKILL_HINTS) if (hint.match.test(tool)) out.push(...hint.skills)
  return unique(out)
}

function attestationOf(value: StepAttestation | null | undefined | false): StepAttestation | null {
  if (!value || typeof value !== 'object' || typeof value.success !== 'boolean') return null
  const source = String(value.source || '').trim()
  if (!source) return null
  return { success: value.success, source, durationMs: Number(value.durationMs) > 0 ? Number(value.durationMs) : undefined }
}

/**
 * 折算一次执行链路。
 * verifyTool：Tool Registry 命中判断（工具名真的存在）。
 * attest：真实执行信号来源；**不传就等于一条信号都没有**，整条链路只会得到 attestedSteps=0。
 * 链路成功的定义：至少一步拿到信号，且每一条信号都成功；自述 success 不参与这个判断。
 */
export function summarizeChain(chain: ExecutionChain, options: SummarizeOptions | ((name: string) => boolean) = {}): ChainOutcome {
  const { verifyTool, attest } = typeof options === 'function' ? { verifyTool: options, attest: undefined } : options
  const steps = Array.isArray(chain.steps) ? chain.steps : []
  const verifiedTools: string[] = []
  const ignoredTools: string[] = []
  const attestedTools: string[] = []
  const attestationSources: string[] = []
  const unattested: UnattestedStep[] = []
  const plugins: string[] = []
  const models: string[] = []
  let durationMs = 0
  let attestedSteps = 0
  let contradicted = 0
  let failedAt: string | undefined
  let allSucceeded = true

  steps.forEach((step, index) => {
    const tool = String(step.tool || '').trim()
    const known = !tool || !verifyTool || verifyTool(tool)
    if (tool) (known ? verifiedTools : ignoredTools).push(tool)
    const label = step.action || tool || `step#${index + 1}`
    // 工具名都对不上 Tool Registry 的步骤，连拿信号的资格都没有。
    if (!known) { unattested.push({ index, tool, action: step.action, reason: `工具 ${tool} 不在当前 Tool Registry 中` }); return }
    let signal: StepAttestation | null = null
    if (typeof attest === 'function') {
      try { signal = attestationOf(attest(step, index)) } catch { signal = null }
    }
    if (!signal) {
      unattested.push({ index, tool, action: step.action, reason: '宿主没有观测到这一步的真实执行信号，自述成败不作数' })
      return
    }
    attestedSteps += 1
    attestationSources.push(signal.source)
    if (tool) attestedTools.push(tool)
    if (step.plugin) plugins.push(String(step.plugin))
    if (step.model) models.push(String(step.model))
    if (signal.success !== step.success) contradicted += 1
    durationMs += Math.max(0, Number(signal.durationMs ?? step.durationMs) || 0)
    if (!signal.success) { allSucceeded = false; if (!failedAt) failedAt = label }
  })

  return {
    success: attestedSteps > 0 && allSucceeded,
    steps: steps.length,
    verifiedTools: unique(verifiedTools),
    ignoredTools: unique(ignoredTools),
    attestedTools: unique(attestedTools),
    attestedSteps,
    unattested,
    attestationSources: unique(attestationSources),
    contradicted,
    plugins: unique(plugins),
    models: unique(models),
    durationMs,
    failedAt,
  }
}

export type EvidenceRow = { skillId: string; skillName: string; level: number; evidenceId: string; success: boolean }

export type EvidenceReport = {
  employeeId: string
  taskId?: string
  success: boolean
  durationMs: number
  verifiedTools: string[]
  ignoredTools: string[]
  /** 拿到真实执行信号、真正写进证据的工具。 */
  attestedTools: string[]
  attestationSources: string[]
  /** 只有自述、没有执行信号的步骤：一条都没写进 evidence。 */
  unattested: UnattestedStep[]
  contradicted: number
  /** 因为技能不存在且不允许新建而跳过的技能名。 */
  skipped: string[]
  evidence: EvidenceRow[]
  /** 一条证据都没写时，如实说明原因（给模型看，避免它继续声称自己涨级了）。 */
  reason?: string
}

/**
 * 把一次真实执行写成技能证据。每条证据落盘后立即按 6.2 公式重算等级（recomputeSkillLevel）。
 * createMissingSkills=false 时只给已存在的技能记证据，用于「插件未验证不许新建技能」的场景。
 *
 * fail-closed：一步都拿不到真实执行信号时**不写任何证据**，返回带 reason 的空报告，而不是把自述当成功。
 */
export async function recordExecutionEvidence(
  store: EvolutionStore,
  chain: ExecutionChain,
  options: { verifyTool?: (name: string) => boolean; attest?: AttestStep; createMissingSkills?: boolean } = {},
): Promise<EvidenceReport> {
  const employeeId = String(chain.employeeId || '').trim()
  if (!employeeId) throw new Error('technical evidence requires employeeId')
  const outcome = summarizeChain(chain, { verifyTool: options.verifyTool, attest: options.attest })
  if (!outcome.steps) throw new Error('执行链路为空，拒绝写入技能证据')
  const base: EvidenceReport = {
    employeeId, taskId: chain.taskId, success: outcome.success, durationMs: outcome.durationMs,
    verifiedTools: outcome.verifiedTools, ignoredTools: outcome.ignoredTools,
    attestedTools: outcome.attestedTools, attestationSources: outcome.attestationSources,
    unattested: outcome.unattested, contradicted: outcome.contradicted, skipped: [], evidence: [],
  }
  // 需求文档 6.1 的硬边界：没有真实执行信号 = 没有证据 = 不涨级。自述的 success 到这里就被丢掉了。
  if (!outcome.attestedSteps) {
    return {
      ...base, success: false,
      reason: `这 ${outcome.steps} 步都没有拿到宿主观测到的真实执行信号，按需求文档 6.1 一律不写入技能证据、不影响等级。`
        + (outcome.ignoredTools.length ? `（其中 ${outcome.ignoredTools.join('、')} 连 Tool Registry 都不存在）` : ''),
    }
  }
  const wanted = unique(chain.skills || [])
  const names = wanted.length ? wanted : suggestSkills(outcome.attestedTools)
  if (!names.length) throw new Error('无法确定这次执行支撑了哪个技能，请显式给出 skills')
  const existing = await store.skills(employeeId)
  const createMissing = options.createMissingSkills !== false
  const primaryTool = outcome.attestedTools[0]
  const primaryPlugin = outcome.plugins[0]
  const primaryModel = outcome.models[0]
  const rows: EvidenceRow[] = []
  const skipped: string[] = []
  for (const name of names) {
    const known = existing.find((item) => item.name.trim().toLowerCase() === name.trim().toLowerCase())
    if (!known && !createMissing) { skipped.push(name); continue }
    const evidence = await store.addEvidence({
      employeeId, skillId: known?.id, skillName: name, taskId: chain.taskId,
      tool: primaryTool, plugin: primaryPlugin, model: primaryModel,
      success: outcome.success, duration: outcome.durationMs || undefined,
    })
    const level = await store.recomputeSkillLevel(evidence.skillId, employeeId)
    rows.push({ skillId: evidence.skillId, skillName: name, level, evidenceId: evidence.id, success: evidence.success })
  }
  return {
    ...base, skipped, evidence: rows,
    reason: outcome.unattested.length ? `另有 ${outcome.unattested.length} 步没有真实执行信号，已被丢弃，不参与等级计算。` : undefined,
  }
}

/**
 * 插件验证专用：Smoke Test 本身就是一次真实执行，成功/失败都如实记一条证据。
 * 失败且技能尚不存在时返回 null —— 未验证的插件不允许凭空造出一个「已学会」的技能。
 */
export async function recordPluginEvidence(store: EvolutionStore, input: {
  employeeId: string
  skillName: string
  packageName: string
  tool?: string
  success: boolean
  durationMs?: number
  taskId?: string
}): Promise<EvidenceRow | null> {
  const employeeId = String(input.employeeId || '').trim()
  const skillName = String(input.skillName || '').trim()
  if (!employeeId || !skillName) throw new Error('plugin evidence requires employeeId and skillName')
  const existing = await store.skills(employeeId)
  const known = existing.find((item) => item.name.trim().toLowerCase() === skillName.toLowerCase())
  if (!known && !input.success) return null
  const evidence = await store.addEvidence({
    employeeId, skillId: known?.id, skillName, taskId: input.taskId,
    tool: input.tool, plugin: input.packageName, success: input.success,
    duration: Number(input.durationMs) > 0 ? Number(input.durationMs) : undefined,
  })
  const level = await store.recomputeSkillLevel(evidence.skillId, employeeId)
  return { skillId: evidence.skillId, skillName, level, evidenceId: evidence.id, success: evidence.success }
}
