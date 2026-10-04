import type { Event } from "@wordhub/contracts";

export type ProjectedTool = {
  id: string;
  name: string;
  status: "running" | "done" | "error";
};
export type ProjectedContext = {
  id: string;
  kind: string;
  sourcePath?: string;
  estimatedTokens: number;
};
export type ProjectedChatItem =
  | { kind: "user"; id: string; at: number; text: string; eventId: string }
  | {
      kind: "agent";
      id: string;
      at: number;
      agentId: string;
      status:
        | "thinking"
        | "streaming"
        | "done"
        | "aborted"
        | "interrupted"
        | "waiting_approval"
        | "error";
      text: string;
      tools: ProjectedTool[];
      runId: string;
      model?: string;
      reasoning?: string;
      usage?: { input: number; output: number; total: number; cost?: number };
      context?: ProjectedContext[];
      error?: string;
      eventId: string;
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
      eventId: string;
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
      eventId: string;
    }
  | {
      kind: "task";
      id: string;
      at: number;
      taskId: string;
      label: string;
      status: "ready" | "running" | "succeeded" | "failed" | "blocked";
      eventId: string;
    }
  | {
      kind: "notice";
      id: string;
      at: number;
      text: string;
      tone?: "warn";
      eventId: string;
    };

type RunProjection = Extract<ProjectedChatItem, { kind: "agent" }>;
export type ChatProjectionState = {
  items: ProjectedChatItem[];
  runs: Map<string, RunProjection>;
};
const timestamp = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const payloadOf = (event: Event): Record<string, unknown> =>
  event.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : {};

export function createChatProjectionState(): ChatProjectionState {
  return { items: [], runs: new Map() };
}

/** 将一个事件折叠进在线投影；全量重放也只调用这一条路径。 */
export function applyChatEvent(
  state: ChatProjectionState,
  event: Event,
): ChatProjectionState {
  const payload = payloadOf(event);
  if (event.type === "chat.user_message" || event.type === "run.prompt") {
    const text =
      typeof payload.text === "string"
        ? payload.text
        : typeof payload.prompt === "string"
          ? payload.prompt
          : "";
    if (text)
      state.items.push({
        kind: "user",
        id: event.id,
        at: timestamp(event.occurredAt),
        text,
        eventId: event.id,
      });
    return state;
  }
  if (event.type === "approval.requested") {
    const tool = typeof payload.tool === "string" ? payload.tool : "写入工具";
    state.items.push({
      kind: "approval",
      id: event.id,
      at: timestamp(event.occurredAt),
      title: "Agent请求写入",
      body: `${tool}需要你的确认后才能继续。`,
      preview:
        typeof payload.contentPreview === "string"
          ? payload.contentPreview
          : undefined,
      path: typeof payload.path === "string" ? payload.path : undefined,
      contentLength:
        typeof payload.contentLength === "number"
          ? payload.contentLength
          : undefined,
      diff:
        payload.diff && typeof payload.diff === "object"
          ? {
              addedLines: Number(
                (payload.diff as Record<string, unknown>).addedLines ?? 0,
              ),
              removedLines: Number(
                (payload.diff as Record<string, unknown>).removedLines ?? 0,
              ),
            }
          : undefined,
      options: ["批准", "拒绝"],
      runId: event.runId,
      eventId: event.id,
    });
    return state;
  }
  if (event.type === "permission.denied") {
    state.items.push({
      kind: "notice",
      id: event.id,
      at: timestamp(event.occurredAt),
      text:
        typeof payload.reason === "string"
          ? `权限被拒：${payload.reason}`
          : "权限被拒：该工具或路径不在Agent授权范围内。",
      tone: "warn",
      eventId: event.id,
    });
    return state;
  }
  if (event.type === "challenge.raise") {
    const threadId =
      typeof payload.threadId === "string" ? payload.threadId : event.id;
    state.items.push({
      kind: "thread",
      id: threadId,
      at: timestamp(event.occurredAt),
      from: event.actor.id,
      to: typeof payload.target === "string" ? payload.target : "planner",
      round: Number(payload.round ?? 1),
      maxRounds: 2,
      severity: payload.severity === "minor" ? "minor" : "blocking",
      claim: typeof payload.claim === "string" ? payload.claim : "",
      replies: [],
      eventId: event.id,
    });
    return state;
  }
  if (event.type === "challenge.reply") {
    const threadId =
      typeof payload.threadId === "string" ? payload.threadId : undefined;
    const thread = threadId
      ? [...state.items]
          .reverse()
          .find(
            (item): item is Extract<ProjectedChatItem, { kind: "thread" }> =>
              item.kind === "thread" && item.id === threadId,
          )
      : undefined;
    if (thread) {
      thread.round = Number(payload.round ?? thread.round);
      thread.replies.push({
        agentId: event.actor.id,
        text: typeof payload.text === "string" ? payload.text : "",
      });
      thread.eventId = event.id;
    }
    return state;
  }
  if (event.type === "escalation.created") {
    state.items.push({
      kind: "approval",
      id: event.id,
      at: timestamp(event.occurredAt),
      title: "质询需要你的裁决",
      body:
        typeof payload.reason === "string"
          ? payload.reason
          : "两个Agent仍未达成一致，请选择后继续工作流。",
      options: ["接受修改", "保留原文"],
      runId: event.runId,
      eventId: event.id,
    });
    return state;
  }
  if (event.type.startsWith("task.")) {
    const taskId =
      typeof payload.taskId === "string" ? payload.taskId : undefined;
    if (!taskId) return state;
    const status =
      event.type === "task.succeeded"
        ? "succeeded"
        : event.type === "task.failed"
          ? "failed"
          : event.type === "task.blocked"
            ? "blocked"
            : event.type === "task.started"
              ? "running"
              : "ready";
    const existing = state.items.find(
      (item): item is Extract<ProjectedChatItem, { kind: "task" }> =>
        item.kind === "task" && item.taskId === taskId,
    );
    if (existing) {
      existing.status = status;
      existing.eventId = event.id;
    } else {
      state.items.push({
        kind: "task",
        id: `task_${taskId}`,
        at: timestamp(event.occurredAt),
        taskId,
        label: typeof payload.kind === "string" ? payload.kind : "Agent任务",
        status,
        eventId: event.id,
      });
    }
    return state;
  }
  if (
    event.type === "approval.granted" ||
    event.type === "approval.rejected" ||
    event.type === "approval.expired"
  ) {
    const approval = [...state.items]
      .reverse()
      .find(
        (item): item is Extract<ProjectedChatItem, { kind: "approval" }> =>
          item.kind === "approval" && item.runId === event.runId,
      );
    if (approval)
      approval.resolved =
        event.type === "approval.granted"
          ? "批准"
          : event.type === "approval.rejected"
            ? "拒绝"
            : "已过期，可重新发起";
    return state;
  }
  if (!event.runId) return state;
  const projectsRun = new Set([
    "run.text_delta",
    "run.tool_started",
    "run.tool_finished",
    "run.finished",
    "run.started",
    "run.usage",
    "context.injected",
    "run.aborted",
    "run.interrupted",
    "run.waiting_approval",
    "run.error",
  ]);
  if (!projectsRun.has(event.type)) return state;
  let run = state.runs.get(event.runId);
  if (!run) {
    run = {
      kind: "agent",
      id: `agent_${event.runId}`,
      at: timestamp(event.occurredAt),
      agentId:
        typeof payload.agentId === "string" ? payload.agentId : event.actor.id,
      status: "thinking",
      text: "",
      tools: [],
      runId: event.runId,
      eventId: event.id,
    };
    state.runs.set(event.runId, run);
    state.items.push(run);
  }
  run.eventId = event.id;
  if (event.type === "run.text_delta") {
    run.status = "streaming";
    if (typeof payload.delta === "string") run.text += payload.delta;
  } else if (event.type === "run.tool_started") {
    run.tools.push({
      id:
        typeof payload.toolCallId === "string" ? payload.toolCallId : event.id,
      name: typeof payload.tool === "string" ? payload.tool : "tool",
      status: "running",
    });
  } else if (event.type === "run.tool_finished") {
    const toolId =
      typeof payload.toolCallId === "string" ? payload.toolCallId : undefined;
    const target = [...run.tools]
      .reverse()
      .find((tool) =>
        toolId ? tool.id === toolId : tool.status === "running",
      );
    if (target) target.status = "done";
  } else if (event.type === "run.finished") {
    run.status = "done";
    if (typeof payload.text === "string" && !run.text) run.text = payload.text;
    if (typeof payload.model === "string") run.model = payload.model;
    if (typeof payload.reasoning === "string")
      run.reasoning = payload.reasoning;
  } else if (event.type === "run.started") {
    if (typeof payload.model === "string") run.model = payload.model;
    if (typeof payload.reasoning === "string")
      run.reasoning = payload.reasoning;
  } else if (event.type === "run.usage") {
    const usage =
      payload.usage && typeof payload.usage === "object"
        ? (payload.usage as Record<string, unknown>)
        : payload;
    const input = Number(usage.input ?? usage.inputTokens ?? 0);
    const output = Number(usage.output ?? usage.outputTokens ?? 0);
    const total = Number(usage.totalTokens ?? input + output);
    const cost =
      typeof usage.cost === "object" && usage.cost
        ? Number((usage.cost as Record<string, unknown>).total ?? 0)
        : Number(usage.costUsd ?? 0);
    run.usage = { input, output, total, cost };
  } else if (event.type === "context.injected") {
    const manifest = Array.isArray(payload.manifest) ? payload.manifest : [];
    run.context = manifest.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      if (typeof value.id !== "string" || typeof value.kind !== "string")
        return [];
      return [
        {
          id: value.id,
          kind: value.kind,
          sourcePath:
            typeof value.sourcePath === "string" ? value.sourcePath : undefined,
          estimatedTokens: Number(value.estimatedTokens ?? 0),
        },
      ];
    });
  } else if (event.type === "run.aborted") run.status = "aborted";
  else if (event.type === "run.interrupted") run.status = "interrupted";
  else if (event.type === "run.waiting_approval")
    run.status = "waiting_approval";
  else if (event.type === "run.error") {
    run.status = "error";
    run.error = typeof payload.error === "string" ? payload.error : "运行失败";
  }
  return state;
}

/** 事件日志是唯一事实来源；在线事件与重启事件都经过同一个纯折叠函数。 */
export function projectChat(events: readonly Event[]): ProjectedChatItem[] {
  const state = createChatProjectionState();
  for (const event of [...events].sort((a, b) => a.seq - b.seq))
    applyChatEvent(state, event);
  return state.items;
}
