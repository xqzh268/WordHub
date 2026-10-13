# 文枢（WordHub）

一个本地优先的多Agent写作桌面应用。纲领、写手、编辑、评审和观察者围绕同一个项目协作，任务、工具调用、质询和用户裁决在群聊中可见；正文通过受控工具写入本地文件夹。

当前版本为`0.1.0-alpha.0`，优先支持Windows。当前交付聚焦小说的Markdown流程；科研论文与基金申请的证据、引用和Word/LaTeX流程属于后续路线。

## 当前能力与状态

| 阶段 | 当前状态 |
|---|---|
| M0–M2.1：桌面壳、存储、Agent工具与权限 | 已接入产品；历史验收与自动化记录见[文档索引](docs/README.md) |
| M3：工作流、质询、裁决与返工 | 裁决时序修复及确定性回归已落地；修复后的完整真实模型验收待重跑 |
| M4.1：纲领分层问答 | 表单卡、修改、跳过、重启续问、确认后写入五份设定文件已接入；产物为问答整理模板 |
| M4.2：固定顺序上下文 | 五层注入、预算裁剪、来源清单已接入；章节尾文与模型请求验收仍待补齐 |
| M4.3：确定性编辑检查 | 字数、AI腔词、对话占比、连续四字成语检查及事件提示已接入；当前提示不阻断工作流 |
| M4.4–M4.7 | 分类评审、待确认事实、定稿动作、空项目前三章真实回归尚待开发 |

当前可以链接中文路径的写作文件夹、创建会话、调用角色Agent、运行写手→编辑或评审流程、处理升级裁决，以及查看工具、用量和上下文来源。事件日志、运行快照和正文修订持久化到本地，支持已覆盖场景下的审批恢复和冲突保留。

详细实现范围和验收缺口见[M4进展](docs/m4-progress.md)。全量自动化通过不等于小说创作质量、跨章一致性或M4完整产品验收通过。

## 本地启动

建议使用Windows、Node.js24与npm；仓库声明的最低Node版本为22.19.0，CI使用24。依赖版本以`package-lock.json`为准。

在PowerShell中执行：

```powershell
git clone https://github.com/xqzh268/WordHub.git
cd WordHub
npm ci
npm run build:desktop
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run dev:desktop
```

`build:desktop`生成存储、运行时和桌面构建；`dev:desktop`启动开发窗口。当前仓库未提供正式安装包。

### 模拟模式

无需密钥，可检查项目链接、任务、工具调用、审批和正文显示：

```powershell
$env:WORDHUB_MOCK = "1"
npm run dev:desktop
```

模拟模式通过Pi faux provider运行工具链，输出固定测试正文；它不验证真实模型的判断力或创作质量。退出后恢复真实模式：

```powershell
Remove-Item Env:WORDHUB_MOCK -ErrorAction SilentlyContinue
```

`WORDHUB_DEMO=1`用于载入设计预览数据，与真实项目验收分开。

### 真实模型

在设置页保存DeepSeek密钥并测试连接，也可在启动应用的终端设置`DEEPSEEK_API_KEY`。应用使用Electron安全存储保存凭据；产品代码读取进程环境变量，不查询Windows用户/机器环境注册表。

默认写手为`deepseek-v4-pro/high`，评审为`deepseek-v4-pro/max`。设置页可调整各角色模型和思考强度。真实运行会产生模型费用；当前显示估算及实际用量，单次运行没有硬预算上限。

## 使用小说流程

1. 链接一个本地写作文件夹，创建或选择会话。
2. 输入“写一部唐代悬疑小说，主角是不良人”，进入纲领问答；补充主角、核心冲突和可选设定。
3. 检查回答并确认，系统才将五份问答整理文件写入`.wordhub/bible/`。当前仍需补充具体章节大纲和文风基准。
4. 输入“写第三章”，启动写手→编辑；输入“请评审第三章”，启动评审。包含“全流程”的章节请求会走写手→编辑→评审→返工模板。
5. 出现质询时查看线程与证据；两轮仍有分歧时，在裁决卡选择接受修改或保留原文。

`@写手`、`@编辑`、`@评审`等调用指定角色；`@all`启动全体咨询与纲领汇总。正文路径以项目内实际章节文件为准。

## 项目文件与存储

```text
写作文件夹/
├─ chapters/                    # Markdown正文
└─ .wordhub/
   ├─ project.json              # 项目标识
   └─ bible/
      ├─ outline.md             # 大纲
      ├─ characters.md          # 人物档案
      ├─ setting.md             # 设定词典
      ├─ style.md               # 文风基准
      └─ writing-plan.json      # 写作计划与问答
```

SQLite、事件、运行快照和正文版本保存在应用数据目录，Windows默认路径为`%APPDATA%\WordHub\projects\<projectId>`。它们与链接的写作文件夹分开保存；备份时需要同时保留两处数据。

写入范围由Agent权限和项目路径检查控制，拒绝目录穿越与符号链接访问。正文写入经过快照、哈希校验和原子替换；外部改动或并发冲突保留可追溯版本。存储层具备撤销API，界面的完整编辑、撤销和导出体验仍待后续交付。

## 验证

在仓库根目录执行：

```powershell
npm run validate:schema
npm run typecheck
npm run lint
npm test
npm run test:m2:faux
npm run test:m1:store
npm run build:desktop
npm run test:desktop
npm run test:layout
npm run test:m1:e2e
```

2026-10-13重新验证的结果见[M4验证记录](docs/m4-progress.md#验证记录)。桌面相关脚本依赖已构建的`out/`。

### 真实回归

以下命令需要终端中的`DEEPSEEK_API_KEY`，会调用真实模型：

```powershell
$env:WORDHUB_REQUIRE_LIVE = "1"
npm run test:m3:live
npm run test:m3:neutral
Remove-Item Env:WORDHUB_REQUIRE_LIVE -ErrorAction SilentlyContinue
```

`test:m3:live`检查质询、裁决、返工、章节文字和工作流终态；`test:m3:neutral`只给评审事实与评审意图，默认重复三次，度量检出率与误报率。未配置密钥时默认跳过；设置`WORDHUB_REQUIRE_LIVE=1`后会明确失败。应用内保存的密钥不会自动提供给这些脚本。

[常规CI](.github/workflows/ci.yml)在Windows运行确定性门禁；[中立评测夜间任务](.github/workflows/m3-neutral-nightly.yml)配置为北京时间每日02:30，由GitHub Actions调度，需要仓库Secret `DEEPSEEK_API_KEY`。[M3完整真实回归](.github/workflows/m3-live-manual.yml)保持手动触发。工作流文件已提供，远端运行结果须在Actions中另行确认。

## 仓库结构

| 目录 | 职责 |
|---|---|
| `apps/desktop/` | Electron主进程、preload、utilityProcess入口与React界面 |
| `packages/contracts/`、`schemas/` | 类型化IPC、领域类型与运行时契约 |
| `packages/store/` | SQLite、事件重放、版本、受控写盘与外部修改检测 |
| `packages/runtime/` | Agent、Pi执行、上下文、工具权限、任务协调、纲领问答与编辑检查 |
| `packages/novel/` | 小说角色配置与工作流模板 |
| `scripts/` | 桌面、恢复、faux与真实模型验证 |
| `examples/` | 契约样例与《长安夜》矛盾回归fixture |
| `docs/` | 计划、实现进展、历史验收、调研与ADR |

## 后续工作

下一阶段为M4.4分类评审，再接M4.5事实确认、M4.6定稿和M4.7空项目真实回归。首个真实题材沿用《长安夜》的唐代悬疑；当前样例只有少量回归文字，完整人物与情节设定需审阅确认后扩写。

References/Graph产品闭环、DOCX/TXT导出、完整正文编辑器和发行打包仍在计划中。技术spike与预览界面不代表这些功能已完成。

## 文档、贡献与许可

- [文档索引](docs/README.md)：从当前进展进入计划与历史验收。
- [领域词汇](CONTEXT.md)：项目、会话、运行、任务、事件、版本和正史。
- [贡献指南](CONTRIBUTING.md)：开发与提交门禁。
- [许可](LICENSE)：AGPL-3.0-only；贡献提交须遵循[CLA](CLA.md)。
