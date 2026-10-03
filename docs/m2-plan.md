# 下一步开发计划：M1.1 加固 → M2 Agent 运行时

**日期：2026-10-03**　依据：[m1-acceptance.md](m1-acceptance.md)（验收结论与缺陷编号）；上位文档 [p1-plan.md](p1-plan.md)。

顺序是先加固再前进：M1.1 约 3 天，M2 约 8–10 个工作日。M1.1 里有一个会丢用户数据的缺陷，不能带着它去做“Agent 直接写正文”。

## 当前实现进展（2026-10-04）

M1.1的写入守卫、身份事件、中断清扫、候选修订恢复、投影属性测试和真实Electron重启脚本已经落地并通过本地验证。M2已完成运行时基础层：`packages/runtime`、AGENT.md加载与项目覆盖、模型解析和`models.json`读取、safeStorage凭据、分层上下文清单、Pi临时思考流、首批文档/圣经/历史工具、权限守卫和审批事件。思考内容只经临时事件展示，不进入事件日志。

本轮还未把自定义OpenAI兼容Provider、fallback自动切换、跨重启恢复Pi审批上下文和Settings中的逐Agent可编辑表单列为已完成；这些是M2剩余验收项，不能用静态默认值替代。

---

## 一、M1.1 加固（约 3 天）

目标：M1 的 6 条验收标准全部达成，`test:m1:e2e` 11/11 并纳入 CI，两个 `it.fails` 翻转为 `it`。

| 顺序 | 事项 | 对应缺陷 | 验收 |
|---|---|---|---|
| 1 | **写入守卫**：`writeText` 写入前比对磁盘哈希与当前修订。不一致时：先把用户版本存为一个修订（作者标为 `external`），追加 `file.changed_externally` 事件，再按调用方策略 `reject`（默认）或 `keep-both` 处理。Agent 写入遇到冲突降级为提案 | 1、7 | `it.fails` 转 `it`；用户手改的内容在任何情况下都能从修订里找回 |
| 2 | **Agent 身份进入事件**：`chat.user_message` 记录原始输入与 `mentions`；`run.started` 记录 `agentId / model / reasoning`；去掉写死的 `"writer"`；投影只读事件；渲染端发送原文 | 2 | E2E 的两项失败转绿 |
| 3 | **中断运行**：后台启动时清扫 `runs.status='running'`，追加 `run.interrupted`；投影与界面增加“已中断”状态（“继续”按钮留到 M3） | 3 | `it.fails` 转 `it`；E2E 增加“运行中途强杀”场景 |
| 4 | **数据目录与项目识别**：`app.setName("WordHub")`；链接文件夹时读取 `project.json` 复用 `projectId`，路径比较规范化；注册表丢失时能从 `project.json` 找回 | 5、12 | E2E：删除注册表后重新链接，聊天记录仍在 |
| 5 | **写盘对账**：`pending` 修订 → 替换 → 转 `current`；启动时按哈希对账；加入故障注入点（替换前、替换后、入库前）的测试 | 7 | 故障注入测试覆盖三个崩溃点 |
| 6 | **投影与检索**：`projectChat` 改为 `applyEvent` 的折叠；`fc.assert` 属性测试对比“增量 / 全量 / 落库读回”；全文检索只索引文本字段；快照目录用哈希；移除调用方 `seq`；建迁移执行器 | 6、8、9、10、11 | 属性测试 ≥1000 组；搜 `delta` 不再命中；v0 → v1 迁移测试 |
| 7 | **CI**：`test:m1:e2e` 纳入 CI；Biome 覆盖全仓库 | 13（部分） | CI 绿 |

---

## 二、M2 Agent 运行时（约 8–10 个工作日）

### 目标

让“一条消息交给哪个 Agent、用哪个模型、能读写什么”都由配置决定，且设置页上的模型分配变为真实可改。完成后用户可以：在设置里填 API key 与模型；给每个 Agent 单独选模型和思考强度；`@` 任一 Agent 让它读设定集、写章节；越权的写入被拦下，需要确认的写入弹出审批卡；每次调用的花费看得见。

### 现状

[worker/index.ts](../apps/desktop/src/worker/index.ts) 把项目、会话、运行、模型、工具都写在一个 196 行的文件里：模型写死 `deepseekProvider`、密钥读环境变量、唯一的工具是回声工具、没有权限、没有 AGENT.md 加载。M2 先把它拆开，再往里加能力。

### 工程结构

新建 `packages/runtime`，**不依赖 Electron**，可在 Node 里直接单测；worker 缩成一个只做消息路由的薄壳。

```text
packages/runtime/src/
  agents/      AgentRegistry：加载并校验 AGENT.md（内置 + .wordhub/agents），监听变更
  models/      ProviderRegistry、ModelResolver、凭据接口
  context/     ContextBuilder：分层上下文，导出“本次注入了什么”的清单
  tools/       ToolRegistry、PermissionGuard，首批工具
  host/        AgentHost：封装 Pi Agent，Pi 事件 → WordHub 事件
  runs/        RunService：生命周期、中断清扫、用量、取消
packages/novel/agents/   五个内置角色的 AGENT.md（先写简版提示词，M4 再精修）
```

### 工作拆分

**2.0 拆分与基线（1 天）**
把 worker 逻辑迁入 `packages/runtime`，行为不变，E2E 与冒烟测试保持通过。这是后面所有项的前提。

**2.1 AGENT.md 加载（1 天）**
- 用 [agent-config.schema.json](../packages/contracts/src/schema/agent-config.schema.json)（v2）校验 frontmatter；解析正文为系统提示。
- 内置五角色放在 `packages/novel/agents/`，用户自建的放在 `.wordhub/agents/<name>/AGENT.md`，同名时项目内的优先。
- 校验失败的文件在界面上显示原因，不影响其他 Agent。
- 验收：五个内置文件通过校验；坏文件被拒绝并给出行号级提示。

**2.2 模型与思考强度（1.5 天）**
- `ProviderRegistry` 基于 pi-ai 的 `createModels()` 与 `setProvider()`：内置 DeepSeek，另支持用户添加任意 OpenAI 兼容服务（名称、baseUrl、模型列表）。
- `ModelResolver` 优先级：单条消息指定 > Agent 配置 > 项目默认 > 全局默认；思考强度用 `getSupportedThinkingLevels(model)` 过滤，**不接受模型不支持的值**；Agent 配置了 `fallback` 时，主模型出错自动切换并记事件。
- 配置文件：全局在应用数据目录，项目级在 `.wordhub/models.json`，均按 [model-config.schema.json](../packages/contracts/src/schema/model-config.schema.json) 校验。
- 验收：把编辑改为 `deepseek-flash / low`，下一次调用即生效；选择不支持的强度会被拒绝。

**2.3 密钥（1 天）**
- 渲染进程只能“写入”密钥，读不出来：设置页填写后经 IPC 交给主进程，由 Electron `safeStorage`（Windows 下为 DPAPI）加密保存。
- 主进程通过与后台的消息通道把密钥交给后台，**只存在内存里**，不写环境变量、不写日志、不进事件、不进数据库。开发期保留 `DEEPSEEK_API_KEY` 环境变量作为后备。
- 实现 pi-ai 的 `CredentialStore` 接口对接上述来源。
- 提供“测试连接”（一次最小调用）。
- 验收：扫描事件、数据库、日志，不出现密钥片段（自动化测试，含 live 场景）；渲染进程没有任何读取密钥的接口。

**2.4 上下文分层（1.5 天）**
- 注入顺序遵循 [chinese-novelist-skill 的写前必读顺序](research/domain-and-competitors.md)：设定集（`.wordhub/bible/*.md`）→ 大纲本章行 → 前文结尾 → 文风基准；用 Pi 的 `transformContext` 实现。M2 先做 **L0 设定集 + 近期对话窗口 + 当前文档片段**，摘要与检索层留到 M4。
- 每次调用产出“注入清单”（哪一层、哪个文件、多少 token），以事件记录。
- 界面：消息旁的“查看上下文”弹层，借鉴 NovelAI 的 Context Viewer。
- 验收：清单与实际发给模型的内容逐项对得上（用 faux provider 抓取请求验证）。

**2.5 工具与权限（2 天）**
- 首批工具（TypeBox 定义参数）：`doc.read`、`doc.write`、`doc.propose`、`bible.read`、`bible.propose`、`history.search`、`history.get`。写入统一经 `ControlledFileWriter`（含 M1.1 的写入守卫）。
- `PermissionGuard` 放在 Pi 的 `beforeToolCall`：检查工具白名单、`write` 级别（`none / propose / write`）、`writeScopes`（路径通配）；拒绝时返回给模型一条明确的错误结果，并记 `permission.denied` 事件。
- `confirmBeforeWrite`：记 `approval.requested` 事件，运行进入 `waiting_approval`；用户在审批卡上批准或拒绝后恢复。**把现在界面里的演示审批卡接成真实事件。**
- 验收（均用 faux provider 写确定性测试）：越界路径被拒；`none` 级别 Agent 调用写工具被拒；需确认的写入在批准前不落盘、批准后落盘、拒绝后不落盘；重启后停在 `waiting_approval` 的运行仍可批准。

**2.6 事件映射与用量（1 天）**
- Pi 事件 → WordHub 事件（`run.started / message.delta / tool.started / tool.finished / run.finished`），工具事件带参数摘要。
- 记录每次调用的 token 与费用（pi-ai 逐次返回），累计到 `usage`；聊天里每条回复下方显示用量，会话与项目层面可汇总。
- 验收：与 pi-ai 返回的 `cost` 数值一致。

**2.7 界面接线（1 天）**
- 设置页：服务商列表、密钥录入（只写）、自定义服务、模型勾选、每个 Agent 的模型与思考强度（只显示该模型支持的级别）。
- 输入框的模型标签、Agent 列表的模型缩写、聊天用量行改为真实数据。
- “已中断”“等待审批”“权限被拒”三种状态的展示。

### M2 总体验收

1. 设置里添加 DeepSeek 密钥，“测试连接”成功；密钥在事件、数据库、日志中不出现。
2. 给“写手”选 `deepseek-v4-pro / high`、给“编辑”选 `deepseek-flash / low`，两次 `@` 分别用对应模型回复（事件里可查）。
3. `@写手` 让它读设定集并写入 `chapters/第一章.md`：纸面出现内容，修订可撤销；越界路径、`none` 级别 Agent 被拒并在群聊里说明原因。
4. 开启 `confirmBeforeWrite` 的 Agent：审批卡出现，批准前文件不变；关掉应用重开，审批卡仍在，批准后落盘。
5. “查看上下文”列出的注入项与实际请求一致。
6. 每条回复显示用量，与 pi-ai 返回值一致。
7. 全部自动化测试用 faux provider 保证确定性，live 冒烟只在设置了密钥时运行；CI 绿。

### 我将采用的默认值（不同意请说）

| 事项 | 默认 |
|---|---|
| 写权限 | 内置“写手”“编辑”为 `write` 且不需确认（改动可撤销）；**用户自建 Agent 默认开启 `confirmBeforeWrite`**，可逐个关闭 |
| 思考内容 | 界面实时显示并可折叠，**不写入事件日志**（体积大且多为内部推理）；以后可加开关 |
| 密钥存储 | Electron `safeStorage`；不引入第三方密钥库 |
| 内置提示词 | M2 只写能跑通流程的简版，质量打磨放 M4 |

---

## 三、之后（概览）

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| M3 协调器与群聊（约 2 周） | 任务图、`@all` 并行、质询 ≤2 轮后升级、写入串行化、“继续”被中断的运行、运行前费用预估 | M2 |
| M4 小说流程（约 2 周） | 纲领分层问答、设定集生成、编辑/评审清单、观察者抽取候选事实；把《长安夜》做成样例项目 | M3 |
| M5 编辑器与收尾（约 1.5 周） | ProseMirror 纸面编辑、DOCX/TXT 导出、自建 Agent 表单、Mica 与命令面板、打包 | M4 |

## 四、风险

| 风险 | 缓解 |
|---|---|
| DeepSeek 思考模式下多轮工具调用的稳定性（M0 只验证了回声工具） | M2.5 用真实读写工具再跑一轮 live 验证；有问题时工具型 Agent 暂用 `reasoning: off` |
| Pi 1.0 的接口变动 | 全部封装在 `packages/runtime/host` 一处；锁定 `1.0.0` |
| 拆分 worker 引入回归 | 2.0 先做“行为不变”的搬迁，靠现有 E2E 与冒烟测试兜底 |
| 权限模型过于宽松或过于严格 | 默认最小权限；拒绝信息清晰地回给模型，让它自行改用 `propose` |
