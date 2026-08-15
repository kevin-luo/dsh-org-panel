# 纯牛马 · 朕的江山（dsh-org-panel）

一个把「多智能体派活」可视化的 DeepSeek Harness（DSH）正式插件。

它不编剧本——而是从**当前会话里真实发生的派活**（`subagent` / `subagent_fork` / `workflow` 工具调用）中，
提炼出老板的派活指令、每个数字员工的干活进度与交付结果，再套上一层「公司办公室 + 手机群聊」的游戏化外壳。

## 功能

- 在会话顶部新增第三个标签页「**纯牛马**」（排在「对话」「轨迹」之后）。
- **👑 老板派活气泡**：把用户需求 + 真实派活调用，提炼成一句老板汇报（拆了几个活、派给谁、谁在干、谁交付了）。
- **牛马办公室**：6 名固定员工（技术经理老王、程序员小刘、产品经理阿明、市场调研小丽、平台工程师大壮、文档专员静静），
  初始全部在场；员工卡片带状态徽章（干活中 / 已交付 / 卡住 / 待命中）和台词气泡。
- **任务卡**：每个真实派活挂到对应岗位员工名下，展示任务指令、状态、结构化交付提炼（结论 + 要点）、用时/开始时间。
- **💬 牛马摸鱼群**：右侧手机群聊样式，顶部插入真实动态（派活/交付），下面轮播氛围吐槽。
- **点员工看档案**：弹出员工卡，展示人设 + 它会的能力（工具 + 技能）。

## 数据来源

- `useSession`（会话快照）→ 从 `nodes` 的 `tool-call` / `tool-result` 里提炼 `subagent*`、`workflow` 派活：
  - `description` = 老板派活原话（任务指令）
  - `tool-result` = 员工交付内容（结果）
  - 有调用无结果 = 干活中

## 目录结构

```
dsh-org-panel/
├── package.json          # 正式声明（dsh.client）
├── tsconfig.json
├── cordis.example.yml    # composition 挂载示例
├── .gitignore
└── src/
    ├── index.ts          # host 半边（空，纯 client 插件仍需一个 host 模块）
    └── client.tsx        # client 半边（注册 conversation.view 标签页）
```

## 构建

```bash
pnpm install
pnpm build          # 产出 lib/index.js + lib/client.js
```

`package.json` 的 `dsh.client` 声明了 client 半边及它依赖的运行时包。

## 挂载（让插件开机就有）

1. 把本包安装/链接到你的 DSH 项目（`pnpm add dsh-org-panel`，或 `pnpm link`）。
2. 在你的 **agent preset** 的 `agent.cordis.yml` 里加一行（见 `cordis.example.yml`）：

   ```yaml
   - id: org-panel
     name: dsh-org-panel
   ```

3. 重启 DSH。它会出现在会话顶部的第三个标签页「纯牛马」。

> 本插件是会话级 UI 贡献，放在 agent preset 最合适。放在 host composition 也行，但会更全局。

## 发布到 GitHub

```bash
git init
git add .
git commit -m "feat: 纯牛马 —— 多智能体数字员工指挥台插件"
git remote add origin https://github.com/<你的用户名>/dsh-org-panel.git
git push -u origin main
```

建议给仓库打上 `dsh-plugin` topic，这样会被 [dsh-plugin 主题](https://github.com/topics/dsh-plugin) 收录。

## 扩展：新增一个岗位/员工

1. `src/client.tsx` 的 `ROLES`：加一项，声明 `id` + 该岗位的 `tools`（工具名清单）+ `skills`。
2. `src/client.tsx` 的 `STAFF`：加一项，声明 `id`（与 ROLES 一致）、`name`、`role`、`emoji`、`intro`、`lines`。

例如加「设计师」：`ROLES` 加 `{ id:'designer', tools:['read_image'], skills:[{name:'视觉设计', desc:'...'}] }`，
`STAFF` 加 `{ id:'designer', name:'小美', role:'设计师', emoji:'🎨', intro:'...', lines:{...} }`。

## 进阶：实时枚举生态工具/技能

当前版本把「岗位 → 工具/技能」做成了 `client.tsx` 里的内联映射（纯 client、免 RPC、免构建工具链依赖最简）。
若要**实时枚举** DSH 运行时里实际挂载的工具/技能（利用插件生态动态扩展），需要在 host 半边加一个
typert `@Remote` RPC，client 通过 `ctx.remote` 调用。这需要 TypeScript 装饰器 + typert 构建，
参考官方 `@deepseek-ai/dsh-client-ui-cordis` 的 `dynamicCordisRunner` Remote 命名空间。

## 进阶：AI 交付总结

动态插件版已实现（`kingdom.summarize`）：host 半边用 `llm.stream` 调当前模型，把员工交付内容压缩成一句话结论
（带内存缓存，失败时降级为截断摘要）。正式包移植时，在 `src/index.ts` 加一个 `@Remote` 方法（输入交付文本、
输出一句话），client 用 `ctx.remote` 调用，同前述 typert RPC 路线。

## License

MIT
