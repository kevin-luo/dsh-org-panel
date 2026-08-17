// 「赛博公司」client v4
// 复用 v2 的真实会话与状态逻辑，升级为 AI 总部控制台视觉，并注入扩展员工名册。
import { apply as applyV2 } from './client-v2'
import { EMPLOYEE_BLUEPRINTS, ROLE_BLUEPRINTS } from './org-blueprints'

const HQ_CSS = `
.dsh-org.dsh-org {
  --hq-bg: #070b14;
  --hq-bg-2: #090f1b;
  --hq-panel: #0c1321;
  --hq-panel-2: #101a2b;
  --hq-panel-3: #121f32;
  --hq-line: #1c2a42;
  --hq-line-strong: #29405d;
  --hq-text: #edf4ff;
  --hq-muted: #7f90aa;
  --hq-dim: #50617d;
  --hq-cyan: #44d8ff;
  --hq-blue: #4d7cff;
  --hq-violet: #8c63ff;
  --hq-pink: #d75cba;
  --hq-green: #58e6a9;
  --hq-amber: #f2c45f;
  --hq-red: #ff6f86;
  --org-bg: var(--hq-bg);
  --org-panel: var(--hq-panel);
  --org-panel-raised: var(--hq-panel-2);
  --org-panel-soft: var(--hq-panel-3);
  --org-ink: var(--hq-text);
  --org-muted: var(--hq-muted);
  --org-dim: var(--hq-dim);
  --org-line: var(--hq-line);
  --org-pink: var(--hq-violet);
  --org-yellow: var(--hq-cyan);
  --org-blue: var(--hq-cyan);
  --org-green: var(--hq-green);
  --org-red: var(--hq-red);
  height: calc(100dvh - 184px);
  padding: 12px 14px 14px;
  background:
    radial-gradient(circle at 78% 4%, rgba(78, 98, 255, .10), transparent 28%),
    radial-gradient(circle at 54% 100%, rgba(140, 99, 255, .05), transparent 30%),
    linear-gradient(180deg, #080c15, #060a12 72%);
  color: var(--hq-text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.dsh-org.dsh-org::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: .18;
  background-image: radial-gradient(rgba(107, 133, 180, .16) .6px, transparent .6px);
  background-size: 18px 18px;
  mask-image: linear-gradient(180deg, transparent, #000 18%, #000 78%, transparent);
}

.dsh-org.dsh-org .dsh-org-shell { gap: 0; }

/* ===== Header ===== */
.dsh-org.dsh-org .dsh-org-head {
  min-height: 62px;
  padding: 0 2px 10px;
  margin: 0;
}
.dsh-org.dsh-org .dsh-org-brand { gap: 12px; }
.dsh-org.dsh-org .dsh-org-mark {
  width: 42px;
  height: 42px;
  border: 1px solid rgba(68, 216, 255, .46);
  border-radius: 10px;
  background:
    linear-gradient(145deg, rgba(68,216,255,.20), rgba(140,99,255,.17)),
    #0d1727;
  color: #b9f5ff;
  box-shadow: inset 0 0 18px rgba(68,216,255,.08), 0 0 22px rgba(68,216,255,.06);
  font-size: 19px;
}
.dsh-org.dsh-org .dsh-org-kicker {
  color: #6c7f9b;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .16em;
}
.dsh-org.dsh-org .dsh-org-title {
  margin-top: 2px;
  color: #f4f7ff;
  font-size: clamp(18px, 1.6vw, 23px);
  letter-spacing: -.02em;
}
.dsh-org.dsh-org .dsh-org-sub {
  margin-top: 1px;
  color: #667995;
  font-size: 10px;
}
.dsh-org.dsh-org .dsh-org-head-right { gap: 10px; }
.dsh-org.dsh-org .dsh-org-live {
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid #193b38;
  border-radius: 8px;
  background: rgba(17, 46, 42, .30);
  color: var(--hq-green);
  font-size: 10px;
}
.dsh-org.dsh-org .dsh-org-live-dot {
  width: 6px;
  height: 6px;
  box-shadow: 0 0 0 4px rgba(88,230,169,.08), 0 0 10px rgba(88,230,169,.28);
}
.dsh-org.dsh-org .dsh-org-stats {
  overflow: hidden;
  border: 1px solid var(--hq-line);
  border-radius: 8px;
  background: rgba(10, 17, 30, .88);
}
.dsh-org.dsh-org .dsh-org-stat {
  min-width: 64px;
  padding: 6px 9px;
  border-left-color: var(--hq-line);
}
.dsh-org.dsh-org .dsh-org-stat-num { color: #f5f8ff; font-size: 14px; }
.dsh-org.dsh-org .dsh-org-stat-label { color: #60728d; font-size: 8px; }

/* ===== Brief ===== */
.dsh-org.dsh-org .dsh-org-brief {
  min-height: 46px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  margin: 0 0 8px;
  padding: 7px 10px;
  border: 1px solid #1a2a43;
  border-left: 1px solid #375b80;
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(68,216,255,.055), transparent 35%),
    rgba(11, 18, 32, .94);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.016);
}
.dsh-org.dsh-org .dsh-org-brief-mark {
  width: 30px;
  height: 30px;
  border: 1px solid #285072;
  border-radius: 8px;
  background: linear-gradient(145deg, rgba(68,216,255,.14), rgba(140,99,255,.11));
  color: var(--hq-cyan);
}
.dsh-org.dsh-org .dsh-org-brief-label { color: #7bdff4; font-size: 8px; letter-spacing: .12em; }
.dsh-org.dsh-org .dsh-org-brief-text { color: #afbdd0; font-size: 10px; }
.dsh-org.dsh-org .dsh-org-brief-tail { color: #657792; font-size: 9px; }

/* ===== Organization rail ===== */
.dsh-org.dsh-org .dsh-org-orgchart {
  min-height: 45px;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 8px;
  margin: 0 0 8px;
  padding: 5px 6px;
  border: 1px solid #18263d;
  border-radius: 7px;
  background: rgba(8, 13, 23, .78);
}
.dsh-org.dsh-org .dsh-org-orgchart-boss {
  min-height: 32px;
  padding: 6px 8px;
  border: 1px solid #423e75;
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(140,99,255,.10), rgba(68,216,255,.035));
}
.dsh-org.dsh-org .dsh-org-orgchart-boss::after { border-top-color: #3c4a70; width: 8px; }
.dsh-org.dsh-org .dsh-org-orgchart-boss strong { color: #dfe7ff; font-size: 9px; }
.dsh-org.dsh-org .dsh-org-orgchart-boss span { color: #647590; font-size: 7px; }
.dsh-org.dsh-org .dsh-org-orgchart-units { grid-template-columns: repeat(5, minmax(90px, 1fr)); gap: 5px; }
.dsh-org.dsh-org .dsh-org-orgchart-unit {
  padding: 5px 7px;
  border: 1px solid #1b2b43;
  border-radius: 5px;
  background: rgba(13, 21, 36, .82);
}
.dsh-org.dsh-org .dsh-org-orgchart-unit strong { color: #7e91b1; font-size: 7px; }
.dsh-org.dsh-org .dsh-org-orgchart-unit span { color: #566984; font-size: 7px; }

/* ===== Main layout ===== */
.dsh-org.dsh-org .dsh-org-workbench {
  grid-template-columns: clamp(238px, 15vw, 286px) minmax(0, 1fr);
  gap: 8px;
}
.dsh-org.dsh-org .dsh-org-center {
  grid-template-columns: minmax(0, 1fr) clamp(430px, 31vw, 610px);
  gap: 8px;
}
.dsh-org.dsh-org .dsh-org-panel,
.dsh-org.dsh-org .dsh-org-flow,
.dsh-org.dsh-org .dsh-org-office-shell {
  border: 1px solid var(--hq-line);
  border-radius: 8px;
  background: rgba(11, 18, 32, .94);
  box-shadow: 0 12px 34px rgba(0,0,0,.23), inset 0 1px 0 rgba(255,255,255,.012);
}
.dsh-org.dsh-org .dsh-org-panel-header {
  min-height: 43px;
  padding: 8px 10px;
  border-bottom-color: #1b2941;
}
.dsh-org.dsh-org .dsh-org-panel-title { color: #dfe8f7; font-size: 11px; }
.dsh-org.dsh-org .dsh-org-panel-caption { color: #5d708d; font-size: 8px; }

/* ===== Roster ===== */
.dsh-org.dsh-org .dsh-org-roster { background: rgba(9, 15, 26, .97); }
.dsh-org.dsh-org .dsh-org-roster-tools { padding: 8px; border-bottom-color: #17263d; }
.dsh-org.dsh-org .dsh-org-search {
  min-height: 32px;
  border: 1px solid #1b2d47;
  border-radius: 6px;
  background: #080e18;
}
.dsh-org.dsh-org .dsh-org-search-icon { color: #61799b; }
.dsh-org.dsh-org .dsh-org-search input { color: #d9e5f4; font-size: 10px; }
.dsh-org.dsh-org .dsh-org-filter-strip { gap: 4px; margin-top: 7px; }
.dsh-org.dsh-org .dsh-org-filter {
  min-height: 25px;
  padding: 3px 7px;
  border-color: #1b2b43;
  border-radius: 5px;
  color: #62748e;
  font-size: 8px;
}
.dsh-org.dsh-org .dsh-org-filter:hover,
.dsh-org.dsh-org .dsh-org-filter.active {
  border-color: #365e83;
  background: rgba(68,216,255,.06);
  color: #a9eefa;
}
.dsh-org.dsh-org .dsh-org-roster-list { gap: 0; padding: 5px; }
.dsh-org.dsh-org .dsh-org-roster-department { padding: 2px 0 5px; }
.dsh-org.dsh-org .dsh-org-roster-department + .dsh-org-roster-department { border-top: 1px solid #122037; }
.dsh-org.dsh-org .dsh-org-roster-department-title {
  min-height: 23px;
  padding: 3px 6px;
  color: #6885a9;
  font-size: 7px;
  letter-spacing: .08em;
}
.dsh-org.dsh-org .dsh-org-roster-department-title span { color: #40516b; font-size: 7px; }
.dsh-org.dsh-org .dsh-org-roster-row {
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 8px;
  min-height: 54px;
  padding: 7px 6px;
  border-radius: 6px;
}
.dsh-org.dsh-org .dsh-org-roster-row:hover {
  transform: none;
  border-color: #203450;
  background: #0d1727;
}
.dsh-org.dsh-org .dsh-org-roster-row.active {
  border-color: #385487;
  background: linear-gradient(90deg, rgba(76,124,255,.10), rgba(140,99,255,.04));
  box-shadow: inset 2px 0 0 var(--hq-cyan);
}
.dsh-org.dsh-org .dsh-org-roster-avatar {
  width: 32px;
  height: 32px;
  border: 1px solid #243650;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #1d2b42, #0c1422 74%);
  font-size: 15px;
}
.dsh-org.dsh-org .dsh-org-roster-avatar.running { border-color: #256d79; box-shadow: 0 0 10px rgba(68,216,255,.10); }
.dsh-org.dsh-org .dsh-org-roster-avatar.done { border-color: #255f4c; }
.dsh-org.dsh-org .dsh-org-roster-avatar.wait { border-color: #744052; }
.dsh-org.dsh-org .dsh-org-status-dot { width: 8px; height: 8px; border-color: #09111d; }
.dsh-org.dsh-org .dsh-org-roster-name { color: #d8e3f2; font-size: 10px; }
.dsh-org.dsh-org .dsh-org-roster-role { color: #657791; font-size: 8px; }
.dsh-org.dsh-org .dsh-org-roster-task { color: #4f6380; font-size: 8px; }
.dsh-org.dsh-org .dsh-org-roster-report { color: #465a77; font-size: 7px; }
.dsh-org.dsh-org .dsh-org-roster-state { font-size: 7px; }
.dsh-org.dsh-org .dsh-org-roster-footer { padding: 7px 9px; border-top-color: #17263d; color: #4f617b; font-size: 8px; }
.dsh-org.dsh-org .dsh-org-roster-footer-actions button { border-radius: 5px; }

/* ===== Conversation ===== */
.dsh-org.dsh-org .dsh-org-flow { background: #090f1a; }
.dsh-org.dsh-org .dsh-org-flow-head {
  min-height: 50px;
  padding: 9px 11px;
  border-bottom-color: #1a2940;
  background: linear-gradient(90deg, rgba(68,216,255,.045), transparent 46%);
}
.dsh-org.dsh-org .dsh-org-flow-icon {
  width: 30px;
  height: 30px;
  border: 1px solid #24425e;
  border-radius: 7px;
  background: #0a1724;
  color: #69dff1;
  font-size: 11px;
}
.dsh-org.dsh-org .dsh-org-flow-title { color: #e5edf8; font-size: 11px; }
.dsh-org.dsh-org .dsh-org-flow-notice { color: #526780; font-size: 8px; }
.dsh-org.dsh-org .dsh-org-flow-state { color: var(--hq-green); font-size: 8px; }
.dsh-org.dsh-org .dsh-org-flow-toolbar {
  padding: 6px 9px;
  border-bottom-color: #16243a;
  background: #080e18;
}
.dsh-org.dsh-org .dsh-org-flow-tab,
.dsh-org.dsh-org .dsh-org-flow-prompt {
  min-height: 26px;
  padding: 4px 8px;
  border-color: #1a2a42;
  border-radius: 5px;
  color: #5f728f;
  font-size: 8px;
}
.dsh-org.dsh-org .dsh-org-flow-tab:hover,
.dsh-org.dsh-org .dsh-org-flow-tab.active,
.dsh-org.dsh-org .dsh-org-flow-prompt:hover {
  border-color: #2d5877;
  background: rgba(68,216,255,.05);
  color: #9deaf6;
}
.dsh-org.dsh-org .dsh-org-flow-body {
  gap: 10px;
  padding: 12px 11px 18px;
  background:
    radial-gradient(circle at 20% 0, rgba(68,216,255,.018), transparent 26%),
    #080e18;
}
.dsh-org.dsh-org .dsh-org-flow-row { gap: 8px; }
.dsh-org.dsh-org .dsh-org-flow-avatar {
  width: 29px;
  height: 29px;
  border: 1px solid #253852;
  border-radius: 50%;
  background: #0e1929;
  color: #8194b1;
  font-size: 9px;
}
.dsh-org.dsh-org .dsh-org-flow-row.user .dsh-org-flow-avatar { border-color: #514579; color: #c7b7ff; }
.dsh-org.dsh-org .dsh-org-flow-row.employee .dsh-org-flow-avatar { border-color: #246150; background: rgba(88,230,169,.055); }
.dsh-org.dsh-org .dsh-org-flow-meta { color: #52657f; font-size: 8px; }
.dsh-org.dsh-org .dsh-org-flow-role-badge { color: #57bda0; font-size: 8px; }
.dsh-org.dsh-org .dsh-org-flow-bubble {
  padding: 9px 11px;
  border: 1px solid #1d2c45;
  border-radius: 7px;
  background: #0d1625;
  color: #b9c6d8;
  font-size: 10px;
  line-height: 1.65;
}
.dsh-org.dsh-org .dsh-org-flow-row.user .dsh-org-flow-bubble {
  border-color: #3a3a68;
  background: linear-gradient(135deg, rgba(140,99,255,.105), rgba(76,124,255,.045));
}
.dsh-org.dsh-org .dsh-org-flow-row.employee .dsh-org-flow-bubble {
  border-color: #214b42;
  background: linear-gradient(135deg, rgba(88,230,169,.06), rgba(68,216,255,.02));
}
.dsh-org.dsh-org .dsh-org-reasoning,
.dsh-org.dsh-org .dsh-org-trace {
  border-color: #1b2a41;
  border-radius: 6px;
  background: #0a111e;
}
.dsh-org.dsh-org .dsh-org-reasoning summary { color: #6791ad; font-size: 8px; }
.dsh-org.dsh-org .dsh-org-reasoning-text,
.dsh-org.dsh-org .dsh-org-trace-code { color: #7c8da5; font-size: 8px; background: #060b13; }
.dsh-org.dsh-org .dsh-org-trace summary { min-height: 34px; color: #61738d; font-size: 8px; }
.dsh-org.dsh-org .dsh-org-trace-name { color: #9eadc2; }
.dsh-org.dsh-org .dsh-org-flow-notice-row { color: #71849e; font-size: 8px; background: rgba(68,216,255,.025); border-left-color: #365874; }

/* ===== Office HQ ===== */
.dsh-org.dsh-org .dsh-org-office-shell {
  position: relative;
  overflow: hidden;
  border-color: #243655;
  background: #080e17;
  box-shadow: 0 15px 38px rgba(0,0,0,.28), 0 0 0 1px rgba(68,216,255,.018);
}
.dsh-org.dsh-org .dsh-org-office-shell::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 19;
  pointer-events: none;
  border-radius: 8px;
  box-shadow: inset 0 0 44px rgba(19, 55, 91, .12);
}
.dsh-org.dsh-org .dsh-org-office-header {
  min-height: 48px;
  padding: 8px 10px;
  border-bottom: 1px solid #1d2c44;
  background:
    linear-gradient(90deg, rgba(68,216,255,.055), rgba(140,99,255,.025) 54%, transparent),
    #0b1320;
}
.dsh-org.dsh-org .dsh-org-office-title { color: #dbe9f7; font-size: 11px; letter-spacing: .02em; }
.dsh-org.dsh-org .dsh-org-office-caption { color: #526781; font-size: 8px; }
.dsh-org.dsh-org .dsh-org-office-legend { gap: 7px; }
.dsh-org.dsh-org .dsh-org-legend { color: #60748e; font-size: 7px; }
.dsh-org.dsh-org .dsh-org-legend-dot {
  width: 6px; height: 6px; border: 0; border-radius: 50%; box-shadow: 0 0 7px currentColor;
}
.dsh-org.dsh-org .dsh-org-office-canvas {
  flex: 1 1 auto !important;
  height: auto !important;
  min-height: 540px !important;
  overflow: hidden;
  background:
    linear-gradient(rgba(68,216,255,.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(68,216,255,.035) 1px, transparent 1px),
    radial-gradient(circle at 47% 57%, rgba(76,124,255,.08), transparent 28%),
    linear-gradient(180deg, #0b1421 0 22%, #09111c 22% 100%);
  background-size: 20px 20px, 20px 20px, 100% 100%, 100% 100%;
  image-rendering: auto;
}
.dsh-org.dsh-org .dsh-org-office-canvas::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 12;
  pointer-events: none;
  background:
    linear-gradient(90deg, transparent, rgba(68,216,255,.028) 50%, transparent),
    repeating-linear-gradient(180deg, rgba(255,255,255,.017) 0 1px, transparent 1px 4px);
  mix-blend-mode: screen;
}
.dsh-org.dsh-org .dsh-org-office-wall {
  display: block !important;
  inset: 0 0 77%;
  background:
    radial-gradient(circle at 80% 26%, rgba(216,92,186,.055), transparent 18%),
    linear-gradient(90deg, transparent 48%, rgba(68,216,255,.045) 48% 48.4%, transparent 48.4%),
    #0b1421;
}
.dsh-org.dsh-org .dsh-org-office-floor {
  display: block !important;
  inset: 23% 0 0;
  background:
    linear-gradient(135deg, rgba(76,124,255,.024) 25%, transparent 25%, transparent 75%, rgba(76,124,255,.024) 75%),
    #09111c;
  background-size: 18px 18px;
}
.dsh-org.dsh-org .dsh-org-office-window {
  display: block !important;
  left: 3%; top: 4%; width: 18%; height: 13%;
  border: 1px solid #253a53;
  border-radius: 4px;
  background:
    radial-gradient(circle at 12% 24%, #d85cba 0 1px, transparent 2px),
    radial-gradient(circle at 78% 18%, #44d8ff 0 1px, transparent 2px),
    radial-gradient(circle at 50% 42%, #f2c45f 0 1px, transparent 2px),
    repeating-linear-gradient(90deg, #0b1930 0 10px, #071120 10px 14px),
    linear-gradient(#10203c, #08101d);
  box-shadow: inset 0 0 18px rgba(68,216,255,.09);
}
.dsh-org.dsh-org .dsh-org-office-window::before { border-left: 1px solid #253a53; }
.dsh-org.dsh-org .dsh-org-office-window::after { border-top: 1px solid #253a53; }
.dsh-org.dsh-org .dsh-org-wall-clock {
  left: auto; right: 3%; top: 5%; width: 78px; height: 27px;
  border: 1px solid #233650; border-radius: 5px;
  background: #07101c; color: #7ce7f6;
  box-shadow: inset 0 0 14px rgba(68,216,255,.05);
  font: 700 9px ui-monospace, Consolas, monospace;
}
.dsh-org.dsh-org .dsh-org-wall-clock::before { display: none; }
.dsh-org.dsh-org .dsh-org-company-board {
  left: 24%; top: 4%; width: 48%; min-height: 43px;
  padding: 7px 10px; border: 1px solid #2d3c62; border-radius: 5px;
  background: linear-gradient(90deg, rgba(76,124,255,.075), rgba(140,99,255,.05)), #0c1524;
  box-shadow: 0 0 22px rgba(76,124,255,.04);
}
.dsh-org.dsh-org .dsh-org-company-board strong { color: #dce9ff; font-size: 11px; letter-spacing: .08em; }
.dsh-org.dsh-org .dsh-org-company-board span { color: #596e8b; font-size: 7px; }
.dsh-org.dsh-org .dsh-org-hours-board {
  display: block !important;
  left: 24%; right: auto; top: 14.5%; width: 72%;
  padding: 4px 7px; border: 1px solid #182840; border-radius: 4px;
  background: rgba(6, 12, 21, .70); color: #50647f;
  box-shadow: none; font-size: 6px; line-height: 1.4;
}
.dsh-org.dsh-org .dsh-org-hours-board strong { color: #7b92b3; }

.dsh-org.dsh-org .dsh-org-office-room {
  display: block !important;
  border: 1px solid #1c3048;
  border-radius: 5px;
  background: rgba(10, 19, 31, .88);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.012), 0 8px 18px rgba(0,0,0,.09);
}
.dsh-org.dsh-org .dsh-org-office-room.reception { left: 2.5%; top: 26%; width: 19%; height: 30%; border-top-color: #695081; background: linear-gradient(180deg, rgba(216,92,186,.045), transparent 30%), #0b1420; }
.dsh-org.dsh-org .dsh-org-office-room.work { left: 23%; top: 26%; width: 49%; height: 69%; border-top-color: #286b82; background: linear-gradient(180deg, rgba(68,216,255,.035), transparent 30%), #0a131f; }
.dsh-org.dsh-org .dsh-org-office-room.meeting { right: 2.5%; top: 26%; width: 23%; height: 32%; border-top-color: #544779; background: linear-gradient(180deg, rgba(140,99,255,.045), transparent 32%), #0b1420; }
.dsh-org.dsh-org .dsh-org-office-room.lounge { right: 2.5%; bottom: 5%; width: 23%; height: 32%; border-top-color: #285c4f; background: linear-gradient(180deg, rgba(88,230,169,.035), transparent 30%), #0b1420; }
.dsh-org.dsh-org .dsh-org-office-room.restroom { left: 2.5%; bottom: 5%; width: 10%; height: 31%; border-top-color: #28566c; }
.dsh-org.dsh-org .dsh-org-office-room.balcony { left: 13.5%; bottom: 5%; width: 8%; height: 31%; border-top-color: #655f43; }
.dsh-org.dsh-org .dsh-org-office-label {
  display: block !important;
  z-index: 4;
  padding: 3px 6px;
  border: 1px solid #1c2e47;
  border-radius: 4px;
  background: rgba(5,10,18,.88);
  color: #70839f;
  font-size: 7px;
  font-weight: 700;
  letter-spacing: .04em;
}
.dsh-org.dsh-org .dsh-org-office-label.reception { left: 3.5%; top: 27.5%; color: #b18bb4; }
.dsh-org.dsh-org .dsh-org-office-label.work { left: 24%; top: 27.5%; color: #70b7c7; }
.dsh-org.dsh-org .dsh-org-office-label.meeting { right: 3.5%; top: 27.5%; color: #9888be; }
.dsh-org.dsh-org .dsh-org-office-label.lounge { right: 3.5%; bottom: 6.5%; color: #6fa58e; }
.dsh-org.dsh-org .dsh-org-office-label.restroom { left: 3.5%; bottom: 6.5%; }
.dsh-org.dsh-org .dsh-org-office-label.balcony { left: 14.5%; bottom: 6.5%; }

.dsh-org.dsh-org .dsh-org-furniture,
.dsh-org.dsh-org .dsh-org-office-plant { display: block !important; }
.dsh-org.dsh-org .dsh-org-furniture { border: 1px solid #26394e; border-radius: 3px; box-shadow: 0 4px 8px rgba(0,0,0,.10); }
.dsh-org.dsh-org .dsh-org-furniture.desk { width: 12%; height: 6%; background: linear-gradient(#18283a, #101b2a); }
.dsh-org.dsh-org .dsh-org-furniture.desk::before {
  left: 28%; top: -15px; width: 30px; height: 18px;
  border: 1px solid #2a425a; border-radius: 2px;
  background: linear-gradient(135deg, rgba(68,216,255,.13), rgba(76,124,255,.04)), #06101c;
  box-shadow: inset 0 0 0 1px rgba(68,216,255,.20), 0 0 9px rgba(68,216,255,.06);
  animation: hq-monitor 3.2s ease-in-out infinite;
}
@keyframes hq-monitor { 50% { box-shadow: inset 0 0 0 1px rgba(68,216,255,.34), 0 0 13px rgba(68,216,255,.11); } }
.dsh-org.dsh-org .dsh-org-furniture.desk::after { border-color: #26394e; background: #111d2b; }
.dsh-org.dsh-org .dsh-org-furniture.frontdesk { background: linear-gradient(180deg, #17283a, #101b29); }
.dsh-org.dsh-org .dsh-org-furniture.frontdesk::before { color: #5f7999; font-size: 6px; }
.dsh-org.dsh-org .dsh-org-furniture.meeting-table { border-radius: 12px; background: linear-gradient(145deg, #202847, #151c31); }
.dsh-org.dsh-org .dsh-org-furniture.sofa { border-radius: 7px; background: #18302d; }
.dsh-org.dsh-org .dsh-org-furniture.coffee { background: #182636; }
.dsh-org.dsh-org .dsh-org-furniture.restroom-door { background: #173040; }
.dsh-org.dsh-org .dsh-org-furniture.smoke { background: #1b2838; }
.dsh-org.dsh-org .dsh-org-office-plant { border-color: #24394a; background: #172537; }
.dsh-org.dsh-org .dsh-org-office-plant::before { color: #316d59; filter: saturate(.8); }

/* New employee fixed zones so expanded staff never fall outside the canvas. */
.dsh-org.dsh-org .dsh-org-avatar.staff-search-specialist { --avatar-x: 31cqw !important; --avatar-y: 61cqh !important; }
.dsh-org.dsh-org .dsh-org-avatar.staff-image-creator { --avatar-x: 48cqw !important; --avatar-y: 61cqh !important; }
.dsh-org.dsh-org .dsh-org-avatar.staff-video-producer { --avatar-x: 64cqw !important; --avatar-y: 61cqh !important; }
.dsh-org.dsh-org .dsh-org-avatar.staff-novelist { --avatar-x: 31cqw !important; --avatar-y: 84cqh !important; }
.dsh-org.dsh-org .dsh-org-avatar.staff-social-editor { --avatar-x: 48cqw !important; --avatar-y: 84cqh !important; }
.dsh-org.dsh-org .dsh-org-avatar.staff-data-analyst { --avatar-x: 64cqw !important; --avatar-y: 84cqh !important; }
.dsh-org.dsh-org .dsh-org-avatar.staff-growth { --avatar-x: 86cqw !important; --avatar-y: 78cqh !important; }

.dsh-org.dsh-org .dsh-org-avatar {
  display: grid !important;
  width: 48px;
  min-height: 58px;
  transform: translate(var(--avatar-x), var(--avatar-y)) translate(-50%, -50%) scale(.72);
  filter: drop-shadow(0 4px 7px rgba(0,0,0,.32));
}
.dsh-org.dsh-org .dsh-org-avatar:hover,
.dsh-org.dsh-org .dsh-org-avatar.active {
  filter: brightness(1.12) drop-shadow(0 0 10px rgba(68,216,255,.17));
}
.dsh-org.dsh-org .dsh-org-avatar-head { border-color: #1b2030; }
.dsh-org.dsh-org .dsh-org-avatar-body { border-color: #1b2030; }
.dsh-org.dsh-org .dsh-org-avatar-name {
  margin-top: 0;
  padding: 1px 4px;
  border: 1px solid #263a54;
  border-radius: 3px;
  background: rgba(5, 10, 18, .92);
  color: #b8c6d8;
  font-size: 7px;
}
.dsh-org.dsh-org .dsh-org-avatar-state { display: none; }
.dsh-org.dsh-org .dsh-org-avatar.status-running .dsh-org-avatar-name { border-color: #28657a; color: #8ddfeb; }
.dsh-org.dsh-org .dsh-org-avatar.status-done .dsh-org-avatar-name { border-color: #2c5f4f; color: #8fceb1; }
.dsh-org.dsh-org .dsh-org-avatar.status-wait .dsh-org-avatar-name { border-color: #704151; color: #e59bac; }
.dsh-org.dsh-org .dsh-org-avatar.status-running::after,
.dsh-org.dsh-org .dsh-org-avatar.status-wait::after,
.dsh-org.dsh-org .dsh-org-avatar.status-done::after {
  content: '';
  position: absolute;
  left: 50%; top: -4px;
  width: 5px; height: 5px;
  border-radius: 50%;
  transform: translateX(-50%);
  background: var(--hq-cyan);
  box-shadow: 0 0 9px currentColor;
}
.dsh-org.dsh-org .dsh-org-avatar.status-done::after { background: var(--hq-green); }
.dsh-org.dsh-org .dsh-org-avatar.status-wait::after { background: var(--hq-red); animation: hq-alert .8s steps(2,end) infinite; }
@keyframes hq-alert { 50% { opacity: .25; } }
.dsh-org.dsh-org .dsh-org-avatar-speech {
  bottom: calc(100% + 5px);
  max-width: 150px;
  padding: 5px 7px;
  border: 1px solid #314b66;
  border-radius: 5px;
  background: #07101c;
  color: #a9bdd2;
  box-shadow: 0 8px 20px rgba(0,0,0,.28);
  font-size: 7px;
}
.dsh-org.dsh-org .dsh-org-office-compact { display: none !important; }
.dsh-org.dsh-org .dsh-org-office-footer {
  min-height: 34px;
  padding: 7px 9px;
  border-top: 1px solid #1b2a41;
  background: #080e18;
  color: #536681;
  font-size: 8px;
}
.dsh-org.dsh-org .dsh-org-office-footer strong { color: #8ca0bf; }

/* Context / modal */
.dsh-org.dsh-org .dsh-org-context-card,
.dsh-org.dsh-org .dsh-org-activity-card,
.dsh-org.dsh-org .dsh-org-modal {
  border-color: #253957;
  border-radius: 8px;
  background: #0b1321;
  box-shadow: 0 20px 52px rgba(0,0,0,.38);
}
.dsh-org.dsh-org .dsh-org-context-avatar,
.dsh-org.dsh-org .dsh-org-modal-emoji {
  border-color: #35527b;
  border-radius: 8px;
  background: #101b2c;
}
.dsh-org.dsh-org .dsh-org-context-action { border-radius: 5px; border-color: #4569b0; background: #3158aa; }
.dsh-org.dsh-org .dsh-org-context-action.secondary { border-color: #263951; background: transparent; }
.dsh-org.dsh-org .dsh-org-modal-mask { backdrop-filter: blur(8px); background: rgba(3,6,11,.70); }

@media (max-width: 1480px) {
  .dsh-org.dsh-org .dsh-org-center { grid-template-columns: minmax(0, 1fr) 430px; }
  .dsh-org.dsh-org .dsh-org-sub { display: none; }
  .dsh-org.dsh-org .dsh-org-orgchart-unit span { display: none; }
}

@media (max-width: 1180px) {
  .dsh-org.dsh-org .dsh-org-center { grid-template-columns: minmax(0, 1fr) 380px; }
  .dsh-org.dsh-org .dsh-org-company-board span { display: none; }
  .dsh-org.dsh-org .dsh-org-hours-board { display: none !important; }
  .dsh-org.dsh-org .dsh-org-office-canvas { min-height: 500px !important; }
}

@media (max-width: 900px) {
  .dsh-org.dsh-org { height: auto; min-height: 0; overflow: visible; }
  .dsh-org.dsh-org .dsh-org-workbench { grid-template-columns: 1fr; }
  .dsh-org.dsh-org .dsh-org-center { grid-template-columns: 1fr; grid-template-rows: minmax(520px, 1fr) 390px; }
  .dsh-org.dsh-org .dsh-org-roster-list { max-height: 260px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dsh-org.dsh-org .dsh-org-orgchart { display: none; }
  .dsh-org.dsh-org .dsh-org-office-canvas { min-height: 330px !important; }
}

@media (max-width: 620px) {
  .dsh-org.dsh-org .dsh-org-head-right { width: 100%; flex-wrap: wrap; }
  .dsh-org.dsh-org .dsh-org-stats { flex: 1; }
  .dsh-org.dsh-org .dsh-org-stat { min-width: 0; flex: 1; }
  .dsh-org.dsh-org .dsh-org-brief-tail { display: none; }
  .dsh-org.dsh-org .dsh-org-roster-list { grid-template-columns: 1fr; }
  .dsh-org.dsh-org .dsh-org-center { grid-template-rows: minmax(480px, 1fr) 300px; }
  .dsh-org.dsh-org .dsh-org-office-room,
  .dsh-org.dsh-org .dsh-org-office-label,
  .dsh-org.dsh-org .dsh-org-furniture,
  .dsh-org.dsh-org .dsh-org-office-plant,
  .dsh-org.dsh-org .dsh-org-avatar { display: none !important; }
  .dsh-org.dsh-org .dsh-org-office-compact { display: grid !important; background: #080e18; }
  .dsh-org.dsh-org .dsh-org-office-canvas { flex: 0 0 122px !important; min-height: 122px !important; height: 122px !important; }
  .dsh-org.dsh-org .dsh-org-wall-clock { right: 4%; }
  .dsh-org.dsh-org .dsh-org-company-board { left: 25%; width: 48%; }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-org.dsh-org *,
  .dsh-org.dsh-org *::before,
  .dsh-org.dsh-org *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
`

const STYLE_ID = 'dsh-org-panel-hq-v4'

function installHQTheme() {
  if (typeof document === 'undefined') return
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== HQ_CSS) style.textContent = HQ_CSS
}

function defaultConfig(config?: any) {
  const next = { ...(config || {}) }
  if (!Array.isArray(next.staff) || next.staff.length === 0) {
    next.staff = EMPLOYEE_BLUEPRINTS.map((item) => ({
      id: item.id,
      name: item.name,
      role: item.role,
      emoji: item.emoji,
      intro: item.intro,
      roleId: item.roleId,
      department: item.department,
      reportsTo: item.reportsTo,
      aliases: item.aliases,
      lines: item.lines,
    }))
  }
  if (!Array.isArray(next.roles) || next.roles.length === 0) next.roles = ROLE_BLUEPRINTS
  if (!next.companyName) next.companyName = '赛博公司'
  if (!next.tabLabel) next.tabLabel = 'AI 员工总部'
  return next
}

export function apply(ctx: any, config?: any) {
  applyV2(ctx, defaultConfig(config))
  installHQTheme()
}
