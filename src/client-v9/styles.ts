// 「赛博公司」client-v9 样式：暗背景 + 局部霓虹 + 大量深色实体材质。
// 办公室由真实 PNG 资产构成，禁止 SVG 线框与 border+gradient 模拟家具。

const STYLE_ID = 'dsh-org-panel-cy9'

export const CY9_CSS = String.raw`
.cy9.cy9 {
  --cy9-bg: #070b14;
  --cy9-panel: #0b1220;
  --cy9-panel-2: #0e1626;
  --cy9-panel-3: #121c30;
  --cy9-line: rgba(126,146,196,.14);
  --cy9-line-hi: rgba(94,140,255,.38);
  --cy9-text: #e8ecf6;
  --cy9-muted: #7d89a6;
  --cy9-dim: #4d5872;
  --cy9-cyan: #46d2ff;
  --cy9-blue: #5b8cff;
  --cy9-violet: #8b6cff;
  --cy9-green: #3fd68f;
  --cy9-amber: #e0a94f;
  --cy9-red: #ff6b7a;
  --cy9-banner: linear-gradient(120deg,#6d4aff,#8b5cff 62%,#a06bff);
  height: calc(100dvh - 112px) !important;
  min-height: 640px !important;
  padding: 10px 12px 12px !important;
  overflow: hidden !important;
  background:
    radial-gradient(circle at 72% -12%, rgba(97,108,255,.16), transparent 34%),
    radial-gradient(circle at 18% 112%, rgba(70,210,255,.07), transparent 30%),
    linear-gradient(180deg,#080d1a,#060a12 78%) !important;
  color: var(--cy9-text) !important;
  font-family: 'PingFang SC','Microsoft YaHei',system-ui,-apple-system,sans-serif;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cy9 *, .cy9 *::before, .cy9 *::after { box-sizing: border-box; }
.cy9 button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; }
.cy9 img { display: block; -webkit-user-drag: none; user-select: none; }

/* ===== 顶栏 ===== */
.cy9-header {
  display: flex; align-items: center; gap: 14px;
  height: 62px; min-height: 62px; padding: 0 16px;
  border: 1px solid var(--cy9-line); border-radius: 14px;
  background:
    radial-gradient(circle at 12% -30%, rgba(139,108,255,.10), transparent 42%),
    linear-gradient(180deg,rgba(15,22,40,.96),rgba(8,13,24,.97));
  box-shadow: 0 14px 34px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.02);
}
.cy9-brand { display: flex; align-items: center; gap: 11px; min-width: 0; }
.cy9-brand img { width: 38px; height: 38px; object-fit: contain; filter: drop-shadow(0 0 10px rgba(139,108,255,.35)); }
.cy9-brand-kicker { font-size: 8px; font-weight: 700; letter-spacing: .22em; color: #6f7ca0; }
.cy9-brand-title { margin-top: 2px; font-size: 16px; font-weight: 750; letter-spacing: -.01em; color: #eef1fa; white-space: nowrap; }
.cy9-brand-title em { font-style: normal; color: var(--cy9-violet); }

.cy9-stats { display: flex; align-items: stretch; gap: 8px; margin-left: 6px; flex: 1; min-width: 0; overflow: hidden; }
.cy9-stat {
  display: flex; flex-direction: column; justify-content: center; gap: 2px;
  min-width: 84px; padding: 6px 12px;
  border: 1px solid var(--cy9-line); border-radius: 10px;
  background: rgba(6,10,20,.66);
}
.cy9-stat b { font-size: 13px; font-weight: 720; color: #dfe6f6; line-height: 1.1; white-space: nowrap; }
.cy9-stat b i { font-style: normal; color: var(--cy9-cyan); }
.cy9-stat span { font-size: 8px; color: #616e8f; letter-spacing: .06em; white-space: nowrap; }
.cy9-stat.hot b i { color: var(--cy9-green); }
.cy9-stat.warn b i { color: var(--cy9-amber); }

.cy9-header-right { display: flex; align-items: center; gap: 9px; margin-left: auto; }
.cy9-clock { text-align: right; line-height: 1.3; padding-right: 10px; border-right: 1px solid var(--cy9-line); }
.cy9-clock b { display: block; font: 720 12px ui-monospace,Consolas,monospace; color: #dbe3f4; }
.cy9-clock span { font-size: 8px; color: #5c6884; letter-spacing: .08em; }
.cy9-market-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 13px; border-radius: 10px;
  border: 1px solid rgba(139,108,255,.42);
  background: linear-gradient(135deg,rgba(109,74,255,.22),rgba(139,92,255,.10));
  color: #c9bcff; font-size: 11px; font-weight: 650;
  transition: border-color .16s, background .16s;
}
.cy9-market-btn:hover { border-color: rgba(160,132,255,.7); background: linear-gradient(135deg,rgba(109,74,255,.3),rgba(139,92,255,.14)); }
.cy9-market-btn .new {
  padding: 1px 5px; border-radius: 6px; font-size: 7px; font-weight: 800;
  background: var(--cy9-banner); color: #fff; letter-spacing: .08em;
}
.cy9-boss {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 12px 5px 6px; border-radius: 999px;
  border: 1px solid var(--cy9-line); background: rgba(10,16,30,.7);
}
.cy9-boss-avatar {
  width: 30px; height: 30px; border-radius: 50%;
  display: grid; place-items: center;
  background: linear-gradient(140deg,#6d4aff,#46d2ff);
  color: #fff; font-size: 13px; font-weight: 800;
}
.cy9-boss-name { font-size: 11px; font-weight: 700; color: #e4e9f6; line-height: 1.2; }
.cy9-boss-name small { display: block; font-size: 8px; font-weight: 500; color: #616e8f; }

/* ===== 主体三栏 ===== */
.cy9-body {
  flex: 1; min-height: 0;
  display: grid;
  grid-template-columns: clamp(210px,15vw,246px) minmax(600px,1fr) clamp(266px,19vw,314px);
  gap: 10px;
}

/* ===== 左栏：员工列表 ===== */
.cy9-left {
  min-height: 0; display: flex; flex-direction: column;
  border: 1px solid var(--cy9-line); border-radius: 14px;
  background: linear-gradient(180deg,rgba(12,18,34,.97),rgba(8,13,24,.98));
  box-shadow: 0 14px 34px rgba(0,0,0,.24);
  overflow: hidden;
}
.cy9-left-head {
  display: flex; align-items: baseline; justify-content: space-between;
  padding: 12px 13px 9px;
}
.cy9-left-head b { font-size: 12.5px; font-weight: 720; color: #e4e9f6; }
.cy9-left-head span { font-size: 9px; color: #5c6884; }
.cy9-left-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 7px 10px; display: flex; flex-direction: column; gap: 4px; }
.cy9-left-list::-webkit-scrollbar, .cy9-chat-body::-webkit-scrollbar, .cy9-rail::-webkit-scrollbar, .cy9-thread-body::-webkit-scrollbar { width: 5px; height: 5px; }
.cy9-left-list::-webkit-scrollbar-thumb, .cy9-chat-body::-webkit-scrollbar-thumb, .cy9-rail::-webkit-scrollbar-thumb, .cy9-thread-body::-webkit-scrollbar-thumb { background: rgba(120,140,200,.22); border-radius: 4px; }

.cy9-emp {
  display: grid; grid-template-columns: 34px minmax(0,1fr) auto; grid-template-rows: auto auto;
  column-gap: 9px; row-gap: 2px; padding: 7px 8px; border-radius: 11px;
  border: 1px solid transparent; text-align: left; width: 100%;
  transition: background .14s, border-color .14s;
}
.cy9-emp:hover { background: rgba(91,140,255,.07); }
.cy9-emp.active { background: rgba(139,108,255,.12); border-color: rgba(139,108,255,.42); }
.cy9-emp-avatar { grid-row: 1 / 3; width: 34px; height: 34px; border-radius: 10px; overflow: hidden; background: #0a1120; border: 1px solid var(--cy9-line); }
.cy9-emp-avatar img { width: 100%; height: 100%; object-fit: cover; }
.cy9-emp-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.cy9-emp-name { font-size: 11.5px; font-weight: 700; color: #e4e9f6; white-space: nowrap; }
.cy9-emp-role { font-size: 9px; color: #616e8f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cy9-emp-state {
  margin-left: auto; display: inline-flex; align-items: center; gap: 4px;
  font-size: 8px; font-weight: 650; color: var(--cy9-muted); white-space: nowrap;
}
.cy9-emp-state i { width: 5px; height: 5px; border-radius: 50%; background: #42506e; }
.cy9-emp-state.running { color: #7ee2b0; } .cy9-emp-state.running i { background: var(--cy9-green); box-shadow: 0 0 6px rgba(63,214,143,.7); }
.cy9-emp-state.done { color: #9db8ff; } .cy9-emp-state.done i { background: var(--cy9-blue); }
.cy9-emp-state.wait { color: #f0b9c1; } .cy9-emp-state.wait i { background: var(--cy9-red); }
.cy9-emp-task { grid-column: 2 / 4; font-size: 9px; color: #5c6884; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ===== 中央：办公室 + 群聊 ===== */
.cy9-center { display: flex; flex-direction: column; gap: 10px; min-width: 0; min-height: 0; }

.cy9-office-shell {
  flex: 1; min-height: 0; position: relative;
  border: 1px solid var(--cy9-line); border-radius: 14px; overflow: hidden;
  background:
    radial-gradient(circle at 50% -18%, rgba(97,108,255,.13), transparent 46%),
    linear-gradient(180deg,#0a1120,#070c16);
  box-shadow: 0 14px 34px rgba(0,0,0,.24);
}
.cy9-office-toolbar {
  position: absolute; z-index: 40; top: 10px; right: 12px;
  display: flex; gap: 4px; padding: 3px;
  border: 1px solid var(--cy9-line); border-radius: 9px;
  background: rgba(7,11,22,.82); backdrop-filter: blur(4px);
}
.cy9-office-toolbar button {
  padding: 3px 8px; border-radius: 6px; font-size: 9px; font-weight: 650; color: #616e8f;
}
.cy9-office-toolbar button.on { background: rgba(139,108,255,.24); color: #cabfff; }
.cy9-office-viewport { position: absolute; inset: 0; overflow: auto; }
.cy9-office-scroll { position: relative; margin: 0 auto; }
.cy9-office-world {
  position: relative; transform-origin: 0 0;
  width: 1200px; height: 720px; overflow: hidden;
}
.cy9-office-base { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .30; filter: brightness(.72) saturate(.9); }

.cy9-zone { position: absolute; border-radius: 10px; overflow: visible; }
.cy9-zone-floor {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill;
  opacity: .84; border-radius: 10px; filter: brightness(.86);
}
.cy9-zone::after {
  content: ''; position: absolute; inset: 0; border-radius: 10px; pointer-events: none;
  border: 1px solid rgba(120,150,255,.14);
  box-shadow: inset 0 0 26px rgba(6,10,20,.5);
}
.cy9-zone.meeting-glow::after { border-color: rgba(139,108,255,.4); animation: cy9-glow 2.6s ease-in-out infinite; }
.cy9-zone-banner {
  position: absolute; top: -13px; left: 50%; transform: translateX(-50%);
  padding: 4px 13px; border-radius: 999px; white-space: nowrap; z-index: 30;
  background: var(--cy9-banner);
  color: #fff; font-size: 10px; font-weight: 750; letter-spacing: .03em;
  box-shadow: 0 4px 14px rgba(109,74,255,.45);
}
.cy9-zone-banner b { font-weight: 750; opacity: .82; margin-left: 4px; font-size: 9px; }
.cy9-zone-sign { position: absolute; z-index: 5; width: 62px; height: auto; opacity: .92; }

.cy9-furniture { position: absolute; pointer-events: none; }
.cy9-furniture img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 6px 10px rgba(0,0,0,.4)); }
.cy9-furniture.flicker img { animation: cy9-flicker 4.2s steps(2,end) infinite; }

/* ===== 员工小人 ===== */
.cy9-sprite {
  position: absolute; z-index: 20; width: 64px; margin-left: -32px; margin-top: -50px;
  display: flex; flex-direction: column; align-items: center;
  transition: left .8s ease-in-out, top .8s ease-in-out;
  cursor: pointer;
}
.cy9-sprite-img { position: relative; width: 46px; height: 46px; }
.cy9-sprite-img img {
  width: 100%; height: 100%; object-fit: contain;
  filter: drop-shadow(0 5px 8px rgba(0,0,0,.5));
}
.cy9-sprite.working .cy9-sprite-img img { animation: cy9-breathe 2.4s ease-in-out infinite; }
.cy9-sprite.active .cy9-sprite-img img { filter: drop-shadow(0 0 10px rgba(139,108,255,.8)); }
.cy9-sprite-name {
  margin-top: 1px; padding: 1px 7px; border-radius: 6px;
  background: rgba(6,10,20,.82); border: 1px solid var(--cy9-line);
  font-size: 8.5px; font-weight: 700; color: #cfd8ee; white-space: nowrap;
}
.cy9-sprite.working .cy9-sprite-name { color: #7ee2b0; border-color: rgba(63,214,143,.4); }
.cy9-sprite.thinking .cy9-sprite-name { color: #cabfff; border-color: rgba(139,108,255,.5); }
.cy9-sprite.blocked .cy9-sprite-name { color: #f0b9c1; border-color: rgba(255,107,122,.5); }
.cy9-sprite-task {
  margin-top: 2px; max-width: 86px; padding: 0 5px; border-radius: 5px;
  background: rgba(10,16,30,.86); font-size: 7.5px; color: #7d89a6;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cy9-sprite-badge {
  position: absolute; top: -7px; right: -3px; width: 15px; height: 15px;
  display: grid; place-items: center; border-radius: 50%;
  font-size: 9px; font-weight: 800; color: #fff; z-index: 2;
}
.cy9-sprite-badge.think { background: var(--cy9-violet); box-shadow: 0 0 8px rgba(139,108,255,.8); }
.cy9-sprite-badge.alert { background: var(--cy9-red); box-shadow: 0 0 8px rgba(255,107,122,.8); }
.cy9-sprite-badge.ok { background: var(--cy9-green); box-shadow: 0 0 8px rgba(63,214,143,.7); }
.cy9-sprite-card {
  position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
  width: 168px; padding: 9px 10px; border-radius: 11px; z-index: 60;
  border: 1px solid rgba(139,108,255,.4);
  background: rgba(10,15,30,.96); box-shadow: 0 12px 30px rgba(0,0,0,.5);
  display: none; text-align: left; cursor: default;
}
.cy9-sprite:hover .cy9-sprite-card { display: block; }
.cy9-sprite-card b { font-size: 11px; color: #eef1fa; }
.cy9-sprite-card span { font-size: 9px; color: #7d89a6; margin-left: 6px; }
.cy9-sprite-card p { margin: 5px 0 7px; font-size: 9px; color: #9aa6c4; line-height: 1.45; }
.cy9-sprite-card p i { font-style: normal; color: var(--cy9-cyan); }
.cy9-sprite-card-actions { display: flex; gap: 6px; }
.cy9-sprite-card-actions button {
  flex: 1; padding: 4px 0; border-radius: 7px; font-size: 9px; font-weight: 700;
  border: 1px solid rgba(139,108,255,.45); color: #cabfff; background: rgba(109,74,255,.14);
}
.cy9-sprite-card-actions button:hover { background: rgba(109,74,255,.28); }

/* ===== 底部：公司群聊 ===== */
.cy9-collab {
  position: relative; flex: none; display: flex; flex-direction: column;
  border: 1px solid var(--cy9-line); border-radius: 14px; overflow: hidden;
  background: linear-gradient(180deg,rgba(12,18,34,.97),rgba(8,13,24,.98));
  box-shadow: 0 14px 34px rgba(0,0,0,.24);
}
.cy9-collab-grip {
  position: absolute; top: 0; left: 0; right: 0; height: 5px; z-index: 5;
  cursor: ns-resize;
}
.cy9-collab-grip::after {
  content: ''; position: absolute; top: 2px; left: 50%; transform: translateX(-50%);
  width: 34px; height: 3px; border-radius: 2px; background: rgba(120,140,200,.28);
}
.cy9-collab-head {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 14px 7px;
}
.cy9-collab-head b { font-size: 12.5px; font-weight: 720; color: #e4e9f6; }
.cy9-collab-head span { font-size: 9px; color: #5c6884; }
.cy9-collab-toggle { margin-left: auto; font-size: 10px; color: #7d89a6; padding: 3px 8px; border-radius: 7px; }
.cy9-collab-toggle:hover { background: rgba(91,140,255,.1); color: #c3cdf0; }
.cy9-collab.collapsed .cy9-collab-body { display: none; }

.cy9-collab-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 138px minmax(0,1fr); }
.cy9-channels { border-right: 1px solid var(--cy9-line); padding: 4px 7px 8px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.cy9-channels-label { padding: 4px 7px 3px; font-size: 8px; font-weight: 750; letter-spacing: .14em; color: #4d5872; }
.cy9-channel {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 8px; border-radius: 8px; text-align: left;
  font-size: 10.5px; color: #8b96b4; transition: background .13s;
}
.cy9-channel:hover { background: rgba(91,140,255,.08); color: #c3cdf0; }
.cy9-channel.on { background: rgba(139,108,255,.16); color: #dcd3ff; font-weight: 680; }
.cy9-channel i { font-style: normal; color: #5c6884; font-weight: 700; }
.cy9-channel em { margin-left: auto; font-style: normal; font-size: 8px; color: #5c6884; }

.cy9-chat { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.cy9-chat-filter {
  display: flex; align-items: center; gap: 7px;
  margin: 0 10px; padding: 4px 9px; border-radius: 8px;
  background: rgba(139,108,255,.12); border: 1px solid rgba(139,108,255,.3);
  font-size: 9.5px; color: #cabfff;
}
.cy9-chat-filter button { margin-left: auto; font-size: 9px; color: #8b96b4; }
.cy9-chat-filter button:hover { color: #fff; }
.cy9-chat-body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 12px 4px; display: flex; flex-direction: column; gap: 7px; }
.cy9-chat-empty { padding: 26px 18px; font-size: 10.5px; color: #5c6884; line-height: 1.7; text-align: center; }

.cy9-msg-divider { display: flex; align-items: center; gap: 10px; margin: 3px 0; font-size: 9px; color: #6f7ca0; }
.cy9-msg-divider::before, .cy9-msg-divider::after { content: ''; flex: 1; height: 1px; background: linear-gradient(90deg,transparent,rgba(139,108,255,.4),transparent); }
.cy9-msg-divider b { font-weight: 650; color: #9d8fe0; white-space: nowrap; }

.cy9-msg { display: flex; gap: 9px; min-width: 0; }
.cy9-msg-avatar { flex: none; width: 30px; height: 30px; border-radius: 9px; overflow: hidden; border: 1px solid var(--cy9-line); background: #0a1120; }
.cy9-msg-avatar img { width: 100%; height: 100%; object-fit: cover; }
.cy9-msg-avatar.boss { display: grid; place-items: center; background: linear-gradient(140deg,#6d4aff,#46d2ff); color: #fff; font-size: 12px; font-weight: 800; border: none; }
.cy9-msg-main { flex: 1; min-width: 0; }
.cy9-msg-meta { display: flex; align-items: baseline; gap: 7px; margin-bottom: 3px; }
.cy9-msg-meta b { font-size: 11px; font-weight: 720; color: #e4e9f6; }
.cy9-msg-meta span { font-size: 8.5px; color: #5c6884; }
.cy9-msg-meta em { font-style: normal; margin-left: auto; font-size: 8.5px; color: #4d5872; }
.cy9-msg-bubble {
  display: inline-block; max-width: 100%; padding: 7px 11px; border-radius: 3px 11px 11px 11px;
  background: var(--cy9-panel-3); border: 1px solid var(--cy9-line);
  font-size: 11.5px; line-height: 1.6; color: #ccd5ea;
  white-space: pre-wrap; word-break: break-word;
}
.cy9-msg.from-boss .cy9-msg-bubble { background: rgba(109,74,255,.16); border-color: rgba(139,108,255,.34); }
.cy9-msg-thinking { margin-top: 4px; }
.cy9-msg-thinking summary {
  display: inline-flex; align-items: center; gap: 5px; cursor: pointer; list-style: none;
  font-size: 9px; color: #8b6cff; padding: 2px 8px; border-radius: 6px;
  background: rgba(139,108,255,.1); border: 1px solid rgba(139,108,255,.24);
}
.cy9-msg-thinking summary::-webkit-details-marker { display: none; }
.cy9-msg-thinking pre {
  margin: 5px 0 0; padding: 7px 10px; border-radius: 8px; max-height: 130px; overflow: auto;
  background: rgba(6,10,20,.7); border: 1px solid var(--cy9-line);
  font-size: 9.5px; line-height: 1.6; color: #8b96b4; white-space: pre-wrap; word-break: break-word;
}

.cy9-msg-tool {
  display: flex; gap: 9px; padding: 7px 11px; border-radius: 11px; cursor: pointer;
  border: 1px solid rgba(91,140,255,.24); background: rgba(12,20,38,.8);
  transition: border-color .14s;
}
.cy9-msg-tool:hover { border-color: rgba(91,140,255,.5); }
.cy9-msg-tool-icon { flex: none; width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: rgba(70,210,255,.12); border: 1px solid rgba(70,210,255,.3); font-size: 12px; }
.cy9-msg-tool-main { min-width: 0; flex: 1; }
.cy9-msg-tool-main b { font-size: 10px; color: #9ec9ff; font-family: ui-monospace,Consolas,monospace; }
.cy9-msg-tool-main b em { font-style: normal; margin-left: 7px; font-size: 8px; color: #5c6884; font-family: inherit; }
.cy9-msg-tool-main p { margin: 2px 0 0; font-size: 9.5px; color: #7d89a6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.cy9-msg-typing { display: flex; align-items: center; gap: 8px; padding: 3px 2px; font-size: 9.5px; color: #7d89a6; }
.cy9-msg-typing img { width: 20px; height: 20px; border-radius: 6px; object-fit: cover; }
.cy9-typing-dots i { display: inline-block; width: 4px; height: 4px; margin-right: 3px; border-radius: 50%; background: #8b6cff; animation: cy9-dots 1.2s infinite; }
.cy9-typing-dots i:nth-child(2) { animation-delay: .2s; }
.cy9-typing-dots i:nth-child(3) { animation-delay: .4s; }

.cy9-chat-input { position: relative; display: flex; gap: 8px; padding: 8px 12px 10px; border-top: 1px solid var(--cy9-line); }
.cy9-chat-input textarea {
  flex: 1; min-width: 0; resize: none; height: 38px; padding: 8px 11px;
  border-radius: 10px; border: 1px solid var(--cy9-line); outline: none;
  background: rgba(6,10,20,.72); color: #dfe6f6;
  font: 11.5px/1.5 'PingFang SC','Microsoft YaHei',sans-serif;
}
.cy9-chat-input textarea:focus { border-color: var(--cy9-line-hi); }
.cy9-chat-input textarea::placeholder { color: #4d5872; }
.cy9-chat-send {
  flex: none; padding: 0 16px; border-radius: 10px;
  background: linear-gradient(135deg,#5b8cff,#46d2ff);
  color: #fff; font-size: 11px; font-weight: 750;
  box-shadow: 0 4px 14px rgba(91,140,255,.35);
  transition: filter .14s;
}
.cy9-chat-send:hover { filter: brightness(1.12); }
.cy9-chat-hint { position: absolute; right: 84px; bottom: 19px; font-size: 7.5px; color: #4d5872; pointer-events: none; }
.cy9-mention-pop {
  position: absolute; left: 12px; bottom: calc(100% - 4px); z-index: 70;
  width: 230px; max-height: 190px; overflow-y: auto;
  border: 1px solid rgba(139,108,255,.4); border-radius: 11px;
  background: rgba(10,15,30,.98); box-shadow: 0 14px 34px rgba(0,0,0,.5);
  padding: 4px;
}
.cy9-mention-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border-radius: 8px; text-align: left; }
.cy9-mention-item img { width: 24px; height: 24px; border-radius: 7px; object-fit: cover; }
.cy9-mention-item b { font-size: 10.5px; color: #e4e9f6; }
.cy9-mention-item span { font-size: 8.5px; color: #616e8f; margin-left: 4px; }
.cy9-mention-item.on, .cy9-mention-item:hover { background: rgba(139,108,255,.18); }

/* ===== 右栏 ===== */
.cy9-rail { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 1px; }
.cy9-card {
  flex: none; border: 1px solid var(--cy9-line); border-radius: 13px;
  background: linear-gradient(180deg,rgba(12,18,34,.97),rgba(8,13,24,.98));
  box-shadow: 0 12px 28px rgba(0,0,0,.2);
  padding: 11px 12px;
}
.cy9-card-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 9px; }
.cy9-card-head b { font-size: 12px; font-weight: 720; color: #e4e9f6; }
.cy9-card-head span { font-size: 8px; letter-spacing: .12em; color: #4d5872; }
.cy9-card-head button { margin-left: auto; font-size: 9px; color: #7d89a6; }
.cy9-card-head button:hover { color: #c3cdf0; }

.cy9-status-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.cy9-status-cell { padding: 8px 10px; border-radius: 10px; background: rgba(6,10,20,.62); border: 1px solid var(--cy9-line); }
.cy9-status-cell b { display: block; font-size: 14px; font-weight: 740; color: #dfe6f6; }
.cy9-status-cell b i { font-style: normal; font-size: 10px; color: var(--cy9-muted); }
.cy9-status-cell span { font-size: 8.5px; color: #616e8f; }
.cy9-status-cell.green b { color: var(--cy9-green); }
.cy9-status-cell.blue b { color: #9db8ff; }
.cy9-status-cell.red b { color: #ff8a96; }
.cy9-status-cell.violet b { color: #cabfff; }
.cy9-session-line { display: flex; align-items: center; gap: 7px; margin-top: 9px; font-size: 9px; color: #7d89a6; }
.cy9-session-line i { width: 6px; height: 6px; border-radius: 50%; background: #42506e; }
.cy9-session-line.live i { background: var(--cy9-green); box-shadow: 0 0 7px rgba(63,214,143,.8); }

.cy9-taskflow-row { display: flex; align-items: center; gap: 9px; padding: 7px 0; border-top: 1px solid rgba(126,146,196,.08); }
.cy9-taskflow-row:first-child { border-top: none; padding-top: 0; }
.cy9-taskflow-avatar { flex: none; width: 26px; height: 26px; border-radius: 8px; overflow: hidden; border: 1px solid var(--cy9-line); }
.cy9-taskflow-avatar img { width: 100%; height: 100%; object-fit: cover; }
.cy9-taskflow-main { flex: 1; min-width: 0; }
.cy9-taskflow-main b { display: block; font-size: 10px; color: #ccd5ea; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cy9-taskflow-main span { font-size: 8.5px; color: #5c6884; }
.cy9-taskflow-state { flex: none; font-size: 8px; font-weight: 700; padding: 2px 7px; border-radius: 6px; }
.cy9-taskflow-state.running { color: #7ee2b0; background: rgba(63,214,143,.12); }
.cy9-taskflow-state.done { color: #9db8ff; background: rgba(91,140,255,.12); }
.cy9-taskflow-state.wait { color: #ff8a96; background: rgba(255,107,122,.12); }

.cy9-feed-row { display: flex; gap: 8px; padding: 6px 0; border-top: 1px solid rgba(126,146,196,.08); }
.cy9-feed-row:first-child { border-top: none; padding-top: 0; }
.cy9-feed-row img { flex: none; width: 24px; height: 24px; border-radius: 7px; object-fit: cover; border: 1px solid var(--cy9-line); }
.cy9-feed-main { min-width: 0; flex: 1; }
.cy9-feed-main b { font-size: 10px; color: #ccd5ea; }
.cy9-feed-main p { margin: 1px 0 0; font-size: 9px; color: #7d89a6; line-height: 1.45; }
.cy9-feed-main em { font-style: normal; float: right; font-size: 8px; color: #4d5872; }

.cy9-skill-row { padding: 6px 0; border-top: 1px solid rgba(126,146,196,.08); }
.cy9-skill-row:first-child { border-top: none; padding-top: 0; }
.cy9-skill-row b { font-size: 10px; color: #ccd5ea; }
.cy9-skill-row span { float: right; font-size: 8px; color: #5c6884; }
.cy9-skill-bar { margin-top: 4px; height: 4px; border-radius: 3px; background: rgba(120,140,200,.14); overflow: hidden; }
.cy9-skill-bar i { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg,#5b8cff,#8b6cff); }
.cy9-skill-bar i.indet { width: 34% !important; animation: cy9-slide 1.4s ease-in-out infinite alternate; }

.cy9-plugin-row { padding: 8px 0; border-top: 1px solid rgba(126,146,196,.08); }
.cy9-plugin-row:first-of-type { border-top: none; padding-top: 0; }
.cy9-plugin-line { display: flex; align-items: center; gap: 6px; }
.cy9-plugin-line b { font-size: 10.5px; color: #c3cdf0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cy9-plugin-line span { font-size: 8px; color: #5c6884; white-space: nowrap; }
.cy9-plugin-line .stars { color: var(--cy9-amber); }
.cy9-plugin-desc { margin: 3px 0 6px; font-size: 9px; color: #7d89a6; line-height: 1.45; }
.cy9-plugin-install {
  padding: 3px 10px; border-radius: 7px; font-size: 9px; font-weight: 700;
  border: 1px solid rgba(139,108,255,.45); color: #cabfff; background: rgba(109,74,255,.12);
}
.cy9-plugin-install:hover { background: rgba(109,74,255,.26); }

.cy9-empty { padding: 12px 4px; font-size: 9.5px; color: #5c6884; line-height: 1.65; }
.cy9-card-action {
  width: 100%; margin-top: 8px; padding: 7px 0; border-radius: 9px;
  border: 1px solid rgba(91,140,255,.34); background: rgba(91,140,255,.08);
  color: #9ec9ff; font-size: 10px; font-weight: 680;
  transition: background .14s;
}
.cy9-card-action:hover { background: rgba(91,140,255,.16); }

/* ===== 线程详情 ===== */
.cy9-thread-body { max-height: 240px; overflow-y: auto; }
.cy9-thread-body pre {
  margin: 0 0 8px; padding: 8px 10px; border-radius: 9px;
  background: rgba(6,10,20,.7); border: 1px solid var(--cy9-line);
  font-size: 10px; line-height: 1.6; color: #aab5d2; white-space: pre-wrap; word-break: break-word;
}
.cy9-thread-meta { font-size: 9px; color: #5c6884; margin-bottom: 6px; }

/* ===== 员工档案弹窗 ===== */
.cy9-profile-overlay {
  position: fixed; inset: 0; z-index: 120;
  display: grid; place-items: center;
  background: rgba(4,7,14,.66); backdrop-filter: blur(3px);
}
.cy9-profile {
  position: relative; width: 420px; max-width: calc(100vw - 40px); max-height: 76vh; overflow-y: auto;
  padding: 18px 18px 16px; border-radius: 16px;
  border: 1px solid rgba(139,108,255,.42);
  background: linear-gradient(180deg,rgba(14,21,40,.99),rgba(9,14,26,.99));
  box-shadow: 0 28px 70px rgba(0,0,0,.6), 0 0 40px rgba(109,74,255,.12);
}
.cy9-profile-close { position: absolute; top: 12px; right: 14px; font-size: 12px; color: #7d89a6; }
.cy9-profile-close:hover { color: #fff; }
.cy9-profile-head { display: flex; gap: 13px; }
.cy9-profile-head img { flex: none; width: 64px; height: 64px; border-radius: 14px; object-fit: cover; border: 1px solid rgba(139,108,255,.4); }
.cy9-profile-head b { display: block; font-size: 15px; color: #eef1fa; }
.cy9-profile-head span { font-size: 10px; color: #8b6cff; }
.cy9-profile-head p { margin: 6px 0 0; font-size: 10px; color: #8b96b4; line-height: 1.6; }
.cy9-profile-section { margin-top: 13px; }
.cy9-profile-section label { display: block; font-size: 8.5px; font-weight: 750; letter-spacing: .14em; color: #4d5872; margin-bottom: 6px; }
.cy9-profile-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.cy9-profile-chips span {
  padding: 3px 9px; border-radius: 7px; font-size: 9.5px; color: #c3cdf0;
  background: rgba(91,140,255,.10); border: 1px solid rgba(91,140,255,.26);
}
.cy9-profile-chips span.mono { font-family: ui-monospace,Consolas,monospace; font-size: 8.5px; color: #7d89a6; }
.cy9-profile-actions { display: flex; gap: 8px; margin-top: 16px; }
.cy9-profile-actions button {
  flex: 1; padding: 8px 0; border-radius: 10px; font-size: 10.5px; font-weight: 720;
  border: 1px solid rgba(139,108,255,.45); color: #cabfff; background: rgba(109,74,255,.14);
}
.cy9-profile-actions button:hover { background: rgba(109,74,255,.28); }

/* ===== 右栏抽屉（窄屏） ===== */
.cy9-rail-toggle {
  display: none; position: fixed; z-index: 90; right: 14px; bottom: 18px;
  width: 42px; height: 42px; border-radius: 50%;
  background: linear-gradient(135deg,#6d4aff,#46d2ff);
  color: #fff; font-size: 16px; box-shadow: 0 8px 24px rgba(109,74,255,.5);
}
@media (max-width: 1599px) {
  .cy9.cy9 .cy9-body { grid-template-columns: clamp(200px,15vw,232px) minmax(540px,1fr) 280px; }
}
@media (max-width: 1279px) {
  .cy9.cy9 .cy9-body { grid-template-columns: clamp(190px,16vw,220px) minmax(480px,1fr); }
  .cy9.cy9 .cy9-rail {
    display: none; position: fixed; z-index: 80; top: 90px; right: 14px; bottom: 14px;
    width: 314px; padding: 12px; border-radius: 16px;
    background: rgba(8,12,24,.98); border: 1px solid rgba(139,108,255,.4);
    box-shadow: 0 24px 60px rgba(0,0,0,.6);
  }
  .cy9.cy9 .cy9-rail.open { display: flex; }
  .cy9.cy9 .cy9-rail-toggle { display: grid; place-items: center; }
}
@media (max-width: 899px) {
  .cy9.cy9 .cy9-body { grid-template-columns: 178px minmax(430px,1fr); }
  .cy9.cy9 .cy9-collab-body { grid-template-columns: 112px minmax(0,1fr); }
  .cy9.cy9 .cy9-stats { display: none; }
}

/* ===== 动效（克制） ===== */
@keyframes cy9-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.045); } }
@keyframes cy9-dots { 0%,80%,100% { opacity: .25; } 40% { opacity: 1; } }
@keyframes cy9-glow { 0%,100% { box-shadow: inset 0 0 26px rgba(6,10,20,.5), 0 0 12px rgba(139,108,255,.12); } 50% { box-shadow: inset 0 0 26px rgba(6,10,20,.5), 0 0 22px rgba(139,108,255,.3); } }
@keyframes cy9-flicker { 0%,92%,100% { opacity: 1; } 95% { opacity: .82; } }
@keyframes cy9-slide { from { transform: translateX(0); } to { transform: translateX(180%); } }
`

export function installStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CY9_CSS
  document.head.appendChild(style)
}
