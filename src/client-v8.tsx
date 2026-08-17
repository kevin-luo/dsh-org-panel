// 「赛博公司」client v8
// 设计稿对齐版：左员工 / 中央活办公室 / 右经营控制台。
// 不再在“AI 员工总部”里重复塞聊天主窗口；聊天继续使用 DSH 原生「对话」Tab。
// 办公室全部使用 DOM + CSS 像素场景，不使用 SVG 线框图。
import { apply as applyV7 } from './client-v7'

const STYLE_ID = 'dsh-org-panel-hq-v8'

const HQ_V8_CSS = String.raw`
.dsh-org.dsh-org[data-hq-v8="1"] {
  --hq8-bg: #070d12;
  --hq8-panel: #0a1219;
  --hq8-panel-2: #0d1820;
  --hq8-panel-3: #101d26;
  --hq8-line: rgba(120,153,169,.17);
  --hq8-line-hi: rgba(91,214,198,.34);
  --hq8-text: #edf3f4;
  --hq8-muted: #84959c;
  --hq8-dim: #566870;
  --hq8-teal: #5fd7c7;
  --hq8-teal2: #3bb8ac;
  --hq8-blue: #69a8c9;
  --hq8-violet: #8e80c7;
  --hq8-green: #59d39c;
  --hq8-amber: #d3a85e;
  --hq8-red: #db7183;
  --hq8-pink: #d883ae;
  height: calc(100dvh - 112px) !important;
  min-height: 650px !important;
  padding: 10px 12px 12px !important;
  overflow: hidden !important;
  background:
    radial-gradient(circle at 69% -10%, rgba(78,139,149,.14), transparent 30%),
    radial-gradient(circle at 23% 110%, rgba(49,112,108,.07), transparent 32%),
    linear-gradient(180deg,#071017,#060b10 76%) !important;
  color: var(--hq8-text) !important;
}

.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-shell {
  display: grid !important;
  grid-template-rows: 66px minmax(0,1fr) !important;
  gap: 10px !important;
  height: 100% !important;
  min-height: 0 !important;
}

/* ===== 顶部：像设计稿一样收成一条指挥栏 ===== */
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-head {
  height: 66px !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 15px !important;
  border: 1px solid rgba(112,145,160,.16) !important;
  border-radius: 14px !important;
  background:
    radial-gradient(circle at 16% 0%, rgba(93,215,199,.045), transparent 30%),
    linear-gradient(180deg,rgba(11,21,28,.98),rgba(7,14,20,.98)) !important;
  box-shadow: 0 16px 38px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.018) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-brand { gap: 12px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-mark {
  width: 39px !important;
  height: 39px !important;
  border: 1px solid rgba(95,215,199,.40) !important;
  border-radius: 11px !important;
  background: linear-gradient(145deg,rgba(95,215,199,.15),rgba(70,119,133,.07)),#0a1b21 !important;
  color: #a8f1e8 !important;
  font-size: 17px !important;
  box-shadow: inset 0 0 16px rgba(95,215,199,.055), 0 0 18px rgba(95,215,199,.04) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-kicker {
  color: #5f747d !important;
  font-size: 7px !important;
  font-weight: 760 !important;
  letter-spacing: .18em !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-title {
  margin-top: 3px !important;
  color: #e8f0f2 !important;
  font-size: 17px !important;
  font-weight: 760 !important;
  letter-spacing: -.018em !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-sub { display:none !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-head-right { gap:8px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-live {
  min-height:34px !important;
  padding:0 10px !important;
  border:1px solid rgba(89,211,156,.20) !important;
  border-radius:9px !important;
  background:rgba(12,38,32,.32) !important;
  color:#79ddae !important;
  font-size:8px !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-live-dot {
  width:6px !important;height:6px !important;
  box-shadow:0 0 0 4px rgba(89,211,156,.055),0 0 9px rgba(89,211,156,.18) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-stats {
  height:38px !important;
  overflow:hidden !important;
  border:1px solid rgba(111,142,157,.17) !important;
  border-radius:9px !important;
  background:rgba(5,11,16,.72) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-stat { min-width:58px !important;padding:5px 8px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-stat-num { color:#dce8ea !important;font-size:13px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-stat-label { color:#5c7078 !important;font-size:7px !important; }
.hq8-head-clock {
  min-width:78px;
  padding-left:11px;
  margin-left:2px;
  border-left:1px solid rgba(107,137,151,.14);
  color:#d4e1e4;
  font:760 10px ui-monospace,SFMono-Regular,Consolas,monospace;
  line-height:1.25;
}
.hq8-head-clock small { display:block;margin-top:2px;color:#596c74;font-size:6px;font-weight:650;letter-spacing:.07em; }

/* 旧经营简报/组织结构挤占了一整块高度：总部页直接去掉。 */
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-brief,
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-orgchart,
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-focus { display:none !important; }

/* ===== 核心结构：设计稿三栏 ===== */
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-workbench {
  display:grid !important;
  grid-template-columns: clamp(250px,16vw,292px) minmax(610px,1fr) clamp(292px,20vw,344px) !important;
  grid-template-rows:minmax(0,1fr) !important;
  gap:12px !important;
  width:100% !important;
  height:100% !important;
  min-height:0 !important;
  overflow:hidden !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-center { display:contents !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-flow { display:none !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster { grid-column:1 !important;grid-row:1 !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-office-shell { grid-column:2 !important;grid-row:1 !important; }
.hq8-right-rail { grid-column:3;grid-row:1;min-width:0;min-height:0;display:grid;grid-template-rows:auto minmax(180px,.95fr) minmax(188px,1fr) auto;gap:10px;overflow:hidden; }

/* ===== 左栏：员工像“角色”，不再像日志条目 ===== */
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster {
  min-width:0 !important;
  min-height:0 !important;
  border:1px solid var(--hq8-line) !important;
  border-radius:14px !important;
  overflow:hidden !important;
  background:linear-gradient(180deg,rgba(10,19,26,.98),rgba(7,14,20,.99)) !important;
  box-shadow:0 16px 38px rgba(0,0,0,.19),inset 0 1px 0 rgba(255,255,255,.015) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-panel-header {
  min-height:48px !important;
  padding:10px 12px !important;
  border-bottom:1px solid rgba(111,145,160,.12) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-panel-title { color:#e0e9eb !important;font-size:11px !important;font-weight:760 !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-panel-caption { color:#60737b !important;font-size:8px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster-tools { padding:9px 10px !important;border-bottom-color:rgba(105,138,152,.10) !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-search {
  min-height:35px !important;
  border:1px solid rgba(106,143,159,.18) !important;
  border-radius:9px !important;
  background:#071016 !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-search input { color:#cdd9dc !important;font-size:9px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-filter-strip { gap:5px !important;margin-top:8px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-filter {
  min-height:26px !important;
  padding:3px 7px !important;
  border:1px solid rgba(102,134,148,.14) !important;
  border-radius:999px !important;
  background:rgba(8,17,23,.72) !important;
  color:#657980 !important;
  font-size:7px !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-filter.active {
  border-color:rgba(95,215,199,.28) !important;
  background:rgba(52,140,129,.10) !important;
  color:#9be7dc !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster-list { padding:5px 8px 8px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster-department { padding:2px 0 7px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster-department-title {
  min-height:23px !important;
  padding:4px 6px !important;
  color:#5e747b !important;
  font-size:7px !important;
  letter-spacing:.08em !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster-row {
  grid-template-columns:42px minmax(0,1fr) auto !important;
  gap:9px !important;
  min-height:62px !important;
  margin:3px 0 !important;
  padding:7px 8px !important;
  border:1px solid transparent !important;
  border-radius:10px !important;
  background:linear-gradient(90deg,rgba(16,30,39,.62),rgba(9,18,25,.22)) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster-row:hover {
  transform:none !important;
  border-color:rgba(95,215,199,.16) !important;
  background:linear-gradient(90deg,rgba(20,40,48,.82),rgba(10,22,29,.44)) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster-row.active {
  border-color:rgba(95,215,199,.30) !important;
  background:linear-gradient(90deg,rgba(49,128,119,.14),rgba(69,91,135,.055)) !important;
  box-shadow:inset 2px 0 0 var(--hq8-teal) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster-avatar {
  width:40px !important;height:40px !important;
  border:1px solid rgba(111,153,164,.23) !important;
  border-radius:10px !important;
  background:radial-gradient(circle at 36% 25%,#19343d,#0a1720 73%) !important;
  font-size:17px !important;
  box-shadow:inset 0 0 12px rgba(95,215,199,.035) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster-name { color:#dce6e8 !important;font-size:10px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster-role { margin-top:2px !important;color:#71838a !important;font-size:8px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster-task { margin-top:3px !important;color:#536970 !important;font-size:7px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster-state { color:#65787f !important;font-size:7px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster-footer { min-height:39px !important;padding:8px 10px !important;color:#566970 !important;font-size:7px !important; }

/* ===== 中央办公室：取消“缩小版监控大屏”，做成真正的场景 ===== */
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-office-shell {
  position:relative !important;
  display:grid !important;
  grid-template-rows:58px minmax(0,1fr) 38px !important;
  min-width:0 !important;
  min-height:0 !important;
  overflow:hidden !important;
  border:1px solid var(--hq8-line) !important;
  border-radius:14px !important;
  background:#091116 !important;
  box-shadow:0 18px 44px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.015) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-office-shell::before {
  border-color:rgba(95,215,199,.08) !important;
  border-radius:14px !important;
  box-shadow:inset 0 0 52px rgba(49,117,110,.025) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-office-header {
  min-height:0 !important;
  height:58px !important;
  padding:10px 13px !important;
  border-bottom:1px solid rgba(109,143,157,.14) !important;
  background:linear-gradient(90deg,rgba(46,115,107,.08),rgba(9,18,25,.97) 38%,rgba(76,73,126,.035)) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-office-title { color:#e5edef !important;font-size:12px !important;font-weight:760 !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-office-caption { margin-top:3px !important;color:#61757c !important;font-size:7px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-office-legend { gap:8px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-legend { color:#65777e !important;font-size:7px !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-office-canvas {
  position:relative !important;
  height:auto !important;
  min-height:0 !important;
  overflow:hidden !important;
  container-type:size !important;
  background:
    radial-gradient(ellipse at 72% 12%,rgba(73,142,151,.10),transparent 30%),
    radial-gradient(ellipse at 28% 82%,rgba(49,99,91,.055),transparent 33%),
    linear-gradient(180deg,#0c1820 0 17%,#101b20 17.2% 18%,#172126 18.2% 100%) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-office-canvas::before {
  content:'' !important;
  position:absolute !important;
  inset:18% 0 0 !important;
  z-index:0 !important;
  opacity:1 !important;
  pointer-events:none !important;
  background:
    linear-gradient(90deg,rgba(103,129,133,.055) 1px,transparent 1px),
    linear-gradient(rgba(103,129,133,.045) 1px,transparent 1px),
    repeating-linear-gradient(0deg,rgba(255,255,255,.008) 0 1px,transparent 1px 24px),
    linear-gradient(180deg,#1a2428,#121b1f 68%,#10181c) !important;
  background-size:44px 44px,44px 44px,100% 24px,100% 100% !important;
  mix-blend-mode:normal !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-office-canvas::after {
  content:'' !important;
  position:absolute !important;
  inset:0 !important;
  z-index:28 !important;
  pointer-events:none !important;
  box-shadow:inset 0 0 85px rgba(0,0,0,.36),inset 0 46px 58px rgba(3,9,12,.24) !important;
  background:linear-gradient(180deg,rgba(255,255,255,.008),transparent 10%,transparent 90%,rgba(0,0,0,.12)) !important;
}

/* 去掉 v6 的“每个部门一个发光框”视觉，保留 DOM 但把它装修成办公室墙体/地毯。 */
.hq6-architecture {
  inset:19% 2.2% 4.5% !important;
  gap:7px !important;
  perspective:none !important;
  z-index:2 !important;
}
.hq6-architecture::before {
  inset:0 !important;
  border:0 !important;
  border-radius:8px !important;
  background:transparent !important;
  box-shadow:none !important;
}
.hq6-zone {
  border:0 !important;
  border-radius:8px !important;
  overflow:visible !important;
  background:rgba(12,21,25,.56) !important;
  box-shadow:inset 0 0 0 1px rgba(125,148,153,.09),0 7px 14px rgba(0,0,0,.10) !important;
}
.hq6-zone::before {
  left:5px !important;right:5px !important;top:31px !important;bottom:5px !important;
  border-top:1px solid rgba(var(--zone),.055) !important;
  border-radius:4px !important;
  opacity:.54 !important;
  background:
    linear-gradient(90deg,rgba(var(--zone),.018) 1px,transparent 1px),
    linear-gradient(rgba(var(--zone),.018) 1px,transparent 1px) !important;
  background-size:18px 18px !important;
}
.hq6-zone::after { display:none !important; }
.hq6-zone-head {
  height:31px !important;
  padding:0 9px !important;
  border-bottom:1px solid rgba(124,150,153,.08) !important;
  border-radius:8px 8px 0 0 !important;
  background:linear-gradient(90deg,rgba(var(--zone),.07),rgba(10,18,22,.35)) !important;
}
.hq6-zone-title { color:rgba(var(--zone),.90) !important;font-size:7px !important;font-weight:780 !important;letter-spacing:.07em !important;text-shadow:none !important; }
.hq6-zone-stat { color:#607177 !important;font-size:6px !important; }

/* 真实桌子：深木桌面 + 屏幕，不画 SVG。 */
.hq6-desk-grid { left:10px !important;right:10px !important;top:42px !important;bottom:11px !important;gap:9px !important;align-items:center !important; }
.hq6-desk {
  height:32px !important;
  margin:17px 4px 4px !important;
  border:1px solid rgba(128,117,101,.22) !important;
  border-radius:4px !important;
  background:linear-gradient(180deg,#594b3f,#3b342e 36%,#29272a) !important;
  box-shadow:0 6px 0 #17171a,0 8px 13px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.035) !important;
}
.hq6-desk::before {
  top:-28px !important;
  width:36px !important;height:23px !important;
  border:3px solid #202b30 !important;
  border-radius:3px !important;
  background:
    linear-gradient(135deg,transparent 0 25%,rgba(var(--zone),.22) 26% 28%,transparent 29% 57%,rgba(var(--zone),.12) 58% 60%,transparent 61%),
    linear-gradient(180deg,#0b1b20,#071217) !important;
  box-shadow:inset 0 0 10px rgba(var(--zone),.10),0 3px 9px rgba(0,0,0,.24) !important;
}
.hq6-desk::after { top:-6px !important;height:6px !important;background:#303a3c !important; }
.hq6-meeting-table {
  left:17% !important;right:17% !important;top:35% !important;height:38% !important;
  border:1px solid rgba(135,122,162,.25) !important;
  background:radial-gradient(ellipse at center,#403c45,#2b2930 58%,#211f25 62%) !important;
  box-shadow:0 7px 0 #151419,0 11px 18px rgba(0,0,0,.20),inset 0 1px 0 rgba(255,255,255,.025) !important;
}
.hq6-meeting-table::before {
  inset:29% !important;
  border-color:rgba(105,194,190,.24) !important;
  background:radial-gradient(circle,rgba(73,171,166,.11),transparent 70%) !important;
  box-shadow:0 0 16px rgba(78,180,172,.08) !important;
}
.hq6-lounge-sofa {
  left:12% !important;right:12% !important;top:44% !important;height:32% !important;
  border-color:rgba(89,128,105,.24) !important;
  background:linear-gradient(180deg,#315647,#213f35) !important;
  box-shadow:0 6px 0 #152820,0 10px 16px rgba(0,0,0,.17),inset 0 1px 0 rgba(255,255,255,.03) !important;
}
.hq6-floor-core { display:none !important; }
.hq6-floor-rail { opacity:.13 !important;box-shadow:none !important; }

/* 墙面三联窗 / 霓虹公司牌 / 植物与地毯，全部 DOM/CSS。 */
.hq8-scene-decor { position:absolute;inset:0;z-index:1;pointer-events:none; }
.hq8-window-row { position:absolute;left:3%;right:3%;top:3%;height:11%;display:grid;grid-template-columns:1fr 1.7fr 1fr;gap:10px; }
.hq8-window {
  position:relative;
  overflow:hidden;
  border:1px solid rgba(83,123,135,.28);
  border-radius:6px;
  background:
    radial-gradient(circle at 16% 38%,#d2ab67 0 1px,transparent 2px),
    radial-gradient(circle at 72% 27%,#5bc2c3 0 1px,transparent 2px),
    radial-gradient(circle at 84% 69%,#aa7096 0 1px,transparent 2px),
    linear-gradient(180deg,#10242e,#0a171e 58%,#071015 59%);
  box-shadow:inset 0 0 18px rgba(80,168,174,.055),0 6px 12px rgba(0,0,0,.15);
}
.hq8-window::before { content:'';position:absolute;left:33%;top:0;bottom:0;width:1px;background:rgba(112,147,155,.20);box-shadow:calc(33cqw) 0 0 rgba(112,147,155,.20); }
.hq8-window.hero {
  display:grid;place-items:center;
  border-color:rgba(95,215,199,.24);
  background:linear-gradient(180deg,#12242a,#0b171c) !important;
}
.hq8-window.hero strong { color:#d8e8e8;font-size:11px;letter-spacing:.13em; }
.hq8-window.hero small { display:block;margin-top:3px;color:#657a7e;font-size:6px;letter-spacing:.06em;text-align:center; }
.hq8-office-badge { position:absolute;left:3.5%;top:16.2%;color:#70848a;font:700 6px ui-monospace,monospace;letter-spacing:.12em; }
.hq8-office-badge b { color:#8cded2;font-weight:800; }
.hq8-plant { position:absolute;width:28px;height:32px;bottom:4%;z-index:4; }
.hq8-plant::before { content:'';position:absolute;left:7px;bottom:10px;width:15px;height:15px;border-radius:60% 10% 60% 10%;background:#285747;transform:rotate(-22deg);box-shadow:9px -7px 0 #2e6652,1px -12px 0 #346f59; }
.hq8-plant::after { content:'';position:absolute;left:8px;bottom:0;width:15px;height:12px;border-radius:2px 2px 5px 5px;background:#694c3d;box-shadow:inset 0 2px 0 rgba(255,255,255,.04); }
.hq8-plant.p1{left:2.8%}.hq8-plant.p2{right:2.8%}.hq8-plant.p3{left:49%;bottom:3.2%;transform:scale(.75)}
.hq8-rug { position:absolute;left:29%;right:29%;bottom:4.5%;height:10%;border-radius:50%;background:radial-gradient(ellipse,rgba(42,96,88,.17),rgba(22,52,49,.10) 55%,transparent 70%);filter:blur(.3px); }

/* 员工：更像真正的像素角色，取消“小方块人”。 */
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-avatar {
  display:grid !important;
  width:66px !important;
  min-height:86px !important;
  z-index:13 !important;
  transform:translate(var(--avatar-x),var(--avatar-y)) translate(-50%,-50%) scale(.92) !important;
  filter:drop-shadow(0 8px 5px rgba(0,0,0,.33)) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-avatar:hover,
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-avatar.active {
  z-index:24 !important;
  transform:translate(var(--avatar-x),var(--avatar-y)) translate(-50%,calc(-50% - 6px)) scale(1) !important;
  filter:brightness(1.08) drop-shadow(0 0 13px rgba(95,215,199,.14)) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-avatar-shadow { width:35px !important;height:8px !important;bottom:12px !important;background:rgba(0,0,0,.30) !important;filter:blur(1px) !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-avatar-head {
  width:30px !important;height:27px !important;
  border:3px solid #172024 !important;
  border-radius:7px 7px 4px 4px !important;
  background:linear-gradient(180deg,#e0b393,#c78b70) !important;
  box-shadow:inset 0 -3px 0 rgba(91,49,45,.08),2px 2px 0 rgba(14,19,22,.70) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-avatar-head::before {
  left:-3px !important;top:-8px !important;width:30px !important;height:10px !important;
  border:3px solid #172024 !important;border-bottom:0 !important;border-radius:7px 7px 1px 1px !important;
  background:#23292c !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-avatar-eyes { top:12px !important;background:#1b2428 !important;box-shadow:10px 0 0 #1b2428 !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-avatar-body {
  width:35px !important;height:27px !important;
  border:3px solid #151e22 !important;
  border-radius:4px 4px 2px 2px !important;
  background:linear-gradient(180deg,#3c6970,#294a52) !important;
  box-shadow:inset 0 -8px 0 rgba(255,255,255,.035) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-avatar-legs { width:27px !important;height:8px !important;background:linear-gradient(90deg,#263238 0 40%,transparent 40% 60%,#263238 60%) !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-avatar-accessory {
  right:1px !important;top:31px !important;width:18px !important;height:18px !important;
  border:1px solid rgba(96,168,169,.35) !important;border-radius:4px !important;
  background:#0a171b !important;color:#8be2d7 !important;box-shadow:none !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-avatar-name {
  margin-top:3px !important;padding:2px 6px !important;
  border:0 !important;border-radius:4px !important;
  background:rgba(5,11,14,.86) !important;color:#dce5e6 !important;
  font-size:8px !important;box-shadow:0 3px 8px rgba(0,0,0,.18) !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-avatar.status-running .dsh-org-avatar-name { color:#b8eee7 !important;box-shadow:inset 0 -1px 0 rgba(95,215,199,.30),0 3px 8px rgba(0,0,0,.18) !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-avatar.status-done .dsh-org-avatar-name { color:#bce9d0 !important;box-shadow:inset 0 -1px 0 rgba(89,211,156,.26),0 3px 8px rgba(0,0,0,.18) !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-avatar.status-wait .dsh-org-avatar-name { color:#efb3bd !important;box-shadow:inset 0 -1px 0 rgba(219,113,131,.35),0 3px 8px rgba(0,0,0,.18) !important; }

/* 部门服装差异 */
.dsh-org.dsh-org[data-hq-v8="1"] .staff-tech-lead .dsh-org-avatar-body,
.dsh-org.dsh-org[data-hq-v8="1"] .staff-developer .dsh-org-avatar-body { background:linear-gradient(180deg,#396977,#284e59) !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .staff-platform .dsh-org-avatar-body { background:linear-gradient(180deg,#4a6976,#314850) !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .staff-pm .dsh-org-avatar-body { background:linear-gradient(180deg,#7b704d,#564c34) !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .staff-researcher .dsh-org-avatar-body,
.dsh-org.dsh-org[data-hq-v8="1"] .staff-search-specialist .dsh-org-avatar-body { background:linear-gradient(180deg,#4d6579,#344656) !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .staff-image-creator .dsh-org-avatar-body { background:linear-gradient(180deg,#795879,#543e56) !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .staff-video-producer .dsh-org-avatar-body { background:linear-gradient(180deg,#6a5c83,#493e5d) !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .staff-novelist .dsh-org-avatar-body,
.dsh-org.dsh-org[data-hq-v8="1"] .staff-social-editor .dsh-org-avatar-body { background:linear-gradient(180deg,#765c67,#503f49) !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .staff-data-analyst .dsh-org-avatar-body,
.dsh-org.dsh-org[data-hq-v8="1"] .staff-growth .dsh-org-avatar-body { background:linear-gradient(180deg,#6c684b,#484633) !important; }

/* v2 旧墙面组件全部隐藏，v8 自己装修。 */
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-office-window,
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-company-board,
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-hours-board,
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-wall-clock,
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-office-compact,
.dsh-org.dsh-org[data-hq-v8="1"] .hq6-intel-strip { display:none !important; }
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-office-footer {
  min-height:38px !important;
  padding:0 12px !important;
  border-top:1px solid rgba(109,143,157,.12) !important;
  background:#081117 !important;
  color:#5e7279 !important;
  font-size:7px !important;
}
.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-office-footer strong { color:#a8c2c4 !important; }

/* ===== 右栏：真正的经营控制台 ===== */
.hq8-card {
  min-width:0;
  overflow:hidden;
  border:1px solid var(--hq8-line);
  border-radius:13px;
  background:linear-gradient(180deg,rgba(11,21,28,.98),rgba(7,14,19,.99));
  box-shadow:0 14px 32px rgba(0,0,0,.16),inset 0 1px 0 rgba(255,255,255,.014);
}
.hq8-card-head { display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:43px;padding:9px 11px;border-bottom:1px solid rgba(108,140,154,.11); }
.hq8-card-head strong { color:#dde7e9;font-size:10px;font-weight:760; }
.hq8-card-head small { color:#5d7077;font-size:6px;letter-spacing:.06em; }
.hq8-kpi-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:9px; }
.hq8-kpi { padding:9px 8px;border:1px solid rgba(107,139,152,.11);border-radius:9px;background:rgba(8,16,21,.62); }
.hq8-kpi b { display:block;color:#d9e6e7;font:760 15px ui-monospace,monospace; }
.hq8-kpi span { display:block;margin-top:3px;color:#5e7178;font-size:6px; }
.hq8-kpi.live b{color:#8fe0d5}.hq8-kpi.done b{color:#8fdbb3}.hq8-kpi.wait b{color:#dfa0aa}
.hq8-brief { padding:0 11px 11px;color:#84959b;font-size:8px;line-height:1.55; }
.hq8-task-list { min-height:0;max-height:100%;overflow:auto;padding:7px 8px 10px;scrollbar-width:thin; }
.hq8-task { display:grid;grid-template-columns:8px minmax(0,1fr) auto;gap:8px;align-items:start;padding:9px 7px;border-bottom:1px solid rgba(104,135,147,.085); }
.hq8-task:last-child{border-bottom:0}.hq8-task-dot{width:6px;height:6px;margin-top:4px;border-radius:50%;background:#53656c}.hq8-task.running .hq8-task-dot{background:var(--hq8-teal);box-shadow:0 0 8px rgba(95,215,199,.22)}.hq8-task.done .hq8-task-dot{background:var(--hq8-green)}.hq8-task.wait .hq8-task-dot{background:var(--hq8-red)}
.hq8-task strong { display:block;color:#cbd7d9;font-size:8px;font-weight:700; }.hq8-task small{display:block;margin-top:3px;color:#5b6f76;font-size:6px;line-height:1.45}.hq8-task em{color:#6b7e84;font:650 6px ui-monospace,monospace;font-style:normal}
.hq8-empty { padding:18px 12px;color:#5b6d73;font-size:8px;text-align:center; }
.hq8-growth-body { display:grid;gap:7px;padding:9px; }
.hq8-growth-line { display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:8px;align-items:center;padding:7px 6px;border-radius:8px;background:rgba(8,17,22,.62); }
.hq8-growth-icon { display:grid;place-items:center;width:30px;height:30px;border:1px solid rgba(99,148,151,.18);border-radius:8px;background:#0c1b20;font-size:13px; }
.hq8-growth-copy b{display:block;color:#cdd9da;font-size:8px}.hq8-growth-copy span{display:block;margin-top:2px;color:#5d7076;font-size:6px;line-height:1.45}.hq8-growth-level{color:#82cfc5;font:700 7px ui-monospace,monospace}
.hq8-actions { display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 9px 9px; }
.hq8-action { min-height:31px;padding:5px 8px;border:1px solid rgba(95,215,199,.18);border-radius:8px;background:rgba(38,101,95,.09);color:#91d8cf;font-size:7px;cursor:pointer; }.hq8-action:hover{border-color:rgba(95,215,199,.34);background:rgba(38,101,95,.15)}
.hq8-action.secondary{border-color:rgba(116,132,170,.15);background:rgba(59,70,103,.07);color:#8997b5}
.hq8-bottom-card { padding:10px; }.hq8-bottom-title{color:#cbd8da;font-size:9px;font-weight:730}.hq8-bottom-copy{margin-top:4px;color:#61747a;font-size:6px;line-height:1.55}.hq8-market-row{display:flex;align-items:center;gap:6px;margin-top:8px}.hq8-market-chip{padding:4px 7px;border:1px solid rgba(102,139,152,.13);border-radius:999px;color:#647a80;font-size:6px;background:rgba(7,15,20,.62)}.hq8-market-chip.live{border-color:rgba(95,215,199,.17);color:#79cfc4}

@media (max-width: 1500px) {
  .dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-workbench { grid-template-columns:240px minmax(560px,1fr) 292px !important;gap:9px !important; }
  .dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-avatar { transform:translate(var(--avatar-x),var(--avatar-y)) translate(-50%,-50%) scale(.82) !important; }
}
@media (max-width: 1220px) {
  .dsh-org.dsh-org[data-hq-v8="1"] { height:auto !important;overflow:visible !important; }
  .dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-shell { height:auto !important; }
  .dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-workbench { grid-template-columns:250px minmax(0,1fr) !important;grid-template-rows:650px auto !important;overflow:visible !important; }
  .dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-roster{grid-column:1 !important;grid-row:1 !important}.dsh-org.dsh-org[data-hq-v8="1"] .dsh-org-office-shell{grid-column:2 !important;grid-row:1 !important}.hq8-right-rail{grid-column:1 / -1;grid-row:2;grid-template-columns:1fr 1fr 1fr;grid-template-rows:auto;overflow:visible}.hq8-right-rail>.hq8-card{min-height:190px}.hq8-right-rail>.hq8-bottom-card{min-height:auto}
}
`

function installStyle() {
  if (typeof document === 'undefined') return
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== HQ_V8_CSS) style.textContent = HQ_V8_CSS
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function composer(root: HTMLElement): HTMLTextAreaElement | null {
  const scroll = root.closest('[data-conversation-scroll]')
  return (scroll?.querySelector('[data-composer-seat] textarea') || document.querySelector('[data-composer-seat] textarea')) as HTMLTextAreaElement | null
}

function draft(root: HTMLElement, value: string) {
  const input = composer(root)
  if (!input) return
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (setter) setter.call(input, value)
  else input.value = value
  input.dispatchEvent(new Event('input', { bubbles:true }))
  input.dispatchEvent(new Event('change', { bubbles:true }))
  input.focus()
}

function buildSceneDecor(canvas: HTMLElement) {
  if (canvas.querySelector('.hq8-scene-decor')) return
  const wrap = el('div','hq8-scene-decor')
  const windows = el('div','hq8-window-row')
  windows.append(el('div','hq8-window'), el('div','hq8-window hero'), el('div','hq8-window'))
  const hero = windows.children[1] as HTMLElement
  hero.append(el('div','hq8-hero-copy'))
  hero.firstElementChild!.append(el('strong','', '赛博公司'))
  hero.firstElementChild!.append(el('small','', 'AI EMPLOYEE HEADQUARTERS · ONLINE'))
  wrap.append(windows, el('div','hq8-office-badge'))
  const badge = wrap.querySelector('.hq8-office-badge') as HTMLElement
  badge.innerHTML = '<b>CYBER OFFICE</b> / DIGITAL TWIN FLOOR'
  wrap.append(el('div','hq8-plant p1'),el('div','hq8-plant p2'),el('div','hq8-plant p3'),el('div','hq8-rug'))
  const architecture = canvas.querySelector('.hq6-architecture')
  canvas.insertBefore(wrap, architecture || canvas.firstChild)
}

function buildHeadClock(root: HTMLElement) {
  const right = root.querySelector('.dsh-org-head-right')
  if (!(right instanceof HTMLElement) || right.querySelector('.hq8-head-clock')) return
  const clock = el('time','hq8-head-clock')
  const small = el('small','', 'HEADQUARTERS TIME')
  clock.appendChild(small)
  right.appendChild(clock)
  const update = () => {
    const now = new Date()
    const textNode = Array.from(clock.childNodes).find((node) => node.nodeType === Node.TEXT_NODE)
    const value = now.toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'}) + ' '
    if (textNode) textNode.textContent = value
    else clock.insertBefore(document.createTextNode(value),small)
    clock.dateTime = now.toISOString()
  }
  update()
}

function taskRows(root: HTMLElement): { state:string; name:string; role:string; task:string }[] {
  return Array.from(root.querySelectorAll('.dsh-org-roster-row')).map((node) => {
    const row = node as HTMLElement
    const state = ['running','done','wait','idle'].find((item) => row.classList.contains(item)) || 'idle'
    return {
      state,
      name: row.querySelector('.dsh-org-roster-name')?.childNodes[0]?.textContent?.trim() || row.querySelector('.dsh-org-roster-name')?.textContent?.trim() || '员工',
      role: row.querySelector('.dsh-org-roster-role')?.textContent?.trim() || '',
      task: row.querySelector('.dsh-org-roster-task')?.textContent?.trim() || '',
    }
  })
}

function createCardHead(title:string, caption:string) {
  const head = el('div','hq8-card-head')
  head.append(el('strong','',title),el('small','',caption))
  return head
}

function actionButton(root:HTMLElement, label:string, prompt:string, secondary=false) {
  const button = el('button','hq8-action'+(secondary?' secondary':''),label)
  button.type='button'
  button.addEventListener('click',()=>draft(root,prompt))
  return button
}

function buildRightRail(root: HTMLElement) {
  const workbench = root.querySelector('.dsh-org-workbench')
  if (!(workbench instanceof HTMLElement) || workbench.querySelector('.hq8-right-rail')) return
  const rail = el('aside','hq8-right-rail')

  const overview = el('section','hq8-card hq8-overview')
  overview.appendChild(createCardHead('今日经营','LIVE COMPANY PULSE'))
  const kpis = el('div','hq8-kpi-grid')
  kpis.append(el('div','hq8-kpi live'),el('div','hq8-kpi done'),el('div','hq8-kpi wait'))
  ;(kpis.children[0] as HTMLElement).innerHTML='<b data-kpi="running">0</b><span>正在干活</span>'
  ;(kpis.children[1] as HTMLElement).innerHTML='<b data-kpi="done">0</b><span>今日交付</span>'
  ;(kpis.children[2] as HTMLElement).innerHTML='<b data-kpi="wait">0</b><span>等待处理</span>'
  overview.append(kpis,el('div','hq8-brief','公司在线，秘书负责统筹；员工的真实执行状态会同步到办公室。'))

  const tasks = el('section','hq8-card hq8-tasks')
  tasks.appendChild(createCardHead('当前任务','REAL-TIME WORK'))
  tasks.appendChild(el('div','hq8-task-list'))

  const growth = el('section','hq8-card hq8-growth')
  growth.appendChild(createCardHead('员工成长','MEMORY · SKILLS · XP'))
  const body = el('div','hq8-growth-body')
  const rows = [
    ['🧠','长期记忆','项目事实、偏好、踩坑经验沉淀','MEM'],
    ['✦','技能进化','真实任务后复盘并提升熟练度','XP'],
    ['⌘','插件学习','从 DSH 社区发现并验证新能力','PLUGIN'],
  ]
  for (const [icon,title,copy,level] of rows) {
    const row = el('div','hq8-growth-line')
    row.append(el('span','hq8-growth-icon',icon),el('div','hq8-growth-copy'),el('span','hq8-growth-level',level))
    ;(row.children[1] as HTMLElement).innerHTML=`<b>${title}</b><span>${copy}</span>`
    body.appendChild(row)
  }
  const actions = el('div','hq8-actions')
  actions.append(
    actionButton(root,'查看成长档案','帮我汇总全体员工的成长档案：等级、最近长期记忆、技能熟练度、成功/失败经验，以及下一步最值得补强的能力。'),
    actionButton(root,'扫描能力缺口','扫描当前 DSH / Cordis / MCP / Tool Registry 已安装能力，按每个员工岗位列出能力覆盖和缺口，不要虚构。',true),
  )
  growth.append(body,actions)

  const market = el('section','hq8-card hq8-bottom-card')
  market.append(el('div','hq8-bottom-title','DSH 社区插件市场'),el('div','hq8-bottom-copy','能力不足时，员工可以从 awesome-dsh-plugin 与 GitHub dsh-plugin 生态发现插件。首次安装必须经过老板批准。'))
  const chips = el('div','hq8-market-row')
  chips.append(el('span','hq8-market-chip live','● 市场在线'),el('span','hq8-market-chip','800+ 社区插件'))
  market.appendChild(chips)
  const marketActions = el('div','hq8-actions')
  marketActions.style.padding='9px 0 0'
  marketActions.append(
    actionButton(root,'搜索新能力','@大壮 去 DSH 社区插件市场搜索适合当前公司和各岗位的新插件。列出插件用途、stars、风险、仓库与安装命令；不要安装，等我批准。'),
    actionButton(root,'让员工自检','让所有员工根据自己的岗位、已有技能和最近任务，自检目前最缺的一个能力；需要插件时去 DSH 社区市场检索候选，但先不要安装。',true),
  )
  market.appendChild(marketActions)

  rail.append(overview,tasks,growth,market)
  workbench.appendChild(rail)
}

function refreshRail(root: HTMLElement) {
  const rows = taskRows(root)
  const counts = {
    running: rows.filter((row)=>row.state==='running').length,
    done: rows.filter((row)=>row.state==='done').length,
    wait: rows.filter((row)=>row.state==='wait').length,
  }
  for (const [key,value] of Object.entries(counts)) {
    const node = root.querySelector(`[data-kpi="${key}"]`)
    if (node) node.textContent=String(value)
  }
  const list = root.querySelector('.hq8-task-list')
  if (!(list instanceof HTMLElement)) return
  const active = rows.filter((row)=>row.state!=='idle').slice(0,7)
  const signature = JSON.stringify(active)
  if (list.dataset.signature===signature) return
  list.dataset.signature=signature
  list.replaceChildren()
  if (!active.length) {
    list.appendChild(el('div','hq8-empty','暂时没有进行中的业务，员工正在待命。'))
    return
  }
  for (const item of active) {
    const row=el('div',`hq8-task ${item.state}`)
    row.append(el('i','hq8-task-dot'),el('div','hq8-task-copy'),el('em','',item.state==='running'?'进行中':item.state==='done'?'已交付':'卡住'))
    ;(row.children[1] as HTMLElement).innerHTML=`<strong>${item.name} · ${item.role}</strong><small>${item.task || '状态同步中'}</small>`
    list.appendChild(row)
  }
}

function decorate(root: HTMLElement) {
  root.dataset.hqV8='1'
  const canvas=root.querySelector('.dsh-org-office-canvas')
  if (canvas instanceof HTMLElement) buildSceneDecor(canvas)
  buildRightRail(root)
  buildHeadClock(root)
  refreshRail(root)
}

function installEnhancements() {
  if (typeof document==='undefined') return ()=>undefined
  let queued=false
  const run=()=>{
    queued=false
    document.querySelectorAll('.dsh-org').forEach((node)=>{ if(node instanceof HTMLElement) decorate(node) })
  }
  const queue=()=>{ if(queued)return;queued=true;requestAnimationFrame(run) }
  queue()
  const observer=new MutationObserver((records)=>{
    // 过滤自己右侧栏的文本刷新，避免观察器自激。
    const meaningful=records.some((record)=>{
      const target=record.target instanceof Element?record.target:record.target.parentElement
      return !target?.closest?.('.hq8-right-rail,.hq8-head-clock')
    })
    if(meaningful) queue()
  })
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']})
  const timer=window.setInterval(()=>{
    document.querySelectorAll('.dsh-org[data-hq-v8="1"]').forEach((node)=>{ if(node instanceof HTMLElement){buildHeadClock(node);refreshRail(node)} })
  },1000)
  return ()=>{observer.disconnect();window.clearInterval(timer)}
}

export function apply(ctx:any,config?:any) {
  applyV7(ctx,config)
  installStyle()
  const dispose=installEnhancements()
  if(ctx?.effect) ctx.effect(()=>dispose,'dsh-org-panel: hq-v8 design-aligned headquarters')
}
