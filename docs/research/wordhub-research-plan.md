# 文枢（WordHub）调研与实施计划

> **勘误（2026-10-03）**：本文部分结论已被后续调研修正，请先阅读 [README.md](README.md) §二“对早期三份文档的审阅”。

> 调研日期：2026-10-03；范围：科研／基金写作与小说写作的Windows桌面端精简闭环。本文把第一方资料核查、产品建议、验证门槛和实施顺序放在一起；“建议”不是已完成能力。

## 一、产品判断

WordHub的核心不是让多个模型同时说话，而是把“项目事实、可追溯证据、受控写入、可审阅产物”组织成一个可恢复的创作工作流。首版应同时支持两种任务类型，但共享底层协议：Project → Session → Turn/Event → Artifact/Document → Evidence/Graph。科研和小说的差异主要落在任务模板、证据规则、图谱本体和验收器。

小说skill值得直接借鉴其“先问必要信息、生成规划后确认、再逐章执行、自动校验与中断续写”的分阶段机制。仓库说明还提供串行、子Agent并行和Teams三种模式、章节计划JSON和人物档案；WordHub应将其改造成可观察的任务状态机，不能把“自动完成”当作无审阅的事实保证。[chinese-novelist-skill SKILL.md](https://raw.githubusercontent.com/PenglongHuang/chinese-novelist-skill/master/SKILL.md)、[核心定位问答](https://raw.githubusercontent.com/PenglongHuang/chinese-novelist-skill/master/references/flows/phase1-layer1-core.md)

## 二、调研结论

### 1. Agent底座与协作

Pi仓库当前归档/重定向到`earendil-works/pi`，公开包包括`@earendil-works/pi-agent-core`（工具调用与状态管理）、`pi-ai`（多供应商API）和实验性的`pi-durable`（持久会话、任务、文档）。Pi仓库也明确说明自身没有文件、进程、网络或凭据权限系统，默认继承启动进程权限，因此Windows桌面端必须由WordHub的主进程、工具授权层和本地工作区沙箱承担边界，不能直接把通用shell暴露给模型。[Pi仓库](https://github.com/earendil-works/pi)

建议首版采用“单协调器 + 角色Agent + 有界消息总线 + 事件日志”：协调器创建任务和检查点，纲领、写手、编辑、评审、观察者各自以角色配置运行；Agent之间只通过带`task_id`、`artifact_id`、`evidence_refs`、`claim_status`的消息通信。需要争议时发起限轮次的质询（例如最多2轮），最后由协调器合并或请求用户裁决。自由群聊容易产生无穷循环、重复上下文和竞争写入，不适合作为首版默认模式。

身份与持久化建议固定为：`Project`（文件夹与共享记忆）→ `Session`（一次任务上下文）→ `Turn`（一个Agent或用户回合）→ `Run`（可恢复工作流）→ `Artifact`（文档、引用、图谱、报告）。消息是追加事件；文档通过revision和patch写入，Agent只能生成提案，协调器或用户批准后落盘。

### 2. 文档与编辑器

WordHub应分级承诺兼容性：

* **LaTeX原生路径**：保存`.tex`及图片、参考文献和构建日志，编辑器以源码为真相，预览由Tectonic/TeX Live worker完成。首版只承诺常见模板和可配置编译器；复杂私有宏包、系统字体和外部脚本需要显示“未验证”。
* **DOCX基础路径**：首版用Tiptap/ProseMirror承载可编辑的结构化文档，导入/导出DOCX作为交换格式，做标题、段落、列表、表格、批注和基本字体排版。DOCX/WPS往返不应宣称完全无损；每次导入导出应生成兼容性报告。
* **Office级兼容路径（后续）**：ONLYOFFICE Docs可嵌入并通过回调保存，但会增加独立服务、部署、许可和安全边界；只有在DOCX保真验收通过后再评估。

### 3. References与选段溯源

Reference实体应保留原文件哈希、来源、版本、解析状态、页码／段落定位和许可信息。PDF.js负责阅读和页级坐标；文本选段采用W3C Web Annotation的`TextQuoteSelector`（exact/prefix/suffix），并存`TextPositionSelector`或页坐标作为回退；文档变化后必须标记锚点失效，不能静默把问题贴到另一段。[W3C Web Annotation Model](https://www.w3.org/TR/annotation-model/)

科研引用首版优先支持DOI、BibTeX、CSL-JSON和本地RIS导入；CSL/citeproc用于样式渲染，Zotero连接作为后续适配器。Crossref/OpenAlex可作为元数据补全源，但都要保留原始响应和人工确认状态。小说资料支持PDF、DOCX、TXT、EPUB导入；MOBI先转档或显示不支持，OCR单独标记为低置信度。

### 4. Graph设计

不要把Graph定义成“模型画出的关系图”，而应定义成有来源的知识图：节点和边都带`source_refs`、`confidence`、`asserted_by`、`valid_from/to`、`status`（proposed/accepted/rejected）。小说本体可用人物、地点、组织、物件、事件、时间、目标，边使用亲属、盟友、冲突、位于、拥有、参与、因果和叙事视角等受控关系。科研本体建议使用“研究问题—概念—变量—假设—方法—数据集—结果—限制—引用”九类节点，边使用定义、测量、支持、反驳、依赖、复现、来源于；这样可承载概念关系图、论证图和证据矩阵，而非只做术语词云。

React Flow适合可编辑流程／DAG；Cytoscape.js适合较大关系网络、查询和布局。首版用React Flow做工作流与小图谱，数据层保持图JSON可迁移；图谱规模上升后再接Cytoscape.js。[React Flow](https://reactflow.dev/)、[Cytoscape.js](https://js.cytoscape.org/)

## 三、首版（两类任务的精简闭环）

### 共同能力

1. Windows桌面壳：Electron + React + TypeScript；主进程负责本地路径授权、数据库、worker生命周期和IPC，渲染器不接触API密钥。
2. 项目与文件夹链接：用户选择工作区根目录；只允许工作区内的读写，写入采用临时文件、校验、原子替换和版本快照。
3. Session与群聊：用户、Agent消息和工具事件实时流式展示；支持`@agent`、暂停、重试、从检查点恢复；所有事件可检索。
4. 角色Agent：纲领／写手／编辑／评审／观察者，均是配置而非硬编码。自定义Agent需要名称、职责、输入输出schema、可用工具、上下文范围和停止条件。
5. 文档工作台：Markdown作为内部交换基线；LaTeX源码编辑与PDF预览；DOCX基础导入导出与兼容报告。
6. References：本地文件导入、PDF阅读、文本选段提问、哈希和定位；科研引用先做BibTeX/CSL-JSON，小说做摘录与人物／事件候选提取。
7. Graph：接受人工确认的节点／边，点击节点打开“节点角色Agent”对话；推演结果必须写入新的scenario artifact并标注假设，不修改正史／论文事实。

### 两个可验收的Demo

* **科研Demo**：导入2篇PDF和1个BibTeX；纲领Agent生成研究问题—概念—方法—章节计划；写手生成带引用占位的引言；评审列出每个主张的证据定位和不确定性；用户接受后导出`.tex`和参考文献。
* **小说Demo**：回答三项核心问题（题材／主角／核心冲突），纲领生成大纲和人物档案；写手生成一章；编辑做格式和语言建议；评审检查偏离大纲、人物状态和悬念钩子；观察者生成带来源的关系图；用户确认后写入章节文件。

## 四、分阶段计划与门槛

### P0：产品契约与风险验证

产出：任务状态机、事件schema、Agent/Artifact/Reference/Graph领域模型、权限模型、两条Demo脚本、样本文档集。

必须验证：Pi嵌入式loop与Windows worker稳定运行；Electron IPC和工作区沙箱；DOCX往返、LaTeX编译、PDF选段锚点；真实模型下消息事件可重放。任何一项失败都先缩小范围，不进入大规模UI。

### P1：可恢复Agent工作流

产出：协调器、五类内置角色、事件日志、检查点、有限质询、人工批准卡片、项目共享记忆与Session隔离。验收标准：中断后可继续同一Run，Agent能读到已确认产物，拒绝的提案不会写入正文，事件可导出。

### P2：双模式工作台

产出：左侧Workspace/References/Graph/Settings，主区群聊+文档分栏；LaTeX和DOCX基础工作台；小说与科研任务模板。验收标准：两条Demo从导入到导出完整跑通，所有写入可追溯到Agent Turn和用户批准。

### P3：证据与图谱

产出：引用库、PDF阅读器、选段锚点、BibTeX/CSL导出、Graph编辑／筛选／节点对话／scenario artifact。验收标准：文档修改后失效锚点被发现；每条科研主张能反查证据；小说图谱区分文本事实和推演。

### P4：兼容性与可发布版本

产出：Windows安装包、迁移与备份、性能监控、权限审计、导出回归集、崩溃恢复。验收标准：无网络或模型服务故障时能恢复本地草稿；DOCX/WPS/Office样本分级通过；长文档和大图谱有明确性能上限。

## 五、优先级与暂缓项

首版必须做：本地项目、Session事件、五角色、受控写入、LaTeX、基础DOCX、PDF选段、BibTeX/CSL、两类Demo、Graph来源字段。

暂缓：实时多人协同编辑、MOBI原生阅读、完全无损Word往返、自动联网检索与自动投稿、自由群聊、无限Agent递归、让节点Agent直接改写正史、Office级编辑器集成。

## 六、关键指标与测试

记录每次Run的首 token延迟、总延迟、输入／输出token、估算费用、工具调用数、成功／重试／超时、人工接受率、引用定位准确率、图谱边人工修正率和导出回归结果。建立固定的科研2篇文献样本、小说3章样本、DOCX/LaTeX/PDF各一组；每次提示词或编排改变都跑匹配前后对照，发现质量或成本回归就保留基线并回退。

## 七、主要风险

* **幻觉与方向漂移**：评审只能提出证据化问题，不能凭空“通过”；主张必须带证据引用或`unverified`。
* **并发写坏文档**：禁止多个Agent直接写同一文件；只提交patch，串行合并。
* **Pi权限边界不足**：自行实现工具白名单、路径沙箱、网络策略和凭据隔离；Pi原生权限说明不能当作安全保证。[Pi权限说明](https://github.com/earendil-works/pi#permissions--containerization)
* **格式兼容过度承诺**：输出兼容矩阵和失败报告，先定义支持子集。
* **上下文膨胀与成本**：项目记忆采用摘要、检索和版本化事实表，Agent默认只拿任务所需上下文。
* **图谱误导**：事实、模型推断、用户设定和剧情推演使用不同状态与样式。

## 八、建议的下一步

先建立`docs/domain`中的schema和两条Demo数据，再做一个不追求视觉完成度的P0 vertical slice：用户导入一个文件夹，回答一次纲领问答，运行写手→编辑→评审，看到事件流，批准patch，导出一个`.tex`和一个`.docx`。通过后再投入高质感界面和大图谱；这样最早验证的是产品闭环与数据边界，而不是装饰性UI。
