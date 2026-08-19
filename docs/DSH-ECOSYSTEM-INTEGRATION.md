# 赛博公司 × DSH 插件生态融合方案

> 分支：`feat/org-panel-20260817`
>
> 目标：赛博公司不再把每一种外部能力都自己重写一遍，而是成为 **DeepSeek Harness 之上的公司运行时、能力编排层和可视化控制台**。

## 1. 这次调研得到的关键结论

### 1.1 `@xmanrui/dsh-im` 已经是成熟通讯基础设施

`xmanrui/dsh-im` 当前已经覆盖：

- 微信
- 飞书
- 钉钉
- 企业微信
- QQ
- Slack
- Telegram
- Discord
- WhatsApp

它已经解决了赛博公司不应该重复维护的协议细节：

- 微信腾讯 iLink 扫码 + 长轮询
- QQBot v2 官方扫码 / AppID Secret
- 飞书扫码建机器人 / AppID Secret / 长连接
- 企业微信官方 SDK / WebSocket
- 钉钉 Stream
- Slack Socket Mode
- Telegram Long Polling
- Discord Gateway
- WhatsApp Web QR
- 会话与 Workspace 绑定
- 图片消息
- typing / streaming reply
- 连接监控、重连、删除账号
- 浏览器只读取脱敏 public status，凭证保留在 Host

因此通讯层的新策略调整为：

```text
以前
赛博公司
 ├─ 自己实现飞书
 ├─ 自己实现微信
 ├─ 自己实现 QQ
 ├─ 自己实现企微
 └─ ...

现在
赛博公司 Runtime
 ├─ Employee Identity
 ├─ Memory / Skills / History
 ├─ Routing / Permission
 ├─ Company Event Bus
 └─ Transport Providers
      ├─ DSH IM Bridge（推荐）
      │   └─ @xmanrui/dsh-im
      └─ Built-in Adapter（兼容）
```

赛博公司维护“员工是谁、消息交给谁、员工记住什么、完成了什么”；通讯插件维护“微信协议怎么连、二维码怎么签发、消息怎么收发”。

---

## 2. 为什么不把 dsh-im 源码直接复制进本仓库

不复制协议层代码，原因：

1. **维护成本**：微信 / QQ / 飞书协议变化应该由专业通讯插件跟进；
2. **依赖边界**：dsh-im 当前要求较新的 Node，并依赖多个平台 SDK；org-panel 不应该因此强制所有用户安装这些依赖；
3. **插件生态**：DSH 本来就支持插件组合，重复打包会破坏生态边界；
4. **安全边界**：dsh-im 已经实现 public status 脱敏、RPC payload 校验和 Host 凭证保存；
5. **可替换性**：未来出现更好的 IM 插件时，赛博公司只需要增加 Transport Provider，不需要重写公司 Runtime。

我们吸收它的**公开 RPC 契约、状态机和产品交互经验**，通过 DSH `connection.rpc` 协作。

---

# 3. 已经落地：跨插件 RPC Bridge

新增：

```text
src/client-v9/dsh-im-bridge.ts
```

同时把 `src/client-v9/rpc.ts` 从“只会调用 `/org-panel`”升级为通用 DSH 插件 RPC：

```ts
callRpcChannel(rpc, '/weixin', 'connection.status', {})
callRpcChannel(rpc, '/qq', 'connection.status', {})
callRpcChannel(rpc, '/feishu', 'connection.status', {})
```

原则：

- 不 import `@xmanrui/dsh-im`；
- 不增加硬依赖；
- 第三方频道不存在只影响该插件，不把 `/org-panel` 判死；
- RPC 返回必须是标准 `{ ok, value/error }` 信封；
- 非法频道名在 client 侧直接拒绝。

---

# 4. 已经落地：微信扫码接入第一版

公司设置 → 通讯新增：

```text
微信 · DSH IM Bridge
```

状态：

```text
未安装 dsh-im
    ↓
显示安装命令
    ↓
插件可用
    ↓
扫码接入微信
    ↓
starting
    ↓
pending
    ↓
scanned
    ↓
needs_verification（部分账号）
    ↓
connecting
    ↓
connected
```

使用 dsh-im 的真实公开端点：

```text
/weixin
  connection.status
  provision.begin
  provision.poll
  provision.verify
  provision.cancel
  bot.reconnect
  bot.delete
```

二维码为 Host 返回的 `qrCodeDataUrl`；配对码只在本次操作中传给 dsh-im RPC，不写入 org-panel 配置。

## 安全原则

赛博公司浏览器不读取：

- bot_token
- 微信长期凭证
- 原始 Secret

只消费：

- 脱敏账号名
- 连接状态
- Health
- 消息统计
- 一次性 QR data URL
- 一次性 pairing state

---

# 5. 消息进入赛博公司的链路

短期链路：

```text
微信 / QQ / 飞书
      ↓
@xmanrui/dsh-im
      ↓
Harness Workspace / Session
      ↓
赛博公司 System Prompt / 员工路由
      ↓
秘书 / 指定员工
      ↓
员工长期 Memory / Skills / Tools
      ↓
Harness Reply
      ↓
dsh-im
      ↓
原 IM
```

这样 Web、微信、飞书最终面对的是同一批员工，而不是创建“微信版老王 / Web 版老王”。

## 当前必须承认的边界

虽然消息可以进入同一个 Harness，公司 Runtime 目前还不能百分百从 dsh-im 的 Session Event 中拿到：

- 原始 `platform`
- 外部 `conversationId`
- 外部 sender id / name
- bot id

因此 **任务履历里的 source / channel provenance 还需要第二阶段桥接**。

在这条数据面打通前，不允许根据会话文本猜“这条任务来自微信”。

---

# 6. Phase 2：External Message Provenance

目标事件形状：

```ts
type ExternalMessageContext = {
  transport: 'dsh-im'
  platform: 'weixin' | 'feishu' | 'qq' | 'dingtalk' | 'wecom' | 'slack' | 'telegram' | 'discord' | 'whatsapp'
  botId?: string
  conversationId: string
  senderId?: string
  senderName?: string
  messageId?: string
}
```

进入 `core.dispatch()` 时转换为真实履历来源：

```text
TaskHistory.source
TaskHistory.channelId
CompanyEvent.external.message
```

实现优先级：

1. 优先使用 DSH / dsh-im 已暴露的 source metadata；
2. 如果公开契约没有该 metadata，向上游增加一个最小扩展点；
3. 不通过解析 Prompt 前缀伪造来源。

---

# 7. DSH 插件市场：当前已有能力

赛博公司已有：

```text
src/community-market.ts
```

发现顺序：

```text
awesome-dsh-plugin curated registry
        ↓ 失败
GitHub topic:dsh-plugin
```

员工能力不足时：

```text
Capability Scan
     ↓
Market Search
     ↓
候选插件
     ↓
安装申请
     ↓
老板批准
     ↓
真实安装
     ↓
Tool Registry Diff
     ↓
Smoke Test
     ↓
PluginBinding + SkillEvidence
```

这条思路继续保留。我们不会复制一份完整 `dsh-market`。

---

# 8. 从 dsh-market 吸收的产品 / 工程经验

`dsh-market` 已经证明以下能力有价值，赛博公司插件中心应逐步吸收：

## P0：插件可信来源分级

```text
Curated Registry     推荐
npm verified mapping 可安装
GitHub topic result  未审核候选
任意 URL / tarball   禁止
```

当前 `community-market.ts` 已经优先 curated registry；下一步让审批卡明确显示 Trust Tier。

## P0：环境兼容性预检

安装前显示：

- Node engine
- DSH 最低版本
- npm / pnpm availability
- 是否含 install/build script
- 是否需要重启
- 是否 Web Profile 兼容

不等装完以后才发现不兼容。

## P1：插件生命周期

插件设置从“已安装列表”升级为：

```text
安装
验证
启用 / 停用
更新
卸载
健康检查
```

其中启停应优先复用 DSH 官方 `cordis.patch.yml` / HMR 机制，避免自造第二套 Loader。

## P1：Diagnostics

加入：

- 重复插件
- 核心包多版本
- 依赖冲突
- Load Order
- Tool 名覆盖
- Missing Tool
- 插件版本与 Registry 最新版差异

这些信息可以同时进入员工“为什么当前能力不可用”的解释链。

## P1：备份 / 恢复

公司备份最终包含：

```text
company.json
communication routing
employee evolution
plugin manifest list
model bindings
```

Secret 只导出引用，不默认导出真实值。

---

# 9. 对“员工学习插件”的进一步调整

以后员工看到能力缺口时，不应该第一反应就是“我要安装一个新插件”。

顺序：

```text
1. Runtime Capability Scan
2. 公司已经安装但自己没绑定的能力
3. 已安装 DSH 基础设施插件能否直接复用
4. Curated Registry 搜索
5. 老板审批安装
```

例如员工需要“接微信”：

错误做法：

```text
自己生成一个 WeChat Adapter
```

正确做法：

```text
发现 @xmanrui/dsh-im
→ 判断它是公司级基础设施能力
→ 建议老板安装一次
→ 所有员工共享这条通讯 Transport
```

插件需要区分：

```text
Employee Capability Plugin
Company Infrastructure Plugin
UI / Theme Plugin
Developer Tooling Plugin
```

公司级基础设施不能绑定成某一个员工“私人拥有”的插件。

---

# 10. 下一阶段实施顺序

### Milestone B1（当前已开始）

- [x] Generic cross-plugin RPC
- [x] dsh-im optional bridge
- [x] 微信 `/weixin` status probe
- [x] 微信 QR begin / poll / verify / cancel
- [x] 微信 reconnect / remove
- [x] 通讯设置显示 dsh-im 安装缺失状态
- [x] 单测保护 RPC endpoint / payload

### Milestone B2

- [ ] 飞书 dsh-im provider 接入
- [ ] QQ 官方扫码 provider 接入
- [ ] 钉钉 / 企微接入
- [ ] Slack / Telegram / Discord / WhatsApp 状态归一化
- [ ] 一个统一“+ 添加通讯渠道”入口
- [ ] 同平台多账号

### Milestone B3

- [ ] External Message Provenance
- [ ] dsh-im 外部消息同步到 Company Event Bus
- [ ] 办公室前台出现“微信新消息 / 飞书新消息”真实事件
- [ ] TaskHistory.source 保存真实平台
- [ ] 外部会话 → 公司频道 / 默认员工映射

### Milestone C：生态插件控制台

- [ ] Market Trust Tier
- [ ] 环境兼容性预检
- [ ] 更新 / 停用 / 卸载
- [ ] HMR / restart required 状态
- [ ] Dependency / Load-order diagnostics
- [ ] 公司插件备份 / 恢复

---

# 11. 最终产品定位

赛博公司的核心不应该变成“又一个 DSH 插件市场”或“又一个 IM Bot 插件”。

最终结构：

```text
DeepSeek Harness
       ↓
DSH Plugin Ecosystem
  ├─ dsh-im
  ├─ Browser / Search
  ├─ GitHub
  ├─ Vision
  ├─ MCP
  └─ 其它 dsh-plugin
       ↓
Cyber Company Runtime
  ├─ Persistent Employees
  ├─ Employee Identity
  ├─ Skills + Evidence
  ├─ Memory
  ├─ Task History
  ├─ Plugin Binding
  ├─ Model Binding
  ├─ Permission / Routing
  └─ Company Event Bus
       ↓
Cyber Company UI
  ├─ Office
  ├─ Company Chat
  ├─ Employee Profile
  └─ Settings Control Plane
```

**我们做“公司”，社区插件做“公司的基础设施与工具”。**
