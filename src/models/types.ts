// 「赛博公司」模型网关公共契约：Employee → Capability Router → Gateway → Provider 全链路。
// 铁律（需求文档五十九）：models/ 下任何文件都不许出现厂商域名、厂商默认模型名或厂商专属兜底；
// 厂商差异一律下沉到 providers/ 适配器，通过 registry 注册，网关只认 config 里的 baseUrl + model。
// ModelProviderConfig / ModelBinding 直接复用持久层（src/persistence/types.ts）定义，不重复造型。
import type { ModelBinding, ModelBindingStatus, ModelCapability, ModelProviderConfig, ModelProviderSummary, ModelProviderType, ModelProviderVendor, SecretRef } from '../persistence/types'

export { RAW_SECRET_FIELDS, isSecretRef } from '../persistence/types'
export type { ModelBinding, ModelBindingStatus, ModelCapability, ModelProviderConfig, ModelProviderSummary, ModelProviderType, ModelProviderVendor, SecretRef }

export const MODEL_CAPABILITIES: ModelCapability[] = ['text', 'vision', 'image-generation', 'video-generation', 'embedding']

export const MODEL_PROVIDER_TYPES: ModelProviderType[] = ['text', 'vision', 'image', 'video', 'embedding']

export const MODEL_PROVIDER_VENDORS: ModelProviderVendor[] = ['openai-compatible', 'gemini', 'custom']

/** 文档十一的 provider.type 与十二的 binding.capability 命名不同，这里是唯一映射表。 */
export const CAPABILITY_PROVIDER_TYPE: Record<ModelCapability, ModelProviderType> = {
  text: 'text', vision: 'vision', 'image-generation': 'image', 'video-generation': 'video', embedding: 'embedding',
}

/** 反向映射：一个供应商 type 对应哪项能力。company_model_test 用它决定要不要真发一次请求。 */
export const PROVIDER_TYPE_CAPABILITY: Record<ModelProviderType, ModelCapability> = {
  text: 'text', vision: 'vision', image: 'image-generation', video: 'video-generation', embedding: 'embedding',
}

/** cordis 配置里 capability 允许写 provider.type 的短名（image/video），这里统一归一化。 */
export function toModelCapability(value: unknown): ModelCapability | undefined {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return undefined
  if ((MODEL_CAPABILITIES as string[]).includes(raw)) return raw as ModelCapability
  return (MODEL_PROVIDER_TYPES as string[]).includes(raw) ? PROVIDER_TYPE_CAPABILITY[raw as ModelProviderType] : undefined
}

// ---------------------------------------------------------------------------
// vision_analyze（需求文档十三）
// ---------------------------------------------------------------------------

export type VisionMode = 'general' | 'describe' | 'ocr' | 'ui' | 'document' | 'chart' | 'code-screenshot'

export const VISION_MODES: VisionMode[] = ['general', 'describe', 'ocr', 'ui', 'document', 'chart', 'code-screenshot']

export type VisionResult = {
  providerId: string
  model: string
  description: string
  extractedText?: string
  observations?: string[]
  objects?: string[]
  confidence?: number
}

/** 归一化后的图片：要么是 base64 内联，要么是远端 URL；两者必须带真实 mimeType。 */
export type NormalizedImage = {
  name?: string
  mimeType: string
  kind: 'base64' | 'url'
  base64?: string
  url?: string
  bytes?: number
}

export type VisionImageInput = string | { url?: string; path?: string; data?: string; base64?: string; mimeType?: string; name?: string }

export type VisionRequest = {
  images: VisionImageInput[]
  mode?: VisionMode
  question?: string
  /** 员工 id：用于按员工 ModelBinding 的 priority 路由；缺省时走公司级视觉供应商顺序。 */
  employeeId?: string
  signal?: AbortSignal
}

/**
 * 需求文档十五：没有可用视觉供应商时员工必须回复的原文。
 * 这段话是代码级保证的一部分 —— 网关此时抛错并把它作为 guidance 带出，绝不返回任何图片描述。
 */
export const VISION_UNAVAILABLE_MESSAGE = [
  '我目前没有可用的图片理解模型。',
  '',
  '可以在：',
  '公司设置 → 模型 → 视觉模型',
  '',
  '配置一个多模态模型后再让我分析。',
].join('\n')

// ---------------------------------------------------------------------------
// 错误归一化
// ---------------------------------------------------------------------------

export type ModelErrorCode =
  | 'not-configured'
  | 'missing-key'
  | 'unsupported'
  | 'timeout'
  | 'auth'
  | 'rate-limit'
  | 'server'
  | 'network'
  | 'invalid-response'
  | 'invalid-input'

/** 可以继续沿 fallback 链向下一家供应商重试的错误码。 */
export const FALLBACK_CODES: ModelErrorCode[] = ['missing-key', 'timeout', 'auth', 'rate-limit', 'server', 'network', 'invalid-response', 'not-configured', 'unsupported']

export type ModelGatewayErrorOptions = {
  providerId?: string
  status?: number
  /** 需要原样转达给老板的引导文案（例如未配置视觉模型时的文档十五原文）。 */
  guidance?: string
  cause?: unknown
}

export class ModelGatewayError extends Error {
  readonly code: ModelErrorCode
  readonly providerId?: string
  readonly status?: number
  readonly guidance?: string
  readonly cause?: unknown

  constructor(code: ModelErrorCode, message: string, options: ModelGatewayErrorOptions = {}) {
    super(message)
    this.name = 'ModelGatewayError'
    this.code = code
    this.providerId = options.providerId
    this.status = options.status
    this.guidance = options.guidance
    this.cause = options.cause
  }

  get retryable(): boolean {
    return FALLBACK_CODES.includes(this.code)
  }
}

export function isModelGatewayError(value: unknown): value is ModelGatewayError {
  return value instanceof ModelGatewayError
}

export function asGatewayError(error: unknown, providerId?: string): ModelGatewayError {
  if (isModelGatewayError(error)) return error
  const message = error instanceof Error ? error.message : String(error)
  const aborted = /abort/i.test(message)
  return new ModelGatewayError(aborted ? 'timeout' : 'network', message, { providerId, cause: error })
}

export function httpErrorCode(status: number): ModelErrorCode {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'not-configured'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 429) return 'rate-limit'
  if (status >= 500) return 'server'
  return 'invalid-input'
}

/** 每一次向某家供应商发起的真实尝试记录，用于把 fallback 链暴露给 UI 与日志。 */
export type ProviderAttempt = {
  providerId: string
  vendor: ModelProviderVendor
  model: string
  ok: boolean
  code?: ModelErrorCode
  message?: string
  durationMs: number
}

// ---------------------------------------------------------------------------
// 密钥：对外永远只暴露 configured 布尔值与掩码串（需求文档三十一）
// ---------------------------------------------------------------------------

export type SecretSource = 'none' | 'env' | 'secret-service' | 'vault'

export type SecretStatus = {
  ref?: SecretRef
  source: SecretSource
  configured: boolean
  /** 形如 sk-1****93ac；永远不是完整值。 */
  masked?: string
  /** 只有 source === 'vault' 时有值：这份本地库到底是真加密还是只是混淆。 */
  storage?: SecretStorageMode
}

/**
 * 本地密钥库的真实保护等级。UI 必须按这个值显示，不许一律打绿标（审计 FAIL 项）。
 * - 'obfuscated'：AES-GCM 的密钥材料只来自本机公开信息（家目录 / 用户名 / 主机名）与同文件里的明文 salt，
 *   同机同用户可以直接解密。它只防「明文躺在磁盘和日志里」，不防同机攻击者，等同于混淆。
 * - 'encrypted' ：密钥材料来自老板提供的口令（DSH_ORG_PANEL_SECRETS_PASSPHRASE），口令不落盘，
 *   拿到文件也解不开。
 */
export type SecretStorageMode = 'obfuscated' | 'encrypted'

export const SECRET_STORAGE_LABEL: Record<SecretStorageMode, string> = {
  obfuscated: '仅本机混淆存储',
  encrypted: '口令加密存储',
}

/** 混淆模式下必须原样显示给老板的说明。不许被 UI 改写成「已加密」。 */
export const SECRET_STORAGE_OBFUSCATED_WARNING = [
  '本地密钥库当前只是「本机混淆」，不是真正的密钥保护：',
  '加密用的密钥材料仅来自本机公开信息（家目录 / 用户名 / 主机名）与同一个文件里的明文 salt，',
  '任何能读到这个文件、又能在同一台机器上以同一用户身份运行代码的人都能解出明文。',
  `想要真正的加密，请设置环境变量 ${'DSH_ORG_PANEL_SECRETS_PASSPHRASE'}（口令不落盘），或改用 apiKeyRef: env:XXX。`,
].join('\n')

/** 密钥库能力标志：由 SecretVault 依据真实实现与真实文件权限算出，供 UI 如实显示。 */
export type SecretStorageStatus = {
  mode: SecretStorageMode
  /** 新写入的条目用哪种密钥材料。 */
  keySource: 'machine' | 'passphrase'
  cipher: 'AES-256-GCM'
  kdf: 'PBKDF2-SHA256'
  iterations: number
  filePath: string
  exists: boolean
  entries: number
  /** 文件权限的八进制串，如 "600"；文件不存在或 stat 失败时为 undefined。 */
  permissions?: string
  /** chmod 0600 是否确认生效；false 表示同机其他用户可能读得到这个文件。 */
  ownerOnly: boolean
  /** UI 直接显示的标签，不许自己另起一个更好听的名字。 */
  label: string
  /** 非空 = 这不是真加密，UI 必须把它显示出来，且不许打绿标。 */
  warning?: string
}

/** 掩码：保留前 4 位与后 4 位，中间固定四颗星；短值全掩。 */
export function maskSecret(value: string): string {
  const text = String(value || '')
  if (!text) return ''
  if (text.length <= 8) return '****'
  return `${text.slice(0, 4)}****${text.slice(-4)}`
}

/** 把任何可能混进错误文本/日志的完整密钥抹掉。API Key 绝不进日志、绝不回传。 */
export function scrubSecrets(text: string, secrets: Array<string | undefined>): string {
  let output = String(text || '')
  for (const secret of secrets) {
    if (!secret || secret.length < 6) continue
    output = output.split(secret).join('****')
  }
  return output
}

// ---------------------------------------------------------------------------
// 供应商适配器契约
// ---------------------------------------------------------------------------

export type ProviderVisionInput = {
  config: ModelProviderConfig
  /** 已解析的明文密钥；适配器只允许把它放进请求头，禁止写日志或回传。 */
  apiKey?: string
  systemPrompt: string
  prompt: string
  images: NormalizedImage[]
  mode: VisionMode
  timeout: number
  signal?: AbortSignal
  /** 把 URL 图片取回并转成 base64；只支持内联数据的厂商用它。 */
  inline(image: NormalizedImage): Promise<NormalizedImage>
}

export type ProviderTextOutput = {
  text: string
  /** 供应商回报的真实模型名；缺省时网关回落到 config.model。 */
  model?: string
  raw?: unknown
}

export type ProviderAdapter = {
  vendor: ModelProviderVendor
  label: string
  supports(capability: ModelCapability): boolean
  analyzeVision(input: ProviderVisionInput): Promise<ProviderTextOutput>
}

// ---------------------------------------------------------------------------
// 共用 HTTP：超时 + 错误归一化，三家适配器都走这里，避免各写一份 fetch
// ---------------------------------------------------------------------------

export type JsonRequest = {
  url: string
  headers: Record<string, string>
  body: unknown
  timeout: number
  providerId: string
  signal?: AbortSignal
  /** 出错时用于抹掉回显里的密钥。 */
  secrets?: Array<string | undefined>
}

export async function requestJson(request: JsonRequest): Promise<any> {
  const controller = new AbortController()
  const timeout = Math.max(1000, Math.floor(request.timeout) || 30_000)
  const timer = setTimeout(() => controller.abort(), timeout)
  const onAbort = () => controller.abort()
  request.signal?.addEventListener('abort', onAbort)
  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...request.headers },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = scrubSecrets(await response.text().catch(() => ''), request.secrets || []).replace(/\s+/g, ' ').slice(0, 400)
      throw new ModelGatewayError(httpErrorCode(response.status), `供应商返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`, { providerId: request.providerId, status: response.status })
    }
    const raw = await response.text()
    try {
      return JSON.parse(raw)
    } catch {
      throw new ModelGatewayError('invalid-response', `供应商返回的不是合法 JSON：${scrubSecrets(raw, request.secrets || []).slice(0, 200)}`, { providerId: request.providerId })
    }
  } catch (error) {
    if (isModelGatewayError(error)) throw error
    if (controller.signal.aborted) throw new ModelGatewayError('timeout', `请求在 ${timeout}ms 内没有返回`, { providerId: request.providerId, cause: error })
    throw asGatewayError(error, request.providerId)
  } finally {
    clearTimeout(timer)
    request.signal?.removeEventListener('abort', onAbort)
  }
}

/** 去掉 baseUrl 末尾斜杠；空串直接抛「未配置」而不是替用户脑补一个厂商地址。 */
export function requireBaseUrl(config: ModelProviderConfig): string {
  const base = String(config.baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new ModelGatewayError('not-configured', `模型供应商「${config.id}」没有配置 baseUrl，请在「公司设置 → 模型」里补齐。`, { providerId: config.id })
  return base
}
