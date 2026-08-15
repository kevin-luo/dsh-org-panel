# 纯牛马 · 朕的江山（dsh-org-panel）

> DeepSeek Harness plugin that turns real multi-agent dispatches into an interactive office board and group chat.  
> 一个把真实多智能体派活，变成「可交互员工办公室 + 牛马群聊」的 DeepSeek Harness 插件。

**Topics / 标签：** `dsh-plugin` · `deepseek-harness` · `multi-agent` · `subagent` · `workflow` · `visualization`

---

## 中文

### 这是什么

「纯牛马」不是虚构剧本。它从当前会话里**真实发生的派活**（`subagent` / `subagent_fork` / 其他 `subagent*` / `workflow` 工具调用）中提炼：

- 老板的派活指令；
- 每个数字员工的干活进度；
- 交付结果的结构化摘要；
- 卡住、完成、待命等真实状态。

然后用「公司办公室 + 手机群聊」的游戏化外壳把它呈现出来。

### 功能亮点

- 在会话顶部新增标签页「**纯牛马**」。
- **👑 老板派活气泡**：根据用户需求与真实派活调用，自动生成一句老板汇报。
- **牛马办公室**：默认 6 名数字员工（老王、小刘、阿明、小丽、大壮、静静），状态徽章实时显示：干活中 / 已交付 / 卡住 / 待命中。
- **任务卡**：真实派活挂到对应员工名下，展示任务指令、状态、开始时间、用时与交付摘要；交付摘要可展开/收起。
- **💬 牛马摸鱼群（可交互）**：
  - 真实派活、交付、卡住会变成群聊动态；
  - 老板可以直接在群里发消息；
  - 快捷指令：`进度`、`谁在摸鱼`、`交付清单`；
  - 员工会根据当前真实任务状态回复，不会伪造任务。
- **🔎 筛选与搜索**：按状态筛选员工，按员工名、任务内容、交付摘要搜索。
- **👤 员工档案**：点击员工查看人设、当前工位、能力（工具 + 技能），并可只看 TA 的工位。
- **🧩 可配置扩展**：员工与岗位可通过 composition 配置覆盖，不写死。

### 安装

已发布的 npm 包：

```bash
pnpm add dsh-org-panel
```

本地源码构建：

```bash
pnpm install
pnpm build          # 产出 lib/index.js 与 lib/client.js
pnpm typecheck      # TypeScript 检查
```

### 挂载

把插件挂载到你的 **agent preset** composition（示例见 `cordis.example.yml`）：

```yaml
- id: org-panel
  name: dsh-org-panel
  config:
    tabLabel: 纯牛马
    companyName: 朕的江山
    chatEnabled: true
```

重启 DSH 后，会话顶部会出现「纯牛马」标签页。

> 本插件是会话级 UI 贡献，推荐放在 agent preset。

### 使用与交互

1. 在对话里正常发起 `subagent` / `workflow` 派活。
2. 打开「纯牛马」标签页：
   - 员工卡片会根据真实任务自动进入「干活中 / 已交付 / 卡住 / 待命中」。
   - 顶部老板气泡自动汇总当前派活。
   - 右侧群聊同步真实动态。
3. 在群聊输入框直接发消息：
   - 输入 `进度`：返回当前任务统计。
   - 输入 `谁在摸鱼`：返回待命与忙碌员工名单。
   - 输入 `交付清单`：返回已完成交付列表。
   - @员工名（如 `小刘`）：该员工会按自己的真实状态回复。
4. 用顶部筛选按钮只看某类状态；用搜索框快速定位员工或任务。
5. 点击员工卡查看档案，点「只看 TA 的工位」聚焦该员工。

### 数据来源

插件通过 `useSession` 读取会话快照：

- `nodes` 中的 `tool-call` / `tool-result` → 提炼 `subagent*` 与 `workflow` 派活；
- `description` / `prompt` / `task` → 任务指令；
- `tool-result` → 交付内容、错误与完成时间；
- 有调用、暂无结果 → 干活中；
- `runningCalls` → 当前正在执行的派活。

所有任务状态都来自真实会话数据；群聊里的员工回复只基于这些真实状态生成。

### 扩展员工与岗位

在 composition 配置中传入自定义 `roles` 与 `staff` 即可，无需改源码：

```yaml
- id: org-panel
  name: dsh-org-panel
  config:
    roles:
      - id: designer
        tools: [read_image]
        skills:
          - name: 视觉设计
            desc: 出图、修图、搭视觉
        keywords: [设计, 视觉, 图片, 海报]
    staff:
      - id: designer
        name: 小美
        role: 设计师
        emoji: 🎨
        roleId: designer
        aliases: [小美, 设计师]
        intro: 审美在线，出图快。
        lines:
          idle: [等一个设计需求]
          running: [图在出了，别急]
          done: [设计稿交付]
          wait: [还差素材]
```

配置说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `tabLabel` | `string` | 标签页名称，默认 `纯牛马` |
| `companyName` | `string` | 公司名，默认 `朕的江山` |
| `chatEnabled` | `boolean` | 是否启用群聊交互，默认 `true` |
| `roles` | `RoleDef[]` | 岗位能力映射：`id`、`tools`、`skills`、`keywords` |
| `staff` | `StaffDef[]` | 员工定义：`id`、`name`、`role`、`emoji`、`roleId`、`aliases`、`intro`、`lines` |

### 插件规范

- `package.json` 通过 `dsh.client` 声明纯 client 插件及运行时依赖：
  - `@deepseek-ai/dsh-client-runtime`
  - `@deepseek-ai/dsh-client-ui-conversation`
- host 入口：`lib/index.js`；client 入口：`lib/client.js`。
- 通过 Cordis composition row 挂载：`{ id, name, config }`。
- 标签页注册：`conversation.view` slot，id 为 `realm`。

### 目录结构

```
dsh-org-panel/
├── package.json          # DSH 插件声明（dsh.client）与发布元数据
├── tsconfig.json
├── cordis.example.yml    # composition 挂载与配置示例
├── .gitignore
└── src/
    ├── index.ts          # host 半边（纯 client 插件的空宿主模块）
    ├── client.tsx        # client 入口
    └── client-v2.tsx     # 可交互主实现
```

### License

MIT

---

## English

### What it is

"Pure Niuma" is not a scripted story. It extracts **real dispatches** from the current session (`subagent`, `subagent_fork`, other `subagent*` tools, and `workflow` calls) and turns them into:

- the boss's dispatch summary;
- each digital employee's live progress;
- structured delivery summaries;
- real states such as running, delivered, blocked, and idle.

All of this is wrapped in a playful "company office + mobile group chat" shell.

### Highlights

- Adds a **Pure Niuma** tab to the conversation view.
- **👑 Boss bubble** generated from real user requests and dispatch calls.
- **Office board** with 6 default digital employees; each card shows a live status badge: Running / Delivered / Blocked / Idle.
- **Task cards** attached to the responsible employee, with instruction, status, start time, duration, and an expandable delivery summary.
- **💬 Interactive group chat**:
  - Real dispatches, deliveries, and errors appear as chat activity.
  - You can type messages as the boss.
  - Quick commands: `进度` (progress), `谁在摸鱼` (who is idle), `交付清单` (delivery list).
  - Employees reply based on their actual current task state; the plugin never fabricates tasks.
- **🔎 Filter and search**: filter employees by status and search by employee, task, or delivery text.
- **👤 Employee profile**: click a card to view persona, current tasks, tools, and skills, and focus on that employee's station.
- **🧩 Configurable**: staff and roles can be overridden through composition config.

### Installation

Published npm package:

```bash
pnpm add dsh-org-panel
```

Build from source:

```bash
pnpm install
pnpm build          # emits lib/index.js and lib/client.js
pnpm typecheck      # TypeScript check
```

### Mounting

Add the plugin to your **agent preset** composition (see `cordis.example.yml`):

```yaml
- id: org-panel
  name: dsh-org-panel
  config:
    tabLabel: 纯牛马
    companyName: 朕的江山
    chatEnabled: true
```

Restart DSH and the **Pure Niuma** tab will appear.

> This is a conversation-level UI contribution, so mounting it in an agent preset is recommended.

### Usage and interaction

1. Start real `subagent` / `workflow` dispatches in the conversation as usual.
2. Open the **Pure Niuma** tab:
   - Employee cards switch to Running / Delivered / Blocked / Idle based on real tasks.
   - The boss bubble summarizes active dispatches.
   - The group chat mirrors real activity.
3. Type in the chat input:
   - `进度`: current task statistics.
   - `谁在摸鱼`: idle and busy employees.
   - `交付清单`: completed deliveries.
   - Mention an employee by name (for example `小刘`): that employee replies according to their real state.
4. Use the status filters and the search box to locate employees or tasks quickly.
5. Click an employee card to open their profile, then use **Focus on this station** to filter the board.

### Data source

The plugin reads the session snapshot through `useSession`:

- `tool-call` / `tool-result` nodes → extracts `subagent*` and `workflow` dispatches;
- `description` / `prompt` / `task` → task instruction;
- `tool-result` → delivery text, error flag, and completion time;
- call without result → running;
- `runningCalls` → dispatches currently in flight.

All task states come from real session data; chat replies are generated only from those real states.

### Extending staff and roles

Pass custom `roles` and `staff` through composition config — no source changes required:

```yaml
- id: org-panel
  name: dsh-org-panel
  config:
    roles:
      - id: designer
        tools: [read_image]
        skills:
          - name: Visual design
            desc: Generate, retouch, and compose visuals
        keywords: [design, visual, image, poster]
    staff:
      - id: designer
        name: Mei
        role: Designer
        emoji: 🎨
        roleId: designer
        aliases: [Mei, designer]
        intro: Great taste, fast delivery.
        lines:
          idle: [Waiting for a design request]
          running: [Working on it]
          done: [Design delivered]
          wait: [Waiting for assets]
```

Configuration reference:

| Field | Type | Description |
| --- | --- | --- |
| `tabLabel` | `string` | Tab label, default `纯牛马` |
| `companyName` | `string` | Company name, default `朕的江山` |
| `chatEnabled` | `boolean` | Enable interactive chat, default `true` |
| `roles` | `RoleDef[]` | Role capability map: `id`, `tools`, `skills`, `keywords` |
| `staff` | `StaffDef[]` | Employee definitions: `id`, `name`, `role`, `emoji`, `roleId`, `aliases`, `intro`, `lines` |

### Plugin specification

- `package.json` declares a pure client plugin through `dsh.client` with runtime injections:
  - `@deepseek-ai/dsh-client-runtime`
  - `@deepseek-ai/dsh-client-ui-conversation`
- Host entry: `lib/index.js`; client entry: `lib/client.js`.
- Mounted through a Cordis composition row: `{ id, name, config }`.
- Tab registration: `conversation.view` slot with id `realm`.

### Directory structure

```
dsh-org-panel/
├── package.json          # DSH plugin declaration (dsh.client) and metadata
├── tsconfig.json
├── cordis.example.yml    # composition mounting and config example
├── .gitignore
└── src/
    ├── index.ts          # host side (empty host module for a pure client plugin)
    ├── client.tsx        # client entry
    └── client-v2.tsx     # interactive main implementation
```

### License

MIT
