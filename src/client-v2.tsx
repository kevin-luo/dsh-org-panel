// 「赛博公司」DSH 插件 —— client 半边 v2
// 设计原则：真实员工代理 + 可交互办公室 + 单一原生会话 + 可配置组织架构。
import { createElement, useEffect, useMemo, useRef, useState } from 'react'

const CSS = `
.dsh-org { height: 100%; overflow-y: auto; box-sizing: border-box; padding: 16px 20px 30px; color: var(--dsw-alias-label-primary); font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.dsh-org-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.dsh-org-title { font-size: 16px; font-weight: 700; }
.dsh-org-sub { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.dsh-org-stats { font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dsh-org-boss { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 14px; }
.dsh-org-boss-emoji { width: 34px; height: 34px; border-radius: 9px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); display: flex; align-items: center; justify-content: center; font-size: 18px; flex: none; }
.dsh-org-boss-bubble { padding: 9px 13px; border-radius: 12px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-left: 3px solid var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; max-width: 94%; }
.dsh-org-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.dsh-org-filters { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dsh-org-filter { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 24px; padding: 0 10px; border-radius: 999px; cursor: pointer; transition: all .12s ease; }
.dsh-org-filter:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-brand-primary); }
.dsh-org-filter.active { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); font-weight: 650; }
.dsh-org-search { display: flex; align-items: center; gap: 6px; margin-left: auto; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 999px; padding: 0 10px; height: 26px; }
.dsh-org-search input { border: none; outline: none; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12px; width: 170px; }
.dsh-org-focus { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-org-focus button { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 999px; padding: 2px 10px; font-size: 12px; cursor: pointer; }
.dsh-org-body { display: flex; gap: 16px; align-items: flex-start; }
.dsh-org-main { flex: 1; min-width: 0; }
.dsh-org-side { width: 300px; flex: none; position: sticky; top: 0; }
.dsh-org-section-title { font-size: 12px; font-weight: 700; color: var(--dsw-alias-label-secondary); margin-bottom: 10px; letter-spacing: .02em; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dsh-org-section-title span { font-weight: 400; }
.dsh-org-empty { text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 14px; border: 1px dashed var(--dsw-alias-border-l1); border-radius: 10px; margin-bottom: 12px; }
.dsh-org-staff { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
.dsh-org-staff-card { position: relative; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; padding: 13px 12px 11px; background: var(--dsw-alias-bg-layer-1); cursor: pointer; transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease; display: flex; flex-direction: column; gap: 9px; }
.dsh-org-staff-card:hover { transform: translateY(-3px); box-shadow: 0 8px 22px rgba(0,0,0,0.12); }
.dsh-org-staff-card.running { border-color: var(--dsw-alias-brand-primary); }
.dsh-org-staff-card.done { border-color: var(--dsw-alias-state-success-primary); }
.dsh-org-staff-card.error { border-color: var(--dsw-alias-state-error-primary); }
.dsh-org-staff-card.dimmed { opacity: .48; }
.dsh-org-staff-top { display: flex; align-items: center; gap: 10px; }
.dsh-org-staff-emoji { width: 42px; height: 42px; border-radius: 12px; background: var(--dsw-alias-bg-layer-2); display: flex; align-items: center; justify-content: center; font-size: 24px; flex: none; }
.dsh-org-staff-id { flex: 1; min-width: 0; }
.dsh-org-staff-name { font-size: 14px; font-weight: 700; }
.dsh-org-staff-role { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-org-chip { font-size: 11px; padding: 0 7px; border-radius: 999px; border: 1px solid currentColor; line-height: 18px; flex: none; }
.dsh-org-staff-bubble { font-size: 12px; line-height: 1.5; padding: 7px 10px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); word-break: break-word; }
.dsh-org-staff-hint { font-size: 10px; color: var(--dsw-alias-label-secondary); text-align: center; opacity: .85; }
.dsh-org-task { border-top: 1px dashed var(--dsw-alias-border-l1); padding-top: 8px; }
.dsh-org-task-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.dsh-org-task-desc { font-size: 12px; font-weight: 600; line-height: 1.4; flex: 1; min-width: 0; word-break: break-word; }
.dsh-org-task-lead { font-size: 11px; color: var(--dsw-alias-label-primary); line-height: 1.5; margin-top: 6px; background: var(--dsw-alias-bg-layer-2); padding: 6px 8px; border-radius: 8px; word-break: break-word; }
.dsh-org-task-points { margin-top: 4px; }
.dsh-org-task-point { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.dsh-org-task-meta { font-size: 10px; color: var(--dsw-alias-label-secondary); margin-top: 5px; opacity: .85; }
.dsh-org-task-toggle { margin-top: 6px; border: none; background: transparent; color: var(--dsw-alias-brand-primary); font-size: 11px; padding: 0; cursor: pointer; }
.dsh-org-progress { height: 4px; border-radius: 2px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; margin-top: 6px; }
.dsh-org-progress-bar { height: 100%; width: 40%; border-radius: 2px; background: var(--dsw-alias-brand-primary); animation: dsh-org-progress 1.2s ease-in-out infinite; }
@keyframes dsh-org-progress { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
.dsh-org-chat-panel { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; background: var(--dsw-alias-bg-layer-1); height: 520px; max-height: 520px; }
.dsh-org-chat-head { padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); text-align: center; }
.dsh-org-chat-title { font-weight: 700; font-size: 13px; color: var(--dsw-alias-label-primary); }
.dsh-org-chat-notice { display: block; font-weight: 400; font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.dsh-org-chat-body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-base); min-height: 0; }
.dsh-org-sys { align-self: center; font-size: 11px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); padding: 2px 9px; border-radius: 999px; max-width: 92%; text-align: center; }
.dsh-org-chat-msg { display: flex; align-items: flex-end; gap: 6px; }
.dsh-org-chat-msg.me { flex-direction: row-reverse; }
.dsh-org-chat-avatar { width: 28px; height: 28px; border-radius: 7px; display: flex; align-items: center; justify-content: center; font-size: 16px; background: var(--dsw-alias-bg-layer-2); flex: none; }
.dsh-org-chat-wrap { max-width: 74%; display: flex; flex-direction: column; }
.dsh-org-chat-msg.me .dsh-org-chat-wrap { align-items: flex-end; }
.dsh-org-chat-name { font-size: 10px; color: var(--dsw-alias-label-secondary); margin: 0 4px 2px; }
.dsh-org-chat-bubble { padding: 6px 10px; border-radius: 10px; font-size: 12px; line-height: 1.5; word-break: break-word; }
.dsh-org-chat-msg.me .dsh-org-chat-bubble { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); border-bottom-right-radius: 2px; }
.dsh-org-chat-msg.them .dsh-org-chat-bubble { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-bottom-left-radius: 2px; }
.dsh-org-chat-quick { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 10px 0; }
.dsh-org-chat-quick button { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 11px; padding: 3px 9px; border-radius: 999px; cursor: pointer; }
.dsh-org-chat-quick button:hover { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dsh-org-chat-input { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dsh-org-chat-input input { flex: 1; min-width: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 12px; padding: 6px 12px; outline: none; }
.dsh-org-chat-input input:focus { border-color: var(--dsw-alias-brand-primary); }
.dsh-org-chat-input button { border: none; border-radius: 999px; background: var(--dsw-alias-brand-primary); color: #fff; font-size: 12px; padding: 6px 14px; cursor: pointer; }
.dsh-org-chat-input button:disabled { opacity: .5; cursor: default; }
.dsh-org-modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 1100; display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.dsh-org-modal { width: 420px; max-width: 92vw; max-height: 82vh; overflow-y: auto; border-radius: 16px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); box-shadow: 0 20px 60px rgba(0,0,0,0.28); }
.dsh-org-modal-head { display: flex; align-items: center; gap: 12px; padding: 16px 16px 12px; }
.dsh-org-modal-emoji { width: 56px; height: 56px; border-radius: 16px; background: var(--dsw-alias-bg-layer-1); display: flex; align-items: center; justify-content: center; font-size: 32px; flex: none; }
.dsh-org-modal-id { flex: 1; min-width: 0; }
.dsh-org-modal-name { font-size: 16px; font-weight: 700; }
.dsh-org-modal-role { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.dsh-org-modal-close { margin-left: auto; cursor: pointer; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 18px; padding: 4px 8px; border-radius: 6px; }
.dsh-org-modal-close:hover { background: var(--dsw-alias-bg-layer-1); }
.dsh-org-modal-body { padding: 0 16px 16px; }
.dsh-org-modal-intro { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); margin-bottom: 12px; }
.dsh-org-modal-label { font-size: 11px; font-weight: 700; color: var(--dsw-alias-label-secondary); margin: 10px 0 6px; }
.dsh-org-modal-tools { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-org-tool { font-size: 11px; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; padding: 2px 8px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }
.dsh-org-skill-row { font-size: 12px; padding: 6px 0; border-bottom: 1px dashed var(--dsw-alias-border-l1); }
.dsh-org-skill-row:last-child { border-bottom: none; }
.dsh-org-skill-name { font-weight: 600; }
.dsh-org-skill-desc { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.45; margin-top: 2px; }
.dsh-org-note { font-size: 12px; color: var(--dsw-alias-label-secondary); padding: 8px 0; }
.dsh-org-focus-action { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-brand-primary); border-radius: 8px; padding: 5px 10px; font-size: 12px; cursor: pointer; margin-left: 8px; }
@media (max-width: 980px) {
  .dsh-org-body { flex-direction: column; }
  .dsh-org-side { width: 100%; position: static; }
  .dsh-org-search { margin-left: 0; width: 100%; }
  .dsh-org-search input { width: 100%; }
}
`

const MODERN_CSS = `
.dsh-org {
  --org-bg: #15131a;
  --org-panel: #211d29;
  --org-panel-raised: #2a2535;
  --org-panel-soft: #332d3e;
  --org-ink: #f8edcf;
  --org-muted: #b5aa98;
  --org-dim: #756d7d;
  --org-line: #514254;
  --org-pink: #d64d78;
  --org-yellow: #f4ce5a;
  --org-blue: #7acbe5;
  --org-green: #73d39d;
  --org-red: #ef7776;
  --org-orange: #e9a35c;
  --org-motion-fast: 120ms;
  --org-motion-base: 200ms;
  --org-motion-walk: 2800ms;
  --org-ease-out: cubic-bezier(.22, 1, .36, 1);
  --org-ease-walk: cubic-bezier(.65, 0, .35, 1);
  width: 100%;
  height: calc(100dvh - 196px);
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
  padding: clamp(10px, 1.2vw, 18px) clamp(10px, 1.4vw, 22px) 14px;
  background: radial-gradient(circle at 72% 4%, rgba(214, 77, 120, .09), transparent 28%), var(--org-bg);
  color: var(--org-ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  line-height: 1.45;
}
.dsh-org *, .dsh-org *::before, .dsh-org *::after { box-sizing: border-box; }
.dsh-org-shell { width: 100%; max-width: none; height: 100%; margin: 0; display: flex; flex-direction: column; min-height: 0; container-type: inline-size; }
.dsh-org-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 10px; flex: none; }
.dsh-org-brand { display: flex; align-items: center; gap: 11px; min-width: 0; }
.dsh-org-mark { width: 38px; height: 38px; display: grid; place-items: center; flex: none; border: 2px solid var(--org-pink); background: var(--org-panel-raised); color: var(--org-yellow); box-shadow: 4px 4px 0 #09080c; font-size: 20px; }
.dsh-org-kicker { color: var(--org-yellow); font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.dsh-org-title { margin-top: 1px; font-size: clamp(18px, 2vw, 24px); font-weight: 800; letter-spacing: -.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-org-sub { color: var(--org-muted); font-size: 12px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-org-head-right { display: flex; align-items: center; gap: 12px; flex: none; }
.dsh-org-live { display: inline-flex; align-items: center; gap: 7px; color: var(--org-green); font-size: 11px; font-weight: 700; }
.dsh-org-live-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 16%, transparent); }
.dsh-org-stats { display: flex; align-items: stretch; border: 1px solid var(--org-line); background: rgba(33, 29, 41, .82); }
.dsh-org-stat { min-width: 70px; padding: 6px 10px; border-left: 1px solid var(--org-line); text-align: center; }
.dsh-org-stat:first-child { border-left: 0; }
.dsh-org-stat-num { display: block; color: var(--org-ink); font-size: 14px; font-weight: 800; }
.dsh-org-stat-label { display: block; color: var(--org-muted); font-size: 10px; }
.dsh-org-brief { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 7px 10px; margin-bottom: 8px; border: 1px solid var(--org-line); border-left: 3px solid var(--org-yellow); background: linear-gradient(90deg, rgba(244, 206, 90, .07), transparent 52%), var(--org-panel); flex: none; }
.dsh-org-brief-mark { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--org-line); background: var(--org-panel-raised); color: var(--org-yellow); font-size: 16px; }
.dsh-org-brief-copy { min-width: 0; }
.dsh-org-brief-label { color: var(--org-yellow); font-size: 10px; font-weight: 800; letter-spacing: .12em; }
.dsh-org-brief-text { margin-top: 2px; color: var(--org-ink); font-size: 12px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-org-brief-tail { color: var(--org-muted); font-size: 11px; white-space: nowrap; }
.dsh-org-orgchart { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 18px; align-items: center; margin-bottom: 8px; padding: 6px 10px; border-block: 1px solid var(--org-line); background: #19161f; flex: none; }
.dsh-org-orgchart-boss { position: relative; display: grid; gap: 2px; padding: 8px 10px; border: 1px solid var(--org-pink); background: rgba(214, 77, 120, .11); }
.dsh-org-orgchart-boss::after { content: ''; position: absolute; left: 100%; top: 50%; width: 19px; border-top: 1px solid var(--org-pink); }
.dsh-org-orgchart-boss strong { color: var(--org-ink); font-size: 12px; }
.dsh-org-orgchart-boss span { color: var(--org-muted); font-size: 9px; }
.dsh-org-orgchart-units { display: grid; grid-template-columns: repeat(5, minmax(105px, 1fr)); gap: 7px; }
.dsh-org-orgchart-unit { min-width: 0; padding: 7px 8px; border: 1px solid var(--org-line); background: var(--org-panel); }
.dsh-org-orgchart-unit strong { display: block; color: var(--org-yellow); font-size: 9px; }
.dsh-org-orgchart-unit span { display: block; overflow: hidden; margin-top: 2px; color: var(--org-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.dsh-org-workbench { position: relative; display: grid; grid-template-columns: clamp(230px, 15vw, 300px) minmax(0, 1fr); gap: 12px; align-items: stretch; flex: 1; min-height: 0; }
.dsh-org-panel { min-width: 0; border: 1px solid var(--org-line); background: var(--org-panel); box-shadow: 0 14px 32px rgba(0, 0, 0, .18); }
.dsh-org-panel-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 48px; padding: 10px 12px; border-bottom: 1px solid var(--org-line); }
.dsh-org-panel-title { color: var(--org-ink); font-size: 13px; font-weight: 800; }
.dsh-org-panel-caption { color: var(--org-muted); font-size: 10px; white-space: nowrap; }
.dsh-org-roster { position: static; overflow: hidden; height: 100%; min-height: 0; display: flex; flex-direction: column; }
.dsh-org-roster-tools { padding: 10px; border-bottom: 1px solid var(--org-line); }
.dsh-org-search { display: flex; align-items: center; gap: 7px; min-height: 32px; padding: 0 9px; border: 1px solid var(--org-line); background: var(--org-bg); }
.dsh-org-search-icon { color: var(--org-yellow); font-size: 14px; line-height: 1; }
.dsh-org-search input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--org-ink); font-size: 12px; }
.dsh-org-search input::placeholder { color: var(--org-dim); }
.dsh-org-filter-strip { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
.dsh-org-filter { border: 1px solid var(--org-line); background: transparent; color: var(--org-muted); padding: 4px 7px; font-size: 10px; cursor: pointer; transition: color .18s ease, border-color .18s ease, background-color .18s ease; }
.dsh-org-filter:hover, .dsh-org-filter.active { border-color: var(--org-pink); background: rgba(214, 77, 120, .12); color: var(--org-ink); }
.dsh-org-filter.active { color: var(--org-yellow); }
.dsh-org-roster-list { display: grid; gap: 1px; padding: 6px; max-height: none; overflow-y: auto; flex: 1; min-height: 0; align-content: start; }
.dsh-org-roster-department { display: grid; gap: 1px; padding: 4px 0 6px; }
.dsh-org-roster-department + .dsh-org-roster-department { border-top: 1px dashed var(--org-line); }
.dsh-org-roster-department-title { display: flex; align-items: center; justify-content: space-between; min-height: 26px; padding: 3px 7px; color: var(--org-yellow); font-size: 9px; font-weight: 800; letter-spacing: .06em; }
.dsh-org-roster-department-title span { color: var(--org-dim); font-weight: 500; letter-spacing: 0; }
.dsh-org-roster-row { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 9px; width: 100%; padding: 9px 7px; border: 1px solid transparent; background: transparent; color: var(--org-ink); text-align: left; cursor: pointer; transition: background-color .18s ease, border-color .18s ease, transform .18s ease; }
.dsh-org-roster-row:hover { border-color: var(--org-line); background: var(--org-panel-raised); transform: translateX(2px); }
.dsh-org-roster-row.active { border-color: var(--org-pink); background: rgba(214, 77, 120, .13); }
.dsh-org-roster-avatar { position: relative; width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid var(--org-line); background: var(--org-panel-raised); font-size: 18px; }
.dsh-org-roster-avatar.running { border-color: var(--org-blue); }
.dsh-org-roster-avatar.done { border-color: var(--org-green); }
.dsh-org-roster-avatar.wait { border-color: var(--org-red); }
.dsh-org-roster-avatar.idle { border-color: var(--org-line); }
.dsh-org-status-dot { position: absolute; right: -3px; bottom: -3px; width: 9px; height: 9px; border: 2px solid var(--org-panel); border-radius: 50%; background: var(--org-dim); }
.dsh-org-status-dot.running { background: var(--org-blue); }
.dsh-org-status-dot.done { background: var(--org-green); }
.dsh-org-status-dot.wait { background: var(--org-red); }
.dsh-org-roster-copy { min-width: 0; }
.dsh-org-roster-name { overflow: hidden; color: var(--org-ink); font-size: 12px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.dsh-org-roster-role { overflow: hidden; margin-top: 1px; color: var(--org-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.dsh-org-roster-report { color: var(--org-dim); font-size: 9px; }
.dsh-org-roster-task { overflow: hidden; margin-top: 2px; color: var(--org-dim); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.dsh-org-roster-state { max-width: 50px; color: var(--org-muted); font-size: 9px; line-height: 1.25; text-align: right; }
.dsh-org-roster-row.running .dsh-org-roster-state { color: var(--org-blue); }
.dsh-org-roster-row.done .dsh-org-roster-state { color: var(--org-green); }
.dsh-org-roster-row.wait .dsh-org-roster-state { color: var(--org-red); }
.dsh-org-roster-footer { padding: 9px 11px; border-top: 1px solid var(--org-line); color: var(--org-dim); font-size: 10px; }
.dsh-org-roster-footer-actions { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dsh-org-roster-footer-actions span { min-width: 0; margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-org-roster-footer-actions button { min-height: 28px; padding: 4px 7px; border: 1px solid var(--org-line); background: transparent; color: var(--org-muted); font-size: 9px; cursor: pointer; }
.dsh-org-roster-footer-actions button:hover { border-color: var(--org-pink); color: var(--org-ink); }
.dsh-org-roster-footer-actions button:last-child { border-color: var(--org-pink); background: rgba(214, 77, 120, .12); color: var(--org-yellow); }
.dsh-org-clear-focus { margin-left: 5px; border: 0; background: transparent; color: var(--org-yellow); font-size: 10px; cursor: pointer; }
.dsh-org-roster-empty { padding: 18px 10px; color: var(--org-muted); font-size: 11px; text-align: center; }
.dsh-org-center { display: grid; grid-template-columns: minmax(0, 1fr) clamp(280px, 24vw, 440px); gap: 12px; min-width: 0; min-height: 0; }
.dsh-org-center > .dsh-org-flow { order: 1; }
.dsh-org-center > .dsh-org-office-shell { order: 2; }
.dsh-org-office-shell { min-width: 0; min-height: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; container-type: size; border: 2px solid var(--org-pink); background: #1c1823; box-shadow: 6px 6px 0 rgba(214, 77, 120, .28), 0 16px 34px rgba(0, 0, 0, .22); }
.dsh-org-office-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 12px; border-bottom: 1px solid var(--org-pink); background: #282133; }
.dsh-org-office-heading { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.dsh-org-office-title { overflow: hidden; color: var(--org-yellow); font-size: 13px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.dsh-org-office-caption { color: #cbb8a1; font-size: 10px; white-space: nowrap; }
.dsh-org-office-legend { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
.dsh-org-legend { display: inline-flex; align-items: center; gap: 4px; color: #d4c7b1; font-size: 9px; white-space: nowrap; }
.dsh-org-legend-dot { width: 7px; height: 7px; border: 1px solid rgba(0, 0, 0, .35); background: var(--org-dim); }
.dsh-org-legend-dot.running { background: var(--org-blue); }
.dsh-org-legend-dot.done { background: var(--org-green); }
.dsh-org-legend-dot.wait { background: var(--org-red); }
.dsh-org-office-canvas { position: relative; container-type: size; flex: 1; min-height: 0; height: auto; overflow: hidden; isolation: isolate; background-color: #f4dfad; background-image: linear-gradient(rgba(255, 255, 255, .2) 1px, transparent 1px), linear-gradient(90deg, rgba(119, 79, 54, .12) 1px, transparent 1px); background-size: 28px 28px; image-rendering: pixelated; }
.dsh-org-office-wall { position: absolute; z-index: -3; inset: 0 0 66%; background-color: #a9634d; background-image: linear-gradient(#c57c5c 2px, transparent 2px), linear-gradient(90deg, rgba(72, 42, 40, .52) 2px, transparent 2px); background-size: 40px 15px, 80px 15px; background-position: 0 0, 20px 0; }
.dsh-org-office-floor { position: absolute; z-index: -3; inset: 34% 0 0; background-image: linear-gradient(45deg, rgba(154, 112, 70, .11) 25%, transparent 25%, transparent 75%, rgba(154, 112, 70, .11) 75%), linear-gradient(45deg, rgba(154, 112, 70, .11) 25%, transparent 25%, transparent 75%, rgba(154, 112, 70, .11) 75%); background-position: 0 0, 14px 14px; background-size: 28px 28px; }
.dsh-org-office-window { position: absolute; z-index: -2; left: 3%; top: 6%; width: 18%; height: 21%; border: 5px solid #744948; background: linear-gradient(135deg, #83bad0, #d1e5d1); box-shadow: inset 0 0 0 5px #e3c48a, 4px 4px 0 rgba(76, 42, 43, .5); }
.dsh-org-office-window::before { content: ''; position: absolute; left: 50%; inset-block: 0; border-left: 4px solid #744948; }
.dsh-org-office-window::after { content: ''; position: absolute; inset: 50% 0 auto; border-top: 4px solid #744948; }
.dsh-org-wall-clock { position: absolute; z-index: 3; left: 24%; top: 5%; width: 70px; height: 70px; display: grid; place-items: center; border: 5px solid #694345; border-radius: 50%; background: #fff1c7; color: #4f3440; box-shadow: 4px 4px 0 rgba(76, 42, 43, .45); font: 800 11px ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; }
.dsh-org-wall-clock::before { content: ''; position: absolute; width: 3px; height: 20px; top: 11px; left: 50%; background: #d64d78; transform-origin: 50% 24px; animation: dsh-org-clock-hand 60s steps(60, end) infinite; }
@keyframes dsh-org-clock-hand { to { transform: rotate(360deg); } }
.dsh-org-company-board { position: absolute; z-index: 2; left: 34%; top: 5%; width: 30%; padding: 8px 12px; border: 4px solid #694345; background: #302738; color: #f8edcf; box-shadow: 4px 4px 0 rgba(76, 42, 43, .5); text-align: center; }
.dsh-org-company-board strong { display: block; color: var(--org-yellow); font-size: 14px; letter-spacing: .08em; }
.dsh-org-company-board span { display: block; margin-top: 3px; color: #d7c8af; font-size: 9px; }
.dsh-org-hours-board { position: absolute; z-index: 2; right: 3%; top: 5%; width: 27%; padding: 7px 9px; border: 3px solid #694345; background: #f4e0a8; color: #563943; box-shadow: 4px 4px 0 rgba(76, 42, 43, .4); font-size: 9px; line-height: 1.65; }
.dsh-org-hours-board strong { color: #b83e62; }
.dsh-org-office-room { position: absolute; z-index: -1; border: 3px solid rgba(107, 65, 60, .68); background: rgba(255, 239, 192, .3); box-shadow: 4px 4px 0 rgba(118, 74, 59, .16); }
.dsh-org-office-room.reception { left: 2%; top: 38%; width: 18%; height: 25%; background: rgba(208, 177, 128, .34); }
.dsh-org-office-room.work { left: 22%; top: 38%; width: 49%; height: 57%; }
.dsh-org-office-room.meeting { right: 2%; top: 38%; width: 25%; height: 28%; background: rgba(151, 125, 153, .18); }
.dsh-org-office-room.lounge { right: 2%; bottom: 4%; width: 25%; height: 25%; background: rgba(126, 174, 154, .17); }
.dsh-org-office-room.restroom { left: 2%; bottom: 4%; width: 10%; height: 27%; background: rgba(126, 174, 191, .2); }
.dsh-org-office-room.balcony { left: 13%; bottom: 4%; width: 7%; height: 27%; background: rgba(131, 186, 208, .18); }
.dsh-org-office-label { position: absolute; z-index: 1; padding: 3px 6px; border: 1px solid rgba(85, 53, 54, .7); background: rgba(60, 41, 53, .8); color: #ffe5a2; font-size: 9px; letter-spacing: .08em; }
.dsh-org-office-label.reception { left: 3%; top: 40%; }
.dsh-org-office-label.work { left: 23%; top: 40%; }
.dsh-org-office-label.meeting { right: 3%; top: 40%; }
.dsh-org-office-label.lounge { right: 3%; bottom: 6%; }
.dsh-org-office-label.restroom { left: 3%; bottom: 6%; }
.dsh-org-office-label.balcony { left: 14%; bottom: 6%; color: #d3f1ff; }
.dsh-org-furniture { position: absolute; z-index: 1; border: 3px solid #694345; box-shadow: 4px 4px 0 rgba(85, 47, 50, .3); }
.dsh-org-furniture.desk { width: 12%; height: 7%; background: #a76445; }
.dsh-org-furniture.desk::before { content: ''; position: absolute; left: 32%; top: -18px; width: 32px; height: 21px; border: 3px solid #4b3940; background: #29354a; box-shadow: inset 0 0 0 3px #6fc5da; }
.dsh-org-furniture.desk::after { content: ''; position: absolute; left: 42%; bottom: -13px; width: 18px; height: 12px; border: 3px solid #694345; border-top: 0; background: #8b6c78; }
.dsh-org-furniture.d1 { left: 25%; top: 51%; } .dsh-org-furniture.d2 { left: 42%; top: 51%; } .dsh-org-furniture.d3 { left: 58%; top: 51%; }
.dsh-org-furniture.d4 { left: 25%; top: 76%; } .dsh-org-furniture.d5 { left: 42%; top: 76%; } .dsh-org-furniture.d6 { left: 58%; top: 76%; }
.dsh-org-furniture.frontdesk { left: 5%; top: 51%; width: 12%; height: 8%; background: #a76445; }
.dsh-org-furniture.frontdesk::before { content: 'RECEPTION'; position: absolute; inset: 5px 4px auto; color: #ffe5a2; font: 7px ui-monospace, Consolas, monospace; text-align: center; }
.dsh-org-furniture.meeting-table { right: 6%; top: 50%; width: 17%; height: 9%; border-radius: 45%; background: #9a7392; }
.dsh-org-furniture.sofa { right: 14%; bottom: 12%; width: 10%; height: 9%; border-radius: 8px 8px 3px 3px; background: #6c9c83; }
.dsh-org-furniture.coffee { right: 4%; bottom: 11%; width: 7%; height: 7%; background: #a76445; }
.dsh-org-furniture.coffee::before { content: '☕'; position: absolute; left: 28%; top: -16px; color: #694345; font-size: 13px; }
.dsh-org-furniture.restroom-door { left: 4%; bottom: 10%; width: 6%; height: 18%; background: #7aa6b5; }
.dsh-org-furniture.restroom-door::before { content: 'WC'; position: absolute; inset: 8px 0 auto; color: #fff5d5; font: 800 9px ui-monospace, Consolas, monospace; text-align: center; }
.dsh-org-furniture.smoke { left: 14.5%; bottom: 12%; width: 4%; height: 4%; background: #718b95; }
.dsh-org-furniture.smoke::before { content: '🚬'; position: absolute; left: 3px; top: -18px; font-size: 11px; }
.dsh-org-office-plant { position: absolute; z-index: 2; width: 20px; height: 20px; border: 3px solid #694345; background: #a76445; }
.dsh-org-office-plant::before { content: '♣'; position: absolute; left: -4px; top: -24px; color: #4f8c62; font-size: 27px; }
.dsh-org-office-plant.p1 { left: 20%; top: 40%; } .dsh-org-office-plant.p2 { right: 27%; bottom: 5%; }
.dsh-org-avatar { --avatar-x: 50cqw; --avatar-y: 70cqh; --avatar-skin: #f4c38e; --avatar-hair: #5d496d; --avatar-shirt: #856f9e; --avatar-pants: #414454; --avatar-accent: #f4ce5a; position: absolute; z-index: 5; left: 0; top: 0; display: grid; justify-items: center; width: 64px; min-height: 78px; padding: 0; border: 0; background: transparent; color: #3d2d3a; cursor: pointer; transform: translate(var(--avatar-x), var(--avatar-y)) translate(-50%, -50%); transition: filter var(--org-motion-fast) var(--org-ease-out), transform var(--org-motion-walk) var(--org-ease-walk); will-change: transform; }
.dsh-org-avatar:hover, .dsh-org-avatar.active { filter: brightness(1.08) drop-shadow(0 4px 0 rgba(78, 47, 54, .4)); }
.dsh-org-avatar-shadow { position: absolute; bottom: 15px; width: 36px; height: 8px; border-radius: 50%; background: rgba(91, 55, 55, .25); }
.dsh-org-avatar-head { position: relative; z-index: 2; width: 25px; height: 22px; margin-top: 4px; border: 3px solid #49343c; background: var(--avatar-skin); box-shadow: 3px 0 0 #49343c; }
.dsh-org-avatar-head::before { content: ''; position: absolute; left: -3px; top: -7px; width: 25px; height: 8px; border: 3px solid #49343c; border-bottom: 0; background: var(--avatar-hair); }
.dsh-org-avatar-eyes { position: absolute; left: 5px; top: 9px; width: 3px; height: 3px; background: #49343c; box-shadow: 8px 0 0 #49343c; }
.dsh-org-avatar-body { position: relative; z-index: 1; width: 31px; height: 23px; border: 3px solid #49343c; background: var(--avatar-shirt); box-shadow: inset 0 -7px 0 rgba(255, 255, 255, .12); }
.dsh-org-avatar-legs { position: relative; z-index: 0; width: 25px; height: 8px; margin-top: -1px; }
.dsh-org-avatar-legs::before, .dsh-org-avatar-legs::after { content: ''; position: absolute; top: 0; width: 7px; height: 9px; border: 2px solid #49343c; border-top: 0; background: var(--avatar-pants); transform-origin: top center; }
.dsh-org-avatar-legs::before { left: 3px; } .dsh-org-avatar-legs::after { right: 3px; }
.dsh-org-avatar.walking .dsh-org-avatar-legs::before { animation: dsh-org-step-left .48s steps(2, end) infinite; }
.dsh-org-avatar.walking .dsh-org-avatar-legs::after { animation: dsh-org-step-right .48s steps(2, end) infinite; }
@keyframes dsh-org-step-left { 50% { transform: translateX(3px); } } @keyframes dsh-org-step-right { 50% { transform: translateX(-3px); } }
.dsh-org-avatar.status-running .dsh-org-avatar-body { border-color: #2a7088; box-shadow: inset 0 -7px 0 rgba(255, 255, 255, .12), 0 0 0 2px #7acbe5; }
.dsh-org-avatar.status-done .dsh-org-avatar-body { border-color: #3f7653; box-shadow: inset 0 -7px 0 rgba(255, 255, 255, .12), 0 0 0 2px #73d39d; }
.dsh-org-avatar.status-wait .dsh-org-avatar-body { border-color: #934b4b; box-shadow: inset 0 -7px 0 rgba(255, 255, 255, .12), 0 0 0 2px #ef7776; }
.dsh-org-avatar-accessory { position: absolute; z-index: 4; pointer-events: none; }
.dsh-org-avatar.staff-secretary { --avatar-hair: #2f293c; --avatar-shirt: #cc6689; --avatar-pants: #4a4058; --avatar-accent: #ffe0a3; }
.dsh-org-avatar.staff-secretary .dsh-org-avatar-accessory { width: 5px; height: 13px; top: 11px; right: 15px; border: 2px solid #49343c; border-left: 0; }
.dsh-org-avatar.staff-tech-lead { --avatar-skin: #dca775; --avatar-hair: #38333b; --avatar-shirt: #355b78; --avatar-pants: #292f3e; }
.dsh-org-avatar.staff-tech-lead .dsh-org-avatar-head::after { content: ''; position: absolute; left: 2px; top: 7px; width: 7px; height: 5px; border: 2px solid #49343c; box-shadow: 9px 0 0 -2px var(--avatar-skin), 9px 0 0 0 #49343c; }
.dsh-org-avatar.staff-recruiter { --avatar-hair: #8b4c58; --avatar-shirt: #b65b77; --avatar-pants: #51445d; --avatar-accent: #f4ce5a; }
.dsh-org-avatar.staff-recruiter .dsh-org-avatar-accessory { width: 9px; height: 13px; top: 3px; right: 12px; border: 3px solid #49343c; background: #8b4c58; }
.dsh-org-avatar.staff-developer { --avatar-skin: #e2ae7c; --avatar-hair: #363342; --avatar-shirt: #367d6e; --avatar-pants: #313746; --avatar-accent: #7acbe5; }
.dsh-org-avatar.staff-developer .dsh-org-avatar-body::before { content: ''; position: absolute; left: 5px; top: 2px; width: 13px; height: 3px; background: #7acbe5; box-shadow: 0 5px 0 #7acbe5; }
.dsh-org-avatar.staff-pm { --avatar-hair: #68453d; --avatar-shirt: #d69a4d; --avatar-pants: #51546b; --avatar-accent: #fff0bd; }
.dsh-org-avatar.staff-pm .dsh-org-avatar-accessory { width: 10px; height: 14px; top: 31px; right: 10px; border: 2px solid #49343c; background: #fff0bd; }
.dsh-org-avatar.staff-platform { --avatar-skin: #d9a36e; --avatar-hair: #e1a638; --avatar-shirt: #b95f3f; --avatar-pants: #3d4652; --avatar-accent: #f4ce5a; }
.dsh-org-avatar.staff-platform .dsh-org-avatar-head::before { top: -8px; height: 7px; border-radius: 5px 5px 0 0; background: #e1a638; }
.dsh-org-avatar.staff-platform .dsh-org-avatar-accessory { width: 18px; height: 4px; top: 40px; left: 23px; background: #f4ce5a; }
.dsh-org-avatar.staff-researcher { --avatar-hair: #352f51; --avatar-shirt: #6b5ba7; --avatar-pants: #343546; --avatar-accent: #7acbe5; }
.dsh-org-avatar.staff-researcher .dsh-org-avatar-accessory { width: 12px; height: 12px; top: 30px; right: 8px; border: 3px solid #49343c; border-radius: 50%; }
.dsh-org-avatar.staff-doc { --avatar-skin: #efbf8c; --avatar-hair: #59434c; --avatar-shirt: #ead8a1; --avatar-pants: #66566f; --avatar-accent: #b85d78; }
.dsh-org-avatar.staff-doc .dsh-org-avatar-body::before { content: ''; position: absolute; left: 12px; inset-block: 0; width: 3px; background: #b85d78; }
.dsh-org-avatar-name { position: relative; z-index: 3; margin-top: 1px; padding: 1px 4px; border: 1px solid rgba(66, 45, 52, .75); background: rgba(255, 239, 192, .92); color: #4d3541; font-size: 9px; font-weight: 800; white-space: nowrap; }
.dsh-org-avatar-state { position: relative; z-index: 3; max-width: 72px; margin-top: 2px; padding: 1px 4px; background: rgba(55, 39, 50, .86); color: #ffe5a2; font-size: 8px; white-space: nowrap; }
.dsh-org-avatar-speech { position: absolute; left: 50%; bottom: calc(100% + 6px); z-index: 8; width: max-content; max-width: 170px; padding: 6px 8px; border: 2px solid #5d3b45; background: #fff0bd; color: #4c3039; box-shadow: 3px 3px 0 rgba(76, 48, 57, .35); font-size: 9px; line-height: 1.4; white-space: normal; transform: translateX(-50%); pointer-events: none; }
.dsh-org-avatar-speech::after { content: ''; position: absolute; left: 50%; top: 100%; border: 5px solid transparent; border-top-color: #5d3b45; transform: translateX(-50%); }
.dsh-org-avatar.status-running .dsh-org-avatar-head { animation: dsh-org-breathe 1.8s ease-in-out infinite; }
.dsh-org-avatar.status-running .dsh-org-avatar-body::after { content: ''; position: absolute; right: -13px; bottom: 2px; width: 10px; height: 3px; background: #49343c; box-shadow: 0 -7px 0 #49343c; transform: rotate(15deg); }
.dsh-org-avatar.status-wait .dsh-org-avatar-state { color: #ffd0a4; }
@keyframes dsh-org-breathe { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
.dsh-org-office-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-top: 1px solid var(--org-pink); background: #282133; color: #cbb8a1; font-size: 10px; }
.dsh-org-office-footer strong { color: var(--org-yellow); }
.dsh-org-office-compact { display: none; }
.dsh-org-flow { min-height: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--org-line); background: var(--org-panel); box-shadow: 0 14px 32px rgba(0, 0, 0, .18); }
.dsh-org-flow-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 13px; border-bottom: 1px solid var(--org-line); background: linear-gradient(90deg, rgba(122, 203, 229, .07), transparent 60%); }
.dsh-org-flow-title-wrap { display: flex; align-items: center; gap: 9px; min-width: 0; }
.dsh-org-flow-icon { width: 32px; height: 32px; display: grid; place-items: center; flex: none; border: 1px solid var(--org-line); background: var(--org-panel-raised); color: var(--org-blue); font: 14px ui-monospace, "SF Mono", Consolas, monospace; }
.dsh-org-flow-title { color: var(--org-ink); font-size: 13px; font-weight: 800; }
.dsh-org-flow-notice { display: block; overflow: hidden; margin-top: 2px; color: var(--org-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.dsh-org-flow-state { display: inline-flex; align-items: center; gap: 6px; flex: none; color: var(--org-green); font-size: 10px; white-space: nowrap; }
.dsh-org-flow-state.running { color: var(--org-blue); }
.dsh-org-flow-state.error { color: var(--org-red); }
.dsh-org-flow-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 11px; border-bottom: 1px solid var(--org-line); background: #1a1720; }
.dsh-org-flow-tabs, .dsh-org-flow-prompts { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.dsh-org-flow-tab, .dsh-org-flow-prompt { min-height: 30px; border: 1px solid var(--org-line); background: transparent; color: var(--org-muted); padding: 5px 9px; font-size: 10px; cursor: pointer; transition: color .15s ease, border-color .15s ease, background-color .15s ease; }
.dsh-org-flow-tab:hover, .dsh-org-flow-tab.active, .dsh-org-flow-prompt:hover { border-color: var(--org-blue); background: rgba(122, 203, 229, .08); color: var(--org-ink); }
.dsh-org-flow-tab.active { color: var(--org-blue); }
.dsh-org-flow-body { min-height: 0; max-height: none; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 13px 12px 18px; background: #17151c; scroll-behavior: smooth; overscroll-behavior: contain; }
.dsh-org-flow-empty { margin: auto; max-width: 440px; padding: 28px 20px; color: var(--org-muted); font-size: 12px; line-height: 1.7; text-align: center; }
.dsh-org-flow-row { display: flex; align-items: flex-start; gap: 9px; min-width: 0; }
.dsh-org-flow-row.user { flex-direction: row-reverse; }
.dsh-org-flow-avatar { width: 30px; height: 30px; display: grid; place-items: center; flex: none; border: 1px solid var(--org-line); background: var(--org-panel-raised); color: var(--org-muted); font-size: 11px; font-weight: 800; }
.dsh-org-flow-row.user .dsh-org-flow-avatar { border-color: rgba(214, 77, 120, .75); color: var(--org-yellow); }
.dsh-org-flow-row.employee .dsh-org-flow-avatar { border-color: rgba(111, 205, 155, .72); background: rgba(111, 205, 155, .12); color: #b9ffd6; font-size: 16px; }
.dsh-org-flow-message { display: flex; flex-direction: column; gap: 6px; min-width: 0; width: min(82%, 760px); }
.dsh-org-flow-row.user .dsh-org-flow-message { align-items: flex-end; }
.dsh-org-flow-meta { display: flex; align-items: center; gap: 7px; color: var(--org-dim); font-size: 10px; }
.dsh-org-flow-bubble { width: fit-content; max-width: 100%; padding: 10px 12px; border: 1px solid var(--org-line); background: var(--org-panel-raised); color: var(--org-ink); font-size: 12px; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
.dsh-org-flow-row.user .dsh-org-flow-bubble { border-color: rgba(214, 77, 120, .72); background: rgba(214, 77, 120, .15); }
.dsh-org-flow-row.employee .dsh-org-flow-bubble { border-color: rgba(111, 205, 155, .45); background: rgba(111, 205, 155, .09); }
.dsh-org-flow-role-badge { color: #8be7b0; font-size: 10px; }
.dsh-org-flow-dispatch { margin-left: 39px; padding: 6px 10px; border-left: 2px solid rgba(122, 203, 229, .55); color: var(--org-muted); font-size: 11px; }
.dsh-org-flow-direct { display: flex; align-items: center; gap: 7px; }
.dsh-org-flow-direct i { width: 7px; height: 7px; border-radius: 50%; background: var(--org-blue); box-shadow: 0 0 0 3px rgba(122, 203, 229, .12); animation: dsh-org-pulse 1.2s ease-in-out infinite; }
.dsh-org-meeting { display: grid; gap: 10px; padding-block: 4px 10px; border-block: 1px dashed var(--org-line); }
.dsh-org-meeting-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--org-yellow); font-size: 10px; }
.dsh-org-meeting-head span { overflow: hidden; color: var(--org-muted); text-overflow: ellipsis; white-space: nowrap; }
.dsh-org-reasoning { width: 100%; border: 1px solid rgba(122, 203, 229, .24); background: rgba(122, 203, 229, .05); }
.dsh-org-reasoning summary { min-height: 34px; padding: 8px 10px; color: var(--org-blue); font-size: 10px; cursor: pointer; list-style-position: inside; }
.dsh-org-reasoning-text { padding: 0 10px 10px; color: var(--org-muted); font: 10px/1.65 ui-monospace, "SF Mono", Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
.dsh-org-trace { margin-left: 39px; border: 1px solid var(--org-line); background: #1d1a23; }
.dsh-org-trace.running { border-color: rgba(122, 203, 229, .46); }
.dsh-org-trace.error { border-color: rgba(239, 119, 118, .55); }
.dsh-org-trace summary { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 8px 10px; color: var(--org-muted); font-size: 11px; cursor: pointer; list-style: none; }
.dsh-org-trace summary::-webkit-details-marker { display: none; }
.dsh-org-trace-status { width: 7px; height: 7px; flex: none; background: var(--org-green); }
.dsh-org-trace.running .dsh-org-trace-status { background: var(--org-blue); animation: dsh-org-pulse 1s ease-in-out infinite; }
.dsh-org-trace.error .dsh-org-trace-status { background: var(--org-red); }
.dsh-org-trace-name { color: var(--org-ink); font-weight: 700; }
.dsh-org-trace-target { min-width: 0; overflow: hidden; flex: 1; color: var(--org-muted); text-overflow: ellipsis; white-space: nowrap; }
.dsh-org-trace-time { flex: none; color: var(--org-dim); font-size: 9px; font-variant-numeric: tabular-nums; }
.dsh-org-trace-detail { display: grid; gap: 8px; padding: 0 10px 10px 25px; }
.dsh-org-trace-label { color: var(--org-yellow); font-size: 9px; font-weight: 800; letter-spacing: .08em; }
.dsh-org-trace-code { max-height: 220px; overflow: auto; margin: 0; padding: 9px; background: #121016; color: #cabfae; font: 10px/1.55 ui-monospace, "SF Mono", Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
.dsh-org-flow-notice-row { margin-left: 39px; padding: 8px 10px; border-left: 2px solid var(--org-yellow); background: rgba(244, 206, 90, .06); color: #d9cbaa; font-size: 11px; line-height: 1.55; }
.dsh-org-flow-notice-row.error { border-left-color: var(--org-red); background: rgba(239, 119, 118, .08); color: #f2aaa4; }
.dsh-org-stream-caret { display: inline-block; width: 7px; height: 13px; margin-left: 4px; background: var(--org-blue); vertical-align: -2px; animation: dsh-org-caret .8s step-end infinite; }
@keyframes dsh-org-caret { 50% { opacity: .18; } }
@keyframes dsh-org-pulse { 50% { opacity: .35; } }
[data-conversation-scroll].dsh-org-session-active > [data-composer-seat] { border-top: 1px solid #514254; background: linear-gradient(180deg, rgba(21, 19, 26, 0), #15131a 28px); padding-top: 12px; }
.dsh-org-context { position: absolute; z-index: 20; top: 8px; right: 8px; width: min(310px, calc(100% - 24px)); max-height: calc(100% - 16px); overflow-y: auto; display: grid; gap: 10px; min-width: 0; box-shadow: 0 18px 46px rgba(0, 0, 0, .38); }
.dsh-org-context-close { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--org-line); background: transparent; color: var(--org-muted); cursor: pointer; }
.dsh-org-context-close:hover { border-color: var(--org-pink); color: var(--org-ink); }
.dsh-org-context-card, .dsh-org-activity-card { overflow: hidden; border: 1px solid var(--org-line); background: var(--org-panel); box-shadow: 0 14px 32px rgba(0, 0, 0, .18); }
.dsh-org-context-identity { display: grid; grid-template-columns: 46px minmax(0, 1fr); gap: 10px; padding: 13px; }
.dsh-org-context-avatar { width: 46px; height: 46px; display: grid; place-items: center; border: 1px solid var(--org-pink); background: var(--org-panel-raised); font-size: 25px; }
.dsh-org-context-name { overflow: hidden; color: var(--org-ink); font-size: 14px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.dsh-org-context-role { margin-top: 2px; color: var(--org-muted); font-size: 10px; }
.dsh-org-context-state { display: inline-flex; align-items: center; gap: 5px; margin-top: 7px; color: var(--org-muted); font-size: 10px; }
.dsh-org-context-state.running { color: var(--org-blue); }
.dsh-org-context-state.done { color: var(--org-green); }
.dsh-org-context-state.wait { color: var(--org-red); }
.dsh-org-context-intro { padding: 0 13px 10px; color: var(--org-muted); font-size: 11px; line-height: 1.55; }
.dsh-org-context-actions { display: flex; gap: 7px; padding: 0 13px 13px; }
.dsh-org-context-action { flex: none; min-height: 36px; border: 1px solid var(--org-pink); background: var(--org-pink); color: #fff7e6; padding: 8px 12px; font-size: 11px; font-weight: 800; cursor: pointer; transition: filter .15s ease, transform .15s ease, background-color .15s ease; }
.dsh-org-context-action:hover { filter: brightness(1.08); transform: translateY(-1px); }
.dsh-org-context-action.secondary { border-color: var(--org-line); background: transparent; color: var(--org-muted); }
.dsh-org-context-action.secondary:hover { background: var(--org-panel-raised); color: var(--org-ink); }
.dsh-org-context-section { padding: 0 13px 13px; }
.dsh-org-context-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 7px; color: var(--org-yellow); font-size: 10px; font-weight: 800; letter-spacing: .1em; }
.dsh-org-context-label span { color: var(--org-dim); font-weight: 400; letter-spacing: 0; }
.dsh-org-note { padding: 7px 0; color: var(--org-muted); font-size: 11px; }
.dsh-org-task { padding: 9px 0 0; border-top: 1px dashed var(--org-line); }
.dsh-org-task:first-child { padding-top: 0; border-top: 0; }
.dsh-org-task-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.dsh-org-task-desc { min-width: 0; flex: 1; color: var(--org-ink); font-size: 11px; font-weight: 700; line-height: 1.45; word-break: break-word; }
.dsh-org-chip { flex: none; padding: 2px 5px; border: 1px solid currentColor; font-size: 9px; line-height: 1.2; white-space: nowrap; }
.dsh-org-task-lead { margin-top: 6px; padding: 6px 7px; background: var(--org-panel-raised); color: var(--org-muted); font-size: 10px; line-height: 1.45; word-break: break-word; }
.dsh-org-task-points { margin-top: 4px; }
.dsh-org-task-point { color: var(--org-muted); font-size: 10px; line-height: 1.45; }
.dsh-org-task-meta { margin-top: 5px; color: var(--org-dim); font-size: 9px; }
.dsh-org-task-toggle { margin-top: 5px; padding: 0; border: 0; background: transparent; color: var(--org-blue); font-size: 10px; cursor: pointer; }
.dsh-org-progress { height: 4px; margin-top: 7px; overflow: hidden; background: var(--org-panel-soft); }
.dsh-org-progress-bar { width: 36%; height: 100%; background: var(--org-blue); animation: dsh-org-progress 1.4s ease-in-out infinite; }
@keyframes dsh-org-progress { 0% { margin-left: -40%; } 100% { margin-left: 110%; } }
.dsh-org-activity-list { display: grid; gap: 8px; padding: 0 13px 13px; }
.dsh-org-activity-item { display: grid; grid-template-columns: 7px minmax(0, 1fr); gap: 8px; color: var(--org-muted); font-size: 10px; line-height: 1.45; }
.dsh-org-activity-item::before { content: ''; width: 5px; height: 5px; margin-top: 5px; background: var(--org-yellow); }
.dsh-org-context-foot { padding: 10px 13px; border-top: 1px solid var(--org-line); color: var(--org-dim); font-size: 10px; line-height: 1.45; }
.dsh-org-focus { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; color: var(--org-muted); font-size: 11px; }
.dsh-org-focus button { border: 1px solid var(--org-line); background: transparent; color: var(--org-yellow); padding: 4px 8px; font-size: 10px; cursor: pointer; }
.dsh-org-empty { padding: 14px; border: 1px dashed var(--org-line); color: var(--org-muted); font-size: 11px; text-align: center; }
.dsh-org-modal-mask { position: fixed; z-index: 1100; inset: 0; display: flex; align-items: center; justify-content: center; padding: 18px; background: rgba(9, 8, 12, .68); }
.dsh-org-modal { width: 440px; max-width: 100%; max-height: 84vh; overflow-y: auto; border: 1px solid var(--org-pink); background: var(--org-panel); box-shadow: 8px 8px 0 rgba(214, 77, 120, .26); }
.dsh-org-modal-head { display: flex; align-items: center; gap: 11px; padding: 14px; border-bottom: 1px solid var(--org-line); }
.dsh-org-modal-emoji { width: 48px; height: 48px; display: grid; place-items: center; border: 1px solid var(--org-line); background: var(--org-panel-raised); font-size: 25px; }
.dsh-org-modal-id { min-width: 0; flex: 1; }
.dsh-org-modal-name { color: var(--org-ink); font-size: 15px; font-weight: 800; }
.dsh-org-modal-role { margin-top: 2px; color: var(--org-muted); font-size: 11px; }
.dsh-org-modal-close { border: 0; background: transparent; color: var(--org-muted); padding: 5px 8px; font-size: 16px; cursor: pointer; }
.dsh-org-modal-close:hover { color: var(--org-ink); }
.dsh-org-modal-body { padding: 0 14px 15px; }
.dsh-org-modal-intro { padding: 13px 0 4px; color: var(--org-muted); font-size: 11px; line-height: 1.55; }
.dsh-org-modal-label { margin: 13px 0 7px; color: var(--org-yellow); font-size: 10px; font-weight: 800; letter-spacing: .1em; }
.dsh-org-modal-tools { display: flex; flex-wrap: wrap; gap: 5px; }
.dsh-org-tool { padding: 3px 6px; border: 1px solid var(--org-line); background: var(--org-panel-raised); color: var(--org-muted); font: 10px ui-monospace, "SF Mono", Consolas, monospace; }
.dsh-org-skill-row { padding: 7px 0; border-bottom: 1px dashed var(--org-line); color: var(--org-ink); font-size: 11px; }
.dsh-org-skill-row:last-child { border-bottom: 0; }
.dsh-org-skill-desc { margin-top: 2px; color: var(--org-muted); font-size: 10px; }
.dsh-org-focus-action { margin: 8px 7px 0 0; border: 1px solid var(--org-line); background: transparent; color: var(--org-yellow); padding: 7px 9px; font-size: 10px; cursor: pointer; }
.dsh-org button:focus-visible, .dsh-org input:focus-visible, .dsh-org textarea:focus-visible { outline: 2px solid var(--org-blue); outline-offset: 2px; }
@container (max-width: 420px) {
  .dsh-org-office-header { padding: 7px 9px; }
  .dsh-org-office-heading { width: 100%; }
  .dsh-org-office-caption, .dsh-org-office-legend { display: none; }
  .dsh-org-office-title { width: 100%; font-size: 11px; }
  .dsh-org-company-board span, .dsh-org-hours-board { font-size: 7px; }
  .dsh-org-wall-clock { transform: scale(.82); transform-origin: top left; }
}
@container (max-width: 820px) {
  .dsh-org-center { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(520px, 1fr) 300px; }
  .dsh-org-office-caption { display: none; }
  .dsh-org-flow-toolbar { padding-block: 6px; }
  .dsh-org-flow-prompts { display: none; }
}
@container (max-width: 720px) {
  .dsh-org-office-caption { display: none; }
  .dsh-org-office-header { padding: 7px 9px; }
  .dsh-org-office-canvas { flex: 0 0 248px; height: 248px; min-height: 248px; }
  .dsh-org-office-room, .dsh-org-office-label, .dsh-org-furniture, .dsh-org-office-plant, .dsh-org-avatar { display: none; }
  .dsh-org-office-window { left: 5%; top: 14%; width: 25%; height: 48%; }
  .dsh-org-wall-clock { left: 35%; top: 14%; transform: scale(.78); transform-origin: top left; }
  .dsh-org-company-board { left: 35%; top: 14%; width: 60%; padding: 6px 8px; }
  .dsh-org-company-board strong { font-size: 12px; }
  .dsh-org-hours-board { left: 5%; right: auto; top: 72%; width: 90%; padding: 5px 7px; font-size: 8px; line-height: 1.45; }
  .dsh-org-office-compact { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; flex: 1; min-height: 0; overflow-y: auto; padding: 8px; background: #1a1720; }
  .dsh-org-office-compact-head { grid-column: 1 / -1; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; color: var(--org-yellow); font-size: 10px; font-weight: 800; }
  .dsh-org-office-compact-head span { color: var(--org-dim); font-size: 9px; font-weight: 500; }
  .dsh-org-office-compact-row { display: grid; grid-template-columns: 25px minmax(0, 1fr); align-items: center; gap: 6px; min-width: 0; min-height: 42px; padding: 5px; border: 1px solid var(--org-line); background: var(--org-panel); color: var(--org-ink); text-align: left; cursor: pointer; }
  .dsh-org-office-compact-row:hover, .dsh-org-office-compact-row.active { border-color: var(--org-pink); background: rgba(214, 77, 120, .12); }
  .dsh-org-office-compact-avatar { width: 25px; height: 25px; display: grid; place-items: center; border: 1px solid var(--org-line); background: var(--org-panel-raised); font-size: 14px; }
  .dsh-org-office-compact-row.running .dsh-org-office-compact-avatar { border-color: var(--org-blue); }
  .dsh-org-office-compact-row.done .dsh-org-office-compact-avatar { border-color: var(--org-green); }
  .dsh-org-office-compact-row.wait .dsh-org-office-compact-avatar { border-color: var(--org-red); }
  .dsh-org-office-compact-copy { min-width: 0; }
  .dsh-org-office-compact-copy strong, .dsh-org-office-compact-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dsh-org-office-compact-copy strong { font-size: 10px; }
  .dsh-org-office-compact-copy small { margin-top: 1px; color: var(--org-muted); font-size: 8px; }
  .dsh-org-office-compact-state { grid-column: 1 / -1; overflow: hidden; color: var(--org-dim); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
}
@container (max-width: 720px) and (max-height: 520px) {
  .dsh-org-office-canvas { flex-basis: 154px; height: 154px; min-height: 154px; }
  .dsh-org-office-compact { padding: 6px; }
  .dsh-org-office-compact-row { min-height: 38px; }
  .dsh-org-office-footer { padding-block: 6px; font-size: 9px; }
  .dsh-org-office-footer > span:last-child { display: none; }
}
@media (max-width: 860px) {
  .dsh-org { height: auto; min-height: 0; overflow: visible; padding: 12px 10px 26px; }
  .dsh-org-shell { height: auto; }
  .dsh-org-head { align-items: flex-start; flex-direction: column; }
  .dsh-org-head-right { width: 100%; justify-content: space-between; }
  .dsh-org-workbench { grid-template-columns: 1fr; }
  .dsh-org-orgchart { grid-template-columns: 1fr; }
  .dsh-org-orgchart-boss::after { display: none; }
  .dsh-org-orgchart-units { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dsh-org-roster { height: auto; }
  .dsh-org-roster-list { max-height: 240px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dsh-org-center { grid-template-columns: 1fr; grid-template-rows: minmax(520px, 1fr) 300px; }
  .dsh-org-context { position: fixed; top: 88px; right: 12px; max-height: calc(100dvh - 190px); }
  .dsh-org-flow-toolbar { align-items: flex-start; flex-direction: column; }
}
@media (max-width: 560px) {
  .dsh-org-brief { grid-template-columns: auto minmax(0, 1fr); }
  .dsh-org-brief-tail { grid-column: 2; }
  .dsh-org-stats { width: 100%; }
  .dsh-org-orgchart-units { grid-template-columns: 1fr; }
  .dsh-org-stat { flex: 1; }
  .dsh-org-office-header { align-items: flex-start; flex-direction: column; }
  .dsh-org-office-legend { justify-content: flex-start; }
  .dsh-org-center { grid-template-rows: minmax(480px, 1fr) 260px; }
  .dsh-org-avatar { transform: translate(var(--avatar-x), var(--avatar-y)) translate(-50%, -50%) scale(.82); }
  .dsh-org-avatar:hover, .dsh-org-avatar.active { transform: translate(var(--avatar-x), var(--avatar-y)) translate(-50%, calc(-50% - 4px)) scale(.82); }
  .dsh-org-roster-list { grid-template-columns: 1fr; }
  .dsh-org-flow-tab, .dsh-org-flow-prompt { min-height: 44px; }
  .dsh-org-flow-body { min-height: 0; max-height: none; padding-inline: 10px; }
  .dsh-org-flow-message { width: min(86%, 760px); }
  .dsh-org-trace, .dsh-org-flow-notice-row { margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-org *, .dsh-org *::before, .dsh-org *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
`

export type SkillDef = { name: string; desc?: string }
export type RoleDef = { id: string; tools: string[]; skills: SkillDef[]; keywords?: string[] }
export type StaffDef = {
  id: string
  name: string
  role: string
  emoji: string
  intro: string
  roleId: string
  department?: string
  reportsTo?: string
  aliases?: string[]
  lines?: { [key: string]: string[] | undefined }
}
export type OrgPanelConfig = {
  tabLabel?: string
  companyName?: string
  chatEnabled?: boolean
  roles?: RoleDef[]
  staff?: StaffDef[]
}

const DEFAULT_ROLES: RoleDef[] = [
  { id: 'secretary', tools: ['staff_chat', 'subagent', 'workflow', 'send_message', 'list_agents'], skills: [{ name: '总裁办协调', desc: '接待老板、点名转交、会议召集与进度同步' }], keywords: ['秘书', '协调', '通知', '汇总', '会议', '日程'] },
  { id: 'tech-lead', tools: ['subagent', 'subagent_fork', 'workflow', 'ralph', 'send_message', 'list_agents', 'create_goal', 'get_goal', 'update_goal', 'todo_write'], skills: [{ name: '多智能体调度', desc: '拆解任务、指派下级、盯进度' }], keywords: ['派', '调度', '协调', '分配', '安排', '进度', '排期', '统筹', '管理'] },
  { id: 'recruiter', tools: ['web_search', 'web_fetch', 'ask_user_question', 'subagent'], skills: [{ name: '人才招聘', desc: '定义岗位画像、搜寻候选人、组织面试与能力评估' }], keywords: ['招聘', '人才', '候选人', '面试', '岗位', '人事', '入职', '团队扩编'] },
  { id: 'developer', tools: ['bash', 'pwsh', 'edit', 'write', 'grep', 'glob', 'read_image', 'job_list', 'codex', 'apply_patch'], skills: [{ name: '工程实现', desc: '写代码、改文件、跑命令' }], keywords: ['代码', '写', '实现', '开发', '编程', '修', 'bug', '接口', '前端', '后端', '测试', '命令', '脚本', '重构', '编译', '构建'] },
  { id: 'pm', tools: ['ask_user_question'], skills: [{ name: '需求分析', desc: '梳理需求、向用户提问确认' }], keywords: ['需求', '文案', '方案', '产品', '设计', 'prd', '提问', '决策', '用户反馈', '优先级'] },
  { id: 'researcher', tools: ['web_search', 'web_fetch'], skills: [{ name: '情报调研', desc: '联网搜索、查竞品、写报告' }], keywords: ['调研', '搜索', '查', '情报', '分析', '市场', '竞品', '联网', '抓取', '资料', '行业', '报告'] },
  { id: 'platform', tools: ['cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine', 'cordis_inspect_list'], skills: [{ name: 'Cordis 插件开发', desc: '定义/运行/检查动态插件与扩展' }], keywords: ['部署', '插件', '环境', '配置', 'cordis', '扩展', '集成', '平台', '安装', '上线', '容器', '服务'] },
  { id: 'doc', tools: ['read', 'skill', 'write_doc'], skills: [{ name: '文档与知识库', desc: '读写文档、整理资料、加载技能' }], keywords: ['文档', '知识', '整理', '手册', '读写', '技能', '教程', '说明', '归档', '笔记'] },
]

const DEFAULT_STAFF: StaffDef[] = [
  { id: 'secretary', name: '秘书', role: '总裁秘书', emoji: '◇', roleId: 'secretary', department: '总裁办', reportsTo: '老板', aliases: ['秘书', '总裁秘书', '助理', 'secretary'], intro: '公司的协调中枢，也是当前主 Agent。负责接待老板、传达指令、召集员工和同步全局进度。', lines: { idle: ['前台在线，随时接旨', '正在整理老板日程'], running: ['正在转达老板指令', '协调各部门回话中'], done: ['汇报已送达老板'], wait: ['有一项决策等老板拍板'] } },
  { id: 'tech-lead', name: '老王', role: '技术经理', emoji: '👔', roleId: 'tech-lead', department: '管理层', reportsTo: '老板', aliases: ['老王', '技术经理', 'tech-lead', 'tech lead'], intro: '团队的大脑，负责拆任务、调人手、盯进度，出了事他扛。', lines: { idle: ['巡一圈工位，看看谁摸鱼', '盯着排期发呆', '今天谁点奶茶？'], running: ['收到！这就拆任务分配下去', '大家按排期来，别慌', '进度我盯着'], done: ['团队交付了，漂亮', '活儿干完，可以松口气'], wait: ['老板，这方向得你拍板', '资源不够，等你批预算'] } },
  { id: 'recruiter', name: '小周', role: '招聘负责人', emoji: '♟', roleId: 'recruiter', department: '人才与文化', reportsTo: '老板', aliases: ['小周', '招聘负责人', '招聘', '人事', 'hr'], intro: '赛博公司的人才侦察兵，负责岗位画像、搜人、面试、入职和团队能力盘点。', lines: { idle: ['在人才库里捞简历', '研究谁适合加入团队'], running: ['正在搜候选人', '面试题已经安排'], done: ['候选人评估完成', '招聘建议已提交'], wait: ['HC 还等老板审批'] } },
  { id: 'developer', name: '小刘', role: '程序员', emoji: '💻', roleId: 'developer', department: '产品研发部', reportsTo: '老王', aliases: ['小刘', '程序员', 'developer', '开发'], intro: '码农本农，能写会改，最怕的就是需求变更。', lines: { idle: ['等需求，先刷会儿代码', 'IDE 开着，假装很忙'], running: ['收到，开写！', '这需求怎么又变了…', '在写了在写了，别催'], done: ['搞定，测试过了', '交付！谁请奶茶'], wait: ['接口还没给我，卡住了', '编译报错，等个环境'] } },
  { id: 'pm', name: '阿明', role: '产品经理', emoji: '📋', roleId: 'pm', department: '产品研发部', reportsTo: '老王', aliases: ['阿明', '产品经理', 'pm', '产品'], intro: '天天想需求、写 PRD，老板的传声筒，背锅侠。', lines: { idle: ['想下一个需求', '和用户聊聊反馈'], running: ['需求我理好了，发群里', '这个功能老板要的，加一下'], done: ['PRD 写完了', '需求落地了'], wait: ['老板，这个优先级你定', '用户反馈等确认'] } },
  { id: 'platform', name: '大壮', role: '平台工程师', emoji: '🛠', roleId: 'platform', department: '产品研发部', reportsTo: '老王', aliases: ['大壮', '平台工程师', 'platform', '平台', '运维'], intro: '管环境、装插件、搞扩展，闷头干大事。', lines: { idle: ['插件环境守着', '等部署任务'], running: ['环境在部署了', '插件装好了'], done: ['环境就绪', '扩展上线'], wait: ['权限要开通下'] } },
  { id: 'researcher', name: '小丽', role: '市场调研', emoji: '🔎', roleId: 'researcher', department: '市场与知识部', reportsTo: '老王', aliases: ['小丽', '市场调研', 'researcher', '调研'], intro: '情报担当，搜竞品、查资料、写报告，消息最灵。', lines: { idle: ['逛会儿论坛找素材', '等调研任务'], running: ['正在搜竞品情报', '查到几条关键信息'], done: ['调研报告出来了', '情报整理好了'], wait: ['搜索方向要确认下'] } },
  { id: 'doc', name: '静静', role: '文档专员', emoji: '📖', roleId: 'doc', department: '市场与知识部', reportsTo: '老王', aliases: ['静静', '文档专员', 'doc', '文档'], intro: '知识库守门人，写文档、理资料、记笔记。', lines: { idle: ['整理文档库', '等写作任务'], running: ['文档写着呢', '资料整理中'], done: ['文档更新好了', '手册写完了'], wait: ['缺素材，等资料'] } },
]

// 不设置任何虚构群聊内容。
// 群聊只展示真实派活动态，以及老板通过输入框发起的真实交互消息。

const STATUS_LABEL: Record<string, string> = {
  running: '干活中',
  done: '已交付',
  wait: '卡住了',
  idle: '待命中',
}

const STATUS_COLOR: Record<string, string> = {
  running: 'var(--dsw-alias-brand-primary)',
  done: 'var(--dsw-alias-state-success-primary)',
  wait: 'var(--dsw-alias-state-error-primary)',
  idle: 'var(--dsw-alias-label-secondary)',
}

type FlowMode = 'all' | 'chat' | 'trace'

type Delegation = {
  callId: string
  tool: string
  desc: string
  running: boolean
  isError: boolean
  lead: string
  points: string[]
  startTime: number | null
  endTime: number | null
  duration: number | null
  roleId: string
  staffId: string
}

function clip(s: unknown, n: number): string {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

function extractText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const b of blocks as Array<{ text?: unknown }>) {
    if (b && typeof b.text === 'string' && b.text.trim()) parts.push(b.text)
  }
  return parts.join('\n').trim()
}

function parseArgs(raw: unknown): Record<string, any> {
  if (typeof raw !== 'string') return raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  try { return JSON.parse(raw) } catch { return {} }
}

function nodeTime(n: any): number | null {
  const t = n && (n.time ?? n.ts ?? n.createdAt)
  if (typeof t === 'number') return t
  if (typeof t === 'string') { const p = Date.parse(t); return isNaN(p) ? null : p }
  return null
}

function collectUserRequests(nodes: any[]): string[] {
  const out: string[] = []
  for (const n of nodes) {
    const source = n?.source || n?.message?.source
    if (n && n.kind === 'user' && source?.kind !== 'subagent-settled') {
      const t = extractText(n.content)
      if (t) out.push(t)
    }
  }
  return out
}

function summarizeResult(text: string): { lead: string; points: string[] } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return { lead: '', points: [] }
  const lead = clip(lines[0], 110)
  const points: string[] = []
  for (let i = 1; i < lines.length && points.length < 4; i++) {
    const l = lines[i]
    if (/^[-*•]|\d+[.)]/.test(l)) points.push(clip(l.replace(/^[-*•\s]+/, '').replace(/^\d+[.)]\s*/, ''), 80))
  }
  if (points.length === 0) for (let i = 1; i < lines.length && points.length < 4; i++) points.push(clip(lines[i], 80))
  return { lead, points }
}

function isDispatchTool(name: string): boolean {
  if (!name) return false
  return name === 'workflow' || name === 'staff_chat' || name === 'staff_meeting' || name.startsWith('subagent')
}

type StaffMarker = { staffId: string; childId: string; state: string }
type StaffMeeting = { kind: 'meeting'; topic: string; turns: Array<{ staffId: string; staffName: string; reply: string }> }

function parseStaffMarker(text: string): StaffMarker | null {
  const match = text.match(/\[\[NIUMA_STAFF id="([^"]+)" child="([^"]+)" state="([^"]+)"\]\]/)
  return match ? { staffId: match[1], childId: match[2], state: match[3] } : null
}

function parseStaffMeeting(text: string): StaffMeeting | null {
  const marker = '[[NIUMA_MEETING state="done"]]'
  const position = text.indexOf(marker)
  if (position < 0) return null
  try {
    const value = JSON.parse(text.slice(position + marker.length).trim())
    return value?.kind === 'meeting' && Array.isArray(value.turns) ? value as StaffMeeting : null
  } catch {
    return null
  }
}

function isRouterOnlyMessage(text: string): boolean {
  const value = text.trim()
  return /^\[NIUMA_(?:RELAY|DIRECT)_ACK\]$/.test(value)
    || /^(?:已接通|消息已转交给).*(?:独立子代理|本人回复|等.*回复)/.test(value)
    || /^老板已直连 .*?(?:正在处理|等待本人回复)/.test(value)
}

function isStaffRoutingAssistant(node: any): boolean {
  return Array.isArray(node?.blocks) && node.blocks.some((block: any) => block?.kind === 'tool-call' && (block.name === 'staff_chat' || block.name === 'staff_meeting'))
}

function messageSource(node: any): any {
  return node?.source || node?.message?.source || node?.data?.source
}

function staffChildIndex(nodes: any[]): Map<string, StaffMarker> {
  const index = new Map<string, StaffMarker>()
  for (const node of nodes || []) {
    if (node?.kind !== 'tool-result') continue
    const parsed = parseStaffMarker(extractText(node.content))
    if (parsed) index.set(parsed.childId, parsed)
  }
  return index
}

function settledChildIds(nodes: any[]): Set<string> {
  const ids = new Set<string>()
  for (const node of nodes || []) {
    const source = messageSource(node)
    if (source?.kind === 'subagent-settled' && source.senderSessionId) ids.add(String(source.senderSessionId))
    const event = settlementEvent(node)
    if (event) ids.add(event.childId)
  }
  return ids
}

function cleanStaffResult(text: string): string {
  return text
    .replace(/\[\[NIUMA_STAFF[^\]]+\]\]\s*/g, '')
    .replace(/^[^\n]*回复：\s*/u, '')
    .trim()
}

function cleanSettlementReply(text: string): string {
  const marker = 'Its closing message:'
  const position = text.indexOf(marker)
  if (position >= 0) return text.slice(position + marker.length).trim()
  return text
    .replace(/^Background subagent[^\n]*\n?/i, '')
    .replace(/^It left no closing message\.?/i, '员工本轮没有留下回复。')
    .trim()
}

function settlementEvent(node: any): { childId: string; reply: string } | null {
  const text = extractText(node?.content)
  const match = text.match(/^Background subagent\s+([^\s]+)\s+finished[\s\S]*?Its closing message:\s*([\s\S]*)$/i)
  return match ? { childId: match[1], reply: match[2].trim() } : null
}

function settlementMaterial(text: string): { text: string; reasoning: string } {
  const reply = cleanSettlementReply(text)
  const starts = ['\n老板，', '\n老板：', '\n收到，', '\n好的，', '\n我负责']
    .map((token) => reply.lastIndexOf(token))
    .filter((position) => position > 80)
  const start = starts.length ? Math.max(...starts) + 1 : -1
  return start > 0
    ? { reasoning: reply.slice(0, start).trim(), text: reply.slice(start).trim() }
    : { reasoning: '', text: reply }
}

function extractDelegations(nodes: any[], runningCalls: any[], roles: RoleDef[], staff: StaffDef[]): Delegation[] {
  const calls: Record<string, { name: string; args: Record<string, any>; startTime: number | null }> = {}
  const results: Record<string, { text: string; isError: boolean; endTime: number | null }> = {}
  for (const n of nodes || []) {
    if (n && n.kind === 'assistant' && Array.isArray(n.blocks)) {
      for (const b of n.blocks as any[]) {
        if (b && b.kind === 'tool-call' && b.callId) calls[b.callId] = { name: b.name, args: parseArgs(b.argsRaw), startTime: nodeTime(n) }
      }
    } else if (n && n.kind === 'tool-result' && n.callId) {
      results[n.callId] = { text: extractText(n.content), isError: !!n.isError, endTime: nodeTime(n) }
      if (n.call && !calls[n.callId]) calls[n.callId] = { name: n.call.name, args: parseArgs(n.call.argsRaw), startTime: nodeTime(n) }
    }
  }
  for (const rc of runningCalls || []) {
    if (rc && rc.callId && !calls[rc.callId]) calls[rc.callId] = { name: rc.name, args: parseArgs(rc.argsRaw), startTime: nodeTime(rc) }
  }
  const out: Delegation[] = []
  const settled = settledChildIds(nodes)
  for (const callId of Object.keys(calls)) {
    const c = calls[callId]
    if (!isDispatchTool(c.name)) continue
    const res = results[callId]
    if (c.name === 'staff_meeting') {
      const participantIds = Array.isArray(c.args?.staff) ? c.args.staff.map(String) : []
      const meetingDesc = clip(c.args?.topic || '员工短会', 160)
      const meetingSummary = res ? summarizeResult(res.text) : { lead: '', points: [] }
      for (const participantId of participantIds) {
        const participant = staffOf(participantId, staff)
        if (!participant) continue
        out.push({ callId: `${callId}:${participantId}`, tool: c.name, desc: meetingDesc, running: !res, isError: res ? res.isError : false, lead: meetingSummary.lead, points: meetingSummary.points, startTime: c.startTime, endTime: res ? res.endTime : null, duration: c.startTime && res && res.endTime ? Math.max(0, res.endTime - c.startTime) : null, roleId: participant.roleId || participant.id, staffId: participant.id })
      }
      continue
    }
    const rawDesc = c.name === 'staff_chat'
      ? (c.args?.message || '')
      : c.name === 'workflow'
      ? (c.args?.meta?.name || c.args?.name || c.args?.description || '')
      : (c.args?.description || c.args?.prompt || c.args?.task || c.args?.instruction || '')
    const desc = clip(rawDesc || '(未命名任务)', 160)
    const summary = res ? summarizeResult(res.text) : { lead: '', points: [] }
    const explicitStaff = c.name === 'staff_chat' && typeof c.args?.staff === 'string' ? c.args.staff : ''
    const roleId = explicitStaff ? (staffOf(explicitStaff, staff)?.roleId || explicitStaff) : assignRoleId(rawDesc, c.name, c.args, roles, staff)
    const staffId = explicitStaff || staffForRole(roleId, staff)
    const staffMarker = res ? parseStaffMarker(res.text) : null
    const waitingForEmployee = c.name === 'staff_chat' && !!staffMarker && staffMarker.state === 'accepted' && !settled.has(staffMarker.childId)
    out.push({
      callId, tool: c.name, desc,
      running: !res || waitingForEmployee,
      isError: res ? res.isError : false,
      lead: summary.lead, points: summary.points,
      startTime: c.startTime, endTime: res ? res.endTime : null,
      duration: c.startTime && res && res.endTime ? Math.max(0, res.endTime - c.startTime) : null,
      roleId, staffId,
    })
  }
  return out
}

function assignRoleId(desc: string, tool: string, args: Record<string, any>, roles: RoleDef[], staff: StaffDef[]): string {
  const text = ` ${desc || ''} ${args?.description || ''} ${args?.prompt || ''} ${args?.meta?.name || ''} ${args?.agent || ''} ${args?.role || ''} `.toLowerCase()
  for (const st of staff) {
    if ((st.aliases || []).some((a) => a && text.includes(a.toLowerCase()))) return st.roleId || st.id
  }
  if (args?.role && typeof args.role === 'string') {
    const hit = roles.find((r) => r.id === args.role || (r.keywords || []).some((k) => args.role.toLowerCase().includes(k)))
    if (hit) return hit.id
  }
  let best = roles[0]?.id || 'tech-lead'
  let bestScore = -1
  for (const role of roles) {
    let score = 0
    for (const k of role.keywords || []) {
      if (text.includes(k.toLowerCase())) score += k.length
    }
    if ((role.tools || []).includes(tool)) score += 2
    if (score > bestScore) { bestScore = score; best = role.id }
  }
  return best
}

function staffForRole(roleId: string, staff: StaffDef[]): string {
  const hit = staff.find((s) => s.roleId === roleId || s.id === roleId)
  return hit ? hit.id : (staff[0]?.id || roleId)
}

function roleOf(id: string, roles: RoleDef[]): RoleDef {
  return roles.find((r) => r.id === id) || { id, tools: [], skills: [] }
}

function staffOf(id: string, staff: StaffDef[]): StaffDef | undefined {
  return staff.find((s) => s.id === id || s.roleId === id)
}

function tasksFor(staffId: string, delegations: Delegation[]): Delegation[] {
  return delegations.filter((d) => d.staffId === staffId || d.roleId === staffId)
}

function statusFromTasks(tasks: Delegation[]): string {
  if (tasks.some((t) => t.running)) return 'running'
  if (tasks.some((t) => t.isError)) return 'wait'
  if (tasks.some((t) => !t.running && !t.isError)) return 'done'
  return 'idle'
}

function lineOf(staff: StaffDef | undefined, status: string, tick: number): string {
  const arr = status === 'idle' ? undefined : staff?.lines?.[status]
  if (arr && arr.length > 0) return arr[tick % arr.length]
  const fallback: Record<string, string> = {
    idle: '待命中：等真实派活',
    running: '干活中：进度见任务卡',
    done: '已交付：结果见任务卡',
    wait: '卡住了：等待处理',
  }
  return fallback[status] || fallback.idle
}

function formatDuration(ms: number | null): string {
  if (ms == null || isNaN(ms)) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return s + ' 秒'
  const m = Math.floor(s / 60)
  if (m < 60) return m + ' 分 ' + (s % 60) + ' 秒'
  return Math.floor(m / 60) + ' 小时'
}

function formatAgo(time: number | null): string {
  if (time == null) return ''
  const ms = Date.now() - time
  if (ms < 0) return '刚刚'
  const s = Math.round(ms / 1000)
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return m + ' 分钟前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时前'
  return Math.floor(h / 24) + ' 天前'
}

function bossLine(requests: string[], delegations: Delegation[], staff: StaffDef[]): string {
  if (delegations.length === 0) return requests.length > 0 ? '秘书已收到消息，正在判断是直接回复还是召集对应员工。' : '赛博公司已开门：秘书在前台，全员到岗，等老板下达第一条业务指令。'
  const req = requests.length > 0 ? clip(requests[requests.length - 1], 48) : ''
  const running = delegations.filter((d) => d.running)
  const done = delegations.filter((d) => !d.running && !d.isError)
  const error = delegations.filter((d) => d.isError)
  const parts = [`收到需求${req ? '「' + req + '」' : ''}，拆了 ${delegations.length} 个活`]
  const name = (d: Delegation) => staffOf(d.staffId, staff)?.name || '员工'
  if (running.length) parts.push(running.length + ' 个在干：' + running.map((d) => name(d) + '·' + clip(d.desc, 14)).join('、'))
  if (done.length) parts.push(done.length + ' 个已交付：' + done.map((d) => name(d) + '·' + clip(d.desc, 14)).join('、'))
  if (error.length) parts.push(error.length + ' 个卡住：' + error.map((d) => name(d) + '·' + clip(d.desc, 14)).join('、'))
  return parts.join('；')
}

function systemEvents(delegations: Delegation[], staff: StaffDef[]): string[] {
  const events: string[] = []
  if (delegations.length) events.push('👑 老板派了 ' + delegations.length + ' 个活')
  for (const d of delegations) {
    const name = staffOf(d.staffId, staff)?.name || '员工'
    if (!d.running && !d.isError) events.push('✅ ' + name + ' 交付了：' + clip(d.desc, 18))
    else if (d.isError) events.push('⚠️ ' + name + ' 卡住了：' + clip(d.desc, 18))
    else events.push('🔨 ' + name + ' 正在干：' + clip(d.desc, 18))
  }
  return events.slice(0, 8)
}

function dispatchTemplate(staff: StaffDef | undefined): string {
  if (!staff) return ''
  return `@${staff.name} `
}

function BriefBanner(props: { text: string; companyName: string; delegationCount: number }) {
  return createElement('div', { className: 'dsh-org-brief' },
    createElement('span', { className: 'dsh-org-brief-mark', 'aria-hidden': true }, '✦'),
    createElement('div', { className: 'dsh-org-brief-copy' },
      createElement('div', { className: 'dsh-org-brief-label' }, props.companyName + ' · 今日经营简报'),
      createElement('div', { className: 'dsh-org-brief-text' }, props.text),
    ),
    createElement('div', { className: 'dsh-org-brief-tail' }, props.delegationCount ? props.delegationCount + ' 条真实业务' : '公司已开门，等待老板指令'),
  )
}

function OrganizationChart(props: { staff: StaffDef[] }) {
  const departments = ['总裁办', '管理层', '人才与文化', '产品研发部', '市场与知识部']
  return createElement('section', { className: 'dsh-org-orgchart', 'aria-label': '赛博公司组织架构' },
    createElement('div', { className: 'dsh-org-orgchart-boss' },
      createElement('strong', null, '老板 / 董事长'),
      createElement('span', null, '最终决策、预算审批、直接点名'),
    ),
    createElement('div', { className: 'dsh-org-orgchart-units' }, departments.map((department) => {
      const members = props.staff.filter((item) => (item.department || '未分组') === department)
      return createElement('div', { className: 'dsh-org-orgchart-unit', key: department },
        createElement('strong', null, department),
        createElement('span', null, members.length ? members.map((item) => item.name).join(' · ') : '待招聘'),
      )
    })),
  )
}

type OfficePlacement = { x: string; y: string; activity: string; walking: boolean }

type OfficeRoutine = {
  home: OfficePlacement
  away: OfficePlacement
  staying: string
  offset: number
}

const OFFICE_ROUTINES: Record<string, OfficeRoutine> = {
  secretary: { home: { x: '13cqw', y: '51cqh', activity: '前台值班', walking: false }, away: { x: '78cqw', y: '51cqh', activity: '去会议室通知大家', walking: true }, staying: '在会议室同步安排', offset: 0 },
  'tech-lead': { home: { x: '47cqw', y: '49cqh', activity: '经理工位看排期', walking: false }, away: { x: '82cqw', y: '51cqh', activity: '去会议室开站会', walking: true }, staying: '在会议室主持站会', offset: 3 },
  recruiter: { home: { x: '31cqw', y: '49cqh', activity: '招聘工位筛简历', walking: false }, away: { x: '86cqw', y: '51cqh', activity: '带候选人去面试间', walking: true }, staying: '正在面试候选人', offset: 6 },
  developer: { home: { x: '47cqw', y: '73cqh', activity: '开发工位写代码', walking: false }, away: { x: '84cqw', y: '79cqh', activity: '去茶水间接咖啡', walking: true }, staying: '在茶水间等咖啡', offset: 9 },
  pm: { home: { x: '63cqw', y: '49cqh', activity: '产品工位整理需求', walking: false }, away: { x: '79cqw', y: '51cqh', activity: '去会议室对需求', walking: true }, staying: '在会议室过需求', offset: 12 },
  platform: { home: { x: '31cqw', y: '73cqh', activity: '平台工位看监控', walking: false }, away: { x: '8cqw', y: '80cqh', activity: '去洗手间', walking: true }, staying: '暂时离开工位', offset: 15 },
  researcher: { home: { x: '63cqw', y: '73cqh', activity: '调研工位查资料', walking: false }, away: { x: '16cqw', y: '80cqh', activity: '去阳台透气', walking: true }, staying: '在阳台整理思路', offset: 5 },
  doc: { home: { x: '56cqw', y: '73cqh', activity: '文档工位整理知识库', walking: false }, away: { x: '88cqw', y: '76cqh', activity: '去休息区放风', walking: true }, staying: '在沙发校对文档', offset: 11 },
}

function officePlacement(item: StaffDef, status: string, index: number, tick: number, task?: Delegation): OfficePlacement {
  const routine = OFFICE_ROUTINES[item.id] || OFFICE_ROUTINES[item.roleId] || {
    home: { x: `${30 + (index % 3) * 16}cqw`, y: `${49 + Math.floor(index / 3) * 24}cqh`, activity: '固定工位待命', walking: false },
    away: { x: '84cqw', y: '79cqh', activity: '去茶水间接水', walking: true },
    staying: '在茶水间短暂休息',
    offset: index * 2,
  }
  if (status === 'running' && task?.tool === 'staff_meeting') return { x: `${78 + (index % 3) * 5}cqw`, y: `${50 + Math.floor(index / 3) * 6}cqh`, activity: '在会议室与同事讨论', walking: false }
  if (status === 'running') return { ...routine.home, activity: routine.home.activity.replace(/看排期|筛简历|写代码|整理需求|看监控|查资料|整理知识库|值班/, '处理真实任务') }
  if (status === 'wait') return { x: '81cqw', y: '53cqh', activity: '在会议室等待决策', walking: false }
  const phase = (tick + routine.offset) % 18
  if (phase <= 11) return status === 'done' ? { ...routine.home, activity: '在工位整理交付' } : routine.home
  if (phase === 12) return routine.away
  if (phase <= 14) return { ...routine.away, activity: routine.staying, walking: false }
  if (phase === 15) return { ...routine.home, activity: '按固定路线返回工位', walking: true }
  return routine.home
}

function PixelOffice(props: {
  companyName: string
  staff: StaffDef[]
  statuses: Record<string, string>
  tasksMap: Record<string, Delegation[]>
  tick: number
  now: Date
  activeStaffId: string | null
  onSelect: (id: string) => void
  onTalk: (staff: StaffDef) => void
}) {
  const { companyName, staff, statuses, tasksMap, tick, now, activeStaffId, onSelect, onTalk } = props
  const statusCounts = staff.reduce<Record<string, number>>((acc, item) => {
    const status = statuses[item.id] || 'idle'
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {})
  const officeStaff = [...staff].sort((a, b) => {
    const order: Record<string, number> = { running: 0, wait: 1, done: 2, idle: 3 }
    return (order[statuses[a.id] || 'idle'] ?? 3) - (order[statuses[b.id] || 'idle'] ?? 3)
  })
  return createElement('section', { className: 'dsh-org-office-shell', 'aria-label': companyName + ' 像素办公室' },
    createElement('div', { className: 'dsh-org-office-header' },
      createElement('div', { className: 'dsh-org-office-heading' },
        createElement('span', { className: 'dsh-org-office-title' }, '办公室状态'),
        createElement('span', { className: 'dsh-org-office-caption' }, '实时状态侧栏 · 工作、会议、离席'),
      ),
      createElement('div', { className: 'dsh-org-office-legend', 'aria-label': '员工状态图例' },
        createElement('span', { className: 'dsh-org-legend' }, createElement('i', { className: 'dsh-org-legend-dot running' }), '干活'),
        createElement('span', { className: 'dsh-org-legend' }, createElement('i', { className: 'dsh-org-legend-dot done' }), '交付'),
        createElement('span', { className: 'dsh-org-legend' }, createElement('i', { className: 'dsh-org-legend-dot wait' }), '卡住'),
        createElement('span', { className: 'dsh-org-legend' }, createElement('i', { className: 'dsh-org-legend-dot' }), '待命'),
      ),
    ),
    createElement('div', { className: 'dsh-org-office-canvas', 'aria-label': '办公室实时状态地图' },
      createElement('div', { className: 'dsh-org-office-wall', 'aria-hidden': true }),
      createElement('div', { className: 'dsh-org-office-floor', 'aria-hidden': true }),
      createElement('div', { className: 'dsh-org-office-window', 'aria-hidden': true }),
      createElement('time', { className: 'dsh-org-wall-clock', dateTime: now.toISOString(), 'aria-label': '办公室当前时间' }, now.toLocaleTimeString('zh-CN', { hour12: false })),
      createElement('div', { className: 'dsh-org-company-board' },
        createElement('strong', null, companyName),
        createElement('span', null, '努力赚钱，拒绝内耗；需求可以变，工资不能欠'),
      ),
      createElement('div', { className: 'dsh-org-hours-board' },
        createElement('strong', null, '赛博公司作息'), createElement('br'),
        '09:30 上班打卡 · 12:00 吃饭', createElement('br'),
        '13:30 继续搬砖 · 18:30 原则下班', createElement('br'),
        '加班规则：先问老板有没有预算',
      ),
      createElement('div', { className: 'dsh-org-office-room reception', 'aria-hidden': true }),
      createElement('div', { className: 'dsh-org-office-room work', 'aria-hidden': true }),
      createElement('div', { className: 'dsh-org-office-room meeting', 'aria-hidden': true }),
      createElement('div', { className: 'dsh-org-office-room lounge', 'aria-hidden': true }),
      createElement('div', { className: 'dsh-org-office-room restroom', 'aria-hidden': true }),
      createElement('div', { className: 'dsh-org-office-room balcony', 'aria-hidden': true }),
      createElement('div', { className: 'dsh-org-office-label reception' }, '前台 / 总裁办'),
      createElement('div', { className: 'dsh-org-office-label work' }, '产品研发开放工区'),
      createElement('div', { className: 'dsh-org-office-label meeting' }, '会议室 / 面试间'),
      createElement('div', { className: 'dsh-org-office-label lounge' }, '茶水间 / 摸鱼区'),
      createElement('div', { className: 'dsh-org-office-label restroom' }, '洗手间'),
      createElement('div', { className: 'dsh-org-office-label balcony' }, '抽烟阳台'),
      ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].map((desk) => createElement('div', { className: 'dsh-org-furniture desk ' + desk, key: desk, 'aria-hidden': true })),
      createElement('div', { className: 'dsh-org-furniture frontdesk', 'aria-hidden': true }),
      createElement('div', { className: 'dsh-org-furniture meeting-table', 'aria-hidden': true }),
      createElement('div', { className: 'dsh-org-furniture sofa', 'aria-hidden': true }),
      createElement('div', { className: 'dsh-org-furniture coffee', 'aria-hidden': true }),
      createElement('div', { className: 'dsh-org-furniture restroom-door', 'aria-hidden': true }),
      createElement('div', { className: 'dsh-org-furniture smoke', 'aria-hidden': true }),
      createElement('div', { className: 'dsh-org-office-plant p1', 'aria-hidden': true }),
      createElement('div', { className: 'dsh-org-office-plant p2', 'aria-hidden': true }),
      officeStaff.map((item, index) => {
        const status = statuses[item.id] || 'idle'
        const tasks = tasksMap[item.id] || []
        const task = tasks.find((entry) => entry.running) || tasks[tasks.length - 1]
        const placement = officePlacement(item, status, index, tick, task)
        return createElement('button', {
          type: 'button',
          key: item.id,
          className: 'dsh-org-avatar staff-' + item.id + ' status-' + status + (placement.walking ? ' walking' : '') + (activeStaffId === item.id ? ' active' : ''),
          style: { '--avatar-x': placement.x, '--avatar-y': placement.y } as any,
          title: item.name + ' · ' + placement.activity + (task ? ' · ' + task.desc : ''),
          'aria-label': item.name + '，' + item.role + '，' + (STATUS_LABEL[status] || STATUS_LABEL.idle),
          onClick: () => onSelect(item.id),
          onDoubleClick: () => onTalk(item),
        },
          createElement('span', { className: 'dsh-org-avatar-shadow', 'aria-hidden': true }),
          createElement('span', { className: 'dsh-org-avatar-head', 'aria-hidden': true }, createElement('span', { className: 'dsh-org-avatar-eyes' })),
          createElement('span', { className: 'dsh-org-avatar-body', 'aria-hidden': true }),
          createElement('span', { className: 'dsh-org-avatar-legs', 'aria-hidden': true }),
          createElement('span', { className: 'dsh-org-avatar-accessory', 'aria-hidden': true }),
          createElement('span', { className: 'dsh-org-avatar-name' }, item.name),
          createElement('span', { className: 'dsh-org-avatar-state' }, placement.activity),
          activeStaffId === item.id ? createElement('span', { className: 'dsh-org-avatar-speech' }, task ? clip(task.desc, 24) : `双击和${item.name}说话`) : null,
        )
      }),
    ),
    createElement('div', { className: 'dsh-org-office-compact', 'aria-label': '员工紧凑状态列表' },
      createElement('div', { className: 'dsh-org-office-compact-head' }, '员工在岗', createElement('span', null, staff.length + ' 人 · 双击直聊')),
      officeStaff.map((item) => {
        const status = statuses[item.id] || 'idle'
        const tasks = tasksMap[item.id] || []
        const task = tasks.find((entry) => entry.running) || tasks[tasks.length - 1]
        return createElement('button', {
          type: 'button',
          key: 'compact-' + item.id,
          className: 'dsh-org-office-compact-row ' + status + (activeStaffId === item.id ? ' active' : ''),
          onClick: () => onSelect(item.id),
          onDoubleClick: () => onTalk(item),
          title: item.name + ' · ' + (task ? task.desc : item.role),
        },
          createElement('span', { className: 'dsh-org-office-compact-avatar', 'aria-hidden': true }, item.emoji),
          createElement('span', { className: 'dsh-org-office-compact-copy' },
            createElement('strong', null, item.name),
            createElement('small', null, item.role),
          ),
          createElement('span', { className: 'dsh-org-office-compact-state' }, (STATUS_LABEL[status] || STATUS_LABEL.idle) + ' · ' + (task ? clip(task.desc, 20) : lineOf(item, status, 0))),
        )
      }),
    ),
    createElement('div', { className: 'dsh-org-office-footer' },
      createElement('span', null, createElement('strong', null, statusCounts.running || 0), ' 人正在干活 · ', createElement('strong', null, statusCounts.wait || 0), ' 人在等处理'),
      createElement('span', null, now.toLocaleDateString('zh-CN', { weekday: 'short', month: '2-digit', day: '2-digit' }) + ' · 单击看状态 · 双击直接 @ 本人'),
    ),
  )
}

function RosterPanel(props: {
  staff: StaffDef[]
  visibleStaff: StaffDef[]
  statuses: Record<string, string>
  tasksMap: Record<string, Delegation[]>
  activeStaffId: string | null
  focusStaff: string | null
  filter: string
  query: string
  onFilter: (id: string) => void
  onQuery: (value: string) => void
  onSelect: (id: string) => void
  onOpenProfile: (staff: StaffDef) => void
  onTalk: (staff: StaffDef) => void
  onClearFocus: () => void
}) {
  const { staff, visibleStaff, statuses, tasksMap, activeStaffId, focusStaff, filter, query, onFilter, onQuery, onSelect, onOpenProfile, onTalk, onClearFocus } = props
  const activeStaff = activeStaffId ? staffOf(activeStaffId, staff) : undefined
  const departmentOrder = ['总裁办', '管理层', '人才与文化', '产品研发部', '市场与知识部', '未分组']
  const groupedStaff = departmentOrder
    .map((department) => ({ department, members: visibleStaff.filter((item) => (item.department || '未分组') === department) }))
    .filter((group) => group.members.length)
  return createElement('aside', { className: 'dsh-org-panel dsh-org-roster', 'aria-label': '员工列表' },
    createElement('div', { className: 'dsh-org-panel-header' },
      createElement('span', { className: 'dsh-org-panel-title' }, '员工通讯录'),
      createElement('span', { className: 'dsh-org-panel-caption' }, staff.length + ' 人'),
    ),
    createElement('div', { className: 'dsh-org-roster-tools' },
      createElement('label', { className: 'dsh-org-search' },
        createElement('span', { className: 'dsh-org-search-icon', 'aria-hidden': true }, '⌕'),
        createElement('input', { value: query, onChange: (e: any) => onQuery(e.target.value), placeholder: '搜索员工或任务', 'aria-label': '搜索员工或任务' }),
      ),
      createElement('div', { className: 'dsh-org-filter-strip', role: 'group', 'aria-label': '筛选员工状态' },
        FILTERS.map((item) => createElement('button', {
          type: 'button', key: item.id, className: 'dsh-org-filter' + (filter === item.id ? ' active' : ''),
          'aria-pressed': filter === item.id, onClick: () => onFilter(item.id),
        }, item.label)),
      ),
    ),
    createElement('div', { className: 'dsh-org-roster-list' },
      visibleStaff.length === 0 ? createElement('div', { className: 'dsh-org-roster-empty' }, '没有匹配的员工或任务') : groupedStaff.map((group) => createElement('section', { className: 'dsh-org-roster-department', key: group.department, 'aria-label': group.department },
        createElement('div', { className: 'dsh-org-roster-department-title' }, group.department, createElement('span', null, group.members.length + ' 人')),
        group.members.map((item) => {
          const status = statuses[item.id] || 'idle'
          const task = (tasksMap[item.id] || [])[0]
          return createElement('button', {
            type: 'button', key: item.id,
            className: 'dsh-org-roster-row ' + status + (activeStaffId === item.id ? ' active' : ''),
            'aria-pressed': activeStaffId === item.id,
            onClick: () => onSelect(item.id),
            onDoubleClick: () => onTalk(item),
          },
            createElement('span', { className: 'dsh-org-roster-avatar ' + status }, item.emoji, createElement('i', { className: 'dsh-org-status-dot ' + status, 'aria-hidden': true })),
            createElement('span', { className: 'dsh-org-roster-copy' },
              createElement('span', { className: 'dsh-org-roster-name' }, item.name, createElement('small', { className: 'dsh-org-roster-report' }, ' · 向' + (item.reportsTo || '老板') + '汇报')),
              createElement('span', { className: 'dsh-org-roster-role' }, item.role),
              createElement('span', { className: 'dsh-org-roster-task' }, task ? task.desc : lineOf(item, status, 0)),
            ),
            createElement('span', { className: 'dsh-org-roster-state' }, STATUS_LABEL[status] || STATUS_LABEL.idle),
          )
        }),
      )),
    ),
    createElement('div', { className: 'dsh-org-roster-footer' }, focusStaff
      ? createElement('span', null, '正在聚焦 ', staffOf(focusStaff, staff)?.name || '员工', createElement('button', { type: 'button', className: 'dsh-org-clear-focus', onClick: onClearFocus }, '清除'))
      : activeStaff
        ? createElement('div', { className: 'dsh-org-roster-footer-actions' },
            createElement('span', null, activeStaff.name + ' 已选中'),
            createElement('button', { type: 'button', onClick: () => onOpenProfile(activeStaff) }, '打开档案'),
            createElement('button', { type: 'button', onClick: () => onTalk(activeStaff) }, '直接 @TA'),
          )
        : '单击定位员工 · 双击直接 @ 本人',
    ),
  )
}

function TaskRow(props: { task: Delegation; staff: StaffDef | undefined }) {
  const t = props.task
  const [open, setOpen] = useState(false)
  const st = t.running ? 'running' : t.isError ? 'wait' : 'done'
  const meta: string[] = []
  if (!t.running && t.duration) meta.push('用时 ' + formatDuration(t.duration))
  else if (!t.running && t.endTime) meta.push(formatAgo(t.endTime))
  else if (t.running && t.startTime) meta.push(formatAgo(t.startTime) + ' 开始')
  return createElement('div', { className: 'dsh-org-task' },
    createElement('div', { className: 'dsh-org-task-head' },
      createElement('span', { className: 'dsh-org-task-desc' }, t.desc),
      createElement('span', { className: 'dsh-org-chip', style: { color: STATUS_COLOR[st] } }, STATUS_LABEL[st]),
    ),
    t.running ? createElement('div', { className: 'dsh-org-progress' }, createElement('div', { className: 'dsh-org-progress-bar' })) : null,
    meta.length ? createElement('div', { className: 'dsh-org-task-meta' }, meta.join(' · ')) : null,
    open && t.lead ? createElement('div', { className: 'dsh-org-task-lead' }, '📦 ' + t.lead) : null,
    open && t.points.length ? createElement('div', { className: 'dsh-org-task-points' }, t.points.map((p, i) => createElement('div', { className: 'dsh-org-task-point', key: i }, '· ' + p))) : null,
    (t.lead || t.points.length) ? createElement('button', {
      type: 'button', className: 'dsh-org-task-toggle',
      onClick: (e: any) => { e.stopPropagation(); setOpen((v) => !v) },
    }, open ? '收起交付摘要' : '查看交付摘要') : null,
  )
}

function StaffCard(props: {
  staff: StaffDef; tasks: Delegation[]; status: string; tick: number; index: number;
  query: string; onOpen: (s: StaffDef) => void
}) {
  const { staff, tasks, status, tick, index, query, onOpen } = props
  const q = query.trim().toLowerCase()
  const shownTasks = q ? tasks.filter((t) => t.desc.toLowerCase().includes(q) || t.lead.toLowerCase().includes(q)) : tasks
  const st = STATUS_LABEL[status] || STATUS_LABEL.idle
  const color = STATUS_COLOR[status] || STATUS_COLOR.idle
  const dimmed = !!q && shownTasks.length === 0 && !(staff.name + staff.role).toLowerCase().includes(q)
  return createElement('div', { className: 'dsh-org-staff-card ' + status + (dimmed ? ' dimmed' : ''), onClick: () => onOpen(staff) },
    createElement('div', { className: 'dsh-org-staff-top' },
      createElement('span', { className: 'dsh-org-staff-emoji' }, staff.emoji),
      createElement('div', { className: 'dsh-org-staff-id' },
        createElement('div', { className: 'dsh-org-staff-name' }, staff.name),
        createElement('div', { className: 'dsh-org-staff-role' }, staff.role),
      ),
      createElement('span', { className: 'dsh-org-chip', style: { color } }, st),
    ),
    shownTasks.length ? shownTasks.slice(0, 3).map((t) => createElement(TaskRow, { key: t.callId, task: t, staff }))
      : createElement('div', { className: 'dsh-org-staff-bubble' }, lineOf(staff, status, tick + index)),
    createElement('div', { className: 'dsh-org-staff-hint' }, tasks.length ? '点击看档案 · ' + tasks.length + ' 个任务' : '点击看档案'),
  )
}

function formatClock(time: number | null): string {
  if (time == null) return ''
  try { return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

function assistantMaterial(blocks: any[]): { text: string; reasoning: string; images: number } {
  const text: string[] = []
  const reasoning: string[] = []
  let images = 0
  for (const block of blocks || []) {
    if (block?.kind === 'text' && typeof block.text === 'string' && block.text.trim()) text.push(block.text)
    else if (block?.kind === 'reasoning' && typeof block.text === 'string' && block.text.trim()) reasoning.push(block.text)
    else if (block?.kind === 'image') images++
  }
  return { text: text.join('\n').trim(), reasoning: reasoning.join('\n').trim(), images }
}

function AssistantFlowRow(props: { blocks: any[]; time: number | null; streaming?: boolean; interrupted?: boolean }) {
  const { blocks, time, streaming = false, interrupted = false } = props
  const material = assistantMaterial(blocks)
  if (isRouterOnlyMessage(material.text)) return null
  if (!material.text && !material.reasoning && !material.images && !streaming) return null
  return createElement('div', { className: 'dsh-org-flow-row assistant' },
    createElement('span', { className: 'dsh-org-flow-avatar', 'aria-hidden': true }, '秘'),
    createElement('div', { className: 'dsh-org-flow-message' },
      createElement('div', { className: 'dsh-org-flow-meta' },
        createElement('span', null, '秘书'),
        createElement('span', { className: 'dsh-org-flow-role-badge' }, '总裁秘书 · 主 Agent'),
        formatClock(time) ? createElement('span', null, formatClock(time)) : null,
        interrupted ? createElement('span', null, '已停止') : null,
      ),
      material.reasoning ? createElement('details', { className: 'dsh-org-reasoning', open: streaming || undefined },
        createElement('summary', null, streaming ? '正在思考' : '查看思考过程'),
        createElement('div', { className: 'dsh-org-reasoning-text' }, material.reasoning),
      ) : null,
      material.text || streaming ? createElement('div', { className: 'dsh-org-flow-bubble' },
        material.text || '正在组织回复',
        streaming ? createElement('span', { className: 'dsh-org-stream-caret', 'aria-hidden': true }) : null,
      ) : null,
      material.images ? createElement('div', { className: 'dsh-org-flow-notice-row' }, '生成了 ' + material.images + ' 个图片附件。') : null,
    ),
  )
}

function EmployeeFlowRow(props: { staff: StaffDef; text: string; reasoning?: string; time: number | null; status?: string }) {
  const { staff, text, reasoning, time, status } = props
  return createElement('div', { className: 'dsh-org-flow-row employee' },
    createElement('span', { className: 'dsh-org-flow-avatar', 'aria-hidden': true }, staff.emoji),
    createElement('div', { className: 'dsh-org-flow-message' },
      createElement('div', { className: 'dsh-org-flow-meta' },
        createElement('span', null, staff.name),
        createElement('span', { className: 'dsh-org-flow-role-badge' }, staff.role + ' · 独立子代理'),
        formatClock(time) ? createElement('span', null, formatClock(time)) : null,
        status ? createElement('span', null, status) : null,
      ),
      reasoning ? createElement('details', { className: 'dsh-org-reasoning' },
        createElement('summary', null, '查看员工思考过程'),
        createElement('div', { className: 'dsh-org-reasoning-text' }, reasoning),
      ) : null,
      createElement('div', { className: 'dsh-org-flow-bubble' }, text || '本轮没有留下文字回复。'),
    ),
  )
}

function DirectTypingRow(props: { staff: StaffDef }) {
  return createElement('div', { className: 'dsh-org-flow-dispatch dsh-org-flow-direct', role: 'status' },
    createElement('i', { 'aria-hidden': true }),
    createElement('span', null, `老板已直连 ${props.staff.name}，本人正在处理…`),
  )
}

function MeetingFlowRow(props: { meeting: StaffMeeting; staff: StaffDef[]; time: number | null }) {
  return createElement('section', { className: 'dsh-org-meeting', 'aria-label': '员工真实讨论' },
    createElement('div', { className: 'dsh-org-meeting-head' },
      createElement('strong', null, '会议室 · 员工真实讨论'),
      createElement('span', null, clip(props.meeting.topic, 72)),
    ),
    props.meeting.turns.map((turn, index) => {
      const employee = staffOf(turn.staffId, props.staff) || props.staff.find((item) => item.name === turn.staffName)
      return employee ? createElement(EmployeeFlowRow, { key: `${turn.staffId}-${index}`, staff: employee, text: turn.reply, time: props.time, status: index === props.meeting.turns.length - 1 ? '会议结论' : '会议发言' }) : null
    }),
  )
}

function ToolFlowRow(props: { node: any; running?: boolean }) {
  const { node, running = false } = props
  const call = running ? node : (node.call || {})
  const name = call.name || node.name || node.callId || '工具调用'
  const argsRaw = call.argsRaw || node.argsRaw || ''
  const result = running ? '' : extractText(node.content)
  const isError = !running && !!node.isError
  const duration = !running && node.callTime && node.time ? Math.max(0, node.time - node.callTime) : null
  const target = clip(argsRaw || result || node.callId || '', 92)
  return createElement('details', { className: 'dsh-org-trace ' + (running ? 'running' : isError ? 'error' : 'done') },
    createElement('summary', null,
      createElement('i', { className: 'dsh-org-trace-status', 'aria-hidden': true }),
      createElement('span', { className: 'dsh-org-trace-name' }, name),
      createElement('span', { className: 'dsh-org-trace-target' }, target || (running ? '执行中' : isError ? '执行失败' : '执行完成')),
      createElement('span', { className: 'dsh-org-trace-time' }, running ? '运行中' : (formatDuration(duration) || (isError ? '失败' : '完成'))),
    ),
    createElement('div', { className: 'dsh-org-trace-detail' },
      argsRaw ? createElement('div', null,
        createElement('div', { className: 'dsh-org-trace-label' }, '输入'),
        createElement('pre', { className: 'dsh-org-trace-code' }, argsRaw),
      ) : null,
      result ? createElement('div', null,
        createElement('div', { className: 'dsh-org-trace-label' }, isError ? '错误' : '输出'),
        createElement('pre', { className: 'dsh-org-trace-code' }, result),
      ) : null,
    ),
  )
}

function flowKind(node: any): 'chat' | 'trace' {
  if (messageSource(node)?.kind === 'subagent-settled') return 'chat'
  if (settlementEvent(node)) return 'chat'
  if (node?.kind === 'tool-result' && parseStaffMarker(extractText(node.content))) return 'chat'
  if (node?.kind === 'tool-result' && parseStaffMeeting(extractText(node.content))) return 'chat'
  return node?.kind === 'user' || node?.kind === 'steering' || node?.kind === 'assistant' ? 'chat' : 'trace'
}

function renderFlowNode(node: any, children: Map<string, StaffMarker>, staff: StaffDef[]) {
  const key = 'flow-' + String(node?.seq ?? ((node?.kind ?? node?.type ?? 'unknown') + '-' + (nodeTime(node) ?? 0)))
  if (node?.kind === 'user' || node?.kind === 'steering') {
    const source = messageSource(node)
    if (source?.kind === 'subagent-settled' && source.senderSessionId) {
      const routed = children.get(String(source.senderSessionId))
      const employee = routed ? staffOf(routed.staffId, staff) : undefined
      if (employee) return createElement(EmployeeFlowRow, { key, staff: employee, text: cleanSettlementReply(extractText(node.content)), time: nodeTime(node), status: '已回话' })
    }
    return createElement('div', { className: 'dsh-org-flow-row user', key },
      createElement('span', { className: 'dsh-org-flow-avatar', 'aria-hidden': true }, '朕'),
      createElement('div', { className: 'dsh-org-flow-message' },
        createElement('div', { className: 'dsh-org-flow-meta' }, createElement('span', null, node.kind === 'steering' ? '老板 · 追加指令' : '老板'), createElement('span', null, formatClock(nodeTime(node)))),
        createElement('div', { className: 'dsh-org-flow-bubble' }, extractText(node.content) || '（非文本消息）'),
      ),
    )
  }
  if (node?.kind === 'assistant') {
    if (isStaffRoutingAssistant(node)) return null
    const material = assistantMaterial(node.blocks || [])
    if (isRouterOnlyMessage(material.text) && !material.images) return null
    return createElement(AssistantFlowRow, { key, blocks: node.blocks || [], time: nodeTime(node), interrupted: !!node.interrupted })
  }
  const settled = settlementEvent(node)
  if (settled) {
    const routed = children.get(settled.childId)
    const employee = routed ? staffOf(routed.staffId, staff) : undefined
    if (employee) {
      const material = settlementMaterial(settled.reply)
      if (isRouterOnlyMessage(material.text)) return null
      return createElement(EmployeeFlowRow, { key, staff: employee, text: material.text, reasoning: material.reasoning, time: nodeTime(node), status: '本人回复' })
    }
  }
  if (node?.kind === 'tool-result') {
    const meeting = parseStaffMeeting(extractText(node.content))
    if (meeting) return createElement(MeetingFlowRow, { key, meeting, staff, time: nodeTime(node) })
    const routed = parseStaffMarker(extractText(node.content))
    if (routed) {
      const employee = staffOf(routed.staffId, staff)
      if (employee && routed.state === 'replied') return createElement(EmployeeFlowRow, { key, staff: employee, text: cleanStaffResult(extractText(node.content)), time: nodeTime(node), status: '已回复' })
      if (employee) return createElement(DirectTypingRow, { key, staff: employee })
    }
    return createElement(ToolFlowRow, { key, node })
  }
  if (node?.kind === 'context') return createElement('div', { className: 'dsh-org-flow-notice-row', key }, '上下文注入：' + (extractText(node.content) || node.provenance?.producer || '系统上下文'))
  if (node?.kind === 'command') return createElement('div', { className: 'dsh-org-flow-notice-row', key }, '命令 /' + (node.name || 'unknown') + (node.args || '') + ' · ' + (node.outcome?.kind || '执行中'))
  if (node?.kind === 'model-retry') return createElement('div', { className: 'dsh-org-flow-notice-row', key }, '模型请求重试：' + (node.message || node.reason || node.retryState || '等待重试'))
  if (node?.kind === 'turn-error') return createElement('div', { className: 'dsh-org-flow-notice-row error', role: 'alert', key }, '本轮执行失败：' + (node.message || node.code || '未知错误'))
  if (node?.kind === 'turn-max-tokens') return createElement('div', { className: 'dsh-org-flow-notice-row error', key }, '本轮达到最大输出长度，可在下方输入“继续”。')
  if (node?.kind === 'compaction') return createElement('details', { className: 'dsh-org-trace', key },
    createElement('summary', null, createElement('i', { className: 'dsh-org-trace-status', 'aria-hidden': true }), createElement('span', { className: 'dsh-org-trace-name' }, '上下文压缩'), createElement('span', { className: 'dsh-org-trace-target' }, node.shadowedItemCount ? '整理了 ' + node.shadowedItemCount + ' 条历史' : '已整理历史上下文')),
    node.summary ? createElement('div', { className: 'dsh-org-trace-detail' }, createElement('pre', { className: 'dsh-org-trace-code' }, node.summary)) : null,
  )
  return createElement('div', { className: 'dsh-org-flow-notice-row', key }, '会话事件：' + (node?.kind || node?.type || 'unknown'))
}

function latestDirectEmployee(nodes: any[], staff: StaffDef[]): StaffDef | null {
  for (let index = (nodes || []).length - 1; index >= 0; index--) {
    const node = nodes[index]
    if (node?.kind !== 'user' && node?.kind !== 'steering') continue
    if (messageSource(node)?.kind === 'subagent-settled') continue
    const text = extractText(node.content)
    return staff.find((employee) => employee.id !== 'secretary' && text.includes(`@${employee.name}`)) || null
  }
  return null
}

function ConversationFlow(props: {
  nodes: any[]
  partial: any
  runningCalls: any[]
  running: boolean
  promptError: any
  chatEnabled: boolean
  staff: StaffDef[]
  onDraft: (text: string) => void
}) {
  const { nodes, partial, runningCalls, running, promptError, chatEnabled, staff, onDraft } = props
  const [mode, setMode] = useState<FlowMode>('all')
  const bodyRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const recent = (nodes || []).slice(-120)
  const children = useMemo(() => staffChildIndex(nodes || []), [nodes])
  const directEmployee = useMemo(() => latestDirectEmployee(nodes || [], staff), [nodes, staff])
  const visible = mode === 'all' ? recent : recent.filter((node) => flowKind(node) === mode)
  const signature = `${nodes?.length || 0}:${extractText(partial?.blocks || []).length}:${runningCalls?.length || 0}:${running ? 1 : 0}`
  useEffect(() => {
    const el = bodyRef.current
    if (el && followRef.current) el.scrollTop = el.scrollHeight
  }, [signature, mode])
  const stateClass = promptError ? 'error' : running ? 'running' : ''
  const stateText = promptError ? '发送或停止失败' : running && directEmployee ? `${directEmployee.name} 正在处理` : running ? '秘书正在处理' : '会话在线'
  return createElement('section', { className: 'dsh-org-flow', 'aria-label': '当前会话工作流' },
    createElement('div', { className: 'dsh-org-flow-head' },
      createElement('div', { className: 'dsh-org-flow-title-wrap' },
        createElement('span', { className: 'dsh-org-flow-icon', 'aria-hidden': true }, '>_'),
        createElement('div', null,
          createElement('div', { className: 'dsh-org-flow-title' }, '赛博公司工作群'),
          createElement('span', { className: 'dsh-org-flow-notice' }, '点名直达本人；未点名由秘书接待；员工讨论由真实子代理依次发言'),
        ),
      ),
      createElement('span', { className: 'dsh-org-flow-state ' + stateClass }, '● ' + stateText),
    ),
    createElement('div', { className: 'dsh-org-flow-toolbar' },
      createElement('div', { className: 'dsh-org-flow-tabs', role: 'group', 'aria-label': '工作流筛选' },
        ([['all', '全部'], ['chat', '对话'], ['trace', '轨迹']] as Array<[FlowMode, string]>).map(([id, label]) => createElement('button', {
          type: 'button', key: id, className: 'dsh-org-flow-tab ' + (mode === id ? 'active' : ''), 'aria-pressed': mode === id, onClick: () => setMode(id),
        }, label)),
      ),
      chatEnabled ? createElement('div', { className: 'dsh-org-flow-prompts' },
        ['汇报当前进度', '谁在待命', '列出交付结果'].map((prompt) => createElement('button', { type: 'button', className: 'dsh-org-flow-prompt', key: prompt, onClick: () => onDraft(prompt) }, prompt)),
      ) : null,
    ),
    createElement('div', {
      className: 'dsh-org-flow-body', ref: bodyRef, role: 'log', 'aria-live': 'polite', 'aria-busy': running || undefined,
      onScroll: (e: any) => {
        const el = e.currentTarget as HTMLDivElement
        followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      },
    },
      visible.length === 0 && !partial && (!runningCalls || runningCalls.length === 0)
        ? createElement('div', { className: 'dsh-org-flow-empty' }, '赛博公司工作群已上线。使用页面底部唯一的原生输入框，@秘书或任意员工即可开始办公。')
        : null,
      visible.map((node) => renderFlowNode(node, children, staff)),
      mode !== 'chat' ? (runningCalls || []).map((node) => createElement(ToolFlowRow, { key: 'running-' + node.callId, node, running: true })) : null,
      mode !== 'trace' && partial ? (directEmployee ? createElement(DirectTypingRow, { key: 'partial-direct', staff: directEmployee }) : createElement(AssistantFlowRow, { key: 'partial', blocks: partial.blocks || [], time: Date.now(), streaming: true })) : null,
      promptError ? createElement('div', { className: 'dsh-org-flow-notice-row error', role: 'alert' }, (promptError.op === 'stop' ? '停止失败：' : '发送失败：') + (promptError.error?.message || promptError.error?.code || '未知错误')) : null,
    ),
  )
}

function ContextPanel(props: {
  staff: StaffDef[]
  statuses: Record<string, string>
  tasksMap: Record<string, Delegation[]>
  activeStaffId: string | null
  roles: RoleDef[]
  events: string[]
  onOpenProfile: (staff: StaffDef) => void
  onFocus: (id: string) => void
  onDraft: (text: string) => void
  onClose: () => void
}) {
  const { staff, statuses, tasksMap, activeStaffId, roles, events, onOpenProfile, onFocus, onDraft, onClose } = props
  const active = staffOf(activeStaffId || '', staff)
  if (!active) return createElement('aside', { className: 'dsh-org-context' })
  const status = statuses[active.id] || 'idle'
  const tasks = tasksMap[active.id] || []
  return createElement('aside', { className: 'dsh-org-context', 'aria-label': '任务上下文' },
    createElement('section', { className: 'dsh-org-context-card' },
      createElement('div', { className: 'dsh-org-panel-header' },
        createElement('span', { className: 'dsh-org-panel-title' }, '任务上下文'),
        createElement('button', { type: 'button', className: 'dsh-org-context-close', 'aria-label': '关闭员工上下文', onClick: onClose }, '×'),
      ),
      createElement('div', { className: 'dsh-org-context-identity' },
        createElement('div', { className: 'dsh-org-context-avatar' }, active.emoji),
        createElement('div', null,
          createElement('div', { className: 'dsh-org-context-name' }, active.name),
          createElement('div', { className: 'dsh-org-context-role' }, active.role),
          createElement('div', { className: 'dsh-org-context-state ' + status },
            createElement('i', { className: 'dsh-org-status-dot ' + status, 'aria-hidden': true }),
            STATUS_LABEL[status] || STATUS_LABEL.idle,
          ),
        ),
      ),
      createElement('div', { className: 'dsh-org-context-intro' }, active.intro),
      createElement('div', { className: 'dsh-org-context-actions' },
        createElement('button', { type: 'button', className: 'dsh-org-context-action secondary', onClick: () => onOpenProfile(active) }, '打开档案'),
        createElement('button', {
          type: 'button', className: 'dsh-org-context-action',
          onClick: () => onDraft(dispatchTemplate(active)),
        }, '点名派活'),
      ),
      createElement('div', { className: 'dsh-org-context-section' },
        createElement('div', { className: 'dsh-org-context-label' }, '当前任务', createElement('span', null, tasks.length + ' 条')),
        tasks.length ? tasks.slice(0, 4).map((task) => createElement(TaskRow, { key: task.callId, task, staff: active }))
          : createElement('div', { className: 'dsh-org-note' }, '暂无真实派活，员工正在待命。'),
      ),
      createElement('div', { className: 'dsh-org-context-foot' }, '技能：' + ((roleOf(active.roleId || active.id, roles).skills || []).map((skill) => skill.name).join('、') || '暂无记录'), createElement('br'), '点击“只看 TA”可把左侧列表收敛到该员工。',
        createElement('button', { type: 'button', className: 'dsh-org-clear-focus', onClick: () => onFocus(active.id) }, '只看 TA'),
      ),
    ),
    createElement('section', { className: 'dsh-org-activity-card' },
      createElement('div', { className: 'dsh-org-panel-header' },
        createElement('span', { className: 'dsh-org-panel-title' }, '最近播报'),
        createElement('span', { className: 'dsh-org-panel-caption' }, '真实事件'),
      ),
      events.length ? createElement('div', { className: 'dsh-org-activity-list' }, events.slice(0, 5).map((event, index) => createElement('div', { className: 'dsh-org-activity-item', key: index }, event)))
        : createElement('div', { className: 'dsh-org-note', style: { padding: '0 13px 13px' } }, '等待 DSH 产生第一条派活事件。'),
    ),
  )
}

function StaffDetail(props: {
  staff: StaffDef; status: string; tasks: Delegation[]; roles: RoleDef[];
  onClose: () => void; onFocus: (id: string) => void; onDraft: (text: string) => void
}) {
  const { staff, status, tasks, roles, onClose, onFocus, onDraft } = props
  const role = roleOf(staff.roleId || staff.id, roles)
  return createElement('div', { className: 'dsh-org-modal-mask', onClick: onClose },
    createElement('div', { className: 'dsh-org-modal', onClick: (e: any) => e.stopPropagation() },
      createElement('div', { className: 'dsh-org-modal-head' },
        createElement('span', { className: 'dsh-org-modal-emoji' }, staff.emoji),
        createElement('div', { className: 'dsh-org-modal-id' },
          createElement('div', { className: 'dsh-org-modal-name' }, staff.name),
          createElement('div', { className: 'dsh-org-modal-role' }, staff.role + ' · ' + (STATUS_LABEL[status] || STATUS_LABEL.idle)),
        ),
        createElement('button', { type: 'button', className: 'dsh-org-modal-close', 'aria-label': '关闭', onClick: onClose }, '✕'),
      ),
      createElement('div', { className: 'dsh-org-modal-body' },
        createElement('div', { className: 'dsh-org-modal-intro' }, staff.intro),
        createElement('div', { className: 'dsh-org-modal-label' }, '当前工位'),
        tasks.length ? tasks.slice(0, 3).map((t) => createElement(TaskRow, { key: t.callId, task: t, staff }))
          : createElement('div', { className: 'dsh-org-note' }, '暂无任务'),
        createElement('button', { type: 'button', className: 'dsh-org-focus-action', onClick: () => onFocus(staff.id) }, '只看 TA 的工位'),
        createElement('button', { type: 'button', className: 'dsh-org-focus-action', onClick: () => onDraft(dispatchTemplate(staff)) }, '点名到输入框'),
        createElement('div', { className: 'dsh-org-modal-label' }, '它会的能力'),
        role.tools.length ? createElement('div', { className: 'dsh-org-modal-tools' }, role.tools.map((t) => createElement('span', { className: 'dsh-org-tool', key: t }, t)))
          : createElement('div', { className: 'dsh-org-note' }, '暂无记录的工具'),
        createElement('div', { className: 'dsh-org-modal-label' }, '它会的方法'),
        role.skills.length ? role.skills.map((s) => createElement('div', { className: 'dsh-org-skill-row', key: s.name },
            createElement('div', { className: 'dsh-org-skill-name' }, s.name),
            s.desc ? createElement('div', { className: 'dsh-org-skill-desc' }, s.desc) : null,
          ))
          : createElement('div', { className: 'dsh-org-note' }, '暂无关联的技能'),
      ),
    ),
  )
}

function normalizeConfig(config?: OrgPanelConfig): Required<Pick<OrgPanelConfig, 'tabLabel' | 'companyName' | 'chatEnabled'>> & { roles: RoleDef[]; staff: StaffDef[] } {
  const cfg = config || {}
  const roles = (cfg.roles && cfg.roles.length ? cfg.roles : DEFAULT_ROLES).map((r) => ({
    id: r.id,
    tools: r.tools || [],
    skills: r.skills || [],
    keywords: r.keywords || [],
  }))
  const staff = (cfg.staff && cfg.staff.length ? cfg.staff : DEFAULT_STAFF).map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    emoji: s.emoji,
    intro: s.intro,
    roleId: s.roleId || s.id,
    department: s.department || '未分组',
    reportsTo: s.reportsTo || '老板',
    aliases: s.aliases || [],
    lines: s.lines || {},
  }))
  return {
    tabLabel: cfg.tabLabel || '赛博公司',
    companyName: cfg.companyName || '赛博公司',
    chatEnabled: cfg.chatEnabled !== false,
    roles,
    staff,
  }
}

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'running', label: '干活中' },
  { id: 'done', label: '已交付' },
  { id: 'wait', label: '卡住' },
  { id: 'idle', label: '待命' },
]

export function OrgView(props: any) {
  const useSession = props?.useSession
  const inputActions = props?.inputActions
  const timer = props?.timer
  const config = normalizeConfig(props?.config as OrgPanelConfig | undefined)
  const staff = config.staff
  const roles = config.roles

  const [tick, setTick] = useState(0)
  const [now, setNow] = useState(() => new Date())
  const [selected, setSelected] = useState<StaffDef | null>(null)
  const [activeStaffId, setActiveStaffId] = useState<string | null>(null)
  const [focusStaff, setFocusStaff] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (timer && typeof timer.interval === 'function') {
      const offWalk = timer.interval(() => setTick((t) => t + 1), 6000)
      const offClock = timer.interval(() => setNow(new Date()), 1000)
      return () => { if (typeof offWalk === 'function') offWalk(); if (typeof offClock === 'function') offClock() }
    }
    const walkId = window.setInterval(() => setTick((t) => t + 1), 6000)
    const clockId = window.setInterval(() => setNow(new Date()), 1000)
    return () => { window.clearInterval(walkId); window.clearInterval(clockId) }
  }, [timer])

  const useSessionSafe = typeof useSession === 'function' ? useSession : () => undefined
  const nodes = useSessionSafe((s: any) => s?.nodes)
  const runningCalls = useSessionSafe((s: any) => s?.runningCalls)
  const partial = useSessionSafe((s: any) => s?.partial)
  const running = !!useSessionSafe((s: any) => s?.running)
  const promptError = useSessionSafe((s: any) => s?.promptError)

  useEffect(() => {
    const scroll = rootRef.current?.closest('[data-conversation-scroll]')
    if (!(scroll instanceof HTMLElement)) return
    scroll.classList.add('dsh-org-session-active')
    return () => { scroll.classList.remove('dsh-org-session-active') }
  }, [])

  const requests = useMemo(() => collectUserRequests(nodes || []), [nodes])
  const delegations = useMemo(() => extractDelegations(nodes || [], runningCalls || [], roles, staff), [nodes, runningCalls, roles, staff])
  const events = useMemo(() => systemEvents(delegations, staff), [delegations, staff])

  const statuses: Record<string, string> = {}
  const tasksMap: Record<string, Delegation[]> = {}
  let runningCount = 0, doneCount = 0, waitCount = 0, idleCount = 0
  for (const st of staff) {
    const tasks = tasksFor(st.id, delegations)
    tasksMap[st.id] = tasks
    const status = st.id === 'secretary' ? (running ? 'running' : 'idle') : statusFromTasks(tasks)
    statuses[st.id] = status
    if (status === 'running') runningCount++
    else if (status === 'done') doneCount++
    else if (status === 'wait') waitCount++
    else idleCount++
  }

  const visibleStaff = useMemo(() => {
    const q = query.trim().toLowerCase()
    return staff.filter((st) => {
      if (focusStaff && st.id !== focusStaff) return false
      const status = statuses[st.id] || 'idle'
      if (filter !== 'all' && status !== filter) return false
      if (q) {
        const tasks = tasksMap[st.id] || []
        const inName = (st.name + st.role).toLowerCase().includes(q)
        const inTask = tasks.some((t) => t.desc.toLowerCase().includes(q) || t.lead.toLowerCase().includes(q))
        if (!inName && !inTask) return false
      }
      return true
    })
  }, [staff, focusStaff, filter, query, delegations])

  const draftComposer = (text: string) => {
    if (inputActions && typeof inputActions.setDraft === 'function') inputActions.setDraft(text)
    window.requestAnimationFrame(() => {
      const scroll = rootRef.current?.closest('[data-conversation-scroll]')
      const input = scroll?.querySelector('[data-composer-seat] textarea') as HTMLTextAreaElement | null
      input?.focus()
      input?.scrollIntoView({ block: 'nearest' })
    })
  }
  const selectStaff = (id: string) => setActiveStaffId((current) => current === id ? null : id)

  return createElement('div', { className: 'dsh-org', ref: rootRef },
    createElement('style', null, MODERN_CSS),
    createElement('div', { className: 'dsh-org-shell' },
      createElement('header', { className: 'dsh-org-head' },
        createElement('div', { className: 'dsh-org-brand' },
          createElement('span', { className: 'dsh-org-mark', 'aria-hidden': true }, '✦'),
          createElement('div', { style: { minWidth: 0 } },
            createElement('div', { className: 'dsh-org-kicker' }, config.tabLabel + ' / DSH OFFICE OS'),
            createElement('div', { className: 'dsh-org-title' }, config.companyName + ' · AI 员工总部'),
          createElement('div', { className: 'dsh-org-sub' }, '以公司工作群为主线，办公室作为实时状态侧栏；对话、思考与执行轨迹仍在当前 Tab'),
          ),
        ),
        createElement('div', { className: 'dsh-org-head-right' },
          createElement('div', { className: 'dsh-org-live' }, createElement('i', { className: 'dsh-org-live-dot', 'aria-hidden': true }), '实时监听'),
          createElement('div', { className: 'dsh-org-stats', 'aria-label': '员工状态统计' },
            createElement('div', { className: 'dsh-org-stat' }, createElement('span', { className: 'dsh-org-stat-num' }, runningCount), createElement('span', { className: 'dsh-org-stat-label' }, '干活中')),
            createElement('div', { className: 'dsh-org-stat' }, createElement('span', { className: 'dsh-org-stat-num' }, waitCount), createElement('span', { className: 'dsh-org-stat-label' }, '卡住')),
            createElement('div', { className: 'dsh-org-stat' }, createElement('span', { className: 'dsh-org-stat-num' }, doneCount), createElement('span', { className: 'dsh-org-stat-label' }, '已交付')),
            createElement('div', { className: 'dsh-org-stat' }, createElement('span', { className: 'dsh-org-stat-num' }, idleCount), createElement('span', { className: 'dsh-org-stat-label' }, '待命')),
          ),
        ),
      ),
      createElement(BriefBanner, { text: bossLine(requests, delegations, staff), companyName: config.companyName, delegationCount: delegations.length }),
      createElement(OrganizationChart, { staff }),
      focusStaff ? createElement('div', { className: 'dsh-org-focus' },
        createElement('span', null, '当前聚焦：' + (staffOf(focusStaff, staff)?.name || '员工') + ' · 左侧列表已收敛'),
        createElement('button', { type: 'button', onClick: () => setFocusStaff(null) }, '返回全员'),
      ) : null,
      createElement('div', { className: 'dsh-org-workbench' },
        createElement(RosterPanel, {
          staff, visibleStaff, statuses, tasksMap, activeStaffId, focusStaff, filter, query,
          onFilter: setFilter, onQuery: setQuery, onSelect: selectStaff,
          onOpenProfile: setSelected,
          onTalk: (employee: StaffDef) => draftComposer(dispatchTemplate(employee)),
          onClearFocus: () => setFocusStaff(null),
        }),
        createElement('main', { className: 'dsh-org-center' },
          createElement(ConversationFlow, {
            nodes: nodes || [], partial, runningCalls: runningCalls || [], running, promptError,
            chatEnabled: config.chatEnabled, staff, onDraft: draftComposer,
          }),
          createElement(PixelOffice, {
            companyName: config.companyName, staff, statuses, tasksMap, tick, now, activeStaffId, onSelect: selectStaff,
            onTalk: (employee: StaffDef) => draftComposer(dispatchTemplate(employee)),
          }),
        ),
      ),
    ),
    selected ? createElement(StaffDetail, {
      staff: selected, status: statuses[selected.id] || 'idle', tasks: tasksMap[selected.id] || [], roles,
      onClose: () => setSelected(null),
      onFocus: (id: string) => { setActiveStaffId(id); setFocusStaff(id); setSelected(null) },
      onDraft: (text: string) => { draftComposer(text); setSelected(null) },
    }) : null,
  )
}

export function apply(ctx: any, config?: OrgPanelConfig) {
  const slots = ctx && ctx.get ? ctx.get('slots') : undefined
  if (slots === undefined) return
  const timer = ctx && ctx.get ? ctx.get('timer') : undefined
  const inputTriggers = ctx && ctx.get ? ctx.get('inputTriggers') : undefined
  const normalized = normalizeConfig(config)
  if (inputTriggers && typeof inputTriggers.registerSource === 'function') {
    const source = {
      trigger: '@',
      name: 'niuma-staff',
      order: -20,
      candidates(_session: any, request: any) {
        const query = String(request?.query || '').toLowerCase()
        return Promise.resolve(normalized.staff
          .filter((employee) => !query || (employee.name + employee.role + (employee.aliases || []).join(' ')).toLowerCase().includes(query))
          .map((employee) => ({ name: employee.name, description: employee.id === 'secretary' ? `${employee.role} · 主 Agent` : `${employee.role} · 独立子代理`, icon: employee.emoji })))
      },
      lexicon() { return normalized.staff.map((employee) => employee.name) },
      onPick(pick: any) { return { text: `@${pick.candidate.name} ` } },
    }
    ctx.effect(() => inputTriggers.registerSource(source), 'dsh-org-panel: @赛博公司员工')
  }
  slots.inject('conversation.view', () => slots.register(
    { name: 'conversation.view', id: 'realm', order: 20, label: () => normalized.tabLabel },
    (props: any) => createElement(OrgView, Object.assign({}, props, { timer, config: normalized })),
  ))
}
