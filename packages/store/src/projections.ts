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
      status: "thinking" | "streaming" | "done" | "aborted" | "error";
      text: string;
      tools: ProjectedTool[];
      runId: string;
      error?: string;
      eventId: string;
    };

type RunProjection = Extract<ProjectedChatItem, { kind: "agent" }>;
const timestamp = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const payloadOf = (event: Event): Record<string, unknown> =>
  event.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : {};

/** 事件日志是唯一事实来源；在线事件与重放事件都经过同一个纯投影函数。 */
export function projectChat(events: readonly Event[]): ProjectedChatItem[] {
  const items: ProjectedChatItem[] = [];
  const runs = new Map<string, RunProjection>();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const payload = payloadOf(event);
    if (event.type === "chat.user_message" || event.type === "run.prompt") {
      const text =
        typeof payload.text === "string"
          ? payload.text
          : typeof payload.prompt === "string"
            ? payload.prompt
            : "";
      if (text)
        items.push({
          kind: "user",
          id: event.id,
          at: timestamp(event.occurredAt),
          text,
          eventId: event.id,
        });
      continue;
    }
    if (!event.runId) continue;
    let run = runs.get(event.runId);
    if (!run) {
      run = {
        kind: "agent",
        id: `agent_${event.runId}`,
        at: timestamp(event.occurredAt),
        agentId:
          typeof payload.agentId === "string"
            ? payload.agentId
            : event.actor.id,
        status: "thinking",
        text: "",
        tools: [],
        runId: event.runId,
        eventId: event.id,
      };
      runs.set(event.runId, run);
      items.push(run);
    }
    run.eventId = event.id;
    if (event.type === "run.text_delta") {
      run.status = "streaming";
      if (typeof payload.delta === "string") run.text += payload.delta;
    } else if (event.type === "run.tool_started")
      run.tools.push({
        id:
          typeof payload.toolCallId === "string"
            ? payload.toolCallId
            : event.id,
        name: typeof payload.tool === "string" ? payload.tool : "tool",
        status: "running",
      });
    else if (event.type === "run.tool_finished") {
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
      if (typeof payload.text === "string" && !run.text)
        run.text = payload.text;
    } else if (event.type === "run.aborted") run.status = "aborted";
    else if (event.type === "run.error") {
      run.status = "error";
      run.error =
        typeof payload.error === "string" ? payload.error : "运行失败";
    }
  }
  return items;
}
