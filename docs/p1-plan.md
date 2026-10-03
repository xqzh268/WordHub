# P1 开发计划：小说核心闭环

> **当前进度（2026-10-03）**：M0 与桌面壳界面已完成；下一步见 [m1-plan.md](m1-plan.md)。界面设计说明见 [design/README.md](design/README.md)。

> M0状态：已完成（2026-10-03）。实现与验证记录见[m0-report.md](m0-report.md)；Pi utilityProcess、取消、崩溃重启、中文路径以及DeepSeek两模型思考模式多轮工具调用均已实测通过。

**日期：2026-10-03**　前置：P0 全部门槛已通过（契约校验、Pi + DeepSeek 真实调用、SuperDoc 中文 DOCX 读写、foliate-js 读 EPUB/MOBI，见 [p0-spikes.md](p0-spikes.md)）。
上位文档：[research/README.md](research/README.md) §五（已定决策）、§六（路线）。

---

## 1. P1 目标

做出**第一个能端到端跑通的小说写作桌面应用**：

> 用户新建项目并链接一个本地文件夹 → 纲领Agent分层问答 → 生成大纲、人物档案、设定词典、文风基准，用户确认 → 写手写第1章 → 编辑修订 → 评审按清单质询，写手应答 → 用户确认 → 章节落盘到文件夹；全过程在群聊中可见、可@、可中断续跑、可撤销，并显示费用。

### 范围

| 做 | 不做（P2及以后） |
|---|---|
| Electron 桌面壳、纸感设计 token 与字体、Workspace 三栏 | References、Graph 界面 |
| 项目 / Session / 链接文件夹、`.wordhub/` | 参考小说导入、文风学习 |
| SQLite 事件日志、Revision、撤销 | 推演、节点采访 |
| 五个内置角色 + 自建 Agent（AGENT.md）+ 三级写权限 | LaTeX、科研、基金 |
| 协调器：@路由、DAG、有界质询/提问、审批卡、费用预估 | 多人协作 |
| Settings：Provider、模型、思考强度、每Agent配置 | 安装包签名、自动更新 |
| 章节编辑器（纸面）+ 导出 DOCX/TXT | Word 级复杂排版 |

### 验收（P1 Demo 脚本）

1. 冷启动 → 新建项目"长安夜"，链接 `D:\写作\长安夜`（含中文路径）。
2. 首句"写一部唐代悬疑短篇，主角是不良人"：纲领给出提取结果和"直接规划 / 确认修改 / 走问答"三个选项；走问答完成 L1 + L2。
3. 文件夹中生成 `.wordhub/bible/` 下的人物档案、大纲、设定词典、文风基准，以及写作计划。
4. 运行前弹出费用预估，确认后写手写第1章，正文流式出现在纸面上。
5. 编辑改写2处，在纸面上用作者色条标出，可单条撤销。
6. 评审发起1次 `blocking` 质询，写手应答；第2轮仍反驳时升级为用户裁决卡。
7. 中途关闭应用 → 重开后 Run 从检查点继续，事件不丢失也不重复。
8. 在输入框 @一个自建 Agent（由用户从表单创建，开启 `write`），它直接改写一段，可撤销。
9. 导出 `第一章.docx`，用 Word 和 WPS 都能打开。
10. Settings 中把编辑改为 `deepseek-flash / low`，下一次调用即生效；API key 不出现在任何日志或事件中。

---

## 2. P0 审阅：遗留与小修

| # | 事项 | 处理 |
|---|---|---|
| 1 | Pi spike 用的是 `child_process`；未覆盖 `utilityProcess`、`abort`、崩溃重启、中文路径 | 放进 M0 |
| 2 | 未验证 DeepSeek 思考模式下的**多轮工具调用**（pi-ai 对该模型设了 `requiresReasoningContentOnAssistantMessages`） | 放进 M0；所有工具型Agent都依赖它 |
| 3 | AGENT.md 中 `reasoning` 同时出现在顶层和 `model.reasoning` | 统一为 `model.reasoning`，删除顶层字段，schema 升到 v2 |
| 4 | 尚无 SQLite 表结构，只有对象 schema | M1 定义并加迁移机制 |
| 5 | 仓库还不是 git 仓库；根目录留有 `superdoc-*.tgz`、`foliate-js-*.tgz` | M0 执行 `git init`，tgz 移到 `vendor/` 或删除（已被 .gitignore 忽略） |
| 6 | SuperDoc 只在浏览器上下文验证过；**Agent 在后台 worker 中能否直接编辑 DOCX** 尚不明确 | 见决策点 D1 |

---

## 3. 决策点

### D1：小说正文用什么格式存储（需要你确认）

问题：Agent 运行在后台 worker（utilityProcess）里，而 SuperDoc 依赖浏览器 DOM。如果正文以 DOCX 为真相源，每次 Agent 写入都要经过一个"无界面的 SuperDoc"：它的 npm 包里有 Node 端的协作引擎导出和 jsdom 依赖，可能可以做到，但还没验证。

| 方案 | 做法 | 优点 | 代价 |
|---|---|---|---|
| **A（推荐）** | 小说章节以 **Markdown 为真相源**（`chapters/03-坊门.md`）；编辑器用 ProseMirror/Tiptap 核心（MIT）做纸面编辑；DOCX/TXT/EPUB 只作导出 | Agent 原生读写文本；diff、revision、段落锚点都简单；文件夹里的稿件人和 git 都能直接读；不依赖未验证的无界面 SuperDoc | 小说模式没有 Word 级排版（字体字号在导出模板里设置）；Word 编辑能力推迟到 P4 |
| B | 正文以 DOCX 为真相源，SuperDoc 作编辑器；Agent 写入经 jsdom 无界面 SuperDoc，或以 Yjs 协作者身份写入 | 与"支持 Word 格式编辑"的原始需求一致 | M0 需要先做一次高风险 spike；Agent 补丁要映射到 OOXML，revision 和 diff 都更复杂 |

推荐 A 的理由：小说作者几乎只需要纯文本加段落，排版发生在投稿或出版导出时；Word 级编辑真正必要的是科研/基金场景（P4），那时 SuperDoc 再作为"Word 模式"编辑器上场，届时 D1-B 的 spike 也已有结论。**M0 仍会对方案 B 做一次限时（1天）spike，作为 P4 的预研。**

### D2：工程工具链（采用以下默认值，无需确认）

npm workspaces（沿用 P0）；electron-vite（主进程 / preload / 渲染进程 / utilityProcess 共用一套 Vite 构建）；TypeScript strict；Vitest；Playwright 的 Electron 模式做 E2E；Biome 负责格式化与 lint；GitHub Actions 跑 `windows-latest`。

---

## 4. 工程结构

```text
WordHub/
├─ apps/desktop/                 Electron 应用
│  ├─ src/main/                  窗口、路径授权、safeStorage、utilityProcess 生命周期、IPC
│  ├─ src/preload/               contextBridge：类型化 API（只暴露命令和事件订阅）
│  ├─ src/worker/                utilityProcess 入口 → 装配 runtime + store
│  └─ src/renderer/              React 19 应用
├─ packages/
│  ├─ contracts/                 ← 迁入 P0 的 schemas/、domain.ts；AJV 校验器；IPC 协议类型
│  ├─ store/                     SQLite（node:sqlite）：事件追加、投影、Revision、迁移、FTS5
│  ├─ runtime/                   协调器、AgentHost（Pi 封装）、工具、权限、上下文构建、模型解析
│  ├─ novel/                     小说领域包：纲领问答流程、模板、评审清单（ConStory）、默认 AGENT.md
│  └─ ui/                        设计 token、字体、纸感组件（shadcn/Base UI 定制）
├─ docs/  schemas/(→contracts)  examples/  scripts/(P0 spikes 保留)
└─ LICENSE (AGPL-3.0)  CLA.md  CONTRIBUTING.md
```

依赖方向：`renderer → contracts`；`worker → runtime → store → contracts`；`runtime` 不依赖 Electron（可在 Node 中单测）。

---

## 5. 里程碑

周数按 1 名主力开发加 AI 辅助粗估，每个里程碑结束时都要有可运行产物。

### M0 工程基线与遗留验证（约1周）

- `git init`；LICENSE（AGPL-3.0）、CLA.md、CONTRIBUTING.md；搭好 monorepo 与 CI。
- Electron 壳能启动：三栏骨架（侧栏 / 会话+群聊 / 纸面），载入设计 token（色板、纸纹、阴影）和字体管线（Inter + Noto Sans SC 子集，Source Serif 4 + Noto Serif SC 分片）。
- 类型化 IPC：`invoke(command)` 加 `subscribe(eventStream)`，渲染进程拿不到 Node 和密钥。
- **验证**：
  1. utilityProcess 里运行 Pi Agent：流式输出、`abort()`、杀进程后自动重启、中文项目路径。
  2. DeepSeek V4 思考模式下的**多轮工具调用**（两种模型各测一次）。
  3. （限时1天）无界面 SuperDoc 在 Node/jsdom 中修改 DOCX，结论记入 P4 预研。
- **门槛**：CI 在 Windows 上绿；上面 3 项验证都有报告。

### M1 存储与项目内核（约1.5周）

- SQLite 表：`projects`、`sessions`、`runs`、`tasks`、`events`（`seq` 单调、`idempotencyKey` 唯一）、`artifacts`、`revisions`、`facts`、`usage`；FTS5 建在事件文本和正文上；带 schema 迁移。
- 事件追加 API：校验 → 事务内分配 seq → 写入 → 广播；投影器（会话消息列表、任务状态、当前 revision）可从事件全量重建。
- 链接文件夹：选择目录并授权，生成 `.wordhub/` 结构；写盘走"临时文件 → 校验 → 原子替换 → revision 快照"；监听外部修改，生成 `file.changed_externally` 事件，不静默覆盖。
- Revision：候选、当前、撤销（以新 revision 实现）；段落级 diff。
- **门槛**：事件重放得到的投影与在线投影完全一致（属性测试）；写盘过程中强杀进程，文件不会半写。

### M2 Agent 运行时（约1.5周）

- AGENT.md 加载与校验（schema v2），内置五角色定义放在 `packages/novel/agents/`，用户自建的放在 `.wordhub/agents/`。
- 模型解析链：单条消息 > Agent > 项目 > 全局；`getSupportedThinkingLevels` 过滤可选强度；fallback 模型。
- 密钥：safeStorage 加密 → 自定义 pi-ai `CredentialStore`；开发期回退读取 `DEEPSEEK_API_KEY`。
- AgentHost：把 Pi `Agent` 事件映射为 WordHub Event；`beforeToolCall` 做权限检查（工具白名单、`writeScopes`、`confirmBeforeWrite` → 审批）；`transformContext` 构建分层上下文（L0 圣经 → 摘要 → 前文结尾 → 文风锚点，顺序与 chinese-novelist-skill 一致）；`steer`/`followUp`；按调用累计 usage 与 cost。
- 首批工具：`doc.read`、`doc.write`、`doc.propose`、`bible.read`、`bible.propose`、`history.search`、`history.get`、`plan.update`、`challenge.raise`、`challenge.reply`、`question.ask`。
- **门槛**：用 pi-ai 的 faux provider 写确定性单测，覆盖权限拒绝、越界写、审批挂起与恢复；真实 DeepSeek 的冒烟测试只在设置了环境变量时运行。

### M3 协调器与群聊（约2周）

- Run/Task DAG 状态机：`pending → ready → running → waiting_approval → succeeded/failed`；检查点与续跑。
- 路由：`@agent` 直投；`@all` 并行扇出；未@时交纲领；运行中的补充消息走 `steer`。
- 写入串行化：按段落/章节加锁，基于 `parentRevisionId` 自动 rebase，冲突时降级为 `propose`。
- 质询与提问协议（≤2轮 → `escalation`），`blocking` 级质询未解决时任务不能结束。
- 预算：Run 开始前按"任务数 × 历史平均 token × 单价"预估费用，等用户确认；运行中超预算就暂停。
- 群聊界面：从事件投影渲染；印章头像；工作流时间线（○◐●✕）；工具调用折叠卡；讨论线程折叠；审批卡和裁决卡；@选择器；流式墨点光标；费用角标。
- 会话栏：项目 → sessions；会话之间隔离。
- **门槛**：Demo 第 6、7、8 步通过。

### M4 小说流程（约2周）

- 纲领问答：L1 必答 / L2 可跳过加随机 / L3 标题，以群聊里的结构化表单卡呈现；支持快捷提取；"回到 QX"修改；偏好按"用户 × 文体"记忆。
- 产出物，Markdown 与 JSON 双份：人物档案、大纲（8列章节表与悬念线）、设定词典（读者已知 / 完整真相 / 计划揭示）、文风基准、写作计划（章节状态机）、伏笔台账；用户确认后写入 `.wordhub/bible/`。
- 写手：按章写，写前必读顺序固定，最后读到的是正文语态文字；写完自动追加章节摘要。
- 编辑：语言、格式、字数、去 AI 腔（负面词表）；写权限 `write`。
- 评审：按 ConStory 5 类清单，对照圣经、前文摘要和大纲逐条核验；核验问题隔离作答；结论以 `challenge` 发出，不负责润色。
- 观察者（最小版）：每章抽取"候选事实"（人物状态、新名词、伏笔），存入 `facts`，状态为 `proposed`，在群聊中批量确认；图谱界面留到 P2。
- **门槛**：Demo 第 2–6 步通过；同一题材连续写 3 章，评审能找出人工预埋的 3 类矛盾（左右手、已死角色出场、称谓不一）。

### M5 纸面编辑器、Settings 与收尾（约1.5周）

- 章节编辑器（按 D1-A）：ProseMirror 纸面；按 revision 显示作者色条并可撤销；Agent 写入时段落高亮淡入；字数和保存状态；专注模式。
- 导出：DOCX（docx.js，套用中文小说模板：宋体/楷体、首行缩进、章标题）、TXT（UTF-8 和 GB18030）。
- Settings：Provider 列表、key 录入、自定义 OpenAI 兼容服务、模型勾选、每 Agent 的模型与思考强度、项目默认值；自建 Agent 表单（生成 AGENT.md）。
- 亮/暗两套主题，`prefers-reduced-motion`。
- **门槛**：Demo 1–10 步全部通过；对外发布 `v0.1.0-alpha` 开源预览。

**合计约 9–10 周。**M3 与 M4 可以部分并行：M4 的提示词和清单可以先用 CLI 调试。

---

## 6. 测试策略

- **单元**：contracts（schema 往返）、store（重放一致性、幂等）、runtime（权限、路由、质询计数），全部用 faux provider 保证确定性。
- **录制回放**：真实 DeepSeek 跑一遍并录下事件流作为 fixture，用于 UI 和协调器的回归，不再花 token。
- **E2E**：Playwright 驱动 Electron 跑 Demo 脚本（其中模型调用用回放）。
- **质量基准**：固定3个小说设定，每次改提示词或编排都跑"3章 + 预埋矛盾检出率 + token/费用"，前后对比；结果放在 `bench/`。
- **安全**：路径穿越、越界写、key 泄露扫描（检查事件和日志中是否出现 key 片段）。

---

## 7. 风险

| 风险 | 缓解 |
|---|---|
| DeepSeek 思考模式下的工具调用兼容性 | M0 首先验证；若有问题，工具型 Agent 先用 `reasoning: off`，或换到 pi-ai 支持的其他模型 |
| 评审"走过场"（自评偏乐观） | 评审使用独立上下文，核验问题隔离作答；质量基准里放预埋矛盾 |
| 单写手长篇的上下文膨胀 | 只注入摘要与前文结尾，其余通过 `history.search` 检索；每次调用的注入内容可在 UI 查看 |
| 协调器复杂度失控 | P1 只支持线性 DAG 加质询子线程；`@all` 并行是唯一的并发入口 |
| SuperDoc（AGPL）影响以后商业化 | P1 小说模式不依赖 SuperDoc（D1-A）；CLA 保留双许可空间 |

---

## 8. 第一周具体安排

1. `git init`，加 LICENSE、CLA，搭 monorepo 骨架，把 `schemas/` 迁入 `packages/contracts` 并修正 `reasoning` 重复字段。
2. electron-vite 壳加三栏骨架加设计 token，类型化 IPC 打通。
3. utilityProcess 中跑 Pi 的验证（流式、abort、崩溃重启、中文路径）。
4. DeepSeek 多轮工具调用验证。
5. 无界面 SuperDoc 限时 spike（P4 预研）。
6. Windows CI 跑绿。
