export type AgentMeta = {
  id: string;
  name: string;
  glyph: string;
  color: string;
  role: string;
  model: string;
  reasoning: string;
};

/** 内置五角色的展示元数据。模型分配遵循 docs/research/multi-agent-orchestration.md §7.2。 */
export const AGENTS: AgentMeta[] = [
  {
    id: "planner",
    name: "纲领",
    glyph: "纲",
    color: "var(--agent-planner)",
    role: "问询需求，规划大纲与人物",
    model: "deepseek-v4-pro",
    reasoning: "high",
  },
  {
    id: "writer",
    name: "写手",
    glyph: "写",
    color: "var(--agent-writer)",
    role: "按章撰写正文",
    model: "deepseek-v4-pro",
    reasoning: "high",
  },
  {
    id: "editor",
    name: "编辑",
    glyph: "编",
    color: "var(--agent-editor)",
    role: "语言、格式与字数校验",
    model: "deepseek-flash",
    reasoning: "low",
  },
  {
    id: "reviewer",
    name: "评审",
    glyph: "审",
    color: "var(--agent-reviewer)",
    role: "核验设定，纠正偏离大纲",
    model: "deepseek-v4-pro",
    reasoning: "max",
  },
  {
    id: "observer",
    name: "史官",
    glyph: "史",
    color: "var(--agent-observer)",
    role: "抽取人物、事实与关系",
    model: "deepseek-flash",
    reasoning: "low",
  },
];

/** 项目里自建的 Agent（来自 .wordhub/agents），由侧栏读到后登记；内置的在上面的 AGENTS。 */
let customAgents: AgentMeta[] = [];
export function registerCustomAgents(list: AgentMeta[]): void {
  customAgents = list;
}
export const allAgents = (): AgentMeta[] => [...AGENTS, ...customAgents];

/** @ 名单里列出的 Agent：史官只作为“定稿”动作的内部步骤，不单独对话（侧栏仍列出，可查看和切换模型）。 */
export const listedAgents = (): AgentMeta[] =>
  allAgents().filter((agent) => agent.id !== "observer");

/** 未登记的 id（例如已删除的自建 Agent 留在历史里）显示为中性占位，不冒充别的 Agent。 */
const unknownAgent = (id: string): AgentMeta => ({
  id,
  name: id,
  glyph: "?",
  color: "var(--ink-4)",
  role: "已不存在的 Agent",
  model: "",
  reasoning: "",
});

export const agentById = (id: string): AgentMeta =>
  allAgents().find((agent) => agent.id === id) ?? unknownAgent(id);

export const agentByName = (name: string): AgentMeta | undefined =>
  allAgents().find((agent) => agent.name === name);

/** 解析消息开头的 @mention，未指定时交给纲领（协调器默认入口）。 */
export function routeMessage(text: string): { agent: AgentMeta; body: string } {
  const match = /^@(\S+)\s*/.exec(text);
  const target = match?.[1] ? agentByName(match[1]) : undefined;
  return target
    ? { agent: target, body: text.slice(match![0].length) }
    : { agent: AGENTS[0]!, body: text };
}

const TOOL_LABELS: Record<string, string> = {
  wordhub_echo: "回声工具",
  "doc.read": "读取文档",
  "doc.write": "写入文档",
  "bible.read": "读取项目圣经",
  "history.search": "检索对话记录",
};
export const toolLabel = (name: string): string => TOOL_LABELS[name] ?? name;

const TASK_KIND_LABELS: Record<string, string> = {
  write: "撰写",
  edit: "润色",
  review: "核验",
  rework: "返工",
  consult: "征询意见",
  summary: "汇总",
  observe: "定稿整理",
};
/** 任务行的显示名：「写手 · 撰写」。 */
export const taskLabel = (agentId?: string, kind?: string): string => {
  const agent = agentId
    ? allAgents().find((item) => item.id === agentId || item.name === agentId)
    : undefined;
  const action = kind ? (TASK_KIND_LABELS[kind] ?? kind) : "";
  return [agent?.name, action].filter(Boolean).join(" · ") || "Agent任务";
};

export const WORKER_LABEL: Record<string, string> = {
  offline: "后台未启动",
  starting: "后台启动中",
  ready: "后台待命",
  busy: "后台工作中",
  stopped: "后台已停止",
  crashed: "后台已崩溃",
};

/** settings.models 的结果里，项目级（自建）Agent 对应的展示信息。 */
export function customAgentsFromModels(
  agents: Array<{
    id: string;
    displayName: string;
    description?: string;
    avatar?: { glyph?: string; color?: string };
    model: { id: string; reasoning: string };
    source: string;
  }>,
): AgentMeta[] {
  return agents
    .filter((agent) => agent.source === "project")
    .map((agent) => ({
      id: agent.id,
      name: agent.displayName,
      glyph: agent.avatar?.glyph || Array.from(agent.displayName)[0] || "?",
      color: agent.avatar?.color || "var(--ink-3)",
      role: agent.description ?? "自建 Agent",
      model: agent.model.id,
      reasoning: agent.model.reasoning,
    }));
}
