import { createId } from "@wordhub/store";
import { PermissionGuard } from "../tools/permissions.js";
import { PiRunError } from "../host/pi-agent-host.js";
import type { ModelRef } from "../types.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createRunHost } from "./host.js";
import type {
  RunRequest,
  HostState,
  RunHostDeps,
  RunLoopDeps,
} from "./run-types.js";
import { echoTool } from "./echo-tool.js";
export function createRunLoop(deps: RunLoopDeps) {
  async function runLive(request: RunRequest): Promise<void> {
    if (
      request.mode !== "mock" &&
      !request.apiKey &&
      !process.env.DEEPSEEK_API_KEY
    )
      throw new Error("DeepSeek密钥未配置");
    const store = await deps.ensureRunContext(request);
    const runtime = await deps.resolveAgent(request);
    const runtimeModels =
      request.mode === "mock" ? deps.mockModels : deps.models;
    const model = runtimeModels.getModel(
      runtime.modelRef.provider,
      runtime.modelRef.id,
    );
    if (!model)
      throw new Error(
        "model not found: " +
          runtime.modelRef.provider +
          "/" +
          runtime.modelRef.id,
      );
    const agentId = runtime.definition?.name ?? request.agentId ?? "writer";
    const snapshot = request.resume
      ? store.latestRunSnapshot(request.runId)
      : undefined;
    if (request.resume && !snapshot)
      throw new Error("运行快照不存在，请重新发起");
    if (!request.resume)
      store.startRun({
        projectId: request.projectId!,
        sessionId: request.sessionId!,
        runId: request.runId,
        prompt: request.prompt,
        model: model.id,
      });
    const taskId = `task_${request.runId}`;
    const context = deps.runContexts.get(request.runId);
    if (context) context.taskId = taskId;
    if (!request.resume)
      store.createTask({
        id: taskId,
        projectId: request.projectId!,
        sessionId: request.sessionId!,
        runId: request.runId,
        kind: "agent.run",
        status: "running",
        assignedAgent: agentId,
        dependencies: [],
        contextSnapshotId: `snap_${request.runId}`,
        attempt: 1,
        maxAttempts: 1,
      });
    if (!request.resume)
      deps.appendRunEvent(
        store,
        request,
        "task.created",
        { type: "system", id: "coordinator" },
        { taskId, kind: "agent.run", assignedAgent: agentId },
      );
    if (!request.resume)
      deps.appendRunEvent(
        store,
        request,
        "task.started",
        { type: "system", id: "coordinator" },
        { taskId },
      );
    if (!request.resume)
      deps.appendRunEvent(
        store,
        request,
        "chat.user_message",
        { type: "user", id: "user" },
        {
          text: request.rawPrompt ?? request.prompt,
          mentions: request.mentions ?? [],
        },
        "prompt:" + request.runId,
      );
    if (!request.resume)
      deps.appendRunEvent(
        store,
        request,
        "run.started",
        {
          type: "agent",
          id: agentId,
          agentVersion: runtime.definition?.version,
        },
        {
          agentId,
          agentVersion: runtime.definition?.version,
          model: model.id,
          reasoning: runtime.modelRef.reasoning,
          mode: request.mode ?? "live",
          mentions: request.mentions ?? [],
        },
      );
    if (request.resume) store.resumeRun(request.runId);
    const guard = new PermissionGuard();
    const configuredTools = runtime.definition
      ? deps.createAgentTools(request, store, runtime.definition)
      : [];
    const systemPrompt = request.toolRoundTrip
      ? "你是文枢工具调用验证助手。必须先调用wordhub_echo两次，每次传入不同中文短句；收到两次工具结果后，只用一句中文总结。"
      : (snapshot?.systemPrompt ??
        `${runtime.definition?.systemPrompt || "你是文枢P1后台写作助手。"}\n请按用户要求实际调用工具完成读写，再回答。`);
    const state: HostState = {
      text: "",
      lastUsage: undefined,
      hasSideEffects: false,
      activeModelForSnapshot: { provider: model.provider, id: model.id },
      activeRefForSnapshot: runtime.modelRef,
    };
    let snapshotSequence = snapshot?.sequence ?? 0;
    const saveSnapshot = (
      messages: unknown[],
      pendingToolCalls?: unknown[],
    ) => {
      store.saveRunSnapshot({
        id: createId("snap"),
        projectId: request.projectId!,
        sessionId: request.sessionId!,
        runId: request.runId,
        sequence: ++snapshotSequence,
        messages,
        systemPrompt,
        model: {
          provider: state.activeModelForSnapshot.provider,
          id: state.activeModelForSnapshot.id,
          reasoning: state.activeRefForSnapshot.reasoning,
        },
        pendingToolCalls,
      });
    };
    let usedModel = model;
    let usedRef = runtime.modelRef;
    const hostDeps: RunHostDeps = {
      runtimeModels,
      request,
      definition: runtime.definition,
      agentId,
      store,
      guard,
      configuredTools,
      systemPrompt,
      echoTool,
      pendingApprovals: deps.pendingApprovals,
      restoredApprovals: deps.restoredApprovals,
      runContexts: deps.runContexts,
      appendRunEvent: deps.appendRunEvent,
      post: deps.post,
      saveSnapshot,
    };
    const createHost = (activeModel: typeof model, activeRef: ModelRef) =>
      createRunHost(hostDeps, state, activeModel, activeRef);
    let host = createHost(model, runtime.modelRef);
    deps.active.set(request.runId, host);
    if (request.resume)
      deps.post({
        type: "run.started",
        runId: request.runId,
        model: model.id,
        reasoning: runtime.modelRef.reasoning,
        resumed: true,
      });
    try {
      const promptMessages = snapshot
        ? (snapshot.messages as AgentMessage[])
        : (await deps.buildRunContext(request, store, runtime.definition))
            .messages;
      if (!snapshot) saveSnapshot(promptMessages);
      try {
        if (snapshot) await host.resume(promptMessages);
        else await host.prompt(promptMessages);
      } catch (error) {
        const fallbackRef = runtime.fallbackRef;
        const fallbackModel = fallbackRef
          ? runtimeModels.getModel(fallbackRef.provider, fallbackRef.id)
          : undefined;
        if (
          !fallbackRef ||
          !fallbackModel ||
          (fallbackRef.provider === runtime.modelRef.provider &&
            fallbackRef.id === runtime.modelRef.id) ||
          request.resume ||
          state.hasSideEffects
        )
          throw error;
        deps.appendRunEvent(
          store,
          request,
          "run.fallback",
          { type: "system", id: "worker" },
          {
            from: `${runtime.modelRef.provider}/${runtime.modelRef.id}`,
            to: `${fallbackRef.provider}/${fallbackRef.id}`,
            reason: error instanceof Error ? error.message : String(error),
          },
        );
        state.text = "";
        state.lastUsage = undefined;
        usedModel = fallbackModel;
        usedRef = fallbackRef;
        host = createHost(fallbackModel, fallbackRef);
        deps.active.set(request.runId, host);
        await host.prompt(promptMessages);
      }
      const context = deps.runContexts.get(request.runId);
      if (!context || context.cancelled) return;
      store.updateTask(taskId, { status: "succeeded" });
      deps.appendRunEvent(
        store,
        request,
        "task.succeeded",
        { type: "system", id: "coordinator" },
        { taskId },
      );
      store.finishRun(request.runId, "succeeded");
      deps.appendRunEvent(
        store,
        request,
        "run.finished",
        {
          type: "agent",
          id: agentId,
          agentVersion: runtime.definition?.version,
        },
        {
          ok: true,
          model: usedModel.id,
          reasoning: usedRef.reasoning,
          text: state.text,
          usage: state.lastUsage,
        },
      );
      context.finished = true;
    } catch (error) {
      const context = deps.runContexts.get(request.runId);
      if (context?.cancelled) return;
      const message =
        error instanceof PiRunError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      store.finishRun(
        request.runId,
        error instanceof PiRunError && error.aborted ? "cancelled" : "failed",
        message,
      );
      store.updateTask(taskId, {
        status:
          error instanceof PiRunError && error.aborted ? "cancelled" : "failed",
        checkpoint: { error: message },
      });
      deps.appendRunEvent(
        store,
        request,
        error instanceof PiRunError && error.aborted
          ? "task.cancelled"
          : "task.failed",
        { type: "system", id: "coordinator" },
        { taskId, error: message },
      );
      deps.appendRunEvent(
        store,
        request,
        error instanceof PiRunError && error.aborted
          ? "run.aborted"
          : "run.error",
        { type: "system", id: "worker" },
        { error: message },
      );
      if (context) context.finished = true;
      throw error;
    } finally {
      deps.active.delete(request.runId);
      deps.pendingApprovals.delete(request.runId);
      deps.runContexts.delete(request.runId);
    }
  }
  return { runLive };
}
