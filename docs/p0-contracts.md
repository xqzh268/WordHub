# P0 数据契约与配置格式

P0契约以JSON Schema Draft 2020-12保存于[`schemas/`](../schemas)。所有持久化对象携带`schemaVersion`；未知字段由读取端拒绝，新增字段必须提升schema版本或经过向后兼容的迁移。

## 事件、任务与版本

`Event`是追加日志的唯一事实来源。事件ID全局唯一，`seq`在项目内单调递增；`causationId`指向直接触发事件，`correlationId`串起一次Run，`idempotencyKey`用于重试去重。事件payload只描述已经发生的事实，模型输出先用`revision.proposed`或`fact.proposed`表达。

`Task`是Run的DAG节点。任务开始时冻结`contextSnapshotId`，恢复时从最近`checkpoint`继续。任务只能引用前置任务的输出或显式的项目级引用，`waiting_approval`是可恢复状态而不是失败。

`Revision`不可变且带`parentRevisionId`。`candidate`经协调器和（需要时）用户批准后成为`current`；撤销通过新事件和新版本完成，不能删除历史版本。`write` Agent也只能写在声明的`writeScopes`内。

## 事实与图谱

`Fact`是最小原子命题，至少有一个含文件哈希的`sourceRefs`。`validFrom/validTo`表达故事或研究对象内部的有效期；`revealedAt`表达读者在何处获知，用于防剧透过滤。`status=accepted && canon=true`才进入正史事实查询。

`Graph`是Fact的可视化投影。节点和边都保存来源、置信度、断言者与状态；推演图必须`canon=false`并带`branchId`，只能通过用户采纳事件转化为大纲候选，不能自动合并到正史。

## AGENT.md

Agent定义放在`.wordhub/agents/<name>/AGENT.md`。frontmatter遵循[`agent-config.schema.json`](../schemas/agent-config.schema.json)，正文是系统提示。工具、写入范围和记忆范围均采用最小权限；`write`的含义是受协调器串行化和版本审计约束的直接生效，并不允许绕过版本系统。

```markdown
---
name: methods-reviewer
displayName: 方法学评审
description: 审查研究方法、可行性与证据缺口。
avatar: { glyph: 审, color: "#4F6D8A" }
model: { provider: deepseek, id: deepseek-v4-pro, reasoning: high }
fallback: { provider: deepseek, id: deepseek-flash, reasoning: low }
tools: [history.search, memory.read, claims.query, doc.read]
write: none
writeScopes: []
confirmBeforeWrite: true
memoryScopes: { read: [bible, claims, summaries], write: [] }
canChallenge: [writer, planner]
maxTurns: 12
skills: [nsfc-review-rubric]
---
你是严格的方法学评审。每个结论都要给出证据锚点；不确定时提出有限轮次的质询。
```

## 模型配置

项目配置放在`.wordhub/models.json`，密钥只保存为Electron `safeStorage`返回的`credentialRef`，不进入JSON、渲染进程、事件payload或日志。解析优先级为“单条消息临时指定 > Agent配置 > 项目默认 > 全局默认”。模型UI应依据`supportedReasoning`过滤推理强度，不接受供应商不支持的值。

```json
{
  "schemaVersion": 1,
  "defaults": { "provider": "deepseek", "id": "deepseek-v4-pro", "reasoning": "high" },
  "providers": [{
    "id": "deepseek", "label": "DeepSeek", "kind": "builtin", "enabled": true,
    "credentialRef": "safe:deepseek:default",
    "models": [{ "id": "deepseek-v4-pro", "label": "DeepSeek V4 Pro", "contextWindow": 1000000, "maxOutputTokens": 384000, "supportsReasoning": true, "supportedReasoning": ["high", "max"], "pricing": { "inputUsdPerMillion": 1.32, "outputUsdPerMillion": 3.96, "cacheReadUsdPerMillion": 0.044 } }]
  }]
}
```
