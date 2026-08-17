// 资产根路径解析：DSH 客户端 bundle 通过 __ModuleLoader__ fetch + eval 加载，
// 页面上不一定存在 <script src>，因此需要多策略探测并在运行时用图片校验。
let assetBase = ''
let probing = false
const listeners = new Set<() => void>()

export function getAssetBase() {
  return assetBase
}

export function onAssetBaseChange(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function setAssetBase(base: string) {
  const normalized = base.endsWith('/') ? base : `${base}/`
  if (normalized === assetBase) return
  assetBase = normalized
  listeners.forEach((fn) => { try { fn() } catch { /* noop */ } })
}

function dirOf(url: string): string {
  return url.replace(/[?#].*$/, '').replace(/\/[^/]*$/, '/')
}

function looksLikeBundleUrl(url: string): boolean {
  return /dsh-org-panel/i.test(url) && /\.(js|mjs|cjs)([?#]|$)/i.test(url)
}

function baseFromScriptTags(): string {
  const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[]
  for (let i = scripts.length - 1; i >= 0; i--) {
    const src = scripts[i].src
    if (src && looksLikeBundleUrl(src)) return dirOf(src)
  }
  return ''
}

function baseFromPerformance(): string {
  if (typeof performance === 'undefined' || !performance.getEntriesByType) return ''
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  // 先找明确带插件名的脚本资源；找不到再退化为任意含 client.js 的资源。
  let fallback = ''
  for (let i = entries.length - 1; i >= 0; i--) {
    const url = entries[i].name
    if (!url) continue
    if (looksLikeBundleUrl(url)) return dirOf(url)
    if (!fallback && /(^|\/)client\.js([?#]|$)/i.test(url)) fallback = dirOf(url)
  }
  return fallback
}

function baseFromModuleLoader(): string {
  // 防御性扫描 __ModuleLoader__ 上可能保存的模块 URL 注册表。
  try {
    const loader = (globalThis as any).__ModuleLoader__
    if (!loader || typeof loader !== 'object') return ''
    const seen: string[] = []
    const visit = (value: any, depth: number) => {
      if (!value || depth > 3 || seen.length > 200) return
      if (typeof value === 'string') {
        if (/^https?:|^\/|^\.\.?\//.test(value)) seen.push(value)
        return
      }
      if (typeof value !== 'object') return
      for (const key of Object.keys(value)) {
        if (seen.length > 200) return
        visit((value as any)[key], depth + 1)
      }
    }
    visit(loader, 0)
    for (let i = seen.length - 1; i >= 0; i--) {
      if (looksLikeBundleUrl(seen[i])) return dirOf(seen[i])
    }
    for (let i = seen.length - 1; i >= 0; i--) {
      if (/(^|\/)client\.js([?#]|$)/i.test(seen[i])) return dirOf(seen[i])
    }
  } catch { /* noop */ }
  return ''
}

// 返回 true 表示已同步解析出一个候选 base（不保证可用，需 probe 校验）。
export function detectAssetBase(): boolean {
  if (assetBase) return true
  if (typeof document === 'undefined') return false
  const found = baseFromScriptTags() || baseFromPerformance() || baseFromModuleLoader()
  if (found) setAssetBase(found)
  return Boolean(found)
}

function loadProbe(url: string, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const img = new Image()
      const timer = setTimeout(() => resolve(false), timeoutMs)
      img.onload = () => { clearTimeout(timer); resolve(true) }
      img.onerror = () => { clearTimeout(timer); resolve(false) }
      img.src = url
    } catch {
      resolve(false)
    }
  })
}

// 用一张小图逐个校验候选 base，命中即切换；全部失败则保持现状。
export async function probeAssetBase(extraCandidates?: string[]): Promise<string | null> {
  if (probing) return assetBase || null
  probing = true
  try {
    const probePath = 'assets/ui/logo-hex.png'
    const candidates: string[] = []
    const push = (base: string) => {
      if (base && !candidates.includes(base)) candidates.push(base)
    }
    push(assetBase)
    ;(extraCandidates || []).forEach(push)
    if (typeof location !== 'undefined') {
      push(`${location.origin}/plugins/dsh-org-panel/lib/`)
      push(`${location.origin}/plugin/dsh-org-panel/lib/`)
      push(`${location.origin}/dsh-org-panel/lib/`)
      push('./plugins/dsh-org-panel/lib/')
    }
    for (const base of candidates) {
      const ok = await loadProbe(`${base}${probePath}`)
      if (ok) {
        setAssetBase(base)
        return assetBase
      }
    }
    if (candidates.length) {
      // 全部候选都拉不到资产：提示通过 config.assetBase 手动指定。
      console.warn('[dsh-org-panel] 未找到可用的资产根路径，办公室图片将无法显示。可在插件 config 中指定 assetBase（见 cordis.example.yml）。已尝试:', candidates.join(' | '))
    }
    return assetBase || null
  } finally {
    probing = false
  }
}

export function assetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '')
  return `${assetBase}assets/${clean}`
}

export const OFFICE_ASSETS = {
  deskDual: 'office/desk-dual.png',
  deskSingle: 'office/desk-single.png',
  reception: 'office/reception.png',
  meetingTable: 'office/meeting-table.png',
  sofaSet: 'office/sofa-set.png',
  coffeeTable: 'office/coffee-table.png',
  officeChair: 'office/office-chair.png',
  bookshelf: 'office/bookshelf.png',
  windowCity: 'office/window-city.png',
  glassWall: 'office/glass-wall.png',
  glassDoor: 'office/glass-door.png',
  serverRack: 'office/server-rack.png',
  vendingMachine: 'office/vending-machine.png',
  coffeeMachine: 'office/coffee-machine.png',
  dashboardScreen: 'office/dashboard-screen.png',
  plantLarge: 'office/plant-large.png',
  plantMedium: 'office/plant-medium.png',
  plantSmall: 'office/plant-small.png',
  floorDark: 'office/floor-dark.png',
  floorWood: 'office/floor-wood.png',
  floorCarpet: 'office/floor-carpet.png',
  neonLogo: 'office/neon-logo.png',
  signRd: 'office/sign-rd.png',
  signProduct: 'office/sign-product.png',
  signMeeting: 'office/sign-meeting.png',
  signContent: 'office/sign-content.png',
  signMedia: 'office/sign-media.png',
  signData: 'office/sign-data.png',
  signGrowth: 'office/sign-growth.png',
  signBreakroom: 'office/sign-breakroom.png',
  signReception: 'office/sign-reception.png',
} as const

export const UI_ASSETS = {
  logoFull: 'ui/logo-full.png',
  logoHex: 'ui/logo-hex.png',
} as const

export const STAFF_PORTRAIT: Record<string, string> = {
  secretary: 'staff/community.png',
  'tech-lead': 'staff/tech-lead.png',
  recruiter: 'staff/recruiter.png',
  developer: 'staff/developer.png',
  pm: 'staff/pm.png',
  platform: 'staff/platform.png',
  researcher: 'staff/researcher.png',
  doc: 'staff/doc.png',
  'search-specialist': 'staff/search-specialist.png',
  'image-creator': 'staff/image-creator.png',
  'video-producer': 'staff/video-producer.png',
  novelist: 'staff/novelist.png',
  'social-editor': 'staff/social-editor.png',
  'data-analyst': 'staff/data-analyst.png',
  growth: 'staff/growth.png',
}

export function staffPortrait(staffId: string): string {
  return assetUrl(STAFF_PORTRAIT[staffId] || 'staff/developer.png')
}

export function staffSprite(staffId: string): string {
  return staffPortrait(staffId)
}

export function officeAsset(key: keyof typeof OFFICE_ASSETS): string {
  return assetUrl(OFFICE_ASSETS[key])
}
