# 赛博公司 · DSH 多智能体工作台

> 一个运行在 DeepSeek Harness 当前会话里的真实多智能体公司面板：左侧是员工通讯录，中间是公司工作群与思考/工具轨迹，右侧是办公室状态侧栏。

`dsh-org-panel` 是一个面向 DeepSeek Harness Web 会话的纯 Client 插件。它不创建第二个聊天输入框，也不使用静态剧本伪造任务；所有消息、派活、子代理回复、工具调用和交付状态都来自当前 DSH 会话。

## 功能定位

赛博公司的主工作区是聊天和执行记录，办公室是帮助老板理解状态的可视化侧栏：

- 左侧员工通讯录：按部门、状态和关键词查找员工，单击定位，双击直接 `@` 员工。
- 中间公司工作群：保留当前 Tab 内的对话、思考过程、工具轨迹、交付结果和错误信息。
- 右侧办公室状态：显示真实员工在工位、会议室、茶水间、洗手间和放风区的可解释状态；v3 视觉层把侧栏装修成暗色赛博像素办公室（霓虹灯带、窗外城市夜景、吊灯、海报、白板、服务器机柜、扫地机器人等氛围细节）。
- 顶部组织架构：展示老板、秘书、管理层、人才与文化、产品研发、市场与知识等组织归属。
- 真实员工直连：明确 `@` 某位员工时，由对应独立子代理本人回复；秘书不会冒充员工。
- 多人会议：明确要求多人讨论、评审或开会时，由 `staff_meeting` 让真实员工按顺序发言并形成共同结论。
- 状态筛选与搜索：按干活中、已交付、卡住、待命筛选员工，搜索员工或任务。
- 员工档案：查看岗位介绍、工具、技能、当前任务，并从档案发起点名沟通。

### 当前 Tab 的交互原则

页面只使用 DSH Harness 原生底部输入框。老板可以直接输入：

```text
@老王 请检查这次发布的技术风险
@小刘 修复登录接口并回复验收结果
@阿明 @小周 讨论招聘需求，给我一个共同结论
```

未点名的公司统筹消息由秘书处理；点名员工的消息走真实员工直连；点名多人并要求讨论时进入真实员工会议。界面只在当前 Tab 更新，不跳转到 DSH 的“对话”或“轨迹”标签页。

## DSH 插件规范

本项目按 DeepSeek Harness 的纯 Client 插件约定组织：

| 位置 | 作用 |
| --- | --- |
| `package.json` 的 `dsh.client` | 声明 Web Client 平台和运行时注入：`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-ui-input-trigger` |
| `package.json` 的 `dsh.bundle.patch` | 声明作为 profile bundle 安装时要合入的默认 composition |
| `cordis.patch.yml` | 默认插入 `dsh-org-panel` composition row |
| `cordis.example.yml` | 手动挂载到 agent preset 的示例 |
| `src/index.ts` | Host 侧注册真实员工路由工具和秘书调度规则 |
| `src/client.tsx` | Client 入口，转出 `client-v3.tsx` 的 `apply` |
| `src/client-v2.tsx` | `conversation.view` 的赛博公司工作台实现（真实会话/员工路由逻辑与办公室 DOM 结构） |
| `src/client-v3.tsx` | 办公室视觉层：保留 v2 逻辑，用 CSS 覆盖把办公室装修成暗色赛博像素风 |

插件标签页通过以下方式注册：

```ts
slots.inject('conversation.view', () => slots.register({
  name: 'conversation.view',
  id: 'realm',
  order: 20,
  label: () => normalized.tabLabel,
}))
```

Host 侧需要的注入服务为：

```ts
export const inject = ['tools', 'subagents', 'systemPrompt']
```

其中：

- `staff_chat`：复用或启动对应员工的独立子代理会话。
- `staff_meeting`：依次启动 2 至 3 名员工，传递前序发言并形成会议结论。
- `systemPrompt`：注入秘书调度规则，让秘书只负责未点名统筹。

## 安装与挂载

### 插件市场或 npm

在 DSH 插件市场搜索 `dsh-org-panel` 或“赛博公司”，或者在插件项目中安装：

```bash
pnpm add dsh-org-panel
```

安装后刷新或重启 DSH，在当前会话顶部即可看到“赛博公司”标签页。

### agent preset composition

把下面的 composition row 放进 agent preset，完整示例见 [`cordis.example.yml`](./cordis.example.yml)：

```yaml
- id: org-panel
  name: dsh-org-panel
  config:
    tabLabel: 赛博公司
    companyName: 赛博公司
    chatEnabled: true
```

作为 profile bundle 安装时，`package.json` 必须包含 `dsh.bundle`，并且 `cordis.patch.yml` 必须被打进 npm 包的 `files`。如果出现：

```text
profile bundle "dsh-org-panel" declares no dsh.bundle in its package.json
```

请检查安装到 DSH 的实际包版本，而不是只检查本地源码；确认 `package.json` 有 `dsh.bundle.patch`，重新构建并重新安装包后再重启 DSH。

## 本地开发

```bash
pnpm install
pnpm typecheck
pnpm build
```

构建产物：

- Host：`lib/index.js`
- Client：`lib/client.js`
- 类型声明：`lib/*.d.ts`

本地源码只用于二次开发；DSH 运行时应加载构建后的 `lib` 目录。Windows 环境下如果已有 `node_modules`，请沿用当前 pnpm store，避免更换 store 导致 `ERR_PNPM_UNEXPECTED_STORE`。

## 配置员工与岗位

不改源码也可以通过 composition 覆盖 `roles` 和 `staff`：

```yaml
- id: org-panel
  name: dsh-org-panel
  config:
    tabLabel: 赛博公司
    companyName: 赛博公司
    chatEnabled: true
    roles:
      - id: designer
        tools: [read_image]
        skills:
          - name: 视觉设计
            desc: 出图、修图、搭建视觉方案
        keywords: [设计, 视觉, 图片, 海报]
    staff:
      - id: designer
        name: 小美
        role: 设计师
        emoji: 🎨
        roleId: designer
        department: 产品研发部
        reportsTo: 老王
        aliases: [小美, 设计师]
        intro: 负责把需求变成可交付的视觉方案。
        lines:
          idle: [等待设计需求]
          running: [正在制作设计稿]
          done: [设计稿已交付]
          wait: [等待素材或验收]
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `tabLabel` | `string` | Tab 名称，默认 `赛博公司` |
| `companyName` | `string` | 公司名称，默认 `赛博公司` |
| `chatEnabled` | `boolean` | 是否启用工作群快捷指令，默认 `true` |
| `roles` | `RoleDef[]` | 岗位能力映射：工具、技能和关键词 |
| `staff` | `StaffDef[]` | 员工身份、部门、汇报关系、别名和状态文案 |

## 会话数据来源

Client 侧通过 `useSession` 读取当前 DSH 会话快照：

- `tool-call` / `tool-result`：识别 `subagent*` 和 `workflow` 派活。
- `description` / `prompt` / `task`：提炼任务指令。
- `tool-result`：显示交付文本、错误和完成时间。
- 没有结果的调用：显示为执行中。
- `runningCalls`：显示实时工具调用。
- 用户消息、员工子代理消息和思考块：按原始顺序合并到中间工作群。

办公室的移动只根据员工岗位、任务状态和固定行动路线计算；它是状态解释层，不会生成或替代真实任务。

### 办公室视觉分层（v3）

办公室侧栏采用「逻辑与视觉分离」的两层结构：

- `src/client-v2.tsx` 负责办公室的 DOM 结构与状态逻辑：房间分区、家具、员工精灵移动都基于真实任务状态计算；静态装饰元素（吊灯、海报、白板、机柜、地毯、扫地机器人、霓虹灯带等）只承担氛围，不参与任何状态判断。
- `src/client-v3.tsx` 是纯视觉覆盖层：不改变任何逻辑，通过注入 CSS 把办公室装修成暗色赛博像素风（霓虹、窗外城市夜景、指示灯闪烁、扫地机器人巡逻等），并在窄屏与 `prefers-reduced-motion` 下自动收起装饰与动画。

## 默认组织

默认配置包含秘书和 7 名专业员工：

| 部门 | 员工 |
| --- | --- |
| 总裁办 | 秘书 |
| 管理层 | 老王 · 技术经理 |
| 人才与文化 | 小周 · 招聘负责人 |
| 产品研发部 | 小刘 · 程序员、阿明 · 产品经理、大壮 · 平台工程师 |
| 市场与知识部 | 小丽 · 市场调研、静静 · 文档专员 |

主 Agent 在界面中显示为“秘书”，但不会代替专业员工回答明确点名的消息。

## 目录结构

```text
dsh-org-panel/
├── package.json          # dsh.client、dsh.bundle 与发布元数据
├── cordis.example.yml    # agent preset 挂载示例
├── cordis.patch.yml      # profile bundle 默认 composition patch
├── src/index.ts          # Host 侧真实员工路由与秘书规则
├── src/client.tsx        # Client 入口（转出 v3）
├── src/client-v2.tsx     # 三栏工作台、办公室 DOM 结构与状态逻辑
├── src/client-v3.tsx     # 办公室视觉层：暗色赛博像素装修
└── .ui-craft/            # 项目级界面设计记忆与 token
```

## License

MIT

---

## English summary

`dsh-org-panel` is a pure client DeepSeek Harness plugin for a real multi-agent company workspace. The layout keeps the employee directory on the left, the conversation/thinking/tool trace in the center, and a compact office status sidebar on the right.

The plugin uses the native Harness composer in the current conversation tab. Unmentioned requests are handled by the secretary. Explicit employee mentions are routed to the corresponding independent subagent, while explicit multi-person discussions use the `staff_meeting` tool. The office view visualizes real task states and explainable routines; it does not fabricate work.

The package follows the DSH plugin contract through `dsh.client`, `dsh.bundle.patch`, `conversation.view`, and Cordis composition files. Run `pnpm typecheck` and `pnpm build` before packaging.
