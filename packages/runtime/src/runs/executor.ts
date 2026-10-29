import { createModels, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai/providers/faux";
import path from "node:path";
import { WordHubStore, createId, timestamp } from "@wordhub/store";
import { ModelSettings } from "../models/settings.js";
import {
  createRuntimeModels,
  registerCustomProviders,
} from "../models/providers.js";
import { ProjectService } from "../projects/service.js";
import { PiAgentHost } from "../host/pi-agent-host.js";
import { createRunLoop } from "./live.js";
import type { ExecutorOptions, RuntimeRequest } from "./executor-types.js";
export type { ExecutorOptions, RuntimeRequest } from "./executor-types.js";
import { createRequestHandler } from "./dispatcher.js";
import { createRunSupport } from "./support.js";
import { createWorkflowService } from "../coordinator/product.js";
import { createNovelIntakeService } from "../novel/intake.js";

export function createRunExecutor(options: ExecutorOptions) {
  const post = options.post;
  // 密钥由主进程同步到这里；Pi按Provider先查已存凭据，再查各自的环境变量。
  const credentialStore = new InMemoryCredentialStore();
  const syncedProviders = new Set<string>();
  const syncCredentials = async (keys: Record<string, string>) => {
    for (const [provider, key] of Object.entries(keys)) {
      syncedProviders.add(provider);
      await credentialStore.modify(provider, async () => ({
        type: "api_key",
        key,
      }));
    }
    for (const provider of [...syncedProviders])
      if (!(provider in keys)) {
        syncedProviders.delete(provider);
        await credentialStore.delete(provider);
      }
  };
  let credentialsReady: Promise<void> = Promise.resolve();
  const live = createRuntimeModels({ credentials: credentialStore });
  const models = options.models ?? live;
  /** 缺密钥时给出明确的Provider名；mock模式不需要。 */
  const assertAuth = async (provider: string): Promise<void> => {
    if (!(await models.getAuth(provider)))
      throw new Error(`${provider}的API密钥未配置，请在设置页添加`);
  };
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
  /** 把models.json里的自定义Provider注册进Pi；文件损坏时只记录，不阻止启动。 */
  const syncProviders = async () => {
    if (options.models) return;
    try {
      registerCustomProviders(live, await modelSettings.config());
    } catch (error) {
      console.error("[wordhub-worker] 自定义Provider加载失败", error);
    }
  };
  const ready = projectService.init().then(syncProviders);
  const recoverProjectFiles = (id: string) => projectService.store(id);
  const createProject = (
    request: Extract<RuntimeRequest, { type: "project.create" }>,
  ) => projectService.create(request);
  const { resolveAgent, buildRunContext, createAgentTools, appendRunEvent } =
    createRunSupport({ post, modelSettings, runContexts });
  const intake = createNovelIntakeService({
    projects: projectService,
    append: appendRunEvent,
    resolveDraftModel: async (projectPath, mode) => {
      const resolved = await modelSettings.resolve({
        agentId: "planner",
        projectPath,
      });
      const runtimeModels = mode === "mock" ? mockModels : models;
      const model = runtimeModels.getModel(
        resolved.ref.provider,
        resolved.ref.id,
      );
      if (!model)
        throw new Error(
          `model not found: ${resolved.ref.provider}/${resolved.ref.id}`,
        );
      if (mode !== "mock") await assertAuth(resolved.ref.provider);
      return {
        models: runtimeModels,
        model,
        reasoning: resolved.ref.reasoning,
      };
    },
  });
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
    intake,
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
    appendRunEvent(
      located.store,
      located.request,
      "challenge.resolved",
      { type: "user", id: "user" },
      {
        threadId: request.threadId,
        resolution: request.decision === "accept" ? "accepted" : "kept",
      },
    );
    await workflows.continueWorkflow(request.workflowId);
  };
  const intakeAnswer = async (
    request: Extract<RuntimeRequest, { type: "intake.answer" }>,
  ) => intake.answer(request);
  const intakeConfirm = async (
    request: Extract<RuntimeRequest, { type: "intake.confirm" }>,
  ) => intake.confirm(request);
  const resumeRun = async (runId: string) => {
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
        resume: true,
      });
      return;
    }
    throw new Error("没有可继续的中断运行");
  };

  async function testConnection(
    request: Extract<RuntimeRequest, { type: "settings.testConnection" }>,
  ): Promise<{ ok: boolean; message: string }> {
    const config = await modelSettings.config(request.projectPath);
    const entry = config.providers.find((item) => item.id === request.provider);
    // 未指定模型时选输出价格最低且已知价格的模型，避免用贵模型做连通性测试。
    const cheapest = [...(entry?.models ?? [])]
      .filter((item) => item.pricingSource !== "unknown")
      .sort(
        (x, y) => x.pricing.outputUsdPerMillion - y.pricing.outputUsdPerMillion,
      )[0];
    const modelId = request.model ?? cheapest?.id ?? entry?.models[0]?.id;
    const model = modelId
      ? models.getModel(request.provider, modelId)
      : undefined;
    if (!entry || !model)
      return { ok: false, message: `服务商或模型不可用：${request.provider}` };
    if (!(await models.getAuth(request.provider)))
      return { ok: false, message: "尚未配置API密钥" };
    const host = new PiAgentHost({
      models,
      model,
      reasoning: "off",
      systemPrompt: "你是连接测试助手。只需回复：连接成功。",
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
      if (mode !== "mock") {
        const provider =
          typeof payload.provider === "string" ? payload.provider : undefined;
        const ref = (
          await modelSettings
            .resolve({
              agentId:
                typeof payload.agentId === "string"
                  ? payload.agentId
                  : "writer",
              projectPath: project.folderPath,
            })
            .catch(() => undefined)
        )?.ref;
        const needed = provider ?? ref?.provider ?? "deepseek";
        if (!(await models.getAuth(needed))) {
          const message = `${needed}的API密钥未配置，无法恢复这次审批`;
          await failPersistedRun(runId, message);
          throw new Error(message);
        }
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
    providerAuth: async (id) => {
      const check = await models.checkAuth(id);
      return { configured: Boolean(check), source: check?.source };
    },
    reloadProviders: syncProviders,
    resumePersistedApproval,
    pendingApprovals,
    runContexts,
    active,
    appendRunEvent,
    runLive: workflows.start,
    estimate: workflows.estimate,
    decideChallenge,
    intakeAnswer,
    intakeConfirm,
    resumeRun,
  });
  return {
    ready,
    async handle(request: RuntimeRequest): Promise<void> {
      // 密钥同步先于其后到达的所有请求完成，避免请求在密钥写入前读取。
      if (request.type === "credentials.sync") {
        credentialsReady = credentialsReady.then(() =>
          syncCredentials(request.keys),
        );
        await credentialsReady;
        return;
      }
      await credentialsReady;
      await handle(request);
    },
    close() {
      for (const running of active.values()) running.abort();
      for (const approval of pendingApprovals.values()) approval.resolve(false);
      projectService.close();
    },
  };
}
