import {
  ControlledFileWriter,
  WordHubStore,
  projectChat,
} from "@wordhub/store";
import {
  projectFacts,
  projectFinalized,
  projectSummaries,
} from "@wordhub/contracts";
import {
  listChapters,
  readChapter,
  watchChapters,
} from "../chapters/service.js";
import { loadProjectPrefs, saveProjectPrefs } from "../projects/prefs.js";
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
  providerAuth: (
    id: string,
  ) => Promise<{ configured: boolean; source?: string }>;
  reloadProviders: () => Promise<void>;
  testConnection: (
    request: Extract<RuntimeRequest, { type: "settings.testConnection" }>,
  ) => Promise<{ ok: boolean; message: string }>;
  resumePersistedApproval: (runId: string, approved: boolean) => Promise<void>;
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
  intakeAnswer: (
    request: Extract<RuntimeRequest, { type: "intake.answer" }>,
  ) => Promise<void>;
  intakeConfirm: (
    request: Extract<RuntimeRequest, { type: "intake.confirm" }>,
  ) => Promise<void>;
  resumeRun: (runId: string) => Promise<void>;
};

export function createRequestHandler(deps: DispatcherDeps) {
  // 同一时间只监听当前打开项目的 chapters/ 目录。
  const chapterWatchers = new Map<string, () => void>();
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
    providerAuth,
    reloadProviders,
    resumePersistedApproval,
    pendingApprovals,
    runContexts,
    active,
    appendRunEvent,
    runLive,
    estimate,
    decideChallenge,
    intakeAnswer,
    intakeConfirm,
    resumeRun,
  } = deps;
  const chapterFolder = (projectId: string): string => {
    const project = projectService
      .recent()
      .find((item) => item.id === projectId);
    if (!project) throw new Error("项目不存在");
    return project.folderPath;
  };
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
      if (request.type === "chapter.list") {
        const folder = chapterFolder(request.projectId);
        sendResponse(request.requestId, {
          chapters: await listChapters(folder),
        });
        return;
      }
      if (request.type === "chapter.read") {
        const folder = chapterFolder(request.projectId);
        sendResponse(
          request.requestId,
          await readChapter(folder, request.path),
        );
        return;
      }
      if (request.type === "chapter.watch") {
        const folder = chapterFolder(request.projectId);
        for (const stop of chapterWatchers.values()) stop();
        chapterWatchers.clear();
        chapterWatchers.set(
          request.projectId,
          watchChapters(folder, (chapters) =>
            post({
              type: "chapters.changed",
              projectId: request.projectId,
              chapters,
            }),
          ),
        );
        sendResponse(request.requestId, { watching: true });
        return;
      }
      if (request.type === "project.prefs.get") {
        sendResponse(
          request.requestId,
          await loadProjectPrefs(chapterFolder(request.projectId)),
        );
        return;
      }
      if (request.type === "project.prefs.set") {
        sendResponse(
          request.requestId,
          await saveProjectPrefs(chapterFolder(request.projectId), {
            ...(request.autoReviewOnFinalize === undefined
              ? {}
              : { autoReviewOnFinalize: request.autoReviewOnFinalize }),
          }),
        );
        return;
      }
      if (request.type === "fact.list") {
        const store = await recoverProjectFiles(request.projectId);
        const events = store.listEvents(request.projectId);
        sendResponse(request.requestId, {
          facts: projectFacts(events),
          summaries: projectSummaries(events),
          finalized: [...projectFinalized(events)],
        });
        return;
      }
      if (request.type === "fact.decide") {
        const store = await recoverProjectFiles(request.projectId);
        const events = store.listEvents(request.projectId);
        const fact = projectFacts(events).find(
          (item) => item.id === request.factId,
        );
        const origin = events.find(
          (event) =>
            event.type === "fact.proposed" &&
            (event.payload as Record<string, unknown>).factId ===
              request.factId,
        );
        if (!fact || !origin) throw new Error("事实不存在");
        const confirmed = request.decision === "confirm";
        appendRunEvent(
          store,
          {
            type: "run",
            runId: origin.runId,
            projectId: request.projectId,
            sessionId: origin.sessionId,
            prompt: "",
          },
          confirmed ? "fact.confirmed" : "fact.rejected",
          { type: "user", id: "user" },
          { factId: request.factId },
        );
        sendResponse(request.requestId, {
          factId: request.factId,
          status: confirmed ? "confirmed" : "rejected",
        });
        return;
      }
      if (request.type === "settings.models") {
        const view = await modelSettings.view(request.projectPath);
        sendResponse(request.requestId, view);
        return;
      }
      if (request.type === "settings.providers") {
        const providers = await modelSettings.providerList(request.projectPath);
        sendResponse(request.requestId, {
          presets: await modelSettings.presets(),
          providers: await Promise.all(
            providers.map(async (provider) => ({
              ...provider,
              auth: await providerAuth(provider.id),
            })),
          ),
        });
        return;
      }
      if (request.type === "settings.addProvider") {
        if (request.preset) await modelSettings.addPreset(request.preset);
        else if (request.custom)
          await modelSettings.addCustom(request.custom, request.replace);
        else throw new Error("需要选择预设或填写自定义Provider");
        await reloadProviders();
        sendResponse(request.requestId, { saved: true });
        return;
      }
      if (request.type === "settings.removeProvider") {
        await modelSettings.removeProvider(request.id, request.projectPath);
        await reloadProviders();
        sendResponse(request.requestId, { saved: true });
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
      if (request.type === "intake.answer") {
        await intakeAnswer(request);
        sendResponse(request.requestId, {
          intakeId: request.intakeId,
          questionId: request.questionId,
        });
        return;
      }
      if (request.type === "intake.confirm") {
        await intakeConfirm(request);
        sendResponse(request.requestId, {
          intakeId: request.intakeId,
          confirmed: true,
        });
        return;
      }
      if (request.type === "run.resume") {
        await resumeRun(request.runId);
        sendResponse(request.requestId, {
          runId: request.runId,
          resumed: true,
        });
        return;
      }
      if (request.type === "settings.setAgentModel") {
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

  return handle;
}
