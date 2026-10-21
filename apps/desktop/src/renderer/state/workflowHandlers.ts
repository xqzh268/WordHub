import type { Ctx } from "./context";
import type { RunMessage } from "./messages";
import type { ChatItem } from "./types";
import { taskLabel } from "../lib/agents";
import { uid } from "./util";

/** 处理本组消息；识别并处理返回 true，否则返回 false 交给下一组。 */
export function handleWorkflow(
  { set, get, patchItems, patchRun }: Ctx,
  message: RunMessage,
): boolean {
  const runId = message.runId;
  switch (message.type) {
    case "workflow.started":
      if (runId) set({ activeRunId: runId });
      patchItems(get().activeSessionId, (items) => [
        // 发送时放的“正在构思”占位气泡属于父运行；工作流由各节点任务承担，不再需要它。
        ...items.filter(
          (item) =>
            !(
              item.kind === "agent" &&
              item.runId === runId &&
              item.status === "thinking" &&
              !item.text &&
              item.tools.length === 0
            ),
        ),
        {
          kind: "notice",
          id: uid("workflow"),
          at: Date.now(),
          text: `${message.label ?? "工作流"}已启动 · 预估${Number((message.estimate as { costUsd?: number } | undefined)?.costUsd ?? 0).toFixed(4)}美元`,
        },
      ]);
      break;
    case "workflow.finished":
      if (runId && get().activeRunId === runId) set({ activeRunId: null });
      patchItems(get().activeSessionId, (items) => [
        ...items,
        {
          kind: "notice",
          id: uid("workflow-done"),
          at: Date.now(),
          text: "工作流已完成",
        },
      ]);
      break;
    case "workflow.failed":
      if (runId && get().activeRunId === runId) set({ activeRunId: null });
      patchItems(get().activeSessionId, (items) => [
        ...items,
        {
          kind: "notice",
          id: uid("workflow-failed"),
          at: Date.now(),
          text: "工作流未完成，请查看失败节点和质询卡。",
          tone: "warn",
        },
      ]);
      break;
    case "task.created":
    case "task.ready":
    case "task.started":
    case "task.succeeded":
    case "task.failed":
    case "task.blocked": {
      const taskId =
        typeof (message as { taskId?: unknown }).taskId === "string"
          ? (message as { taskId: string }).taskId
          : undefined;
      if (!taskId) break;
      const status =
        message.type === "task.succeeded"
          ? "succeeded"
          : message.type === "task.failed"
            ? "failed"
            : message.type === "task.blocked"
              ? "blocked"
              : message.type === "task.started"
                ? "running"
                : "ready";
      patchItems(get().activeSessionId, (items) => {
        const existing = items.find(
          (item): item is Extract<ChatItem, { kind: "task" }> =>
            item.kind === "task" && item.taskId === taskId,
        );
        if (!existing)
          return [
            ...items,
            {
              kind: "task",
              id: uid("task"),
              at: Date.now(),
              taskId,
              label: taskLabel(
                typeof (message as { assignedAgent?: unknown })
                  .assignedAgent === "string"
                  ? (message as { assignedAgent: string }).assignedAgent
                  : undefined,
                typeof (message as { kind?: unknown }).kind === "string"
                  ? (message as { kind: string }).kind
                  : undefined,
              ),
              agentId:
                typeof (message as { assignedAgent?: unknown })
                  .assignedAgent === "string"
                  ? (message as { assignedAgent: string }).assignedAgent
                  : undefined,
              status,
            },
          ];
        return items.map((item) =>
          item.kind === "task" && item.taskId === taskId
            ? { ...item, status }
            : item,
        );
      });
      break;
    }
    case "error":
      if (runId) {
        patchRun(runId, (item) => ({
          ...item,
          status: "error",
          error: message.error ?? "未知错误",
        }));
        if (get().activeRunId === runId) set({ activeRunId: null });
      }
      break;
    default:
      return false;
  }
  return true;
}
