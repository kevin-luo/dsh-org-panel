// DSH 社区插件市场检索：优先 awesome-dsh-plugin curated registry，失败时回退 GitHub dsh-plugin topic。
// 赛博公司只负责“发现 + 判断 + 审批链”，绝不因为搜索到包就静默安装第三方代码。

type MarketPlugin = {
  name: string
  owner: string
  url: string
  page?: string
  category?: string
  description: { en?: string; zh?: string } | string
  npm?: string | null
  stars?: number
  install?: string
  added?: string
}

type Registry = {
  updated?: string
  count?: number
  categories?: Record<string, { en?: string; zh?: string }>
  plugins?: MarketPlugin[]
}

type PluginTrust = 'curated' | 'discovered'
type PluginScope = 'company-infrastructure' | 'employee-capability'

type SearchResult = {
  name: string
  owner: string
  category: string
  categoryName: string
  description: string
  stars: number
  url: string
  page?: string
  install: string
  source: 'awesome-dsh-plugin' | 'github-topic'
  trust: PluginTrust
  scope: PluginScope
  scopeReason?: string
  score: number
}

const REGISTRY_URL = 'https://awesome-dsh-plugin.com/plugins.json'
const GITHUB_SEARCH = 'https://api.github.com/search/repositories'
const CACHE_TTL = 5 * 60 * 1000

let registryCache: { at: number; data: Registry } | null = null

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[\s_./\\-]+/g, ' ').trim()
}

function tokens(query: string): string[] {
  const raw = compact(query)
  const chunks = raw.split(/[\s,，。；;、|]+/).filter((item) => item.length > 1)
  return Array.from(new Set(chunks.concat(raw.length > 1 ? [raw] : [])))
}

function zhDescription(plugin: MarketPlugin): string {
  if (typeof plugin.description === 'string') return plugin.description
  return text(plugin.description?.zh) || text(plugin.description?.en) || ''
}

function categoryName(registry: Registry, id: string): string {
  return registry.categories?.[id]?.zh || registry.categories?.[id]?.en || id || '其他'
}

function pluginKey(plugin: Pick<MarketPlugin, 'owner' | 'name'>): string {
  return `${plugin.owner}/${plugin.name}`.toLowerCase()
}

/**
 * 公司级基础设施与“某个员工自己的技能插件”要分开判断。
 * 这里只做保守分类：通讯、网关、市场/管理类优先当公司共享基础设施，其余默认员工能力。
 */
function pluginScope(plugin: MarketPlugin): { scope: PluginScope; reason?: string } {
  const key = pluginKey(plugin)
  const haystack = compact(`${plugin.name} ${zhDescription(plugin)} ${plugin.category || ''}`)
  if (key === 'xmanrui/dsh-im') return { scope: 'company-infrastructure', reason: '统一承载微信 / 飞书 / QQ 等外部通讯，应该全公司共享。' }
  if (/(plugin market|插件市场|gateway|网关|connector|integration hub|通讯接入|im bridge)/i.test(haystack)) {
    return { scope: 'company-infrastructure', reason: '更像公司级基础设施，优先共享复用，避免每个员工重复安装。' }
  }
  return { scope: 'employee-capability' }
}

function strategicBoost(plugin: MarketPlugin, query: string): number {
  const key = pluginKey(plugin)
  // 已实读并接入的成熟 IM 基础设施：只有用户明确在找通讯能力时才加权，不污染其它搜索。
  if (key === 'xmanrui/dsh-im' && /(微信|wechat|飞书|lark|qq|钉钉|dingtalk|企微|wecom|slack|telegram|discord|whatsapp|\bim\b|通讯|聊天|机器人)/i.test(query)) return 40
  return 0
}

function scorePlugin(plugin: MarketPlugin, query: string, staff = ''): number {
  const name = compact(plugin.name)
  const description = compact(zhDescription(plugin))
  const category = compact(plugin.category || '')
  const haystack = `${name} ${description} ${category}`
  let score = Math.log10(Math.max(1, Number(plugin.stars || 0)) + 1) * 2 + strategicBoost(plugin, query)
  for (const token of tokens(query + ' ' + staff)) {
    if (name.includes(token)) score += 12
    if (description.includes(token)) score += 5
    if (category.includes(token)) score += 3
    if (haystack.includes(token)) score += 1
  }
  return score
}

async function fetchJson(url: string, timeoutMs = 7000): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { 'accept': 'application/json', 'user-agent': 'dsh-org-panel/2.1 community-market' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function loadRegistry(): Promise<Registry> {
  if (registryCache && Date.now() - registryCache.at < CACHE_TTL) return registryCache.data
  const data = await fetchJson(REGISTRY_URL)
  if (!data || !Array.isArray(data.plugins)) throw new Error('社区插件目录格式异常')
  registryCache = { at: Date.now(), data }
  return data
}

function installFor(plugin: MarketPlugin): string {
  if (plugin.install) return plugin.install
  if (plugin.npm) return `dsh plugin --profile web add ${plugin.npm}`
  if (plugin.owner && plugin.name) return `dsh plugin --profile web add github:${plugin.owner}/${plugin.name}`
  return ''
}

async function searchCurated(query: string, staff: string, category: string, limit: number): Promise<{ meta: any; results: SearchResult[] }> {
  const registry = await loadRegistry()
  const wanted = compact(category)
  const results = (registry.plugins || [])
    .filter((plugin) => !wanted || compact(plugin.category || '').includes(wanted) || compact(categoryName(registry, plugin.category || '')).includes(wanted))
    .map((plugin) => ({ plugin, score: scorePlugin(plugin, query, staff) }))
    .filter((item) => item.score > 1)
    .sort((a, b) => b.score - a.score || Number(b.plugin.stars || 0) - Number(a.plugin.stars || 0))
    .slice(0, limit)
    .map(({ plugin, score }) => {
      const scope = pluginScope(plugin)
      return {
        name: plugin.name,
        owner: plugin.owner,
        category: plugin.category || 'other',
        categoryName: categoryName(registry, plugin.category || ''),
        description: zhDescription(plugin),
        stars: Number(plugin.stars || 0),
        url: plugin.url,
        page: plugin.page,
        install: installFor(plugin),
        source: 'awesome-dsh-plugin' as const,
        trust: 'curated' as const,
        scope: scope.scope,
        scopeReason: scope.reason,
        score: Math.round(score * 100) / 100,
      }
    })
  return { meta: { source: 'awesome-dsh-plugin', trust: 'curated', updated: registry.updated || null, total: registry.count || registry.plugins?.length || 0 }, results }
}

async function searchGithubTopic(query: string, limit: number): Promise<{ meta: any; results: SearchResult[] }> {
  const q = encodeURIComponent(`${query} topic:dsh-plugin`)
  const data = await fetchJson(`${GITHUB_SEARCH}?q=${q}&sort=stars&order=desc&per_page=${Math.min(20, Math.max(limit, 8))}`)
  const items = Array.isArray(data?.items) ? data.items : []
  const results = items.slice(0, limit).map((item: any) => {
    const plugin: MarketPlugin = {
      name: String(item.name || ''), owner: String(item.owner?.login || ''), url: String(item.html_url || ''),
      description: String(item.description || ''), category: 'topic', stars: Number(item.stargazers_count || 0),
    }
    const scope = pluginScope(plugin)
    return {
      name: plugin.name,
      owner: plugin.owner,
      category: 'topic',
      categoryName: 'GitHub dsh-plugin',
      description: zhDescription(plugin),
      stars: Number(plugin.stars || 0),
      url: plugin.url,
      install: `dsh plugin --profile web add github:${String(item.full_name || '')}`,
      source: 'github-topic' as const,
      trust: 'discovered' as const,
      scope: scope.scope,
      scopeReason: scope.reason,
      score: Number(item.stargazers_count || 0) + strategicBoost(plugin, query),
    }
  })
  return { meta: { source: 'github-topic', trust: 'discovered', total: Number(data?.total_count || 0) }, results }
}

export async function searchCommunityPlugins(input: { query: string; staff?: string; category?: string; limit?: number }) {
  const query = String(input.query || '').trim()
  if (!query) throw new Error('plugin market query must not be empty')
  const staff = String(input.staff || '').trim()
  const category = String(input.category || '').trim()
  const limit = Math.max(1, Math.min(10, Number(input.limit || 6)))
  try {
    const curated = await searchCurated(query, staff, category, limit)
    if (curated.results.length) return curated
  } catch {}
  return searchGithubTopic(query, limit)
}

export function registerCommunityMarket(ctx: any) {
  const tools = ctx?.tools
  const systemPrompt = ctx?.systemPrompt
  if (!tools) return

  const marketTool = {
    name: 'staff_plugin_market_search',
    description: '在真实 DSH 社区插件市场中搜索能力。优先 awesome-dsh-plugin curated registry，失败时搜索 GitHub dsh-plugin topic；同时标记可信层级与公司级/员工级插件范围。只发现，不安装。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, description: '想补充的真实能力，如“微信通讯”“图片编辑”“浏览器自动化”。' },
        staff: { type: 'string', description: '提出需求的员工 id 或岗位，用于排序。' },
        category: { type: 'string', description: '可选分类：ui/theme/model/session/memory/tools/skill/workflow/notify/dev/market/fun。' },
        limit: { type: 'number', minimum: 1, maximum: 10 },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args: any, value: any) {
        const rows = Array.isArray(value?.results) ? value.results : []
        const body = rows.length
          ? rows.map((item: any, index: number) => {
            const trust = item.trust === 'curated' ? 'Curated' : 'GitHub 发现（未审核）'
            const scope = item.scope === 'company-infrastructure' ? '公司级基础设施' : '员工能力'
            return `${index + 1}. ${item.name} · ⭐${item.stars || 0} · ${trust} · ${scope}\n${item.description || ''}${item.scopeReason ? `\n建议：${item.scopeReason}` : ''}\n安装：${item.install || '无安装命令'}\n来源：${item.url || ''}`
          }).join('\n\n')
          : '没有找到匹配的社区插件。'
        return [{ type: 'text', text: `[[NIUMA_PLUGIN_MARKET source="${value?.meta?.source || 'unknown'}" trust="${value?.meta?.trust || 'unknown'}"]]\n${body}` }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args: any) {
      return searchCommunityPlugins({ query: args.query, staff: args.staff, category: args.category, limit: args.limit })
    },
  }

  tools.register(marketTool)

  systemPrompt?.section?.({
    name: 'dsh-org-panel:community-market',
    order: -4,
    text: [
      '【赛博公司 · DSH 生态复用制度】',
      '遇到能力缺口时顺序固定：先扫描当前 Runtime 能力 → 再看公司已安装插件 → 再搜社区；不要第一反应就重写或安装新包。',
      '主要来源是 awesome-dsh-plugin curated registry 与 GitHub dsh-plugin topic。Curated 只是更高可信层级，仍不等于安全审计通过；GitHub Topic 结果必须明确标为“发现候选 / 未审核”。',
      '搜索结果会区分 company-infrastructure 与 employee-capability。通讯网关、插件市场等公司级基础设施应优先全公司共享，禁止每个员工重复安装同一个基础设施包。',
      '例如需要微信 / 飞书 / QQ 通讯时，优先复用已经验证过的 @xmanrui/dsh-im；不要让某个员工临时手写一套微信协议。',
      '第三方插件第一次安装必须把插件名、用途、仓库、stars、可信层级、权限/风险和安装命令展示给老板并等待明确批准。禁止静默安装。',
      '批准后才能走当前环境真实可用的 DSH 插件管理/shell 能力。安装后必须做 Tool Registry Diff + Smoke Test，验证成功才允许沉淀成技能。',
      '插件失效、冲突或验证失败也要如实记录，不能为了“升级”虚构学会了不存在的能力。',
    ].join('\n'),
  })
}
