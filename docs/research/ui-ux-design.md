# 文枢（WordHub）UI/UX 设计体系与前端技术栈

**日期：2026-10-03**　标注：**【实】**有来源佐证；**【议】**设计/工程建议；**【待验】**来源冲突或未能直接核实。
设计目标：简洁、优雅、文艺；"在洁净的环境、有质感的纸张上创作"。

---

## 1. Claude 风格拆解

### 1.1 字体【实】

- **现状**：claude.com / claude.ai 使用 Anthropic 自有字族 **Anthropic Sans / Anthropic Serif / Anthropic Mono**（可变字体，300–800，含斜体；Mono 仅400）。Sans/Serif 由 BSPK 的 Chester Jenkins 设计，品牌由 Geist 工作室负责。[WhatTheFont](https://wtfont.app/site/claude.com)、[Gooova](https://gooova.com/en/anthropic-designed-its-own-type-family/)
- **早期方案（已被取代，但网上多数"Claude设计系统"仍以此为准）**：Galaxie Copernicus（标题）、Tiempos Text（正文）、Styrene B（界面）。
- **分工**：衬线用于标题（编辑感、权威感），无衬线用于UI与正文，Mono 用于代码；标题字重约500。
- **许可**：Anthropic 字族无公开许可，**不可用**；Copernicus/Tiempos/Styrene 为商业字体，嵌入需向 Klim / Commercial Type 购买应用授权。

### 1.2 色彩【实】

官方品牌色（[anthropics/skills brand-guidelines](https://github.com/anthropics/skills/blob/main/skills/brand-guidelines/SKILL.md)）：Dark `#141413`、Light `#faf9f5`、Mid Gray `#b0aea5`、Light Gray `#e8e6dc`、Orange `#d97757`、Blue `#6a9bcc`、Green `#788c5d`。

社区逆向（[VoltAgent DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/claude/DESIGN.md)，非官方）：画布 `#faf9f5`、卡片 `#efe9de`、文字 `#141413/#3d3d3a/#6c6a64`、陶土 `#cc785c`；展示级字号字重400、负字距；正文16px/1.55；按钮圆角8、卡片12；**"以色块区分层级，阴影极少"**。

### 1.3 可商用开源替代

| 字体 | 许可 | 用途 |
|---|---|---|
| Source Serif 4、Newsreader、Literata、Fraunces、Lora | OFL 1.1 | 英文衬线 |
| Inter、Geist / Geist Mono、JetBrains Mono | OFL 1.1 | UI / 等宽 |
| 思源宋体 Noto Serif SC、思源黑体 Noto Sans SC | OFL 1.1 | 中文正文 / UI |
| **霞鹜文楷 / 文楷 Screen** | **OFL 1.1【实】** | 文艺正文、小说模式 |
| 霞鹜新致宋 / 新晰黑 | **IPA Font License，非OFL【实】** | 慎用，不打包 |
| 朱雀仿宋 | OFL 1.1（v0.212预览，6512字）【实】 | 引文、副标题 |
| 得意黑 Smiley Sans | OFL 1.1；官方不建议正文/UI | 仅展示 |
| 方正"免费商用"系列 | **嵌入软件需另行授权【实】** | **不打进安装包** |
| 更纱黑体 Sarasa Mono SC | OFL | LaTeX源码中英等宽 |

### 1.4 字体搭配【议】

```
UI       : Inter / Geist, "Noto Sans SC"(子集), "Microsoft YaHei UI", system-ui
正文阅读  : "Source Serif 4"(或 Literata), "Noto Serif SC"        —— 学术/通用主题
文艺/小说 : Newsreader, "LXGW WenKai Screen"                       —— "手稿"主题
标题      : Fraunces(opsz, SOFT轴调柔, wght 400–500) 或 Newsreader Display + Noto Serif SC SemiBold
等宽      : "JetBrains Mono" / "Geist Mono", "Sarasa Mono SC"
```

- 仿 Claude：标题衬线、字重400–500、负字距；界面无衬线；agent长回复可切"衬线阅读模式"。
- **文档工作台不用品牌字体**：DOCX 按文档声明字体（宋体、Calibri 等）映射到系统字体/替代字体，否则版式不保真。

### 1.5 中文字体体积【议】

中文字体单文件5–10MB。[cn-font-split](https://github.com/KonghaYao/cn-font-split) v7 可按 unicode-range 切成几十KB的 woff2 分片并生成 @font-face。
1. UI 字体：常用3500字 + 标点子集，常驻（约0.5–1MB/字重）。
2. 阅读字体：全量分片放本地 `app://fonts/`，unicode-range 按需加载。
3. 安装包只带 Regular + SemiBold，其余字重作为"字体包"按需下载；回退链末尾加系统宋体/黑体。

---

## 2. "纸张质感"视觉语言【议】

### 2.1 色板 token

**亮色·宣纸/象牙**

| Token | 值 | 说明 |
|---|---|---|
| `--bg-canvas` | `#F7F4EC` | 应用底，比Claude暖一档 |
| `--bg-sidebar` | `#F1EDE3` | |
| `--bg-raised` | `#FBF9F4` | 浮层、卡片 |
| `--paper-sheet` | `#FFFDF8` | 文档纸面，最亮一层："纸放在桌面上" |
| `--bg-hover` | `#ECE6D9` | |
| `--line` / `--line-strong` | `#E4DDCF` / `#D3C9B6` | |
| `--ink-1..4` | `#1E1C19` `#4A453D` `#7B7468` `#A9A194` | 正文→占位 |
| `--accent` | `#C2603A` | 朱砂陶土，比 `#d97757` 深，链接对比度更好 |
| `--accent-soft` / `--accent-ink` | `#F4E4D8` / `#9E4A2B` | |
| `--highlight` | `rgba(222,178,92,.28)` | 黄笺高亮 |
| `--sel` | `rgba(194,96,58,.16)` | 选区 |

**暗色·墨**（暖墨，不用纯黑）：canvas `#171614`、sidebar `#1C1B18`、raised `#22201D`、sheet `#1F1D1A`、hover `#2A2824`、line `#33302B`/`#45413A`、ink `#ECE7DC` `#BEB7AA` `#8B8478` `#615B52`、accent `#E08A66`、accent-soft `#3A2A22`、highlight `rgba(201,160,80,.22)`。

**Agent 身份色（矿物颜料系）**：黛蓝 `#4F6D8A`、松绿 `#5E7D62`、赭石 `#A0703C`、藤紫 `#7D6A9A`、朱砂 `#B0473A`、石青 `#3F7F86`。头像做成**篆刻印章式单字**（[纲] [写] [编] [审] [观]），契合"文艺"定位。

### 2.2 纸纹与层次

- **噪点**：SVG `feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3"` + `feColorMatrix` 去色，作 data-URI 铺在 `::before`，`opacity:.035`（暗色 `.05`），`mix-blend-mode:multiply`（暗色 `soft-light`），`pointer-events:none`。只铺画布与纸面，不铺文字层；预生成256px PNG平铺比实时滤镜省GPU。
- **纸面阴影**（多层、低透明、暖棕）：`0 1px 1px rgba(60,40,20,.04), 0 6px 16px -4px rgba(60,40,20,.06), 0 24px 48px -16px rgba(60,40,20,.10)`；暗色用 `inset 0 1px 0 rgba(255,255,255,.04)` 高光描边。
- 层级主要靠色块（沿用Claude原则），阴影只用于纸面与浮层。**纸面圆角2px**（纸不是圆角卡片）。

### 2.3 系统材质【实】

Electron `backgroundMaterial: 'mica' | 'acrylic' | 'tabbed'`（Win11 22H2+，需新版本，旧版本最大化变黑等bug已修复 [PR #45456](https://github.com/electron/electron/pull/45456)）。【议】Mica 只用于侧栏与标题栏（"纸放在磨砂桌面上"），主区与纸面保持不透明实色；Win10 或关闭透明时回退纯色。

### 2.4 排版

- 4px 基线网格，间距 4/8/12/16/24/32/48/64。
- **中文正文**：16–17px，行高1.75–1.85，段距0.6–0.8em，**行宽32–40字**（`max-width≈36em`）；两端对齐，`text-spacing-trim`、`text-autospace`【待验Chromium版本】，标点挤压。
- 英文正文：行高1.55–1.65，60–75字符/行。对话区消息宽度上限约680px。

### 2.5 图标

Lucide（ISC，克制）或 **Phosphor Light**（MIT，更文艺）；20px网格，描边1.25–1.5。

### 2.6 参考产品

| 产品 | 借鉴点 |
|---|---|
| iA Writer | 专注模式，排版即设计 |
| Bear | 温暖主题，克制的Markdown呈现 |
| Craft | 文档如纸卡，页面过渡流畅 |
| Linear | 信息密度、键盘优先、动效克制 |
| Arc | 侧栏空间感与材质 |
| Notion | 斜杠命令、块编辑 |
| **Readwise Reader** | 高亮→笔记、选中即问AI，**直接对应References** |
| Granola | 人写内容与AI增补在视觉上明确区分 |
| Claude | Artifacts 侧边工作台 ↔ "对话 + 文档"双栏 |

---

## 3. 动效

### 3.1 库【实】

- **Motion**（原Framer Motion，MIT，`motion/react`）。
- GSAP 3.13（2025-04）起全部插件免费可商用，但"可视化无代码动画工具"类产品需Webflow书面许可；WordHub 不需要它。
- **React 19.3（2026-09-09）**：`<ViewTransition>` 与 `addTransitionType` 已稳定。[blog](https://react.dev/blog/2026/09/09/react-19-3)

【议】主选 Motion（布局动画、AnimatePresence、手势），模块级切换用 ViewTransition。

### 3.2 动效 token【议】

```
--dur-instant: 80ms  (hover/按下)     --ease-out:   cubic-bezier(0.22, 1, 0.36, 1)  进入
--dur-fast:   140ms  (tooltip/菜单)   --ease-in:    cubic-bezier(0.4, 0, 1, 1)      退出(时长×0.7)
--dur-base:   220ms  (面板/卡片)      --ease-inout: cubic-bezier(0.65, 0, 0.35, 1)
--dur-slow:   360ms  (模块切换/抽屉)  --ease-paper: cubic-bezier(0.32, 0.72, 0, 1)  纸张滑入
--dur-page:   520ms  (翻页/文档打开)  spring-soft {260, 30}   spring-snappy {420, 36}
```

原则：只动透明度与≤8px位移，不弹跳、不大幅缩放；退出比进入快；遵从 `prefers-reduced-motion`。

### 3.3 Agent"工作中"状态【议】

- **流式文字**：按token块淡入（180ms），不做逐字打字机；行尾"墨点"光标呼吸（1.2s）。
- **思考**："正在构思…" + 缓慢流光（2s）；思考内容默认折叠一行。
- **工作流时间线**：消息左侧竖向细线，节点 ○待办 / ◐进行中（呼吸）/ ●完成 / ✕失败；工具调用为可折叠小卡（"检索文献3篇 · 1.2s"）；并行agent用泳道或印章头像堆叠。
- **改写可见**：agent修改文档时，纸面对应段落以 accent-soft 底色淡入并标作者色条（类修订模式）。
- **@提及**：弹出agent选择器，选中后以印章色小标签嵌入输入框。
- **质询线程**：agent间质询默认折叠为"批注式"讨论条，可展开。

---

## 4. 组件与状态【议】

- **shadcn/ui（Base UI 版）**：Base UI v1 于2025-12稳定，shadcn/ui 2026-07起默认Base UI【实】；组件源码入项目，便于深度"纸感"定制。
- 状态：Zustand（全局UI、会话、agent运行态；流式事件独立 event store 防整树重渲染）、TanStack Query（IPC/文献库IO缓存）、Jotai（编辑器周边，可选）。
- react-resizable-panels（三栏可拖拽、记忆尺寸）；TanStack Virtual / virtua（消息流反向滚动、文献列表）；**cmdk**（Ctrl+K：@agent、插入引用、切换文档）。

---

## 5. 文档工作台与阅读器（重点）

### 5.1 Word / DOCX

| 方案 | 许可/费用【实】 | 能力 | 评价 |
|---|---|---|---|
| **SuperDoc** | **AGPLv3 或商业许可** | 直接编辑OOXML（不经HTML转换）；真分页、分节、页眉页脚；修订、批注、Yjs协作；React hooks；"bring your own UI"；缺字事件 | **保真度最高**；闭源商用须买商业许可 |
| Tiptap 3 | 核心MIT；DOCX导入导出属付费 Conversion（$49/月起）；**导入走Tiptap云端**；分页 Pages 为付费Pro且仍Alpha/Beta | 编辑体验好 | 保真与隐私均弱于SuperDoc |
| Tiptap + mammoth.js + docx.js | 宽松许可 | mammoth导入丢版式；docx.js生成 | 仅"导入成纯净稿再写" |
| docx-editor.dev | 核心Apache-2.0；修订/批注付费 | Word级分页、未改动部分无损往返 | 值得观察的备选 |
| ONLYOFFICE | Community AGPL；嵌入需 Developer Edition | 保真高 | 很重，难融入纸感UI |
| Syncfusion | 社区许可（营收<$1M等） | DOCX/DOC/RTF，需服务端SFDT转换 | 偏Office风 |

**WPS 兼容【实/议】**：现代WPS默认存 .docx；历史 .wps/.et 只能"导入时转换"（LibreOffice headless 或 ONLYOFFICE x2t → DOCX【待验对WPS .wps的识别，ONLYOFFICE文档里的.wps指的是MS Works】），之后统一以DOCX保存，不回存原格式。

**推荐【议】**：开源或可接受AGPL → SuperDoc 社区版；闭源商业 → SuperDoc 商业许可，或退回 Tiptap(MIT核心) + 自研 DOCX 转换（保真降级）。**已定：开源（AGPL-3.0）→ 采用 SuperDoc 社区版**；LaTeX 侧同理可用 `codemirror-lang-latex`。

### 5.2 LaTeX

- 编辑器 CodeMirror 6。`codemirror-lang-latex`（TeXlyre）功能最全但 **v0.5起 AGPL-3.0**；闭源改用 MIT 的 `@codemirror/legacy-modes` stex 模式 + 自建补全。
- 编译【实】：本地 **Tectonic**（XeTeX，按需下载宏包，适合 ctex/xeCJK；其TeX Live包仍为2022版）；BusyTeX WASM（MIT，首次约100MB）；texlyre-busytex 包装层 AGPL；**SwiftLaTeX 依赖的远端服务器已不可用**。
- 【议】首选本地 Tectonic；检测到用户装有 TeX Live 时用 `latexmk`/`xelatex`；WASM 仅作离线兜底（自写MIT包装）。PDF预览 + **SyncTeX 双向跳转**。
- 公式：KaTeX（对话区、Word内联）；MathJax（更全覆盖/无障碍）。

### 5.3 References 阅读器

- **PDF**：**EmbedPDF**（MIT + PDFium WASM，内置高亮、批注、真涂黑、虚拟滚动、headless组件）首选；备选 PDF.js + react-pdf-highlighter-extended（坐标与视口无关，适合"选中→问agent"）。
- **电子书**：**foliate-js**（MIT）支持 EPUB、**MOBI、KF8/AZW3**、FB2、CBZ【实】；限制：无连续滚动、KF8解压慢、字体去混淆需安全上下文（Electron自定义协议注册为secure）。→ 旧文档"MOBI暂缓/需Calibre"可修正为 **foliate-js 原生支持无DRM MOBI**。
- **TXT**：编码检测（`TextDecoder('gb18030')`）；**DOCX小说**：mammoth 转 HTML 阅读。
- **引用**：citation-js（BibTeX/RIS/CSL-JSON）+ CSL 样式（含 **GB/T 7714-2015**）；【待验】citeproc-js 的 CPAL/AGPL 双许可影响。

---

## 6. 设计 token 草案【议】

```json
{
  "font": {
    "ui": "Inter, 'Noto Sans SC', 'Microsoft YaHei UI', 'PingFang SC', system-ui, sans-serif",
    "serif": "'Source Serif 4', 'Noto Serif SC', 'Songti SC', serif",
    "literary": "Newsreader, 'LXGW WenKai Screen', serif",
    "display": "Fraunces, 'Noto Serif SC', serif",
    "mono": "'JetBrains Mono', 'Sarasa Mono SC', ui-monospace, monospace"
  },
  "size": { "2xs":11, "xs":12, "sm":13, "base":14, "md":15, "read":17, "lg":20, "xl":24, "2xl":30, "3xl":38 },
  "leading": { "ui":1.45, "readZh":1.8, "readEn":1.6, "display":1.15 },
  "tracking": { "display":"-0.02em", "ui":"0", "caps":"0.08em" },
  "weight": { "regular":400, "medium":500, "semibold":600 },
  "radius": { "xs":4, "sm":6, "md":8, "lg":12, "xl":16, "sheet":2, "pill":9999 },
  "shadow": {
    "hairline": "0 0 0 1px var(--line)",
    "raised": "0 1px 3px rgba(40,28,16,.08)",
    "popover": "0 8px 24px -6px rgba(40,28,16,.14), 0 0 0 1px var(--line)",
    "sheet": "0 1px 1px rgba(60,40,20,.04), 0 6px 16px -4px rgba(60,40,20,.06), 0 24px 48px -16px rgba(60,40,20,.10)"
  },
  "motion": { "instant":80, "fast":140, "base":220, "slow":360, "page":520,
              "easeOut":"cubic-bezier(.22,1,.36,1)", "easePaper":"cubic-bezier(.32,.72,0,1)" },
  "grain": { "light":0.035, "dark":0.05 }
}
```

---

## 7. 线框

**Workspace**

```
┌────┬──────────────┬───────────────────────────────┬──────────────────────────────────────┐
│ ◎  │ 长安夜 ▾      │  #第三章 · 坊门           ⋯   │  第三章.docx ▾  Word|LaTeX   ⎙ 导出 │
│文枢│ ───────────  │ ─────────────────────────────  │ 宋体▾ 16▾ B I U  ≡ ≣  H1 H2  ✎修订  │
│    │ 会话          │  ○ 你  14:02                   │ ┌──────────────────────────────────┐ │
│ ✎  │ ▸ 第三章 ●    │  @评审 核实唐代宵禁时间        │ │                                  │ │
│Work│   人物小传    │                                │ │      第 三 章   坊 门             │ │
│    │   读书札记    │  ◐ [审] 评审 · 正在检索… ┄┄    │ │                                  │ │
│ ❐  │ ＋ 新会话     │  │ ├ 检索参考 3 处 · 1.2s ▸    │ │  暮鼓三百声，坊门次第而闭……      │ │
│Ref │              │  │ └ 摘录《唐律疏议》 ▸        │ │  ▍(agent 修改段落：赭石色左条)   │ │
│    │ Agents        │  ● [审] 宵禁始于暮鼓……▍       │ │                                  │ │
│ ⌘  │ [纲] 纲领     │  ▸ 讨论线程：评审 ⇄ 写手 (2)   │ │       （纸面 sheet，噪点+多层阴影） │ │
│Grph│ [写] 写手     │  ● [编] 已改写第2段 [查看差异] │ │                                  │ │
│    │ [编] 编辑     │ ─────────────────────────────  │ └──────────────────────────────────┘ │
│ ⚙  │ [审][观] ＋   │ ✎ 输入… @提及   ⌘K   ↵         │  1,284 字 · 第 3/12 页 · 已保存      │
└────┴──────────────┴───────────────────────────────┴──────────────────────────────────────┘
 56px   220px(Mica)        可拖拽 360–520px                  flex（canvas底 + 居中纸面）
```

**References**

```
┌────┬────────────────┬──────────────────────────────────────┬─────────────────────┐
│侧栏│ 长安夜 ▾ ⌕      │  [PDF / EPUB 阅读器 · 纸面]          │ 高亮与笔记 | 会话    │
│    │ ▾ 文献/文件(42)│   ……选中文字 → 浮出：                │ ▍"宵禁……" p.12      │
│    │   唐律疏议.pdf │   [问agent] [高亮] [引用] [摘录]     │   → 问评审 ▸         │
│    │   ▸ 会话(2)    │                                      │ [插入参考文献 GB/T] │
│    │ ▾ 小说参考(18) │                                      │ [抽取人物→Graph]    │
└────┴────────────────┴──────────────────────────────────────┴─────────────────────┘
```
（按用户需求，References 侧栏为"项目 → 文献/文件 → sessions"三级树，与 Workspace 同步。）

---

## 8. 关键风险

1. Claude 品牌字体不可用；用 Source Serif 4 / Newsreader + 思源宋体 / 霞鹜文楷 Screen + Inter 可高度还原气质。
2. 霞鹜新致宋（IPA）与方正免费字体（嵌入需授权）不打包。
3. **AGPL 是 DOCX/LaTeX 两条线的最大约束**：SuperDoc、codemirror-lang-latex、texlyre-busytex、ONLYOFFICE Community 均为 AGPL。
4. Tiptap DOCX 导入走云端，对重视隐私的写作者不友好。
5. WPS 私有格式只能导入转换，无法原生回存。
