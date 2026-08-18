// 「赛博公司」Model Gateway：Employee → Capability Router → Gateway → Provider。
// 职责：解析 SecretRef、按 ModelBinding.priority 路由、超时、错误归一化、fallback 链、结果结构化。
// 铁律：
//   1. 不认识任何具体厂商，只认 ModelProviderConfig 里的 provider(协议) + baseUrl + model；
//   2. apiKeyRef 只接受 env:XXX / secret:XXX，API Key 绝不进日志、绝不通过 API 回传完整值；
//   3. 没有可用视觉供应商时抛错并带出文档十五的引导原文，绝不返回任何图片描述（代码级保证）。
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { CompanyStore, sanitizeModelProvider } from '../persistence/company-store'
import { EvolutionStore } from '../persistence/evolution-store'
import { createVisionAnalyzeTool } from '../tools/vision-analyze'
import { defaultProviderRegistry, type ProviderRegistry } from './registry'
import {
  CAPABILITY_PROVIDER_TYPE, MODEL_CAPABILITIES, MODEL_PROVIDER_TYPES, MODEL_PROVIDER_VENDORS, ModelGatewayError, PROVIDER_TYPE_CAPABILITY,
  RAW_SECRET_FIELDS, SECRET_STORAGE_LABEL, SECRET_STORAGE_OBFUSCATED_WARNING, VISION_UNAVAILABLE_MESSAGE,
  asGatewayError, isSecretRef, maskSecret, scrubSecrets, toModelCapability,
  type ModelBinding, type ModelBindingStatus, type ModelCapability, type ModelErrorCode, type ModelProviderConfig, type ModelProviderSummary, type ModelProviderType, type ModelProviderVendor,
  type NormalizedImage, type ProviderAdapter, type ProviderAttempt, type SecretRef, type SecretSource, type SecretStatus, type SecretStorageMode, type SecretStorageStatus,
  type VisionImageInput, type VisionMode, type VisionRequest, type VisionResult,
} from './types'

// 本仓库没有 @types/node，只有 src/node-shims.d.ts 里的最小声明；密钥文件加固需要下面两个能力。
declare module 'node:fs/promises' {
  export function chmod(path: string, mode: number): Promise<void>
  export function stat(path: string): Promise<{ mode: number }>
}

const DEFAULT_TIMEOUT = 45_000
const MAX_IMAGES = 8
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const VISION_SKILL_NAME = '视觉理解'
/** 连通性自检的硬上限：老板在会话里点「测试」不该等 45 秒。 */
const PROBE_TIMEOUT = 20_000
const PROBE_PROMPT = '这是一张 1×1 像素的测试图，只用于连通性自检。请只回一个 JSON：{"description":"ok"}。'
/** 1×1 透明 PNG：自检用的最小合法图片，不依赖磁盘也不依赖网络。 */
const PROBE_IMAGE: NormalizedImage = {
  name: 'probe.png', mimeType: 'image/png', kind: 'base64', bytes: 68,
  base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
}

/** 只接受真实图片扩展名/MIME，猜不出来就报错，不替老板脑补一个格式。 */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
}

function now() { return Date.now() }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function clip(value: string, max: number): string { return value.length > max ? `${value.slice(0, max)}…` : value }

// ---------------------------------------------------------------------------
// base64 / WebCrypto 工具（本仓库没有 @types/node，因此统一走 WebCrypto 与 btoa/atob）
// ---------------------------------------------------------------------------

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...Array.from(bytes.subarray(index, index + 0x8000)))
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function base64Bytes(value: string): number { return Math.floor(value.replace(/=+$/, '').length * 3 / 4) }

function webCrypto(): Crypto {
  const value = typeof crypto === 'undefined' ? undefined : crypto
  if (!value?.subtle) throw new ModelGatewayError('missing-key', '当前运行时没有 WebCrypto（globalThis.crypto.subtle），本地密钥库不可用；请改用 apiKeyRef: env:XXX。')
  return value
}

// ---------------------------------------------------------------------------
// 本地密钥库：~/.dsh-org-panel/secrets/credentials.enc（AES-256-GCM）
//
// 诚实声明（这段话就是能力标志 secretStorage 的依据，改实现必须同步改这里）：
//   · 默认（machine 模式）的密钥材料 = 本机公开信息（家目录 / 用户名 / 主机名）+ 同一个文件里的明文 salt。
//     salt 与密文躺在一起，其余三项对同机任何用户都是公开的 —— 所以 210k 次 PBKDF2 在这里
//     不提供任何抗猜测能力，只是保持与既有文件的兼容。这一档就叫「仅本机混淆存储」（obfuscated），
//     它只防「明文躺在磁盘和日志里」，不防同机攻击者。
//   · 设置了 DSH_ORG_PANEL_SECRETS_PASSPHRASE（或构造时传 passphrase）才升级为真正的加密
//     （encrypted）：密钥材料来自口令，口令不落盘，拿到文件也解不开。
//   · 两档都会把目录 chmod 0700、文件 chmod 0600；chmod 没生效（例如 Windows）就在能力标志里
//     如实报 ownerOnly:false，不假装收紧过。
// 真正的强保护应由 DSH / Cordis Secret Service 提供；本地库永远只是回落方案。
// ---------------------------------------------------------------------------

type VaultKeySource = 'machine' | 'passphrase'
type VaultEntry = { iv: string; data: string; keySource?: VaultKeySource }
type VaultFile = { version: 1; kdf: 'PBKDF2-SHA256'; iterations: number; salt: string; keySource: VaultKeySource; entries: Record<string, VaultEntry> }

const VAULT_NAMESPACE = 'dsh-org-panel:secrets:v1'
const VAULT_ITERATIONS = 210_000
const VAULT_PASSPHRASE_ENV = 'DSH_ORG_PANEL_SECRETS_PASSPHRASE'
const VAULT_FILE_MODE = 0o600
const VAULT_DIR_MODE = 0o700

function machineMaterial(salt: string): string {
  const env = process.env
  return [VAULT_NAMESPACE, salt, homedir(), env.USER || env.LOGNAME || env.USERNAME || '', env.HOSTNAME || env.COMPUTERNAME || ''].join('|')
}

function entryKeySource(entry: VaultEntry, file: VaultFile): VaultKeySource {
  return entry.keySource === 'passphrase' || entry.keySource === 'machine' ? entry.keySource : file.keySource
}

export class SecretVault {
  readonly filePath: string
  /** 口令：只留在内存里，绝不落盘、绝不进日志、绝不通过任何 API 回传。 */
  private readonly passphrase: string
  private cache: VaultFile | null = null
  /** 派生一次 210k PBKDF2 很贵，按 salt+材料来源缓存；缓存只在本进程内存里。 */
  private readonly keys = new Map<string, Promise<CryptoKey>>()
  private chmodOk = true

  constructor(filePath?: string, options: { passphrase?: string } = {}) {
    this.filePath = filePath || process.env.DSH_ORG_PANEL_SECRETS_FILE || join(homedir(), '.dsh-org-panel', 'secrets', 'credentials.enc')
    this.passphrase = text(options.passphrase) || text(process.env[VAULT_PASSPHRASE_ENV])
  }

  /** 新写入的条目用哪种密钥材料：有口令就用口令，没有就只能是本机混淆。 */
  get keySource(): VaultKeySource { return this.passphrase ? 'passphrase' : 'machine' }

  /** chmod 失败在部分文件系统上是正常的，如实记下来而不是假装收紧成功。 */
  private async harden(path: string, mode: number): Promise<boolean> {
    try { await chmod(path, mode); return true } catch { return false }
  }

  private async load(): Promise<VaultFile> {
    if (this.cache) return this.cache
    let raw = ''
    try { raw = await readFile(this.filePath, 'utf-8') } catch { raw = '' }
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed.salt === 'string' && parsed.entries && typeof parsed.entries === 'object') {
          const keySource: VaultKeySource = parsed.keySource === 'passphrase' ? 'passphrase' : 'machine'
          this.cache = { version: 1, kdf: 'PBKDF2-SHA256', iterations: Number(parsed.iterations) || VAULT_ITERATIONS, salt: parsed.salt, keySource, entries: parsed.entries }
          // 历史文件可能是默认权限写出来的（审计 P0）；读到就顺手收紧，不等下一次写入。
          const info = await stat(this.filePath).catch(() => null)
          if (info && (info.mode & 0o077)) this.chmodOk = await this.harden(this.filePath, VAULT_FILE_MODE)
          return this.cache
        }
      } catch { /* 坏文件不阻断启动，按空库处理 */ }
    }
    // salt 延迟到首次写入才生成：没有 WebCrypto 的运行时也能安全地读能力标志。
    this.cache = { version: 1, kdf: 'PBKDF2-SHA256', iterations: VAULT_ITERATIONS, salt: '', keySource: this.keySource, entries: {} }
    return this.cache
  }

  private async persist(file: VaultFile) {
    const dir = dirname(this.filePath)
    await mkdir(dir, { recursive: true })
    const dirOk = await this.harden(dir, VAULT_DIR_MODE)
    const temp = `${this.filePath}.tmp`
    await writeFile(temp, JSON.stringify(file), 'utf-8')
    // 先 chmod 再 rename：落到最终路径上的文件从第一刻起就是 0600，不存在「先 644 再收紧」的窗口。
    const fileOk = await this.harden(temp, VAULT_FILE_MODE)
    await rename(temp, this.filePath)
    this.chmodOk = dirOk && fileOk
  }

  private key(file: VaultFile, source: VaultKeySource): Promise<CryptoKey> {
    const cacheKey = `${source}:${file.iterations}:${file.salt}`
    const cached = this.keys.get(cacheKey)
    if (cached) return cached
    const derive = (async () => {
      const subtle = webCrypto().subtle
      // 口令模式：材料是老板的口令，salt 只作为标准 KDF salt（公开是正常的）。
      // 本机模式：材料是公开信息，这一步的迭代次数不提供任何安全性，见文件头的诚实声明。
      const secret = source === 'passphrase' ? `${VAULT_NAMESPACE}|passphrase|${this.passphrase}` : machineMaterial(file.salt)
      const material = await subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey'])
      return subtle.deriveKey({ name: 'PBKDF2', salt: base64ToBytes(file.salt), iterations: file.iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    })()
    this.keys.set(cacheKey, derive)
    // 派生失败不要把坏 Promise 永久留在缓存里。
    derive.catch(() => this.keys.delete(cacheKey))
    return derive
  }

  async get(name: string): Promise<string | undefined> {
    const file = await this.load()
    const entry = file.entries[name]
    if (!entry) return undefined
    const source = entryKeySource(entry, file)
    // 条目是口令加密的、而本进程没有口令：解不开就是解不开，绝不降级去猜。
    if (source === 'passphrase' && !this.passphrase) return undefined
    try {
      const plain = await webCrypto().subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(entry.iv) }, await this.key(file, source), base64ToBytes(entry.data))
      return decoder.decode(plain)
    } catch {
      // 换机器 / 换用户 / 换口令 / 文件被改：解不出来就当没有，绝不把密文当密钥用出去。
      return undefined
    }
  }

  async set(name: string, value: string): Promise<void> {
    const key = text(name)
    if (!key) throw new ModelGatewayError('invalid-input', 'secret name must not be empty')
    if (!value) throw new ModelGatewayError('invalid-input', 'secret value must not be empty')
    const file = await this.load()
    if (!file.salt) file.salt = bytesToBase64(webCrypto().getRandomValues(new Uint8Array(16)))
    if (!Object.keys(file.entries).length) file.keySource = this.keySource
    const source = this.keySource
    const iv = webCrypto().getRandomValues(new Uint8Array(12))
    const data = new Uint8Array(await webCrypto().subtle.encrypt({ name: 'AES-GCM', iv }, await this.key(file, source), encoder.encode(value)))
    // 逐条记录密钥材料来源：老板中途加上口令时，旧条目照样读得回来，不会被静默丢掉。
    file.entries[key] = { iv: bytesToBase64(iv), data: bytesToBase64(data), keySource: source }
    await this.persist(file)
  }

  async remove(name: string): Promise<boolean> {
    const file = await this.load()
    if (!(name in file.entries)) return false
    delete file.entries[name]
    await this.persist(file)
    return true
  }

  async names(): Promise<string[]> {
    const file = await this.load()
    return Object.keys(file.entries).sort()
  }

  /**
   * 能力标志：UI 只能按这里返回的 mode / warning 显示，不许一律打绿标。
   * 口径是「实际存着的东西有多安全」：只要还有一条是本机混淆加密的，整体就是 obfuscated。
   */
  async status(): Promise<SecretStorageStatus> {
    const file = await this.load().catch(() => null)
    const entries = file ? Object.keys(file.entries) : []
    const sources = new Set<VaultKeySource>(entries.map((name) => entryKeySource(file!.entries[name], file!)))
    if (!entries.length) sources.add(this.keySource)
    const mode: SecretStorageMode = sources.has('machine') ? 'obfuscated' : 'encrypted'
    const info = await stat(this.filePath).catch(() => null)
    const permissions = info ? (info.mode & 0o777).toString(8).padStart(3, '0') : undefined
    const ownerOnly = info ? !(info.mode & 0o077) : this.chmodOk
    const warnings = [
      mode === 'obfuscated' ? SECRET_STORAGE_OBFUSCATED_WARNING : '',
      mode === 'obfuscated' && sources.size > 1 ? '（当前文件里同时存在口令加密与本机混淆两种条目。）' : '',
      !ownerOnly ? `密钥文件权限没能收紧到 0600${permissions ? `（当前 ${permissions}）` : ''}，同机其他用户可能读得到它。` : '',
    ].filter(Boolean)
    return {
      mode, keySource: this.keySource, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256',
      iterations: file?.iterations || VAULT_ITERATIONS,
      filePath: this.filePath, exists: !!info, entries: entries.length,
      permissions, ownerOnly, label: SECRET_STORAGE_LABEL[mode],
      warning: warnings.length ? warnings.join('\n') : undefined,
    }
  }
}

// ---------------------------------------------------------------------------
// SecretRef 解析：env: → process.env；secret: → DSH/Cordis Secret Service，缺失时回落本地密钥库
// ---------------------------------------------------------------------------

export type SecretService = {
  get?(name: string): unknown
  read?(name: string): unknown
  resolve?(name: string): unknown
  getSecret?(name: string): unknown
}

/** 在 ctx 上探测官方 Secret Service，探测失败就用本地密钥库，不硬依赖任何具体实现。 */
export function detectSecretService(ctx: any): SecretService | null {
  const candidates = [ctx?.secrets, ctx?.secretService, ctx?.secretStore, ctx?.vault, ctx?.dsh?.secrets, ctx?.cordis?.secrets]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    if (['get', 'read', 'resolve', 'getSecret'].some((method) => typeof candidate[method] === 'function')) return candidate as SecretService
  }
  return null
}

async function readFromService(service: SecretService, name: string): Promise<string | undefined> {
  for (const method of ['get', 'read', 'resolve', 'getSecret'] as const) {
    const fn = (service as any)[method]
    if (typeof fn !== 'function') continue
    try {
      const value = await Promise.resolve(fn.call(service, name))
      if (typeof value === 'string' && value) return value
      if (value && typeof (value as any).value === 'string' && (value as any).value) return String((value as any).value)
    } catch { /* 换下一个方法 */ }
  }
  return undefined
}

export class SecretResolver {
  private readonly service: SecretService | null
  readonly vault: SecretVault

  constructor(options: { service?: SecretService | null; vaultFile?: string; vaultPassphrase?: string } = {}) {
    this.service = options.service || null
    this.vault = new SecretVault(options.vaultFile, { passphrase: options.vaultPassphrase })
  }

  /** 本地密钥库的真实保护等级；UI 的「Secret Store」标必须按它显示。 */
  storage(): Promise<SecretStorageStatus> { return this.vault.status() }

  /** 内部使用：拿到明文。调用方只允许把它塞进请求头，禁止落库/落日志/回传。 */
  async reveal(ref?: SecretRef | string): Promise<{ value?: string; source: SecretSource }> {
    const raw = text(ref)
    if (!raw) return { source: 'none' }
    if (!isSecretRef(raw)) throw new ModelGatewayError('invalid-input', 'apiKeyRef 只允许 env:XXX 或 secret:XXX 形式的引用，不允许明文密钥。')
    const name = raw.slice(raw.indexOf(':') + 1).trim()
    if (!name) return { source: 'none' }
    if (raw.startsWith('env:')) {
      const value = process.env[name]
      return value ? { value, source: 'env' } : { source: 'none' }
    }
    if (this.service) {
      const value = await readFromService(this.service, name)
      if (value) return { value, source: 'secret-service' }
    }
    const stored = await this.vault.get(name)
    return stored ? { value: stored, source: 'vault' } : { source: 'none' }
  }

  /** 对外只暴露 configured + 掩码串，永远不含完整密钥。 */
  async status(ref?: SecretRef | string): Promise<SecretStatus> {
    const raw = text(ref)
    if (!raw) return { source: 'none', configured: false }
    try {
      const resolved = await this.reveal(raw)
      // 来自本地库的密钥要顺带告诉 UI 这份库到底是真加密还是只是混淆，避免一律绿标。
      const storage = resolved.source === 'vault' ? (await this.vault.status()).mode : undefined
      return { ref: raw as SecretRef, source: resolved.source, configured: !!resolved.value, masked: resolved.value ? maskSecret(resolved.value) : undefined, storage }
    } catch {
      return { ref: raw as SecretRef, source: 'none', configured: false }
    }
  }

  /** 写入本地密钥库（只有 secret: 引用会用到）。 */
  async store(ref: SecretRef | string, value: string): Promise<SecretStatus> {
    const raw = text(ref)
    if (!raw.startsWith('secret:')) throw new ModelGatewayError('invalid-input', '只有 secret:XXX 引用可以写入本地密钥库；env:XXX 请配置环境变量。')
    const name = raw.slice('secret:'.length).trim()
    await this.vault.set(name, value)
    return { ref: raw as SecretRef, source: 'vault', configured: true, masked: maskSecret(value) }
  }

  async forget(ref: SecretRef | string): Promise<boolean> {
    const raw = text(ref)
    if (!raw.startsWith('secret:')) return false
    return this.vault.remove(raw.slice('secret:'.length).trim())
  }
}

// ---------------------------------------------------------------------------
// 图片归一化：data URL / http(s) URL / 本地路径 → NormalizedImage
// ---------------------------------------------------------------------------

function mimeFromName(name: string): string | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(name.split('?')[0].split('#')[0])
  return match ? IMAGE_MIME[match[1].toLowerCase()] : undefined
}

function expandHome(path: string): string {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

async function readLocalImage(path: string): Promise<NormalizedImage> {
  const file = expandHome(path.startsWith('file://') ? decodeURIComponent(path.slice('file://'.length)) : path)
  const mimeType = mimeFromName(file)
  if (!mimeType) throw new ModelGatewayError('invalid-input', `无法识别图片格式：${baseName(file)}。支持 ${Object.keys(IMAGE_MIME).join(' / ')}。`)
  let base64 = ''
  try {
    base64 = await readFile(file, 'base64')
  } catch {
    throw new ModelGatewayError('invalid-input', `读不到图片文件：${file}`)
  }
  const bytes = base64Bytes(base64)
  if (bytes > MAX_IMAGE_BYTES) throw new ModelGatewayError('invalid-input', `图片过大（${Math.round(bytes / 1024 / 1024)}MB），上限 ${MAX_IMAGE_BYTES / 1024 / 1024}MB。`)
  return { name: baseName(file), mimeType, kind: 'base64', base64, bytes }
}

function parseDataUrl(value: string, name?: string): NormalizedImage {
  const match = /^data:([^;,]+);base64,(.+)$/is.exec(value)
  if (!match) throw new ModelGatewayError('invalid-input', '只支持 base64 形式的 data URL 图片。')
  const mimeType = match[1].toLowerCase()
  if (!mimeType.startsWith('image/')) throw new ModelGatewayError('invalid-input', `不是图片类型：${mimeType}`)
  const base64 = match[2].replace(/\s+/g, '')
  const bytes = base64Bytes(base64)
  if (bytes > MAX_IMAGE_BYTES) throw new ModelGatewayError('invalid-input', `图片过大（${Math.round(bytes / 1024 / 1024)}MB），上限 ${MAX_IMAGE_BYTES / 1024 / 1024}MB。`)
  return { name, mimeType, kind: 'base64', base64, bytes }
}

export async function normalizeImage(input: VisionImageInput): Promise<NormalizedImage> {
  if (typeof input === 'string') {
    const value = input.trim()
    if (!value) throw new ModelGatewayError('invalid-input', '图片参数不能为空。')
    if (value.startsWith('data:')) return parseDataUrl(value)
    if (/^https?:\/\//i.test(value)) return { name: baseName(value), mimeType: mimeFromName(value) || 'image/*', kind: 'url', url: value }
    if (value.startsWith('file://') || value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.startsWith('~/')) return readLocalImage(value)
    throw new ModelGatewayError('invalid-input', `无法识别的图片引用：${clip(value, 60)}。请传 data URL、http(s) 链接或绝对路径。`)
  }
  const name = text(input?.name) || undefined
  const inline = text(input?.data) || text(input?.base64)
  if (inline) {
    if (inline.startsWith('data:')) return parseDataUrl(inline, name)
    const mimeType = text(input?.mimeType) || (name ? mimeFromName(name) : undefined)
    if (!mimeType) throw new ModelGatewayError('invalid-input', '内联 base64 图片必须同时给出 mimeType。')
    return parseDataUrl(`data:${mimeType};base64,${inline}`, name)
  }
  const url = text(input?.url)
  if (url) {
    const image = await normalizeImage(url)
    return { ...image, name: name || image.name }
  }
  const path = text(input?.path)
  if (path) {
    const image = await readLocalImage(path)
    return { ...image, name: name || image.name }
  }
  throw new ModelGatewayError('invalid-input', '图片参数必须包含 url / path / data 之一。')
}

// ---------------------------------------------------------------------------
// 提示词与结果解析：结构统一在网关里做，适配器只负责把文本取回来
// ---------------------------------------------------------------------------

const MODE_INSTRUCTIONS: Record<VisionMode, string> = {
  general: '通用理解：说明这张图整体是什么、关键信息有哪些、有没有异常。',
  describe: '细致描述：画面内容、构图、主体、风格、颜色与氛围。',
  ocr: '文字识别优先：把图中所有可读文字按阅读顺序完整抄进 extractedText，保留换行与层级；看不清的字标注为 [不清晰]。',
  ui: '界面分析：页面结构、主要区域、控件、状态、报错提示与可能的可用性/实现问题。',
  document: '文档理解：标题、章节、表格、字段与数值，把正文文字放进 extractedText。',
  chart: '图表理解：图表类型、坐标轴含义、系列、关键数值与趋势结论；能读到的数值放进 observations。',
  'code-screenshot': '代码截图：语言、关键代码逻辑、报错信息与行号；把代码与报错原文放进 extractedText。',
}

const VISION_SYSTEM_PROMPT = [
  '你是一个视觉分析模块，只负责如实描述你在图片里真正看到的内容。',
  '硬性要求：',
  '1. 只描述图中确实存在的内容；看不清、被遮挡或分辨率不足时明确说明，禁止推测或编造。',
  '2. 不要引入图片之外的背景知识作为“看到的事实”。',
  '3. 只输出一个 JSON 对象，不要加解释、不要加 Markdown 代码块。',
  'JSON 字段：{"description": string, "extractedText"?: string, "observations"?: string[], "objects"?: string[], "confidence"?: number}',
  'confidence 取 0~1，表示你对本次识别的把握；没有把握就给低值或省略。',
].join('\n')

export function buildVisionPrompt(mode: VisionMode, question?: string, images: NormalizedImage[] = []): string {
  const names = images.map((image, index) => `${index + 1}. ${image.name || '未命名图片'}（${image.mimeType}）`).join('\n')
  return [
    `分析模式：${mode}`,
    MODE_INSTRUCTIONS[mode],
    images.length > 1 ? `共 ${images.length} 张图片：\n${names}` : names ? `图片：${names}` : '',
    question ? `老板的具体问题（请在 description 里正面回答）：\n${question}` : '',
    '请按系统消息要求只返回 JSON。',
  ].filter(Boolean).join('\n\n')
}

function stringArray(value: unknown, max = 12): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const rows = value.map((item) => text(item)).filter(Boolean).slice(0, max)
  return rows.length ? rows : undefined
}

/** 从模型返回文本里抽出结构化结果；抽不出就整段当描述，绝不自己补内容。 */
export function parseVisionPayload(raw: string): Omit<VisionResult, 'providerId' | 'model'> {
  const body = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(body.slice(start, end + 1))
      const description = text(parsed?.description) || text(parsed?.summary)
      if (description) {
        const confidence = Number(parsed?.confidence)
        return {
          description,
          extractedText: text(parsed?.extractedText) || text(parsed?.ocr) || undefined,
          observations: stringArray(parsed?.observations) || stringArray(parsed?.findings),
          objects: stringArray(parsed?.objects),
          confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : undefined,
        }
      }
    } catch { /* 不是合法 JSON，按纯文本处理 */ }
  }
  return { description: body }
}

// ---------------------------------------------------------------------------
// Capability Router
// ---------------------------------------------------------------------------

export type CompanyLike = { modelProviders(type?: ModelProviderType): Promise<ModelProviderConfig[]> }

export type EvolutionLike = {
  modelBindings(employeeId: string): Promise<ModelBinding[]>
  updateModelStatus(employeeId: string, capability: ModelCapability, providerId: string, status: ModelBindingStatus): Promise<ModelBinding | null>
  addEvidence(input: { employeeId: string; skillName?: string; tool?: string; model?: string; success: boolean; duration?: number }): Promise<unknown>
}

export type RoutedProvider = {
  config: ModelProviderConfig
  adapter: ProviderAdapter
  priority: number
  /** true = 来自该员工显式绑定；false = 公司级兜底顺序。 */
  bound: boolean
}

export class CapabilityRouter {
  constructor(private readonly company: CompanyLike, private readonly registry: ProviderRegistry, private readonly evolution?: EvolutionLike) {}

  /** 返回按 priority 排好序、去重后的 fallback 链；空数组表示这项能力当前完全不可用。 */
  async resolve(capability: ModelCapability, employeeId?: string): Promise<RoutedProvider[]> {
    const providers = (await this.company.modelProviders(CAPABILITY_PROVIDER_TYPE[capability])).filter((item) => item.enabled)
    const byId = new Map(providers.map((item) => [item.id, item]))
    const adapterOf = (config: ModelProviderConfig): ProviderAdapter | undefined => {
      const adapter = this.registry.get(config.provider)
      return adapter && adapter.supports(capability) ? adapter : undefined
    }
    const chain: RoutedProvider[] = []
    const seen = new Set<string>()
    const bindings = employeeId && this.evolution ? await this.evolution.modelBindings(employeeId).catch(() => [] as ModelBinding[]) : []
    for (const binding of bindings.filter((item) => item.capability === capability && item.status !== 'disabled').sort((a, b) => a.priority - b.priority)) {
      const config = byId.get(binding.providerId)
      const adapter = config ? adapterOf(config) : undefined
      if (!config || !adapter) {
        // 绑定指向的供应商已被删除/停用：把状态如实标成 missing，而不是假装还能用。
        if (employeeId && this.evolution && binding.status !== 'missing') await this.evolution.updateModelStatus(employeeId, capability, binding.providerId, 'missing').catch(() => null)
        continue
      }
      if (seen.has(config.id)) continue
      seen.add(config.id)
      chain.push({ config, adapter, priority: binding.priority, bound: true })
    }
    providers.forEach((config, index) => {
      if (seen.has(config.id)) return
      const adapter = adapterOf(config)
      if (!adapter) return
      seen.add(config.id)
      chain.push({ config, adapter, priority: 100 + index, bound: false })
    })
    return chain
  }
}

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

export type GatewayLogger = { info?(message: string): void; warn?(message: string): void; error?(message: string): void }

export type ModelGatewayOptions = {
  company: CompanyLike
  evolution?: EvolutionLike
  registry?: ProviderRegistry
  secretService?: SecretService | null
  vaultFile?: string
  /** 本地密钥库口令；不传则读 DSH_ORG_PANEL_SECRETS_PASSPHRASE，都没有就是「仅本机混淆存储」。 */
  vaultPassphrase?: string
  defaultTimeout?: number
  logger?: GatewayLogger
}

export type VisionAnalysis = {
  result: VisionResult
  mode: VisionMode
  imageCount: number
  durationMs: number
  attempts: ProviderAttempt[]
}

export type CapabilityStatus = {
  capability: ModelCapability
  configured: boolean
  providers: Array<{ providerId: string; vendor: ModelProviderConfig['provider']; model: string; bound: boolean; priority: number; apiKeyConfigured: boolean; apiKeySource: SecretSource; apiKeyMasked?: string }>
}

export type ProviderTestResult = {
  providerId: string
  type: ModelProviderType
  vendor: ModelProviderVendor
  capability: ModelCapability
  model: string
  adapter: string | null
  enabled: boolean
  apiKeyRef?: SecretRef
  apiKeyConfigured: boolean
  apiKeySource: SecretSource
  apiKeyMasked?: string
  /** live-call = 真的发了一次请求；config-only = 只核对了配置与密钥，可用性没被验证过。 */
  checked: 'live-call' | 'config-only'
  ok: boolean
  code?: ModelErrorCode
  message?: string
  /** 真实响应的前 160 字（已抹密钥），证明这次是真的连上了。 */
  reply?: string
  durationMs: number
}

/** cordis 配置里 models: / modelBindings: 段的落库结果。 */
export type ModelConfigSummary = {
  providers: Array<{ id: string; type: ModelProviderType; provider: ModelProviderVendor; model: string; enabled: boolean }>
  bindings: Array<{ employeeId: string; capability: ModelCapability; providerId: string; priority: number; status: ModelBindingStatus }>
  /** 坏配置行如实记在这里，不静默吞掉，也不阻断其他行落库。 */
  errors: string[]
}

export class ModelGateway {
  readonly registry: ProviderRegistry
  readonly secrets: SecretResolver
  readonly router: CapabilityRouter
  /** 公开给 host 工具与集成方复用：同一份 company.json / evolution.json 只能有一个写入者。 */
  readonly company: CompanyLike
  readonly evolution?: EvolutionLike
  /** cordis 配置里 models: 段的落库结果；registerModelGateway 会把它换成真实的启动任务。 */
  configReady: Promise<ModelConfigSummary> = Promise.resolve({ providers: [], bindings: [], errors: [] })
  private readonly defaultTimeout: number
  private readonly logger?: GatewayLogger

  constructor(options: ModelGatewayOptions) {
    this.company = options.company
    this.evolution = options.evolution
    this.registry = options.registry || defaultProviderRegistry
    this.secrets = new SecretResolver({ service: options.secretService, vaultFile: options.vaultFile, vaultPassphrase: options.vaultPassphrase })
    this.router = new CapabilityRouter(this.company, this.registry, this.evolution)
    this.defaultTimeout = Math.max(1000, Number(options.defaultTimeout) || DEFAULT_TIMEOUT)
    this.logger = options.logger
  }

  /** 本地密钥库的真实保护等级（obfuscated / encrypted）。UI 必须按它显示，不许一律打绿标。 */
  secretStorage(): Promise<SecretStorageStatus> { return this.secrets.storage() }

  /** 供 UI 使用的供应商列表：只带 apiKeyConfigured / 掩码，绝不带完整密钥。 */
  async providerSummaries(type?: ModelProviderType): Promise<Array<ModelProviderSummary & { adapter: string | null; apiKeySource: SecretSource; apiKeyMasked?: string }>> {
    const providers = await this.company.modelProviders(type)
    const rows = []
    for (const config of providers) {
      const status = await this.secrets.status(config.apiKeyRef)
      const adapter = this.registry.get(config.provider)
      rows.push({
        id: config.id, type: config.type, provider: config.provider, model: config.model, baseUrl: config.baseUrl,
        apiKeyRef: config.apiKeyRef, apiKeyConfigured: status.configured, apiKeySource: status.source, apiKeyMasked: status.masked,
        enabled: config.enabled, adapter: adapter ? adapter.label : null,
      })
    }
    return rows
  }

  /** 某项能力当前到底能不能用（前端「公司设置 → 模型」与员工档案都用它）。 */
  async capabilityStatus(capability: ModelCapability, employeeId?: string): Promise<CapabilityStatus> {
    const chain = await this.router.resolve(capability, employeeId)
    const providers = []
    for (const entry of chain) {
      const status = await this.secrets.status(entry.config.apiKeyRef)
      providers.push({
        providerId: entry.config.id, vendor: entry.config.provider, model: entry.config.model, bound: entry.bound, priority: entry.priority,
        apiKeyConfigured: status.configured, apiKeySource: status.source, apiKeyMasked: status.masked,
      })
    }
    return { capability, configured: providers.length > 0, providers }
  }

  /** 需求文档十五的引导原文，供 UI / 员工话术复用。 */
  visionUnavailableMessage(): string { return VISION_UNAVAILABLE_MESSAGE }

  /**
   * 连通性自检：能真发一次请求就真发（checked: 'live-call'），发不了就只查配置与密钥
   * （checked: 'config-only'）并如实说明为什么没发 —— 不许把「配置看起来对」说成「测试通过」。
   */
  async testProvider(providerId: string, options: { signal?: AbortSignal; live?: boolean } = {}): Promise<ProviderTestResult> {
    const id = text(providerId)
    const config = (await this.company.modelProviders()).find((item) => item.id === id)
    if (!config) throw new ModelGatewayError('not-configured', `没有 id 为「${id || '(空)'}」的模型供应商，请先在 cordis 配置的 models: 段或 company_model_config 里加上。`)
    const capability = PROVIDER_TYPE_CAPABILITY[config.type]
    const adapter = this.registry.get(config.provider)
    const secret = await this.secrets.status(config.apiKeyRef)
    const base: ProviderTestResult = {
      providerId: config.id, type: config.type, vendor: config.provider, model: config.model, capability,
      adapter: adapter ? adapter.label : null, enabled: config.enabled,
      apiKeyRef: config.apiKeyRef, apiKeyConfigured: secret.configured, apiKeySource: secret.source, apiKeyMasked: secret.masked,
      checked: 'config-only', ok: false, durationMs: 0,
    }
    if (!config.enabled) return { ...base, code: 'not-configured', message: '该供应商已停用（enabled: false），不会进入任何 fallback 链。' }
    if (!adapter) return { ...base, code: 'unsupported', message: `没有注册 provider="${config.provider}" 的适配器。` }
    if (!adapter.supports(capability)) return { ...base, code: 'unsupported', message: `适配器「${adapter.label}」不支持 ${capability} 能力。` }
    if (config.apiKeyRef && !secret.configured) return { ...base, code: 'missing-key', message: `密钥引用 ${config.apiKeyRef} 当前解析不到值。` }
    if (capability !== 'vision' || options.live === false) {
      return { ...base, ok: true, message: capability === 'vision' ? '按要求跳过了真实请求，只核对了配置与密钥。' : `本版只能对 vision 供应商发真实请求；${capability} 这里只核对了配置与密钥，可用性尚未验证。` }
    }

    const startedAt = now()
    const timeout = Math.min(Math.max(1000, Number(config.timeout) || this.defaultTimeout), PROBE_TIMEOUT)
    let apiKey: string | undefined
    try {
      if (config.apiKeyRef) apiKey = (await this.secrets.reveal(config.apiKeyRef)).value
      const output = await adapter.analyzeVision({
        config, apiKey, mode: 'general', timeout, signal: options.signal,
        systemPrompt: VISION_SYSTEM_PROMPT, prompt: PROBE_PROMPT, images: [PROBE_IMAGE],
        inline: (image) => this.inlineImage(image, timeout, options.signal),
      })
      const reply = clip(scrubSecrets(text(output.text), [apiKey]), 160)
      if (!reply) return { ...base, checked: 'live-call', code: 'invalid-response', message: '供应商返回了空响应。', durationMs: now() - startedAt }
      return { ...base, checked: 'live-call', ok: true, model: text(output.model) || config.model, reply, durationMs: now() - startedAt }
    } catch (error) {
      const normalized = asGatewayError(error, config.id)
      return { ...base, checked: 'live-call', code: normalized.code, message: clip(scrubSecrets(normalized.message, [apiKey]), 300), durationMs: now() - startedAt }
    }
  }

  private async inlineImage(image: NormalizedImage, timeout: number, signal?: AbortSignal): Promise<NormalizedImage> {
    if (image.kind === 'base64') return image
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort)
    try {
      const response = await fetch(String(image.url), { signal: controller.signal })
      if (!response.ok) throw new ModelGatewayError('invalid-input', `下载图片失败：HTTP ${response.status}`)
      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      const mimeType = contentType.startsWith('image/') ? contentType : image.mimeType.startsWith('image/') && image.mimeType !== 'image/*' ? image.mimeType : ''
      if (!mimeType) throw new ModelGatewayError('invalid-input', `链接返回的不是图片：${contentType || '未知类型'}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length > MAX_IMAGE_BYTES) throw new ModelGatewayError('invalid-input', `图片过大（${Math.round(bytes.length / 1024 / 1024)}MB），上限 ${MAX_IMAGE_BYTES / 1024 / 1024}MB。`)
      return { name: image.name, mimeType, kind: 'base64', base64: bytesToBase64(bytes), bytes: bytes.length }
    } catch (error) {
      throw asGatewayError(error)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  /**
   * 图片理解主入口。代码级保证：
   * - 没有任何可用视觉供应商 → 抛 not-configured 并带出文档十五原文，不返回任何描述；
   * - 所有供应商都失败 → 抛错，不返回任何描述；
   * - description 只可能来自某一次真实的供应商响应文本。
   */
  async analyzeVision(request: VisionRequest): Promise<VisionAnalysis> {
    const startedAt = now()
    const inputs = Array.isArray(request.images) ? request.images : []
    if (!inputs.length) throw new ModelGatewayError('invalid-input', 'vision_analyze 至少需要一张图片。')
    if (inputs.length > MAX_IMAGES) throw new ModelGatewayError('invalid-input', `一次最多分析 ${MAX_IMAGES} 张图片。`)
    const images: NormalizedImage[] = []
    for (const item of inputs) images.push(await normalizeImage(item))

    const mode: VisionMode = request.mode && MODE_INSTRUCTIONS[request.mode] ? request.mode : 'general'
    const chain = await this.router.resolve('vision', request.employeeId)
    if (!chain.length) throw new ModelGatewayError('not-configured', VISION_UNAVAILABLE_MESSAGE, { guidance: VISION_UNAVAILABLE_MESSAGE })

    const prompt = buildVisionPrompt(mode, text(request.question) || undefined, images)
    const attempts: ProviderAttempt[] = []
    const usedSecrets: Array<string | undefined> = []
    let lastError: ModelGatewayError | null = null

    for (const entry of chain) {
      const config = entry.config
      const attemptStart = now()
      let apiKey: string | undefined
      try {
        if (config.apiKeyRef) {
          const revealed = await this.secrets.reveal(config.apiKeyRef)
          if (!revealed.value) throw new ModelGatewayError('missing-key', `供应商「${config.id}」的密钥引用 ${config.apiKeyRef} 当前解析不到值。`, { providerId: config.id })
          apiKey = revealed.value
          usedSecrets.push(apiKey)
        }
        const timeout = Math.max(1000, Number(config.timeout) || this.defaultTimeout)
        const output = await entry.adapter.analyzeVision({
          config, apiKey, mode, timeout, signal: request.signal,
          systemPrompt: VISION_SYSTEM_PROMPT,
          prompt,
          images,
          inline: (image) => this.inlineImage(image, timeout, request.signal),
        })
        const raw = text(output.text)
        if (!raw) throw new ModelGatewayError('invalid-response', '供应商返回了空响应。', { providerId: config.id })
        const parsed = parseVisionPayload(raw)
        if (!parsed.description) throw new ModelGatewayError('invalid-response', '供应商响应里没有可用的图片描述。', { providerId: config.id })
        attempts.push({ providerId: config.id, vendor: config.provider, model: config.model, ok: true, durationMs: now() - attemptStart })
        return {
          result: { providerId: config.id, model: text(output.model) || config.model, ...parsed },
          mode, imageCount: images.length, durationMs: now() - startedAt, attempts,
        }
      } catch (error) {
        const normalized = asGatewayError(error, config.id)
        // 日志与回传都先抹掉密钥，任何情况下都不允许 API Key 泄漏出去。
        const message = clip(scrubSecrets(normalized.message, [apiKey]), 300)
        attempts.push({ providerId: config.id, vendor: config.provider, model: config.model, ok: false, code: normalized.code, message, durationMs: now() - attemptStart })
        this.logger?.warn?.(`dsh-org-panel: vision provider ${config.id} failed (${normalized.code}) ${message}`)
        lastError = normalized
        if (!normalized.retryable) break
      }
    }

    const summary = attempts.map((item) => `${item.providerId}(${item.code || 'error'})`).join(' → ')
    const detail = lastError ? clip(scrubSecrets(lastError.message, usedSecrets), 200) : '未知'
    throw new ModelGatewayError(lastError?.code || 'server', `视觉分析失败，已依次尝试：${summary}。最后一个错误：${detail}`, { providerId: lastError?.providerId })
  }

  /**
   * 把一次真实执行结果记成技能证据 + 刷新模型绑定状态。等级由持久层按 6.2 公式算，网关不拍等级。
   * 口径：配置类失败（缺密钥 / 未配置 / 鉴权失败）是老板的配置问题，不算员工技能失败，只把绑定标成 missing；
   * 真正的执行失败（超时 / 服务端错误 / 非法响应）才写一条失败证据。
   */
  async recordVisionUsage(input: { employeeId?: string; providerId: string; model?: string; success: boolean; durationMs?: number; code?: ModelErrorCode }): Promise<void> {
    const employeeId = text(input.employeeId)
    if (!employeeId || !this.evolution) return
    const configIssue = !input.success && (input.code === 'missing-key' || input.code === 'not-configured' || input.code === 'auth')
    if (!configIssue) {
      try {
        await this.evolution.addEvidence({ employeeId, skillName: VISION_SKILL_NAME, tool: 'vision_analyze', model: text(input.model) || input.providerId, success: input.success, duration: input.durationMs })
      } catch (error) {
        this.logger?.warn?.(`dsh-org-panel: 记录视觉技能证据失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (input.success || configIssue) {
      try {
        await this.evolution.updateModelStatus(employeeId, 'vision', input.providerId, input.success ? 'available' : 'missing')
      } catch { /* 没有绑定就不用更新 */ }
    }
  }
}

// ---------------------------------------------------------------------------
// 配置入口：cordis composition config 里的 models: / modelBindings: 段
// 这是 Phase 4 的主入口 —— 不读这一段，那条多供应商 fallback 链在真实运行里永远走不到。
// ---------------------------------------------------------------------------

export type CompanyConfigSink = CompanyLike & {
  upsertModelProvider(input: ModelProviderConfig): Promise<ModelProviderConfig>
  removeModelProvider?(providerId: string): Promise<boolean>
}

export type BindingSink = EvolutionLike & {
  bindModel(employeeId: string, input: { capability: ModelCapability; providerId: string; priority?: number; status?: ModelBindingStatus }): Promise<ModelBinding>
  unbindModel?(employeeId: string, capability: ModelCapability, providerId?: string): Promise<boolean>
}

export function canWriteProviders(company: unknown): company is CompanyConfigSink {
  return typeof (company as any)?.upsertModelProvider === 'function'
}

export function canWriteBindings(evolution: unknown): evolution is BindingSink {
  return typeof (evolution as any)?.bindModel === 'function'
}

/**
 * 解析文档十一的 models: 段。支持两种写法：
 *   models: { vision-fast: { type: vision, provider: openai-compatible, ... } }   ← 文档示例
 *   models: [ { id: vision-fast, type: vision, ... } ]                            ← 数组写法
 * 校验一律走 CompanyStore 的同一份 sanitizeModelProvider：配置文件里也不许出现明文密钥。
 */
export function parseModelProvidersConfig(raw: unknown): { providers: ModelProviderConfig[]; errors: string[] } {
  const providers: ModelProviderConfig[] = []
  const errors: string[] = []
  const rows: any[] = []
  if (Array.isArray(raw)) rows.push(...raw)
  else if (raw && typeof raw === 'object') {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      // YAML 里的 key 就是供应商 id；只有条目内显式写了 id 才以它为准。
      if (value && typeof value === 'object' && !Array.isArray(value)) rows.push({ ...(value as object), id: text((value as any).id) || id })
      else errors.push(`models.${id}：必须是一个对象（至少包含 type / provider / model）。`)
    }
  } else if (raw !== undefined && raw !== null) errors.push('models 段必须是对象或数组。')
  for (const row of rows) {
    const id = text(row?.id) || '(缺 id)'
    try { providers.push(sanitizeModelProvider(row)) } catch (error) { errors.push(`models.${id}：${error instanceof Error ? error.message : String(error)}`) }
  }
  return { providers, errors }
}

/**
 * 解析员工模型绑定（文档十二）：
 *   modelBindings: { designer: { vision: [vision-quality, vision-fast], text: deepseek } }
 *   modelBindings: [ { staff: designer, capability: vision, provider: vision-quality, priority: 1 } ]
 * 数组顺序即优先级顺序，老板不用手写 priority。
 */
export function parseModelBindingsConfig(raw: unknown): { bindings: Array<{ employeeId: string; capability: ModelCapability; providerId: string; priority: number }>; errors: string[] } {
  const bindings: Array<{ employeeId: string; capability: ModelCapability; providerId: string; priority: number }> = []
  const errors: string[] = []
  const push = (employeeId: string, rawCapability: unknown, providerId: string, priority: number, label: string) => {
    const capability = toModelCapability(rawCapability)
    if (!capability) { errors.push(`${label}：无法识别的能力「${String(rawCapability)}」，可选 ${MODEL_CAPABILITIES.join(' / ')}。`); return }
    if (!employeeId || !providerId) { errors.push(`${label}：员工 id 与供应商 id 都不能为空。`); return }
    bindings.push({ employeeId, capability, providerId, priority })
  }
  if (Array.isArray(raw)) {
    raw.forEach((row: any, index) => push(text(row?.staff) || text(row?.employeeId), row?.capability, text(row?.provider) || text(row?.providerId), Math.max(1, Math.floor(Number(row?.priority) || index + 1)), `modelBindings[${index}]`))
  } else if (raw && typeof raw === 'object') {
    for (const [employeeId, value] of Object.entries(raw as Record<string, any>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`modelBindings.${employeeId}：必须是 { capability: providerId } 形式的对象。`); continue }
      for (const [capability, target] of Object.entries(value as Record<string, unknown>)) {
        const list = Array.isArray(target) ? target : [target]
        list.forEach((item, index) => push(text(employeeId), capability, text(item), index + 1, `modelBindings.${employeeId}.${capability}`))
      }
    }
  } else if (raw !== undefined && raw !== null) errors.push('modelBindings 段必须是对象或数组。')
  return { bindings, errors }
}

/** 绑定状态只能反映真实可用性：供应商不在、被停用、或没有支持该能力的适配器，一律 missing。 */
function bindingStatus(config: ModelProviderConfig | undefined, capability: ModelCapability, registry: ProviderRegistry): ModelBindingStatus {
  if (!config || !config.enabled) return 'missing'
  const adapter = registry.get(config.provider)
  return adapter && adapter.supports(capability) ? 'available' : 'missing'
}

/**
 * 把 cordis 配置里的 models: / modelBindings: 段真正落库。
 * 这是启动时唯一的自动写入点，坏行只记错误不阻断其他行，也绝不覆盖老板在 UI/工具里改过的其他供应商。
 */
export async function applyModelConfig(gateway: ModelGateway, config: any, logger?: GatewayLogger): Promise<ModelConfigSummary> {
  const summary: ModelConfigSummary = { providers: [], bindings: [], errors: [] }
  const rawProviders = config?.models ?? config?.modelProviders
  const rawBindings = config?.modelBindings ?? config?.staffModels
  if (rawProviders === undefined && rawBindings === undefined) return summary

  const parsed = parseModelProvidersConfig(rawProviders)
  summary.errors.push(...parsed.errors)
  if (parsed.providers.length && !canWriteProviders(gateway.company)) {
    summary.errors.push('当前 CompanyStore 不支持写入模型供应商，models: 段本次没有落库。')
  } else {
    for (const provider of parsed.providers) {
      try {
        const saved = await (gateway.company as CompanyConfigSink).upsertModelProvider(provider)
        summary.providers.push({ id: saved.id, type: saved.type, provider: saved.provider, model: saved.model, enabled: saved.enabled })
      } catch (error) {
        summary.errors.push(`models.${provider.id}：落库失败 ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const parsedBindings = parseModelBindingsConfig(rawBindings)
  summary.errors.push(...parsedBindings.errors)
  if (parsedBindings.bindings.length) {
    if (!canWriteBindings(gateway.evolution)) {
      summary.errors.push('当前 EvolutionStore 不支持写入模型绑定，modelBindings: 段本次没有落库。')
    } else {
      const known = new Map((await gateway.company.modelProviders()).map((item) => [item.id, item]))
      for (const row of parsedBindings.bindings) {
        const status = bindingStatus(known.get(row.providerId), row.capability, gateway.registry)
        try {
          await (gateway.evolution as BindingSink).bindModel(row.employeeId, { capability: row.capability, providerId: row.providerId, priority: row.priority, status })
          summary.bindings.push({ ...row, status })
        } catch (error) {
          summary.errors.push(`modelBindings.${row.employeeId}.${row.capability}：落库失败 ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }

  if (summary.providers.length) logger?.info?.(`dsh-org-panel: 从 cordis 配置载入 ${summary.providers.length} 个模型供应商（${summary.providers.map((item) => `${item.id}/${item.type}`).join('、')}）`)
  if (summary.bindings.length) logger?.info?.(`dsh-org-panel: 从 cordis 配置载入 ${summary.bindings.length} 条员工模型绑定`)
  for (const error of summary.errors) logger?.warn?.(`dsh-org-panel: 模型配置有问题，${error}`)
  return summary
}

// ---------------------------------------------------------------------------
// host 工具：老板在会话里查看 / 配置 / 自检 / 绑定模型
// 铁律：apiKey 只接受 SecretRef，明文一律当场拒绝；任何返回值都只含掩码。
// ---------------------------------------------------------------------------

export const MODEL_LIST_TOOL = 'company_model_list'
export const MODEL_CONFIG_TOOL = 'company_model_config'
export const MODEL_TEST_TOOL = 'company_model_test'
export const MODEL_BIND_TOOL = 'company_model_bind'

const SECRET_REF_HINT = '密钥引用，只能写 env:环境变量名 或 secret:本地库条目名。绝对不要在这里写真实密钥，明文会被直接拒绝。'

/** 调用方顺手把明文密钥塞进参数时当场拒绝，并且不把那个值回显到错误里。 */
function rejectRawSecrets(args: any, tool: string) {
  for (const field of RAW_SECRET_FIELDS) {
    if (args && Object.prototype.hasOwnProperty.call(args, field) && args[field]) {
      throw new ModelGatewayError('invalid-input', `${tool} 拒绝接收明文密钥字段「${field}」。请先把密钥放进环境变量或本地密钥库，然后只传 apiKeyRef: env:XXX / secret:XXX。`)
    }
  }
}

function providerLine(row: { id: string; type: string; provider: string; model: string; enabled: boolean; apiKeyConfigured: boolean; apiKeyMasked?: string; apiKeySource: string; adapter: string | null }): string {
  const key = row.apiKeyConfigured ? `密钥 ${row.apiKeyMasked || '已配置'}（${row.apiKeySource}）` : '密钥未配置'
  return `${row.enabled ? '·' : '×'} ${row.id} [${row.type}] ${row.provider}/${row.model} · ${row.adapter || '无适配器'} · ${key}`
}

export function createModelToolset(gateway: ModelGateway, options: { staffIds?: string[] } = {}): any[] {
  const staffIds = (options.staffIds || []).filter(Boolean)
  const staffSchema = staffIds.length ? { type: 'string', enum: staffIds } : { type: 'string' }

  const listTool = {
    name: MODEL_LIST_TOOL,
    description: [
      '查看公司当前真实配置的模型供应商、每项能力是否真的可用、本地密钥库的真实保护等级，以及某位员工的模型绑定。',
      '只读工具。返回里永远只有密钥掩码，不会出现完整密钥。',
    ].join('\n'),
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        type: { type: 'string', enum: MODEL_PROVIDER_TYPES, description: '只看某一类供应商；不传则全部。' },
        staff: { ...staffSchema, description: '带上员工 id 时会一并返回该员工的模型绑定与他实际的 fallback 顺序。' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) {
      const providers = (value?.providers || []).map(providerLine).join('\n') || '（还没有配置任何模型供应商）'
      const capabilities = (value?.capabilities || []).map((item: any) => `${item.capability}：${item.configured ? item.providers.map((row: any) => row.providerId).join(' → ') : '未配置'}`).join('\n')
      const storage = value?.secretStorage ? `本地密钥库：${value.secretStorage.label}（${value.secretStorage.filePath}，权限 ${value.secretStorage.permissions || '未知'}）${value.secretStorage.warning ? `\n${value.secretStorage.warning}` : ''}` : ''
      return [{ type: 'text', text: [providers, '', capabilities, '', storage].filter((part) => part !== undefined).join('\n').trim() }]
    } },
    isConcurrencySafe: () => true,
    async execute(args: any) {
      const type = MODEL_PROVIDER_TYPES.includes(args?.type) ? (args.type as ModelProviderType) : undefined
      const staff = text(args?.staff) || undefined
      const providers = await gateway.providerSummaries(type)
      const capabilities: CapabilityStatus[] = []
      for (const capability of MODEL_CAPABILITIES) capabilities.push(await gateway.capabilityStatus(capability, staff))
      const bindings = staff && gateway.evolution ? await gateway.evolution.modelBindings(staff).catch(() => [] as ModelBinding[]) : undefined
      return { providers, capabilities, staff, bindings, secretStorage: await gateway.secretStorage() }
    },
  }

  const configTool = {
    name: MODEL_CONFIG_TOOL,
    description: [
      '按老板的明确要求新增/修改/删除一个模型供应商（写 company.json）。老板没有明确要求就不要调用。',
      'apiKeyRef 只接受 env:XXX 或 secret:XXX；任何明文密钥都会被当场拒绝，请让老板自己配环境变量。',
    ].join('\n'),
    parameters: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: {
        action: { type: 'string', enum: ['upsert', 'remove'], description: '默认 upsert；remove 只需要 id。' },
        id: { type: 'string', minLength: 1, description: '供应商 id，例如 vision-fast。' },
        type: { type: 'string', enum: MODEL_PROVIDER_TYPES },
        provider: { type: 'string', enum: MODEL_PROVIDER_VENDORS, description: '协议，不是厂商名：openai-compatible / gemini / custom。' },
        model: { type: 'string', minLength: 1, description: '供应商侧的真实模型名。' },
        baseUrl: { type: 'string', description: '服务端点。网关不内置任何厂商域名，必须由老板给出。' },
        apiKeyRef: { type: 'string', pattern: '^(env|secret):.+', description: SECRET_REF_HINT },
        timeout: { type: 'integer', minimum: 1000, maximum: 600000 },
        enabled: { type: 'boolean' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) {
      return [{ type: 'text', text: value?.removed ? `已删除模型供应商 ${value.id}` : value?.provider ? `已保存：${providerLine(value.provider)}` : JSON.stringify(value) }]
    } },
    isConcurrencySafe: () => false,
    async execute(args: any) {
      rejectRawSecrets(args, MODEL_CONFIG_TOOL)
      const id = text(args?.id)
      if (!id) throw new ModelGatewayError('invalid-input', 'company_model_config 需要 id。')
      const company = gateway.company
      if (!canWriteProviders(company)) throw new ModelGatewayError('not-configured', '当前 CompanyStore 不支持写入模型供应商。')
      if (args?.action === 'remove') {
        if (typeof company.removeModelProvider !== 'function') throw new ModelGatewayError('not-configured', '当前 CompanyStore 不支持删除模型供应商。')
        const removed = await company.removeModelProvider(id)
        return { id, removed, note: removed ? '已删除；指向它的员工绑定会在下一次路由时被标成 missing。' : '没有找到这个 id。' }
      }
      const existing = (await company.modelProviders()).find((item) => item.id === id)
      // 只做增量修改：老板改一个 model 不该把 baseUrl / apiKeyRef 清空。
      const merged = {
        id,
        type: text(args?.type) || existing?.type,
        provider: text(args?.provider) || existing?.provider,
        model: text(args?.model) || existing?.model,
        baseUrl: text(args?.baseUrl) || existing?.baseUrl,
        apiKeyRef: args?.apiKeyRef === undefined ? existing?.apiKeyRef : args.apiKeyRef,
        timeout: Number(args?.timeout) > 0 ? Math.floor(Number(args.timeout)) : existing?.timeout,
        enabled: typeof args?.enabled === 'boolean' ? args.enabled : existing?.enabled !== false,
      }
      if (!merged.model) throw new ModelGatewayError('invalid-input', 'company_model_config 需要 model（供应商侧的真实模型名）。')
      // 新建时不替老板猜 type/provider：猜错会造出一个永远进不了正确 fallback 链的供应商。
      if (!existing && (!merged.type || !merged.provider)) throw new ModelGatewayError('invalid-input', `新建供应商必须同时给出 type（${MODEL_PROVIDER_TYPES.join(' / ')}）与 provider（${MODEL_PROVIDER_VENDORS.join(' / ')}）。`)
      let saved: ModelProviderConfig
      try {
        saved = await company.upsertModelProvider(merged as ModelProviderConfig)
      } catch (error) {
        throw new ModelGatewayError('invalid-input', error instanceof Error ? error.message : String(error))
      }
      const summaries = await gateway.providerSummaries()
      return { id: saved.id, provider: summaries.find((item) => item.id === saved.id), note: `已保存。用 ${MODEL_TEST_TOOL} 做一次真实连通性自检再交付给老板。` }
    },
  }

  const testTool = {
    name: MODEL_TEST_TOOL,
    description: [
      '对某个模型供应商做真实连通性自检：vision 供应商会真的发一次 1×1 像素的最小请求。',
      '返回 checked=live-call 才代表真的连上了；checked=config-only 只代表配置和密钥看起来齐全，不许当成「测试通过」转述。',
    ].join('\n'),
    parameters: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1, description: '供应商 id。' },
        live: { type: 'boolean', description: '默认 true。false = 只核对配置与密钥，不发请求。' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) {
      const head = `${value?.ok ? '✓' : '✗'} ${value?.providerId} [${value?.type}] ${value?.vendor}/${value?.model} · ${value?.checked === 'live-call' ? '真实请求' : '仅核对配置'}`
      return [{ type: 'text', text: [head, value?.message || '', value?.reply ? `响应片段：${value.reply}` : '', `耗时 ${value?.durationMs || 0}ms`].filter(Boolean).join('\n') }]
    } },
    isConcurrencySafe: () => true,
    execute(args: any, exec?: any) { return gateway.testProvider(text(args?.id), { live: args?.live !== false, signal: exec?.signal }) },
  }

  const bindTool = {
    name: MODEL_BIND_TOOL,
    description: [
      '把某个模型供应商绑定到一名员工的某项能力上（写 evolution.json），priority 越小越先用，这就是他个人的 fallback 顺序。',
      '解绑用 action: unbind。绑定后会立刻返回该员工真实生效的 fallback 链。',
    ].join('\n'),
    parameters: {
      type: 'object', additionalProperties: false, required: ['staff', 'capability'],
      properties: {
        action: { type: 'string', enum: ['bind', 'unbind'], description: '默认 bind。' },
        staff: { ...staffSchema, description: '员工 id。' },
        capability: { type: 'string', enum: MODEL_CAPABILITIES },
        provider: { type: 'string', description: '供应商 id；bind 时必填，unbind 时不填表示解掉这项能力的全部绑定。' },
        priority: { type: 'integer', minimum: 1, maximum: 99, description: '越小越优先，默认 1。' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) {
      const chain = (value?.chain || []).map((item: any) => `${item.providerId}${item.bound ? '(绑定)' : '(公司级)'}`).join(' → ') || '（这项能力当前没有可用供应商）'
      return [{ type: 'text', text: `${value?.staff} 的 ${value?.capability} fallback 链：${chain}` }]
    } },
    isConcurrencySafe: () => false,
    async execute(args: any) {
      const staff = text(args?.staff)
      const capability = toModelCapability(args?.capability)
      if (!staff) throw new ModelGatewayError('invalid-input', 'company_model_bind 需要 staff。')
      if (!capability) throw new ModelGatewayError('invalid-input', `company_model_bind 的 capability 只能是 ${MODEL_CAPABILITIES.join(' / ')}。`)
      const evolution = gateway.evolution
      if (!canWriteBindings(evolution)) throw new ModelGatewayError('not-configured', '当前 EvolutionStore 不支持写入模型绑定。')
      const providerId = text(args?.provider)
      if (args?.action === 'unbind') {
        if (typeof evolution.unbindModel !== 'function') throw new ModelGatewayError('not-configured', '当前 EvolutionStore 不支持解除模型绑定。')
        const removed = await evolution.unbindModel(staff, capability, providerId || undefined)
        const chain = await gateway.router.resolve(capability, staff)
        return { staff, capability, removed, bindings: await evolution.modelBindings(staff), chain: chain.map((item) => ({ providerId: item.config.id, bound: item.bound, priority: item.priority })) }
      }
      if (!providerId) throw new ModelGatewayError('invalid-input', 'company_model_bind 需要 provider（供应商 id）。')
      const config = (await gateway.company.modelProviders()).find((item) => item.id === providerId)
      if (!config) {
        const known = (await gateway.company.modelProviders()).map((item) => item.id).join('、') || '（一个都没有）'
        throw new ModelGatewayError('not-configured', `没有 id 为「${providerId}」的模型供应商。当前已配置：${known}。请先用 ${MODEL_CONFIG_TOOL} 或 cordis 配置的 models: 段加上。`)
      }
      const status = bindingStatus(config, capability, gateway.registry)
      const binding = await evolution.bindModel(staff, { capability, providerId, priority: Math.max(1, Math.floor(Number(args?.priority) || 1)), status })
      const chain = await gateway.router.resolve(capability, staff)
      return {
        staff, capability, binding, bindings: await evolution.modelBindings(staff),
        chain: chain.map((item) => ({ providerId: item.config.id, bound: item.bound, priority: item.priority })),
        note: status === 'available' ? undefined : `已记下这条绑定，但 ${providerId} 当前不可用（停用，或没有支持 ${capability} 的适配器），状态如实标成 missing。`,
      }
    },
  }

  return [listTool, configTool, testTool, bindTool]
}

// ---------------------------------------------------------------------------
// 挂载
// ---------------------------------------------------------------------------

/** 给员工的硬约束：看不见图就必须调工具，工具报错就必须原样转达，绝不编造。 */
export const VISION_SYSTEM_RULE = [
  '【视觉能力铁律】',
  '1. 你本人的文本模型看不到图片内容。老板发来图片、截图、设计稿、报错图时，必须调用 vision_analyze 获得真实视觉结果后再回答。',
  '2. 如果 vision_analyze 报错说没有可用的图片理解模型，必须把错误里的引导原文原样转达给老板，然后停止分析该图片。',
  '3. 任何情况下都不得根据文件名、扩展名、聊天上下文或常识去猜测、脑补、编造图片里的内容；没有视觉结果就如实说明看不到。',
  '4. vision_analyze 的结果属于事实材料，可以引用与解读，但不要凭空扩展成图里没有的细节。',
].join('\n')

export type RegisterModelGatewayDeps = {
  company?: CompanyLike
  evolution?: EvolutionLike & { modelBindings(employeeId: string): Promise<ModelBinding[]> }
  registry?: ProviderRegistry
  /** vision_analyze 的 staff 参数枚举；不传则接受任意员工 id 字符串。 */
  staffIds?: string[]
}

/**
 * 挂载 Model Gateway、cordis models: 配置入口、vision_analyze 与四个 company_model_* 工具。
 * 集成方应把已经存在的 EvolutionStore / CompanyStore 实例通过 deps 传进来，
 * 避免同一份 company.json / evolution.json 出现两个写入者。
 *
 * 启动时会把 config.models / config.modelBindings 落库；这一步是异步的，
 * 想等它完成（测试、健康检查）就 await gateway.configReady。
 */
export function registerModelGateway(ctx: any, config?: any, deps: RegisterModelGatewayDeps = {}): ModelGateway {
  const evolution = deps.evolution || (config?.evolutionStore as EvolutionStore | undefined) || new EvolutionStore(config?.memoryFile)
  const company = deps.company || (config?.companyStore as CompanyStore | undefined) || new CompanyStore(evolution as EvolutionStore, config?.companyFile)
  const gateway = new ModelGateway({
    company,
    evolution,
    registry: deps.registry,
    secretService: detectSecretService(ctx),
    vaultFile: config?.secretsFile,
    vaultPassphrase: config?.secretsPassphrase,
    defaultTimeout: config?.modelTimeout,
    logger: ctx?.logger,
  })
  // Phase 4 的配置入口：不读这一段，那条 fallback 链在真实运行里永远走不到。
  gateway.configReady = applyModelConfig(gateway, config, ctx?.logger).catch((error) => {
    const detail = error instanceof Error ? error.message : String(error)
    ctx?.logger?.warn?.(`dsh-org-panel: 载入 cordis models: 配置失败：${detail}`)
    return { providers: [], bindings: [], errors: [detail] } as ModelConfigSummary
  })
  const tools = ctx?.tools
  if (!tools || typeof tools.register !== 'function') {
    ctx?.logger?.warn?.('dsh-org-panel: model gateway registered without tools; vision_analyze is unavailable')
    return gateway
  }
  tools.register(createVisionAnalyzeTool(gateway, { staffIds: deps.staffIds }))
  for (const tool of createModelToolset(gateway, { staffIds: deps.staffIds })) tools.register(tool)
  ctx?.systemPrompt?.section?.({ name: 'dsh-org-panel:vision', order: -8, text: VISION_SYSTEM_RULE })
  return gateway
}
