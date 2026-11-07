import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  STYLE_SAMPLES_FILE,
  STYLE_SAMPLE_LIMITS,
  addStyleSample,
  parseStyleSamples,
  removeStyleSample,
} from "../references/style.js";
import {
  deleteReference,
  importReference,
  listReferences,
  quoteFromRange,
  readReferenceChapter,
  searchReferences,
} from "../references/library.js";
import {
  addAnnotation,
  coverFile,
  createCollection,
  deleteAnnotation,
  deleteCollection,
  findSimilarGroups,
  listAnnotations,
  listCollections,
  recordOpened,
  renameCollection,
  updateAnnotation,
  updateReference,
} from "../references/shelf.js";
import type { ReferenceMeta } from "../references/types.js";
import { contentHash } from "@wordhub/store";
import {
  FORM_TOOLS,
  READ_SCOPE_CHOICES,
  WRITE_SCOPE_CHOICES,
  deleteProjectAgent,
  readProjectAgentForm,
  saveProjectAgent,
} from "../agents/custom.js";
import { PRESET_FONTS, listInstalledFonts } from "../export/fonts.js";
import { exportChapters } from "../export/run.js";
import {
  ControlledFileWriter,
  WordHubStore,
  projectChat,
} from "@wordhub/store";
import {
  projectAliases,
  projectFacts,
  projectFinalized,
  projectKnowledge,
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
import type { createGraphService } from "../graph/service.js";

import type { createLinkService } from "../graph/links.js";
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
  graph: ReturnType<typeof createGraphService>;
  recoverProjectFiles: (id: string) => Promise<WordHubStore>;
  links: ReturnType<typeof createLinkService>;
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

/** 渲染端的写入/撤销只允许落在 chapters/ 下的 Markdown 文件，不能借此改设定、偏好等其他项目文件。 */
export function assertChapterPath(relativePath: string): void {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    !/^chapters\/[^/]+\.(?:md|markdown)$/iu.test(normalized) ||
    normalized.includes("..")
  )
    throw new Error(`只能编辑 chapters/ 下的 Markdown 章节：${relativePath}`);
}

/** 给界面的元数据：不带原件哈希，封面只告诉有没有。 */
function toReferencePayload(meta: ReferenceMeta) {
  const { sha256: _sha, cover, schemaVersion: _version, ...rest } = meta;
  return { ...rest, hasCover: Boolean(cover) };
}

/** 读取文风示范文件及其内容哈希；不存在返回 undefined。 */
async function readStyleSamplesFile(
  folder: string,
): Promise<{ text: string; hash: ReturnType<typeof contentHash> } | undefined> {
  const data = await readFile(path.join(folder, STYLE_SAMPLES_FILE)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  return data
    ? { text: data.toString("utf8"), hash: contentHash(data) }
    : undefined;
}

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
    graph,
    recoverProjectFiles,
    modelSettings,
    testConnection,
    providerAuth,
    links,
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
      if (request.type === "reference.list") {
        const references = await listReferences(request.folder);
        sendResponse(request.requestId, {
          references: references.map(toReferencePayload),
          collections: await listCollections(request.folder),
          similarGroups: (await findSimilarGroups(request.folder)).map(
            (group) => group.map((meta) => meta.id),
          ),
        });
        return;
      }
      if (request.type === "reference.update") {
        sendResponse(
          request.requestId,
          toReferencePayload(
            await updateReference(
              request.folder,
              request.referenceId,
              request.patch,
            ),
          ),
        );
        return;
      }
      if (request.type === "reference.collectionCreate") {
        sendResponse(
          request.requestId,
          await createCollection(request.folder, request.name),
        );
        return;
      }
      if (request.type === "reference.collectionRename") {
        sendResponse(
          request.requestId,
          await renameCollection(request.folder, request.id, request.name),
        );
        return;
      }
      if (request.type === "reference.collectionDelete") {
        await deleteCollection(request.folder, request.id);
        sendResponse(request.requestId, { deleted: true });
        return;
      }
      if (request.type === "reference.opened") {
        await recordOpened(
          request.folder,
          request.referenceId,
          request.chapterId,
        );
        sendResponse(request.requestId, { ok: true });
        return;
      }
      if (request.type === "reference.annotations") {
        sendResponse(request.requestId, {
          annotations: await listAnnotations(
            request.folder,
            request.referenceId,
          ),
        });
        return;
      }
      if (request.type === "reference.annotationAdd") {
        sendResponse(
          request.requestId,
          await addAnnotation(request.folder, {
            referenceId: request.referenceId,
            chapterId: request.chapterId,
            start: request.start,
            end: request.end,
            color: request.color,
            note: request.note,
          }),
        );
        return;
      }
      if (request.type === "reference.annotationUpdate") {
        sendResponse(
          request.requestId,
          await updateAnnotation(
            request.folder,
            request.referenceId,
            request.annotationId,
            { note: request.note, color: request.color },
          ),
        );
        return;
      }
      if (request.type === "reference.annotationDelete") {
        await deleteAnnotation(
          request.folder,
          request.referenceId,
          request.annotationId,
        );
        sendResponse(request.requestId, { deleted: true });
        return;
      }
      if (request.type === "reference.coverFile") {
        sendResponse(
          request.requestId,
          (await coverFile(request.folder, request.referenceId)) ?? null,
        );
        return;
      }
      if (request.type === "reference.import") {
        const imported: Array<{
          id: string;
          title: string;
          duplicate: boolean;
          similar: Array<{ id: string; title: string }>;
        }> = [];
        const failed: Array<{ name: string; error: string }> = [];
        for (const file of request.files)
          try {
            const result = await importReference(request.folder, file);
            imported.push({
              id: result.meta.id,
              title: result.meta.title,
              duplicate: result.duplicate,
              similar: result.similar.map((meta) => ({
                id: meta.id,
                title: meta.title,
              })),
            });
          } catch (error) {
            failed.push({
              name: path.basename(file),
              error: error instanceof Error ? error.message : String(error),
            });
          }
        sendResponse(request.requestId, { canceled: false, imported, failed });
        return;
      }
      if (request.type === "reference.read") {
        // 界面整章阅读不受 Agent 单次读取上限约束
        sendResponse(
          request.requestId,
          await readReferenceChapter(
            request.folder,
            request.referenceId,
            request.chapterId,
            {},
            { maxChars: 2_000_000 },
          ),
        );
        return;
      }
      if (request.type === "reference.search") {
        sendResponse(request.requestId, {
          hits: await searchReferences(request.folder, request.query, {
            referenceId: request.referenceId,
            limit: 100,
          }),
        });
        return;
      }
      if (request.type === "reference.delete") {
        await deleteReference(request.folder, request.referenceId);
        sendResponse(request.requestId, { deleted: true });
        return;
      }
      if (request.type === "reference.styleSamples") {
        const existing = await readStyleSamplesFile(request.folder);
        sendResponse(request.requestId, {
          samples: existing ? parseStyleSamples(existing.text) : [],
          limits: STYLE_SAMPLE_LIMITS,
        });
        return;
      }
      if (
        request.type === "reference.addStyleSample" ||
        request.type === "reference.removeStyleSample"
      ) {
        const existing = await readStyleSamplesFile(request.folder);
        let content: string;
        if (request.type === "reference.addStyleSample") {
          const quote = await quoteFromRange(
            request.folder,
            request.referenceId,
            request.chapterId,
            request.start,
            request.end,
          );
          content = addStyleSample(existing?.text, {
            source: "《" + quote.referenceTitle + "》" + quote.chapterTitle,
            anchor:
              request.referenceId +
              "/" +
              request.chapterId +
              "/" +
              request.start +
              "-" +
              request.end,
            text: quote.quote,
          });
        } else {
          if (!existing) throw new Error("还没有文风示范");
          content = removeStyleSample(existing.text, request.index);
        }
        const store = await recoverProjectFiles(request.projectId);
        await new ControlledFileWriter(
          store,
          request.projectId,
          request.folder,
          {
            allowBible: true,
          },
        ).writeText({
          relativePath: STYLE_SAMPLES_FILE,
          content,
          // 以读到的版本为基线：读完到写入之间文件被别处改过会被拒绝，不会覆盖
          expectedHash: existing ? existing.hash : null,
          sessionId: request.sessionId,
          author: { type: "user", id: "user" },
        });
        sendResponse(request.requestId, {
          count: parseStyleSamples(content).length,
        });
        return;
      }
      if (request.type === "agent.catalog") {
        sendResponse(request.requestId, {
          tools: [...FORM_TOOLS],
          writeScopes: [...WRITE_SCOPE_CHOICES],
          readScopes: [...READ_SCOPE_CHOICES],
        });
        return;
      }
      if (request.type === "agent.get") {
        sendResponse(
          request.requestId,
          await readProjectAgentForm(
            request.projectPath,
            modelSettings.agentRoot,
            request.name,
          ),
        );
        return;
      }
      if (request.type === "agent.save") {
        const saved = await saveProjectAgent({
          projectPath: request.projectPath,
          builtinRoot: modelSettings.agentRoot,
          config: await modelSettings.config(request.projectPath),
          input: request.agent,
          mode: request.mode,
        });
        sendResponse(request.requestId, { name: saved.name });
        return;
      }
      if (request.type === "agent.delete") {
        await deleteProjectAgent(
          request.projectPath,
          modelSettings.agentRoot,
          request.name,
        );
        sendResponse(request.requestId, { deleted: true });
        return;
      }
      if (request.type === "export.fonts") {
        sendResponse(request.requestId, {
          presets: PRESET_FONTS,
          installed: await listInstalledFonts(),
        });
        return;
      }
      if (request.type === "export.run") {
        const {
          type: _type,
          requestId: _requestId,
          ...exportRequest
        } = request;
        sendResponse(request.requestId, await exportChapters(exportRequest));
        return;
      }
      if (request.type === "chapter.write") {
        assertChapterPath(request.path);
        const store = await recoverProjectFiles(request.projectId);
        const result = await new ControlledFileWriter(
          store,
          request.projectId,
          request.folderPath,
        ).writeText({
          relativePath: request.path,
          content: request.content,
          expectedHash: request.expectedHash,
          sessionId: request.sessionId,
          author: { type: "user", id: "user" },
        });
        sendResponse(request.requestId, result);
        return;
      }
      if (request.type === "chapter.undo") {
        assertChapterPath(request.path);
        const store = await recoverProjectFiles(request.projectId);
        const result = await new ControlledFileWriter(
          store,
          request.projectId,
          request.folderPath,
        ).undo({
          artifactId: `file:${request.path.replaceAll("\\", "/")}`,
          relativePath: request.path,
          sessionId: request.sessionId,
          author: { type: "user", id: "user" },
        });
        sendResponse(request.requestId, result);
        return;
      }
      if (request.type === "chapter.revisions") {
        const store = await recoverProjectFiles(request.projectId);
        sendResponse(request.requestId, {
          revisions: store
            .listRevisions(
              request.projectId,
              `file:${request.path.replaceAll("\\", "/")}`,
            )
            .slice(-12)
            .reverse(),
        });
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
      if (request.type === "graph.interview") {
        const { type: _t, requestId: _r, ...input } = request;
          aliases: projectAliases(events),
          knowledge: projectKnowledge(events),
        sendResponse(request.requestId, await graph.interview(input));
        return;
      }
      if (request.type === "graph.simulateEstimate") {
        const { type: _t, requestId: _r, ...input } = request;
        sendResponse(request.requestId, await graph.simulateEstimate(input));
        return;
      }
      if (request.type === "graph.simulateStep") {
        const { type: _t, requestId: _r, ...input } = request;
        sendResponse(request.requestId, await graph.simulateStep(input));
        return;
      }
      if (request.type === "graph.simulateReport") {
        const { type: _t, requestId: _r, ...input } = request;
        sendResponse(request.requestId, await graph.simulateReport(input));
        return;
      }
      if (request.type === "graph.simulateSave") {
        const { type: _t, requestId: _r, ...input } = request;
        sendResponse(request.requestId, await graph.simulateSave(input));
        return;
      }
      if (request.type === "graph.interviewSave") {
        const { type: _t, requestId: _r, ...input } = request;
        sendResponse(request.requestId, await graph.interviewSave(input));
        return;
      }
      if (request.type === "graph.aliasLink") {
        const { type: _t, requestId: _r, ...input } = request;
        sendResponse(request.requestId, await links.aliasLink(input));
        return;
      }
      if (request.type === "graph.aliasUnlink") {
        const { type: _t, requestId: _r, ...input } = request;
        sendResponse(request.requestId, await links.aliasUnlink(input));
        return;
      }
      if (request.type === "graph.knowledgeSet") {
        const { type: _t, requestId: _r, ...input } = request;
        sendResponse(request.requestId, await links.knowledgeSet(input));
        return;
      }
      if (request.type === "graph.knowledgeClear") {
        const { type: _t, requestId: _r, ...input } = request;
        sendResponse(request.requestId, await links.knowledgeClear(input));
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
