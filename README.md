# 赛博公司 · DSH 多智能体工作台

> 在 DeepSeek Harness 当前会话中，把独立子代理、真实群聊、工具轨迹和可视化办公室合并成一个公司运营界面。

![赛博公司 1920×1080](./docs/qa/cyber-company-v1.4-1920x1080.png)

`dsh-org-panel` 是一个 DeepSeek Harness 插件。主 Agent 在界面中显示为“秘书”，明确 `@` 某位员工时，消息会直达该员工对应的独立子代理；多人讨论使用真实 `staff_meeting`，不会由秘书一人扮演全公司。

## v1.4 工作台

- **员工通讯录**：按部门分组，支持状态筛选；单击员工会联动办公室和聊天，双击直接插入 `@员工`。
- **赛博公司总部**：单张 1200×720 WebP 场景承载完整空间，员工以独立 sprite 覆盖其上；工作、会议、卡住、交付和休息都有可解释状态。
- **公司工作群**：频道、老板消息、秘书回复、员工本人回复、多人会议、工具事件与安全执行摘要都来自当前 DSH 会话。
- **独立输入框**：当前 Tab 使用自己的群聊输入框，通过 DSH 官方 `InputActions.setDraft()` + `submit()` 发送；进入本 Tab 时仅隐藏原生 composer，卸载时恢复，因此不会出现两个输入框。
- **经营侧栏**：只展示真实在线数、任务、成长、技能与插件市场结果；成长/技能/插件使用单卡 Tab，不堆叠三块长面板。
- **响应式布局**：桌面保留三栏；窄屏把员工通讯录和经营侧栏变成抽屉，办公室保持固定世界坐标并允许平移，不把 1200×720 强行缩成小图。

## 真实交互

```text
@老王 请检查本次发布的技术风险
@小刘 修复登录接口并回复验收结果
@阿明 @小周 围绕招聘需求开会，给出共同结论
```

- 未点名的统筹请求由秘书处理。
- 单独点名由对应员工本人回复。
- 多人讨论由 `staff_meeting` 让员工依次发言并形成结论。
- 页面只展示可公开的执行摘要和真实工具事件，不展示私有思维链。

## DSH 插件规范

项目使用 DSH 的标准插件声明：

| 位置 | 作用 |
| --- | --- |
| `package.json > dsh.bundle.patch` | profile bundle 的 Cordis composition 补丁 |
| `package.json > dsh.client` | Web Client 平台和所需注入服务 |
| `cordis.patch.yml` | 默认插入 `dsh-org-panel` composition row |
| `cordis.example.yml` | 手动挂载到 agent preset 的示例 |
| `src/index.ts` | Host 侧 `staff_chat`、`staff_meeting` 与秘书调度规则 |
| `src/client-v9/index.tsx` | 注册 `conversation.view` 的“赛博公司”Tab 与 `@` 候选源 |

Client 注入：

```json
{
  "inject": [
    "@deepseek-ai/dsh-client-runtime",
    "@deepseek-ai/dsh-client-ui-conversation",
    "@deepseek-ai/dsh-client-ui-input-trigger"
  ],
  "platform": "web"
}
```

Tab 注册方式：

```ts
slots.inject('conversation.view', () => slots.register({
  name: 'conversation.view',
  id: 'realm',
  order: 20,
  label: () => normalized.tabLabel,
}))
```

如果启动时报错：

```text
profile bundle "dsh-org-panel" declares no dsh.bundle in its package.json
```

请确认 DSH 实际加载的安装包版本包含 `package.json` 中的 `dsh.bundle.patch`，并且 `cordis.patch.yml` 在 npm 包的 `files` 中；重新构建、安装并重启 DSH。只修改本地源码但不重建不会生效。

## 运行时资产管线

DSH 通过 `fetch + eval` 加载插件 Client，并不会稳定暴露 npm 包中的静态资源目录。v1.4 不再猜测 `/plugins/.../assets` 路径：

1. 高清原稿保存在 `design-assets/`，不会进入 npm 运行包。
2. `scripts/build-runtime-assets.mjs` 使用 `sharp` 生成 `src/runtime-assets/`：
   - 员工头像 `thumb.webp`：96×96
   - 办公室员工 `sprite.webp`：128×128
   - 员工档案 `profile.webp`：384×384
   - 办公室底图 `office-hq-base.webp`：1200×720
3. 构建脚本生成 `src/client-v9/generated-assets.ts`，以压缩 WebP data URL 作为稳定 fallback。
4. `AssetImage` 处理 loading / loaded / failed；单个资源失败时显示姓名缩写，不出现浏览器破图图标。

发布体积门禁：

- `lib/client.js` 必须小于 **3.5 MiB**。
- `npm pack` 必须小于 **4.5 MiB**。
- `npm run size-check` 本地和 CI 都会执行，超标直接失败。

当前 v1.4 验证值：`client.js 1.29 MiB`，`npm pack 0.94 MiB`。

## 安装与配置

```bash
npm install dsh-org-panel
```

Composition 示例：

```yaml
- id: org-panel
  name: dsh-org-panel
  config:
    tabLabel: 赛博公司
    companyName: 赛博公司 · AI 员工总部
    chatEnabled: true
```

`roles` 与 `staff` 仍可在 composition 中覆盖，用于自定义岗位、工具、技能、部门、汇报关系、别名和状态文案。

## 本地开发

```bash
npm ci
npm run typecheck
npm run build
npm run size-check
npm pack --dry-run
```

构建产物：

- Host：`lib/index.js`
- Client：`lib/client.js`
- 类型：`lib/index.d.ts`、`lib/client.d.ts`

修改后需要重启 DSH，浏览器刷新才能加载新的 Client bundle。

## 目录结构

```text
dsh-org-panel/
├── design-assets/                 # 高清设计源，不进入 npm 包
├── docs/qa/                       # 1920 / 1440 / 1280 实机验收图
├── scripts/
│   ├── build-runtime-assets.mjs   # sharp WebP 与内联资产生成
│   └── check-size.mjs             # Client / npm 包体积门禁
├── src/runtime-assets/            # WebP 运行时资产
├── src/client-v9/
│   ├── components/                # Header / Roster / Office / Chat / Rail
│   ├── generated-assets.ts        # 构建生成的 data URL fallback
│   ├── company-view.tsx           # 当前 Tab 工作台
│   ├── messages.ts                # 真实会话消息映射
│   └── selectors.ts               # 真实任务、员工、频道与办公室状态
├── cordis.patch.yml
├── cordis.example.yml
└── package.json
```

## 验收截图

- [1920×1080](./docs/qa/cyber-company-v1.4-1920x1080.png)
- [1440×900](./docs/qa/cyber-company-v1.4-1440x900.png)
- [1280×800](./docs/qa/cyber-company-v1.4-1280x800.png)
- [设计参考与最终实现对比](./docs/qa/reference-vs-v1.4.png)

## License

MIT

## English summary

`dsh-org-panel` is a DeepSeek Harness plugin that combines an independent-agent roster, a real session-backed company chat, safe tool traces, a single illustrated cyber office, and real operational metrics in the current conversation tab. Runtime images are optimized to WebP and embedded into the client bundle so the UI does not depend on guessed static asset URLs.
