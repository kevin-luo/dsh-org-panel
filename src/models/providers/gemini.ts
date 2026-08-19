// Gemini generateContent 协议适配器：只实现协议形状（:generateContent + inline_data + x-goog-api-key），
// 端点与模型名一律来自 config.baseUrl / config.model —— 不内置任何域名或模型默认值。
// 自建代理、企业网关或官方端点都由老板在「公司设置 → 模型」里填。
import { ModelGatewayError, requestJson, requireBaseUrl, type ModelCapability, type ProviderAdapter, type ProviderTextOutput, type ProviderVisionInput } from '../types'

const SUPPORTED: ModelCapability[] = ['text', 'vision', 'embedding']

function endpoint(input: ProviderVisionInput): string {
  const base = requireBaseUrl(input.config)
  if (/:[a-zA-Z]+Content$/.test(base)) return base
  const model = input.config.model.trim()
  if (!model) throw new ModelGatewayError('not-configured', `模型供应商「${input.config.id}」没有配置 model。`, { providerId: input.config.id })
  const path = /\/models$/.test(base) ? base : `${base}/models`
  return `${path}/${encodeURIComponent(model)}:generateContent`
}

function readText(payload: any): string {
  const parts = payload?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts.map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('')
}

export const geminiAdapter: ProviderAdapter = {
  vendor: 'gemini',
  label: 'Gemini 协议',
  supports(capability) { return SUPPORTED.includes(capability) },
  async analyzeVision(input): Promise<ProviderTextOutput> {
    // 该协议只接受内联字节，远端 URL 必须先取回。
    const images = []
    for (const image of input.images) images.push(await input.inline(image))
    const headers: Record<string, string> = {}
    if (input.apiKey) headers['x-goog-api-key'] = input.apiKey
    const payload = await requestJson({
      url: endpoint(input),
      headers,
      timeout: input.timeout,
      providerId: input.config.id,
      signal: input.signal,
      secrets: [input.apiKey],
      body: {
        systemInstruction: { parts: [{ text: input.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: input.prompt }, ...images.map((image) => ({ inline_data: { mime_type: image.mimeType, data: image.base64 } }))] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      },
    })
    const blocked = payload?.promptFeedback?.blockReason || payload?.candidates?.[0]?.finishReason
    const text = readText(payload).trim()
    if (!text) {
      const reason = typeof blocked === 'string' && blocked && blocked !== 'STOP' ? `：${blocked}` : ''
      throw new ModelGatewayError('invalid-response', `供应商没有返回任何可用的视觉分析文本${reason}。`, { providerId: input.config.id })
    }
    const model = typeof payload?.modelVersion === 'string' ? payload.modelVersion : undefined
    return { text, model, raw: payload }
  },
}
