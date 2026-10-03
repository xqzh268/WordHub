# 文枢（WordHub）多Agent底座、组织模式与项目记忆

**核查日期：2026-10-03**　标注：**【实】**已用npm registry / GitHub API / 官方文档核实；**【议】**建议或推断。
本文是对 [agent-runtime.md](agent-runtime.md) 的核查与补充，冲突处以本文为准。

---

## 1. Pi 现状核查

### 1.1 已核实事实【实】

- **仓库**：`badlogic/pi-mono` 已**转移**（非fork）至 [earendil-works/pi](https://github.com/earendil-works/pi)，MIT，约11.1万star，2026-10-02仍在推送。描述："AI agent toolkit: unified LLM API, agent loop, TUI, coding agent CLI"。
- **npm 包**：

| 包 | latest | 首发 | 备注 |
|---|---|---|---|
| `@earendil-works/pi-agent-core` | 1.0.0（2026-10-01） | 2026-05-07 | `legacy-node20` tag: 0.74.2 |
| `@earendil-works/pi-ai` | 1.0.0 | 2026-05-07 | 同上 |
| `@earendil-works/pi-coding-agent` | 1.0.0 | 2026-05-07 | 同上 |
| `@earendil-works/pi-durable` | 1.0.0 | **2026-09-19** | README首行 "Experimental. The API changes without notice" |
| `@mariozechner/pi-*`（旧） | 0.73.1 | — | 已deprecated |

  全部 MIT；`engines: node >=22.19`；依赖 typebox 1.3.27。monorepo 另有 `@earendil-works/chord`、pi-tui、pi-telemetry、pi-mcp、pi-codemode。
- **pi-agent-core API**（[packages/agent](https://github.com/earendil-works/pi/tree/main/packages/agent)）：
  - `new Agent({ initialState:{systemPrompt, model, tools}, streamFn })` → `prompt()` / `continue()` / `abort()` / `waitForIdle()`
  - `steer(msg)`：工具执行中插话（当前批工具结束后注入）；`followUp(msg)`：agent将停时追加一轮；队列模式 `one-at-a-time`，可清空队列。
  - 钩子：`transformContext`（裁剪/注入上下文）、`convertToLlm`（过滤自定义消息）、`beforeToolCall`（可拦截）、`afterToolCall`、`prepareRequest`、`finishTurn`（返回 `{action:"end"|"continue"}`，旧 `shouldStopAfterTurn` 已移除）。
  - `AgentTool{name,label,description,parameters(TypeBox),executionMode,execute(id,params,signal,onUpdate)}`，可返回 `terminate:true`。
  - 事件：`agent_start/end`、`turn_start/end`、`message_start/update/end`、`tool_execution_start/update/end`；监听器按序 await。底层 `agentLoop()` / `agentLoopContinue()` 异步迭代器。
- **pi-ai 新API**：`createModels()` → `models.setProvider(anthropicProvider())` → `models.getModel(...)`（README 有 "Migrating from the Old Global API"）。支持 **DeepSeek、Moonshot/Kimi（含China区）、MiniMax（含China区）、Qwen**、OpenRouter 及任意 OpenAI 兼容端点（Ollama/vLLM）；有 Cross-Provider Handoffs 与 Context Serialization。
- **pi-durable**（[packages/durable](https://github.com/earendil-works/pi/tree/main/packages/durable)）：Harness / Conversation（不可变Entry）/ 原子Commit / Document（类型化JSON状态）/ Task（每步checkpoint）；存储 Memory、SQLite（`node:sqlite` + WAL）、JSONL；自带 subagent（前后台、可steer/stop/list、重启安全）、child tasks（allSettled/failFast）、`taskGraph()`、fork、compaction。**限制：一个存储同时只能被一个进程持有，无跨进程锁。**
- **Pi 根README明确**：不内置 sub-agents 和 plan mode；**无内置权限系统**；新贡献者的 issue/PR 默认自动关闭。
- pi-coding-agent 的 skills 系统实现了 [Agent Skills 规范](https://agentskills.io/specification)（SKILL.md）。

### 1.2 对旧文档的勘误

1. 包名正确，但需补充：锁 `^1.0.0` 且 **Node ≥22.19**；旧 `@mariozechner/*` 停在 0.73.1。
2. pi-durable 已发布 1.0.0，能力覆盖"持久事件日志 + 任务图 + 子agent + 崩溃恢复"，与旧方案中"全部自建"大面积重叠——应**对齐其概念模型**，而非完全另起炉灶（见 §2 推荐）。
3. 示例代码若用旧全局 `getModel()`，需改为 `createModels()`。
4. 必须在 `beforeToolCall` 中实现 WordHub 自己的权限层（路径白名单、写入审批）。

---

## 2. 底座对比与推荐

| 方案 | 关键事实【实】 | 适配度【议】 |
|---|---|---|
| **Pi agent-core + pi-ai** | MIT 1.0.0；多厂商含国产；钩子细；steer/followUp；不带多agent/权限 | ★★★★★ 薄执行层，编排由我们掌控 |
| Claude Agent SDK 0.3.x | Anthropic **商业条款**（非开源许可）；实际驱动 Claude Code 二进制；subagent 可用 `.claude/agents/*.md` 定义；嵌套默认3层、并发上限20、`maxBudgetUsd`；第三方产品不得提供 claude.ai 登录（[overview](https://code.claude.com/docs/en/agent-sdk/overview)） | ★★ 仅Claude模型、偏编码；可作为可选"外部harness Agent" |
| OpenAI Agents SDK JS 0.18 | MIT；**handoff** 与 **agents-as-tools** 两种模式（[multi-agent](https://openai.github.io/openai-agents-js/guides/multi-agent/)） | ★★★ 概念清晰，部分功能绑定 Responses API |
| Mastra core 1.74 | Apache-2.0；**agent network 已弃用**，迁移到 supervisor agents；记忆分 message history / observational / working / semantic recall（[memory](https://mastra.ai/docs/memory/overview)） | ★★★ 偏重；记忆设计值得借鉴 |
| Vercel AI SDK 7.0 | Apache-2.0；`ToolLoopAgent`；实验性 `HarnessAgent` 可驱动 Claude Code / Codex / **Pi**（[harnesses](https://ai-sdk.dev/docs/ai-sdk-harnesses/overview)） | ★★★ 适合前端流式UI，不做编排核心 |
| LangGraph JS 1.4 | MIT；四种模式 subagents/handoffs/router/custom workflow；官方原话"a single agent... can often achieve similar results"（[docs](https://docs.langchain.com/oss/javascript/langchain/multi-agent)） | ★★★ DAG/检查点成熟，但抽象厚、绑定LangChain |

**推荐【议】**：**Pi agent-core + pi-ai 作为执行层**。`transformContext` 注入分层记忆、`beforeToolCall` 做权限、`steer` 实现"质询打断/用户插话"，且不预设多agent立场。

持久层两条路：
- **A（MVP采用）**：自建 SQLite 事件日志，但**数据模型对齐 pi-durable 的 Entry/Commit/Task 概念**，以后可平滑切换。
- **B（并行spike）**：直接用 pi-durable，锁精确版本，接受API变动。

不以 pi-coding-agent 为底座（它是编码CLI），只借鉴其 skills 加载器与 SessionManager 树状会话思路。所有 Pi API 包在内部 adapter 后面。

---

## 3. 多Agent组织模式

### 3.1 参考模式【实】

- **Orchestrator-worker**（[Anthropic multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)）：主agent并行派子agent，内部评测比单agent高90.2%；token用量解释80%方差；**多agent约为普通聊天15倍token**；子agent产出写外部存储、只回传轻量引用（避免"传话游戏"）；计划要外存；按复杂度伸缩投入；同步等待是瓶颈。
- **Handoff / agents-as-tools**：OpenAI Agents SDK。
- **SelectorGroupChat**（[AutoGen](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/selector-group-chat.html)）：广播发言，LLM按 roles/participants/history 选下一位；`selector_func` 可代码化；可组合终止条件。**AutoGen 已进入维护模式**，官方建议迁移到 Microsoft Agent Framework。
- **多智能体辩论**（[Du et al., ICML 2024](https://arxiv.org/abs/2305.14325)）能提升事实性；但 **MAST**（[arXiv 2503.13657](https://arxiv.org/abs/2503.13657)）发现多agent相对单agent收益常很小，14类失败模式中"验证不足"是主要来源。
- **A2A v1.0.1**（Apache-2.0，[a2aproject/A2A](https://github.com/a2aproject/A2A)）：Agent Card、Task生命周期、Message/Part、Artifact、contextId。
- **黑板/共享工作区**：Anthropic 的"产出写外部存储、传引用"即其实践。

**对WordHub的启示**：验证环节（事实表、主张-证据检查）比"多加角色"更值得投入；默认"单写手 + 按需评审"，质询由规则触发而非自由辩论。

### 3.2 WordHub 组织设计【议】

```text
                     ┌──────────────── 群聊视图（只渲染 visibility=room 的事件）
                     │
用户 ──@/消息──▶ 协调器（代码优先selector：规则路由 + DAG；规则无法判断时回退LLM选择）
                     │
       ┌─────────┬───┴─────┬─────────┬──────────┐
     纲领      写手      编辑      评审      观察者      ← 每个是一个 Pi Agent 实例（角色配置）
       │         │         │         │          │
       └─────────┴── 共享工作区（黑板）：Artifact / Revision / 事实表 / 图谱 / 事件日志 ──┘
```

1. **群聊是视图，调度归协调器**。Agent间私下质询默认折叠为"讨论线程"，用户可展开。协调器本身可以由"纲领"兼任LLM判断部分，但状态机是代码。
2. **@机制**
   - `@写手`：直接投递，跳过selector。
   - `@all`：并行扇出，纲领汇总。
   - 未@：交纲领/协调器判断。
   - Agent 运行中用户补充：`steer()`；排后的需求：`followUp()`。
3. **质询协议**（有界：默认最多2轮，超出升级用户裁决；借用A2A的 contextId/Task/Artifact 语义）：

```json
{"id":"evt_01J..","type":"challenge","contextId":"proj42/ch3","threadId":"thr_9",
 "from":"reviewer","to":"writer","round":1,"maxRounds":2,
 "target":{"artifactId":"draft_ch3@v5","span":[1200,1480]},
 "claim":"第3章称主角左手受伤，与设定集 char.lin.injury(右手) 冲突",
 "evidenceRefs":["bible://characters/lin#injury","evt_00X.."],
 "severity":"blocking","requestedAction":"revise|justify","deadlineTurns":1}
```

   回应 `type:"challenge_reply"`，含 `stance: accept|rebut|partial`、`patchRef`、`evidenceRefs`。第2轮仍 `rebut` → 生成 `type:"escalation"` 卡片给用户；`blocking` 未解决时DAG节点不能进入 done。
   除"质询"外还应有 **`question`**（不确定事项的非阻塞询问，如写手问纲领"第5章是否允许主角离开长安"），同样有界。
4. **查阅对话记录**：分层，不全量灌入。
   - 默认注入：本线程最近N条 + 所在room滚动摘要。
   - 工具 `history.search(query, {agent,type,timeRange})`：BM25 + 向量混合检索。
   - 工具 `history.get(eventIds)`：按引用取原文。
   - 质询中的 `evidenceRefs` 一律取原文，避免摘要失真。
5. **用户自建Agent**：`<项目>/.wordhub/agents/<name>/AGENT.md`，frontmatter 兼容 Agent Skills 风格：

```markdown
---
name: methods-reviewer
displayName: 方法学评审
description: 审查基金申请书的研究方法与可行性。被@或纲领分派"评审/方法"任务时使用。
avatar: { glyph: 方, color: "#4F6D8A" }
model: { provider: deepseek, id: deepseek-v4-pro }
reasoning: high
fallback: { provider: deepseek, id: deepseek-flash }
tools: [history.search, memory.read, claims.query, doc.read]
write: none            # none | propose | write，见 §3.4
memoryScopes: { read: [bible, claims, summaries], write: [notes/methods-reviewer] }
canChallenge: [writer, planner]
maxTurns: 12
skills: [nsfc-review-rubric]
---
你是严格的方法学评审……（system prompt）
```

   加载时校验工具白名单；默认只能写自己的 `notes/`。内置五角色也用同一格式定义（"角色是配置不是代码"），便于用户复制修改。UI 提供表单式创建器，背后生成该文件。

### 3.3 内置角色职责边界【议】

| 角色 | 职责 | 写权限 | 典型触发 |
|---|---|---|---|
| 纲领 | 首轮问询、大纲/计划、验收标准；兼任协调器的LLM判断 | 大纲、计划JSON（需用户确认） | 新任务、偏离升级 |
| 写手 | 按节/章生成候选稿（patch） | 仅提交候选revision | DAG节点 |
| 编辑 | 文本/语法/格式/字数/引用格式；低成本自修 | 候选patch | 写手完成后 |
| 评审 | 原子事实核验、偏纲领检测、证据缺口；**不负责润色** | 无（只发 challenge / report） | 每章/每节完成后立即 |
| 观察者 | 抽取人物/概念/事件/主张，维护图谱与事实表 | 图谱 `proposed` 条目 | 每章完成、导入参考文献 |
| 引文核对（内置辅助） | 回原PDF校验 quote 与页码 | 无 | 科研/基金任务 |

### 3.4 写入权限分级

已定决策：用户自建Agent**可以写正文**。用三级权限统一内置与自建Agent：

| 级别 | 含义 | 默认授予 |
|---|---|---|
| `none` | 只读 | 评审、引文核对 |
| `propose` | 提交候选 patch，出现在群聊/文档边注中等待用户或协调器批准 | 观察者（图谱条目）、自建Agent的默认值 |
| `write` | 直接生效 | 写手、编辑；用户可给任意自建Agent开启 |

`write` 的约束（保证"能写"不等于"会写坏"）：
- 每次写入都是带 `author`、`parent_revision`、`event_id` 的 **revision**，文档工作台可按Agent筛选、逐条或整批**撤销**。
- 协调器按**段落/章节粒度加锁并串行化**；`parent_revision` 落后时自动 rebase，冲突则降级为 `propose`。
- 写入范围受 AGENT.md 的 `writeScopes` 限制（如只能写 `chapters/**`，不能改 `.wordhub/bible/`）。
- 用户可对单个Agent开启"写前确认"，或在 Run 级别切到"全部只提议"。
- 链接文件夹的磁盘写入仍走"临时文件 → 校验 → 原子替换 → 快照"。

AGENT.md 对应字段：

```yaml
write: write            # none | propose | write
writeScopes: ["chapters/**"]
confirmBeforeWrite: false
```

---

## 4. 项目共享记忆

### 4.1 参考【实】

- **Letta**：memory block（label/description/value/limit），可挂到多个agent共享，整块替换、last-write-wins，可设 read_only（[docs](https://docs.letta.com/guides/agents/memory-blocks)）。V1 server 已退役，源码迁至 letta-code。
- **mem0**（Apache-2.0）：新版单次 ADD-only 抽取，只累加不覆盖。
- **Graphiti/Zep**：双时态知识图谱，事实失效不删除，可查任意时间点；混合检索。**仅Python，需 Neo4j/FalkorDB/Neptune**，对桌面端过重。
- **Claude memory tool**（`memory_20250818`）：纯客户端执行，view/create/str_replace/insert/delete/rename，`/memories` 前缀，需防路径穿越（[docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)）。

### 4.2 WordHub 分层记忆【议】

统一存在项目 SQLite（FTS5 + sqlite-vec），由 `transformContext` 按层注入：

| 层 | 内容 | 写入 | 注入 |
|---|---|---|---|
| L0 项目圣经 | 设定集、人物卡、世界规则；科研的研究问题/贡献/术语表；基金指南摘要。Markdown文件，存于链接文件夹 `.wordhub/bible/`（用户可直接编辑） | 用户或纲领；改动需确认，留版本 | 必要部分常驻 |
| L1 事实表 | 三元组（主体, 属性, 值, `valid_from/to`, `revealed_at`, `sourceRef`, status）；科研为 `claims` 表 | 观察者每章抽取 → `proposed` → 确认后 `accepted`；追加不覆盖 | 按当前章节/时间点查询 |
| L2 摘要 | 章节、会话、讨论线程滚动摘要 | 后台生成 | 默认注入 |
| L3 检索 | 正文、对话、参考文献 chunk 索引（BM25 + 向量） | 自动 | 工具按需取 |
| L4 图谱 | 人物关系、伏笔链、论证图、引用网络 | 由 L1 物化 | 可视化 + 工具查询 |

- **小说一致性**：评审用 L1 做硬冲突检测（"右手伤"在3–8章有效期内不能变左手、已死角色出场、称谓前后不一）；伏笔单独建表（open/closed）。
- **科研主张-证据**：`claims{claimId, text, strength, evidence[{docId,page,quote,type:data|citation|experiment}], status}`；正文每个强主张至少挂1条证据；引文核对agent回原PDF校验。
- **"注入透明"**：借鉴 NovelAI Context Viewer，UI 可查看每次调用实际注入了哪些记忆层/条目。
- **Session隔离**：L0/L1/L3/L4 项目级共享；L2 中会话摘要与线程记录按 session 隔离，跨 session 只能通过 `history.search` 显式检索。

---

## 5. 桌面壳：Electron

【实】Electron 44.5.1 内置 **Node 24.21**，满足 Pi ≥22.19，自带 `node:sqlite`；`utilityProcess.fork()` 启动带 Node 与 MessagePort 的子进程。Tauri 2.12 跑 Node 须打包 sidecar（官方指南用 pkg），并配置 shell 插件权限。

【议】选 **Electron**：
- 编排 worker 放 `utilityProcess`，与UI隔离、崩溃可重启；单进程持有 SQLite，正好符合 pi-durable 单进程约束。
- LibreOffice / Pandoc / Tectonic 用 `child_process` 统一调度（超时、取消、日志）。
- 自带 Chromium，PDF.js / ProseMirror / CodeMirror 渲染一致；Tauri 依赖系统 WebView2，且需维护 Rust + Node + React 三栈，体积优势被 Node sidecar 吃掉大半。

进程划分：主进程（窗口、路径授权、IPC）／渲染进程（React，无密钥、无文件直写）／utilityProcess（协调器 + Pi agents + SQLite + 外部工具调度）。

---

## 7. 模型与思考强度配置

已定决策：基于 pi-ai 的 provider 能力；用户自配 API key、模型列表、思考强度；每个Agent可独立配置模型；开发测试用 DeepSeek V4。

### 7.1 pi-ai 能力核查（读取 1.0.0 包内容 + 实测）【实】

- 内置 `deepseekProvider()`：baseUrl `https://api.deepseek.com`，OpenAI-compatible 接口，读取环境变量 **`DEEPSEEK_API_KEY`**。
- 内置 DeepSeek 模型（`providers/data/deepseek.json`）：

| id | 名称 | 思考强度映射 `thinkingLevelMap` | 上下文 / 最大输出 | 价格（$/M tokens，入/出/缓存读） |
|---|---|---|---|---|
| `deepseek-v4-pro` | DeepSeek V4 Pro | 仅 `high`、`max` | 1M / 384k | 1.32 / 3.96 / 0.044 |
| `deepseek-flash` | DeepSeek V4.1 Flash | `low`、`high`、`max` | 1M / 384k | 0.30 / 1.20 / 0.006 |

- 思考强度统一为 `off | minimal | low | medium | high | xhigh | max`；`thinkingLevelMap` 中为 `null` 的级别不受支持；`getSupportedThinkingLevels(model)` 可直接生成UI下拉项。
- 自定义 provider：`createProvider({ id, baseUrl, auth, models, api })` 可接入任意 OpenAI 兼容端点（用户自建模型列表）；`createModels({ credentials })` 可注入自定义 `CredentialStore`（WordHub 用 Electron `safeStorage` 加密存储 key）。
- **实测（2026-10-03，本机 Node 24.11，`streamSimple` + `reasoning:'high'`）**：
  - `deepseek-v4-pro`：首字约2.0s，总2.1s，输出含思考 token，单次约 $0.0005。
  - `deepseek-flash`：首字约1.0s，总1.1s，单次约 $0.00014。
  - 两者均正常流式返回 `thinking_delta` 与 `text_delta`，`done` 事件带 usage 与 cost——可直接用于 Run 级费用累计与预估。

### 7.2 配置模型【议】

```text
Settings › 模型
├─ Providers：内置列表（DeepSeek / Kimi / Qwen / MiniMax / Anthropic / OpenAI / OpenRouter …）
│    每个：启用开关、API key（safeStorage 加密，不进渲染进程/日志）、baseUrl 覆盖、可用模型勾选
├─ 自定义 Provider：名称、baseUrl、API 格式（OpenAI-compatible…）、模型列表（id、上下文、是否推理、价格）
└─ 默认值：项目默认模型 + 默认思考强度

Agent 配置（AGENT.md frontmatter 或 UI 表单）
  model:     { provider: deepseek, id: deepseek-v4-pro }
  reasoning: high                          # 仅显示该模型支持的级别
  fallback:  { provider: deepseek, id: deepseek-flash }
```

解析优先级：**单条消息临时指定 > Agent 配置 > 项目默认 > 全局默认**。

开发期默认分配（DeepSeek V4）：

| 角色 | 模型 | 思考强度 | 理由 |
|---|---|---|---|
| 纲领 | `deepseek-v4-pro` | high | 规划质量决定全局 |
| 写手 | `deepseek-v4-pro` | high | 正文质量 |
| 评审 | `deepseek-v4-pro` | max | 一致性核验需要深推理 |
| 编辑 | `deepseek-flash` | low | 语言/格式修订，量大 |
| 观察者（抽取） | `deepseek-flash` | low | 批量抽取；按 [graph-design.md](graph-design.md) 的估算，50万字约3–4M tokens，用 flash 约 $1–2 |

## 8. 风险

- Pi 1.0 刚发布，pi-durable 实验性，仓库对新贡献者自动关闭 issue/PR → 锁精确版本 + adapter 隔离。
- 多agent成本约15倍 → 默认"单写手 + 按需评审"，质询规则触发；每次 Run 前显示预估 token。
- 依据 MAST，**验证比角色数量更重要**。
