# 赛博公司设置中心优化目标：Settings Control Plane

> 目标分支：`feat/org-panel-20260817`
>
> 目标版本：v2.1（建议发布时再统一调整 `package.json` 版本）
>
> 核心目标：把「公司设置」从只读状态看板升级成真正的公司控制台。用户在设置页看到的配置项，要么可以直接修改并立即生效，要么明确标识为只读状态；不再出现“页面叫设置，但大部分按钮点不了”的体验。

---

## 1. 当前问题

当前设置中心已经具备较完整的真实数据读取能力：员工、模型、插件、通讯、安全、存储都能通过 `/org-panel` RPC 读取 Host 状态，并且能区分实时数据、会话数据和缓存数据。

问题集中在「写操作」没有跟上：

- 模型页能读取供应商，但空态只告诉用户去改 `company.json`，无法在 UI 新增供应商。
- 已有模型虽然能测试、启停、绑定员工，但无法编辑、删除；“设为默认”没有完整后端能力。
- 通讯页能看飞书 / QQ / 微信状态，但渠道、凭证、允许用户、允许群、群映射、默认负责人仍然只能改 Cordis YAML。
- 存储页只能看路径和大小，不能导出 / 导入。
- 安全页主要是状态汇总，无法调整审批策略和外部通讯默认权限。
- 某些页面存在可见按钮但 action 没接线，只能 disabled + tooltip，用户感受仍然是“假的设置页”。

这会直接削弱产品定位：既然叫「公司设置」，用户预期就是在这里完成公司的日常配置，而不是被引导去编辑 JSON / YAML。

---

## 2. 产品原则

### 2.1 设置页必须是 Control Plane

设置中心负责管理赛博公司的持久状态和运行时配置：

```text
浏览器设置中心
      ↓
/org-panel RPC
      ↓
Host Write Endpoints
      ↓
唯一持久化 Store / Runtime Manager
      ↓
立即刷新真实状态
```

禁止通过 Agent 对话“代替设置”。模型可以建议配置，但最终修改必须来自老板的 UI 操作。

### 2.2 所有可见控件必须满足二选一

1. **可以操作**：点击后真实写入、真实生效、返回真实结果；
2. **只读展示**：视觉上就是状态，不做成按钮 / Toggle / Select 的样子。

不再保留“看起来能点，但因为 action 缺失而 disabled”的长期状态。

### 2.3 写入后必须可验证

所有写操作遵循：

```text
保存 → Host 写入成功 → 重新读取 → UI 展示最终状态
```

不能只修改 React 本地 state 后显示“成功”。

### 2.4 单一真相来源

- 员工长期状态：`EvolutionStore`
- 公司模型配置：`CompanyStore`
- 插件审批：`PluginRuntime`
- 通讯配置：新增持久化 Store，由 `CommunicationManager` 消费
- UI 不直接改文件
- 不允许为 UI 再造一份“影子配置”

### 2.5 Secret 继续保持引用制

UI 永远不回显完整密钥。

推荐支持两种录入方式：

- `env:OPENAI_API_KEY`
- `secret:openai-main`

如果后续开放 Secret Vault 写入，则使用单独“保存密钥”动作；不能把明文 API Key 写进 `company.json` / `communication.json`。

---

# 3. 本轮第一目标：模型设置完全可操作（P0）

这是当前截图里最明显的问题，本轮优先完成。

## 3.1 空状态

当前：

```text
文本模型 未配置
未配置。
```

优化后：

```text
模型供应商                                      [+ 添加模型]

文本模型
还没有配置文本模型
[添加文本模型]

视觉模型
还没有配置视觉模型
[添加视觉模型]
```

不要再把“去编辑 ~/.dsh-org-panel/company.json”作为主路径。

高级用户仍可手动编辑配置文件，但只放在二级帮助说明里。

## 3.2 新增模型

点击「添加模型」打开 Drawer / Modal：

```text
添加模型供应商

能力类型        文本模型
协议            OpenAI Compatible
供应商 ID       openai-main
模型            gpt-5.x
Base URL         https://...
API Key 引用     env:OPENAI_API_KEY
超时             45000 ms
启用             是

[测试配置] [保存]
```

字段：

- `id`
- `type`
- `provider`
- `model`
- `baseUrl`
- `apiKeyRef`
- `timeout`
- `enabled`

约束：

- `id` 创建后默认不可修改，避免员工绑定失效；需要改 ID 时采用复制 + 删除。
- `apiKeyRef` 只接受 `env:` / `secret:`。
- 不允许出现 `apiKey` / `token` 等明文字段。
- OpenAI Compatible / Gemini / Custom 根据协议动态显示提示。

## 3.3 编辑模型

每个供应商行增加：

```text
[测试连接] [编辑] [启用/停用] [更多 ▾]
```

更多菜单：

```text
设为默认
复制配置
删除供应商
```

删除前必须提示：

- 当前有哪些员工绑定它；
- 删除后这些绑定会变成 missing；
- 需要二次确认。

## 3.4 默认供应商

“默认”必须有真实语义。

当前 Gateway 的公司兜底链由 `CompanyStore.modelProviders()` 顺序决定，因此新增：

```ts
CompanyStore.setDefaultModelProvider(providerId, type)
```

行为：只在同 `type` 内把指定 provider 移到第一位，不改变其他能力类型的顺序。

新增 RPC：

```text
models/setDefault
```

前端不再显示一个永远 disabled 的“设为默认”。

## 3.5 删除供应商

新增 RPC：

```text
models/remove
```

删除只删除公司供应商定义；员工历史 `ModelBinding` 不静默删除，Router 后续将其标记为 `missing`，这样员工档案仍能解释“以前绑定过什么、为什么现在不可用”。

## 3.6 员工绑定

保留现有绑定功能，并优化交互：

- 在模型页按能力批量查看员工绑定；
- 在员工档案页也可以从员工视角修改；
- 显示 `显式绑定` / `公司兜底`；
- 明确显示绑定优先级。

## 3.7 模型页验收标准

- [ ] 空模型状态下能直接点击“添加模型”。
- [ ] 能新增 OpenAI Compatible / Gemini / Custom 配置。
- [ ] `company.json` 真正写入且重启后仍存在。
- [ ] 可以编辑 model / baseUrl / apiKeyRef / timeout。
- [ ] 可以启用 / 停用。
- [ ] 可以设为默认，刷新后默认标记与 Gateway fallback 顺序一致。
- [ ] 可以删除供应商。
- [ ] 可以测试连接，并区分 `live-call` / `config-only`。
- [ ] 可以给员工绑定 / 解绑模型能力。
- [ ] 所有失败都显示 Host 返回的真实原因，不伪造成功。

---

# 4. 第二目标：通讯设置真正可配置（P0）

模型页完成后立即做通讯页。

## 4.1 新增持久化通讯配置

当前通讯配置主要来自 Cordis `communication:` 段，不适合作为 UI 控制台的写入目标。

建议新增：

```text
~/.dsh-org-panel/communication.json
```

新增：

```ts
CommunicationStore
```

职责：

- adapters
- channelBindings
- access rules
- routing
- credentials SecretRef
- updatedAt

Host 启动时合并优先级：

```text
UI 持久化 communication.json
>
Cordis communication 配置
>
代码默认值
```

Cordis 保留为部署级初始值 / DevOps 配置；UI 设置成为日常控制面。

不要让 UI 直接修改 `cordis.yml`。

## 4.2 通讯页新增渠道

顶部：

```text
通讯渠道                                  [+ 添加渠道]
```

点击：

```text
选择平台

飞书              已支持
QQ                开发中
企业微信          开发中
```

未实现的平台可以展示，但不要让用户进入一个最终无法保存的假表单。

## 4.3 飞书配置表单

```text
渠道名称          公司飞书
连接方式          长连接 / Webhook
App ID 引用        env:FEISHU_APP_ID
App Secret 引用    env:FEISHU_APP_SECRET
Verification Token env:FEISHU_VERIFY_TOKEN
Encrypt Key        env:FEISHU_ENCRYPT_KEY

[测试连接]
```

Access：

```text
默认权限          Read Only / Workspace Write / Full Access
允许名单外用户    否
允许名单外群      否
```

Routing：

```text
默认负责人        秘书 / 自动分派 / 指定员工
识别 @员工         是
允许员工转交       是
最多转交           3 次
投递失败通知       是
```

群映射：

```text
飞书群 chat_xxx → #研发群 → 小刘 / 老王
```

## 4.4 通讯 RPC

新增：

```text
communication/upsert
communication/remove
communication/setEnabled
communication/reconnect
communication/test
communication/bindChannel
communication/unbindChannel
```

所有动作完成后统一重新读取 `communication/summary`。

## 4.5 Runtime 重载

保存配置后不能要求整个 DSH 重启。

`CommunicationManager` 需要支持：

```ts
applyConfig(nextConfig)
```

行为：

1. 比较 Adapter 变更；
2. 停止被删除 / 变更的 Adapter；
3. 保留未变化连接；
4. 启动新增 / 启用 Adapter；
5. 更新 Router bindings / roster；
6. 返回真实连接状态。

## 4.6 通讯页验收标准

- [ ] UI 能创建飞书渠道。
- [ ] UI 能修改并持久化飞书配置。
- [ ] UI 能启用 / 停用 / 重连。
- [ ] UI 能配置允许用户 / 允许群 / 权限档位。
- [ ] UI 能配置群 → 公司频道 → 员工映射。
- [ ] 保存后无需重启即可生效。
- [ ] 重启 DSH 后配置仍存在。
- [ ] QQ / 微信未实现时清晰显示“暂未支持”，不提供假连接按钮。

---

# 5. 第三目标：其余设置页去“只读看板化”（P1）

## 5.1 员工

可修改：

- 显示名称
- 岗位描述
- 部门
- aliases
- 默认模型绑定
- 插件启停

员工 ID 不允许直接修改。

长期记忆 / 履历 / 技能证据仍然是档案数据，不在“设置”里直接篡改。

## 5.2 插件

现有审批动作保留，再增加：

- 插件搜索
- 安装申请详情
- 员工绑定关系
- 禁用 / 恢复
- 重新验证
- 卸载（必须单独设计安全策略）

插件安装依旧必须保持“员工申请 → 老板批准”，不能因为设置页可操作就允许 LLM 自批。

## 5.3 安全

可设置：

- 插件审批策略
- preapproved 包列表
- 外部通讯默认权限
- 最大员工转交次数
- 本地 Secret Vault 是否要求 passphrase（仅状态 + 引导；不能读取口令）

## 5.4 存储

增加：

```text
[导出备份]
[从备份恢复]
```

建议备份包：

```text
dsh-org-panel-backup-YYYYMMDD.zip
  evolution.json
  company.json
  communication.json
  approvals.json
  manifest.json
```

密钥文件默认不导出；需要单独显式勾选并警告。

---

# 6. UI 结构调整

当前页面的问题除了不能点，还有“5 个巨大的空卡片占满一屏”。

模型页建议改成：

```text
模型
公司能力模型与员工专属模型

[+ 添加模型]

┌ 文本模型 ─────────────────────────────┐
│ openai-main   GPT-x       可用  默认   │
│              [测试] [编辑] [⋯]       │
└──────────────────────────────────────┘

视觉模型
还没有配置视觉能力
[添加视觉模型]

图片生成  未配置   [配置]
视频生成  未配置   [配置]
Embedding 未配置   [配置]
```

空能力不要每项都渲染 90px 高的卡片；压成 compact empty row。

设置中心整体视觉规则：

- 状态信息弱化；
- 可操作项强化；
- 主操作固定在右上角；
- 空态必须带下一步动作；
- “配置文件路径”放进帮助说明，不作为主 CTA；
- 危险操作统一 danger 风格 + 二次确认。

---

# 7. 技术实施顺序

## Milestone A — Models Control Plane

涉及：

```text
src/persistence/company-store.ts
src/host/org-panel-write.ts
src/client-v9/company-bridge.ts
src/client-v9/settings/ModelSettings.tsx
src/client-v9/settings/styles.ts
tests/org-panel-rpc.test.mjs
tests/model-config.test.mjs
```

任务：

1. `CompanyStore.setDefaultModelProvider()`
2. `models/remove`
3. `models/setDefault`
4. client WRITE_ENDPOINTS 接线
5. `ModelSettingsActions` 增加 `upsert/remove`
6. 新增 / 编辑表单
7. 删除确认
8. 默认供应商真实生效
9. 单元测试

## Milestone B — Communication Control Plane

涉及：

```text
src/persistence/communication-store.ts
src/integrations/im/manager.ts
src/host/org-panel-read.ts
src/host/org-panel-write.ts
src/client-v9/company-bridge.ts
src/client-v9/settings/CommunicationSettings.tsx
tests/im-*.test.mjs
```

## Milestone C — Settings Completion

员工 / 插件 / 安全 / 存储。

---

# 8. Definition of Done

v2.1 的“设置中心完成”必须同时满足：

1. 用户首次安装插件后，不编辑 JSON / YAML，也能完成至少一个模型供应商的配置。
2. 用户不编辑 JSON / YAML，也能完成飞书渠道的日常配置与重连。
3. 设置页没有长期存在的“假按钮”。
4. 所有设置重启后仍存在。
5. 所有写操作都走 `/org-panel` 人类控制通道，不暴露给 LLM Tool Registry。
6. 所有 Secret 继续 fail-closed，不把明文写进普通配置文件。
7. `npm test` 覆盖新增 RPC、持久化和权限边界。
8. UI 显示的数据必须可以追溯到真实 Host 状态。

---

# 9. 本轮明确不做

为了避免继续扩散范围，本轮不优先做：

- QQ Adapter 实现
- 微信 Adapter 实现
- 新办公室美术
- 新员工数量
- 更多动画
- 复杂 KPI 大屏
- 插件自动卸载
- 模型计费统计

先把公司控制面打通，再扩功能。

---

# 10. 当前优先级

```text
P0  模型设置 CRUD + 默认 + 测试 + 员工绑定
P0  飞书设置 CRUD + 权限 + 群映射 + Runtime 重载
P1  员工配置
P1  安全策略配置
P1  存储导入 / 导出
P1  插件管理完善
P2  QQ / 微信真实 Adapter
P2  员工独立 text ModelBinding 真正接管 SubAgent provider
```

当前先执行 **Milestone A：Models Control Plane**。