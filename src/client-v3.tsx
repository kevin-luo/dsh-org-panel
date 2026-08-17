// 「赛博公司」DSH 插件 —— visual layer v3
// 保留 v2 的真实会话 / 员工路由逻辑，只替换办公室视觉层。
import { apply as applyV2 } from './client-v2'

const CYBER_OFFICE_V3_CSS = `
/* Cyber Office v3 — visual override for the compact office sidebar. */
.dsh-org.dsh-org {
  --office-void: #0a0d12;
  --office-shell: #10151d;
  --office-panel: #151c26;
  --office-panel-2: #1a2430;
  --office-line: #2b3a48;
  --office-grid: rgba(93, 226, 255, .07);
  --office-cyan: #6ee7f5;
  --office-pink: #ef5b91;
  --office-amber: #ffd76a;
  --office-green: #73e2a7;
  --office-red: #ff7a7a;
}

/* Keep the merged three-column workbench, but give the office enough room to read. */
.dsh-org.dsh-org .dsh-org-center {
  grid-template-columns: minmax(0, 1fr) clamp(390px, 27vw, 520px);
  gap: 10px;
}

.dsh-org.dsh-org .dsh-org-office-shell {
  position: relative;
  border: 1px solid #344657;
  background: var(--office-shell);
  box-shadow: 0 0 0 1px rgba(110, 231, 245, .06), 0 18px 42px rgba(0, 0, 0, .34);
  overflow: hidden;
}

.dsh-org.dsh-org .dsh-org-office-shell::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  border-top: 2px solid rgba(239, 91, 145, .72);
  box-shadow: inset 0 0 34px rgba(110, 231, 245, .025);
}

.dsh-org.dsh-org .dsh-org-office-header {
  min-height: 44px;
  padding: 8px 10px;
  border-bottom: 1px solid #304150;
  background:
    linear-gradient(90deg, rgba(239, 91, 145, .14), transparent 38%),
    #121923;
}

.dsh-org.dsh-org .dsh-org-office-title {
  color: #fff1bd;
  font-size: 12px;
  letter-spacing: .03em;
}

.dsh-org.dsh-org .dsh-org-office-caption {
  color: #778998;
  font-size: 9px;
}

.dsh-org.dsh-org .dsh-org-legend {
  color: #8495a2;
  font-size: 8px;
}

.dsh-org.dsh-org .dsh-org-legend-dot {
  width: 6px;
  height: 6px;
  border: 0;
  border-radius: 50%;
  box-shadow: 0 0 7px currentColor;
}

/* The previous container query hid the whole visual map at normal sidebar widths.
   Force the real office back on desktop and remove the fallback card grid. */
.dsh-org.dsh-org .dsh-org-office-canvas {
  flex: 1 1 auto !important;
  height: auto !important;
  min-height: 520px !important;
  overflow: hidden;
  background-color: #0f151d;
  background-image:
    linear-gradient(rgba(110, 231, 245, .055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(110, 231, 245, .055) 1px, transparent 1px),
    radial-gradient(circle at 65% 48%, rgba(110, 231, 245, .06), transparent 30%),
    radial-gradient(circle at 15% 85%, rgba(239, 91, 145, .05), transparent 22%);
  background-size: 22px 22px, 22px 22px, 100% 100%, 100% 100%;
  image-rendering: pixelated;
}

.dsh-org.dsh-org .dsh-org-office-canvas::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 16;
  pointer-events: none;
  opacity: .13;
  background: repeating-linear-gradient(180deg, rgba(255,255,255,.06) 0, rgba(255,255,255,.06) 1px, transparent 1px, transparent 4px);
  mix-blend-mode: screen;
}

.dsh-org.dsh-org .dsh-org-office-canvas::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 15;
  pointer-events: none;
  box-shadow: inset 0 0 72px rgba(0,0,0,.38), inset 0 36px 60px rgba(0,0,0,.22);
}

.dsh-org.dsh-org .dsh-org-office-wall {
  display: block !important;
  inset: 0 0 76%;
  background:
    linear-gradient(180deg, rgba(239,91,145,.06), transparent 72%),
    linear-gradient(#24303d 1px, transparent 1px),
    linear-gradient(90deg, #24303d 1px, transparent 1px),
    #111821;
  background-size: 100% 100%, 28px 18px, 56px 18px, auto;
}

.dsh-org.dsh-org .dsh-org-office-floor {
  display: block !important;
  inset: 24% 0 0;
  background:
    linear-gradient(135deg, rgba(110,231,245,.025) 25%, transparent 25%, transparent 75%, rgba(110,231,245,.025) 75%),
    #101720;
  background-size: 22px 22px;
}

.dsh-org.dsh-org .dsh-org-office-window {
  display: block !important;
  left: 3.5%;
  top: 4.5%;
  width: 18%;
  height: 14%;
  border: 2px solid #3e5364;
  background:
    radial-gradient(circle at 22% 34%, #ffd76a 0 2px, transparent 3px),
    radial-gradient(circle at 68% 20%, #ef5b91 0 2px, transparent 3px),
    radial-gradient(circle at 76% 72%, #6ee7f5 0 2px, transparent 3px),
    linear-gradient(180deg, #172335, #0a1017);
  box-shadow: inset 0 0 18px rgba(110,231,245,.12), 3px 3px 0 rgba(0,0,0,.38);
}
.dsh-org.dsh-org .dsh-org-office-window::before { border-left: 2px solid #3e5364; }
.dsh-org.dsh-org .dsh-org-office-window::after { border-top: 2px solid #3e5364; }

.dsh-org.dsh-org .dsh-org-wall-clock {
  left: auto;
  right: 4%;
  top: 5.5%;
  width: 76px;
  height: 28px;
  border: 1px solid #3b4f5f;
  border-radius: 0;
  background: #0a1118;
  color: var(--office-cyan);
  box-shadow: inset 0 0 12px rgba(110,231,245,.08), 3px 3px 0 rgba(0,0,0,.3);
  font: 800 10px ui-monospace, Consolas, monospace;
  letter-spacing: .04em;
}
.dsh-org.dsh-org .dsh-org-wall-clock::before {
  display: none;
}

.dsh-org.dsh-org .dsh-org-company-board {
  left: 24%;
  top: 4.5%;
  width: 48%;
  min-height: 44px;
  padding: 7px 10px;
  border: 1px solid #4b3850;
  border-left: 3px solid var(--office-pink);
  background: linear-gradient(90deg, rgba(239,91,145,.08), transparent), #141a24;
  box-shadow: 3px 3px 0 rgba(0,0,0,.32);
}
.dsh-org.dsh-org .dsh-org-company-board strong {
  color: #ffe7a0;
  font-size: 12px;
  letter-spacing: .08em;
}
.dsh-org.dsh-org .dsh-org-company-board span {
  margin-top: 2px;
  color: #8696a4;
  font-size: 7px;
}

.dsh-org.dsh-org .dsh-org-hours-board {
  display: block !important;
  left: 24%;
  right: auto;
  top: 15.5%;
  width: 72%;
  padding: 5px 8px;
  border: 1px solid #2c3b48;
  background: rgba(10, 15, 21, .78);
  color: #788b99;
  box-shadow: none;
  font-size: 7px;
  line-height: 1.45;
}
.dsh-org.dsh-org .dsh-org-hours-board strong { color: #f1c762; }

/* Clear room hierarchy: raised modules with neon status rails instead of beige boxes. */
.dsh-org.dsh-org .dsh-org-office-room {
  display: block !important;
  border: 1px solid #2d3d4a;
  background: rgba(18, 27, 36, .88);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.018), 3px 3px 0 rgba(0,0,0,.2);
}
.dsh-org.dsh-org .dsh-org-office-room.reception {
  left: 2.5%; top: 27%; width: 19%; height: 30%;
  border-top-color: rgba(239,91,145,.62);
  background: linear-gradient(180deg, rgba(239,91,145,.05), transparent 32%), rgba(18,27,36,.9);
}
.dsh-org.dsh-org .dsh-org-office-room.work {
  left: 23%; top: 27%; width: 49%; height: 68%;
  border-top-color: rgba(110,231,245,.58);
  background: linear-gradient(180deg, rgba(110,231,245,.04), transparent 26%), rgba(16,25,34,.92);
}
.dsh-org.dsh-org .dsh-org-office-room.meeting {
  right: 2.5%; top: 27%; width: 23%; height: 32%;
  border-top-color: rgba(171,126,255,.65);
}
.dsh-org.dsh-org .dsh-org-office-room.lounge {
  right: 2.5%; bottom: 5%; width: 23%; height: 31%;
  border-top-color: rgba(115,226,167,.55);
}
.dsh-org.dsh-org .dsh-org-office-room.restroom {
  left: 2.5%; bottom: 5%; width: 10%; height: 30%;
  border-top-color: rgba(110,231,245,.4);
}
.dsh-org.dsh-org .dsh-org-office-room.balcony {
  left: 13.5%; bottom: 5%; width: 8%; height: 30%;
  border-top-color: rgba(255,215,106,.42);
}

.dsh-org.dsh-org .dsh-org-office-label {
  display: block !important;
  z-index: 2;
  padding: 2px 5px;
  border: 0;
  border-left: 2px solid #506779;
  background: rgba(8,13,18,.78);
  color: #9eafba;
  font-size: 7px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.dsh-org.dsh-org .dsh-org-office-label.reception { left: 3.5%; top: 28.5%; color: #f1a0bd; border-left-color: var(--office-pink); }
.dsh-org.dsh-org .dsh-org-office-label.work { left: 24%; top: 28.5%; color: #98eaf3; border-left-color: var(--office-cyan); }
.dsh-org.dsh-org .dsh-org-office-label.meeting { right: 3.5%; top: 28.5%; color: #c7a8ff; border-left-color: #a982ff; }
.dsh-org.dsh-org .dsh-org-office-label.lounge { right: 3.5%; bottom: 6.5%; color: #9ae9b8; border-left-color: var(--office-green); }
.dsh-org.dsh-org .dsh-org-office-label.restroom { left: 3.5%; bottom: 6.5%; }
.dsh-org.dsh-org .dsh-org-office-label.balcony { left: 14.5%; bottom: 6.5%; color: #d6bd74; border-left-color: var(--office-amber); }

.dsh-org.dsh-org .dsh-org-furniture,
.dsh-org.dsh-org .dsh-org-office-plant {
  display: block !important;
}

.dsh-org.dsh-org .dsh-org-furniture {
  border: 1px solid #354652;
  box-shadow: 2px 2px 0 rgba(0,0,0,.28);
}
.dsh-org.dsh-org .dsh-org-furniture.desk {
  width: 12%;
  height: 6%;
  background: linear-gradient(180deg, #263440, #1b2731);
}
.dsh-org.dsh-org .dsh-org-furniture.desk::before {
  left: 28%;
  top: -14px;
  width: 30px;
  height: 18px;
  border: 2px solid #263745;
  background: #071018;
  box-shadow: inset 0 0 0 2px rgba(110,231,245,.72), 0 0 12px rgba(110,231,245,.18);
  animation: dsh-org-v3-monitor 2.6s steps(2, end) infinite;
}
.dsh-org.dsh-org .dsh-org-furniture.desk::after {
  left: 40%; bottom: -10px; width: 16px; height: 10px;
  border: 1px solid #344553; border-top: 0; background: #202b36;
}
.dsh-org.dsh-org .dsh-org-furniture.d1 { left: 25%; top: 49%; }
.dsh-org.dsh-org .dsh-org-furniture.d2 { left: 42%; top: 49%; }
.dsh-org.dsh-org .dsh-org-furniture.d3 { left: 58%; top: 49%; }
.dsh-org.dsh-org .dsh-org-furniture.d4 { left: 25%; top: 74%; }
.dsh-org.dsh-org .dsh-org-furniture.d5 { left: 42%; top: 74%; }
.dsh-org.dsh-org .dsh-org-furniture.d6 { left: 58%; top: 74%; }
@keyframes dsh-org-v3-monitor { 50% { filter: brightness(1.25); } }

.dsh-org.dsh-org .dsh-org-furniture.frontdesk {
  left: 5%; top: 47%; width: 13%; height: 7%;
  background: linear-gradient(180deg, #3a2937, #271e2a);
  border-top-color: #8e4d6b;
}
.dsh-org.dsh-org .dsh-org-furniture.frontdesk::before {
  content: 'OPS';
  color: #f4b8cc;
  font: 700 7px ui-monospace, Consolas, monospace;
}
.dsh-org.dsh-org .dsh-org-furniture.meeting-table {
  right: 6%; top: 47%; width: 16%; height: 8%;
  border-radius: 3px;
  background: #24213a;
  border-color: #514a72;
}
.dsh-org.dsh-org .dsh-org-furniture.sofa {
  right: 13%; bottom: 12%; width: 10%; height: 8%;
  border-radius: 2px;
  background: #1c4037;
  border-color: #356b5a;
}
.dsh-org.dsh-org .dsh-org-furniture.coffee {
  right: 4%; bottom: 11%; width: 7%; height: 7%;
  background: #222e38;
}
.dsh-org.dsh-org .dsh-org-furniture.coffee::before {
  content: '☕';
  color: #d9c59b;
  filter: saturate(.6);
}
.dsh-org.dsh-org .dsh-org-furniture.restroom-door {
  left: 4%; bottom: 10%; width: 6%; height: 17%;
  background: #17303b;
  border-color: #315363;
}
.dsh-org.dsh-org .dsh-org-furniture.restroom-door::before { color: #8ccfe2; }
.dsh-org.dsh-org .dsh-org-furniture.smoke {
  left: 15%; bottom: 12%; width: 4%; height: 4%;
  background: #2a3238;
  border-color: #4c565c;
}
.dsh-org.dsh-org .dsh-org-furniture.smoke::before { filter: grayscale(1); opacity: .7; }

.dsh-org.dsh-org .dsh-org-office-plant {
  width: 15px; height: 15px;
  border: 1px solid #31453c;
  background: #1b2d27;
}
.dsh-org.dsh-org .dsh-org-office-plant::before {
  left: -5px; top: -20px;
  color: #4f9f78;
  font-size: 23px;
  text-shadow: 0 0 9px rgba(115,226,167,.12);
}

/* Employees stay as crisp pixel sprites, but read like distinct people rather than DOM boxes. */
.dsh-org.dsh-org .dsh-org-avatar {
  display: grid !important;
  width: 54px;
  min-height: 66px;
  transform: translate(var(--avatar-x), var(--avatar-y)) translate(-50%, -50%) scale(.82);
  filter: drop-shadow(0 5px 0 rgba(0,0,0,.28));
}
.dsh-org.dsh-org .dsh-org-avatar:hover,
.dsh-org.dsh-org .dsh-org-avatar.active {
  filter: brightness(1.12) drop-shadow(0 0 10px rgba(110,231,245,.24));
}
.dsh-org.dsh-org .dsh-org-avatar-shadow {
  bottom: 10px;
  width: 30px;
  height: 6px;
  background: rgba(0,0,0,.28);
}
.dsh-org.dsh-org .dsh-org-avatar-head {
  width: 24px;
  height: 21px;
  border: 2px solid #251f28;
  box-shadow: 2px 0 0 #251f28;
}
.dsh-org.dsh-org .dsh-org-avatar-head::before {
  left: -2px; top: -6px; width: 24px; height: 7px; border: 2px solid #251f28; border-bottom: 0;
}
.dsh-org.dsh-org .dsh-org-avatar-eyes { left: 5px; top: 9px; width: 2px; height: 2px; background: #251f28; box-shadow: 8px 0 0 #251f28; }
.dsh-org.dsh-org .dsh-org-avatar-body {
  width: 29px;
  height: 21px;
  border: 2px solid #251f28;
  box-shadow: inset 0 -6px 0 rgba(255,255,255,.1);
}
.dsh-org.dsh-org .dsh-org-avatar-legs::before,
.dsh-org.dsh-org .dsh-org-avatar-legs::after { border-color: #251f28; }

.dsh-org.dsh-org .dsh-org-avatar-name {
  margin-top: 0;
  padding: 1px 4px;
  border: 1px solid #263845;
  background: rgba(7, 12, 17, .9);
  color: #d8e4e9;
  font-size: 8px;
  box-shadow: 2px 2px 0 rgba(0,0,0,.22);
}
.dsh-org.dsh-org .dsh-org-avatar-state { display: none; }
.dsh-org.dsh-org .dsh-org-avatar.status-running .dsh-org-avatar-name { border-color: rgba(110,231,245,.72); color: #bdf7ff; }
.dsh-org.dsh-org .dsh-org-avatar.status-done .dsh-org-avatar-name { border-color: rgba(115,226,167,.72); color: #bdf6d4; }
.dsh-org.dsh-org .dsh-org-avatar.status-wait .dsh-org-avatar-name { border-color: rgba(255,122,122,.78); color: #ffc0c0; }
.dsh-org.dsh-org .dsh-org-avatar.status-running::after,
.dsh-org.dsh-org .dsh-org-avatar.status-wait::after,
.dsh-org.dsh-org .dsh-org-avatar.status-done::after {
  content: '';
  position: absolute;
  left: 50%;
  top: -4px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  transform: translateX(-50%);
  background: var(--office-cyan);
  box-shadow: 0 0 10px currentColor;
}
.dsh-org.dsh-org .dsh-org-avatar.status-done::after { background: var(--office-green); }
.dsh-org.dsh-org .dsh-org-avatar.status-wait::after { background: var(--office-red); animation: dsh-org-v3-alert .8s steps(2, end) infinite; }
@keyframes dsh-org-v3-alert { 50% { opacity: .25; } }

.dsh-org.dsh-org .dsh-org-avatar-speech {
  bottom: calc(100% + 4px);
  max-width: 145px;
  padding: 5px 7px;
  border: 1px solid #536777;
  background: #0c131a;
  color: #dbe9ef;
  box-shadow: 3px 3px 0 rgba(0,0,0,.32), 0 0 12px rgba(110,231,245,.08);
  font-size: 8px;
}
.dsh-org.dsh-org .dsh-org-avatar-speech::after { border-top-color: #536777; }

.dsh-org.dsh-org .dsh-org-office-compact { display: none !important; }

.dsh-org.dsh-org .dsh-org-office-footer {
  min-height: 34px;
  padding: 7px 9px;
  border-top: 1px solid #30414f;
  background: #0f151d;
  color: #6f808d;
  font-size: 8px;
}
.dsh-org.dsh-org .dsh-org-office-footer strong { color: var(--office-amber); }

/* Quiet the rest of the page a touch so the visual office becomes the signature piece. */
.dsh-org.dsh-org .dsh-org-orgchart { background: #141119; }
.dsh-org.dsh-org .dsh-org-roster-row.active { box-shadow: inset 2px 0 0 var(--org-pink); }
.dsh-org.dsh-org .dsh-org-flow { box-shadow: 0 16px 34px rgba(0,0,0,.2); }

/* Preserve the current merged layout on desktop; gracefully fall back below laptop width. */
@media (max-width: 1180px) {
  .dsh-org.dsh-org .dsh-org-center {
    grid-template-columns: minmax(0, 1fr) 360px;
  }
  .dsh-org.dsh-org .dsh-org-company-board span { display: none; }
  .dsh-org.dsh-org .dsh-org-hours-board { font-size: 6px; }
}

@media (max-width: 900px) {
  .dsh-org.dsh-org .dsh-org-center {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(520px, 1fr) 360px;
  }
  .dsh-org.dsh-org .dsh-org-office-canvas {
    min-height: 300px !important;
  }
  .dsh-org.dsh-org .dsh-org-office-caption { display: none; }
}

@media (max-width: 620px) {
  .dsh-org.dsh-org .dsh-org-center { grid-template-rows: minmax(480px, 1fr) 300px; }
  .dsh-org.dsh-org .dsh-org-office-room,
  .dsh-org.dsh-org .dsh-org-office-label,
  .dsh-org.dsh-org .dsh-org-furniture,
  .dsh-org.dsh-org .dsh-org-office-plant,
  .dsh-org.dsh-org .dsh-org-avatar { display: none !important; }
  .dsh-org.dsh-org .dsh-org-office-compact {
    display: grid !important;
    background: #0e141c;
  }
  .dsh-org.dsh-org .dsh-org-office-canvas {
    flex: 0 0 126px !important;
    height: 126px !important;
    min-height: 126px !important;
  }
  .dsh-org.dsh-org .dsh-org-hours-board { display: none !important; }
  .dsh-org.dsh-org .dsh-org-company-board { left: 26%; top: 14%; width: 50%; }
  .dsh-org.dsh-org .dsh-org-office-window { left: 4%; top: 14%; }
  .dsh-org.dsh-org .dsh-org-wall-clock { right: 4%; top: 14%; }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-org.dsh-org .dsh-org-furniture.desk::before,
  .dsh-org.dsh-org .dsh-org-avatar.status-wait::after { animation: none !important; }
}
`

const STYLE_ID = 'dsh-org-panel-cyber-office-v3'

function installCyberOfficeTheme() {
  if (typeof document === 'undefined') return
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== CYBER_OFFICE_V3_CSS) style.textContent = CYBER_OFFICE_V3_CSS
}

export function apply(ctx: any, config?: any) {
  applyV2(ctx, config)
  installCyberOfficeTheme()
}
