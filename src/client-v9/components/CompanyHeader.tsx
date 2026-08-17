// 「赛博公司」client-v9 顶栏：品牌 + 真实经营指标 + 插件市场 + 老板。
// 指标全部来自真实会话数据，无数据时显示「—」，禁止写死视觉稿数字。
import { createElement as h } from 'react'
import { assetUrl, UI_ASSETS } from '../asset-map'

export type HeaderStats = {
  total: number
  online: number
  running: number
  done: number
  wait: number
  since: number | null
}

function uptimeText(since: number | null): string {
  if (!since) return '—'
  const days = Math.floor((Date.now() - since) / 86_400_000)
  if (days >= 1) return `${days} 天`
  const hours = Math.floor((Date.now() - since) / 3_600_000)
  if (hours >= 1) return `${hours} 小时`
  return `${Math.max(1, Math.floor((Date.now() - since) / 60_000))} 分钟`
}

export function CompanyHeader(props: {
  companyName: string
  stats: HeaderStats
  now: Date
  onMarket: () => void
}) {
  const { companyName, stats, now, onMarket } = props
  let clock = ''
  let date = ''
  try {
    clock = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    date = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
  } catch { /* 忽略时间格式化异常 */ }

  return h('header', { className: 'cy9-header' },
    h('div', { className: 'cy9-brand' },
      h('img', { src: assetUrl(UI_ASSETS.logoHex), alt: 'logo' }),
      h('div', null,
        h('div', { className: 'cy9-brand-kicker' }, 'AI OPERATIONS PLATFORM'),
        h('div', { className: 'cy9-brand-title' }, companyName.split('·')[0].trim(), h('em', null, companyName.includes('·') ? ` · ${companyName.split('·').slice(1).join('·').trim()}` : '')),
      ),
    ),
    h('div', { className: 'cy9-stats' },
      h('div', { className: 'cy9-stat' }, h('b', null, h('i', null, uptimeText(stats.since))), h('span', null, '公司运行时长')),
      h('div', { className: 'cy9-stat hot' }, h('b', null, h('i', null, `${stats.online}`), ` / ${stats.total}`), h('span', null, '在线员工')),
      h('div', { className: 'cy9-stat hot' }, h('b', null, h('i', null, String(stats.running))), h('span', null, '正在干活')),
      h('div', { className: 'cy9-stat' }, h('b', null, h('i', null, String(stats.done))), h('span', null, '已交付')),
      h('div', { className: 'cy9-stat warn' }, h('b', null, h('i', null, String(stats.wait))), h('span', null, '等待处理')),
    ),
    h('div', { className: 'cy9-header-right' },
      h('div', { className: 'cy9-clock' }, h('b', null, clock), h('span', null, date)),
      h('button', { type: 'button', className: 'cy9-market-btn', onClick: onMarket },
        '插件市场', h('span', { className: 'new' }, 'NEW'),
      ),
      h('div', { className: 'cy9-boss' },
        h('div', { className: 'cy9-boss-avatar' }, '朕'),
        h('div', { className: 'cy9-boss-name' }, '老板', h('small', null, '全权指挥')),
      ),
    ),
  )
}
