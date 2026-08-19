import { createElement as h } from 'react'
import type { RuntimeSkill } from '../../runtime/company-events'

const STYLE_ID = 'dsh-org-panel-skill-growth-burst'
const CSS = String.raw`
@keyframes cy9-skill-growth-in{0%{opacity:0;transform:translateY(5px) scale(.8)}15%{opacity:1;transform:translateY(-3px) scale(1.08)}72%{opacity:1;transform:translateY(-8px) scale(1)}100%{opacity:0;transform:translateY(-15px) scale(.96)}}
@keyframes cy9-skill-growth-ring{0%{opacity:.9;transform:scale(.45)}75%,100%{opacity:0;transform:scale(1.55)}}
.cy9-skill-growth-burst{position:absolute;right:-36px;top:-18px;z-index:7;min-width:62px;padding:3px 7px;border:1px solid rgba(126,255,170,.72);border-radius:999px;background:rgba(8,39,26,.96);box-shadow:0 0 16px rgba(77,226,161,.2);color:#c9ffd8;font:800 8px/13px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;pointer-events:none;animation:cy9-skill-growth-in 2.8s ease-out both}
.cy9-skill-growth-burst:before{content:"";position:absolute;inset:-4px;border:1px solid rgba(126,255,170,.46);border-radius:999px;animation:cy9-skill-growth-ring 1.4s ease-out both}
.cy9-skill-growth-burst small{display:block;color:#78dda0;font:500 7px/9px Inter,"PingFang SC",sans-serif;max-width:86px;overflow:hidden;text-overflow:ellipsis}
@media(prefers-reduced-motion:reduce){.cy9-skill-growth-burst{animation:none;opacity:1}.cy9-skill-growth-burst:before{display:none}}
`

function installStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

export function SkillGrowthBurst(props: { skill: RuntimeSkill }) {
  installStyles()
  const { skill } = props
  return h('span', {
    // key 由父组件以事件时间控制；新的真实 skill.updated 会重新播放，tick 不会。
    className: 'cy9-skill-growth-burst',
    title: `技能证据更新：${skill.name}${skill.level ? ` Lv.${skill.level}` : ''}`,
  },
    skill.level ? `技能 Lv.${skill.level}` : '技能更新',
    h('small', null, skill.name),
  )
}
