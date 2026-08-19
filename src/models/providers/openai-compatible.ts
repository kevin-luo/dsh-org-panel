// OpenAI 兼容协议适配器（/chat/completions + image_url 多模态消息）。
// 只认 config.baseUrl 与 config.model：没有内置端点、没有默认模型名，也不识别任何具体厂商。
// 自建 vLLM / Ollama / 网关 / 任意兼容服务都走这一份实现。
import { ModelGatewayError, requestJson, requireBaseUrl, type ModelCapability, type NormalizedImage, type ProviderAdapter, type ProviderTextOutput, type ProviderVisionInput } from '../types'

const SUPPORTED: ModelCapability[] = ['text', 'vision', 'embedding']

function endpoint(input: ProviderVisionInput): string {
  const base = requireBaseUrl(input.config)
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`
}

function imagePart(image: NormalizedImage) {
  const url = image.kind === 'url' ? String(image.url) : `data:${image.mimeType};base64,${image.base64}`
  return { type: 'image_url', image_url: { url } }
}

/** 兼容 content 为字符串、内容块数组、或老式 choices[].text 三种回包形状。 */
function readText(payload: any): string {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined
  const content = choice?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part: any) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '')).join('')
  if (typeof choice?.text === 'string') return choice.text
  return ''
}

export const openAiCompatibleAdapter: ProviderAdapter = {
  vendor: 'openai-compatible',
  label: 'OpenAI 兼容',
  supports(capability) { return SUPPORTED.includes(capability) },
  async analyzeVision(input): Promise<ProviderTextOutput> {
    const headers: Record<string, string> = {}
    if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`
    const payload = await requestJson({
      url: endpoint(input),
      headers,
      timeout: input.timeout,
      providerId: input.config.id,
      signal: input.signal,
      secrets: [input.apiKey],
      body: {
        model: input.config.model,
        temperature: 0,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: [{ type: 'text', text: input.prompt }, ...input.images.map(imagePart)] },
        ],
      },
    })
    const text = readText(payload).trim()
    if (!text) throw new ModelGatewayError('invalid-response', '供应商没有返回任何可用的视觉分析文本。', { providerId: input.config.id })
    return { text, model: typeof payload?.model === 'string' ? payload.model : undefined, raw: payload }
  },
}
