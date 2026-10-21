import { taskLabel, toolLabel } from "../lib/agents";
import type { ChatItem } from "./types";

/** 把存储投影出来的聊天条目恢复成界面状态；格式不认识的条目直接丢弃。 */
export function restoreItems(raw: unknown): ChatItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (value.kind === "user" && typeof value.text === "string")
      return [
        {
          kind: "user",
          id: String(value.id),
          at: Number(value.at),
          text: value.text,
        } satisfies ChatItem,
      ];
    if (value.kind === "approval" && typeof value.title === "string")
      return [
        {
          kind: "approval",
          id: String(value.id),
          at: Number(value.at),
          title: value.title,
          body: String(value.body ?? ""),
          options: Array.isArray(value.options)
            ? value.options.map(String)
            : ["批准", "拒绝"],
          runId: typeof value.runId === "string" ? value.runId : undefined,
          resolved:
            typeof value.resolved === "string" ? value.resolved : undefined,
          preview:
            typeof value.preview === "string" ? value.preview : undefined,
          path: typeof value.path === "string" ? value.path : undefined,
          contentLength:
            typeof value.contentLength === "number"
              ? value.contentLength
              : undefined,
          diff:
            value.diff && typeof value.diff === "object"
              ? {
                  addedLines: Number(
                    (value.diff as Record<string, unknown>).addedLines ?? 0,
                  ),
                  removedLines: Number(
                    (value.diff as Record<string, unknown>).removedLines ?? 0,
                  ),
                }
              : undefined,
          threadId:
            typeof value.threadId === "string" ? value.threadId : undefined,
          workflowId:
            typeof value.workflowId === "string" ? value.workflowId : undefined,
        } satisfies ChatItem,
      ];
    if (value.kind === "notice" && typeof value.text === "string")
      return [
        {
          kind: "notice",
          id: String(value.id),
          at: Number(value.at),
          text: value.text,
          tone: value.tone === "warn" ? "warn" : undefined,
        } satisfies ChatItem,
      ];
    if (value.kind === "question" && typeof value.prompt === "string")
      return [
        {
          kind: "question",
          id: String(value.id),
          at: Number(value.at),
          intakeId: String(value.intakeId),
          questionId: String(value.questionId),
          key: String(value.key),
          level: Number(value.level) === 1 ? 1 : 2,
          prompt: value.prompt,
          required: value.required !== false,
          options: Array.isArray(value.options)
            ? value.options.map(String)
            : [],
          value: typeof value.value === "string" ? value.value : undefined,
          resolved: value.resolved === true,
        } satisfies ChatItem,
      ];
    if (value.kind === "task" && typeof value.taskId === "string")
      return [
        {
          kind: "task",
          id: String(value.id),
          at: Number(value.at),
          taskId: value.taskId,
          label: taskLabel(
            typeof value.agentId === "string" ? value.agentId : undefined,
            typeof value.taskKind === "string" ? value.taskKind : undefined,
          ),
          agentId:
            typeof value.agentId === "string" ? value.agentId : undefined,
          taskKind:
            typeof value.taskKind === "string" ? value.taskKind : undefined,
          status:
            value.status === "running" ||
            value.status === "succeeded" ||
            value.status === "failed" ||
            value.status === "blocked"
              ? value.status
              : "ready",
        } satisfies ChatItem,
      ];
    if (value.kind === "thread" && typeof value.claim === "string")
      return [
        {
          kind: "thread",
          id: String(value.id),
          at: Number(value.at),
          from: String(value.from ?? "reviewer"),
          to: String(value.to ?? "writer"),
          round: Number(value.round ?? 1),
          maxRounds: Number(value.maxRounds ?? 2),
          severity: value.severity === "minor" ? "minor" : "blocking",
          claim: value.claim,
          replies: Array.isArray(value.replies)
            ? value.replies.flatMap((reply) => {
                if (!reply || typeof reply !== "object") return [];
                const item = reply as Record<string, unknown>;
                return typeof item.text === "string"
                  ? [
                      {
                        agentId: String(item.agentId ?? "writer"),
                        text: item.text,
                      },
                    ]
                  : [];
              })
            : [],
        } satisfies ChatItem,
      ];
    if (value.kind !== "agent") return [];
    const tools = Array.isArray(value.tools)
      ? value.tools.flatMap((tool) => {
          if (!tool || typeof tool !== "object") return [];
          const current = tool as Record<string, unknown>;
          return [
            {
              id: String(current.id),
              name: String(current.name),
              label: toolLabel(String(current.name)),
              status: (current.status === "error"
                ? "error"
                : current.status === "running"
                  ? "running"
                  : "done") as "running" | "done" | "error",
            },
          ];
        })
      : [];
    const status =
      value.status === "streaming" ||
      value.status === "done" ||
      value.status === "aborted" ||
      value.status === "interrupted" ||
      value.status === "waiting_approval" ||
      value.status === "error"
        ? value.status
        : "thinking";
    return [
      {
        kind: "agent",
        id: String(value.id),
        at: Number(value.at),
        agentId: String(value.agentId),
        status,
        text: String(value.text ?? ""),
        tools,
        runId: String(value.runId),
        model: typeof value.model === "string" ? value.model : undefined,
        reasoningLevel:
          typeof value.reasoning === "string" ? value.reasoning : undefined,
        usage:
          value.usage && typeof value.usage === "object"
            ? {
                input: Number(
                  (value.usage as Record<string, unknown>).input ?? 0,
                ),
                output: Number(
                  (value.usage as Record<string, unknown>).output ?? 0,
                ),
                total: Number(
                  (value.usage as Record<string, unknown>).total ?? 0,
                ),
                cost:
                  typeof (value.usage as Record<string, unknown>).cost ===
                  "number"
                    ? ((value.usage as Record<string, unknown>).cost as number)
                    : undefined,
              }
            : undefined,
        context: Array.isArray(value.context)
          ? value.context.flatMap((entry) => {
              if (!entry || typeof entry !== "object") return [];
              const context = entry as Record<string, unknown>;
              if (
                typeof context.id !== "string" ||
                typeof context.kind !== "string"
              )
                return [];
              return [
                {
                  id: context.id,
                  kind: context.kind,
                  sourcePath:
                    typeof context.sourcePath === "string"
                      ? context.sourcePath
                      : undefined,
                  estimatedTokens: Number(context.estimatedTokens ?? 0),
                  tokenBudget:
                    typeof context.tokenBudget === "number"
                      ? context.tokenBudget
                      : undefined,
                },
              ];
            })
          : undefined,
      } as ChatItem,
    ];
  });
}
