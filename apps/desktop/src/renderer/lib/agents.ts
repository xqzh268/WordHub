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
    model: "deepseek-flash",
    reasoning: "low",
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
    reasoning: "high",
  },
  {
    id: "observer",
    name: "观察者",
    glyph: "观",
    color: "var(--agent-observer)",
    role: "抽取人物、事实与关系",
    model: "deepseek-flash",
    reasoning: "low",
  },
];

export const agentById = (id: string): AgentMeta =>
  AGENTS.find((agent) => agent.id === id) ?? AGENTS[0]!;

export const agentByName = (name: string): AgentMeta | undefined =>
  AGENTS.find((agent) => agent.name === name);

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

export const WORKER_LABEL: Record<string, string> = {
  offline: "后台未启动",
  starting: "后台启动中",
  ready: "后台待命",
  busy: "后台工作中",
  stopped: "后台已停止",
  crashed: "后台已崩溃",
};
