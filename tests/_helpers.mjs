// 单元测试公共夹具。不是测试文件（不匹配 *.test.mjs），node --test 不会把它当用例跑。
//
// 统一口径：所有测试都跑 lib/index.js —— 也就是 npm pack 真正发出去的产物。
// 测发布产物而不是 src/*.ts，是因为仓库没有 TS test runner，而且这样能顺带守住
// 「该导出的东西有没有真的导出」这条线。
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 每个用例一个独立临时目录，绝不碰用户真实的 ~/.dsh-org-panel。 */
export async function scratch(name) {
  const dir = await mkdtemp(join(tmpdir(), `dsh-org-panel-${name}-`))
  await mkdir(dir, { recursive: true })
  return dir
}

/** 等待 Router 的串行队列 / fire-and-forget 分支跑完。 */
export function settle(ms = 40) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 1×1 透明 PNG：给 vision 用的真实合法图片，避免测试依赖网络或磁盘。 */
export const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export const PIXEL_PNG_IMAGE = { name: 'shot.png', mimeType: 'image/png', data: PIXEL_PNG_BASE64 }

/**
 * 造一个只有 tools 服务的假 ctx。names 就是当前 Tool Registry 里真实存在的工具名，
 * 形态与 DSH 的 tools.list() 一致（scanToolRegistry 会去探测 list/names/keys/entries/getAll）。
 */
export function fakeCtx(names, extra = {}) {
  const logs = []
  return {
    logs,
    tools: { list: () => names.map((name) => ({ name, description: `${name} tool` })) },
    logger: {
      info: (message) => logs.push(['info', message]),
      warn: (message) => logs.push(['warn', message]),
      error: (message) => logs.push(['error', message]),
      debug: (message) => logs.push(['debug', message]),
    },
    ...extra,
  }
}
