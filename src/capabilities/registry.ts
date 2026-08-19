// 「赛博公司」能力注册表：统一扫描 / 比对 / 调用当前 DSH 运行时真实暴露的 Tool Registry。
// 只做 duck-typing 探测，不 import node:*，host 侧任何阶段都能安全引用（client 侧也可只取类型）。
// 口径与 host-v2.ts 的 runtimeCapabilities() 保持一致：内部工具不算「员工新学到的能力」。

export type RuntimeCapability = {
  name: string
  source: string
  description?: string
  /** 工具自身声明的 JSON Schema（能拿到时才有），用于挑选 Smoke Test 参数名。 */
  parameters?: any
}

/** 本插件自己注册的工具（含 Phase 5 新增），扫描时默认排除。 */
export const ORG_PANEL_TOOL_NAMES = [
  'staff_chat', 'staff_meeting', 'staff_memory_recall', 'staff_memory_remember', 'staff_skill_learn',
  'staff_reflect', 'staff_profile', 'staff_capability_scan', 'staff_plugin_market_search', 'company_snapshot',
  'staff_plugin_install_request', 'staff_plugin_install_apply', 'staff_plugin_verify', 'staff_plugin_health_check',
  'staff_skill_evidence',
] as const

export const INTERNAL_TOOL_NAMES: ReadonlySet<string> = new Set<string>(ORG_PANEL_TOOL_NAMES)

/** 把工具名归类到人类可读的来源，用于 UI 分组与插件归属推断。 */
export function sourceOfTool(name: string): string {
  const value = name.toLowerCase()
  if (value.startsWith('cordis_') || value.includes('cordis')) return 'Cordis / DSH 插件'
  if (value.startsWith('mcp_') || value.includes('mcp') || value.includes('::')) return 'MCP'
  if (/(image|video|audio|fal|canva|figma|remotion|ffmpeg)/.test(value)) return '创意插件'
  if (/(github|gmail|calendar|drive|slack|notion|linear|jira|stripe|supabase|feishu|lark)/.test(value)) return '外部连接器'
  if (/(web|search|fetch|browser)/.test(value)) return '搜索 / Web'
  if (/(bash|pwsh|edit|write|grep|glob|codex|python|sql)/.test(value)) return '工程工具'
  return '运行时工具'
}

function capabilityOf(value: any): RuntimeCapability | null {
  if (!value) return null
  if (typeof value === 'string') return value.trim() ? { name: value.trim(), source: sourceOfTool(value.trim()) } : null
  const name = String(value.name || value.id || value.key || '').trim()
  if (!name) return null
  return {
    name,
    source: String(value.source || value.provider || sourceOfTool(name)),
    description: typeof value.description === 'string' ? value.description : undefined,
    parameters: value.parameters || value.schema || value.inputSchema || undefined,
  }
}

/**
 * 扫描当前 Tool Registry。DSH 各版本的 tools 服务形态不一致，这里逐个探测只读入口，
 * 任何一个探测抛错都不影响其它探测；返回按来源/名称排序的去重结果。
 */
export async function scanToolRegistry(tools: any, options: { includeInternal?: boolean } = {}): Promise<RuntimeCapability[]> {
  const collected: RuntimeCapability[] = []
  const push = (value: any) => {
    const capability = capabilityOf(value)
    if (!capability) return
    if (!options.includeInternal && INTERNAL_TOOL_NAMES.has(capability.name)) return
    collected.push(capability)
  }
  for (const probe of ['list', 'names', 'keys', 'entries', 'getAll']) {
    try {
      const fn = tools?.[probe]
      if (typeof fn !== 'function') continue
      const result = await Promise.resolve(fn.call(tools))
      if (Array.isArray(result)) result.forEach((item) => Array.isArray(item) ? push(item[1] || item[0]) : push(item))
      else if (result && typeof (result as any)[Symbol.iterator] === 'function') Array.from(result as Iterable<any>).forEach((item: any) => Array.isArray(item) ? push(item[1] || item[0]) : push(item))
    } catch {}
  }
  const registry = tools?.registry || tools?.tools || tools?._tools
  if (registry instanceof Map) registry.forEach((value: any, key: any) => push(value || key))
  else if (registry && typeof registry === 'object') Object.entries(registry).forEach(([key, value]) => push((value as any)?.name ? value : key))
  const dedup = new Map<string, RuntimeCapability>()
  for (const item of collected) {
    const previous = dedup.get(item.name)
    if (!previous) dedup.set(item.name, item)
    else if (!previous.parameters && item.parameters) dedup.set(item.name, { ...previous, parameters: item.parameters })
  }
  return Array.from(dedup.values()).sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name))
}

/** 安装前后各拍一次的工具名快照（含内部工具，保证 diff 只反映真实新增）。 */
export async function toolNameSet(tools: any): Promise<Set<string>> {
  const catalog = await scanToolRegistry(tools, { includeInternal: true })
  return new Set(catalog.map((item) => item.name))
}

export function capabilityNames(catalog: readonly RuntimeCapability[]): string[] {
  return catalog.map((item) => item.name)
}

/** Capability Scan：安装后真正新出现的工具。 */
export function newCapabilities(before: ReadonlySet<string>, after: readonly RuntimeCapability[]): RuntimeCapability[] {
  return after.filter((item) => !before.has(item.name))
}

export function hasTool(catalog: readonly RuntimeCapability[], name: string): boolean {
  const wanted = String(name || '').trim()
  return !!wanted && catalog.some((item) => item.name === wanted)
}

/** 返回 names 里当前 Tool Registry 找不到的部分。 */
export function missingTools(catalog: readonly RuntimeCapability[], names: readonly string[]): string[] {
  const present = new Set(catalog.map((item) => item.name))
  return Array.from(new Set(names.map((item) => String(item || '').trim()).filter(Boolean))).filter((name) => !present.has(name))
}

export function matchCapabilities(catalog: readonly RuntimeCapability[], patterns: readonly (RegExp | string)[]): RuntimeCapability[] {
  return catalog.filter((item) => patterns.some((pattern) => typeof pattern === 'string' ? item.name === pattern : pattern.test(item.name)))
}

/** 取回工具原始条目（拿 schema / 直接调用用）。找不到返回 null。 */
export function getToolEntry(tools: any, name: string): any {
  const wanted = String(name || '').trim()
  if (!wanted) return null
  for (const probe of ['get', 'find', 'lookup', 'resolve']) {
    try {
      const fn = tools?.[probe]
      if (typeof fn !== 'function') continue
      const entry = fn.call(tools, wanted)
      if (entry && typeof entry !== 'boolean') return entry
    } catch {}
  }
  const registry = tools?.registry || tools?.tools || tools?._tools
  if (registry instanceof Map && registry.has(wanted)) return registry.get(wanted)
  if (registry && typeof registry === 'object' && (registry as any)[wanted]) return (registry as any)[wanted]
  return null
}

export type ToolInvocation = {
  ok: boolean
  /**
   * service = 走 tools 服务入口（DSH 权限模式在这一层生效）；none = 当前运行时没有官方调用入口，本次没有调用。
   * 故意没有 direct：直接抓工具条目调它的 execute 会完全绕开 DSH 权限模式，等于自己给自己发权限，
   * 这条降级路径已被移除，拿不到官方入口就如实失败。
   */
  via: 'service' | 'none'
  value?: unknown
  error?: string
  durationMs: number
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  if (!(timeoutMs > 0)) return work
  let timer: any
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`工具调用超时（${timeoutMs}ms）`)), timeoutMs) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 调用一个真实存在的运行时工具 —— **只走 tools 服务入口**（execute/invoke/call/run），
 * 因为 DSH 的权限模式就挂在服务入口上。服务入口不存在时一律返回 via='none' 如实失败：
 * 从 Tool Registry 里掏出条目直接 execute 会跳过权限模式，那等于 host 自己给自己发权限，绝不允许。
 */
export async function invokeTool(tools: any, name: string, args: Record<string, unknown> = {}, options: { timeoutMs?: number } = {}): Promise<ToolInvocation> {
  const startedAt = Date.now()
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 0
  for (const probe of ['execute', 'invoke', 'call', 'run']) {
    const fn = tools?.[probe]
    if (typeof fn !== 'function') continue
    try {
      const value = await withTimeout(Promise.resolve(fn.call(tools, name, args)), timeoutMs)
      return { ok: true, via: 'service', value, durationMs: Date.now() - startedAt }
    } catch (error) {
      return { ok: false, via: 'service', error: errorText(error), durationMs: Date.now() - startedAt }
    }
  }
  return {
    ok: false, via: 'none', durationMs: Date.now() - startedAt,
    error: `当前运行时没有暴露 tools 服务调用入口（execute/invoke/call/run），无法在遵守 DSH 权限模式的前提下调用 ${name}`,
  }
}

export type CommandExecutor = {
  name: string
  /** dsh-plugin = 运行时自带的插件管理工具；shell = 通用命令行工具。 */
  kind: 'dsh-plugin' | 'shell'
  /** 传命令行文本的参数名。 */
  argumentKey: string
}

const SHELL_TOOL_PATTERNS = [/^(bash|shell|sh|zsh|pwsh|powershell|terminal|command|exec)$/i, /^(run|execute)_(command|shell|bash)$/i]
const COMMAND_KEYS = ['command', 'cmd', 'script', 'commandLine', 'command_line', 'input']

function argumentKeyOf(capability: RuntimeCapability | undefined, entry: any): string {
  const schema = capability?.parameters || entry?.parameters || entry?.schema || entry?.inputSchema
  const properties = schema?.properties
  if (properties && typeof properties === 'object') {
    for (const key of COMMAND_KEYS) if (key in properties) return key
    const first = Object.keys(properties).find((key) => (properties as any)[key]?.type === 'string')
    if (first) return first
  }
  return 'command'
}

/**
 * 找到当前环境里真实可用、且经过 DSH 权限模式的安装执行器。
 * 优先 DSH 自带的插件管理工具，其次通用 shell 工具；都没有则返回 null（此时由调用方决定是否退回本地进程）。
 */
export function findCommandExecutor(tools: any, catalog: readonly RuntimeCapability[]): CommandExecutor | null {
  const pluginManager = catalog.find((item) => /plugin/i.test(item.name) && /(add|install|manage|market)/i.test(item.name) && !INTERNAL_TOOL_NAMES.has(item.name))
  if (pluginManager) return { name: pluginManager.name, kind: 'dsh-plugin', argumentKey: argumentKeyOf(pluginManager, getToolEntry(tools, pluginManager.name)) }
  const shell = catalog.find((item) => SHELL_TOOL_PATTERNS.some((pattern) => pattern.test(item.name)))
  if (shell) return { name: shell.name, kind: 'shell', argumentKey: argumentKeyOf(shell, getToolEntry(tools, shell.name)) }
  return null
}

/** 把任意工具返回值压成可读文本，用于把安装/冒烟输出写进审批台账。 */
export function stringifyToolValue(value: unknown, max = 4000): string {
  if (value == null) return ''
  let text = ''
  if (typeof value === 'string') text = value
  else if (Array.isArray(value)) text = value.map((item: any) => typeof item === 'string' ? item : typeof item?.text === 'string' ? item.text : JSON.stringify(item)).join('\n')
  else if (typeof value === 'object') {
    const anyValue = value as any
    text = typeof anyValue.stdout === 'string' || typeof anyValue.stderr === 'string'
      ? [anyValue.stdout, anyValue.stderr].filter(Boolean).join('\n')
      : JSON.stringify(value)
  } else text = String(value)
  return text.length > max ? text.slice(0, max) + '…' : text
}
