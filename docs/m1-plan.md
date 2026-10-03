# 下一步开发计划：M1 存储与项目内核

**日期：2026-10-03**　上位文档：[p1-plan.md](p1-plan.md)（P1 整体范围与 Demo 脚本）。

## 1. 现状

| 部分 | 状态 |
|---|---|
| P0 契约、技术验证 | 完成。[p0-contracts.md](p0-contracts.md)、[p0-spikes.md](p0-spikes.md) |
| M0 工程基线 | 完成。Electron + utilityProcess + Pi + DeepSeek 已实测，见 [m0-report.md](m0-report.md) |
| 桌面壳界面 | 完成。设计系统、三栏工作区、群聊、纸面、设置页，见 [design/README.md](design/README.md) |
| CI | 已修复：`package-lock.json` 缺 `undici`，在干净克隆上用 npm 12 重放四个步骤全部通过 |
| **后端** | **只有“发一句话 → 后台流式回一句话”。没有存储、项目、会话、权限、协调器** |

界面已经走在后端前面。M1 的任务是把后端的地基补上，让界面上每一处“看起来能用”的东西都有真实数据支撑。

### 界面里目前仍是静态或演示的部分

| 界面元素 | 现状 | 由谁接线 |
|---|---|---|
| 会话列表 | 只在内存中，刷新即丢 | M1 |
| 项目卡 / 链接文件夹 | 只记录文件夹名，不创建 `.wordhub/` | M1 |
| 群聊消息 | 前端临时把 worker 事件拼成消息 | M1：改为事件日志的投影 |
| 纸面 | 只有演示稿，无真实章节 | M1 读取，M5 编辑 |
| 编辑“撤销”、审批卡裁决 | 仅界面状态，不产生事件 | M3 |
| 质询线程、审批卡 | 仅演示数据 | M3 |
| 模型 chip、设置页“模型分配” | 写死的默认值 | M2 |
| “新建 Agent” | 禁用 | M5 |
| 费用预估 | 无 | M3 |

## 2. M1 目标

打开应用后，用户可以链接一个文件夹创建项目；会话和群聊记录在关闭重开后仍在；所有变化都以追加事件落库，界面只是事件的投影；对文件夹内稿件的写入原子、可撤销。

**验收**（对应 Demo 脚本第 1、7、10 步的基础）
1. 链接含中文路径的文件夹 → 生成 `.wordhub/`，项目出现在“最近项目”。
2. 发一条消息、收到流式回复 → 强杀整个应用 → 重开 → 会话、消息、回复完整，且没有重复事件。
3. 把 DB 里的投影清空，仅凭事件日志重建，结果与在线投影逐字段一致（属性测试）。
4. 写盘过程中强杀进程，目标文件要么是旧内容要么是新内容，不会半写。
5. 外部程序修改了稿件 → 生成 `file.changed_externally` 事件，不被静默覆盖。
6. API key 不出现在事件、日志和数据库的任何字段。

## 3. 已定决策

### D3：SQLite 放在哪里 —— 已定：方案 A（2026-10-03）

| 方案 | 做法 | 优点 | 代价 |
|---|---|---|---|
| **A（推荐）** | 文件夹里只放用户看得懂、可带走的东西（章节 `.md`、`.wordhub/bible/*.md`、`.wordhub/agents/*/AGENT.md`、`project.json`）；事件日志与索引的 SQLite 放在 `%APPDATA%/WordHub/projects/<projectId>/` | 文件夹放进 OneDrive / 坚果云 / git 不会损坏数据库（WAL 文件与云同步冲突是常见事故）；文件夹保持干净，用户直接编辑稿件很自然 | 换电脑要“导出项目包”（M5 提供）；删除文件夹不会清掉库 |
| B | 一切都放在文件夹 `.wordhub/wordhub.db` | 整个项目一个文件夹，拷走即用 | 同步盘损坏风险；git 里要忽略 db；用户误删 `.wordhub` 就丢历史 |

**决定采用 A。**文件夹只放用户可读、可带走的稿件与设定；事件日志与索引的 SQLite 放在应用数据目录，由 `project.json` 里的 `projectId` 关联。

## 4. 工作拆分

按依赖顺序，每一项都带验收；预计合计约 1.5 周。

### 4.0 工程工具（1–2 天，所有后续项的前提）

- Vitest：单元测试 + 属性测试（fast-check）；CI 增加 `npm test`。
- Biome：格式化与 lint；CI 增加检查，不通过即失败。
- 新建 `packages/store`、`packages/runtime`（P1 计划中的目录结构），`runtime` 不依赖 Electron。
- 把渲染进程里临时的 `handleEvent` 映射，改为引用 `packages/contracts` 中的**纯函数投影** `projectChat(events) → ChatItem[]`——这是后面所有“可重放”的基础。

### 4.1 存储 spike（0.5 天）

已在 Node 24.11 实测：`node:sqlite` 为 SQLite 3.50.4，开启了 FTS5，WAL 可用。

> **中文检索的坑**：FTS5 自带的 `trigram` 分词器对 **2 个字的词**（如“门槛”）查不到结果，因为它要求至少 3 个字符。
> 实测可行的做法：入库与查询前，把每个汉字两侧加空格逐字切分，用 `unicode61` 分词器，查询时作为**短语**匹配。
> 1 字、2 字、4 字词都命中，且“槛门”这样的不相邻顺序不会误匹配。M1 采用该方案，封装成 `store.fts.index/search`。

还需在 Electron 的 utilityProcess 中确认同样可用（M1 第一天做）。

### 4.2 事件日志与迁移

- 表：`projects`、`sessions`、`runs`、`events`（`seq` 项目内单调、`idempotencyKey` 唯一）、`usage`；`user_version` 管理迁移。
- `appendEvent`：在一个事务里校验 schema → 分配 `seq` → 幂等去重 → 写入 → 提交后广播。
- **单写者**：只有 worker 进程持有数据库连接（符合 pi-durable 的“单进程持有存储”约束，也避免多进程锁问题）。
- 验收：并发追加 1 万条事件无重复无空洞；重复 `idempotencyKey` 不产生新行。

### 4.3 投影与重放

- 投影器：会话消息列表、任务状态、项目最近活动；全部是 `(state, event) → state` 的纯函数。
- 在线增量应用与“从头重放”走同一份代码。
- 验收：属性测试，随机事件序列下两种路径结果一致。

### 4.4 项目与会话

- 命令：`project.create/open/listRecent`、`session.create/list/rename`；IPC 契约同步扩展。
- 链接文件夹：写 `.wordhub/project.json`（含 `projectId`），目录白名单授权，之后所有文件操作都限制在授权根内（`..`、符号链接、盘符大小写都要测）。
- 最近项目存放在 userData，不放在项目内。
- 验收：Demo 第 1 步；路径穿越用例全部被拒绝。

### 4.5 Pi 事件映射

- Pi 的 `agent_start / message_update / tool_execution_* / agent_end` → WordHub `Event`（`run.started / message.delta / tool.started / tool.finished / run.finished`）。
- 每次调用的 token 与费用写入 `usage`（pi-ai 已逐次返回 cost）。
- 崩溃恢复：重启后把未结束的 run 标记为 `interrupted`，群聊里显示可“继续”。
- 验收：Demo 第 7 步的基础：杀进程后重开，历史完整，未完成的运行状态正确。

### 4.6 受控写盘与撤销

- `fileStore.write`：写临时文件 → 校验哈希 → 原子替换 → 记录 `revision`（`contentHash`、`parentRevisionId`、作者）。
- 撤销 = 新建一个回到旧内容的 revision，不删除历史。
- 文件监视：外部修改 → `file.changed_externally`；与待写入冲突时降级为提案，不覆盖。
- 验收：写盘中强杀无半写；外部修改被检测；撤销后内容与旧 revision 哈希一致。

### 4.7 界面接线

- 会话列表、群聊、项目卡全部改为读投影；刷新或重开后恢复。
- “最近项目”入口；纸面读取当前章节文件（只读，编辑在 M5）。
- 去掉演示数据路径之外的所有内存临时状态。
- 验收：冒烟测试扩展为“重启后会话仍在”；Playwright 驱动的 E2E 覆盖。

## 5. 之后的里程碑（概览）

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| M2 Agent 运行时（约 1.5 周） | AGENT.md 加载、模型解析链与思考强度、密钥加密保存（safeStorage）、权限拦截、上下文分层注入、首批工具。**设置页的“模型分配”变成真实可改** | M1 的事件与 revision |
| M3 协调器与群聊（约 2 周） | 任务图、@ 路由、写入串行化、质询 ≤2 轮后升级、审批卡与撤销产生真实事件、**运行前费用预估** | M2 |
| M4 小说流程（约 2 周） | 纲领分层问答、设定集、写手 / 编辑 / 评审清单、观察者抽取候选事实 | M3 |
| M5 编辑器与收尾（约 1.5 周） | ProseMirror 纸面编辑、DOCX/TXT 导出、自建 Agent 表单、Mica 材质与命令面板（Ctrl+K）、打包 | M4 |

## 6. 风险与未决事项

| 事项 | 说明 | 处理 |
|---|---|---|
| `node:sqlite` 仍标注实验性 | Node 24 中可用并带 FTS5，但 API 可能变动 | 封装在 `packages/store` 一处；M1 spike 里再确认 utilityProcess 内行为 |
| Pi 1.0 刚发布，pi-durable 仍实验性 | 本计划自建事件日志，数据模型与其对齐 | M2 末做一次采用评估，不阻塞主线 |
| 输入法（IME）行为未在真实输入法下验证 | 输入框已在组合输入期间忽略 Enter，但只做了代码层处理 | M1 界面接线时用微软拼音、搜狗实测 |
| Windows 11 Mica 材质未做 | 无法用截图验证系统材质，避免盲目上线 | 放在 M5，在真机上看效果 |
| 键盘可达性与屏幕阅读器 | 基础语义已有（role/aria），尚未系统审查 | M3 群聊稳定后做一轮 |
| 渲染进程体积 | JS 约 1MB（未拆分），字体 18MB（按需加载） | 暂不处理，M5 打包前评估拆分 |
| 单一 `ELECTRON_RUN_AS_NODE` 环境变量 | IDE 终端会注入，导致 Electron 当成 Node 运行 | 脚本已规避；开发者文档（CONTRIBUTING）需补一句 |
