import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai/providers/faux";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import path from "node:path";
import { WordHubStore, createId, timestamp } from "@wordhub/store";
import { ModelSettings } from "../models/settings.js";
import { ProjectService } from "../projects/service.js";
import { PiAgentHost } from "../host/pi-agent-host.js";
import { createRunLoop } from "./live.js";
import type { ExecutorOptions, RuntimeRequest } from "./executor-types.js";
export type { ExecutorOptions, RuntimeRequest } from "./executor-types.js";
import { createRequestHandler } from "./dispatcher.js";
import { createRunSupport } from "./support.js";
import { createWorkflowService } from "../coordinator/product.js";

export function createRunExecutor(options: ExecutorOptions) {
  const post = options.post;
  const live = createModels();
  live.setProvider(deepseekProvider());
  const models = options.models ?? live;
  // 仅供Electron faux回归控制观察窗口；正常运行不设置该环境变量。
  const mockTokenRate = Number(process.env.WORDHUB_MOCK_TOKEN_RATE);
  const faux = fauxProvider({
    provider: "deepseek",
    models: [
      { id: "deepseek-v4-pro", reasoning: true },
      { id: "deepseek-flash", reasoning: true },
    ],
    ...(Number.isFinite(mockTokenRate) && mockTokenRate > 0
      ? { tokensPerSecond: mockTokenRate }
      : {}),
  });
  const simulated = createModels();
  simulated.setProvider(faux.provider);
  const mockModels = options.mockModels ?? simulated;
  const fauxStep: FauxResponseFactory = (context, _options, state) => {
    const names =
      (
        context.messages[0] as { toolsAdded?: Array<{ name: string }> }
      ).toolsAdded?.map((tool) => tool.name) ?? [];
    const hasCompletedWrite = context.messages.some(
      (message) =>
        message.role === "toolResult" &&
        message.toolName === "doc_write" &&
        !message.isError,
    );
    if (hasCompletedWrite)
      return fauxAssistantMessage("文枢后台进程正在流式写作。", {
        stopReason: "stop",
      });
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
  const { resolveAgent, buildRunContext, createAgentTools, appendRunEvent } =
    createRunSupport({ post, modelSettings, runContexts });
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

  const { runLive } = createRunLoop({
    post,
    models,
    mockModels,
    active,
    runContexts,
    pendingApprovals,
    restoredApprovals,
    ensureRunContext,
    resolveAgent,
    buildRunContext,
    createAgentTools,
    appendRunEvent,
  });
  const workflows = createWorkflowService({
    workspaceRoot: options.workspaceRoot,
    projects: projectService,
    settings: modelSettings,
    run: runLive,
    append: appendRunEvent,
  });
  const decideChallenge = async (
    request: Extract<RuntimeRequest, { type: "challenge.decide" }>,
  ) => {
    const located = await workflows.locate(request.workflowId);
    appendRunEvent(
      located.store,
      located.request,
      "escalation.resolved",
      { type: "user", id: "user" },
      { threadId: request.threadId, decision: request.decision },
    );
    await workflows.continueWorkflow(request.workflowId, request.apiKey);
  };
  const resumeRun = async (runId: string, apiKey?: string) => {
    for (const project of projectService.recent()) {
      const store = await projectService.store(project.id);
      const run = store.getRun(runId);
      if (run?.status !== "interrupted") continue;
      const started = store
        .listEvents(project.id, run.sessionId)
        .find((event) => event.runId === runId && event.type === "run.started");
      const payload =
        started?.payload && typeof started.payload === "object"
          ? (started.payload as Record<string, unknown>)
          : {};
      await runLive({
        type: "run",
        runId,
        prompt: run.prompt,
        projectId: project.id,
        projectPath: project.folderPath,
        sessionId: run.sessionId,
        agentId:
          typeof payload.agentId === "string" ? payload.agentId : "writer",
        mode: payload.mode === "mock" ? "mock" : "live",
        apiKey,
        resume: true,
      });
      return;
    }
    throw new Error("没有可继续的中断运行");
  };

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
  async function failPersistedRun(
    runId: string,
    message: string,
  ): Promise<void> {
    for (const project of projectService.recent()) {
      const store = await projectService.store(project.id);
      const run = store.getRun(runId);
      if (!run) continue;
      store.finishRun(runId, "failed", message);
      store.appendEvent({
        schemaVersion: 1,
        id: createId("evt"),
        projectId: project.id,
        sessionId: run.sessionId,
        runId,
        type: "run.error",
        taskId: `task_${runId}`,
        actor: { type: "system", id: "worker" },
        occurredAt: timestamp(),
        idempotencyKey: `run:${runId}:resume-error`,
        visibility: "room",
        payload: { error: message },
      });
      post({ type: "error", runId, ok: false, error: message });
      return;
    }
  }
  async function resumePersistedApproval(
    runId: string,
    approved: boolean,
    apiKey?: string,
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
      const mode = payload.mode === "mock" ? "mock" : "live";
      if (mode !== "mock" && !apiKey && !process.env.DEEPSEEK_API_KEY) {
        const message = "DeepSeek密钥未配置，无法恢复这次审批";
        await failPersistedRun(runId, message);
        throw new Error(message);
      }
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
        apiKey,
        mode,
        projectId: project.id,
        projectPath: project.folderPath,
        sessionId: run.sessionId,
        resume: true,
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const context = runContexts.get(runId);
        if (context && !context.finished) {
          context.store.finishRun(runId, "failed", message);
          appendRunEvent(
            context.store,
            context.request,
            "run.error",
            { type: "system", id: "worker" },
            { error: message },
          );
          context.finished = true;
          runContexts.delete(runId);
        }
        post({
          type: "error",
          runId,
          ok: false,
          error: message,
        });
      });
      return;
    }
    throw new Error("该运行没有可恢复的审批");
  }
  const handle = createRequestHandler({
    ready,
    storageRoot: options.storageRoot,
    post,
    sendResponse,
    sendError,
    createProject,
    projectService,
    recoverProjectFiles,
    modelSettings,
    testConnection,
    resumePersistedApproval,
    pendingApprovals,
    runContexts,
    active,
    appendRunEvent,
    runLive: workflows.start,
    estimate: workflows.estimate,
    decideChallenge,
    resumeRun,
  });
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
