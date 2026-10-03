# 文枢（WordHub）调研总览

**日期：2026-10-03**　本文汇总全部调研，给出统一结论、对早期文档的审阅勘误，以及待决策事项。各专题细节见文末索引；**冲突处以本文为准**。

---

## 一、产品一句话

一个**本地优先**的桌面写作工作室：一组可见、可@、可质询的角色Agent，围绕**有来源的项目事实**（设定集/事实表/论断台账/图谱）协作完成科研论文、基金申请书与小说，用户始终握有大纲与正史的最终决定权。

**核心差异化**（竞品调研结论，见 [domain-and-competitors.md](domain-and-competitors.md)）：
1. **显式角色流水线 + 证据闭环评审**：市面上没有"纲领→写手→编辑→评审→观察者"的可见流水线；幻觉防控在竞品中都是单点功能。
2. **图谱即事实底座**：观察者自动抽取 → 作者确认 → 评审用图谱做硬校验（竞品的设定库都靠手动维护）。
3. **可采访的图谱 + 推演**：节点扮演带知识边界（防剧透），推演产物永不自动并入正史。
4. **中文学术本土化**：NSFC 2026 新版模板、**AI使用台账**（自动生成申请书第（四）部分第5条披露）、GB/T 7714、国产模型。
5. **纸感设计**：区别于"工具感"的AI写作产品。

---

## 二、对早期三份文档的审阅

[agent-runtime.md](agent-runtime.md)、[documents-references.md](documents-references.md)、[wordhub-research-plan.md](wordhub-research-plan.md) 整体判断扎实：协调器+DAG+有界质询、append-only 事件日志、Agent只提交patch、revision受控合并、锚点用 W3C TextQuoteSelector、兼容性分级A/B/C、"先闭环后装饰"——**这些结论全部保留**。

### 需要修正的事项

| # | 问题 | 原文 | 修正 |
|---|---|---|---|
| 1 | pi-durable 定位过轻 | "实验包，首版不依赖" | 已发布1.0.0但仍标Experimental；能力（持久日志/任务图/子agent/崩溃恢复）与自建方案大面积重叠 → **自建SQLite事件日志但数据模型对齐其 Entry/Commit/Task 概念**，并行spike直接采用 |
| 2 | Pi 版本/环境未锁定 | — | 锁 `@earendil-works/*@1.0.0`，**Node ≥22.19**；pi-ai 新API为 `createModels()`；旧 `@mariozechner/*` 已弃用 |
| 3 | 桌面壳未论证 | 默认Electron | 论证后仍选 **Electron**（Node 24 内置、utilityProcess、子进程调度一致；Tauri需Node sidecar） |
| 4 | 正文真相源不一致 | 一处"Markdown/ProseMirror JSON"，一处"Markdown作内部交换基线" | **Word类文档以 DOCX(OOXML) 为真相源**（若采用SuperDoc）或 ProseMirror JSON（若采用Tiptap）；**LaTeX以 .tex 源码为真相源**；Markdown 仅作Agent上下文的投影格式 |
| 5 | DOCX编辑器选型过时 | Tiptap + Conversion 为P0 | Tiptap DOCX **导入走云端**、分页仍Beta；**SuperDoc**（直接编辑OOXML、真分页、修订批注）保真更高但AGPL/商业双许可 → 取决于开源决策（见§五） |
| 6 | MOBI 结论矛盾 | 一处"Calibre受控解析"，一处"暂缓" | **foliate-js（MIT）原生支持无DRM的 EPUB/MOBI/AZW3** → 可进P1，无需Calibre |
| 7 | Zotero 优先级矛盾 | 一处P0只读导入，一处"后续适配器" | P0：BibTeX/RIS/CSL-JSON/DOI导入；P1：Zotero 8 Local API + MCP |
| 8 | 图谱库路线 | "首版React Flow，后续Cytoscape" | **按视图分工**：React Flow+elkjs（结构化视图、小图）+ Sigma.js（大网络），graphology 统一数据层；Cytoscape不是必经升级路线 |
| 9 | 图谱时间模型不足 | `valid_from/to` | 增加 **`revealed_at`**（叙事揭示点，防剧透）、**时效性别名**、**认知边 `knows(角色,事实,since)`** |
| 10 | LaTeX浏览器端方案 | 未提 | SwiftLaTeX 依赖的服务器**已不可用**；坚持本地 Tectonic + 可选 TeX Live |
| 11 | NSFC 模板 | 未覆盖 | 2026版正文改为**三部分**、≤30页、要求AI使用说明；旧六段式已停用；模板做成可更新配置 |
| 12 | 中文场景缺失 | — | GB/T 7714-2015 CSL、ctex/xeCJK、GB18030 TXT解码、知网导出格式（RIS/EndNote/NoteExpress）、国产模型（pi-ai 已支持 DeepSeek/Kimi/Qwen/MiniMax） |

### 需要补齐的空白（本轮已补）

- UI/UX 设计体系 → [ui-ux-design.md](ui-ux-design.md)
- @机制、质询/提问协议、对话记录查阅、自建Agent格式、分层记忆 → [multi-agent-orchestration.md](multi-agent-orchestration.md)
- 科研概念图谱设想、节点扮演、推演机制、抽取流水线 → [graph-design.md](graph-design.md)
- 纲领提问流程（小说/论文/基金）、竞品、学术依据 → [domain-and-competitors.md](domain-and-competitors.md)

### 一处保留意见

早期计划主张"先做无视觉完成度的 vertical slice，再投入高质感界面"。闭环优先是对的，但**纸感是本产品的核心体验**，建议设计 token、字体与基础组件**从第一天就建立**（成本很低），只把复杂动效与大图谱放后。

---

## 三、整合后的技术选型

| 层 | 选型 | 备注 |
|---|---|---|
| 桌面壳 | **Electron**（≥44，Node 24） | 主进程 / 渲染进程 / utilityProcess(编排worker) |
| Agent执行层 | **Pi agent-core + pi-ai 1.0** | adapter隔离；`beforeToolCall` 权限，`transformContext` 记忆注入，`steer/followUp` 插话 |
| 模型 | pi-ai provider；用户自配 key/模型/思考强度，每Agent独立；开发期 **DeepSeek V4**（`deepseek-v4-pro` / `deepseek-flash`） | 已实测流式与计费 |
| 编排 | 自建协调器：代码优先selector + DAG + 有界质询 | 群聊是事件日志的视图 |
| 持久化 | SQLite（`node:sqlite`，WAL）+ FTS5 + sqlite-vec | 模型对齐 pi-durable；项目文件夹内 `.wordhub/` 存可读的设定、Agent定义 |
| 前端 | React 19.3 + TypeScript + shadcn/ui(Base UI) + Zustand + TanStack Query/Virtual + cmdk + react-resizable-panels | |
| 动效 | Motion + React ViewTransition | |
| Word文档 | **SuperDoc 社区版**（AGPL，已定开源） | WPS旧格式经 LibreOffice 导入转换 |
| LaTeX | CodeMirror 6 + `codemirror-lang-latex`（AGPL）+ **Tectonic** / TeX Live + SyncTeX | KaTeX 公式；P4 |
| 许可 | **AGPL-3.0 + CLA** | 保留日后双许可空间 |
| PDF | **EmbedPDF**（备选 PDF.js + react-pdf-highlighter-extended） | 锚点：W3C TextQuote + 页坐标 |
| 电子书 | **foliate-js**（EPUB/MOBI/AZW3/FB2） | TXT GB18030；DOCX经mammoth |
| 引用 | citation-js + CSL（GB/T 7714、APA、IEEE…）、Crossref/OpenAlex(需key)、Zotero 8 | citeproc-js 许可待验 |
| 图谱 | graphology + React Flow/elkjs（+ Sigma.js） | 时间滑块按 `revealed_at` 过滤 |
| 字体 | Inter + Noto Sans SC（UI）、Source Serif 4 + Noto Serif SC（学术）、Newsreader + 霞鹜文楷 Screen（文艺）、Fraunces（标题）、JetBrains Mono + 更纱 | cn-font-split 分片 |

---

## 四、架构总图

```text
┌──────────────────────────── Electron 渲染进程（React，无密钥、无直接文件写） ───────────────────────────┐
│ 侧栏：Workspace │ References │ Graph │ Settings                                                    │
│ Workspace = Session栏 + 群聊(事件流视图) + 文档工作台(SuperDoc | CodeMirror+PDF预览)                     │
│ References = 项目→文献/文件→sessions 树 + 阅读器(EmbedPDF/foliate) + 选段提问/引用插入                  │
│ Graph = React Flow / Sigma 视图 + 时间滑块 + 节点采访 + 推演分支树                                       │
└───────────────▲──────────────────────────── IPC（类型化、事件订阅） ──────────────────────────────────┘
                │
┌───────────────┴──── 主进程：窗口、项目文件夹授权、路径白名单、密钥保管(safeStorage)、worker生命周期 ────┐
└───────────────▲──────────────────────────────────────────────────────────────────────────────────────┘
                │ MessagePort
┌───────────────┴──────────────── utilityProcess：编排 worker ────────────────────────────────────────┐
│ 协调器(状态机/DAG/selector/质询计数/审批)                                                          │
│   ├─ 角色Agent × N（Pi Agent 实例，配置来自 AGENT.md）                                              │
│   ├─ 工具层：doc.read/propose_patch、history.search/get、memory.*、claims.*、graph.*、refs.*        │
│   └─ 外部进程：Tectonic / LibreOffice / Pandoc（超时、取消、日志）                                  │
│ 存储：项目 SQLite（事件日志、revision、事实表、claims、图谱、索引） + 链接文件夹（正文、.wordhub/）    │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**领域模型**：`Project`（链接文件夹 + 共享记忆）→ `Session`（多个，共享项目记忆、会话记录隔离）→ `Run`（可恢复工作流）→ `Task`（DAG节点）→ `Event`（append-only）→ `Artifact/Revision`（正文、大纲、图谱、报告；按Agent写权限：`propose` 提交候选待批准，`write` 经协调器串行化后直接生效；每次写入都是可撤销的 revision）。

---

## 五、已定决策（2026-10-03）

| # | 问题 | 决定 | 落地影响 |
|---|---|---|---|
| 1 | 开源/闭源 | **暂定开源**，积累用户后再考虑商业化 | 可直接采用 **SuperDoc 社区版**（AGPL）与 `codemirror-lang-latex`（AGPL）。分发时整体须满足 AGPL → **WordHub 采用 AGPL-3.0**。【议】为保留日后"开源+商业授权"双许可的空间，从第一个外部PR起就要求贡献者签 **CLA**（SuperDoc 自身即此模式）；否则日后改许可需征得全部贡献者同意。MiroFish 等 AGPL 项目也可借鉴代码，但仍需标注来源 |
| 2 | 模型 | 用 **pi-ai provider 能力**；用户自配 API key、模型列表与思考强度；**每个Agent可独立配置模型**；开发测试用 **DeepSeek V4**（`DEEPSEEK_API_KEY`） | 已实测通过，详见 [multi-agent-orchestration.md §7](multi-agent-orchestration.md#7-模型与思考强度配置) |
| 3 | 成本姿态 | **默认"单写手 + 按需评审"**，全员流水线为显式选项；每次 Run 前展示预估费用 | 协调器需有"预算/预估"步骤；pi-ai 返回逐次 usage 与 cost，可直接累计 |
| 4 | 首个Demo | **小说先行** | 路线调整见§六：小说 References（EPUB/TXT/DOCX）、观察者人物图谱提前；科研/NSFC 后移 |
| 5 | 自建Agent权限 | **可以写正文** | 写权限分三级 `none / propose / write`（见 [multi-agent-orchestration.md §3.4](multi-agent-orchestration.md#34-写入权限分级)）；直接写入仍以 revision 落盘、可一键撤销，由协调器串行化防冲突 |

---

## 六、修订后的路线

按"小说先行"调整：

| 阶段 | 产出 | 门槛 |
|---|---|---|
| **P0 契约与Spike**（2–3周） | 领域schema（Event/Task/Revision/Graph/Fact）、AGENT.md 格式、模型配置schema、设计token与字体管线；Spike：Pi agent-core + DeepSeek V4 在 utilityProcess 流式运行（中文路径/取消/崩溃恢复）、SuperDoc 加载/编辑/导出中文DOCX、foliate-js 读 EPUB/MOBI、pi-durable 试用 | 每个spike有实测报告；任何一项失败先缩范围 |
| **P1 小说核心闭环** | 协调器 + 五角色 + 事件日志 + 质询/提问（≤2轮）+ 写权限分级与撤销；项目/Session/链接文件夹；分层记忆L0–L3；纲领小说问答（借鉴 chinese-novelist-skill）；群聊视图（印章头像、工作流时间线）；Settings：provider/模型/思考强度/每Agent配置；Run 前费用预估 | **小说Demo**：问答→大纲+人物档案→写1章→编辑→评审（ConStory清单）→用户确认写入；中断可续；所有写入可撤销 |
| **P2 小说 References + Graph** | 参考小说导入（EPUB/MOBI/TXT/DOCX/PDF）与阅读、选段提问、文风学习（基准段落）；观察者抽取流水线（花名册→逐块→合并→审核）；人物关系图（React Flow，时间滑块按 `revealed_at`）；节点采访（三层知识边界）；评审用事实表做硬校验 | 防剧透测试通过；抽取前成本预估与实测误差可接受 |
| **P3 推演 + 打磨** | 快速推演、分支树与回写大纲；DOCX/TXT/EPUB 导出；纸感动效完善；Agent 导入导出 | 推演永不污染正史；首个可公开发布的开源版本 |
| **P4 科研/基金** | LaTeX 工作台（Tectonic + SyncTeX）；文献库（BibTeX/RIS/DOI/GB/T 7714）、PDF阅读与引文核对；论断台账、研究主线图/论证图；NSFC 2026 模板与 AI 使用台账；Zotero 8/MCP；文献地图 | 科研Demo跑通；每条主张可反查证据 |

---

## 七、文档索引

| 文档 | 内容 |
|---|---|
| [multi-agent-orchestration.md](multi-agent-orchestration.md) | Pi核查与勘误、底座对比、组织模式、@机制、质询协议、对话记录查阅、AGENT.md格式、分层记忆、桌面壳 |
| [graph-design.md](graph-design.md) | 图谱数据模型、长文本抽取流水线与成本、科研图谱视图、节点扮演、推演设计、可视化库对比 |
| [ui-ux-design.md](ui-ux-design.md) | Claude风格拆解、字体与许可、纸感色板/纹理/材质、动效、组件栈、文档工作台与阅读器选型、token、线框 |
| [domain-and-competitors.md](domain-and-competitors.md) | chinese-novelist-skill深读、纲领提问流程（小说/论文/NSFC 2026）、竞品、学术依据 |
| [agent-runtime.md](agent-runtime.md) | （早期）Pi/LangGraph初步核查——部分结论已被修正，见§二 |
| [documents-references.md](documents-references.md) | （早期）文档格式、LaTeX、PDF、引用、验证样本——仍有效，选型部分见§二修正 |
| [wordhub-research-plan.md](wordhub-research-plan.md) | （早期）实施计划——路线已在§六修订 |

**证据说明**：专题文档中的事实由调研子任务通过官方文档、npm registry、GitHub API、arXiv 核查，标注了【实】/【二手】/【议】；我未逐条复核全部链接。所有性能、成本、兼容性数字均需在 P0 spike 中实测。
