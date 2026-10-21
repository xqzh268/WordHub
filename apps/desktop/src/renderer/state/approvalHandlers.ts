import type { Ctx } from "./context";
import type { RunMessage } from "./messages";
import type { ChatItem } from "./types";
import { uid } from "./util";

/** 处理本组消息；识别并处理返回 true，否则返回 false 交给下一组。 */
export function handleApproval(
  { get, patchItems }: Ctx,
  message: RunMessage,
): boolean {
  const runId = message.runId;
  switch (message.type) {
    case "approval.requested":
      if (runId)
        patchItems(get().activeSessionId, (items) => [
          ...items,
          {
            kind: "approval",
            id: `approval_${runId}`,
            at: Date.now(),
            title: "Agent请求写入",
            body: `${message.tool ?? "写入工具"}需要你的确认后才能继续。`,
            preview:
              typeof (message as { contentPreview?: unknown })
                .contentPreview === "string"
                ? (message as { contentPreview: string }).contentPreview
                : undefined,
            path:
              typeof (message as { path?: unknown }).path === "string"
                ? (message as { path: string }).path
                : undefined,
            contentLength:
              typeof (message as { contentLength?: unknown }).contentLength ===
              "number"
                ? (message as { contentLength: number }).contentLength
                : undefined,
            diff:
              message.diff && typeof message.diff === "object"
                ? {
                    addedLines: Number(message.diff.addedLines ?? 0),
                    removedLines: Number(message.diff.removedLines ?? 0),
                  }
                : undefined,
            options: ["批准", "拒绝"],
            runId,
            threadId:
              typeof (message as { threadId?: unknown }).threadId === "string"
                ? (message as { threadId: string }).threadId
                : undefined,
            workflowId:
              typeof (message as { workflowId?: unknown }).workflowId ===
              "string"
                ? (message as { workflowId: string }).workflowId
                : undefined,
          },
        ]);
      break;
    case "escalation.created":
      if (runId)
        patchItems(get().activeSessionId, (items) => [
          ...items,
          {
            kind: "approval",
            id: uid("escalation"),
            at: Date.now(),
            title: "质询需要你的裁决",
            body:
              message.reason ?? "两个Agent仍未达成一致，请选择后继续工作流。",
            options: ["接受修改", "保留原文"],
            runId,
            threadId: message.threadId,
            workflowId: message.workflowId ?? runId,
          },
        ]);
      break;
    case "approval.granted":
    case "approval.rejected":
      if (runId)
        patchItems(get().activeSessionId, (items) =>
          items.map((item) =>
            item.kind === "approval" && item.runId === runId
              ? {
                  ...item,
                  resolved:
                    message.type === "approval.granted" ? "批准" : "拒绝",
                }
              : item,
          ),
        );
      break;
    case "approval.expired":
      if (runId)
        patchItems(get().activeSessionId, (items) =>
          items.map((item) =>
            item.kind === "approval" && item.runId === runId
              ? { ...item, resolved: "已过期，可重新发起" }
              : item,
          ),
        );
      break;
    case "escalation.resolved":
      patchItems(get().activeSessionId, (items) =>
        items.map((item) =>
          item.kind === "approval" &&
          item.threadId === message.threadId &&
          (!runId || item.workflowId === runId || item.runId === runId)
            ? {
                ...item,
                resolved:
                  (message as { decision?: string }).decision === "accept"
                    ? "接受修改"
                    : "保留原文",
              }
            : item,
        ),
      );
      break;
    case "challenge.raise":
      if (message.threadId) {
        const threadId = message.threadId;
        patchItems(get().activeSessionId, (items) => {
          const existing = items.find(
            (item): item is Extract<ChatItem, { kind: "thread" }> =>
              item.kind === "thread" && item.id === threadId,
          );
          if (existing)
            return items.map((item) =>
              item.kind === "thread" && item.id === threadId
                ? {
                    ...item,
                    round: Number(
                      (message as { round?: number }).round ?? item.round,
                    ),
                    claim:
                      typeof (message as { claim?: unknown }).claim === "string"
                        ? (message as { claim: string }).claim
                        : item.claim,
                  }
                : item,
            );
          return [
            ...items,
            {
              kind: "thread",
              id: threadId,
              at: Date.now(),
              from: message.actorId ?? "reviewer",
              to:
                typeof (message as { target?: unknown }).target === "string"
                  ? (message as { target: string }).target
                  : "writer",
              round: Number((message as { round?: number }).round ?? 1),
              maxRounds: 2,
              severity:
                (message as { severity?: string }).severity === "minor"
                  ? "minor"
                  : "blocking",
              claim:
                typeof (message as { claim?: unknown }).claim === "string"
                  ? (message as { claim: string }).claim
                  : "",
              replies: [],
            },
          ];
        });
      }
      break;
    case "challenge.reply":
      if (message.threadId)
        patchItems(get().activeSessionId, (items) =>
          items.map((item) =>
            item.kind === "thread" && item.id === message.threadId
              ? {
                  ...item,
                  round: Number(
                    (message as { round?: number }).round ?? item.round,
                  ),
                  replies: [
                    ...item.replies,
                    {
                      agentId: message.actorId ?? "writer",
                      text:
                        typeof (message as { text?: unknown }).text === "string"
                          ? (message as { text: string }).text
                          : "",
                    },
                  ],
                }
              : item,
          ),
        );
      break;
    default:
      return false;
  }
  return true;
}
