// vision_analyze（需求文档十三）：员工的真实图片理解工具。
// 代码级铁律（需求文档十五）：没有配置视觉供应商时，本工具直接报错并把引导原文抛给员工，
// 绝不返回任何 description —— 员工拿不到可复述的图片内容，也就无法编造。
import { ModelGatewayError, VISION_MODES, VISION_UNAVAILABLE_MESSAGE, isModelGatewayError, type VisionMode, type VisionResult } from '../models/types'
import type { ModelGateway } from '../models/gateway'

export const VISION_TOOL = 'vision_analyze'

export type VisionAnalyzeOptions = {
  /** 传了就把 staff 参数收成枚举；不传则接受任意员工 id。 */
  staffIds?: string[]
}

const MODE_HINT = 'general=通用理解，describe=细致描述，ocr=文字识别，ui=界面分析，document=文档理解，chart=图表理解，code-screenshot=代码截图。'

function line(label: string, value?: string): string { return value ? `${label}\n${value}\n` : '' }

/** 需求文档十四的员工私有上下文格式：把视觉结果拼成注入 Text Model 的材料。 */
export function formatVisionContext(result: VisionResult, options: { fileName?: string; question?: string } = {}): string {
  const observations = (result.observations || []).map((item, index) => `${index + 1}. ${item}`).join('\n')
  return [
    '[附件理解结果]',
    '',
    line('文件：', options.fileName || '（未提供文件名）'),
    line('视觉模型：', `${result.providerId}（${result.model}）`),
    line('页面描述：', result.description),
    line('OCR：', result.extractedText),
    observations ? line('关键观察：', observations) : '',
    result.objects?.length ? line('识别到的对象：', result.objects.join('、')) : '',
    typeof result.confidence === 'number' ? line('置信度：', result.confidence.toFixed(2)) : '',
    options.question ? ['[老板原问题]', '', options.question].join('\n') : '',
  ].filter(Boolean).join('\n').trim()
}

function renderResult(value: any): string {
  if (!value || typeof value !== 'object') return String(value ?? '')
  const observations = Array.isArray(value.observations) ? value.observations.map((item: string, index: number) => `${index + 1}. ${item}`).join('\n') : ''
  return [
    `视觉模型：${value.providerId}（${value.model}）· 模式 ${value.mode} · ${value.imageCount} 张图`,
    '',
    line('描述：', value.description),
    line('OCR：', value.extractedText),
    observations ? line('关键观察：', observations) : '',
    Array.isArray(value.objects) && value.objects.length ? line('对象：', value.objects.join('、')) : '',
    typeof value.confidence === 'number' ? `置信度：${value.confidence.toFixed(2)}` : '',
  ].filter(Boolean).join('\n').trim()
}

export function createVisionAnalyzeTool(gateway: ModelGateway, options: VisionAnalyzeOptions = {}) {
  const staffIds = (options.staffIds || []).filter(Boolean)
  const staffSchema = staffIds.length ? { type: 'string', enum: staffIds } : { type: 'string' }
  return {
    name: VISION_TOOL,
    description: [
      '用真实的多模态视觉模型分析图片，返回结构化结果（描述 / OCR 文本 / 关键观察 / 对象 / 置信度）。',
      '文本模型看不到图片，遇到截图、设计稿、报错图、文档图必须先调用本工具。',
      '如果公司还没有配置视觉模型，本工具会直接报错；此时必须把错误里的引导原文原样转达给老板，禁止凭文件名或上下文编造图片内容。',
    ].join('\n'),
    parameters: {
      type: 'object', additionalProperties: false, required: ['images'],
      properties: {
        images: {
          type: 'array', minItems: 1, maxItems: 8,
          items: { type: 'string', minLength: 1, description: '图片引用：data:image/*;base64,... 、http(s) 链接，或本机绝对路径。' },
        },
        mode: { type: 'string', enum: VISION_MODES, description: MODE_HINT },
        question: { type: 'string', description: '老板对这张图的具体问题；视觉模型会在描述里正面回答。' },
        staff: { ...staffSchema, description: '发起分析的员工 id：用于按该员工的模型绑定优先级路由，并记录真实技能证据。' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args: any, value: any) { return [{ type: 'text', text: renderResult(value) }] } },
    isConcurrencySafe: () => true,
    async execute(args: any, exec?: any) {
      const images = Array.isArray(args?.images) ? args.images.map((item: unknown) => String(item)) : []
      const mode = (VISION_MODES.includes(args?.mode) ? args.mode : 'general') as VisionMode
      const question = typeof args?.question === 'string' ? args.question.trim() : ''
      const staff = typeof args?.staff === 'string' && args.staff.trim() ? args.staff.trim() : undefined
      try {
        const analysis = await gateway.analyzeVision({ images, mode, question: question || undefined, employeeId: staff, signal: exec?.signal })
        await gateway.recordVisionUsage({ employeeId: staff, providerId: analysis.result.providerId, model: analysis.result.model, success: true, durationMs: analysis.durationMs })
        return { ...analysis.result, mode: analysis.mode, imageCount: analysis.imageCount, durationMs: analysis.durationMs, attempts: analysis.attempts, question: question || undefined }
      } catch (error) {
        if (isModelGatewayError(error) && error.code === 'not-configured' && error.guidance) {
          // 这里是文档十五的代码级保证：员工只会拿到这段引导文案，拿不到任何图片内容。
          throw new Error(error.guidance)
        }
        if (isModelGatewayError(error) && error.providerId) await gateway.recordVisionUsage({ employeeId: staff, providerId: error.providerId, success: false, code: error.code })
        throw error instanceof Error ? error : new ModelGatewayError('server', String(error))
      }
    },
  }
}

export { VISION_UNAVAILABLE_MESSAGE }
