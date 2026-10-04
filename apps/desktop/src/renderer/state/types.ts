/** 群聊视图模型：由 Agent 运行事件投影而来；事件日志才是事实来源（见 docs/p0-contracts.md）。 */

export type ToolStep = {
  id: string;
  name: string;
  label: string;
  status: "running" | "done" | "error";
  detail?: string;
  durationMs?: number;
};

export type AgentStatus =
  | "thinking"
  | "streaming"
  | "done"
  | "aborted"
  | "interrupted"
  | "waiting_approval"
  | "error";

export type ChatItem =
  | { kind: "user"; id: string; at: number; text: string }
  | {
      kind: "agent";
      id: string;
      at: number;
      agentId: string;
      status: AgentStatus;
      text: string;
      tools: ToolStep[];
      runId?: string;
      error?: string;
      /** 仅在本次运行中显示，不从事件日志恢复。 */
      reasoning?: string;
      reasoningOpen?: boolean;
      model?: string;
      reasoningLevel?: string;
      usage?: { input: number; output: number; total: number; cost?: number };
      context?: {
        id: string;
        kind: string;
        sourcePath?: string;
        estimatedTokens: number;
      }[];
      /** 编辑类改动的摘要，显示「查看差异 / 撤销」 */
      edit?: { label: string };
    }
  | {
      kind: "thread";
      id: string;
      at: number;
      from: string;
      to: string;
      round: number;
      maxRounds: number;
      severity: "blocking" | "minor";
      claim: string;
      replies: { agentId: string; text: string }[];
    }
  | {
      kind: "approval";
      id: string;
      at: number;
      title: string;
      body: string;
      options: string[];
      runId?: string;
      resolved?: string;
      preview?: string;
      path?: string;
      contentLength?: number;
      diff?: { addedLines: number; removedLines: number };
    }
  | { kind: "notice"; id: string; at: number; text: string; tone?: "warn" }
  | {
      kind: "task";
      id: string;
      at: number;
      taskId: string;
      label: string;
      status: "ready" | "running" | "succeeded" | "failed" | "blocked";
    };

export type Session = { id: string; title: string; items: ChatItem[] };

export type PaperParagraph = {
  id: string;
  text: string;
  /** 最近一次修订的作者，用于显示作者色条 */
  author?: string;
  /** 评审提出的未决质询 */
  flag?: string;
};

export type View = "workspace" | "references" | "graph" | "settings";
export type PaperTab = "paper" | "outline" | "facts";
export type WorkerState =
  | "offline"
  | "starting"
  | "ready"
  | "busy"
  | "stopped"
  | "crashed";
