import type { Ctx } from "./context";
import type { RunMessage } from "./messages";
import { toolLabel } from "../lib/agents";
import { uid } from "./util";

/** 处理本组消息；识别并处理返回 true，否则返回 false 交给下一组。 */
export function handleRun(
  { set, get, patchItems, patchRun }: Ctx,
  message: RunMessage,
): boolean {
  const runId = message.runId;
  switch (message.type) {
    case "run.started":
      if (runId) {
        const sessionId = get().activeSessionId;
        const exists = get().sessions.some(
          (session) =>
            session.id === sessionId &&
            session.items.some(
              (item) => item.kind === "agent" && item.runId === runId,
            ),
        );
        if (!exists)
          patchItems(sessionId, (items) => [
            ...items,
            {
              kind: "agent",
              id: uid("agent"),
              at: Date.now(),
              agentId: message.agentId ?? "writer",
              status: "thinking",
              text: "",
              tools: [],
              runId,
            },
          ]);
        patchRun(runId, (item) => ({
          ...item,
          status: "thinking",
          model: message.model,
          reasoningLevel: message.reasoning,
        }));
        set({ activeRunId: message.workflowId ?? runId });
      }
      break;
    case "context.injected":
      if (runId && message.manifest)
        patchRun(runId, (item) => ({ ...item, context: message.manifest }));
      break;
    case "run.text":
      if (runId && message.delta)
        patchRun(runId, (item) => ({
          ...item,
          status: "streaming",
          text: item.text + message.delta,
        }));
      break;
    case "run.tool_execution_start":
      if (runId) {
        patchRun(runId, (item) => ({
          ...item,
          tools: [
            ...item.tools,
            {
              id: uid("t"),
              name: message.tool ?? "tool",
              label: toolLabel(message.tool ?? "tool"),
              status: "running",
            },
          ],
        }));
      }
      break;
    case "run.reasoning_delta":
      if (runId && message.delta)
        patchRun(runId, (item) => ({
          ...item,
          reasoning: `${item.reasoning ?? ""}${message.delta}`,
          reasoningOpen: true,
        }));
      break;
    case "run.usage":
      if (runId && message.usage)
        patchRun(runId, (item) => ({
          ...item,
          usage: {
            input: message.usage!.input,
            output: message.usage!.output,
            total: message.usage!.totalTokens,
            cost: message.usage!.cost?.total,
          },
        }));
      break;
    case "run.tool_execution_end":
      if (runId) {
        patchRun(runId, (item) => {
          const index = item.tools.findLastIndex(
            (tool) => tool.name === message.tool && tool.status === "running",
          );
          if (index < 0) return item;
          return {
            ...item,
            tools: item.tools.map((tool, i) =>
              i === index ? { ...tool, status: "done" } : tool,
            ),
          };
        });
      }
      break;
    case "run.finished":
      if (runId) {
        patchRun(runId, (item) => ({
          ...item,
          status: "done",
          text: item.text || message.text || "",
          usage: message.usage
            ? {
                input: message.usage.input,
                output: message.usage.output,
                total: message.usage.totalTokens,
                cost: message.usage.cost?.total,
              }
            : item.usage,
        }));
        if (get().activeRunId === runId)
          set({ activeRunId: message.workflowId ?? null });
      }
      break;
    case "run.aborted":
      if (runId) {
        patchRun(runId, (item) => ({ ...item, status: "aborted" }));
        if (get().activeRunId === runId) set({ activeRunId: null });
      }
      break;
    case "run.interrupted":
      if (runId) {
        patchRun(runId, (item) => ({ ...item, status: "interrupted" }));
        if (get().activeRunId === runId) set({ activeRunId: null });
      }
      break;
    case "run.waiting_approval":
      if (runId) {
        patchRun(runId, (item) => ({
          ...item,
          status: "waiting_approval",
        }));
      }
      break;
    case "permission.denied":
      patchItems(get().activeSessionId, (items) => [
        ...items,
        {
          kind: "notice",
          id: uid("permission"),
          at: Date.now(),
          tone: "warn",
          text:
            typeof message.reason === "string"
              ? `权限被拒：${message.reason}`
              : "权限被拒：该工具或路径不在Agent授权范围内。",
        },
      ]);
      break;
    default:
      return false;
  }
  return true;
}
