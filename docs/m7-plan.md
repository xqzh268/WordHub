# M7 学术写作：范围与计划

更新日期：2026-11-22。依据：[research/domain-and-competitors.md](research/domain-and-competitors.md)、[research/documents-references.md](research/documents-references.md)、[M6计划](m6-plan.md)，以及对 [Papilot](https://github.com/PapilotAI/papilot) 和 [瀚海文助（USTC LaTeX 学术写作助手）](https://latex.ustc.edu.cn/hhwz/index.html) 的对照。

## 已定（2026-11-20，不再讨论）

- **场景**：做全场景学术写作，覆盖中文学位论文、发明专利申请、英文期刊/会议论文和基金申请书，不只做其中一种。
- **TeX 环境**：应用自行下载 Tectonic，装好就能用，不要求用户安装 TeX Live。用户本机已有 TeX Live 或 MiKTeX 的，可以在设置里改用本机引擎（例如投稿模板必须用 biber 的情况）。
- **Overleaf 同步**：放到最后做。前期只支持导入和导出 zip。
- **顺序**：M7.0 → M7.1 → M7.2 → M7.3 → M7.4 → M7.5 → M7.6 → M7.7，见下文。
- 原有约束照旧：本地优先；正文只能经受控写入落盘；只有用户确认过的事实和证据才能作为依据；每个阶段都要过单测、Electron e2e（含版面断言）和真实 deepseek-flash 验证，推送后看 CI，文档里如实写明未验证的部分。

## 两条交付轨道

不同场景最终交付的文件格式不同，不能全部用 LaTeX：

| 场景 | 真相源 | 交付 | 说明 |
|---|---|---|---|
| 中文学位论文 | `.tex` | PDF | 学校模板（先做 ustcthesis），XeLaTeX 加 ctex |
| 英文期刊/会议 | `.tex` | PDF + 源码 zip | IEEE、ACM、Elsevier、Springer、LNCS 等官方模板 |
| 发明专利申请 | 结构化 Markdown（与小说纸面同一套） | DOCX 和 PDF | 专利局提交的是 Word 或 PDF 文件。文本结构固定：权利要求书、说明书（技术领域、背景技术、发明内容、附图说明、具体实施方式）、摘要。段落编号为 [0001]，正文基本是纯文本，现有纸面加 DOCX 导出就能满足 |
| 基金申请书（NSFC 等） | 结构化 Markdown；LaTeX 作为可选 | DOCX；可选 PDF | 基金委信息系统使用 Word 模板。2026 版正文分为立项依据、研究内容、研究基础三部分，原则上不超过 30 页 |

因此 M7 分两条轨道：**LaTeX 轨道**（M7.1–M7.3、M7.7）和**结构化文档轨道**（复用 M5 纸面和 DOCX 导出，在 M7.6 补上专利和基金的模板）。文献（M7.4）和角色包（M7.5）两条轨道共用。

## 对照两个参考项目

| 来源 | 借鉴什么 | 落在哪个阶段 |
|---|---|---|
| Papilot（MIT） | 用 SyncTeX 把 PDF 位置映射到源码行；改动在 PDF 上前后对照，逐处接受或拒绝；每个任务隔离运行，接受后才写入；模板库按会议对应到模板 | M7.1、M7.3、M7.6、M7.7 |
| 瀚海文助（许可证不明，只借鉴思路，不用代码） | 续写一次给三种风格；改写时保留 LaTeX 命令和公式；把编译日志和源码一起交给模型，返回带置信度的“查找→替换”，勾选后批量写回；英文语法逐处对比；按学科设写作规范；自定义动作带 `{{selection}}`、`{{before[-500:]}}` 这类占位符；快捷键 | M7.2、M7.3 |
| 文枢已有的能力 | 证据锚点、用户确认的事实、评审质询和裁决、不带路的评测、参考库、图谱 | M7.4、M7.5 |

**差异化**：两个参考项目都是“编辑器加 AI 动作”，都没有处理内容是否可信。文枢要做的是**引用真实性核查**（每个 `\cite` 都必须在参考库里，主张能对到原文）、**论断台账**、**术语和符号一致性**、**模拟同行评审**，同时支持中文学位论文、专利、NSFC 和 GB/T 7714。

## 阶段

### M7.0 解耦与补债（前置）

项目类型已接入新建、链接和启动恢复。小说与学术项目分别保存为 `novel` 和 `academic`，旧描述符与旧数据库默认按小说读取。学术占位工作区可以切换项目和进入设置，小说运行入口会拒绝在学术项目中启动。`npm run test:project-kind:e2e` 覆盖类型选择、两次重启、跨类型切换和旧项目打开。

- **领域包**：小说的[项目类型声明](../packages/novel/src/project-type.ts)集中定义文档单元、Markdown 真相源、上下文层与预算、角色与工作流资源、评审清单及导出格式。角色与工作流仍可从调用方指定的工作区加载；各次运行独立读取工作流。质询工具和聊天卡片共用评审分类，导出菜单沿用 Word、UTF-8 文本、GB18030 文本的顺序。
- 领域包验收（2026-11-21）：510 项单测及 13 组 Electron 回归通过。Windows x64 解包版在仓库外启动，加载五个角色并完成模拟评审，另验证显式资源目录覆盖；可用 `node scripts/packaged-resources-e2e.mjs <WordHub.exe>` 复跑。真实 deepseek-flash 自建角色验收首轮因连接错误得到 9/12，整套重跑 12/12。
- 章节目录、规范文件名、旧稿章号识别、排序和可编辑路径已迁入 `@wordhub/novel`，由运行时和桌面共用。新章沿用中文规范名；聊天定位和导出沿用磁盘上的原文件名。列表可读 Markdown 和 TXT，纸面编辑限章节目录下的一级 Markdown 文件。
- 章节迁移本地验收（2026-11-20）：508 项单测及 13 组 Electron 回归通过，其中章节 13/13、纸面编辑 15/15、导出 15/15。已逐一对照重构前第 1 至 9999 章的规范文件名。上述 Electron 回归使用模拟模型。另以系统级密钥运行真实模型纸面验收（test:paper:live），4/4 通过：首次编辑保存、修订归属、写手读取作者改稿，以及只读提问保持正文完整。
- 已拆分渲染端的 ProviderSettings 与 Chat。服务商设置按列表、编辑表单和模型选择拆分；聊天区按消息类型和交互卡片拆分。2026-11-20 本地通过类型检查、桌面构建、501 项单测，以及 Electron 启动、版面和服务商设置回归。本次未运行真实模型验收。
- 2026-11-22 真实 DeepSeek Flash 验收通过。[M3](m3-progress.md) 四个场景全部完成。[M4](m4-progress.md) 修后全流程 20/20，第四章在同一条质询中引用第三、四章原文，识别老周死亡后的再次出场。M4.2 已核对真实上下文快照。M4.7 历史失败缺少原始错误事件，具体根因仍无法确认。
- **单次运行预算**已接入项目设置，默认无上限。用户按美元设置正数或关闭，从下一次新运行生效。对话、写作子任务、回退以及审批恢复共用该次运行的预留记录；纲领草稿经同一限额调用，额度不足时仍可使用本地模板。用量缺失时保留预留。图谱采访、推演、服务商连接测试有独立入口。
- 预算验收（2026-11-21）：520 项单测通过；原有 13 组 Electron 回归及新增预算专项通过。预算专项 6/6，含绕过界面估算的直接启动、工作流、模板回退、重启、放宽和清空。最终构建以 `npm run test:paper:live -- --with-budget` 验证真实 DeepSeek 模型，5/5 通过，包含预算预留与用量结算。该用例的 2 美元仅为临时项目测试上限。
- **验收**：小说的全部 e2e 回归通过，行为不变；新建项目时可以选择项目类型（这一阶段学术类型只有占位）。

### M7.1 LaTeX 工作台

- 打开含 `main.tex` 的文件夹，或从 zip 导入（Overleaf 导出的项目可直接导入）。左侧文件树，CodeMirror 6 源码编辑，保存沿用哈希基线和 revision。
- **Tectonic 管理**：首次使用时下载与平台匹配的二进制，校验哈希，显示进度，可取消。宏包 bundle 按需下载并缓存在应用数据目录。设置页显示引擎版本和缓存大小，可清理缓存，也可切换到本机 TeX Live 或 MiKTeX。
- **编译 worker**：独立进程，设超时；禁用 shell-escape；只允许读写项目目录和缓存目录；输出 SyncTeX。日志解析成问题列表（文件、行号、错误类型），点击可跳到源码。
- PDF.js 预览；SyncTeX 双向跳转（源码 → PDF，PDF → 源码）。
- **验收**：ctex 中文、数学、图表、交叉引用、BibTeX 参考文献、ustcthesis 和 IEEEtran 样例都能在全新机器上冷启动编译成功；记录冷编译和热编译的 P50/P95 耗时；断网时已缓存的项目照样能编译。

### M7.2 选区快捷动作（单次调用，不走多 Agent）

- 续写（三种风格）、改写（更正式、精简、扩写）、中英互译、英文语法逐处对比、按指令生成表格或公式。共同约束：保留 LaTeX 命令、`\cite`、`\ref` 和数学环境；思考内容不写进文档；改动以对比形式呈现，确认后才写入。
- **自定义动作**：名称、图标、提示词，支持 `{{selection}}`、`{{before}}`、`{{after}}` 和切片写法，保存在项目里（`.wordhub/actions/`），可绑定快捷键。
- 学科写作规范：通用、理工、医学、人文社科，可以自定义。
- 两条轨道都能用（纸面上也有选区动作）。
- **验收**：真实模型下改写后保留命令和公式的比例（需要一个专门的样本集）、改写后仍能编译的比例；快捷键全程可用。

### M7.3 Agent 修改 LaTeX

- 面向 tex 的工具：按 section 或 label 读取；修改以补丁提案的形式给出；**编译通过才算完成**（编译失败时把日志交给 Agent 返工，次数有上限）。
- **编译错误修复**：日志加相关源码交给模型，输出带置信度和说明的“查找→替换”列表，勾选后批量应用。
- 审阅：先做源码 diff，再做 PDF 前后对照（编译两个版本，按页比较，用 SyncTeX 定位改动的区域）。
- **验收**：在一组预埋了常见错误（括号不匹配、未定义命令、缺宏包、中文字体）的样本上统计修复成功率；Agent 改动后的编译通过率。

### M7.4 文献

- 导入和导出 BibTeX、RIS、CSL-JSON，并入现有书架。用户同意联网后，按 DOI 或 ISBN 从 Crossref 补全元数据，只发送标识符。
- 插入 `\cite`，引用键保持稳定；检查悬空或未使用的 key；GB/T 7714 用 `gbt7714` 宏包（BibTeX 方式，不依赖 biber）。
- **引用真实性核查**：每个 `\cite` 都必须在库里；带引用的主张能对到库内原文的锚点，对不上就标为 `unverified`；按 DOI 查撤稿状态（联网需用户同意）。
- PDF 原样阅读（按页渲染、页码锚点、高亮），即原计划 M6.3 的内容。
- Zotero 只读接入放在本阶段末尾，做不完可以顺延。
- **验收**：引用渲染 100% 没有悬空 key；预埋的虚假引用被检出。

### M7.5 学术角色包

- **纲领**：按场景分层问答。学位论文和期刊问研究问题、贡献和证据边界，产出 IMRaD 或章节大纲（每节写明要点、证据和引用）。专利问技术问题、技术方案、有益效果和实施例，产出权利要求的层级。基金问科学问题、研究内容和研究基础。
- **写手**和**编辑**：编辑只负责语言、格式、术语和引用格式，和评审的职责分开。
- **评审**：维护论断台账（主张 ID、支撑来源、核验状态）；模拟同行评审，按创新性、方法、证据和表达分类给意见。专利评审检查权利要求是否得到说明书支持、术语是否前后一致、引用关系是否正确。基金评审检查三部分逻辑是否一致、篇幅是否超限。
- **史官**（学术场景改为“记录员”）：维护术语与符号表和概念图谱（研究问题、概念、方法、数据、结果、引用），复用 M6.2 的图谱投影。
- **评测**（沿用不带路的做法）：预埋无证据主张、虚假引用、符号前后不一、权利要求缺少说明书支持等问题，统计检出率和误报率。

### M7.6 模板

- 先做少量但覆盖每个场景：ctex 通用文章、ustcthesis、IEEEtran、Elsevier（elsarticle）、Springer（LNCS）、NSFC 正文（DOCX 轨道）、发明专利五份文件（DOCX 轨道）。
- 模板元数据：引擎、参考文献工具（bibtex 或 biber）、Tectonic 兼容性（实测结果），以及对应的角色包配置。
- **验收**：每个模板在 Tectonic 下实测编译；需要 biber 的模板标明“需本机 TeX”；DOCX 模板导出后在 Word 和 WPS 中打开均版式正确。

### M7.7 在 PDF 上批注

- 在 PDF 上选中句子，或框选公式和图表，写下修改要求；通过 SyncTeX 定位到源码行，交给 Agent；结果用 M7.3 的审阅流程呈现。
- 在 M7.1 的 SyncTeX 稳定之后再做。

### 以后

Overleaf 同步（git bridge 或 zip）、Zotero 写回、Word 模式编辑器（SuperDoc，用于复杂的基金和办公材料）、OCR。

## M7.1 之前要做的 spike（限时 1 天）

| 项目 | Spike 结论 |
|---|---|
| bundle 下载 | Windows 首次编译和缓存离线重编已通过；国内其他地区的下载速度和失败率待测 |
| 中文字体 | Windows x64 Fandol 已编译并渲染检查；macOS 和字体覆盖待测 |
| BibTeX 与 biber | 通用 ctex 样例以 GB/T 7714—2025 样式使用 BibTeX 通过；biber 未找到可执行程序。ustcthesis 在更早的 LaTeX3 初始化处失败 |
| 二进制 | 0.17.0 三个平台资产的下载体积和 SHA-256 已核对；macOS 只做了静态检查，Gatekeeper 与实机编译待测 |
| SyncTeX | Node 探针在两页、多源样例中验证正向、反向和往返定位 |

已通过的通用 ctex、BibTeX 和 SyncTeX 项可进入 M7.1 基础工作台；下文列出的模板和平台缺口保留为明确兼容边界。

### 2026-11-22 发布包核查

下表记录 Tectonic 0.17.0 官方发布包的实际下载结果。三个包的本地 SHA-256 均与 GitHub Release API 返回的摘要吻合。计时来自同一台 Windows 机器的现有网络代理，每个平台取一次。[官方发布](https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0)

| 发布包 | 压缩字节数 | 下载耗时 | SHA-256 |
|---|---:|---:|---|
| Windows x64 MSVC | 21,060,223 | 8.59 秒 | `f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f` |
| macOS arm64 | 21,704,674 | 10.30 秒 | `a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667` |
| macOS x64 | 21,790,177 | 11.01 秒 | `7c90ef5b6ddb1eb1937e4337add5237b79338e4b9676459fa91187d24d6cdf80` |

Windows 包中只有 `tectonic.exe`，已在本机启动，Authenticode 检查为 `NotSigned`。arm64 Mach-O 带 ad-hoc 签名，x64 Mach-O 无代码签名。引擎管理应将版本和经过复核的摘要一起固定。macOS 两个包均在 Windows 上检查，Gatekeeper、中文字体和编译仍需相应架构的 macOS 验收。

本机访问官方 [v33 bundle 入口](https://relay.fullyjustified.net/default_bundle_v33.tar) 时重定向到 `data1b.fullyjustified.net/tlextras-2022.0r0.tar`。远端归档为 2,881,562,112 字节，引擎按需取文件。经代理完整下载压缩索引为 1,276,215 字节，耗时 2.50 秒。绕过本机显式代理后，分别对入口及 data1b 索引取前 1 KiB，各 3/3 成功。另一个 data1 主机的索引同样抽测三次，两次收到 HTTP 429。应沿用官方入口并允许重试。这些数据只反映一台机器，国内不同地区的下载速度和失败率仍需采样。

**依赖 biber 的模板。** 在本机使用真实引擎运行包含 `\usepackage[backend=biber]{biblatex}`、一条有效引用及 `\printbibliography` 的最小工程。引擎下载宏包后记录 `Running external tool biber` 和 `error: program not found`，退出码 1。M7.1 可在这里给出缺少 biber 的明确提示，并提供切换到已安装 biber 的本机 TeX 工具链的入口。

### 2026-11-22 Spike 实测

**可行路径。** 在 Windows x64 下载并启动官方 Tectonic 0.17.0。缓存为空的 Fandol 中文样例首编译成功，历时 248.54 秒，缓存 337 个文件、63,724,414 字节。启用 `--only-cached` 后，在另一输出目录离线重编同一份 GB/T 7714—2025 样例成功，历时 5.82 秒。编译覆盖中文、数学、表格、页内引用、中英文参考文献和 SyncTeX。BibTeX 与 GB/T 7714—2025 数字顺序制样式 v3.1.2 生成两页 PDF。PDF 已逐页渲染检查，公式、中文字体和文献表清晰可读；日志有数学字体大小替代警告，需要在更复杂公式和不同机器继续验证。[可复跑样例](../scripts/fixtures/tectonic-spike/gbt7714)、[GB/T 7714 样式 v3.1.2](https://github.com/zepinglee/gbt7714-bibtex-style/releases/tag/v3.1.2)

**SyncTeX。** 新增的 Node 探针解析真实 `.synctex.gz`，通过 PDF.js 取得文字坐标，并验证主文件和被包含文件的三组正向、反向及往返定位。三个点都落在指定页和源码行，坐标偏差小于 0.00001 PDF pt。过程也发现同一行的大包围框可能把反向跳转指到相邻命令行。探针现优先选用带源码映射的字形记录，重编夹具后通过。已有本机引擎和缓存时的完整 PowerShell 复跑命令如下：

```powershell
$env:TECTONIC_CACHE_DIR = (Resolve-Path artifacts/tectonic-spike/cache-gbt-cold)
New-Item -ItemType Directory -Force artifacts/tectonic-spike/synctex-build | Out-Null
artifacts/tectonic-spike/engine/tectonic.exe --only-cached --untrusted --synctex -o artifacts/tectonic-spike/synctex-build scripts/fixtures/tectonic-spike/synctex/main.tex
node scripts/tectonic-synctex-probe.mjs scripts/fixtures/tectonic-spike/synctex (Join-Path $PWD 'artifacts/tectonic-spike/synctex-build/main') main.tex 4 1 'WordHub first page probe.' parts/chapter.tex 2 2 'WordHub included source probe.' parts/chapter.tex 4 2 'WordHub second page probe.'
```

**USTCThesis 兼容性。** 官方 `ustcthesis` v5.1.1 原样模板在默认 v33 bundle 上未能完成编译。错误落在 `\maketitle` 调用的 `\str_case:Nn`，所加载的 LaTeX3 层为 2022-02-24。引擎退出码为 1，没有生成新 PDF。尚无证据表明当前默认 bundle 可编译这版模板。M7.1 应先用现代 TeX Live bundle 或 macOS/Windows 机器进一步验证；若无法提供匹配 bundle，第一版需要将 USTC 模板标为需要本机 TeX 引擎，并先支持通用 ctex 项目。USTC 原包为 2,211,880 字节，SHA-256 为 `0b6acb4b7ef4ba455cc1cb2fc7896e8f73946e813d88fc673ad0c9757fd622eb`。[模板 v5.1.1](https://github.com/ustctug/ustcthesis/tree/v5.1.1)

**平台包与下载。** 官方三平台压缩包都从 Release 下载并逐包校验了 API SHA-256。Windows 二进制为 51,538,432 字节且 Authenticode 未签名；macOS arm64 包含 ad-hoc 签名，macOS x64 没有代码签名段。macOS 的 Gatekeeper 与实机编译尚未验证。发布中没有独立签名文件，当前 Release 标为非 immutable，Git tag 未签名。官方 bundle 入口返回可分段读取的 2.88 GB 归档，其 1,276,215 字节索引在本机 2.50 秒下载完成。一次本机直连探测中，官方 relay 和 data1b 索引各 3/3 成功，另一数据主机 data1 有两次 HTTP 429。数据仅代表本机出口，不能推断国内各地区速度和失败率。产品应校验引擎 SHA-256、采用官方 bundle URL、对临时下载失败可重试，并继续在多个地区测量下载体验。[Tectonic 0.17.0 官方发布](https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0)

**范围判断。** 通用 ctex、BibTeX、当前 GB/T 7714—2025 样式和 SyncTeX 已具备进入 M7.1 基础工作台实现的本机证据。USTC 模板、macOS 执行、跨地区下载、字体覆盖与性能分位数仍待验收。首个样例改用通用 ctex 论文，先实现打开 `main.tex`、编译、PDF 预览和错误定位。TeX 子进程的文件系统隔离尚未在本次 CLI spike 中验证，工作台执行不可信项目之前还需落实并验证 Windows worker 仅访问项目与缓存目录。Tectonic 管理器对下载签名状态明确告警，biber 工程明确提示缺少外部工具。

### 2026-11-22 文件系统隔离实测（阻断项）

用真实 Tectonic 0.17.0 加 `--untrusted --only-cached`，经 [compiler.ts](../packages/runtime/src/latex/compiler.ts) 编译一个位于临时目录的项目：
- `input{<项目外绝对路径>}` **能读**：项目外文件的内容被排进了 PDF，日志里只有一行“accessing absolute path”警告。
- `immediateopenout` 写 `<项目外绝对路径>` **能写**：项目外出现了新文件。TeX Live 默认的 `openout_any=p` 会拒绝这种写入，Tectonic 不会。

**结论**：`--untrusted` 只关闭了 shell-escape 和外部工具，不限制读写路径。一个恶意 .tex（例如来路不明的模板）能读取用户的私密文件（如 SSH 密钥），并经由 PDF、日志或交给 Agent 的编译输出泄露出去；还能往任意位置写文件（如开机启动目录）。在实现以下其一之前，**不能编译不可信项目**：
1. 在操作系统层面限制 TeX 子进程的读写范围，只允许访问项目目录和缓存目录（Windows 用 AppContainer 或低完整性级别，macOS 用 sandbox-exec）；
2. 至少先做“信任此项目”确认（类似 VS Code 的工作区信任）：只有用户自建或明确信任的项目才能编译；导入的 zip 和模板默认不信任；
3. 交给 Agent 和模型的编译日志要过滤绝对路径读取的内容，并在出现 “accessing absolute path” 警告时提示用户。

M7.1 先做第 2 项和第 3 项；第 1 项列为发布前的必做项，需要单独做技术 spike。

## 第一个端到端验收样例

拿一份通用 ctex 论文项目走完以下流程：导入 → Tectonic 编译 → 选区改写 → Agent 修复一个编译错误 → 插入引用 → 评审查出一条预埋的虚假引用 → 导出 PDF 和源码 zip。待默认 bundle 与模板兼容后，再将 ustcthesis 加入同一验收。另外用一份专利草稿走结构化文档轨道：纲领问答 → 写出权利要求和说明书 → 评审查出一条不被说明书支持的权利要求 → 导出 DOCX。两个样例都用真实 deepseek-flash 跑。
