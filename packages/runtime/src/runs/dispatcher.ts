import {
  ControlledFileWriter,
  WordHubStore,
  projectChat,
} from "@wordhub/store";
import type { RuntimeRequest } from "./executor-types.js";
import type {
  RunContext,
  PendingApproval,
  AppendRunEvent,
} from "./run-types.js";
import type { ProjectService } from "../projects/service.js";
import type { ModelSettings } from "../models/settings.js";
import type { RunEstimate } from "../budget/estimate.js";

type DispatcherDeps = {
  ready: Promise<unknown>;
  storageRoot: string;
  post: (message: Record<string, unknown>) => void;
  sendResponse: (requestId: string, result: unknown) => void;
  sendError: (requestId: string, error: unknown) => void;
  createProject: (
    request: Extract<RuntimeRequest, { type: "project.create" }>,
  ) => Promise<unknown>;
  projectService: ProjectService;
  recoverProjectFiles: (id: string) => Promise<WordHubStore>;
  modelSettings: ModelSettings;
  testConnection: (
    request: Extract<RuntimeRequest, { type: "settings.testConnection" }>,
  ) => Promise<{ ok: boolean; message: string }>;
  resumePersistedApproval: (
    runId: string,
    approved: boolean,
    apiKey?: string,
  ) => Promise<void>;
  pendingApprovals: Map<string, PendingApproval>;
  runContexts: Map<string, RunContext>;
  active: Map<string, { abort(): void }>;
  appendRunEvent: AppendRunEvent;
  runLive: (request: Extract<RuntimeRequest, { type: "run" }>) => Promise<void>;
  estimate: (
    request: Extract<RuntimeRequest, { type: "run.estimate" }>,
  ) => Promise<RunEstimate>;
  decideChallenge: (
    request: Extract<RuntimeRequest, { type: "challenge.decide" }>,
  ) => Promise<void>;
  resumeRun: (runId: string, apiKey?: string) => Promise<void>;
};

export function createRequestHandler(deps: DispatcherDeps) {
  const {
    ready,
    storageRoot,
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
    runLive,
    estimate,
    decideChallenge,
    resumeRun,
  } = deps;
  const options = { storageRoot };
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
        sendResponse(request.requestId, await estimate(request));
        return;
      }
      if (request.type === "challenge.decide") {
        await decideChallenge(request);
        sendResponse(request.requestId, {
          workflowId: request.workflowId,
          threadId: request.threadId,
          decision: request.decision,
        });
        return;
      }
      if (request.type === "run.resume") {
        await resumeRun(request.runId, request.apiKey);
        sendResponse(request.requestId, {
          runId: request.runId,
          resumed: true,
        });
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
          await resumePersistedApproval(
            request.runId,
            request.approved,
            request.apiKey,
          );
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

  return handle;
}
