// DSH 社区插件市场检索：优先使用 awesome-dsh-plugin 的 curated registry，
// 失败时回退 GitHub dsh-plugin topic。只负责发现，不静默安装第三方代码。

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

function scorePlugin(plugin: MarketPlugin, query: string, staff = ''): number {
  const name = compact(plugin.name)
  const description = compact(zhDescription(plugin))
  const category = compact(plugin.category || '')
  const haystack = `${name} ${description} ${category}`
  let score = Math.log10(Math.max(1, Number(plugin.stars || 0)) + 1) * 2
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
      headers: { 'accept': 'application/json', 'user-agent': 'dsh-org-panel/1.1 community-market' },
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
    .map(({ plugin, score }) => ({
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
      score: Math.round(score * 100) / 100,
    }))
  return { meta: { source: 'awesome-dsh-plugin', updated: registry.updated || null, total: registry.count || registry.plugins?.length || 0 }, results }
}

async function searchGithubTopic(query: string, limit: number): Promise<{ meta: any; results: SearchResult[] }> {
  const q = encodeURIComponent(`${query} topic:dsh-plugin`)
  const data = await fetchJson(`${GITHUB_SEARCH}?q=${q}&sort=stars&order=desc&per_page=${Math.min(20, Math.max(limit, 8))}`)
  const items = Array.isArray(data?.items) ? data.items : []
  const results = items.slice(0, limit).map((item: any) => ({
    name: String(item.name || ''),
    owner: String(item.owner?.login || ''),
    category: 'topic',
    categoryName: 'GitHub dsh-plugin',
    description: String(item.description || ''),
    stars: Number(item.stargazers_count || 0),
    url: String(item.html_url || ''),
    install: `dsh plugin --profile web add github:${String(item.full_name || '')}`,
    source: 'github-topic' as const,
    score: Number(item.stargazers_count || 0),
  }))
  return { meta: { source: 'github-topic', total: Number(data?.total_count || 0) }, results }
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
    description: '在真实 DSH 社区插件市场中搜索员工需要的新能力。优先读取 awesome-dsh-plugin curated registry，失败时搜索 GitHub dsh-plugin topic。只发现插件，不安装。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, description: '想补充的真实能力，如“图片编辑”“视频生成”“公众号”“长期记忆”“浏览器自动化”。' },
        staff: { type: 'string', description: '提出学习需求的员工 id 或岗位，用于排序。' },
        category: { type: 'string', description: '可选分类：ui/theme/model/session/memory/tools/skill/workflow/notify/dev/market/fun。' },
        limit: { type: 'number', minimum: 1, maximum: 10 },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args: any, value: any) {
        const rows = Array.isArray(value?.results) ? value.results : []
        const body = rows.length
          ? rows.map((item: any, index: number) => `${index + 1}. ${item.name} · ⭐${item.stars || 0}\n${item.description || ''}\n安装：${item.install || '无安装命令'}\n来源：${item.url || ''}`).join('\n\n')
          : '没有找到匹配的社区插件。'
        return [{ type: 'text', text: `[[NIUMA_PLUGIN_MARKET source="${value?.meta?.source || 'unknown'}"]]\n${body}` }]
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
      '【赛博公司 · 社区插件学习制度】',
      '当员工发现当前工具无法可靠完成任务时，先检查已有能力；仍有缺口时调用 staff_plugin_market_search 从真实 DSH 社区生态寻找插件。',
      '主要来源是 awesome-dsh-plugin curated registry 与 GitHub dsh-plugin topic。搜索结果只是候选，不代表安全审计通过。',
      '第三方插件第一次安装必须先把插件名、用途、仓库、stars、权限/风险和安装命令展示给老板，并等待老板明确批准。禁止静默安装。',
      '老板批准后才能通过当前环境真实可用的 shell/DSH 插件管理能力执行安装。安装完成后必须扫描 Tool Registry 验证能力真的出现并做最小测试；验证成功后再用 staff_skill_learn 记录为员工技能。',
      '插件失效、冲突或验证失败也要记入复盘，不能为了“升级”虚构学会了不存在的能力。',
    ].join('\n'),
  })
}
