import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai/providers/faux";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { Type } from "typebox";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ControlledFileWriter,
  WordHubStore,
  projectChat,
  safeProjectTarget,
  createId,
  timestamp,
} from "@wordhub/store";
import type { Actor, Event } from "@wordhub/contracts";
import { ModelSettings } from "../models/settings.js";
import { ProjectService } from "../projects/service.js";
import { projectContext } from "../context/project.js";
import { projectTools } from "../tools/project.js";
import {
  PermissionGuard,
  PermissionDeniedError,
} from "../tools/permissions.js";
import { PiAgentHost, PiRunError } from "../host/pi-agent-host.js";
import { estimateRun } from "../budget/estimate.js";
import type { AgentDefinition, ModelRef } from "../types.js";
import type { Models } from "@earendil-works/pi-ai";

export type RuntimeRequest =
  | { type: "init"; storageRoot?: string; requestId?: string }
  | {
      type: "project.create";
      name: string;
      folderPath: string;
      projectId?: string;
      requestId: string;
    }
  | { type: "project.listRecent"; requestId: string }
  | {
      type: "session.create";
      projectId: string;
      title: string;
      sessionId?: string;
      requestId: string;
    }
  | { type: "session.list"; projectId: string; requestId: string }
  | {
      type: "session.rename";
      sessionId: string;
      title: string;
      projectId?: string;
      requestId: string;
    }
  | {
      type: "chat.list";
      projectId: string;
      sessionId: string;
      requestId: string;
    }
  | {
      type: "file.write";
      projectId: string;
      folderPath: string;
      relativePath: string;
      content: string;
      sessionId?: string;
      artifactId?: string;
      runId?: string;
      taskId?: string;
      expectedHash?: `sha256:${string}` | null;
      conflictPolicy?: "reject" | "keep-both";
      requestId: string;
    }
  | {
      type: "file.undo";
      projectId: string;
      folderPath: string;
      relativePath: string;
      artifactId: string;
      sessionId?: string;
      requestId: string;
    }
  | { type: "run.approve"; runId: string; approved: boolean; requestId: string }
  | { type: "settings.models"; projectPath?: string; requestId: string }
  | {
      type: "settings.testConnection";
      provider: string;
      apiKey?: string;
      requestId: string;
    }
  | {
      type: "run.estimate";
      prompt: string;
      agentId?: string;
      projectPath?: string;
      requestId: string;
    }
  | {
      type: "settings.setAgentModel";
      projectPath?: string;
      agentId: string;
      model: ModelRef;
      requestId: string;
    }
  | {
      type: "run";
      runId: string;
      prompt: string;
      rawPrompt?: string;
      agentId?: string;
      mentions?: string[];
      apiKey?: string;
      model?: string;
      reasoning?: string;
      mode?: "live" | "mock";
      toolRoundTrip?: boolean;
      projectPath?: string;
      projectId?: string;
      sessionId?: string;
      resume?: boolean;
    }
  | { type: "abort"; runId: string };

type ProjectIndex = {
  id: string;
  name: string;
  folderPath: string;
  createdAt: string;
  updatedAt: string;
};
export type ExecutorOptions = {
  storageRoot: string;
  workspaceRoot: string;
  models?: Models;
  mockModels?: Models;
  post: (message: Record<string, unknown>) => void;
};
/** 独立于Electron的运行编排模块；产品与faux测试跨同一个接口。 */
export function createRunExecutor(options: ExecutorOptions) {
  const post = options.post;
  const live = createModels();
  live.setProvider(deepseekProvider());
  const models = options.models ?? live;
  const faux = fauxProvider({
    provider: "deepseek",
    models: [
      { id: "deepseek-v4-pro", reasoning: true },
      { id: "deepseek-flash", reasoning: true },
    ],
  });
  const simulated = createModels();
  simulated.setProvider(faux.provider);
  const mockModels = options.mockModels ?? simulated;
  const fauxStep: FauxResponseFactory = (context, _options, state) => {
    const names =
      (
        context.messages[0] as { toolsAdded?: Array<{ name: string }> }
      ).toolsAdded?.map((tool) => tool.name) ?? [];
    if (names.includes("wordhub_echo"))
      return fauxAssistantMessage(
        fauxToolCall("wordhub_echo", {
          text: state.callCount === 1 ? "第一轮" : "第二轮",
        }),
        { stopReason: "toolUse" },
      );
    if (state.callCount === 1 && names.includes("bible_read"))
      return fauxAssistantMessage(
        fauxToolCall("bible_read", { path: "bible.md" }),
        { stopReason: "toolUse" },
      );
    if (state.callCount === 2 && names.includes("doc_write"))
      return fauxAssistantMessage(
        fauxToolCall("doc_write", {
          path: "chapters/第一章.md",
          content: "模拟模式的中文章节正文。",
        }),
        { stopReason: "toolUse" },
      );
    return fauxAssistantMessage("文枢后台进程正在流式写作。", {
      stopReason: "stop",
    });
  };
  faux.setResponses(Array.from({ length: 20 }, () => fauxStep));
  const active = new Map<string, { abort(): void }>();
  type RunContext = {
    store: WordHubStore;
    request: Extract<RuntimeRequest, { type: "run" }>;
    cancelled: boolean;
    finished: boolean;
    waitingApproval?: boolean;
    taskId?: string;
  };
  const runContexts = new Map<string, RunContext>();
  type PendingApproval = {
    toolCallId: string;
    toolName: string;
    args: unknown;
    resolve: (approved: boolean) => void;
  };
  const pendingApprovals = new Map<string, PendingApproval>();
  const restoredApprovals = new Map<string, boolean>();
  const projectService = new ProjectService(options.storageRoot);
  const modelSettings = new ModelSettings(
    projectService,
    path.join(options.workspaceRoot, "packages/novel/agents"),
  );
  const ready = projectService.init();
  const recoverProjectFiles = (id: string) => projectService.store(id);
  const createProject = (
    request: Extract<RuntimeRequest, { type: "project.create" }>,
  ) => projectService.create(request);
  function sendResponse(requestId: string, result: unknown): void {
    post({ type: "response", requestId, ok: true, result });
  }
  function sendError(requestId: string, error: unknown): void {
    post({
      type: "response",
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  async function resolveAgent(
    request: Extract<RuntimeRequest, { type: "run" }>,
  ) {
    const resolved = await modelSettings.resolve(request);
    return {
      definition: resolved.definition,
      modelRef: resolved.ref,
      fallbackRef: resolved.definition.fallback,
    };
  }
  async function buildRunContext(
    request: Extract<RuntimeRequest, { type: "run" }>,
    store: WordHubStore,
    definition: AgentDefinition,
  ) {
    const context = await projectContext({
      store,
      projectId: request.projectId!,
      sessionId: request.sessionId!,
      projectPath: request.projectPath!,
      runId: request.runId,
      prompt: request.prompt,
      agent: definition,
    });
    appendRunEvent(
      store,
      request,
      "context.injected",
      { type: "system", id: "context" },
      {
        manifest: context.manifest.map(
          ({ id, kind, sourcePath, estimatedTokens }) => ({
            id,
            kind,
            sourcePath,
            estimatedTokens,
          }),
        ),
        estimatedTokens: context.estimatedTokens,
      },
    );
    return context;
  }
  const echoTool = {
    name: "wordhub_echo",
    label: "文枢回声工具",
    description: "回传一个短句，用于验证思考模式下的多轮工具调用。",
    parameters: Type.Object({
      text: Type.String({ minLength: 1, maxLength: 200 }),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const text = (params as { text: string }).text;
      return {
        content: [{ type: "text" as const, text: `工具已执行：${text}` }],
        details: { roundTrip: true },
      };
    },
  };

  function createAgentTools(
    request: Extract<RuntimeRequest, { type: "run" }>,
    store: WordHubStore,
    definition: AgentDefinition,
  ) {
    return projectTools({
      store,
      projectId: request.projectId!,
      sessionId: request.sessionId!,
      runId: request.runId,
      projectPath: request.projectPath!,
      agent: definition,
      approved: new Map(),
      event: (type, payload) =>
        appendRunEvent(
          store,
          request,
          type,
          { type: "agent", id: definition.name },
          payload,
        ).id,
    }).tools;
  }
  function appendRunEvent(
    store: WordHubStore,
    request: Extract<RuntimeRequest, { type: "run" }>,
    type: string,
    actor: Actor,
    payload: Record<string, unknown>,
    idempotencyKey?: string,
  ): Event {
    const event = store.appendEvent({
      schemaVersion: 1,
      id: createId("evt"),
      projectId: request.projectId!,
      sessionId: request.sessionId!,
      runId: request.runId,
      type,
      taskId: runContexts.get(request.runId)?.taskId,
      actor,
      occurredAt: timestamp(),
      idempotencyKey,
      visibility: "room",
      payload,
    });
    const compatibility: Record<string, string> = {
      "run.text_delta": "run.text",
      "run.tool_started": "run.tool_execution_start",
      "run.tool_finished": "run.tool_execution_end",
      "run.error": "error",
    };
    post({
      type: compatibility[type] ?? type,
      runId: request.runId,
      ...payload,
    });
    return event;
  }

  async function ensureRunContext(
    request: Extract<RuntimeRequest, { type: "run" }>,
  ): Promise<WordHubStore> {
    const linked = await projectService.ensure(request);
    Object.assign(request, {
      projectId: linked.projectId,
      projectPath: linked.projectPath,
      sessionId: linked.sessionId,
    });
    const store = linked.store;
    runContexts.set(request.runId, {
      store,
      request,
      cancelled: false,
      finished: false,
    });
    return store;
  }

  async function runLive(
    request: Extract<RuntimeRequest, { type: "run" }>,
  ): Promise<void> {
    if (
      request.mode !== "mock" &&
      !request.apiKey &&
      !process.env.DEEPSEEK_API_KEY
    )
      throw new Error("DeepSeek密钥未配置");
    const store = await ensureRunContext(request);
    const runtime = await resolveAgent(request);
    const runtimeModels = request.mode === "mock" ? mockModels : models;
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
    if (!request.resume)
      store.startRun({
        projectId: request.projectId!,
        sessionId: request.sessionId!,
        runId: request.runId,
        prompt: request.prompt,
        model: model.id,
      });
    const taskId = `task_${request.runId}`;
    const context = runContexts.get(request.runId);
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
      appendRunEvent(
        store,
        request,
        "task.created",
        { type: "system", id: "coordinator" },
        { taskId, kind: "agent.run", assignedAgent: agentId },
      );
    if (!request.resume)
      appendRunEvent(
        store,
        request,
        "task.started",
        { type: "system", id: "coordinator" },
        { taskId },
      );
    if (!request.resume)
      appendRunEvent(
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
      appendRunEvent(
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
      ? createAgentTools(request, store, runtime.definition)
      : [];
    const systemPrompt = request.toolRoundTrip
      ? "你是文枢工具调用验证助手。必须先调用wordhub_echo两次，每次传入不同中文短句；收到两次工具结果后，只用一句中文总结。"
      : `${runtime.definition?.systemPrompt || "你是文枢P1后台写作助手。"}\n请按用户要求实际调用工具完成读写，再回答。`;
    let text = "";
    let lastUsage: unknown;
    let hasSideEffects = false;
    let snapshotSequence = 0;
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
          provider: activeModelForSnapshot.provider,
          id: activeModelForSnapshot.id,
          reasoning: activeRefForSnapshot.reasoning,
        },
        pendingToolCalls,
      });
    };
    let activeModelForSnapshot = { provider: model.provider, id: model.id };
    let activeRefForSnapshot = runtime.modelRef;
    let usedModel = model;
    let usedRef = runtime.modelRef;
    const createHost = (
      activeModel: NonNullable<typeof model>,
      activeRef: ModelRef,
    ) =>
      new PiAgentHost({
        models: runtimeModels,
        model: activeModel,
        reasoning: activeRef.reasoning,
        systemPrompt,
        tools: [
          ...configuredTools,
          ...(request.toolRoundTrip ? [echoTool] : []),
        ],
        getApiKey: () => request.apiKey ?? process.env.DEEPSEEK_API_KEY,
        maxTurns: runtime.definition?.maxTurns ?? 20,
        onCheckpoint: async (messages) => {
          activeModelForSnapshot = {
            provider: activeModel.provider,
            id: activeModel.id,
          };
          activeRefForSnapshot = activeRef;
          saveSnapshot(messages);
        },
        beforeToolCall: async ({ toolCall, args, context: agentContext }) => {
          if (toolCall.name === "wordhub_echo" || !runtime.definition)
            return undefined;
          const relativePath =
            args &&
            typeof args === "object" &&
            "path" in args &&
            typeof args.path === "string"
              ? args.path
              : undefined;
          try {
            guard.assert(runtime.definition, toolCall.name, relativePath);
          } catch (error) {
            const reason =
              error instanceof PermissionDeniedError
                ? error.message
                : "工具未获授权：" + toolCall.name;
            appendRunEvent(
              store,
              request,
              "permission.denied",
              {
                type: "agent",
                id: agentId,
                agentVersion: runtime.definition.version,
              },
              { tool: toolCall.name, path: relativePath, reason },
            );
            return { block: true, reason };
          }
          if (!guard.requiresApproval(runtime.definition, toolCall.name))
            return undefined;
          const restored = restoredApprovals.get(request.runId);
          if (restored !== undefined) {
            restoredApprovals.delete(request.runId);
            store.resumeRun(request.runId);
            if (!restored)
              return {
                block: true,
                reason: "用户拒绝了这次写入，请向用户解释并给出下一步建议。",
              };
            appendRunEvent(
              store,
              request,
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
          const body =
            typeof preview.content === "string" ? preview.content : "";
          const displayPath = relativePath?.replace(/^\.wordhub[\\/]/u, "");
          let diff: { addedLines: number; removedLines: number } | undefined;
          if (displayPath && body) {
            try {
              const target = await safeProjectTarget(
                request.projectPath!,
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
            pendingApprovals.set(request.runId, {
              toolCallId: "",
              toolName: toolCall.name,
              args,
              resolve,
            });
          });
          saveSnapshot(agentContext.messages, [
            { id: toolCall.id, name: toolCall.name, args },
          ]);
          appendRunEvent(
            store,
            request,
            "approval.requested",
            {
              type: "agent",
              id: agentId,
              agentVersion: runtime.definition.version,
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
          store.finishRun(request.runId, "waiting_approval");
          appendRunEvent(
            store,
            request,
            "run.waiting_approval",
            {
              type: "agent",
              id: agentId,
              agentVersion: runtime.definition.version,
            },
            { model: activeModel.id },
          );
          const runContext = runContexts.get(request.runId);
          if (runContext) runContext.waitingApproval = true;
          const approved = await waiter;
          pendingApprovals.delete(request.runId);
          if (runContext?.cancelled)
            return { block: true, reason: "运行已取消" };
          if (!approved) {
            appendRunEvent(
              store,
              request,
              "approval.rejected",
              { type: "user", id: "user" },
              { tool: toolCall.name, reason: "用户拒绝" },
            );
            store.resumeRun(request.runId);
            if (runContext) runContext.waitingApproval = false;
            return {
              block: true,
              reason: "用户拒绝了这次写入，请向用户解释并给出下一步建议。",
            };
          }
          store.resumeRun(request.runId);
          if (runContext) runContext.waitingApproval = false;
          appendRunEvent(
            store,
            request,
            "approval.granted",
            { type: "user", id: "user" },
            { tool: toolCall.name },
          );
          return undefined;
        },
        emit: async (event) => {
          if (event.type === "text_delta") {
            text += event.delta;
            appendRunEvent(
              store,
              request,
              "run.text_delta",
              {
                type: "agent",
                id: agentId,
                agentVersion: runtime.definition?.version,
              },
              { delta: event.delta },
            );
          }
          if (event.type === "reasoning_delta")
            post({
              type: "run.reasoning_delta",
              runId: request.runId,
              delta: event.delta,
            });
          if (event.type === "tool_started") {
            hasSideEffects = true;
            appendRunEvent(
              store,
              request,
              "run.tool_started",
              {
                type: "agent",
                id: agentId,
                agentVersion: runtime.definition?.version,
              },
              {
                tool: event.toolName,
                toolCallId: event.toolCallId,
                args: event.args,
              },
            );
          }
          if (event.type === "tool_finished")
            appendRunEvent(
              store,
              request,
              "run.tool_finished",
              {
                type: "agent",
                id: agentId,
                agentVersion: runtime.definition?.version,
              },
              {
                tool: event.toolName,
                toolCallId: event.toolCallId,
                ok: event.ok,
              },
            );
          if (event.type === "usage") {
            const usage = event.usage;
            lastUsage = usage;
            store.recordUsage({
              runId: request.runId,
              model: activeModel.id,
              inputTokens: usage.input,
              outputTokens: usage.output,
              costUsd: usage.cost.total,
              createdAt: timestamp(),
            });
            appendRunEvent(
              store,
              request,
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
    let host = createHost(model, runtime.modelRef);
    active.set(request.runId, host);
    try {
      const promptMessages = (
        await buildRunContext(request, store, runtime.definition)
      ).messages;
      saveSnapshot(promptMessages);
      try {
        await host.prompt(promptMessages);
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
          hasSideEffects
        )
          throw error;
        appendRunEvent(
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
        text = "";
        lastUsage = undefined;
        usedModel = fallbackModel;
        usedRef = fallbackRef;
        host = createHost(fallbackModel, fallbackRef);
        active.set(request.runId, host);
        await host.prompt(promptMessages);
      }
      const context = runContexts.get(request.runId);
      if (!context || context.cancelled) return;
      store.updateTask(taskId, { status: "succeeded" });
      appendRunEvent(
        store,
        request,
        "task.succeeded",
        { type: "system", id: "coordinator" },
        { taskId },
      );
      store.finishRun(request.runId, "succeeded");
      appendRunEvent(
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
          text,
          usage: lastUsage,
        },
      );
      context.finished = true;
    } catch (error) {
      const context = runContexts.get(request.runId);
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
      appendRunEvent(
        store,
        request,
        error instanceof PiRunError && error.aborted
          ? "task.cancelled"
          : "task.failed",
        { type: "system", id: "coordinator" },
        { taskId, error: message },
      );
      appendRunEvent(
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
      active.delete(request.runId);
      pendingApprovals.delete(request.runId);
      runContexts.delete(request.runId);
    }
  }
  async function testConnection(
    request: Extract<RuntimeRequest, { type: "settings.testConnection" }>,
  ): Promise<{ ok: boolean; message: string }> {
    if (request.provider !== "deepseek")
      return { ok: false, message: `暂不支持服务商：${request.provider}` };
    const model = models.getModel("deepseek", "deepseek-flash");
    if (!model) return { ok: false, message: "DeepSeek模型不可用" };
    const host = new PiAgentHost({
      models,
      model,
      reasoning: "off",
      systemPrompt: "你是连接测试助手。只需回复：连接成功。",
      getApiKey: () => request.apiKey ?? process.env.DEEPSEEK_API_KEY,
      maxTurns: 1,
      emit: () => undefined,
    });
    try {
      await host.prompt("连接测试：请回复连接成功。");
      return { ok: true, message: "连接成功，模型已返回响应。" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: message.replaceAll(/sk-[A-Za-z0-9_-]+/gu, "[已隐藏]"),
      };
    }
  }
  async function resumePersistedApproval(
    runId: string,
    approved: boolean,
  ): Promise<void> {
    for (const project of projectService.recent()) {
      const store = await projectService.store(project.id);
      const run = store.getRun(runId);
      if (run?.status !== "waiting_approval") continue;
      if (!store.latestRunSnapshot(runId))
        throw new Error("该审批没有可恢复的运行快照，请重新发起");
      const started = store
        .listEvents(project.id, run.sessionId)
        .find((event) => event.runId === runId && event.type === "run.started");
      const payload =
        started?.payload && typeof started.payload === "object"
          ? (started.payload as Record<string, unknown>)
          : {};
      restoredApprovals.set(runId, approved);
      void runLive({
        type: "run",
        runId,
        prompt: run.prompt,
        rawPrompt: run.prompt,
        agentId:
          typeof payload.agentId === "string" ? payload.agentId : "writer",
        model: typeof payload.model === "string" ? payload.model : undefined,
        reasoning:
          typeof payload.reasoning === "string" ? payload.reasoning : undefined,
        apiKey: process.env.DEEPSEEK_API_KEY,
        mode: payload.mode === "mock" ? "mock" : "live",
        projectId: project.id,
        projectPath: project.folderPath,
        sessionId: run.sessionId,
        resume: true,
      }).catch((error: unknown) => {
        post({
          type: "error",
          runId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }
    throw new Error("该运行没有可恢复的审批");
  }
  async function handle(request: RuntimeRequest): Promise<void> {
    await ready;
    try {
      if (request.type === "init") {
        if (request.storageRoot && request.storageRoot !== options.storageRoot)
          throw new Error("存储目录不能在运行中切换");
        if (request.requestId) sendResponse(request.requestId, { ready: true });
        return;
      }
      if (request.type === "project.create") {
        sendResponse(request.requestId, await createProject(request));
        return;
      }
      if (request.type === "project.listRecent") {
        sendResponse(request.requestId, {
          projects: projectService.recent(),
        });
        return;
      }
      if (request.type === "session.create") {
        sendResponse(request.requestId, {
          session: (await recoverProjectFiles(request.projectId)).createSession(
            {
              projectId: request.projectId,
              id: request.sessionId,
              title: request.title,
            },
          ),
        });
        return;
      }
      if (request.type === "session.list") {
        sendResponse(request.requestId, {
          sessions: (await recoverProjectFiles(request.projectId)).listSessions(
            request.projectId,
          ),
        });
        return;
      }
      if (request.type === "session.rename") {
        if (!request.projectId) throw new Error("重命名会话需要项目ID");
        (await recoverProjectFiles(request.projectId)).renameSession(
          request.sessionId,
          request.title,
        );
        sendResponse(request.requestId, { sessionId: request.sessionId });
        return;
      }
      if (request.type === "chat.list") {
        const store = await recoverProjectFiles(request.projectId);
        const events = store.listEvents(request.projectId, request.sessionId);
        sendResponse(request.requestId, { events, items: projectChat(events) });
        return;
      }
      if (request.type === "settings.models") {
        const view = await modelSettings.view(request.projectPath);
        sendResponse(request.requestId, view);
        return;
      }
      if (request.type === "settings.testConnection") {
        sendResponse(request.requestId, await testConnection(request));
        return;
      }
      if (request.type === "run.estimate") {
        const resolved = await modelSettings.resolve({
          agentId: request.agentId,
          projectPath: request.projectPath,
        });
        sendResponse(
          request.requestId,
          estimateRun(
            [
              {
                id: request.agentId ?? "planner",
                model: resolved.ref,
                contextTokens: Math.max(
                  1,
                  Math.ceil(request.prompt.length / 4),
                ),
              },
            ],
            resolved.config,
          ),
        );
        return;
      }
      if (request.type === "settings.setAgentModel") {
        if (!request.projectPath)
          throw new Error("逐Agent模型设置需要项目文件夹");
        await modelSettings.set(
          request.agentId,
          request.model,
          request.projectPath,
        );
        sendResponse(request.requestId, { saved: true });
        return;
      }
      if (request.type === "file.write") {
        const store = await recoverProjectFiles(request.projectId);
        const result = await new ControlledFileWriter(
          store,
          request.projectId,
          request.folderPath,
        ).writeText(request);
        sendResponse(request.requestId, result);
        return;
      }
      if (request.type === "file.undo") {
        const store = await recoverProjectFiles(request.projectId);
        const result = await new ControlledFileWriter(
          store,
          request.projectId,
          request.folderPath,
        ).undo(request);
        sendResponse(request.requestId, result);
        return;
      }
      if (request.type === "run.approve") {
        const pending = pendingApprovals.get(request.runId);
        if (!pending) {
          await resumePersistedApproval(request.runId, request.approved);
          sendResponse(request.requestId, {
            runId: request.runId,
            approved: request.approved,
          });
          return;
        }
        pending.resolve(request.approved);
        sendResponse(request.requestId, {
          runId: request.runId,
          approved: request.approved,
        });
        return;
      }
    } catch (error) {
      if ("requestId" in request && request.requestId) {
        sendError(request.requestId, error);
      } else {
        const failedRunId = "runId" in request ? request.runId : undefined;
        const context = failedRunId ? runContexts.get(failedRunId) : undefined;
        if (context?.cancelled) return;
        if (context && failedRunId && !context.finished) {
          const message =
            error instanceof Error ? error.message : String(error);
          context.store.finishRun(failedRunId, "failed", message);
          appendRunEvent(
            context.store,
            context.request,
            "run.error",
            { type: "system", id: "worker" },
            { error: message },
          );
          context.finished = true;
          runContexts.delete(failedRunId);
        } else {
          post({
            type: "error",
            runId: failedRunId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return;
    }
    if (request.type === "abort") {
      const context = runContexts.get(request.runId);
      if (context && !context.finished) {
        context.cancelled = true;
        context.store.finishRun(request.runId, "cancelled");
        appendRunEvent(
          context.store,
          context.request,
          "run.aborted",
          { type: "system", id: "worker" },
          { ok: true },
        );
        context.finished = true;
        pendingApprovals.get(request.runId)?.resolve(false);
        pendingApprovals.delete(request.runId);
        runContexts.delete(request.runId);
      }
      active.get(request.runId)?.abort();
      return;
    }
    if (request.type !== "run") return;
    post({
      type: "run.started",
      runId: request.runId,
      mode: request.mode ?? "live",
      projectPath: request.projectPath,
    });
    void runLive(request).catch((error: unknown) => {
      active.delete(request.runId);
      const context = runContexts.get(request.runId);
      if (context?.cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      if (context && !context.finished) {
        context.store.finishRun(request.runId, "failed", message);
        appendRunEvent(
          context.store,
          context.request,
          "run.error",
          { type: "system", id: "worker" },
          { error: message },
        );
        context.finished = true;
        runContexts.delete(request.runId);
      } else {
        post({
          type: "error",
          runId: request.runId,
          ok: false,
          error: message,
        });
      }
    });
  }

  return {
    ready,
    handle,
    close() {
      for (const running of active.values()) running.abort();
      for (const approval of pendingApprovals.values()) approval.resolve(false);
      projectService.close();
    },
  };
}
