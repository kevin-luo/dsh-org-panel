// 自定义 HTTP 适配器：给「既不是 OpenAI 兼容、也不是 Gemini 协议」的自建视觉服务留的通用出口。
// 契约：POST config.baseUrl，收 JSON，回 JSON。
// 请求体：{ capability, model, mode, system, prompt, question, images:[{name,mimeType,url|base64}] }
// 回包：直接给 VisionResult 形状（含 description）最佳；也接受 { text } / { content } / OpenAI / Gemini 形状。
import { ModelGatewayError, requestJson, requireBaseUrl, type ModelCapability, type ProviderAdapter, type ProviderTextOutput, type ProviderVisionInput } from '../types'

const SUPPORTED: ModelCapability[] = ['text', 'vision', 'image-generation', 'video-generation', 'embedding']
const TEXT_FIELDS = ['description', 'text', 'content', 'output', 'result', 'message', 'answer']

function readText(payload: any): string {
  if (typeof payload === 'string') return payload
  if (!payload || typeof payload !== 'object') return ''
  // 已经是结构化视觉结果：整包回给网关解析，保留 extractedText / observations / objects。
  if (typeof payload.description === 'string' && payload.description.trim()) return JSON.stringify(payload)
  for (const field of TEXT_FIELDS) if (typeof payload[field] === 'string' && payload[field].trim()) return payload[field]
  const openai = payload?.choices?.[0]?.message?.content
  if (typeof openai === 'string') return openai
  if (Array.isArray(openai)) return openai.map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('')
  const gemini = payload?.candidates?.[0]?.content?.parts
  if (Array.isArray(gemini)) return gemini.map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('')
  return ''
}

export const customAdapter: ProviderAdapter = {
  vendor: 'custom',
  label: '自定义 HTTP',
  supports(capability) { return SUPPORTED.includes(capability) },
  async analyzeVision(input): Promise<ProviderTextOutput> {
    const headers: Record<string, string> = {}
    if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`
    const payload = await requestJson({
      url: requireBaseUrl(input.config),
      headers,
      timeout: input.timeout,
      providerId: input.config.id,
      signal: input.signal,
      secrets: [input.apiKey],
      body: {
        capability: 'vision',
        model: input.config.model,
        mode: input.mode,
        system: input.systemPrompt,
        prompt: input.prompt,
        images: input.images.map((image) => ({ name: image.name, mimeType: image.mimeType, url: image.kind === 'url' ? image.url : undefined, base64: image.kind === 'base64' ? image.base64 : undefined })),
      },
    })
    const text = readText(payload).trim()
    if (!text) throw new ModelGatewayError('invalid-response', '自定义视觉服务没有返回 description/text 字段。', { providerId: input.config.id })
    return { text, model: typeof payload?.model === 'string' ? payload.model : undefined, raw: payload }
  },
}
