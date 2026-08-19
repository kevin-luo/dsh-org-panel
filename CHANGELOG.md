# Changelog

## 2.0.0

2.0 把 `dsh-org-panel` 从多 Agent 展示面板重构成持久化赛博公司运行时。

### 协作架构

- 删除“秘书 = 主 Agent / 其他员工 = 子 Agent”的业务拓扑。
- `Employee Runtime` 只负责执行一名指定员工；不再注册 `staff_chat` / `staff_meeting`，也不承担选人和业务路由。
- 新增唯一业务入口 `company_work` 与 `Work Orchestrator`：按任务语义、岗位能力、明确 `@` 自动选择 1～4 名真实员工组成工作组。
- 员工公开回复可以 `@` 另一位同事，运行时会把对方动态加入当前工作组。
- 每位员工仍使用自己的 Persona、长期记忆、技能、插件、模型绑定和 TaskHistory，员工之间是平级关系。
- DSH root session 只作为不可见 execution root，不再作为公司角色发言或总结员工输出。

### 持久工作组

- 新增 `WorkSessionStore`，默认文件 `~/.dsh-org-panel/work-sessions.json`。
- Web / 微信 / QQ / 飞书同一会话按稳定 key 复用同一个工作组，Host 重启后仍可恢复。
- 持久化来源平台、conversation/thread、sender、平台 messageId、成立目标、当前任务、参与员工、真实员工 turn、工具、outcome 和 taskId。
- `goal` 保留工作组成立目标，后续轮次只更新 `currentTask`。
- 平台 messageId 幂等，重复投递不会复制老板消息。
- 文件损坏时先保留 `.corrupt.bak` 原文，再 fail-closed，拒绝静默覆盖。
- `/org-panel` 新增 `work/sessions` / `work/session`；存储清单纳入 work-sessions 文件。
- 新 Session / 页面刷新时，公司工作群可以从 Host 显示最近持久工作组及最后真实交付。

### 持久数字员工与自我进化

- `evolution.json` V2 持久化员工长期记忆、复盘、技能、SkillEvidence、TaskHistory、插件绑定、模型绑定与统计。
- V1 → V2 自动迁移并保留备份；损坏员工档案无法安全备份时锁死写入。
- TaskHistory outcome 只认真实 `stopReason / isError`，不采信员工自述。
- 自动成长链：真实任务结单 → 观测真实工具 → SkillEvidence → 重算技能等级 → 真正跨级才发布 `skill.updated`。
- 同一任务 / 技能 / 工具不能重复刷证据；`partial / blocked` 不猜成败；陌生工具不会凭空生成高级技能。
- 员工档案新增成长时间线、真实等级/XP、技能证据、个人空间投影。

### 员工真实文本模型

- 文本员工模型支持显式 `dshProvider`，含义是 DSH `LlmRuntime` 当前真实注册的 provider route。
- 运行时调用 `llm.listProviders()` 校验 route，随后通过 DSH 官方 `subagents.start(... agentOptions)` 给员工传入：

  ```ts
  agentOptions: { provider, model }
  ```

- 员工显式 `ModelBinding` 优先；未绑定时按公司文本供应商顺序兜底。
- route 消失时绑定状态自动变 `missing`；恢复后可回 `available`。
- 没有真实可用 route 时员工继承当前 DSH 默认模型，TaskHistory 不记录假的专属模型。
- 设置 → 模型可直接选择当前 Host 真实注册的 DSH Provider Route，不需要手动编辑 `company.json`。
- 视觉 / 生图 / 视频 / Embedding 等能力继续由公司 Model Gateway 管理。

### 插件与能力进化

- 完整插件链：能力缺口 → 候选搜索 → 安装申请 → 人类批准 → 真实安装 → Capability Scan → Smoke Test → PluginBinding / SkillEvidence。
- LLM 无法批准自己的插件申请。
- 安装命令只允许受限 `dsh/npm/pnpm/yarn/bun add|install`；URL、tarball、`git+ssh:`、`file:`、本地路径与危险 shell 输入拒绝执行。
- 支持插件健康检查、missing/degraded 状态与技能历史保留。
- 插件市场优先 Curated Registry，再回退 GitHub `topic:dsh-plugin`；区分公司级基础设施与员工个人能力。

### 通讯

- 赛博公司优先复用独立 `@xmanrui/dsh-im` 插件的微信 / QQ / 飞书等通讯能力。
- 微信、QQ、飞书支持统一 Provider 形态的扫码 / 授权 / 手动配置 / 重连 / 移除。
- 外部消息与 Web 使用同一个 Work Orchestrator，因此不会再维护“IM 专属员工路由”。
- Adapter → Gateway → WorkRouter → Work Orchestrator → Employee Runtime → 权限审计 → 回信全链可 await，同一外部会话严格串行。
- 外部群可限制允许参与的员工；只读渠道继续 fail-closed，并记录越权工具事实。

### 公司设置 Control Plane

- `/org-panel` RPC 提供真正的 Host 读写面，不再把“设置”页做成只读假按钮。
- 模型支持新增、编辑、删除、启停、默认顺序、测试与员工绑定。
- 插件支持批准、拒绝、验证、健康检查。
- 通讯页能读取真实连接状态，并集成 dsh-im 配对流程。
- 安全、存储、数据来源状态全部区分“真实为空”和“当前拿不到”。

### 可视化经营层

- 办公室位置与状态由 Company Event 驱动；无事件时员工不会随机走动。
- 真实 task / meeting / blocked / plugin / skill 事件投影为办公室状态与短暂成长反馈。
- 工作群只展示具体员工原话，隐藏调度内核的路由 ACK。
- 员工等级、XP、成功率、成长轨迹和空间摘要全部来自持久档案，不用随机数制造养成感。

### 安全与工程质量

- `package.json` / lock 已升级到 `2.0.0`，`sharp` 升级到 `^0.35.3` 修复 libvips 高危依赖链。
- CI 现在强制：

  ```text
  npm ci
  npm audit --audit-level=high
  npm run typecheck
  npm run build
  node --test tests/*.test.mjs
  npm run size-check
  ```

- 密钥配置仍只接受 `env:` / `secret:` 引用，明文 secret 拒绝落盘。
- Host / Client 数据不可达时明确显示 unavailable / unknown，不用伪造的“在线 / 已连接 / 0 条数据”填充界面。

### 真实边界

- 外部通讯要执行员工任务，Host 必须已有可用 DSH execution root；没有时明确报不可执行。
- 员工专属文本模型只有在 `dshProvider` 真实存在于 DSH `llm.listProviders()` 时生效。
- Host → Browser 实时事件当前通过 `/org-panel events/since` 增量轮询同步，不是服务端 push；后台标签停止轮询并使用退避。
- DSH 当前不能向父会话完整暴露 child 内每一步工具状态，办公室不会编造“正在执行第 N 步”。
- DSH 子代理当前缺少通用的预执行工具白名单注入，因此 read-only 的真实边界是提示约束 + 事后工具观测 + 阻止对外回复；已经发生在 child 内的副作用无法回滚。
- dsh-im 是独立插件；未安装时扫码渠道明确显示不可用，不作为本包硬依赖。

## 1.4.0

- Cyber Company v1.4 workspace：像素办公室、员工列表、公司工作群、基础运行状态与首版员工档案。

## 1.0.0

- Initial DSH client plugin: office board, task extraction, staff cards, and static group chat.
