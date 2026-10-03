import type { Event } from "@wordhub/contracts";

export type ProjectedTool = {
  id: string;
  name: string;
  status: "running" | "done" | "error";
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
      options: ["批准", "拒绝"],
      runId: event.runId,
      eventId: event.id,
    });
    return state;
  }
  if (event.type === "approval.granted" || event.type === "approval.rejected") {
    const approval = [...state.items]
      .reverse()
      .find(
        (item): item is Extract<ProjectedChatItem, { kind: "approval" }> =>
          item.kind === "approval" && item.runId === event.runId,
      );
    if (approval)
      approval.resolved = event.type === "approval.granted" ? "批准" : "拒绝";
    return state;
  }
  if (!event.runId) return state;
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
