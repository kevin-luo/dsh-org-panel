# 配置参考

本文列出 `dsh-org-panel` **真实被代码读取**的每一个配置项。没有出现在这里的字段就是没有实现，
写了也不会生效。可直接复制的完整示例见仓库根目录的 [`cordis.example.yml`](../cordis.example.yml)。

配置写在 agent preset 的 composition row 里：

```yaml
- id: org-panel
  name: dsh-org-panel
  config:
    # ↓ 下面所有字段都写在这一层
```

同一份 `config` 会同时下发给 host（`lib/index.js`）与 client（`lib/client.js`）。

---

## 1. 界面

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `tabLabel` | string | `赛博公司` | `conversation.view` Tab 的标题 |
| `companyName` | string | `赛博公司 · AI 员工总部` | 顶栏公司名 |
| `chatEnabled` | boolean | `true` | 是否显示公司群聊区 |
| `assetBase` | string | — | **已废弃**。v1.4 起运行时图片已内联进 bundle，这个字段不再被读取，保留只为不让旧配置报错 |

## 2. 员工与岗位

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `staff` | array | 内置 15 人 | **整份名册替换**，不是追加。写了它，内置员工就不再出现 |
| `roles` | array | 内置岗位表 | 岗位定义（client 侧用于分组与文案） |

内置员工 id：

```text
secretary  tech-lead  recruiter  developer  pm  researcher  platform  doc
search-specialist  image-creator  video-producer  novelist  social-editor
data-analyst  growth
```

`staff[]` 条目字段（host 与 client 读到的并集）：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✓ | 员工唯一 id。Web 与飞书共用同一个 id，不存在「平台分身」 |
| `name` | ✓ | 显示名，`@` 提及用它 |
| `role` | ✓ | 岗位名 |
| `roleId` |  | 关联内置岗位（`roles[].id`）；同时用于回落到内置蓝图取默认能力 |
| `emoji` |  | 列表与办公室小人的标记 |
| `department` |  | 部门，用于通讯录分组。**注意**：`roleId` 命中内置岗位时，client 侧会用内置的岗位→部门映射覆盖这里写的值 |
| `reportsTo` |  | 汇报对象（client 侧组织架构显示） |
| `aliases` |  | 别名数组，`@` 识别会一并匹配 |
| `brief`（host）/ `intro`（client） |  | 一句话职责。host 读 `brief`，读不到才读 `intro`；client 只读 `intro`。两边都要显示就两个都写 |
| `capabilities` |  | 能力关键词；外部渠道的 auto 路由用它匹配 |
| `preferredToolHints` |  | 偏好工具提示。**它不是真实调用记录**，履历里的工具列表只来自真实执行结果 |
| `lines` |  | client 侧各状态的台词表 `{ 状态: string[] }` |

`roles[]` 条目字段：`id`（必填）、`tools[]`、`skills[]`、`keywords[]`。同样是整份替换。

## 3. 数据文件与环境变量

| 字段 | 环境变量 | 默认路径 | 内容 |
| --- | --- | --- | --- |
| `memoryFile` | `DSH_ORG_PANEL_MEMORY_FILE` | `~/.dsh-org-panel/evolution.json` | 员工记忆 / 技能 / 技能证据 / 复盘 / 履历 / 插件绑定 / 模型绑定 |
| `companyFile` | `DSH_ORG_PANEL_COMPANY_FILE` | `~/.dsh-org-panel/company.json` | 公司档案 + 模型供应商配置 |
| `approvalsFile` | `DSH_ORG_PANEL_PLUGIN_APPROVALS_FILE` | `~/.dsh-org-panel/plugin-approvals.json` | 插件安装申请与审批台账 |
| `secretsFile` | `DSH_ORG_PANEL_SECRETS_FILE` | `~/.dsh-org-panel/secrets/credentials.enc` | 本地密钥库（`secret:` 引用的落点） |
| `attachmentDir` | — | `~/.dsh-org-panel/attachments` | 外部渠道下载的附件 |
| `secretsPassphrase` | `DSH_ORG_PANEL_SECRETS_PASSPHRASE` | — | 本地密钥库口令，见 §4 |

优先级：`config` 里的显式路径 > 环境变量 > 默认路径。

## 4. 密钥

**任何密钥字段都只接受引用，明文一律当场 throw**（`models[].apiKeyRef`、
`communication.adapters[].credentials.*` 都受此约束）：

| 写法 | 解析来源 |
| --- | --- |
| `env:VAR_NAME` | `process.env.VAR_NAME` |
| `secret:NAME` | 宿主的 Secret Service（若 `ctx` 上探测得到），否则回落本地密钥库 |

本地密钥库有两档真实保护等级，UI 会如实显示、不会一律打绿标：

| 档位 | 触发条件 | 实际强度 |
| --- | --- | --- |
| `obfuscated`（仅本机混淆） | 默认 | 密钥材料只来自本机公开信息（家目录 / 用户名 / 主机名）+ 同文件里的明文 salt。**同机同用户可直接解密**，只防明文躺在磁盘和日志里 |
| `encrypted`（口令加密） | 设置了 `DSH_ORG_PANEL_SECRETS_PASSPHRASE`（或 `secretsPassphrase`） | 密钥材料来自口令，口令不落盘 |

两档都会尝试 `chmod 0700/0600`；chmod 没生效（例如 Windows）会在能力标志里如实报
`ownerOnly: false`，不假装收紧过。

> **已知边界**：`secret:XXX` 目前**没有任何工具或 UI 能往本地密钥库写值**。
> `SecretResolver.store()` 存在但没有被任何工具暴露。因此除非宿主自己提供 Secret Service，
> 否则请统一用 `env:XXX`。

## 5. 模型供应商 `models`

> **先读这一段再配。** 本版真正会发出请求的只有 **vision** 能力（工具 `vision_analyze`）。
> `text` / `image` / `video` / `embedding` 供应商可以配置、可以绑定、会出现在 fallback 链和
> `company_model_list` 里，但**没有任何运行时消费它们**：员工说话用的仍然是 DSH 自己的子代理模型。
> 配一个 text 供应商**不会**改变员工用哪个模型思考。`company_model_test` 对非 vision 供应商
> 也只会返回 `checked: 'config-only'`，即「配置看起来齐全，可用性尚未验证」。

两种写法都支持，map 形式的 key 就是供应商 id：

```yaml
models:
  vision-main:
    type: vision
    provider: openai-compatible
    baseUrl: https://your-gateway.example.com/v1
    model: your-vision-model-name
    apiKeyRef: env:VISION_API_KEY
```

```yaml
models:
  - id: vision-main
    type: vision
    provider: openai-compatible
    baseUrl: https://your-gateway.example.com/v1
    model: your-vision-model-name
    apiKeyRef: env:VISION_API_KEY
```

| 字段 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `id` | ✓ | — | 供应商 id（map 写法用 key） |
| `model` | ✓ | — | 供应商侧的**真实模型名**，代码不会替你猜任何默认值 |
| `type` |  | `text` | `text` / `vision` / `image` / `video` / `embedding` |
| `provider` |  | `openai-compatible` | `openai-compatible` / `gemini` / `custom` |
| `baseUrl` |  | — | 没有任何厂商默认值。空值会在调用时报 `not-configured` |
| `apiKeyRef` |  | — | 只接受 `env:` / `secret:` |
| `timeout` |  | `modelTimeout` | 毫秒 |
| `enabled` |  | `true` | `false` = 不进入任何 fallback 链 |

`modelTimeout`（顶层字段）为默认超时，单个供应商的 `timeout` 优先。

三个适配器只实现协议形状，不内置任何厂商域名或模型名：

| `provider` | 端点构造 | 认证头 | 声明支持 |
| --- | --- | --- | --- |
| `openai-compatible` | `baseUrl` 末尾不是 `/chat/completions` 就自动补上 | `authorization: Bearer <key>` | text / vision / embedding |
| `gemini` | `<baseUrl>/models/<model>:generateContent`（`baseUrl` 已带 `:xxxContent` 则原样用） | `x-goog-api-key: <key>` | text / vision / embedding |
| `custom` | 直接 POST `baseUrl` | `authorization: Bearer <key>` | 全部五项 |

`custom` 的契约：请求体 `{ capability, model, mode, system, prompt, images:[{name,mimeType,url|base64}] }`；
回包给 `{ description, extractedText?, observations?, objects? }` 最佳，也接受 `{ text }` / `{ content }` /
OpenAI / Gemini 形状。

> 再强调一次：上表的「声明支持」是适配器自报的能力集合，用于校验绑定是否合法。
> **实际被执行的方法只有 `analyzeVision` 一个**。

## 6. 员工模型绑定 `modelBindings`

数组顺序即 fallback 优先级，不用手写 `priority`：

```yaml
modelBindings:
  image-creator:
    vision: [vision-main, vision-backup]
  search-specialist:
    vision: vision-main
```

数组写法：

```yaml
modelBindings:
  - staff: image-creator
    capability: vision
    provider: vision-main
    priority: 1
```

- `capability` 可写 `text` / `vision` / `image-generation` / `video-generation` / `embedding`，
  也接受供应商 `type` 的短名（`image` / `video`）。
- 没绑定的员工走公司级顺序：`models` 里同类型且 `enabled` 的供应商，按声明顺序。
- 绑定指向的供应商被删除 / 停用 / 没有对应适配器时，状态会被如实写成 `missing`，不假装可用。
- 坏行只记错误、不阻断其他行；错误会打进 host 日志（`模型配置有问题，…`）。

## 7. 插件安装 `pluginInstall`

流程：员工 `staff_plugin_install_request`（只披露不安装）→ **人类批准** →
`staff_plugin_install_apply`（真实安装 + Capability Scan + Smoke Test）→ 通过才沉淀为技能。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `executor` | `auto` | `auto` = 有运行时插件管理工具 / shell 工具就用它装；`tool` = 只允许运行时工具；`none` = 只登记不自动装 |
| `timeoutMs` | 180000 | 安装命令超时 |
| `smokeTimeoutMs` | 60000 | 冒烟测试超时 |
| `requestTtlMs` | 604800000（7 天） | 申请有效期，过期需重新提交 |
| `preapproved` | `[]` | 预批准包名清单。**写进这里 = 老板本人的显式批准**，命中的申请会跳过 UI 审批直接安装 |
| `probeHostApproval` | `false` | 是否探测宿主原生审批弹窗，见下 |
| `healthCheckOnStart`（顶层字段） | `true` | 启动时跑一次插件健康检查，把重启后失效的绑定标成 `missing` |

安装命令是被严格校验的，不是随便一条 shell：

- 只允许 `dsh` / `npm` / `pnpm` / `yarn` / `bun` 的 `add|install` 形式；
- 包标识只接受 npm 包名（可带 `@version`）与 `github:owner/repo`；
- URL、tarball 地址、`git+ssh:`、`file:`、任何本地路径一律拒绝（远程 tarball 安装等于任意远程代码执行）；
- host 不会绕开 DSH 权限模式自己起进程 —— 运行时没有暴露可用执行器时，如实报错并请老板手动执行。

`probeHostApproval` 默认 `false` 且**建议保持 false**：DSH 侧并未被证实存在 `ctx.approvals` 一族 API。
显式打开后仍要求宿主对象自己声明 `isHumanApproval` / `kind: 'human-approval'`，并返回结构化结果
（回带 `requestId` + 人类操作者）；裸 `true` / `'approved'` / 空对象一律不算批准。

## 8. 外部通讯 `communication`

```yaml
communication:
  adapters:
    - id: feishu
      platform: feishu
      enabled: true
      connectionMode: long-conn
      credentials: { appId: env:FEISHU_APP_ID, appSecret: env:FEISHU_APP_SECRET }
      routing: { defaultTarget: secretary, recognizeMentions: true, maxHops: 4 }
      access:
        defaultPermissionMode: read-only
        actors: [{ userId: ou_xxx, name: 老板, role: owner, permissionMode: danger-full-access }]
        conversations: [{ conversationId: oc_xxx, name: 研发群, permissionMode: workspace-write }]
  channelBindings:
    - { adapterId: feishu, externalConversationId: oc_xxx, companyChannelId: engineering }
```

### adapters[]

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `platform` | 必填 | `feishu` / `qq` / `wechat`。其它值直接 throw |
| `id` | = platform | 渠道实例 id |
| `name` | 平台中文名 | UI 显示名 |
| `enabled` | **`false`** | 必须显式写 `true` 才会连接 |
| `connectionMode` | `long-conn` | `long-conn` / `webhook` |
| `credentials` | `{}` | 只接受 `env:` / `secret:` 引用 |
| `options` | — | 平台私有非密钥选项。字段名疑似密钥（`token`、`secret`…）会被直接拒绝 |

### routing

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `defaultTarget` | `secretary` | 没识别到 `@` 时交给谁 |
| `recognizeMentions` | `true` | 识别文本与平台 `@` |
| `allowEmployeeCollaboration` | `false` | 允许员工之间转交 |
| `maxHops` | `4` | 转交上限，取值收敛到 0~12 |
| `notifyUndeliverable` | `true` | 派不出去时告知对方 |

### access（权限，全部 fail-closed）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `defaultPermissionMode` | `read-only` | 兜底档位。任何没单独写档位的人 / 群都落到这里 |
| `allowUnknownUsers` | `false` | 名单外的人默认拒绝 |
| `allowUnknownConversations` | `false` | 名单外的群默认拒绝 |
| `actors[]` | `[]` | `userId` / `name` / `role`(`owner`\|`member`\|`guest`) / `permissionMode` |
| `conversations[]` | `[]` | `conversationId` / `name` / `permissionMode` / `allowedEmployees[]` |

`permissionMode` 三档与 DSH Composer 一致：`read-only` / `workspace-write` / `danger-full-access`。
最终档位取**用户档位与群档位中更低的那一个**。

> **只读渠道的真实保证，不要美化**：当前 DSH 子代理 API 不接受工具白名单参数，宿主无法在起
> 子代理时把写工具真正剔除。所以 `read-only` 的实际保证是「提示词禁止 + **事后真实观测**」：
> 子代理跑完后按它真实用过的工具判越权，一旦命中写工具 → 回复一个字都不外发、任务记 `blocked`、
> 发 `external.write.denied` 事件、中止转交链。**这是「写可能已发生，但结果被拦下且被记录」，
> 不是预防式拦截。** 未来 DSH 提供工具白名单后才能升级成真正的事前拦截。

### channelBindings[]

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `adapterId` | ✓ | 对应 `adapters[].id` |
| `externalConversationId` | ✓ | 外部会话 id（飞书 `oc_xxx`） |
| `companyChannelId` | ✓ | 公司内部频道 id |
| `defaultEmployees` |  | 该群默认负责人 |

三者缺一整条绑定会被静默丢弃。

### 平台实现现状

| 平台 | 状态 |
| --- | --- |
| 飞书 | 真实实现（收发消息、`@` 识别、附件下载归一化）。前置条件见 README |
| QQ | **未实现**的骨架。状态恒为 `degraded`，发送直接抛「尚未实现」，不伪造连接成功 |
| 微信 | **未实现**的骨架，同上 |

---

## 9. 完整字段索引

```text
tabLabel  companyName  chatEnabled  assetBase(废弃)
roles  staff
memoryFile  companyFile  approvalsFile  secretsFile  secretsPassphrase  attachmentDir
models(=modelProviders)  modelTimeout
modelBindings(=staffModels)
pluginInstall{executor,timeoutMs,smokeTimeoutMs,requestTtlMs,preapproved,probeHostApproval}
healthCheckOnStart
communication{adapters[],channelBindings[]}
```

括号内为等价别名，代码里两个名字都读。
