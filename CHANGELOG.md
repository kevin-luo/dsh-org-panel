# Changelog

## 2.0.0

> 本条目对应的 `package.json` 版本号仍是 `1.4.0`，发布前需要一起 bump。
>
> 这条记录按「做到了什么 / 没做到什么 / 已知边界」三段写。第二、三段不是路线图措辞，
> 是本版真实的能力边界；配置和验收之前请先读完它们。

### 做到了什么

**持久化与员工核心**

- 记忆、技能、技能证据、复盘、任务履历、插件绑定、模型绑定统一落在
  `~/.dsh-org-panel/evolution.json`，公司档案与模型供应商落在 `company.json`，
  两份文件都只有一个写入者（`EvolutionStore` / `CompanyStore` 实例由 host 装配时共享下去）。
  （默认名册 15 人这件事在 1.4 之前就已经是事实，只是 `cordis.example.yml` 的注释一直写着
  「秘书与 7 名专业员工」，这轮一并改正。）
- V1 → V2 存储迁移；损坏的 `evolution.json` 必须先备份成功才继续写，备份失败就锁死写入，
  宁可报错也不覆盖老板的档案。
- 任务履历的 `outcome` 只来自宿主观测得到的 `stopReason` / `isError`，不采信子代理自述；
  `completed` 但零产出只记 `partial`。
- 技能等级只认真实证据：`staff_skill_learn` 要求点名当前 Tool Registry 里真实存在的工具，
  连调 12 次「自述成功」涨不了级，也写不出一条证据。

**输入框**

- 改用 DSH 原生 Composer。不再自制输入控件、不再隐藏或替换官方输入框，
  也不再对 `[data-composer-seat]` 直接打 CSS。

**模型网关（新）**

- `vision_analyze` + `company_model_list` / `company_model_config` / `company_model_test` /
  `company_model_bind` 五个工具。
- 三个供应商适配器：`openai-compatible` / `gemini` / `custom`。适配器只实现协议形状，
  **不内置任何厂商域名或默认模型名**，`baseUrl` 与 `model` 必须由老板填。
- 公司级供应商顺序 + 员工级 `ModelBinding` 优先级组成 fallback 链；绑定指向的供应商被删除、
  停用或没有对应适配器时，状态如实写成 `missing`。
- 密钥只接受 `env:` / `secret:` 引用，明文当场拒绝；日志与回包里的密钥会被抹掉。
- 本地密钥库把真实保护等级（`obfuscated` 仅本机混淆 / `encrypted` 口令加密）以能力标志下发，
  UI 按它显示，不一律打绿标。

**插件运行时（新）**

- 完整链路：`staff_plugin_install_request`（只披露不安装）→ **人类批准** →
  `staff_plugin_install_apply`（真实安装 + Capability Scan + Smoke Test）→ 通过才沉淀为技能。
  外加 `staff_plugin_verify`、`staff_plugin_health_check`、`staff_skill_evidence`。
- 安装命令白名单：只允许 `dsh` / `npm` / `pnpm` / `yarn` / `bun` 的 `add|install`，
  包标识只接受 npm 包名与 `github:owner/repo`；URL、tarball、`git+ssh:`、`file:`、
  本地路径一律拒绝（远程 tarball 安装等于任意远程代码执行）。
- host 不会绕开 DSH 权限模式自己起进程：运行时没有可用执行器时如实报错并请老板手动执行。
- `probeHostApproval` 默认关闭。打开后仍要求宿主显式声明是人类审批通道并回带 `requestId`
  与人类操作者，裸 `true` 不算批准。

**外部通讯（新）**

- IM Gateway + Company Router + 飞书 Adapter：收发消息、`@` 识别、附件下载归一化。
- 全平台共用同一个 `employeeId`，不存在「飞书老王 / Web 老王」这种平台分身。
- 权限 fail-closed：渠道不写 `enabled: true` 就不连接，档位不写就是 `read-only`，
  名单外的人和群默认拒绝；最终档位取用户档位与群档位中更低的一个。

**工作台**

- 公司设置中心六页（员工 / 模型 / 插件 / 通讯 / 安全 / 存储）。拿不到真实数据时显示
  `0` / `—` / `暂无` / `未知`，不用好看的默认值填充。
- `/org-panel` RPC 频道：把 host 侧四层的真实台账直接送到浏览器，设置中心不必先等 LLM
  跑一次工具才有数据。频道不可用时安静降级到原有路径，并在界面上如实说明当前拿不到什么、
  为什么拿不到、以及此刻真正走得通的替代路径。
- **插件审批第一次能在界面上点**：频道在线时「批准 / 拒绝 / 重新验证 / 健康检查」是真的按钮。
  安全边界一个字没放宽 —— 这条通道只有浏览器里的人类能发起，LLM 手上只有 Tool Registry，
  拿不到 `ctx.connection`，永远调不到 `/org-panel`。换句话说，这条通道反而是在传输层
  第一次把「人类点击」和「模型调用」真正分开了。
- 界面上每一屏都带数据来源标记（host 实时读取 / 本会话工具结果 / 本机缓存 / 尚未取到），
  不允许「悄悄降级」。

**修掉的三个致命装配缺陷（这是本版最重要的一条）**

老板看到的「模型 0 / 插件 0 / 审批未知 / 通讯未知」不是前端读不到，是那三层**从来没有成功挂载过**，
因此一个字节都没写过。在真实 cordis Context 上实测复现，三处独立缺陷：

1. `host-v3.ts` 对 `ctx.companyEventBus` 的裸读写 —— 真实 cordis Context 上读没 inject 过的
   自定义属性会抛，写没 provide 过的属性也会抛，读写两条路都堵死。`apply()` 在这一行就中断，
   下面三层一层都挂不上。现改为显式传参，顺带消掉「ctx 上鸭子类型自动发现」这个第二真相来源。
2. `apply()` 的返回值是普通对象 —— cordis 把插件 `apply()` 的返回值当 effect 处理，
   非函数 / 非 nullable / 非 thenable / 非 iterable 一律 `throw new TypeError('Invalid effect')`，
   于是每一次真实装载都让 fiber 直接进入失败态。现改为返回一个挂着四层实例属性的 dispose 函数
   （既是合法 effect，也把卸载清理补上了）。
3. `models/gateway.ts` 与 `integrations/im/manager.ts` 里的急求值候选数组
   （`[ctx?.secrets, ctx?.secretService, …]`）—— 数组元素是急求值的，`?.` 挡不住会抛的
   Proxy getter，`registerModelGateway` / `registerCommunication` 因此每次都失败。
   现改为惰性逐个 try/catch 探测。

既有 105 条测试对这个洞完全无感（夹具喂的是普通对象字面量），所以新增了用**真 cordis Context**
装载 `lib/index.js` 的启动用例。

**破坏性变更**

- 删除 `src/client-v2.tsx` ~ `src/client-v8.tsx`（4924 行死代码）。它们是一条闭环引用链，
  链头 `v3` / `v8` 没有任何引用者，`src/client.tsx` 只指向 `client-v9`。
  删除前它们的 `lib/client-v2.d.ts … client-v8.d.ts` 正随 `files: ["lib"]` 被 npm publish 发出去，
  里面还留着已经被推翻的做法（给 `[data-composer-seat]` 直接打 CSS、从 DOM 抓 composer）。
  如果你曾经深链引用过 `dsh-org-panel/lib/client-v2`，这条路径不再存在。

**文档**

- `cordis.example.yml` 补齐 `models` / `modelBindings` / `pluginInstall` / `communication`
  全部配置段，并用真实的 host 代码验证过示例确实可加载（2 个供应商 + 3 条绑定 + 0 错误）。
- 新增 `docs/CONFIG.md`：逐字段配置参考，含默认值、别名、能力边界。
- README 新增「已知边界」「飞书接入前置条件」「Host 工具清单」。

### 没做到什么

- **UI 里加不了模型供应商。** `/org-panel` 频道在线时，模型页可以做的是：测试连通性、
  启用 / 停用某个供应商、给员工绑定或解绑某项能力。**新增 / 编辑 / 删除供应商没有 UI**
  （host 侧有 `models/upsert` 端点，但前端没有对应的表单与 action），
  `setDefault` 则连 host 端点都没有，按钮按设计禁用并在 title 里说明原因。
  第一次配模型仍然只能改 cordis 配置，或让员工调 `company_model_config`。
- **UI 里配不了飞书。** 通讯页只读；渠道、权限名单、群绑定全部只能写在 cordis 配置里。
- **备份导出 / 导入没有做。** 存储页只读：能告诉你文件在哪、多大、什么时候写的，不能导出。
- **host → client 的事件推送没有打通。** 飞书来消息、插件装好，浏览器里的面板不会自己亮起来。
- **「越来越懂我」的证据 chip 没有做。** host 侧还没有如实上报「本次任务真实注入了哪几条记忆」
  的数据面，做浅了就变成按相关度现编。
- **办公室小人不显示「他现在在做第几步」。** 子代理内部的工具调用不进父会话 node 流，
  这个数据当前拿不到。拿不到就不显示，不编造活动。
- **CI 不跑单元测试。** `.github/workflows/ci.yml` 只有 `typecheck` / `build` / `size-check`；
  `node --test tests/*.test.mjs` 需要本地手动跑。

### 已知边界

| 边界 | 现状 |
| --- | --- |
| 只有 vision 能力会真的发请求 | `text` / `image` / `video` / `embedding` 供应商可以配、可以绑、会出现在 fallback 链和 `company_model_list` 里，但**没有任何运行时消费它们**。员工说话用的仍然是 DSH 自己的子代理模型，配 text 供应商不会改变员工用哪个模型思考。`company_model_test` 对非 vision 供应商只返回 `checked: 'config-only'` |
| `secret:` 引用写不进去 | 本地密钥库有读路径，`SecretResolver.store()` 也在，但没有任何工具或 UI 暴露它。除非宿主提供 Secret Service，否则请统一用 `env:XXX` |
| 本地密钥库默认不是真加密 | 默认档位的密钥材料只来自本机公开信息（家目录 / 用户名 / 主机名）与同文件里的明文 salt，同机同用户可直接解密。设 `DSH_ORG_PANEL_SECRETS_PASSPHRASE` 才升级为口令加密 |
| QQ / 微信是未实现的骨架 | 状态恒为 `degraded`，发送直接抛「尚未实现」。不伪造连接成功，也不伪造消息 |
| 飞书长连接需要你自己装 SDK | `@larksuiteoapi/node-sdk` **不是**本包依赖。没装会在日志里说明并降级到 webhook 模式 |
| 飞书 webhook 需要你自己给端口和验真密钥 | 必须给 `options.webhookPort`；`credentials` 里至少要有 `verificationToken` 或 `encryptKey` 之一，否则拒绝开端口。默认只绑 `127.0.0.1`，对外暴露要自己写 `options.webhookHost` 并加反向代理 |
| 只读渠道不是预防式拦截 | 当前 DSH 子代理 API 不接受工具白名单参数，宿主无法在起子代理时剔除写工具。`read-only` 的真实保证是「提示词禁止 + 事后真实观测越权 → 回复一个字都不外发、任务记 `blocked`、发 `external.write.denied`、中止转交链」。**写可能已经发生，但结果被拦下且被记录** |
| `pluginInstall.preapproved` 会跳过 UI 审批 | 在配置文件里写包名被视作老板本人的显式批准，命中的申请直接进入安装。这是设计如此，但别把它当成「反正还要点一次」 |
| `/org-panel` 频道依赖部署形态 | 需要运行时同时提供 `httpServer` 与 `connection` 服务。缺任一者时频道不注册，设置中心退回原有路径并如实说明「当前运行时没有提供该频道」 |
| `npm run build` 不清空 `lib/` | 删除或重命名源文件后，旧的 `.d.ts` 会留在 `lib/` 并被 `npm publish` 一起发出去。删文件后请手动清一次 `lib/` |

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
