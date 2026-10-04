import { readFile } from "node:fs/promises";
import type { Model } from "@earendil-works/pi-ai";
import type { Api } from "@earendil-works/pi-ai";
import { safeProjectTarget, timestamp } from "@wordhub/store";
import type { ModelRef } from "../types.js";
import { PermissionDeniedError } from "../tools/permissions.js";
import { PiAgentHost } from "../host/pi-agent-host.js";
import type { HostState, RunHostDeps } from "./run-types.js";

export function createRunHost(
  deps: RunHostDeps,
  state: HostState,
  activeModel: Model<Api>,
  activeRef: ModelRef,
) {
  return new PiAgentHost({
    models: deps.runtimeModels,
    model: activeModel,
    reasoning: activeRef.reasoning,
    systemPrompt: deps.systemPrompt,
    tools: [
      ...deps.configuredTools,
      ...(deps.request.toolRoundTrip ? [deps.echoTool] : []),
    ],
    getApiKey: () =>
      deps.request.apiKey ??
      process.env.DEEPSEEK_API_KEY ??
      process.env.WORDHUB_DEEPSEEK_API_KEY,
    maxTurns: deps.definition?.maxTurns ?? 20,
    onCheckpoint: async (messages) => {
      state.activeModelForSnapshot = {
        provider: activeModel.provider,
        id: activeModel.id,
      };
      state.activeRefForSnapshot = activeRef;
      deps.saveSnapshot(messages);
    },
    beforeToolCall: async ({ toolCall, args, context: agentContext }) => {
      if (toolCall.name === "wordhub_echo" || !deps.definition)
        return undefined;
      const relativePath =
        args &&
        typeof args === "object" &&
        "path" in args &&
        typeof args.path === "string"
          ? args.path
          : undefined;
      try {
        deps.guard.assert(deps.definition, toolCall.name, relativePath);
      } catch (error) {
        const reason =
          error instanceof PermissionDeniedError
            ? error.message
            : "工具未获授权：" + toolCall.name;
        deps.appendRunEvent(
          deps.store,
          deps.request,
          "permission.denied",
          {
            type: "agent",
            id: deps.agentId,
            agentVersion: deps.definition.version,
          },
          { tool: toolCall.name, path: relativePath, reason },
        );
        return { block: true, reason };
      }
      if (!deps.guard.requiresApproval(deps.definition, toolCall.name))
        return undefined;
      const restored = deps.restoredApprovals.get(deps.request.runId);
      if (restored !== undefined) {
        deps.restoredApprovals.delete(deps.request.runId);
        deps.store.resumeRun(deps.request.runId);
        if (!restored) {
          deps.appendRunEvent(
            deps.store,
            deps.request,
            "approval.rejected",
            { type: "user", id: "user" },
            { tool: toolCall.name, restored: true, reason: "用户拒绝" },
          );
          return {
            block: true,
            reason: "用户拒绝了这次写入，请向用户解释并给出下一步建议。",
          };
        }
        deps.appendRunEvent(
          deps.store,
          deps.request,
          "approval.granted",
          { type: "user", id: "user" },
          { tool: toolCall.name, restored: true },
        );
        return undefined;
      }
      const preview =
        args && typeof args === "object"
          ? (args as Record<string, unknown>)
          : {};
      const body = typeof preview.content === "string" ? preview.content : "";
      const displayPath = relativePath?.replace(/^\.wordhub[\\/]/u, "");
      let diff: { addedLines: number; removedLines: number } | undefined;
      if (displayPath && body) {
        try {
          const target = await safeProjectTarget(
            deps.request.projectPath!,
            displayPath,
            true,
          );
          const previous = await readFile(target, "utf8").catch(() => "");
          const oldLines = previous ? previous.split(/\r?\n/u).length : 0;
          const newLines = body.split(/\r?\n/u).length;
          diff = {
            addedLines: Math.max(0, newLines - oldLines),
            removedLines: Math.max(0, oldLines - newLines),
          };
        } catch {
          diff = undefined;
        }
      }
      const waiter = new Promise<boolean>((resolve) => {
        deps.pendingApprovals.set(deps.request.runId, {
          toolCallId: "",
          toolName: toolCall.name,
          args,
          resolve,
        });
      });
      deps.saveSnapshot(agentContext.messages, [
        { id: toolCall.id, name: toolCall.name, args },
      ]);
      deps.appendRunEvent(
        deps.store,
        deps.request,
        "approval.requested",
        {
          type: "agent",
          id: deps.agentId,
          agentVersion: deps.definition.version,
        },
        {
          tool: toolCall.name,
          path: displayPath,
          contentPreview: body.slice(0, 1000),
          contentLength: body.length,
          diff,
          argsSummary: Object.keys(preview),
        },
      );
      deps.store.finishRun(deps.request.runId, "waiting_approval");
      deps.appendRunEvent(
        deps.store,
        deps.request,
        "run.waiting_approval",
        {
          type: "agent",
          id: deps.agentId,
          agentVersion: deps.definition.version,
        },
        { model: activeModel.id },
      );
      const runContext = deps.runContexts.get(deps.request.runId);
      if (runContext) runContext.waitingApproval = true;
      const approved = await waiter;
      deps.pendingApprovals.delete(deps.request.runId);
      if (runContext?.cancelled) return { block: true, reason: "运行已取消" };
      if (!approved) {
        deps.appendRunEvent(
          deps.store,
          deps.request,
          "approval.rejected",
          { type: "user", id: "user" },
          { tool: toolCall.name, reason: "用户拒绝" },
        );
        deps.store.resumeRun(deps.request.runId);
        if (runContext) runContext.waitingApproval = false;
        return {
          block: true,
          reason: "用户拒绝了这次写入，请向用户解释并给出下一步建议。",
        };
      }
      deps.store.resumeRun(deps.request.runId);
      if (runContext) runContext.waitingApproval = false;
      deps.appendRunEvent(
        deps.store,
        deps.request,
        "approval.granted",
        { type: "user", id: "user" },
        { tool: toolCall.name },
      );
      return undefined;
    },
    emit: async (event) => {
      if (event.type === "text_delta") {
        state.text += event.delta;
        deps.appendRunEvent(
          deps.store,
          deps.request,
          "run.text_delta",
          {
            type: "agent",
            id: deps.agentId,
            agentVersion: deps.definition?.version,
          },
          { delta: event.delta },
        );
      }
      if (event.type === "reasoning_delta")
        deps.post({
          type: "run.reasoning_delta",
          runId: deps.request.runId,
          delta: event.delta,
        });
      if (event.type === "tool_started") {
        state.hasSideEffects = true;
        deps.appendRunEvent(
          deps.store,
          deps.request,
          "run.tool_started",
          {
            type: "agent",
            id: deps.agentId,
            agentVersion: deps.definition?.version,
          },
          {
            tool: event.toolName,
            toolCallId: event.toolCallId,
            args: event.args,
          },
        );
      }
      if (event.type === "tool_finished") {
        if (event.toolName === "doc.write" && event.ok)
          state.hasCommittedWrite = true;
        deps.appendRunEvent(
          deps.store,
          deps.request,
          "run.tool_finished",
          {
            type: "agent",
            id: deps.agentId,
            agentVersion: deps.definition?.version,
          },
          {
            tool: event.toolName,
            toolCallId: event.toolCallId,
            ok: event.ok,
          },
        );
      }
      if (event.type === "usage") {
        const usage = event.usage;
        state.lastUsage = usage;
        deps.store.recordUsage({
          runId: deps.request.runId,
          model: activeModel.id,
          inputTokens: usage.input,
          outputTokens: usage.output,
          costUsd: usage.cost.total,
          createdAt: timestamp(),
        });
        deps.appendRunEvent(
          deps.store,
          deps.request,
          "run.usage",
          { type: "system", id: "usage" },
          {
            inputTokens: usage.input,
            outputTokens: usage.output,
            reasoningTokens: usage.reasoning,
            costUsd: usage.cost.total,
            usage,
          },
        );
      }
    },
  });
}
