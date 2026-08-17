# Changelog

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
