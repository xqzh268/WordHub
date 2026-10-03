# 文枢（WordHub）Graph 关系图谱模块设计调研

**日期：2026-10-03**　标注：**【实】**已用第一方/论文来源核实；**【议】**设计建议；**【估】**推算，需实测。
本文深化 [wordhub-research-plan.md](wordhub-research-plan.md) §二.4 的图谱设想，冲突处以本文为准。

---

## 0. 对初步设想的修订（结论先行）

初步设想（节点/边带 `source_refs`、`confidence`、`asserted_by`、`valid_from/to`、`status`）方向正确，需补四点：

1. **双时间轴**。`valid_from/to` 是**故事内时间**（关系何时成立），另需 **`revealed_at`**（读者在第几章第几段得知）。倒叙、悬疑揭秘、身份反转都让两者不一致；**防剧透只看 `revealed_at`**。
2. **别名合并有时效**。"黑衣人 = 萧某"第N章才揭晓，alias 链接也要带 `revealed_at`，不能全局一次合并。
3. **认知边 `knows(角色, 事实, since)`**。没有它，角色扮演只能"不对读者剧透"，做不到"角色只知道自己该知道的事"；它也能表达戏剧反讽（读者知、角色不知）。
4. **库路线**：不是"先React Flow后Cytoscape"，而是**按视图分工**：结构化视图 React Flow，网络视图 Sigma.js，统一用 graphology 作内存图模型（§5）。

### 统一数据模型（草案）

```ts
interface GraphNode {
  id: string; type: string;            // 小说: character|place|org|item|event|time|goal; 科研: 见§2
  label: string; aliases: { name: string; revealed_at?: Anchor }[];
  props: Record<string, unknown>;
  source_refs: Anchor[]; confidence: number;
  asserted_by: 'user' | 'agent:<name>' | 'import' | 'simulation';
  status: 'proposed' | 'accepted' | 'rejected';
  canon: boolean; branch_id?: string;  // 推演产物 canon=false
}
interface GraphEdge extends Omit<GraphNode, 'label' | 'aliases'> {
  src: string; dst: string; rel: string;
  valid_from?: Anchor; valid_to?: Anchor;   // 故事内/论文内时间
  revealed_at?: Anchor;                     // 叙事揭示点（防剧透）
}
type Anchor = { doc: string; chapter?: number; scene?: number; para?: number; page?: number; quote?: string };
```

---

## 1. 从长文本抽取图谱

### 1.1 方法要点【实】

- **Microsoft GraphRAG**：分块 → LLM抽实体/关系 → 合并描述 → 社区检测 → 逐层社区报告；图抽取约占索引成本75%。FastGraphRAG（NLP抽取，低成本）、LazyGraphRAG（索引期不调LLM）；**gleaning**（追问"还有遗漏吗"）；`prompt-tune` 可自动生成领域抽取prompt。[methods](https://microsoft.github.io/graphrag/index/methods/)
- **LightRAG**：双层检索（低层实体、高层主题）；新文档子图与原图并集，**增量更新**。[arXiv 2410.05779](https://arxiv.org/html/2410.05779v1)
- **Graphiti（Zep）**：双时态（`valid_at/invalid_at` 世界时间 + `created_at/expired_at` 系统时间），冲突时旧边失效不删；事实可溯源到 episode；每个 episode 多次LLM调用。Apache-2.0，仅Python。[overview](https://help.getzep.com/graphiti/getting-started/overview)
- **LangChain LLMGraphTransformer**：`allowed_nodes` + 三元组 `allowed_relationships` + `strict_mode` 约束 schema；无消解与时序。

**【议】** 不直接套框架，各取所长：GraphRAG 的 gleaning 与社区报告（→小说"势力/阵营摘要"）；LightRAG 的增量并图与双层检索（→扮演agent检索）；Graphiti 的"失效不删"与 episode 溯源（时间换成章节/场景序号）；LLMGraphTransformer 的三元组 schema 约束（→科研本体）。

### 1.2 长篇小说抽取难点【实】

- 别名重复：Conan 基准中 GPT-4 把 "Costa / Head Nurse Costa / Sylvia Costa" 当三人；对策是先抽人物表再逐对问关系。[ACL Findings 2024](https://aclanthology.org/2024.findings-acl.454.pdf)
- CREFT 多agent分步抽取（上下文丢失、隐含关系、人物分组）。[arXiv 2505.24553](https://arxiv.org/pdf/2505.24553)
- LlmLink / LINK-KG：局部NER与远距共指分开，维护"名词短语→规范名"缓存。
- COLING 2025：只靠NER会漏大量共现，必须做共指消解。[paper](https://aclanthology.org/2025.coling-main.566.pdf)
- BookNLP 有人名聚类与引语说话人归属，但作者承认书级共指仍是开放问题，且以英文为主。

### 1.3 中文小说抽取流水线【议】

1. **按章切分，建叙事坐标** `chapter.scene.para`，同时作为 `revealed_at` 与 source_ref。
2. **第一遍（廉价模型扫全书）**：建"人物花名册"——称谓、字号、尊称、化名、亲属称呼（"师兄""三叔"），生成规范ID。
3. **第二遍（逐块抽取）**：注入花名册，提及标注为人物ID；每条关系必须附证据原文片段；1次 gleaning。
4. **合并（强模型冲突判定）**：关系变化按 Graphiti 方式（旧边写 `valid_to`、新边写 `valid_from`）；身份揭晓作为带 `revealed_at` 的 alias 边。
5. **人工审核**：全部 `proposed`，UI 批量接受/拒绝。用户自己的小说按章增量（LightRAG式并图）。

**【估】成本**：50万字 ≈ 约420块（1200 token/块，按约1 token/汉字估，需按实际tokenizer实测）；每块输入约3k、输出约0.8k，一遍约1.3M入 + 0.35M出；加 gleaning 与合并共 **3–4M tokens 量级**。降本：system prompt + 花名册做 prompt cache；抽取用小模型、合并用大模型；正式运行前**先试跑3章外推成本并让用户确认**。

---

## 2. 科研概念图谱（为用户设想）

### 2.1 参照系【实】

- **ORKG**：论文 → contribution → research problem，用 method/dataset/result 三元组描述；同问题的贡献可生成 **Comparison 对比表**；模板约束领域描述。[arXiv 2308.12981](https://arxiv.org/html/2308.12981)
- **论证挖掘**：Toulmin 六要素（Claim/Data/Warrant/Backing/Qualifier/Rebuttal），实际系统多用 claim–premise + support/attack；warrant 常隐含。
- **Semantic Scholar**：引用带上下文句、意图（background/method/result）和 isInfluential；覆盖不全。
- **OpenAlex**：Concepts 已弃用，改为 Topics（4 domain → 26 field → 252 subfield → 约4500 topic）；**2026-02 起需要 API key**。
- **可视化**：Connected Papers 按共被引与文献耦合做力导（颜色=年份、大小=被引）；Litmaps 用 x=时间 / y=被引坐标；ResearchRabbit 提供 Network 与 Timeline。

### 2.2 WordHub 科研图谱视图【议】

| 视图 | 节点 | 边 | 来源 | 交互 | 对写作agent的作用 |
|---|---|---|---|---|---|
| **A. 研究主线图**（写作默认） | 研究问题、假设、方法、数据集、结果、局限、贡献 | addresses / tests / uses / yields / limited_by | 用户论文草稿逐节抽取 + ORKG式模板 | 左→右分层DAG；节点链接到正文段落；**缺失环节显示为虚线占位** | 发现结构漏洞（有假设无结果）；大纲-正文一致性 |
| **B. 论证图（Toulmin-lite）** | Claim、Evidence（含引用）、Warrant（多为agent补全的proposed）、Qualifier、Counter-claim | supports / attacks / qualifies / cites | 草稿 + 参考文献中的claim | 从A的"结果/贡献"下钻；节点显示证据强度 | 评审找"无证据断言""过度概括""未回应反例"；引用核查 |
| **C. 文献地图**（References默认） | 论文、作者、Topic | cites（带意图）/ co-cited / coupled / similar | OpenAlex + Semantic Scholar + 本地库 | 力导（Connected Papers式）↔ 时间×被引坐标（Litmaps式）切换；按Topic着色 | 写相关工作时找空白、找必引；引用意图映射到"背景/方法/对比"段 |
| D.（可选）对比矩阵 | ORKG式 contribution | — | 参考文献批量抽取 | 以表为主、图为辅 | 生成 related work 对比表 |

**基金申请书**直接复用 A：节点换成"科学问题—研究目标—研究内容—技术路线—预期成果—年度计划"，评审agent用它核查 [domain-and-competitors.md](domain-and-competitors.md) 中的"逻辑一致性矩阵"。

---

## 3. 节点扮演对话（"采访"）

### 3.1 研究依据【实】

- **Character-LLM**：用人物经历微调 + "保护性经历"训练拒答越界问题。[arXiv 2310.10158](https://arxiv.org/pdf/2310.10158)
- **RoleLLM**：RoleGPT（prompt扮演）+ Context-Instruct（人物资料生成问答对）。
- **CharacterEval**：中文小说/剧本评测，13指标4维度，含知识暴露、知识准确、知识幻觉。[arXiv 2401.01275](https://arxiv.org/abs/2401.01275)
- **TimeChara**：时间点角色幻觉（五年级的哈利说出未来妻子）；强模型也不稳；Narrative-Experts 先由时间/空间专家判断问题是否越界。[arXiv 2405.18027](https://arxiv.org/abs/2405.18027)
- **Generative Agents**：记忆流检索 = 时近性 + 重要性 + 相关性；反思生成高层洞见（带引用）；计划递归分解。[arXiv 2304.03442](https://arxiv.org/pdf/2304.03442)

### 3.2 设计【议】

- **prompt + 检索，不微调**（每本书微调不现实）。
- **角色卡按锚点时间T动态生成**：档案、截至T的关系、目标、口头禅与说话风格（从引语归属统计）。
- **三层知识边界**：
  1. **硬过滤（检索层，最可靠）**：只检索 `revealed_at ≤ T` 且（`knows(角色)` 或角色亲历）的事实。
  2. **前置判定**（Narrative-Experts式）：轻量调用判断提问是否涉及未来/角色不知情信息，是则以角色口吻"不知道"或误解。
  3. **事后校验**：回答中的事实陈述与图谱比对，越界标红，用户决定是否重生成。
- **引用**：正文保持角色口吻，来源以"页边旁注"显示（第x章第y段）；超出原文的推断标"演绎"。
- **两种模式**："采访模式"不出戏；"作者模式"可出戏分析动机。
- 记忆检索沿用 Generative Agents 公式，"时近性"换成离T的叙事距离。

### 3.3 让"概念"说话【议】

- **概念代言人**：第一人称陈述"我的定义、边界、与X的区别、哪些证据支持/挑战我"，每句带文献锚点，无来源句显式标"无来源"。
- **时间切片**："2019年的BERT"只知道截至该年的文献，用来追问概念演化（与TimeChara同构）。
- **学派圆桌**：由主要倡导者与批评者的论文分别发言，展示争议。
- 不做拟人化情绪表演，以免削弱学术可信度。

---

## 4. 推演 / 模拟

### 4.1 现有项目【实】

- **Generative Agents（Smallville）**：25 agent 沙盒；记忆、反思、计划各自都提升可信度。
- **CAMEL-AI OASIS**：社交媒体模拟，至百万级agent，Apache-2.0。[GitHub](https://github.com/camel-ai/oasis)
- **MiroFish**（[666ghj/MiroFish](https://github.com/666ghj/MiroFish)）：种子材料（可为小说）→ GraphRAG建图 → 实体生成agent人设 → OASIS并行模拟（Zep存时序记忆）→ ReportAgent → 可与任一agent对话。README提醒成本高，建议先跑40轮内。**AGPL-3.0，不宜嵌入闭源桌面端，只借鉴思路。**
- **剧情类研究**：MAGNET（行动者-批评者-叙述者 + 共享世界状态图；Atlas 对比前后场景世界状态检测幻觉，[arXiv 2607.00918](https://arxiv.org/html/2607.00918)）；In2Writing 2025 导演agent按大纲调度角色agent；"Planning Beyond Text"批评：缺少共享符号状态时多agent会产生与既有事实矛盾的情节。

### 4.2 WordHub 推演设计【议】

**输入**：选定子图（节点 + 1跳邻居）、锚点T（第几章之后）、what-if假设（"如果A没死"）、用户勾选的不可违背正史约束、分支数K、深度、模式。

**过程（两档）**：
1. **快速推演（默认）**：单个"编剧"agent一次生成K条分支，每条由不同驱动力推动（人物目标 / 外部事件 / 隐藏关系揭露）。几十秒出结果。
2. **角色模拟**：导演agent每个节拍挑选出场角色 → 角色agent只拿截至T的知识与自身目标（复用§3知识边界）→ 世界状态守护者在图谱的**写时复制覆盖层**上记录变化 → 批评者对照正史检查矛盾。轮数上限默认10–20，**运行前显示预估token**。

**输出**：scenario 分支树。每个节点是"节拍事件"，附图谱改动（新增/失效关系），标 `canon=false`、`branch_id`、`generated_by`、所依据的假设。图上以铅笔虚线、半透明叠加显示，与正史明确区分。

**回写**：用户采纳分支/节拍 → 成为大纲 beat，保留指向推演记录的链接；图谱改动以 `status=proposed, asserted_by=simulation` 写入；等该章真正写出、再抽取验证后才转 `accepted`。**系统永不自动合并进正史。**

**科研对应**："方法/数据集改动后的可能结果"与"模拟审稿人质疑"（多位独立评审角色，参考 AgentReview 的偏见结论保持独立匿名），复用同一分支树。

---

## 5. 前端图可视化库

| 库 | 渲染/规模【实】 | 布局 | 自定义React节点 | 时间轴/过滤 | 纸感可塑性 | 许可 |
|---|---|---|---|---|---|---|
| **React Flow (xyflow)** | DOM/SVG；社区经验>5000节点有瓶颈 | 无内置，需接 dagre/ELK/d3-force（官方Force示例属Pro） | **最强** | 自建 | 高：节点即组件，可做纸质卡片 | MIT |
| Cytoscape.js | Canvas；3.31起 WebGL 预览（实验） | fcose / cola / dagre；复合节点 | 弱 | 自建 | 中 | MIT |
| **Sigma.js v3 + graphology** | **WebGL**，数万元素 | ForceAtlas2（可放worker）、Louvain社区 | 弱（GLSL或HTML浮层） | reducer动态过滤 | 中高：透明画布可叠纸纹 | MIT |
| AntV G6 v5 | Canvas/SVG/WebGL，可3D | 最全；Combo | 有（g6-extension-react，>2000节点建议原生） | **内置 Timebar** | 中高；中文文档 | MIT |
| reagraph | WebGL(three.js) | 内置 | 有限 | 自建 | 偏科技感 | Apache-2.0 |
| vis-network | Canvas，几千节点 | 物理/层次 | 无 | 自建 | 低 | Apache/MIT |
| D3-force | 自绘 | 仅力导原语 | 完全自控 | 自建 | 最高但全自建 | ISC |

**推荐组合【议】**
- **数据层**：graphology 作唯一内存图模型（属性、时间过滤、社区算法），各视图共享。
- **结构化视图**（研究主线图、论证图、推演分支树、小型人物图）：**React Flow + elkjs**，纸质卡片节点，可放引用、状态、"对话"按钮。
- **网络全景**（大型人物网、文献地图）：**Sigma.js**，worker里跑 ForceAtlas2，CSS叠纸纹背景，选中节点用HTML浮层卡片。
- **时间滑块**：自研统一组件，按 `revealed_at` 驱动过滤，兼作**防剧透阅读进度条**。
- **单库替代**：若只想用一个库，AntV G6 v5 最均衡（MIT、Timebar、Combo显示阵营）。
- 规模判断：典型小说主要人物50–500节点，**首版只用 React Flow 即可**；文献网络>1000节点时再接 Sigma。

---

## 主要来源
GraphRAG [methods](https://microsoft.github.io/graphrag/index/methods/) / [auto-tuning](https://microsoft.github.io/graphrag/prompt_tuning/auto_prompt_tuning/)；LightRAG [arXiv](https://arxiv.org/html/2410.05779v1)；Graphiti [docs](https://help.getzep.com/graphiti/getting-started/overview)；BookCoref [arXiv](https://arxiv.org/html/2507.12075v1)；BookNLP [GitHub](https://github.com/booknlp/booknlp)；ORKG [arXiv](https://arxiv.org/html/2308.12981)；OpenAlex [Topics](https://help.openalex.org/data/topics/)；Connected Papers [about](https://www.connectedpapers.com/about)；Litmaps [docs](https://docs.litmaps.com/en/articles/9181490-use-and-edit-litmaps-visualization)；Character-LLM / RoleLLM / CharacterEval / TimeChara / Generative Agents 见正文；OASIS、MiroFish 见正文；React Flow [layouting](https://reactflow.dev/learn/layouting/layouting)；Cytoscape [WebGL](https://blog.js.cytoscape.org/2025/01/13/webgl-preview/)；Sigma [renderers](https://www.sigmajs.org/docs/advanced/renderers/)；G6 [Timebar](https://g6.antv.antgroup.com/en/manual/plugin/timebar)。

**待实测**：中文token/汉字比例、模型单价、React Flow 5000节点上限（社区经验）、Sigma规模数据。
