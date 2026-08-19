# 赛博公司 · DSH 数字员工运行时 2.0

> 把 DeepSeek Harness 变成一家公司：员工长期存在、各自成长，任务会自动组队，Web / 微信 / QQ / 飞书进入同一套协作运行时。

`dsh-org-panel` 2.0 的核心不是“多几个 Agent 卡片”，而是一套 **Persistent Cyber Company Runtime**。

每位数字员工都有自己的长期记忆、技能证据、工作履历、插件绑定、模型绑定和成长轨迹；公司任务由 Work Orchestrator 自动选择合适员工组成临时或持续工作组，员工之间可以直接协作、互相 `@` 拉同事入场。秘书只是总裁办的一名普通员工，只会在行政、日程、会议安排等任务命中她的岗位时参与。

## 架构

```text
Web / 微信 / QQ / 飞书 / 其他 DSH IM
                │
                ▼
         Work Orchestrator
         任务理解 / 自动组队
         显式 @ / 动态邀请
                │
                ▼
       Persistent WorkSession
   来源 / 会话 / 成员 / 历史交付
                │
      ┌─────────┼─────────┐
      ▼         ▼         ▼
    小刘       小画       阿明   ...
   程序员     设计师     产品经理
      │         │         │
      └─────────┼─────────┘
                ▼
        Employee Runtime
                │
  ┌─────────────┼─────────────┐
  ▼             ▼             ▼
长期记忆      SkillEvidence   TaskHistory
插件/工具      自动成长       真实模型路由
                │
                ▼
         evolution.json
```

DSH root session 只承担不可见的执行根职责，不代表任何员工，也不会以“主 Agent”身份向用户汇报。

## 2.0 真实能力

### 持久数字员工

每位员工独立持久化：

- 长期记忆与复盘
- 技能与真实 `SkillEvidence`
- XP / Level / 成长轨迹
- TaskHistory
- 插件绑定与健康状态
- 模型绑定
- 统计数据与最近活动

刷新页面或重启面板不会把员工重置成一份新 Prompt。

### 动态工作组

老板可以直接输入：

```text
帮我重新设计 App 首页，同时评估实现成本和后续推广。
```

Work Orchestrator 会根据岗位和任务语义自动拉合适的员工，例如产品、视觉、开发、增长组成工作组。明确 `@小刘` 会锁定小刘，复杂任务仍可以补充相关同事；员工公开回复里写 `@小麦 帮我评估传播策略`，小麦会动态加入同一个工作组。

员工看到同一份原始任务以及前序同事真实公开输出，可以补充、质疑和接棒。业务输出直接来自具体员工，不经过秘书二次转述。

### 持久 WorkSession

同一个 Web / 微信 / QQ / 飞书会话会复用稳定工作组上下文：

- 原始来源平台
- conversation / thread
- sender
- 平台 messageId 去重
- 成立目标 `goal`
- 当前任务 `currentTask`
- 参与员工与加入原因
- 每轮员工真实回复、工具、结果、对应 taskId

第二轮任务能看到第一轮真实协作结果，重启 Host 后仍可恢复。

### 员工自己的真实文本模型

文本模型不再只是“配置里有个名字”。2.0 会读取 DSH `LlmRuntime.listProviders()` 的真实 provider route，并在启动员工子代理时传入：

```ts
agentOptions: {
  provider: "deepseek",
  model: "deepseek-v3"
}
```

配置模型时需要指定：

```text
公司 Provider ID     coder-main
DSH Provider Route   deepseek
Model                deepseek-v3
```

员工显式绑定优先，其次按公司文本模型顺序兜底。DSH route 不存在时绑定会如实标记为 `missing`，员工继续继承当前 DSH 默认模型，不会假装专属模型已经生效。

视觉 / 生图 / 视频 / Embedding 等公司能力继续由 Model Gateway 管理。

### 证据驱动的自我进化

技能不会因为 Agent 自述“我学会了”就升级。

```text
真实任务完成
→ 观测真实工具调用
→ SkillEvidence
→ 重新计算技能等级
→ 真正跨级才发 skill.updated
→ 成长轨迹 / 办公室升级反馈
```

同一任务同一技能不会重复刷证据；`partial / blocked` 不猜成败；找不到可信技能时不会凭空创建高级技能。

### DSH 插件生态

员工发现能力缺口时优先扫描公司已有能力，再进入 DSH 插件生态。插件安装链为：

```text
能力缺口
→ 搜索候选插件
→ 安装申请
→ 人类审批
→ 真实安装
→ Capability Scan
→ Smoke Test
→ PluginBinding / SkillEvidence
```

LLM 无法给自己的安装申请批准。URL、tarball、`git+ssh:`、`file:`、本地路径和危险 shell 形式会被拒绝。

### 通讯与扫码接入

推荐安装 [`@xmanrui/dsh-im`](https://github.com/xmanrui/dsh-im) 作为通讯基础设施：

```bash
dsh plugin --profile web add @xmanrui/dsh-im
```

赛博公司通过 DSH RPC 复用它的微信 / QQ / 飞书等渠道能力。微信、QQ、飞书的扫码或授权状态会直接进入“设置 → 通讯”。

外部消息进入赛博公司后仍走同一个 Work Orchestrator，所以：

```text
微信消息
→ 自动识别任务
→ 产品 + 设计 + 开发动态组队
→ 各自真实执行
→ 各自积累履历 / 技能证据
→ 员工原话回到微信
```

内置 IM Runtime 保留 transport / ACL / fail-closed 权限能力，但新的业务协作不会再维护另一套员工路由逻辑。

## 可视化经营层

办公室是 Runtime 的游戏化投影，不生成随机“忙碌”。

- 真实任务开始 → 员工离开工位工作
- 真实会议 / 工作组 → 对应协作状态
- 真实插件行为 → 服务器 / 能力事件
- 真实技能跨级 → 短暂升级反馈
- 真实 blocked → 显示阻塞原因
- 无新事件 → 员工位置保持稳定

员工档案包含概览、成长、技能、记忆、插件、履历；长期目标是让个人空间里的设备、证书和工作台都对应真实插件 / 技能 / 模型资产。

## 设置中心

“设置”页只保留两类内容：真正可操作的设置，或者明确标注为只读状态的数据。

当前包括：

- 员工
- 模型
- 插件
- 通讯
- 安全
- 存储

模型支持新增、编辑、删除、启停、默认顺序和员工绑定。文本模型可选择 Host 当前真实注册的 DSH Provider Route，不需要手改 `company.json`。

## 安装

```bash
npm install dsh-org-panel
```

最小 Cordis 挂载：

```yaml
- id: org-panel
  name: dsh-org-panel
  config:
    tabLabel: 赛博公司
    companyName: 赛博公司 · AI 员工总部
```

完整示例见 [`cordis.example.yml`](./cordis.example.yml)，配置说明见 [`docs/CONFIG.md`](./docs/CONFIG.md)。

## 持久化文件

默认位于：

```text
~/.dsh-org-panel/evolution.json           员工记忆 / 技能 / 证据 / 履历 / 绑定
~/.dsh-org-panel/company.json             公司配置 / 模型供应商
~/.dsh-org-panel/work-sessions.json       跨渠道持久工作组
~/.dsh-org-panel/plugin-approvals.json    插件审批台账
~/.dsh-org-panel/secrets/...              本地密钥材料
~/.dsh-org-panel/attachments/             外部消息附件
```

`evolution.json` 与 `work-sessions.json` 解析损坏时都采用 fail-closed：先保留原文备份，再拒绝静默覆盖历史。

## 密钥与权限

模型和通讯配置中的密钥只接受 `env:XXX` / `secret:XXX` 引用，明文密钥拒绝落盘。

外部 IM 权限默认收紧：未知用户、未知会话和只读渠道不会被隐式提权。当前 DSH 子代理接口没有提供通用的工具白名单注入能力，因此 `read-only` 主要依赖“权限提示 + 对真实工具调用的事后审计 + 拦截对外回复 + blocked 记录”；如果写工具已经在 child 内执行，宿主无法倒转已经发生的副作用，这个边界不会在 UI 里伪装成预防式沙箱。

## 真实边界

- 外部 IM 继续工作需要 Host 曾经获得一个可用 DSH execution root；没有执行根时会明确提示，绝不伪造员工回复。
- 员工专属文本模型必须映射到 DSH 当前真实注册的 provider route；没有 route 时继承 DSH 当前默认模型。
- Browser 的 Host → Client 事件同步目前使用 `/org-panel events/since` 增量轮询，不是服务器 push；页面隐藏时停止轮询并带退避。
- DSH 父会话目前不能完整暴露 child 内每一步工具执行流，因此办公室不会编造“正在执行第 N 步”。
- `@xmanrui/dsh-im` 是独立 DSH 插件；未安装时扫码渠道会明确显示不可用，不把第三方插件硬绑成 package dependency。

## 验证门禁

PR 和 `main` 都必须通过：

```text
npm ci
npm audit --audit-level=high
npm run typecheck
npm run build
node --test tests/*.test.mjs
npm run size-check
```

当前发布版本：**2.0.0**。
