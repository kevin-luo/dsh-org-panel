# Changelog

## 1.3.0

中文：

- UI 架构重构：全新组件化 `client-v9`，彻底告别 client-v2~v8 的 CSS wrapper 套娃；布局对齐设计稿（顶栏经营指标 / 左员工列表 / 中央赛博办公室 / 底部公司群聊 / 右经营面板）。
- 办公室改为真实美术资产：1200×720 固定逻辑尺寸，10 个部门区域全部由 PNG 地板、家具、招牌、玻璃墙、城市窗景拼接，员工以 sprite 小人呈现，仅保留 100/90/80 三档缩放，不再有 SVG/CAD 感。
- 公司群聊回归：频道列表 + 真实消息流（老板指令、员工本人回复、多人会议记录、工具执行卡、可展开工作思路），支持 @员工自动补全，内容全部来自真实 SubAgent 执行结果，无假聊天。
- 员工状态与办公室联动：working/thinking/meeting/blocked/done 对应名字颜色、气泡、会议室移动与徽标动画。
- 右侧经营面板全部消费真实会话数据：公司状态、当前任务流、员工成长动态、技能学习队列、DSH 插件市场精选（安装需老板批准），无数据时展示空态，不写死任何 KPI。
- Host 入口切换至 `host-v3`，社区插件市场（staff_plugin_market_search）真正生效；build 同步复制美术资产到 lib/assets。
- 修复资产路径解析：DSH 客户端 bundle 经 `__ModuleLoader__` fetch + eval 加载、页面无 `<script src>`，导致全部办公室/员工图片 404；现改为多策略探测（script 标签 / performance 资源记录 / ModuleLoader 注册表）+ 小图运行时校验，并支持 `config.assetBase` 手动指定资产根路径。

English:

- UI architecture rewrite: brand-new componentized `client-v9` replaces the client-v2~v8 CSS wrapper chain; layout follows the design mock (header KPIs / staff list / cyber office / company group chat / right rail).
- The office is now built from real art assets: a fixed 1200×720 world with 10 department zones composed from PNG floors, furniture, signs, glass walls and city windows; only 100/90/80 zoom steps, no SVG/CAD look.
- Company group chat is back: channels plus a real message feed (boss orders, direct employee replies, meeting transcripts, tool-call cards, expandable work notes) with @-mention autocomplete — every message comes from real SubAgent execution, no fake chats.
- Employee states drive the office: working/thinking/meeting/blocked/done map to name colors, bubbles, meeting-room movement and badges.
- The right rail consumes real session data only: company status, live task flow, growth feed, skill queue and DSH plugin market picks (install requires boss approval); empty states instead of fake KPIs.
- Host entry switched to `host-v3` so the community plugin market is actually loaded; build now copies art assets into lib/assets.
- Fixed asset base resolution: the DSH client bundle loads via `__ModuleLoader__` fetch + eval (no `<script src>` in the page), which 404'd every office/portrait image; the base is now resolved by multi-strategy detection (script tags / performance resource entries / ModuleLoader registry) plus a runtime image probe, with `config.assetBase` available as a manual override.

## 1.2.0

中文：

- 办公室整体装修升级：新增吊灯、霓虹灯带、窗外城市夜景、墙面海报、会议室白板、服务器机柜、饮水机、地毯、落地灯、文件柜与更多绿植等氛围细节。
- 新增地面扫地机器人巡逻动画，办公室更有"正在营业"的生活气息。
- 装修元素为纯静态装饰层，不参与任何状态判断；窄屏与系统减弱动态效果时自动隐藏或停用动画。
- 视觉分层明确：`client-v2.tsx` 负责办公室 DOM 结构与状态逻辑，`client-v3.tsx` 作为纯视觉覆盖层负责赛博化装修。
- 文档同步：README 补充 v3 视觉分层说明与目录结构，设计记忆（`.ui-craft`）同步装修约束。

English:

- Office visual upgrade: ceiling lamps, neon strip, night city view through the window, wall posters, meeting whiteboard, server rack, fridge, rug, floor lamp, filing cabinet and extra plants.
- A floor-sweeping robot now patrols the office floor, making the office feel alive.
- Decorations are a purely static layer that never affects status logic; they collapse on narrow screens and respect reduced motion.
- Clear visual layering: `client-v2.tsx` owns office DOM/logic, `client-v3.tsx` is a pure CSS visual layer for the cyber renovation.
- Docs synced: README gained the v3 layering section and updated tree; design memory (`.ui-craft`) now records renovation constraints.

## 1.1.0

中文：

- 群聊从静态轮播升级为可交互：老板可输入消息，员工按真实任务状态回复。
- 新增快捷指令：进度、谁在摸鱼、交付清单。
- 新增状态筛选与员工/任务搜索。
- 员工档案增加当前工位与「只看 TA 的工位」。
- 派活识别扩展到 `subagent*` 全系列与 `workflow`。
- 员工与岗位支持通过 composition 配置覆盖。
- 完善中英文 README、挂载示例与 MIT License。

English:

- Group chat is now interactive: type messages as the boss and employees reply from their real task state.
- Added quick commands: progress, idle employees, delivery list.
- Added status filters and employee/task search.
- Employee profile now shows current tasks and a "focus this station" action.
- Dispatch detection now covers all `subagent*` tools and `workflow`.
- Staff and roles can be overridden via composition config.
- Added bilingual README, mounting example, and MIT License.

## 1.0.0

- Initial DSH client plugin: office board, task extraction, staff cards, and static group chat.
