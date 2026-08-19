# 赛博公司：真实 Runtime 驱动的经营养成模拟器

> 分支：`feat/org-panel-20260817`
>
> 产品目标：做成一个能长期运行的“AI 公司经营模拟器”。每个员工都是持久存在的数字员工，有记忆、技能、履历、插件、模型能力、成长轨迹和个人空间；所有游戏反馈必须来自真实工作事件与真实持久化数据。

## 1. 核心体验

用户打开的不是一张 Agent 列表，而是一家公司。

```text
老板下任务 / 微信、飞书、QQ 来消息
                ↓
公司前台 / 秘书接单
                ↓
员工收到真实任务
                ↓
员工移动到真实工作区域
                ↓
调用工具 / 插件 / 模型
                ↓
协作 / 开会 / 卡住 / 学习
                ↓
任务结算
                ↓
履历 + 记忆 + 技能证据 + XP 持久化
                ↓
办公室里可视化成长
```

重新启动 DSH、换一个浏览器 Session、第二天再次打开，员工仍然是昨天那个员工。

---

## 2. 游戏规则与 Runtime 的边界

### 2.1 禁止假模拟

以下行为禁止进入产品：

- 用 timer 让员工随机走动；
- 每隔几秒随机显示“学习中 / 喝咖啡 / 开会”；
- UI 自己增加 XP；
- LLM 自述“我学会了”就升级技能；
- 没有真实消息来源却显示“微信客户”；
- 没跑插件却播放“插件安装成功”；
- 为了游戏感制造不存在的经营数据。

动画可以有，但动画只能表现事实。

### 2.2 两类状态

**真实业务状态**：

```text
Company Event Bus
TaskHistory
SkillEvidence
Memory
PluginBinding
ModelBinding
ExternalMessageContext
```

**游戏视觉状态**：

```text
员工位置
动作动画
等级徽章
经验条
技能升级提示
个人空间等级
办公室区域高亮
经营统计
成就展示
```

第二类只能从第一类派生。

---

## 3. 数字员工的长期身份

一个员工长期拥有：

```text
Employee
├─ Identity
│  ├─ name
│  ├─ role
│  ├─ department
│  └─ persona
├─ Memory
│  ├─ preference
│  ├─ lesson
│  ├─ project
│  ├─ workflow
│  └─ relationship
├─ Career
│  ├─ TaskHistory
│  ├─ Reflection
│  ├─ XP
│  └─ Level
├─ Skills
│  ├─ Skill
│  └─ SkillEvidence
├─ Capabilities
│  ├─ PluginBinding
│  ├─ ModelBinding
│  └─ Tool Registry
└─ Space
   ├─ personal desk
   ├─ growth tier
   └─ active station
```

“重新开一个 Session”不创建一个新人。

---

## 4. 成长系统

### 4.1 XP

XP 使用持久化层已有真实 XP，不允许 UI 自己生成。

等级继续使用统一 `evolutionLevel(xp)`。

### 4.2 技能

技能等级只由 `SkillEvidence` 推导。

视觉反馈：

```text
真实工具执行成功
      ↓
产生 SkillEvidence
      ↓
skill.updated
      ↓
办公室员工头顶出现「技能↑」
      ↓
档案中的技能等级变化
```

动画结束后，证据仍留在档案里。

### 4.3 个人空间

第一阶段空间等级从真实员工等级派生：

```text
Lv1       基础工位
Lv2~3     成长工位
Lv4~5     专业工位
Lv6~7     高级工作室
Lv8+      专家工作室
```

它只是对真实成长的视觉投影，不另存一份会漂移的“房间等级”。

第二阶段再支持可持久化的员工私人空间布局与装饰。

---

## 5. 办公室互动

### 单击员工

弹出经营 Dock：

- 当前真实工作状态；
- Lv / XP / 升级进度；
- 个人空间等级；
- 主技能；
- 长期记忆数量；
- 插件数量；
- 任务履历；
- 成功率；
- 真实证据数量。

### 操作

```text
成长档案
安排成长
@ 本人
```

“安排成长”不会直接改数值，只向 DSH 原生 Composer 写入一条成长任务草稿，由老板确认发送。

员工需要自己：

1. 读取长期记忆与近期履历；
2. 找能力缺口；
3. 扫描公司现有插件；
4. 必要时搜索 dsh-plugin 生态；
5. 提出真实练习；
6. 完成真实执行；
7. 通过证据结算技能。

---

## 6. 空间与事件映射

```text
task.started             → 专属工位
meeting.started          → 会议室
vision.started           → 多媒体工作台
plugin.install.started   → 服务器机房
message.received         → 前台亮起
skill.updated            → 员工技能升级反馈
blocked                  → 员工停留并显示真实阻塞原因
```

员工不能因为时间流逝随机改变位置。

---

## 7. 下一阶段经营玩法

### Milestone G1：成长可视化（当前）

- [x] Office 使用真实 Event Bus；
- [x] 无事件不随机走动；
- [x] EmployeeSnapshot → GameState；
- [x] 办公室显示 Lv / XP；
- [x] 员工选中 Dock 显示长期成长数据；
- [x] 技能真实更新时显示“技能↑”；
- [x] “安排成长”通过原生 Composer 发起；
- [ ] 档案页增加完整 Career Timeline；
- [ ] 技能树可视化。

### Milestone G2：真实通讯经营

- [x] 微信 dsh-im 扫码桥；
- [ ] 飞书统一 Provider；
- [ ] QQ 统一 Provider；
- [ ] External Message Provenance；
- [ ] 前台展示真实平台 / 用户 / 会话；
- [ ] 外部任务进入员工履历。

### Milestone G3：员工自我进化

- [ ] 周期性能力盘点；
- [ ] 从失败履历发现能力缺口；
- [ ] 推荐公司已有能力；
- [ ] 社区插件候选；
- [ ] 老板审批；
- [ ] Smoke Test；
- [ ] 真实技能证据结算；
- [ ] 自动写 Reflection。

### Milestone G4：个人空间

- [ ] 每位员工持久化自己的空间布局；
- [ ] 工具/插件成为空间中的真实设备；
- [ ] 高等级空间扩展；
- [ ] 项目物品 / 成就陈列；
- [ ] 点击设备查看对应真实能力与健康状态。

### Milestone G5：经营层

- [ ] 公司目标；
- [ ] 项目板；
- [ ] 部门；
- [ ] 员工负载；
- [ ] 阻塞与风险；
- [ ] 能力缺口；
- [ ] 真实经营日报 / 周报；
- [ ] 外部客户 / 渠道来源统计。

---

## 8. 产品最终形态

用户看到：

```text
一个经营养成游戏
```

底层实际运行：

```text
Persistent Multi-Agent Runtime
+ DSH Plugin Ecosystem
+ External IM Transport
+ Model Gateway
+ Evidence-driven Evolution
+ Company Event Bus
```

游戏感来自“真实工作被可视化”，而不是演一场假的公司动画。
