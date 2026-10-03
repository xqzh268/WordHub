# 文枢（WordHub）文档与References技术调研

> **勘误（2026-10-03）**：本文部分结论已被后续调研修正，请先阅读 [README.md](README.md) §二“对早期三份文档的审阅”。

**日期：2026-10-03**　**范围：科研/基金与小说双场景，Windows桌面端优先**

> 证据边界：本报告的“调研结论”来自截至2026-10-03查阅的一方文档；“建议实测”是尚未在WordHub代码库运行的验证项目。没有把官网特性说明当作WordHub已验收能力，也不承诺所有格式一键互转。

## 1. 决策摘要

首版应把**规范化文档模型 + 可回溯源文件**作为核心：正文以项目内版本化的Markdown/ProseMirror JSON或LaTeX源码保存，DOCX作为导入/导出和兼容交付物，PDF/EPUB/MOBI等参考文件保留原件并建立解析索引。这样可以让写手、编辑、评审agent在稳定的段落/引用/页码锚点上协作，同时承认Word/WPS复杂排版、LaTeX宏包和电子书DRM造成的转换损失。

Windows桌面建议分两条路径：

* **可控且可自托管的编辑器路径（P0）**：React + ProseMirror/Tiptap，用自己的文档schema、协同/审阅状态和Agent锚点；通过Pandoc/LibreOffice headless或Tiptap Conversion（需商业/云计划评估）生成DOCX。适合首版基础格式、章节级审阅。
* **高兼容Office路径（P1按需）**：嵌入ONLYOFFICE Docs或评估Collabora Online，由文档服务器负责OOXML渲染。ONLYOFFICE社区版为AGPL，专有SaaS/白标通常需要商业许可；Windows桌面应用中要额外运行或连接文档服务，部署和许可证不可隐藏。

LaTeX采用**源码编辑 + 沙箱编译 + PDF预览**。Tectonic易于作为单一编译器分发，但不是所有TeX Live宏包/模板都能假定兼容；复杂投稿模板应提供可配置TeX Live引擎。Pandoc用于受控的Markdown↔DOCX/LaTeX转换，不承担PDF反向转换或像素级往返。

科研References用Zotero Web/Local API、Crossref REST、CSL/citeproc和BibTeX/CSL-JSON作为互补：Crossref/Zotero主要给元数据，全文能否取得取决于用户授权和来源许可。小说References以PDF.js、DOCX/TXT、无DRM EPUB/MOBI导入为主；扫描PDF必须先OCR，PDF.js本身不是OCR。

## 2. 文档编辑与Office兼容

### 2.1 ProseMirror/Tiptap

ProseMirror提供schema、事务和插件模型，适合把“agent批注/引用/章节状态”建成可定位的文档节点；Tiptap在其上提供React友好的扩展生态。**调研事实**：Tiptap Conversion支持导入DOCX/Markdown，导出DOCX/PDF/ODT/EPUB/Markdown，但官方明确它是格式桥接而非文档渲染器、OCR或异步队列；转换同步返回结果。[Tiptap Conversion概览](https://tiptap.dev/docs/conversion/getting-started/overview)

官方支持矩阵说明，PDF、ODT、EPUB、DOC等目标会先生成DOCX再转换，格式自身可能引入额外限制。[支持矩阵](https://tiptap.dev/docs/conversion/getting-started/feature-support-matrix)

DOCX导出扩展为Pro私有npm包/Start计划Beta；编辑器扩展支持自定义节点、元素覆盖和部分脚注/尾注，REST API暂不支持所有覆盖项。[DOCX导出](https://tiptap.dev/docs/conversion/export/docx/editor-extension)

官方列出的往返边界：导入DOCX目前不支持分页符、页眉页脚、水平线、文本样式等元素；PDF导入/导出不支持；不保证字节一致或Word像素级一致，页面边界不能由编辑器屏幕布局自动推断。[旧版导入限制](https://tiptap.dev/docs/conversion/legacy/overview)、[导出预期](https://tiptap.dev/docs/conversion/export/docx/editor-extension)

**对WordHub的含义**：

* 适合P0“章节正文、标题、段落、列表、表格、图片、引用占位符、评论锚点”。
* 把页眉页脚、目录、分节、复杂域代码、修订和分页视为兼容等级C（保留原DOCX交付/使用Office回修），不可宣传为完全兼容WPS/Office。
* 每次导入/导出保存转换警告、原文件哈希、schema版本和丢失节点清单，供编辑/评审agent复核。

### 2.2 ONLYOFFICE与Collabora备选

ONLYOFFICE官方Docs API支持在Web应用嵌入文档编辑、协作和分享，可通过JavaScript API、插件、宏和AI扩展集成。[官方API首页](https://api.onlyoffice.com/)

其集成模型是前端iframe/编辑器 + 文档服务器回调（下载、保存、状态），不是浏览器本地打开任意路径；“How it works”给出配置文档URL、回调和JWT等服务端流程。[工作原理](https://api.onlyoffice.com/docs/docs-api/get-started/how-it-works/)

**许可证调研事实**：ONLYOFFICE Docs Community Edition采用AGPL；官方FAQ明确，产品为专有且不公开源代码时需要商业许可证，白标/去品牌也只在商业条款下提供。[社区版许可FAQ](https://helpcenter.onlyoffice.com/docs/faq/docs-community.aspx)；官方集成白皮书指出将其作为付费SaaS或本地商业方案通常需要Developer Edition许可。[集成白皮书](https://www.onlyoffice.com/images/templates/whitepapers/pdf/integration_example.pdf)

Collabora Online/CODE同样以WOPI/文档服务器方式集成；CODE主要用于开发/测试，生产部署、品牌和支持要按其许可条款核查，不能仅凭“开源镜像”推断可商用。应在商业化前向官方获取书面许可边界。[Collabora Online](https://www.collaboraonline.com/)

**建议**：P0先做Tiptap原生编辑和DOCX转换；P1制作ONLYOFFICE PoC（Windows安装包/本地Docker或局域网服务、WOPI式文件回写、断网、并发和许可证审查），仅在真实复杂DOCX样本明显优于Tiptap时引入。

### 2.3 WPS/Office兼容分级

Word/WPS均读写OOXML，但字体、域代码、分页、修订、宏、嵌入对象、公式和排版引擎差异会改变视觉结果。WordHub应公布三档：

* **A（结构可编辑）**：标题/段落/列表/表格/图片/基本脚注与引用可往返，内容和顺序保持。
* **B（视觉近似）**：在指定字体、页边距和模板下页数/分页大致一致；需在Word与WPS各自渲染截图比对。
* **C（原生保留）**：复杂域、修订、宏、嵌入对象、出版模板仅保留原文件并在原生Office中编辑，平台只提供预览/锚点。

## 3. LaTeX、编译与转换

Tectonic是基于XeTeX和TeX Live的现代、自包含引擎；官方提供预生成bundle，适合桌面端携带固定版本和缓存，减少安装大型TeX发行版的负担。[Tectonic仓库](https://github.com/tectonic-typesetting/tectonic)、[安装文档](https://tectonic-typesetting.github.io/book/latest/installation/)

TeX Live为跨平台完整发行版，Windows 10+受支持，含pdfTeX/XeTeX/LuaTeX、BibTeX及大量宏包；可离线ISO安装并用tlmgr维护。[TeX Live 2026指南](https://tug.org/texlive/doc/texlive-en/texlive-en.html)、[Windows安装](https://tug.org/texlive/windows.html)

**建议的LaTeX沙箱**：每个编译任务使用项目临时目录、固定引擎/发行版版本、白名单输入路径和超时；捕获log、错误行、依赖清单、PDF哈希。默认Tectonic快速预览；检测到投稿模板/宏包缺失时允许用户指定项目级TeX Live容器或本机引擎。不要让Agent直接执行任意shell或联网下载宏包。

Pandoc官方支持LaTeX、DOCX（OpenXML）、EPUB等格式，可用`--citeproc`和`--bibliography`处理BibTeX并通过`--csl`指定样式；官方FAQ明确不能把PDF转换成其他格式。[用户指南](https://pandoc.org/MANUAL.pdf)、[FAQ](https://www.pandoc.org/faqs.html)

Word↔LaTeX不是无损往返：Pandoc以中间AST映射，复杂宏、浮动体、分页、Word域/修订、模板特有命令和精确版式会丢失或需手工调整。产品策略是“源码主版本 + 交付导出”，导出后显示差异/警告，不自动覆盖用户源码。

## 4. PDF与小说文件阅读、选段锚点

PDF.js是Mozilla维护的JavaScript PDF解析/渲染库。其`PDFPageProxy.getTextContent()`可取得页面文字和布局项，用于构造页码+字符偏移锚点。[PDF.js主页](https://mozilla.github.io/pdf.js/)、[PDFPageProxy API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html)

PDF有文本层和扫描图两类：PDF.js只能读取已有文本对象；扫描页需独立OCR（Windows可选Tesseract/商用OCR），并保存OCR置信度和页坐标。选段锚点建议保存`file_sha256 + page + quad/矩形 + text_quote + text_hash`，文本重排时用quote/hash重新定位，定位失败必须提示用户而非静默改指向。

EPUB是ZIP内HTML/CSS/资源，可采用epub.js并以EPUB CFI/章节ID建立锚点。[epub.js API/CFI](https://github.com/futurepress/epub.js/blob/master/documentation/md/API.md)；MOBI解析可借助Calibre命令行，但要注明其转换和格式支持的边界。Calibre官方列出EPUB、MOBI、DOCX、PDF、TXT等输入输出，并明确多数购买的EPUB含DRM，Calibre不会转换受DRM保护的书。[Calibre格式FAQ](https://manual.calibre-ebook.com/faq.html)

因此小说References首版支持：无DRM EPUB（优先）、MOBI（通过受控解析/转换）、TXT、DOCX、可提取文本的PDF；对DRM文件只做“用户在本机有权阅读但平台无法解密”的提示，不提供去DRM功能。

## 5. 科研References、溯源与引用

Zotero Web API v3和桌面Local API均提供读取/写入、全文和导出能力；项目生产请求应显式指定API v3。item可返回`bib`、`citation`、`csljson`、`bibtex`、`biblatex`、`ris`等格式，并可指定CSL样式。[Zotero API基础](https://www.zotero.org/support/dev/web_api/v3/basics)、[API总览](https://www.zotero.org/support/dev/web_api)

Crossref REST无需注册即可按DOI/标题查询成员提交的元数据，包含作者、摘要（摘要可能有版权）、资助、许可证、ORCID/ROR和撤稿信息；大部分元数据可复用，但全文使用权仍取决于许可证。[Crossref REST](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)、[元数据许可](https://www.crossref.org/documentation/retrieve-metadata/)

CSL定义引用数据模型和样式；官方样式库有数千种样式，样式分发需遵守CC BY-SA，schema为MIT；可选citeproc-js/citeproc-rs等处理器。[CSL开发者文档](https://citationstyles.org/developers/)、[样式许可说明](https://citationstyles.org/citation-style-language/documentation/)

**引用数据模型建议**：每条Reference包含内部ID、原始文件哈希、DOI/PMID/ISBN、来源API和时间、CSL-JSON/BibTeX原文、规范化字段、全文许可、页码/段落锚点、撤稿状态。正文引用用稳定`citationKey`，渲染时交给citeproc/LaTeX(BibTeX/Biber)，禁止Agent手写最终格式覆盖规范数据。

## 6. Windows桌面端最小样本技术验证（尚未实测）

1. **DOCX往返**：准备含中文字体、标题层级、目录、表格、图片、脚注/尾注、页眉页脚、分页、修订、批注、公式、超链接的10页Word文件；分别在Tiptap路径、ONLYOFFICE路径打开并导出，用Word 365与WPS最新版渲染PDF。记录结构丢失、视觉差异、页数、耗时、内存和导出警告。
2. **LaTeX基线**：准备中文XeLaTeX/LuaLaTeX、BibTeX/Biber、数学、图表、交叉引用、参考文献和常见投稿类文件；比较Tectonic与固定版TeX Live成功率、冷/热编译时延、离线行为、PDF页数/哈希和错误定位。
3. **Pandoc矩阵**：Markdown↔DOCX↔LaTeX、BibTeX/CSL引用、图片/表格/脚注；检查引用键、编号、公式、交叉引用和模板差异。单独确认PDF输入被拒绝或需OCR/中间格式，不能默认PDF可逆转。
4. **PDF选段**：文本PDF、双栏PDF、旋转页、连字和扫描PDF各2份；验证文字层选择、OCR触发、页坐标锚点、重新排版后的quote/hash定位和错误提示。
5. **References**：Zotero本地库、Zotero Web API、Crossref DOI/撤稿/许可证记录各20条；比较字段完整率、速率限制、离线缓存、重复合并和CSL输出与Word/LaTeX结果。
6. **电子书**：无DRM EPUB/MOBI/TXT/DOCX各3本；验证章节树、编码、脚注、图片、EPUB CFI和MOBI解析；另用DRM样本确认明确拒绝并不写出解密文件。
7. **Agent锚点与并发**：多个agent同时引用同一段、编辑后重新定位、文件被外部Office修改、断电恢复；验证版本冲突、来源哈希、审阅记录和可回滚性。

验收阈值示例（需用户确认后固化）：P0结构往返成功率≥95%（不含C类特性）；LaTeX基线成功率≥90%；PDF文本锚点≥98%可复现；引用渲染100%无悬空key；冷启动/热编译和编辑延迟分别记录P50/P95，不设未经实测的承诺值。

## 7. 分期路线

* **P0闭环（先做）**：Windows桌面壳、项目/Session/本地目录链接、ProseMirror/Tiptap基础schema、DOCX导入导出警告、LaTeX源码与Tectonic预览、PDF.js文本阅读和选段锚点、Zotero/Crossref只读导入、CSL引用占位符、项目文件哈希与审阅事件。
* **P1科研增强**：Zotero写回与本地库、BibTeX/Biber、Pandoc受控导出、投稿模板TeX Live环境、OCR队列、撤稿/许可证检查、ONLYOFFICE PoC和复杂DOCX兼容分级。
* **P1小说增强**：EPUB CFI、MOBI受控解析、人物/地点/事件/时间线图谱，图节点对话必须携带来源段落锚点；不支持DRM解密。
* **P2产品化**：多Agent共享记忆/质询审计、断点续编译、多人协同和原生Office/WPS插件评估；商业部署前完成ONLYOFFICE/Collabora许可证、字体和第三方数据许可审查。

## 8. 尚未验证与风险登记

本文件没有在WordHub仓库执行转换、编译、渲染或性能测试；所有性能和兼容阈值均为待确认指标。Tiptap Pro Conversion、ONLYOFFICE Developer Edition、商用OCR和云API可能产生费用及数据出境问题；默认优先本地/自托管。字体、投稿模板、Word/WPS版本和TeX引擎会影响结果，必须把样本、版本、日志和哈希作为可复现实验材料随项目保存。
