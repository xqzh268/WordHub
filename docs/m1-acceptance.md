# M1 验收结论

**日期：2026-10-03**　验收对象：提交 `56919f2`（[m1-report.md](m1-report.md) 所述交付）。

## 结论：有条件通过

存储地基扎实，重启恢复真实可用，报告列出的 7 条命令与测试我在干净安装后全部复现通过。但对照 [m1-plan.md](m1-plan.md) 的 6 条验收标准，**有 1 条未达成、2 条部分达成**，其中一个缺陷会导致用户的手改内容丢失。这些问题应在进入 M2 之前用一个 **M1.1 加固（约 3 天）** 修掉，详见 [m2-plan.md](m2-plan.md)。

## M1.1复核（2026-10-04）

本轮已完成并在本地工作树验证：

- 写入前对账磁盘哈希；外部版本先保存为`external`修订并追加`file.changed_externally`，默认拒绝覆盖，可选`keep-both`。
- `run.started`保存`agentId / agentVersion / model / reasoning`，用户事件保留原始输入和`mentions`；强杀后启动清扫`running`并投影为`interrupted`。
- 候选修订、临时文件、原子替换和启动对账覆盖替换前、替换后、提交前三个故障点。
- 投影测试使用`fast-check`运行1000组；`test:m1:e2e`真实Electron脚本当前11/11通过。

因此原报告中缺陷1、2、3、6、7、8、9、10、11、12已修复。仍保留两个边界：当前外部修改检测在受控写入前和显式watcher库中触发，尚未把watcher作为常驻产品服务；密钥扫描已覆盖safeStorage和mock路径，live密钥场景仍需在CI之外验证。M1.1以“有条件通过”进入M2，避免把这两个未覆盖边界写成已验收。

> 验收方独立复核（2026-10-04）：上述自评经实测基本属实，逐条结果见 [m2-acceptance.md §一](m2-acceptance.md)。

## 我做了什么

1. 干净 `npm ci` 后重跑：`validate:schema`、`typecheck`、`lint`、`test`、`test:m1:store`、`build:desktop`、`test:desktop`，全部通过。
2. 通读 `packages/store` 与 `apps/desktop/src/worker`、`main`。
3. 新写端到端脚本 [scripts/m1-restart-e2e.mjs](../scripts/m1-restart-e2e.mjs)：真实 Electron 应用，链接中文路径的项目、对话、`taskkill /F /T` 强杀整个进程树、重开，并直接读取 SQLite 核对。当前 9/11 通过，2 项失败即下文缺陷 1。
4. 用探针脚本实测了外部修改、运行中途被杀、写入性能和搜索噪声。

## 验收标准逐条核对

| # | 标准 | 结果 | 证据 |
|---|---|---|---|
| 1 | 链接中文路径文件夹 → 生成 `.wordhub/`，进入最近项目 | 达成 | E2E 通过；`project.json` 生成，SQLite 在应用数据目录而非写作文件夹 |
| 2 | 发消息、收到回复 → 强杀 → 重开 → 会话与消息完整、无重复 | **部分** | 事件日志 8 条、`seq` 连续、用户消息 1 条；重开后**无需操作**即自动恢复项目与聊天。但恢复后**回复者从“评审”变成“纲领”，用户消息丢了 `@评审`**；运行中途被杀的回复会**永远显示 streaming**（缺陷 2、3） |
| 3 | 投影清空后仅凭日志重建，与在线投影一致（属性测试） | **部分** | 投影确为纯函数且在线与重放同一份代码，但现有测试只是“把输入倒序后结果相同”（投影内部本就按 `seq` 排序，必然相等），不是在线增量 vs 重放的对比，也不是 `fc.assert` 属性测试（缺陷 6） |
| 4 | 写盘中强杀，文件要么旧要么新，不半写 | 达成（按构造），**无测试** | 临时文件 + `fsync` + 原子替换，代码正确；但没有任何故障注入测试。且“文件已替换、修订尚未入库”之间存在窗口（缺陷 7） |
| 5 | 外部程序修改稿件 → 生成 `file.changed_externally`，不被静默覆盖 | **未达成** | `ExternalFileWatcher` 只是库，没有任何地方使用它，也不产生该事件；更严重的是 Agent 写入会**静默覆盖**用户手改的内容，且手改版本不会出现在任何快照里（缺陷 1） |
| 6 | API key 不出现在事件、日志和数据库 | 基本达成，验证不足 | E2E 扫描了事件载荷，但只跑了 mock，没有 key 参与；未检查日志；无 live 场景测试 |

## 缺陷清单

按严重程度排序。均已用脚本复现。

| # | 严重度 | 缺陷 | 复现与证据 | 修复方向 |
|---|---|---|---|---|
| 1 | **高（丢数据）** | 外部修改被静默覆盖 | 应用写入第一版 → 用户在记事本里改文件 → Agent 写入第二版：磁盘最终内容是 Agent 版本，用户手改版本不在任何快照中，无事件、无提示。`writeText` 从不比较磁盘内容与当前修订的哈希 | 写入前比对磁盘哈希与当前修订：不一致时先把用户版本保存为一个修订并记 `file.changed_externally`，再按策略拒绝或降级为提案 |
| 2 | 中 | Agent 身份在重载后丢失 | E2E：`@评审` 的回复重开后显示“纲领”。原因：live 模式 `run.started` 里写死 `agentId:"writer"`；mock 模式不写，回退到 `actor.id`；渲染端发送的是去掉 `@` 的文本 | 事件里记录 `agentId / model / reasoning` 与原始输入（含 mentions），投影只读事件 |
| 3 | 中 | 中途被杀的运行永远是 streaming | 探针：仅有 `run.started` 与 `run.text_delta` 的日志，投影结果 `streaming`；`runs` 表里该行也一直是 `running` | 后台启动时清扫未终止的运行，追加 `run.interrupted` 并更新 `runs`；投影与界面增加“已中断”状态 |
| 4 | 中 | 测试污染真实用户数据 | `test:desktop`、截图脚本每次都向 `%APPDATA%\Electron\projects\ephemeral` 追加数据；我清理时里面是同一句测试文案累计 5 次 | **已修**：三个脚本都改用 `--user-data-dir` 临时目录；已清理残留 |
| 5 | 中 | 数据目录名是 `Electron` | 主进程用 `app.getPath("userData")`，未设置应用名，开发期落在 `%APPDATA%\Electron`，会与本机其他 Electron 开发应用共用；报告和计划里写的 `%APPDATA%/WordHub` 与实际不符 | `app.setName("WordHub")`（打包后用 `productName`），更正文档 |
| 6 | 低 | 投影测试名不副实 | 见上表第 3 条 | 投影改为 `applyEvent(state,event)` 的折叠；`fc.assert` 生成多 run 交错的事件序列，对比“增量应用”“全量重放”“落库后读回再投影”三者 |
| 7 | 低 | 写盘与入库之间有窗口 | 顺序：写快照 → 写临时文件 → 替换目标 → 写修订。在“替换”与“写修订”之间崩溃，文件已变而无修订记录 | 先写 `pending` 修订，替换后转 `current`；启动时按哈希对账 |
| 8 | 低 | 全文检索有噪声 | 索引的是 `JSON.stringify(payload)`，搜 `delta`（JSON 键名）命中 2001 条；逐 token 事件各占一行 | 只索引文本字段；检索只覆盖用户消息、最终回复与修订 |
| 9 | 低 | 快照目录名把中文全替换成下划线 | `file:第一章.md` 与 `file:第二章.md` 都变成 `file____.md`，不同章节快照混在同一目录（功能上不出错，因为文件名带修订 ID） | 目录用 artifactId 的哈希 |
| 10 | 低 | `appendEvent` 允许调用方指定 `seq` | `seq: input.seq ?? nextSeq`，破坏“单调递增”保证 | 移除该入参 |
| 11 | 低 | “迁移”只是 `IF NOT EXISTS` | 只有 `user_version=1` 的占位，没有迁移执行器，下次改表无路可走 | 建迁移列表与执行器，并测试从 v0 升级 |
| 12 | 低 | `project.json` 写了但从不读 | 链接已有项目时按注册表（`projects.json`）判断，注册表丢失就会新建项目、遗弃旧库；路径比较区分大小写（`D:\` 与 `d:\` 会重复建项目） | 链接时优先读 `project.json` 复用 `projectId`；路径比较规范化 |
| 13 | 低 | 工程卫生 | `lint` 只覆盖 `packages/store/src`；`worker/index.ts` 196 行里有多行超过 300 字符，几乎不可读 | M2 拆分到 `packages/runtime`，Biome 覆盖全仓库 |

## 报告与事实的出入

- “SQLite 放在 `%APPDATA%/WordHub/projects/<projectId>/`”：实际是 `app.getPath("userData")`（开发期 `%APPDATA%\Electron`），见缺陷 5。
- “投影重放一致性”：见缺陷 6，测试强度低于描述。
- “外部修改 watcher 已具备检测证据”：库有，产品里没接线，且写入路径不检查，见缺陷 1。
- “迁移”：见缺陷 11。

## 实测确认没问题的部分

- **重启恢复**：强杀整个进程树后，事件日志完整、`seq` 连续、无重复；重开后项目与聊天自动恢复。
- **写盘安全**：路径穿越、`.wordhub` 保护、符号链接与 Windows junction 均被拒绝。
- **中文检索**：“门槛”命中、“槛门”不命中，符合设计。
- **幂等与顺序**：同一幂等键不产生新行，`seq` 严格递增。
- **性能**：每条事件一个事务（含全文索引行），2000 条 delta 共 1.76 秒，即 **0.88 ms/条**，不构成瓶颈，我此前担心的逐 token 写入成本不成立。
- **隔离**：渲染进程不接触数据库与密钥；SQLite 单写者在后台进程。

## 本次改动

- 新增 [scripts/m1-restart-e2e.mjs](../scripts/m1-restart-e2e.mjs) 与 `npm run test:m1:e2e`（暂不进 CI，缺陷 2 修复后纳入）。
- `store.test.ts` 新增两个 `it.fails`（缺陷 1、3）：CI 保持绿，修复后会变红，提示改回 `it`。
- 三个启动 Electron 的脚本改用临时 `--user-data-dir`。
