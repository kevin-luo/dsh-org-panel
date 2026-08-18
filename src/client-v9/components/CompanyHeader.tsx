import { createElement as h } from 'react'
import { brandLogo } from '../asset-map'
import { AssetImage } from './AssetImage'

// 顶栏经营指标（需求文档四十八条：状态必须来自真实 Runtime，不许写假 KPI）。
// 「在线」这个词在这里从来就不成立：本插件不持有员工进程，也没有任何心跳，
// 拿不到「谁在线」这种信息。online 实际是「本会话有过真实事件（非待命）的人数」，
// total 是配置名册的人数 —— 所以标签写「活跃 / 在册」，并在 title 里说清两个数各是什么。
export type HeaderStats = {
  /** 配置名册里的人数。名册来自 cordis 配置，不代表这些员工此刻连着运行时。 */
  total: number
  /** 本会话里状态不是「待命」的人数（由真实 Tool Event / 派活记录推导），不是「在线人数」。 */
  online: number
  running: number
  done: number
  wait: number
  since: number | null
}

function uptimeText(since: number | null): string {
  if (!since) return '—'
  const diff = Math.max(0, Date.now() - since)
  const days = Math.floor(diff / 86_400_000)
  if (days >= 1) return `${days} 天`
  const hours = Math.floor(diff / 3_600_000)
  if (hours >= 1) return `${hours} 小时`
  return `${Math.max(1, Math.floor(diff / 60_000))} 分钟`
}

export function CompanyHeader(props: {
  companyName: string
  stats: HeaderStats
  now: Date
  onMarket: () => void
  /** 打开公司设置中心（员工 / 模型 / 插件 / 通讯 / 存储 / 安全）。 */
  onSettings?: () => void
}) {
  const { companyName, stats, now, onMarket, onSettings } = props
  const title = companyName.split('·')[0].trim()
  const subtitle = companyName.includes('·') ? companyName.split('·').slice(1).join('·').trim() : 'AI 员工总部'
  const clock = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return h('header', { className: 'cy9-header' },
    h('div', { className: 'cy9-brand' },
      h(AssetImage, { src: brandLogo(), alt: '赛博公司', fallback: 'CY', loading: 'eager' }),
      h('div', null,
        h('div', { className: 'cy9-brand-kicker' }, 'DSH OFFICE OS'),
        h('div', { className: 'cy9-brand-title' }, title, h('em', null, ` · ${subtitle}`)),
      ),
    ),
    h('div', { className: 'cy9-stats', 'aria-label': '实时经营指标' },
      h('div', { className: 'cy9-stat' }, h('b', null, uptimeText(stats.since)), h('span', null, '运行时长')),
      h('div', {
        className: 'cy9-stat hot',
        title: `活跃 ${stats.online} = 本会话有真实事件（非待命）的员工数；在册 ${stats.total} = 配置名册人数。工作台没有员工心跳，无法显示「在线」。`,
      }, h('b', null, `${stats.online}/${stats.total}`), h('span', null, '活跃/在册')),
      h('div', { className: 'cy9-stat hot' }, h('b', null, String(stats.running)), h('span', null, '工作中')),
      h('div', { className: 'cy9-stat' }, h('b', null, String(stats.done)), h('span', null, '已交付')),
      h('div', { className: 'cy9-stat warn' }, h('b', null, String(stats.wait)), h('span', null, '卡住')),
    ),
    h('div', { className: 'cy9-header-right' },
      h('div', { className: 'cy9-clock' }, h('b', null, clock), h('span', null, '实时经营中')),
      onSettings ? h('button', { type: 'button', className: 'cy9-market-btn', onClick: onSettings, title: '公司设置' }, '公司设置') : null,
      h('button', { type: 'button', className: 'cy9-market-btn', onClick: onMarket }, '插件市场'),
      h('div', { className: 'cy9-boss' },
        h('div', { className: 'cy9-boss-avatar' }, 'B'),
        h('div', { className: 'cy9-boss-name' }, '老板', h('small', null, '公司指挥席')),
      ),
    ),
  )
}
