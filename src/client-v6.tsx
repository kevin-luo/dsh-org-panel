// 「赛博公司」client v6
// 在 v5 的真实员工 / 会话状态之上，加入沉浸式总部、部门空间、成长与插件雷达。
import { apply as applyV5 } from './client-v5'

const STYLE_ID = 'dsh-org-panel-hq-v6'

const HQ_V6_CSS = String.raw`
.dsh-org.dsh-org {
  --hq6-bg: #050912;
  --hq6-panel: #09111f;
  --hq6-panel-2: #0d1828;
  --hq6-line: rgba(105, 135, 190, .18);
  --hq6-line-hi: rgba(90, 215, 255, .34);
  --hq6-cyan: #55e2ff;
  --hq6-blue: #6687ff;
  --hq6-violet: #a071ff;
  --hq6-pink: #f06bb9;
  --hq6-green: #65e8ae;
  --hq6-amber: #ffc96b;
  --hq6-red: #ff758b;
  --hq6-text: #edf5ff;
  --hq6-muted: #8292ad;
  --hq6-dim: #53647e;
  height: calc(100dvh - 138px);
  min-height: 690px;
  padding: 10px 12px 12px;
  background:
    radial-gradient(circle at 78% 5%, rgba(89, 95, 255, .10), transparent 27%),
    radial-gradient(circle at 40% 100%, rgba(28, 184, 232, .055), transparent 34%),
    #060a12;
}

.dsh-org.dsh-org .dsh-org-shell { min-height: 0; }
.dsh-org.dsh-org .dsh-org-head { min-height: 52px; padding-bottom: 8px; }
.dsh-org.dsh-org .dsh-org-title { font-size: 20px; font-weight: 720; letter-spacing: -.025em; }
.dsh-org.dsh-org .dsh-org-sub { color: #63758f; }
.dsh-org.dsh-org .dsh-org-mark {
  border-color: rgba(85, 226, 255, .5);
  background: radial-gradient(circle at 30% 25%, rgba(85,226,255,.22), transparent 45%), linear-gradient(145deg,#101c31,#0a1020);
  box-shadow: inset 0 0 22px rgba(85,226,255,.08), 0 0 24px rgba(83,126,255,.08);
}

/* Main proportions: keep the working conversation readable while making the digital twin a hero surface. */
.dsh-org.dsh-org .dsh-org-workbench {
  grid-template-columns: clamp(235px, 14.5vw, 278px) minmax(0, 1fr);
  gap: 9px;
  min-height: 0;
}
.dsh-org.dsh-org .dsh-org-center {
  grid-template-columns: minmax(520px, 1fr) clamp(545px, 36vw, 680px);
  gap: 9px;
  min-height: 0;
}

.dsh-org.dsh-org .dsh-org-panel,
.dsh-org.dsh-org .dsh-org-flow,
.dsh-org.dsh-org .dsh-org-office-shell {
  border-color: rgba(75, 101, 146, .24);
  background: linear-gradient(180deg, rgba(11,18,32,.97), rgba(7,13,24,.985));
  box-shadow: 0 18px 48px rgba(0,0,0,.30), inset 0 1px 0 rgba(255,255,255,.018);
}

/* Roster: turn the left rail into a premium personnel console. */
.dsh-org.dsh-org .dsh-org-roster { border-radius: 10px; overflow: hidden; }
.dsh-org.dsh-org .dsh-org-roster-tools { padding: 9px; }
.dsh-org.dsh-org .dsh-org-search {
  min-height: 34px;
  border-color: rgba(91,123,176,.28);
  background: rgba(4,9,18,.72);
  box-shadow: inset 0 1px 10px rgba(0,0,0,.22);
}
.dsh-org.dsh-org .dsh-org-filter {
  min-height: 27px;
  border-radius: 999px;
  background: rgba(9,17,30,.76);
}
.dsh-org.dsh-org .dsh-org-roster-list { padding: 5px 7px 8px; }
.dsh-org.dsh-org .dsh-org-roster-department { padding: 2px 0 6px; }
.dsh-org.dsh-org .dsh-org-roster-department-title {
  min-height: 25px;
  color: #7289aa;
  letter-spacing: .08em;
}
.dsh-org.dsh-org .dsh-org-roster-row {
  min-height: 57px;
  margin: 2px 0;
  padding: 7px 7px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: linear-gradient(90deg, rgba(19,31,50,.40), rgba(8,15,27,.18));
}
.dsh-org.dsh-org .dsh-org-roster-row:hover {
  border-color: rgba(85,226,255,.18);
  background: linear-gradient(90deg, rgba(24,43,68,.64), rgba(12,23,39,.42));
}
.dsh-org.dsh-org .dsh-org-roster-row.active {
  border-color: rgba(92,152,255,.45);
  background: linear-gradient(90deg, rgba(79,111,255,.14), rgba(116,73,224,.07));
  box-shadow: inset 2px 0 0 var(--hq6-cyan), 0 0 18px rgba(72,120,255,.07);
}
.dsh-org.dsh-org .dsh-org-roster-avatar {
  width: 35px; height: 35px;
  border-color: rgba(85,226,255,.22);
  background: radial-gradient(circle at 35% 30%, #1b3550, #0a1220 70%);
  box-shadow: inset 0 0 12px rgba(85,226,255,.06);
}
.dsh-org.dsh-org .dsh-org-roster-name { font-size: 10px; color: #e7effb; }
.dsh-org.dsh-org .dsh-org-roster-role { color: #72839d; }
.dsh-org.dsh-org .dsh-org-roster-task { color: #536985; }

/* Conversation: cleaner and denser, closer to an operations room than a demo chat. */
.dsh-org.dsh-org .dsh-org-flow { border-radius: 10px; overflow: hidden; }
.dsh-org.dsh-org .dsh-org-flow-head {
  min-height: 54px;
  background: linear-gradient(90deg, rgba(32,70,109,.20), rgba(11,18,32,.1) 48%, rgba(96,61,180,.08));
}
.dsh-org.dsh-org .dsh-org-flow-body { padding: 11px 13px 18px; }
.dsh-org.dsh-org .dsh-org-flow-row { margin-bottom: 9px; }
.dsh-org.dsh-org .dsh-org-flow-avatar {
  width: 29px; height: 29px;
  border-radius: 8px;
  border-color: rgba(85,226,255,.18);
  background: #0d192a;
}
.dsh-org.dsh-org .dsh-org-flow-bubble {
  border-radius: 8px;
  border-color: rgba(92,116,155,.22);
  background: linear-gradient(180deg, rgba(17,30,48,.78), rgba(11,20,34,.76));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.016);
  line-height: 1.68;
}
.dsh-org.dsh-org .dsh-org-flow-row.employee .dsh-org-flow-bubble {
  border-color: rgba(83,213,177,.26);
  background: linear-gradient(180deg, rgba(16,42,42,.54), rgba(10,26,31,.62));
}
.dsh-org.dsh-org .dsh-org-trace {
  border-radius: 7px;
  border-color: rgba(82,104,143,.20);
  background: rgba(5,11,20,.52);
}

/* ===== Living cyber office ===== */
.dsh-org.dsh-org .dsh-org-office-shell {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  min-width: 0;
  border-radius: 11px;
  overflow: hidden;
  isolation: isolate;
  background: #070d17;
}
.dsh-org.dsh-org .dsh-org-office-shell::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 30;
  border: 1px solid rgba(98,123,255,.14);
  border-radius: 11px;
  box-shadow: inset 0 0 38px rgba(66,86,180,.04);
}
.dsh-org.dsh-org .dsh-org-office-header {
  min-height: 49px;
  padding: 9px 11px;
  border-bottom: 1px solid rgba(86,112,157,.20);
  background:
    linear-gradient(90deg, rgba(91,103,255,.13), transparent 32%),
    linear-gradient(180deg,#0e1727,#0a1321);
}
.dsh-org.dsh-org .dsh-org-office-title {
  font-size: 12px;
  color: #f2f6ff;
  letter-spacing: .02em;
}
.dsh-org.dsh-org .dsh-org-office-caption { color: #627791; }
.dsh-org.dsh-org .dsh-org-office-canvas {
  position: relative;
  min-height: 540px !important;
  height: auto !important;
  overflow: hidden;
  container-type: size;
  background:
    linear-gradient(rgba(89,214,255,.026) 1px, transparent 1px),
    linear-gradient(90deg, rgba(89,214,255,.026) 1px, transparent 1px),
    radial-gradient(ellipse at 50% 33%, rgba(55,89,191,.13), transparent 40%),
    radial-gradient(ellipse at 80% 75%, rgba(157,75,228,.07), transparent 34%),
    linear-gradient(180deg,#090f1a,#060b14 72%,#050911);
  background-size: 18px 18px,18px 18px,100% 100%,100% 100%,100% 100%;
}
.dsh-org.dsh-org .dsh-org-office-canvas::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 28;
  pointer-events: none;
  opacity: .12;
  background: repeating-linear-gradient(180deg,rgba(255,255,255,.04) 0,rgba(255,255,255,.04) 1px,transparent 1px,transparent 4px);
  mix-blend-mode: screen;
}
.dsh-org.dsh-org .dsh-org-office-canvas::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 27;
  pointer-events: none;
  box-shadow: inset 0 0 85px rgba(0,0,0,.46), inset 0 52px 70px rgba(2,6,12,.46);
}

/* Retire the old wireframe furniture; v6 builds a richer architecture layer above it. */
.dsh-org.dsh-org .dsh-org-office-room,
.dsh-org.dsh-org .dsh-org-office-label,
.dsh-org.dsh-org .dsh-org-furniture,
.dsh-org.dsh-org .dsh-org-office-plant,
.dsh-org.dsh-org .dsh-org-neon-strip,
.dsh-org.dsh-org .dsh-org-lamp,
.dsh-org.dsh-org .dsh-org-poster,
.dsh-org.dsh-org .dsh-org-whiteboard,
.dsh-org.dsh-org .dsh-org-rack,
.dsh-org.dsh-org .dsh-org-fridge,
.dsh-org.dsh-org .dsh-org-rug,
.dsh-org.dsh-org .dsh-org-bot,
.dsh-org.dsh-org .dsh-org-neon-open,
.dsh-org.dsh-org .dsh-org-floor-lamp,
.dsh-org.dsh-org .dsh-org-filing,
.dsh-org.dsh-org .dsh-org-office-wall,
.dsh-org.dsh-org .dsh-org-office-floor { display: none !important; }

.dsh-org.dsh-org .dsh-org-office-window {
  display: block !important;
  left: 2.6%; top: 3.5%; width: 18%; height: 10.5%;
  border: 1px solid rgba(79,123,164,.5);
  border-radius: 4px;
  background:
    radial-gradient(circle at 15% 34%,#ffce6a 0 1px,transparent 2px),
    radial-gradient(circle at 72% 23%,#5be4ff 0 1px,transparent 2px),
    radial-gradient(circle at 83% 62%,#f063ba 0 1px,transparent 2px),
    linear-gradient(180deg,#102137,#07111e 58%,#050a12 59%);
  box-shadow: inset 0 0 18px rgba(70,190,255,.12),0 5px 18px rgba(0,0,0,.24);
  z-index: 3;
}
.dsh-org.dsh-org .dsh-org-company-board {
  left: 22.5%; top: 3.3%; width: 54%; min-height: 52px;
  padding: 8px 13px;
  border: 1px solid rgba(130,90,255,.38);
  border-left: 3px solid var(--hq6-violet);
  border-radius: 6px;
  background: linear-gradient(90deg,rgba(117,73,255,.15),rgba(15,25,43,.92) 52%,rgba(60,213,255,.06));
  box-shadow: 0 7px 24px rgba(0,0,0,.26),inset 0 1px 0 rgba(255,255,255,.03),0 0 24px rgba(117,73,255,.05);
  z-index: 4;
}
.dsh-org.dsh-org .dsh-org-company-board strong { color: #f1efff; font-size: 13px; letter-spacing: .11em; }
.dsh-org.dsh-org .dsh-org-company-board span { color: #7386a0; font-size: 7px; }
.dsh-org.dsh-org .dsh-org-wall-clock {
  right: 2.6%; left: auto; top: 3.5%; width: 18%; height: 52px;
  border: 1px solid rgba(83,205,236,.30); border-radius: 6px;
  background: linear-gradient(180deg,#0b1726,#07111e);
  color: var(--hq6-cyan);
  box-shadow: inset 0 0 15px rgba(83,226,255,.07),0 5px 18px rgba(0,0,0,.22);
  font: 760 11px ui-monospace,SFMono-Regular,Consolas,monospace;
  z-index: 4;
}
.dsh-org.dsh-org .dsh-org-wall-clock::before { display:none; }
.dsh-org.dsh-org .dsh-org-hours-board {
  left: 22.5%; top: 11%; width: 54%; right: auto;
  padding: 4px 9px;
  border: 0; border-top: 1px solid rgba(86,117,162,.13);
  background: rgba(5,10,18,.30);
  color: #4e6078;
  font-size: 6.5px; line-height: 1.45;
  box-shadow: none; z-index: 3;
}
.dsh-org.dsh-org .dsh-org-hours-board strong { color:#8aa0ba; }

.hq6-architecture {
  position: absolute;
  inset: 16.5% 2.2% 2.4%;
  z-index: 2;
  display: grid;
  grid-template-columns: 1.12fr .94fr .88fr;
  grid-template-rows: 1fr .92fr .88fr;
  grid-template-areas:
    'rd rd meeting'
    'content media meeting'
    'analytics growth lounge';
  gap: 8px;
  pointer-events: none;
  perspective: 950px;
}
.hq6-architecture::before {
  content: '';
  position: absolute;
  inset: 4px;
  z-index: -2;
  border: 1px solid rgba(70,114,168,.13);
  background: linear-gradient(135deg,rgba(52,73,119,.04),transparent 40%),rgba(4,9,16,.45);
  box-shadow: inset 0 0 45px rgba(39,68,128,.055);
}
.hq6-zone {
  --zone: 85,226,255;
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--zone),.25);
  border-top-color: rgba(var(--zone),.52);
  border-radius: 7px;
  background:
    linear-gradient(180deg,rgba(var(--zone),.08),transparent 22%),
    linear-gradient(135deg,rgba(255,255,255,.018),transparent 46%),
    rgba(10,18,30,.91);
  box-shadow:
    0 8px 0 rgba(2,6,12,.48),
    0 12px 26px rgba(0,0,0,.24),
    inset 0 1px 0 rgba(255,255,255,.025),
    inset 0 0 28px rgba(var(--zone),.025);
  transform: translateZ(0);
}
.hq6-zone::before {
  content: '';
  position: absolute;
  left: 8px; right: 8px; top: 31px; bottom: 7px;
  background:
    linear-gradient(rgba(var(--zone),.035) 1px,transparent 1px),
    linear-gradient(90deg,rgba(var(--zone),.035) 1px,transparent 1px);
  background-size: 14px 14px;
  border-top: 1px solid rgba(var(--zone),.08);
  opacity: .78;
}
.hq6-zone::after {
  content: '';
  position: absolute;
  left: 10px; right: 10px; bottom: 8px; height: 2px;
  background: linear-gradient(90deg,transparent,rgba(var(--zone),.55),transparent);
  box-shadow: 0 0 10px rgba(var(--zone),.22);
  opacity: .5;
}
.hq6-zone-rd { grid-area:rd; --zone:85,226,255; }
.hq6-zone-meeting { grid-area:meeting; --zone:184,112,255; }
.hq6-zone-content { grid-area:content; --zone:237,102,187; }
.hq6-zone-media { grid-area:media; --zone:89,135,255; }
.hq6-zone-analytics { grid-area:analytics; --zone:77,219,194; }
.hq6-zone-growth { grid-area:growth; --zone:255,197,96; }
.hq6-zone-lounge { grid-area:lounge; --zone:104,224,162; }
.hq6-zone-head {
  position: relative;
  z-index: 2;
  display:flex; align-items:center; justify-content:space-between; gap:6px;
  height: 31px;
  padding: 0 9px;
  border-bottom: 1px solid rgba(var(--zone),.12);
  background: linear-gradient(90deg,rgba(var(--zone),.08),transparent);
}
.hq6-zone-title {
  color: rgb(var(--zone));
  font-size: 8px;
  font-weight: 820;
  letter-spacing: .08em;
  text-shadow: 0 0 10px rgba(var(--zone),.22);
}
.hq6-zone-stat {
  color: #667a94;
  font: 650 6.5px ui-monospace,SFMono-Regular,Consolas,monospace;
}
.hq6-desk-grid {
  position:absolute;
  left:8px; right:8px; top:39px; bottom:10px;
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  align-items:end;
  gap:6px;
}
.hq6-zone-content .hq6-desk-grid,
.hq6-zone-media .hq6-desk-grid,
.hq6-zone-analytics .hq6-desk-grid,
.hq6-zone-growth .hq6-desk-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
.hq6-desk {
  position:relative;
  height: 27px;
  margin: 0 4px 3px;
  border: 1px solid rgba(83,109,145,.22);
  border-radius: 3px;
  background: linear-gradient(180deg,#18283a,#0d1724);
  box-shadow: 0 5px 0 #050a12,0 8px 10px rgba(0,0,0,.18);
}
.hq6-desk::before {
  content:'';
  position:absolute;
  left:50%; top:-21px;
  width:28px; height:18px;
  transform:translateX(-50%);
  border:2px solid #1d3044;
  border-radius:2px;
  background:
    linear-gradient(120deg,transparent 0 22%,rgba(var(--zone),.55) 23% 25%,transparent 26% 46%,rgba(var(--zone),.25) 47% 49%,transparent 50%),
    #06111b;
  box-shadow: inset 0 0 8px rgba(var(--zone),.20),0 0 10px rgba(var(--zone),.08);
  animation:hq6-monitor 2.8s steps(2,end) infinite;
}
.hq6-desk::after {
  content:'';
  position:absolute;
  left:50%; top:-3px;
  width:3px; height:5px;
  transform:translateX(-50%);
  background:#2a3f56;
}
@keyframes hq6-monitor { 50% { filter:brightness(1.25); opacity:.78; } }

.hq6-zone-meeting .hq6-desk-grid { display:none; }
.hq6-meeting-table {
  position:absolute;
  left:16%; right:16%; top:37%; height:34%;
  border:1px solid rgba(173,116,255,.38);
  border-radius:50%;
  background:radial-gradient(ellipse at center,rgba(114,83,183,.30),rgba(31,27,62,.75) 58%,#111528 62%);
  box-shadow:0 7px 0 #060914,0 0 28px rgba(156,92,255,.10),inset 0 0 22px rgba(182,122,255,.09);
}
.hq6-meeting-table::before {
  content:'';
  position:absolute; inset:27%;
  border:1px solid rgba(90,218,255,.45); border-radius:50%;
  background:radial-gradient(circle,rgba(80,213,255,.20),transparent 70%);
  box-shadow:0 0 18px rgba(80,213,255,.16);
  animation:hq6-holo 2.6s ease-in-out infinite;
}
@keyframes hq6-holo { 50% { transform:scale(1.08); opacity:.65; } }
.hq6-lounge-sofa {
  position:absolute; left:12%; right:12%; top:45%; height:31%;
  border:1px solid rgba(91,137,121,.30); border-radius:14px 14px 6px 6px;
  background:linear-gradient(180deg,#173127,#10241e);
  box-shadow:0 6px 0 #07100d,inset 0 1px 0 rgba(255,255,255,.03);
}
.hq6-lounge-sofa::before,
.hq6-lounge-sofa::after { content:''; position:absolute; top:-12px; width:18px; height:24px; border-radius:50%; background:#15352b; box-shadow:0 0 15px rgba(102,229,166,.05); }
.hq6-lounge-sofa::before{left:8px}.hq6-lounge-sofa::after{right:8px}

.hq6-floor-core {
  position:absolute;
  left:50%; top:50%;
  width:48px; height:48px;
  transform:translate(-50%,-50%);
  z-index:3;
  border:1px solid rgba(70,218,255,.30);
  border-radius:50%;
  background:radial-gradient(circle,rgba(69,205,255,.26),rgba(64,73,195,.10) 44%,transparent 70%);
  box-shadow:0 0 28px rgba(74,163,255,.16),inset 0 0 16px rgba(78,219,255,.15);
  pointer-events:none;
  animation:hq6-core 3.4s ease-in-out infinite;
}
.hq6-floor-core::before,
.hq6-floor-core::after { content:''; position:absolute; inset:8px; border:1px solid rgba(135,94,255,.38); transform:rotate(45deg); }
.hq6-floor-core::after { inset:15px; border-color:rgba(80,225,255,.58); transform:rotate(0); }
@keyframes hq6-core { 50% { filter:brightness(1.25); box-shadow:0 0 38px rgba(74,163,255,.24),inset 0 0 20px rgba(78,219,255,.22); } }
.hq6-floor-rail {
  position:absolute; z-index:1; pointer-events:none;
  background:linear-gradient(90deg,transparent,rgba(85,226,255,.55),rgba(149,95,255,.46),transparent);
  height:1px; box-shadow:0 0 8px rgba(85,226,255,.22);
}
.hq6-floor-rail.r1{left:8%;right:8%;top:48%}.hq6-floor-rail.r2{left:8%;right:8%;top:77%}
.hq6-floor-rail.r3{left:49%;top:17%;bottom:3%;width:1px;height:auto;background:linear-gradient(180deg,transparent,rgba(151,93,255,.45),rgba(85,226,255,.35),transparent)}

/* Employee sprites: bigger, more legible, identity via role badge rather than tiny boxes. */
.dsh-org.dsh-org .dsh-org-avatar {
  display:grid !important;
  width:58px;
  min-height:76px;
  z-index:12;
  transform:translate(var(--avatar-x),var(--avatar-y)) translate(-50%,-50%) scale(.88);
  filter:drop-shadow(0 7px 4px rgba(0,0,0,.36));
  transition:filter .18s ease,transform .18s ease;
}
.dsh-org.dsh-org .dsh-org-avatar:hover,
.dsh-org.dsh-org .dsh-org-avatar.active {
  z-index:24;
  transform:translate(var(--avatar-x),var(--avatar-y)) translate(-50%,calc(-50% - 5px)) scale(.95);
  filter:brightness(1.12) drop-shadow(0 0 13px rgba(85,226,255,.24));
}
.dsh-org.dsh-org .dsh-org-avatar-shadow { width:32px;height:7px;bottom:11px;background:rgba(0,0,0,.34);filter:blur(1px); }
.dsh-org.dsh-org .dsh-org-avatar-head {
  width:27px;height:24px;
  border:2px solid #101827;
  border-radius:7px 7px 5px 5px;
  background:linear-gradient(180deg,#e9b794,#c98b70);
  box-shadow:inset 0 -3px 0 rgba(105,55,55,.10),2px 1px 0 #101827;
}
.dsh-org.dsh-org .dsh-org-avatar-head::before {
  left:-2px;top:-7px;width:27px;height:9px;
  border:2px solid #101827;border-bottom:0;
  border-radius:7px 7px 1px 1px;
  background:#1d2638;
}
.dsh-org.dsh-org .dsh-org-avatar-eyes { top:11px; background:#172031; box-shadow:9px 0 0 #172031; }
.dsh-org.dsh-org .dsh-org-avatar-body {
  width:31px;height:23px;
  border:2px solid #0f1725;border-radius:4px 4px 2px 2px;
  background:linear-gradient(180deg,#355b7f,#233b58);
  box-shadow:inset 0 -7px 0 rgba(255,255,255,.05);
}
.dsh-org.dsh-org .dsh-org-avatar-accessory {
  display:grid;place-items:center;
  position:absolute;right:2px;top:29px;
  width:17px;height:17px;
  border:1px solid rgba(95,149,192,.50);border-radius:5px;
  background:#081421;
  color:#8eefff;
  font:800 7px ui-monospace,monospace;
  box-shadow:0 0 9px rgba(85,226,255,.08);
}
.dsh-org.dsh-org .dsh-org-avatar-name {
  margin-top:2px;padding:2px 5px;
  border:1px solid rgba(73,100,139,.42);
  border-radius:999px;
  background:rgba(4,9,16,.90);
  color:#e0ebf8;
  font-size:8px;
  box-shadow:0 3px 10px rgba(0,0,0,.22);
}
.dsh-org.dsh-org .dsh-org-avatar-state { display:none; }
.dsh-org.dsh-org .dsh-org-avatar.status-running .dsh-org-avatar-name { border-color:rgba(85,226,255,.58);color:#c7f7ff;box-shadow:0 0 11px rgba(85,226,255,.10); }
.dsh-org.dsh-org .dsh-org-avatar.status-done .dsh-org-avatar-name { border-color:rgba(101,232,174,.52);color:#c9f6dd; }
.dsh-org.dsh-org .dsh-org-avatar.status-wait .dsh-org-avatar-name { border-color:rgba(255,117,139,.68);color:#ffc3ce;animation:hq6-wait 1.1s steps(2,end) infinite; }
@keyframes hq6-wait { 50% { box-shadow:0 0 13px rgba(255,117,139,.23); } }
.dsh-org.dsh-org .dsh-org-avatar-speech {
  bottom:calc(100% + 7px);max-width:160px;
  border-color:rgba(85,226,255,.32);border-radius:7px;
  background:rgba(5,12,21,.97);color:#dceaf7;
  box-shadow:0 8px 20px rgba(0,0,0,.32),0 0 16px rgba(85,226,255,.06);
}

/* Distinct uniforms / role glyphs. */
.dsh-org.dsh-org .staff-secretary .dsh-org-avatar-body{background:linear-gradient(#7c4f9d,#4d3268)}
.dsh-org.dsh-org .staff-secretary .dsh-org-avatar-accessory::after{content:'◆'}
.dsh-org.dsh-org .staff-tech-lead .dsh-org-avatar-body{background:linear-gradient(#506783,#2e4059)}
.dsh-org.dsh-org .staff-tech-lead .dsh-org-avatar-accessory::after{content:'MGR'}
.dsh-org.dsh-org .staff-recruiter .dsh-org-avatar-body{background:linear-gradient(#9e634c,#694030)}
.dsh-org.dsh-org .staff-recruiter .dsh-org-avatar-accessory::after{content:'HR'}
.dsh-org.dsh-org .staff-developer .dsh-org-avatar-body{background:linear-gradient(#2c8a78,#1c584f)}
.dsh-org.dsh-org .staff-developer .dsh-org-avatar-accessory::after{content:'</>'}
.dsh-org.dsh-org .staff-pm .dsh-org-avatar-body{background:linear-gradient(#a66f39,#6f4926)}
.dsh-org.dsh-org .staff-pm .dsh-org-avatar-accessory::after{content:'PRD'}
.dsh-org.dsh-org .staff-platform .dsh-org-avatar-body{background:linear-gradient(#5369a8,#33426e)}
.dsh-org.dsh-org .staff-platform .dsh-org-avatar-accessory::after{content:'⚙'}
.dsh-org.dsh-org .staff-researcher .dsh-org-avatar-body{background:linear-gradient(#5c72a4,#39466b)}
.dsh-org.dsh-org .staff-researcher .dsh-org-avatar-accessory::after{content:'R'}
.dsh-org.dsh-org .staff-doc .dsh-org-avatar-body{background:linear-gradient(#815982,#543956)}
.dsh-org.dsh-org .staff-doc .dsh-org-avatar-accessory::after{content:'KB'}
.dsh-org.dsh-org .staff-search-specialist .dsh-org-avatar-body{background:linear-gradient(#2f788c,#1e4d5b)}
.dsh-org.dsh-org .staff-search-specialist .dsh-org-avatar-accessory::after{content:'⌕'}
.dsh-org.dsh-org .staff-image-creator .dsh-org-avatar-body{background:linear-gradient(#a65089,#653456)}
.dsh-org.dsh-org .staff-image-creator .dsh-org-avatar-accessory::after{content:'◈'}
.dsh-org.dsh-org .staff-video-producer .dsh-org-avatar-body{background:linear-gradient(#6c58a7,#43376e)}
.dsh-org.dsh-org .staff-video-producer .dsh-org-avatar-accessory::after{content:'▶'}
.dsh-org.dsh-org .staff-novelist .dsh-org-avatar-body{background:linear-gradient(#8c6151,#5e4036)}
.dsh-org.dsh-org .staff-novelist .dsh-org-avatar-accessory::after{content:'✎'}
.dsh-org.dsh-org .staff-social-editor .dsh-org-avatar-body{background:linear-gradient(#af5f7e,#713d53)}
.dsh-org.dsh-org .staff-social-editor .dsh-org-avatar-accessory::after{content:'✦'}
.dsh-org.dsh-org .staff-data-analyst .dsh-org-avatar-body{background:linear-gradient(#2f7a72,#20514c)}
.dsh-org.dsh-org .staff-data-analyst .dsh-org-avatar-accessory::after{content:'▦'}
.dsh-org.dsh-org .staff-growth .dsh-org-avatar-body{background:linear-gradient(#9a7738,#674e24)}
.dsh-org.dsh-org .staff-growth .dsh-org-avatar-accessory::after{content:'↗'}

/* Force every expanded employee into a real department; inline fallback coordinates previously pushed them below the canvas. */
.dsh-org.dsh-org .staff-secretary{--avatar-x:50cqw !important;--avatar-y:17.3cqh !important}
.dsh-org.dsh-org .staff-tech-lead{--avatar-x:18cqw !important;--avatar-y:31cqh !important}
.dsh-org.dsh-org .staff-developer{--avatar-x:32cqw !important;--avatar-y:32cqh !important}
.dsh-org.dsh-org .staff-platform{--avatar-x:46cqw !important;--avatar-y:31cqh !important}
.dsh-org.dsh-org .staff-pm{--avatar-x:61cqw !important;--avatar-y:31cqh !important}
.dsh-org.dsh-org .staff-recruiter{--avatar-x:83cqw !important;--avatar-y:31cqh !important}
.dsh-org.dsh-org .staff-researcher{--avatar-x:17cqw !important;--avatar-y:56cqh !important}
.dsh-org.dsh-org .staff-search-specialist{--avatar-x:31cqw !important;--avatar-y:56cqh !important}
.dsh-org.dsh-org .staff-doc{--avatar-x:47cqw !important;--avatar-y:56cqh !important}
.dsh-org.dsh-org .staff-social-editor{--avatar-x:59cqw !important;--avatar-y:56cqh !important}
.dsh-org.dsh-org .staff-novelist{--avatar-x:72cqw !important;--avatar-y:56cqh !important}
.dsh-org.dsh-org .staff-image-creator{--avatar-x:19cqw !important;--avatar-y:82cqh !important}
.dsh-org.dsh-org .staff-video-producer{--avatar-x:39cqw !important;--avatar-y:82cqh !important}
.dsh-org.dsh-org .staff-data-analyst{--avatar-x:61cqw !important;--avatar-y:82cqh !important}
.dsh-org.dsh-org .staff-growth{--avatar-x:82cqw !important;--avatar-y:82cqh !important}

/* Intelligence strip below the live office. */
.hq6-intel-strip {
  display:grid;
  grid-template-columns:1.05fr 1.12fr .95fr;
  gap:6px;
  padding:7px;
  border-top:1px solid rgba(79,103,145,.20);
  background:linear-gradient(180deg,rgba(8,14,24,.98),rgba(6,11,20,.98));
}
.hq6-intel-card {
  min-width:0;
  min-height:68px;
  padding:7px 8px;
  border:1px solid rgba(76,102,145,.22);
  border-radius:7px;
  background:linear-gradient(145deg,rgba(18,31,51,.76),rgba(8,15,27,.68));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.018);
}
.hq6-intel-card.plugin { border-color:rgba(155,102,255,.30);background:linear-gradient(145deg,rgba(73,45,124,.20),rgba(8,15,27,.72)); }
.hq6-intel-card.growth { border-color:rgba(73,203,173,.25); }
.hq6-intel-kicker { color:#58708e;font-size:6.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase; }
.hq6-intel-title { margin-top:3px;color:#dce8f7;font-size:9px;font-weight:760;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.hq6-intel-copy { margin-top:2px;color:#5c708b;font-size:7px;line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.hq6-intel-actions { display:flex;gap:4px;margin-top:6px; }
.hq6-intel-action {
  min-height:22px;padding:2px 7px;
  border:1px solid rgba(87,135,180,.26);border-radius:5px;
  background:rgba(8,16,29,.72);color:#86bcd4;
  font-size:7px;cursor:pointer;
}
.hq6-intel-action:hover { border-color:rgba(85,226,255,.42);color:#bdf5ff;background:rgba(28,77,96,.16); }
.hq6-intel-card.plugin .hq6-intel-action { color:#c6b4ff;border-color:rgba(160,114,255,.28); }
.hq6-intel-badge { display:inline-flex;align-items:center;gap:4px;margin-top:5px;color:#69daa9;font-size:7px; }
.hq6-intel-badge::before { content:'';width:5px;height:5px;border-radius:50%;background:#5ce6a8;box-shadow:0 0 8px rgba(92,230,168,.55); }

.dsh-org.dsh-org .dsh-org-office-footer {
  min-height:31px;padding:6px 9px;
  border-top:1px solid rgba(76,102,145,.17);
  background:#070d17;color:#53657d;
}
.dsh-org.dsh-org .dsh-org-office-footer strong{color:#85dff2}

/* Compact top rails. */
.dsh-org.dsh-org .dsh-org-brief {
  min-height:42px;margin-bottom:7px;border-radius:8px;
  background:linear-gradient(90deg,rgba(29,69,100,.15),rgba(10,17,30,.88) 50%,rgba(79,58,141,.08));
}
.dsh-org.dsh-org .dsh-org-orgchart { min-height:41px;margin-bottom:7px;border-radius:7px; }
.dsh-org.dsh-org .dsh-org-orgchart-units { grid-template-columns:repeat(5,minmax(0,1fr)); }

@media (max-width: 1540px) {
  .dsh-org.dsh-org .dsh-org-center { grid-template-columns:minmax(500px,1fr) clamp(505px,35vw,585px); }
  .dsh-org.dsh-org .dsh-org-avatar { transform:translate(var(--avatar-x),var(--avatar-y)) translate(-50%,-50%) scale(.80); }
  .dsh-org.dsh-org .dsh-org-avatar:hover,.dsh-org.dsh-org .dsh-org-avatar.active { transform:translate(var(--avatar-x),var(--avatar-y)) translate(-50%,calc(-50% - 4px)) scale(.86); }
}
@media (max-width: 1280px) {
  .dsh-org.dsh-org { min-height:760px;height:auto; }
  .dsh-org.dsh-org .dsh-org-center { grid-template-columns:1fr;grid-template-rows:minmax(500px,1fr) 590px; }
  .dsh-org.dsh-org .dsh-org-office-canvas { min-height:450px !important; }
  .hq6-intel-strip { grid-template-columns:repeat(3,minmax(0,1fr)); }
}
@media (max-width: 900px) {
  .dsh-org.dsh-org .dsh-org-workbench { grid-template-columns:1fr; }
  .dsh-org.dsh-org .dsh-org-roster { max-height:310px; }
  .dsh-org.dsh-org .dsh-org-center { grid-template-rows:minmax(500px,1fr) 540px; }
}
@media (max-width: 680px) {
  .hq6-intel-strip { grid-template-columns:1fr; }
  .hq6-architecture { display:none; }
  .dsh-org.dsh-org .dsh-org-office-canvas { min-height:130px !important; }
}
@media (prefers-reduced-motion: reduce) {
  .hq6-desk::before,.hq6-meeting-table::before,.hq6-floor-core,.dsh-org.dsh-org .dsh-org-avatar.status-wait .dsh-org-avatar-name { animation:none !important; }
}
`

type ZoneDef = {
  id: string
  title: string
  staff: string[]
  desks?: number
  special?: 'meeting' | 'lounge'
}

const ZONES: ZoneDef[] = [
  { id: 'rd', title: '研发中心 / R&D', staff: ['tech-lead', 'developer', 'platform', 'pm'], desks: 4 },
  { id: 'meeting', title: '会议室 / 决策舱', staff: ['recruiter'], special: 'meeting' },
  { id: 'content', title: '情报与内容部', staff: ['researcher', 'search-specialist', 'doc'], desks: 3 },
  { id: 'media', title: '内容创作部', staff: ['social-editor', 'novelist'], desks: 2 },
  { id: 'analytics', title: '多媒体创意部', staff: ['image-creator', 'video-producer'], desks: 2 },
  { id: 'growth', title: '数据与增长部', staff: ['data-analyst', 'growth'], desks: 2 },
  { id: 'lounge', title: '灵感茶水间', staff: [], special: 'lounge' },
]

function installStyle() {
  if (typeof document === 'undefined') return
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== HQ_V6_CSS) style.textContent = HQ_V6_CSS
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function buildArchitecture(canvas: HTMLElement) {
  if (canvas.querySelector('.hq6-architecture')) return
  const architecture = element('div', 'hq6-architecture')
  architecture.setAttribute('aria-hidden', 'true')
  for (const zone of ZONES) {
    const room = element('section', `hq6-zone hq6-zone-${zone.id}`)
    room.dataset.zone = zone.id
    const head = element('div', 'hq6-zone-head')
    head.append(element('span', 'hq6-zone-title', zone.title), element('span', 'hq6-zone-stat', '● 待命'))
    room.appendChild(head)
    if (zone.special === 'meeting') room.appendChild(element('div', 'hq6-meeting-table'))
    else if (zone.special === 'lounge') room.appendChild(element('div', 'hq6-lounge-sofa'))
    else {
      const grid = element('div', 'hq6-desk-grid')
      for (let i = 0; i < (zone.desks || 2); i++) grid.appendChild(element('div', 'hq6-desk'))
      room.appendChild(grid)
    }
    architecture.appendChild(room)
  }
  architecture.append(element('div', 'hq6-floor-core'), element('div', 'hq6-floor-rail r1'), element('div', 'hq6-floor-rail r2'), element('div', 'hq6-floor-rail r3'))
  const firstAvatar = canvas.querySelector('.dsh-org-avatar')
  canvas.insertBefore(architecture, firstAvatar || null)
}

function composer(root: HTMLElement): HTMLTextAreaElement | null {
  const scroll = root.closest('[data-conversation-scroll]')
  return (scroll?.querySelector('[data-composer-seat] textarea') || document.querySelector('[data-composer-seat] textarea')) as HTMLTextAreaElement | null
}

function draft(root: HTMLElement, text: string) {
  const input = composer(root)
  if (!input) return
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (setter) setter.call(input, text)
  else input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.focus()
  input.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

function intelCard(kind: string, kicker: string, title: string, copy: string, action: string, prompt: string, root: HTMLElement) {
  const card = element('div', `hq6-intel-card ${kind}`)
  card.append(element('div', 'hq6-intel-kicker', kicker), element('div', 'hq6-intel-title', title), element('div', 'hq6-intel-copy', copy))
  const actions = element('div', 'hq6-intel-actions')
  const button = element('button', 'hq6-intel-action', action)
  button.type = 'button'
  button.addEventListener('click', () => draft(root, prompt))
  actions.appendChild(button)
  card.appendChild(actions)
  return card
}

function buildIntel(root: HTMLElement, shell: HTMLElement) {
  if (shell.querySelector('.hq6-intel-strip')) return
  const strip = element('div', 'hq6-intel-strip')
  strip.append(
    intelCard('growth', 'EMPLOYEE EVOLUTION', '员工成长系统', '长期记忆 · 经验复盘 · 技能熟练度持续积累', '查看成长档案', '帮我汇总全体员工的成长档案、最近记忆、技能等级和需要补强的能力。', root),
    intelCard('plugin', 'DSH COMMUNITY MARKET', '插件市场雷达', 'GitHub dsh-plugin · awesome-dsh-plugin 社区生态', '让大壮搜索插件', '@大壮 去 DSH 社区插件市场搜索适合当前公司和各岗位的新插件。优先从 github.com/topics/dsh-plugin 和 awesome-dsh-plugin 的目录查找，列出用途、stars、风险和安装命令，先不要安装，等我批准。', root),
    intelCard('capability', 'RUNTIME CAPABILITY', '能力扫描', '检查当前 DSH / Cordis / MCP / Tool Registry 已暴露能力', '扫描现有能力', '扫描当前公司所有已安装工具、插件和连接器，按员工岗位给出能力覆盖与缺口，不要虚构未安装能力。', root),
  )
  const footer = shell.querySelector('.dsh-org-office-footer')
  shell.insertBefore(strip, footer || null)
}

function updateZoneStats(root: HTMLElement) {
  for (const zone of ZONES) {
    const node = root.querySelector(`.hq6-zone-${zone.id} .hq6-zone-stat`)
    if (!(node instanceof HTMLElement)) continue
    if (!zone.staff.length) {
      const idle = root.querySelectorAll('.dsh-org-avatar.status-idle').length
      node.textContent = idle ? `● ${idle} 人可休息` : '● 灵感补给'
      continue
    }
    let live = 0
    let running = 0
    let blocked = 0
    for (const id of zone.staff) {
      const avatar = root.querySelector(`.dsh-org-avatar.staff-${id}`)
      if (!avatar) continue
      live++
      if (avatar.classList.contains('status-running')) running++
      if (avatar.classList.contains('status-wait')) blocked++
    }
    node.textContent = blocked ? `● ${live} 人 · ${blocked} 卡住` : running ? `● ${live} 人 · ${running} 干活` : `● ${live} 人在线`
  }
}

function decorate(root: HTMLElement) {
  const canvas = root.querySelector('.dsh-org-office-canvas')
  const shell = root.querySelector('.dsh-org-office-shell')
  if (!(canvas instanceof HTMLElement) || !(shell instanceof HTMLElement)) return
  buildArchitecture(canvas)
  buildIntel(root, shell)
  updateZoneStats(root)
  root.dataset.hqV6 = '1'
}

function installEnhancements() {
  if (typeof document === 'undefined') return () => undefined
  let queued = false
  const run = () => {
    queued = false
    document.querySelectorAll('.dsh-org').forEach((node) => {
      if (node instanceof HTMLElement) decorate(node)
    })
  }
  const queue = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(run)
  }
  queue()
  const observer = new MutationObserver(queue)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

export function apply(ctx: any, config?: any) {
  applyV5(ctx, config)
  installStyle()
  const dispose = installEnhancements()
  if (ctx?.effect) ctx.effect(() => dispose, 'dsh-org-panel: hq-v6 visual enhancements')
}
