import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { Type } from "typebox";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ControlledFileWriter, WordHubStore, createId, projectChat, timestamp } from "@wordhub/store";
import type { Event } from "@wordhub/contracts";

type WorkerRequest =
  | { type: "init"; storageRoot?: string; requestId?: string }
  | { type: "project.create"; name: string; folderPath: string; projectId?: string; requestId: string }
  | { type: "project.listRecent"; requestId: string }
  | { type: "session.create"; projectId: string; title: string; sessionId?: string; requestId: string }
  | { type: "session.list"; projectId: string; requestId: string }
  | { type: "session.rename"; sessionId: string; title: string; projectId?: string; requestId: string }
  | { type: "chat.list"; projectId: string; sessionId: string; requestId: string }
  | { type: "file.write"; projectId: string; folderPath: string; relativePath: string; content: string; sessionId?: string; artifactId?: string; requestId: string }
  | { type: "file.undo"; projectId: string; folderPath: string; relativePath: string; artifactId: string; sessionId?: string; requestId: string }
  | { type: "run"; runId: string; prompt: string; model?: string; reasoning?: string; mode?: "live" | "mock"; toolRoundTrip?: boolean; projectPath?: string; projectId?: string; sessionId?: string }
  | { type: "abort"; runId: string };

type ParentPort = { on(event: "message", listener: (event: { data: WorkerRequest }) => void): void; postMessage(message: unknown): void };
const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
if (!parentPort) throw new Error("WordHub Pi worker requires Electron utilityProcess.parentPort");

type ProjectIndex = { id: string; name: string; folderPath: string; createdAt: string; updatedAt: string };
const post = (message: Record<string, unknown>) => parentPort.postMessage(message);
const models = createModels();
models.setProvider(deepseekProvider());
const active = new Map<string, Agent>();
const activeMocks = new Map<string, AbortController>();
const stores = new Map<string, WordHubStore>();
const projects = new Map<string, ProjectIndex>();
type RunContext = { store: WordHubStore; request: Extract<WorkerRequest, { type: "run" }>; cancelled: boolean; finished: boolean };
const runContexts = new Map<string, RunContext>();
let storageRoot = process.env.WORDHUB_STORAGE_ROOT ?? path.join(process.env.LOCALAPPDATA ?? process.cwd(), "WordHub");
let registryPath = path.join(storageRoot, "projects.json");

async function saveRegistry(): Promise<void> {
  await mkdir(storageRoot, { recursive: true });
  const temporary = `${registryPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify([...projects.values()], null, 2), "utf8");
  await rename(temporary, registryPath);
}
async function initStorage(nextRoot?: string): Promise<void> {
  if (nextRoot) storageRoot = nextRoot;
  registryPath = path.join(storageRoot, "projects.json");
  await mkdir(path.join(storageRoot, "projects"), { recursive: true });
  const records = await readFile(registryPath, "utf8").then((text) => JSON.parse(text) as ProjectIndex[]).catch(() => []);
  for (const record of records) projects.set(record.id, record);
}
const ready = initStorage();
function storeFor(projectId: string): WordHubStore { const existing = stores.get(projectId); if (existing) return existing; const store = new WordHubStore(path.join(storageRoot, "projects", projectId)); stores.set(projectId, store); return store; }
function sendResponse(requestId: string, result: unknown): void { post({ type: "response", requestId, ok: true, result }); }
function sendError(requestId: string, error: unknown): void { post({ type: "response", requestId, ok: false, error: error instanceof Error ? error.message : String(error) }); }

async function createProject(request: Extract<WorkerRequest, { type: "project.create" }>): Promise<ProjectIndex & { sessionId: string }> {
  await initStorage();
  const existing = [...projects.values()].find((project) => path.resolve(project.folderPath) === path.resolve(request.folderPath));
  if (existing) { const store = storeFor(existing.id); const session = store.listSessions(existing.id)[0] ?? store.createSession({ projectId: existing.id, title: "新会话" }); return { ...existing, sessionId: session.id }; }
  const projectId = request.projectId ?? createId("project");
  const store = storeFor(projectId);
  const project = store.createProject({ id: projectId, name: request.name, folderPath: request.folderPath });
  const session = store.createSession({ projectId: project.id, title: "新会话" });
  const record: ProjectIndex = { id: project.id, name: project.name, folderPath: project.folderPath, createdAt: project.createdAt, updatedAt: project.updatedAt };
  projects.set(record.id, record);
  await mkdir(path.join(record.folderPath, ".wordhub"), { recursive: true });
  await writeFile(path.join(record.folderPath, ".wordhub", "project.json"), JSON.stringify({ schemaVersion: 1, projectId: record.id, storage: "appData/WordHub/projects", linkedFolder: record.folderPath }, null, 2), "utf8");
  await saveRegistry();
  return { ...record, sessionId: session.id };
}

const echoTool = { name: "wordhub_echo", label: "文枢回声工具", description: "回传一个短句，用于验证思考模式下的多轮工具调用。", parameters: Type.Object({ text: Type.String({ minLength: 1, maxLength: 200 }) }), execute: async (_toolCallId: string, params: unknown) => { const text = (params as { text: string }).text; return { content: [{ type: "text" as const, text: `工具已执行：${text}` }], details: { roundTrip: true } }; } };

function appendRunEvent(store: WordHubStore, request: Extract<WorkerRequest, { type: "run" }>, type: string, actor: { type: "user" | "agent" | "system"; id: string }, payload: Record<string, unknown>, idempotencyKey?: string): Event {
  const event = store.appendEvent({ schemaVersion: 1, id: createId("evt"), projectId: request.projectId!, sessionId: request.sessionId!, runId: request.runId, type, actor, occurredAt: timestamp(), idempotencyKey, visibility: "room", payload });
  const compatibility: Record<string, string> = { "run.text_delta": "run.text", "run.tool_started": "run.tool_execution_start", "run.tool_finished": "run.tool_execution_end", "run.error": "error" };
  post({ type: compatibility[type] ?? type, runId: request.runId, ...payload });
  return event;
}

async function ensureRunContext(request: Extract<WorkerRequest, { type: "run" }>): Promise<WordHubStore> {
  await initStorage();
  if (!request.projectId && request.projectPath) request.projectId = (await createProject({ type: "project.create", name: path.basename(request.projectPath), folderPath: request.projectPath, requestId: createId("req") })).id;
  if (!request.projectId) {
    request.projectId = "ephemeral";
    const ephemeral = storeFor(request.projectId);
    if (!ephemeral.getProject(request.projectId)) {
      const folder = path.join(storageRoot, "ephemeral-folder");
      await mkdir(folder, { recursive: true });
      ephemeral.createProject({ id: request.projectId, name: "未命名项目", folderPath: folder });
    }
  }
  const store = storeFor(request.projectId);
  const sessions = store.listSessions(request.projectId);
  if (!request.sessionId || !sessions.some((session) => session.id === request.sessionId)) request.sessionId = sessions[0]?.id ?? store.createSession({ projectId: request.projectId, title: "新会话" }).id;
  runContexts.set(request.runId, { store, request, cancelled: false, finished: false });
  return store;
}

async function runLive(request: Extract<WorkerRequest, { type: "run" }>): Promise<void> {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is not set");
  const store = await ensureRunContext(request);
  const model = models.getModel("deepseek", request.model ?? "deepseek-flash");
  if (!model) throw new Error(`model not found: ${request.model}`);
  store.startRun({ projectId: request.projectId!, sessionId: request.sessionId!, runId: request.runId, prompt: request.prompt, model: model.id });
  appendRunEvent(store, request, "chat.user_message", { type: "user", id: "user" }, { text: request.prompt }, `prompt:${request.runId}`);
  appendRunEvent(store, request, "run.started", { type: "agent", id: model.id }, { agentId: "writer", model: model.id });
  let text = "";
  const agent = new Agent({ initialState: { model, thinkingLevel: (request.reasoning ?? "high") as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", systemPrompt: request.toolRoundTrip ? "你是文枢工具调用验证助手。必须先调用wordhub_echo两次，每次传入不同中文短句；收到两次工具结果后，只用一句中文总结。" : "你是文枢P1后台写作助手。只用一句中文回答。", tools: request.toolRoundTrip ? [echoTool] : [] }, streamFn: models.streamSimple.bind(models), toolExecution: "sequential" });
  active.set(request.runId, agent);
  agent.subscribe((event) => {
    if (event.type === "tool_execution_start") appendRunEvent(store, request, "run.tool_started", { type: "agent", id: model.id }, { tool: event.toolName, toolCallId: event.toolCallId });
    if (event.type === "tool_execution_end") appendRunEvent(store, request, "run.tool_finished", { type: "agent", id: model.id }, { tool: event.toolName, toolCallId: event.toolCallId });
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") { text += event.assistantMessageEvent.delta; appendRunEvent(store, request, "run.text_delta", { type: "agent", id: model.id }, { delta: event.assistantMessageEvent.delta }); }
  });
  await agent.prompt(request.prompt);
  active.delete(request.runId);
  const context = runContexts.get(request.runId);
  if (!context || context.cancelled) return;
  store.finishRun(request.runId, "succeeded");
  appendRunEvent(store, request, "run.finished", { type: "agent", id: model.id }, { ok: true, model: model.id, text });
  context.finished = true;
  runContexts.delete(request.runId);
}

async function runMock(request: Extract<WorkerRequest, { type: "run" }>): Promise<void> {
  const store = await ensureRunContext(request);
  store.startRun({ projectId: request.projectId!, sessionId: request.sessionId!, runId: request.runId, prompt: request.prompt, model: "mock" });
  appendRunEvent(store, request, "chat.user_message", { type: "user", id: "user" }, { text: request.prompt }, `prompt:${request.runId}`);
  appendRunEvent(store, request, "run.started", { type: "agent", id: "mock" }, { mode: "mock" });
  const controller = new AbortController(); activeMocks.set(request.runId, controller);
  const timer = setInterval(() => { if (!controller.signal.aborted) appendRunEvent(store, request, "run.text_delta", { type: "agent", id: "mock" }, { delta: "文枢后台进程正在流式写作。" }); }, 15);
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  clearInterval(timer); activeMocks.delete(request.runId);
  const context = runContexts.get(request.runId);
  if (context?.finished) { runContexts.delete(request.runId); return; }
  if (controller.signal.aborted) { store.finishRun(request.runId, "cancelled"); appendRunEvent(store, request, "run.aborted", { type: "agent", id: "mock" }, { ok: true }); }
  else { store.finishRun(request.runId, "succeeded"); appendRunEvent(store, request, "run.finished", { type: "agent", id: "mock" }, { ok: true, mode: "mock" }); }
  if (context) { context.finished = true; runContexts.delete(request.runId); }
}

async function handle(request: WorkerRequest): Promise<void> {
  await ready;
  try {
    if (request.type === "init") { await initStorage(request.storageRoot); if (request.requestId) sendResponse(request.requestId, { ready: true }); return; }
    if (request.type === "project.create") { sendResponse(request.requestId, await createProject(request)); return; }
    if (request.type === "project.listRecent") { sendResponse(request.requestId, { projects: [...projects.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }); return; }
    if (request.type === "session.create") { sendResponse(request.requestId, { session: storeFor(request.projectId).createSession({ projectId: request.projectId, id: request.sessionId, title: request.title }) }); return; }
    if (request.type === "session.list") { sendResponse(request.requestId, { sessions: storeFor(request.projectId).listSessions(request.projectId) }); return; }
    if (request.type === "session.rename") { if (!request.projectId) throw new Error("重命名会话需要项目ID"); storeFor(request.projectId).renameSession(request.sessionId, request.title); sendResponse(request.requestId, { sessionId: request.sessionId }); return; }
    if (request.type === "chat.list") { const events = storeFor(request.projectId).listEvents(request.projectId, request.sessionId); sendResponse(request.requestId, { events, items: projectChat(events) }); return; }
    if (request.type === "file.write") { const result = await new ControlledFileWriter(storeFor(request.projectId), request.projectId, request.folderPath).writeText(request); sendResponse(request.requestId, result); return; }
    if (request.type === "file.undo") { const result = await new ControlledFileWriter(storeFor(request.projectId), request.projectId, request.folderPath).undo(request); sendResponse(request.requestId, result); return; }
  } catch (error) {
    if ("requestId" in request && request.requestId) {
      sendError(request.requestId, error);
    } else {
      const failedRunId = "runId" in request ? request.runId : undefined;
      const context = failedRunId ? runContexts.get(failedRunId) : undefined;
      if (context?.cancelled) return;
      if (context && failedRunId && !context.finished) {
        const message = error instanceof Error ? error.message : String(error);
        context.store.finishRun(failedRunId, "failed", message);
        appendRunEvent(context.store, context.request, "run.error", { type: "system", id: "worker" }, { error: message });
        context.finished = true;
        runContexts.delete(failedRunId);
      } else {
        post({ type: "error", runId: failedRunId, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return;
  }
  if (request.type === "abort") { const context = runContexts.get(request.runId); if (context && !context.finished) { context.cancelled = true; context.store.finishRun(request.runId, "cancelled"); appendRunEvent(context.store, context.request, "run.aborted", { type: "system", id: "worker" }, { ok: true }); context.finished = true; } active.get(request.runId)?.abort(); activeMocks.get(request.runId)?.abort(); activeMocks.delete(request.runId); return; }
  if (request.type !== "run") return;
  post({ type: "run.started", runId: request.runId, mode: request.mode ?? "live", projectPath: request.projectPath });
  void (request.mode === "mock" ? runMock(request) : runLive(request)).catch((error: unknown) => {
    active.delete(request.runId);
    const context = runContexts.get(request.runId);
    if (context?.cancelled) return;
    const message = error instanceof Error ? error.message : String(error);
    if (context && !context.finished) {
      context.store.finishRun(request.runId, "failed", message);
      appendRunEvent(context.store, context.request, "run.error", { type: "system", id: "worker" }, { error: message });
      context.finished = true;
      runContexts.delete(request.runId);
    } else {
      post({ type: "error", runId: request.runId, ok: false, error: message });
    }
  });
}

parentPort.on("message", ({ data }) => { void handle(data); });
ready.then(() => post({ type: "ready", pid: process.pid }));
