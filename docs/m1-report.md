# M1 存储地基交付记录

日期：2026-10-03

M1 已把桌面后台从“只流式回一句话”推进到可恢复的本地存储链路。SQLite连接只在Electron utilityProcess中打开，主进程通过带`requestId`的消息调用后台；渲染进程继续只通过受限preload IPC访问数据。

## 已交付

- `packages/store`：Node 24 `node:sqlite`存储包，首版迁移使用`PRAGMA user_version=1`，开启WAL、外键和忙等待。
- 数据表：`projects`、`sessions`、`runs`、`events`、`usage`、`revisions`，以及事件检索用的`event_fts`。
- 事件：项目内单调递增`seq`、`project_id + idempotency_key`幂等去重、事务写入；事件payload不携带API密钥。
- 投影：`projectChat(events)`是纯函数；在线事件和重启后的事件重放使用相同投影逻辑。
- 中文全文检索：写入和查询都把CJK字符逐字空格化，使用FTS5 phrase查询；“门槛”命中，“槛门”不命中。
- 受控写盘：限定链接文件夹、拒绝路径穿越和符号链接，先写同目录临时文件并`fsync`，再原子替换；每次写入保存快照和SHA-256。
- 撤销：读取父修订内容并再次写盘，产生新的revision，不回改旧行。
- 外部修改：`ExternalFileWatcher`轮询报告`previousHash/currentHash`，上层可追加`file.changed_externally`事件并交给冲突流程处理。
- 项目和会话：链接中文路径文件夹时创建`.wordhub/project.json`，SQLite放在`%APPDATA%/WordHub/projects/<projectId>/wordhub.sqlite`；后台维护最近项目索引，启动后恢复项目、会话和聊天事件。
- UI：链接文件夹、会话创建、运行消息和重启恢复已接到真实项目/会话/事件数据；正文编辑器仍按P1决定使用Markdown来源。

## 验证记录

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过（Biome） |
| `npm test` | 7项通过：幂等/seq、重开重放、中文FTS、投影、原子写盘/撤销、路径安全、符号链接、外部修改 |
| `npm run test:m1:store` | 通过，结果见`artifacts/m1-store-result.json` |
| `npm run build:desktop` | 通过 |
| `npm run test:desktop` | 通过 |

## 边界

本次没有把正文Markdown编辑器、评审/审批协调器和DOCX导出提前纳入M1；它们仍按`docs/p1-plan.md`进入后续里程碑。外部修改 watcher已经具备检测证据，但“自动合并/冲突解决”留给协调器与编辑器阶段。
