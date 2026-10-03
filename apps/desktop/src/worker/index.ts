import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { Type } from "typebox";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ControlledFileWriter, WordHubStore, contentHash, projectChat, safeProjectTarget, createId, timestamp } from "@wordhub/store";
import type { Actor, Event } from "@wordhub/contracts";
import { AgentRegistry, ContextBuilder, ModelResolver, PermissionDeniedError, PermissionGuard, createBuiltinTools, loadModelConfig } from "@wordhub/runtime";
import type { AgentDefinition, ModelConfig, ModelRef } from "@wordhub/runtime";

type WorkerRequest =
  | { type: "init"; storageRoot?: string; requestId?: string }
  | { type: "project.create"; name: string; folderPath: string; projectId?: string; requestId: string }
  | { type: "project.listRecent"; requestId: string }
  | { type: "session.create"; projectId: string; title: string; sessionId?: string; requestId: string }
  | { type: "session.list"; projectId: string; requestId: string }
  | { type: "session.rename"; sessionId: string; title: string; projectId?: string; requestId: string }
  | { type: "chat.list"; projectId: string; sessionId: string; requestId: string }
  | { type: "file.write"; projectId: string; folderPath: string; relativePath: string; content: string; sessionId?: string; artifactId?: string; runId?: string; taskId?: string; expectedHash?: `sha256:${string}` | null; conflictPolicy?: "reject" | "keep-both"; requestId: string }
  | { type: "file.undo"; projectId: string; folderPath: string; relativePath: string; artifactId: string; sessionId?: string; requestId: string }
  | { type: "run.approve"; runId: string; approved: boolean; requestId: string }
  | { type: "run"; runId: string; prompt: string; rawPrompt?: string; agentId?: string; mentions?: string[]; apiKey?: string; model?: string; reasoning?: string; mode?: "live" | "mock"; toolRoundTrip?: boolean; projectPath?: string; projectId?: string; sessionId?: string }
  | { type: "abort"; runId: string };

type ParentPort = { on(event: "message", listener: (event: { data: WorkerRequest }) => void): void; postMessage(message: unknown): void };
const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
if (!parentPort) throw new Error("WordHub Pi worker requires Electron utilityProcess.parentPort");

type ProjectIndex = { id: string; name: string; folderPath: string; createdAt: string; updatedAt: string };
const post = (message: Record<string, unknown>) => parentPort.postMessage(message);
const models = createModels();
models.setProvider(deepseekProvider());
const runtimeModelConfig: ModelConfig = {
  schemaVersion: 1,
  defaults: { provider: "deepseek", id: "deepseek-flash", reasoning: "low" },
  providers: [{
    id: "deepseek",
    label: "DeepSeek",
    kind: "builtin",
    enabled: true,
    models: [
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", contextWindow: 1000000, maxOutputTokens: 384000, supportsReasoning: true, supportedReasoning: ["high", "max"], pricing: { inputUsdPerMillion: 1.32, outputUsdPerMillion: 3.96, cacheReadUsdPerMillion: 0.044 } },
      { id: "deepseek-flash", label: "DeepSeek V4.1 Flash", contextWindow: 1000000, maxOutputTokens: 384000, supportsReasoning: true, supportedReasoning: ["low", "high", "max"], pricing: { inputUsdPerMillion: 0.30, outputUsdPerMillion: 1.20, cacheReadUsdPerMillion: 0.006 } },
    ],
  }],
};
const agentRegistry = new AgentRegistry(path.join(process.env.WORDHUB_WORKSPACE_ROOT ?? process.cwd(), "packages", "novel", "agents"));
const contextBuilder = new ContextBuilder();
const active = new Map<string, Agent>();
const activeMocks = new Map<string, AbortController>();
const stores = new Map<string, WordHubStore>();
const projects = new Map<string, ProjectIndex>();
type RunContext = { store: WordHubStore; request: Extract<WorkerRequest, { type: "run" }>; cancelled: boolean; finished: boolean; waitingApproval?: boolean };
const runContexts = new Map<string, RunContext>();
type PendingApproval = { agent: Agent; toolCallId: string; toolName: string; args: unknown; resolve: (approved: boolean) => void };
const pendingApprovals = new Map<string, PendingApproval>();
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
function storeFor(projectId: string): WordHubStore { const existing = stores.get(projectId); if (existing) return existing; const store = new WordHubStore(path.join(storageRoot, "projects", projectId)); store.recoverInterruptedRuns(); stores.set(projectId, store); return store; }
async function recoverProjectFiles(projectId: string): Promise<WordHubStore> {
  const store = storeFor(projectId);
  const project = projects.get(projectId) ?? store.getProject(projectId);
  if (project) await new ControlledFileWriter(store, projectId, project.folderPath, { allowBible: true }).recover();
  return store;
}
function sendResponse(requestId: string, result: unknown): void { post({ type: "response", requestId, ok: true, result }); }
function sendError(requestId: string, error: unknown): void { post({ type: "response", requestId, ok: false, error: error instanceof Error ? error.message : String(error) }); }

async function resolveAgent(request: Extract<WorkerRequest, { type: "run" }>): Promise<{ definition?: AgentDefinition; modelRef: ModelRef }> {
  const definitions = await agentRegistry.load(request.projectPath);
  const definition = request.agentId ? definitions.get(request.agentId) : definitions.get("writer");
  const globalConfig = await loadModelConfig(path.join(storageRoot, "models.json"), runtimeModelConfig);
  const config = request.projectPath ? await loadModelConfig(path.join(request.projectPath, ".wordhub", "models.json"), globalConfig) : globalConfig;
  const modelResolver = new ModelResolver(config);
  const requested = request.model || request.reasoning ? { provider: "deepseek", id: request.model ?? definition?.model.id ?? config.defaults.id, reasoning: (request.reasoning ?? definition?.model.reasoning ?? config.defaults.reasoning) as ModelRef["reasoning"] } : undefined;
  const modelRef = modelResolver.resolve({ message: requested, agent: definition, global: config.defaults });
  return { definition, modelRef };
}

async function buildRunContext(request: Extract<WorkerRequest, { type: "run" }>, store: WordHubStore) {
  const layers: Array<{ id: string; kind: "bible" | "outline" | "recent" | "document" | "memory" | "custom"; text: string; sourcePath?: string }> = [];
  if (request.projectPath) {
    const biblePath = path.join(request.projectPath, ".wordhub", "bible", "bible.md");
    const bible = await readFile(biblePath, "utf8").catch(() => "");
    if (bible) layers.push({ id: "bible", kind: "bible", text: bible, sourcePath: biblePath });
  }
  const recent = store.listEvents(request.projectId!, request.sessionId!).filter((event) => event.type === "chat.user_message" || event.type === "run.finished").slice(-8).map((event) => JSON.stringify(event.payload)).join("\n");
  if (recent) layers.push({ id: "recent", kind: "recent", text: recent });
  const context = contextBuilder.build(layers, request.prompt);
  appendRunEvent(store, request, "context.injected", { type: "system", id: "context" }, { manifest: context.manifest.map(({ id, kind, sourcePath, estimatedTokens }) => ({ id, kind, sourcePath, estimatedTokens })), estimatedTokens: context.estimatedTokens });
  return context;
}

async function createProject(request: Extract<WorkerRequest, { type: "project.create" }>): Promise<ProjectIndex & { sessionId: string }> {
  await initStorage();
  const normalizedFolder = normalizeFolderPath(request.folderPath);
  const descriptor: { projectId?: string } = await readFile(path.join(request.folderPath, ".wordhub", "project.json"), "utf8")
    .then((value) => JSON.parse(value) as { projectId?: string })
    .catch(() => ({ projectId: undefined }));
  const described = descriptor.projectId ? projects.get(descriptor.projectId) : undefined;
  const existing = described ?? [...projects.values()].find((project) => normalizeFolderPath(project.folderPath) === normalizedFolder);
  if (existing) { const store = storeFor(existing.id); await new ControlledFileWriter(store, existing.id, existing.folderPath).recover(); const session = store.listSessions(existing.id)[0] ?? store.createSession({ projectId: existing.id, title: "新会话" }); return { ...existing, sessionId: session.id }; }
  const projectId = request.projectId ?? descriptor.projectId ?? createId("project");
  const store = storeFor(projectId);
  const project = store.createProject({ id: projectId, name: request.name, folderPath: request.folderPath });
  const session = store.createSession({ projectId: project.id, title: "新会话" });
  const record: ProjectIndex = { id: project.id, name: project.name, folderPath: project.folderPath, createdAt: project.createdAt, updatedAt: project.updatedAt };
  projects.set(record.id, record);
  await mkdir(path.join(record.folderPath, ".wordhub"), { recursive: true });
  await writeFile(path.join(record.folderPath, ".wordhub", "project.json"), JSON.stringify({ schemaVersion: 1, projectId: record.id, storage: "appData/WordHub/projects", linkedFolder: record.folderPath }, null, 2), "utf8");
  await new ControlledFileWriter(store, record.id, record.folderPath).recover();
  await saveRegistry();
  return { ...record, sessionId: session.id };
}

function normalizeFolderPath(folderPath: string): string {
  const normalized = path.resolve(folderPath).replace(/[\\/]+$/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

const echoTool = { name: "wordhub_echo", label: "文枢回声工具", description: "回传一个短句，用于验证思考模式下的多轮工具调用。", parameters: Type.Object({ text: Type.String({ minLength: 1, maxLength: 200 }) }), execute: async (_toolCallId: string, params: unknown) => { const text = (params as { text: string }).text; return { content: [{ type: "text" as const, text: `工具已执行：${text}` }], details: { roundTrip: true } }; } };

function projectFolder(request: Extract<WorkerRequest, { type: "run" }>, store: WordHubStore): string {
  const folder = request.projectPath ?? store.getProject(request.projectId!)?.folderPath;
  if (!folder) throw new Error("运行缺少已链接的项目文件夹");
  return folder;
}

function createAgentTools(request: Extract<WorkerRequest, { type: "run" }>, store: WordHubStore, definition: AgentDefinition, agentId: string) {
  const folder = projectFolder(request, store);
  const writer = new ControlledFileWriter(store, request.projectId!, folder, { allowBible: true });
  const author: Actor = { type: "agent", id: agentId, agentVersion: definition.version };
  const tools = createBuiltinTools({
    readDocument: async (relativePath) => {
      const target = await safeProjectTarget(folder, relativePath);
      const data = await readFile(target);
      return { text: data.toString("utf8"), contentHash: contentHash(data) };
    },
    readBible: async (relativePath) => {
      const normalized = relativePath.replaceAll("\\", "/").replace(/^\.wordhub\/bible\//u, "").replace(/^bible\//u, "");
      const target = await safeProjectTarget(folder, `.wordhub/bible/${normalized}`, true);
      const data = await readFile(target);
      return { text: data.toString("utf8"), contentHash: contentHash(data) };
    },
    writeDocument: async (input) => {
      const result = await writer.writeText({ relativePath: input.path, content: input.content, expectedHash: input.expectedHash as `sha256:${string}` | null | undefined, sessionId: request.sessionId, runId: request.runId, author });
      return { revisionId: result.revision.id, contentHash: result.contentHash };
    },
    proposeDocument: async (input) => {
      const result = await writer.propose({ relativePath: input.path, content: input.content, expectedHash: input.expectedHash as `sha256:${string}` | null | undefined, sessionId: request.sessionId, runId: request.runId, author });
      return { revisionId: result.id, contentHash: result.contentHash };
    },
    searchHistory: async (query) => store.searchEvents(request.projectId!, query).map((event) => ({ type: event.type, seq: event.seq, text: typeof event.payload.text === "string" ? event.payload.text : undefined })),
  });
  return tools.filter((tool) => definition.tools.includes(tool.name));
}

function appendRunEvent(store: WordHubStore, request: Extract<WorkerRequest, { type: "run" }>, type: string, actor: Actor, payload: Record<string, unknown>, idempotencyKey?: string): Event {
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
  if (!request.apiKey && !process.env.DEEPSEEK_API_KEY) throw new Error("DeepSeek密钥未配置");
  const store = await ensureRunContext(request);
  const runtime = await resolveAgent(request);
  const model = models.getModel(runtime.modelRef.provider, runtime.modelRef.id);
  if (!model) throw new Error(`model not found: ${runtime.modelRef.provider}/${runtime.modelRef.id}`);
  const agentId = runtime.definition?.name ?? request.agentId ?? "writer";
  store.startRun({ projectId: request.projectId!, sessionId: request.sessionId!, runId: request.runId, prompt: request.prompt, model: model.id });
  appendRunEvent(store, request, "chat.user_message", { type: "user", id: "user" }, { text: request.rawPrompt ?? request.prompt, mentions: request.mentions ?? [] }, `prompt:${request.runId}`);
  appendRunEvent(store, request, "run.started", { type: "agent", id: agentId, agentVersion: runtime.definition?.version }, { agentId, agentVersion: runtime.definition?.version, model: model.id, reasoning: runtime.modelRef.reasoning, mentions: request.mentions ?? [] });
  let text = "";
  let waitingApproval = false;
  let approvalWaiter: Promise<boolean> | undefined;
  let resolveApproval: ((approved: boolean) => void) | undefined;
  const systemPrompt = request.toolRoundTrip ? "你是文枢工具调用验证助手。必须先调用wordhub_echo两次，每次传入不同中文短句；收到两次工具结果后，只用一句中文总结。" : runtime.definition?.systemPrompt || "你是文枢P1后台写作助手。只用一句中文回答。";
  const guard = new PermissionGuard();
  const configuredTools = runtime.definition ? createAgentTools(request, store, runtime.definition, agentId) : [];
  const agent = new Agent({
    initialState: { model, thinkingLevel: runtime.modelRef.reasoning, systemPrompt, tools: [...configuredTools, ...(request.toolRoundTrip ? [echoTool] : [])] },
    getApiKey: () => request.apiKey ?? process.env.DEEPSEEK_API_KEY,
    streamFn: models.streamSimple.bind(models),
    toolExecution: "sequential",
    beforeToolCall: async ({ toolCall, args }) => {
      if (toolCall.name === "wordhub_echo" || !runtime.definition) return undefined;
      const relativePath = args && typeof args === "object" && "path" in args && typeof args.path === "string" ? args.path : undefined;
      try {
        guard.assert(runtime.definition, toolCall.name, relativePath);
      } catch (error) {
        const reason = error instanceof PermissionDeniedError ? error.message : `工具未获授权：${toolCall.name}`;
        appendRunEvent(store, request, "permission.denied", { type: "agent", id: agentId, agentVersion: runtime.definition.version }, { tool: toolCall.name, path: relativePath, reason });
        return { block: true, terminate: true, reason };
      }
      if (guard.requiresApproval(runtime.definition, toolCall.name)) {
        waitingApproval = true;
        approvalWaiter = new Promise<boolean>((resolve) => { resolveApproval = resolve; });
        pendingApprovals.set(request.runId, { agent, toolCallId: toolCall.id, toolName: toolCall.name, args, resolve: (approved) => resolveApproval?.(approved) });
        appendRunEvent(store, request, "approval.requested", { type: "agent", id: agentId, agentVersion: runtime.definition.version }, { tool: toolCall.name, path: relativePath, argsSummary: typeof args === "object" ? Object.keys(args as object) : [] });
        return { block: true, terminate: true, reason: "此写入需要用户确认，运行已暂停。" };
      }
      return undefined;
    },
  });
  active.set(request.runId, agent);
  agent.subscribe((event) => {
    if (event.type === "tool_execution_start") appendRunEvent(store, request, "run.tool_started", { type: "agent", id: agentId, agentVersion: runtime.definition?.version }, { tool: event.toolName, toolCallId: event.toolCallId });
    if (event.type === "tool_execution_end") appendRunEvent(store, request, "run.tool_finished", { type: "agent", id: agentId, agentVersion: runtime.definition?.version }, { tool: event.toolName, toolCallId: event.toolCallId, ok: !event.isError });
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "thinking_delta") post({ type: "run.reasoning_delta", runId: request.runId, delta: event.assistantMessageEvent.delta });
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") { text += event.assistantMessageEvent.delta; appendRunEvent(store, request, "run.text_delta", { type: "agent", id: agentId, agentVersion: runtime.definition?.version }, { delta: event.assistantMessageEvent.delta }); }
    if (event.type === "message_end" && event.message.role === "assistant" && event.message.usage) { const usage = event.message.usage; store.recordUsage({ runId: request.runId, model: model.id, inputTokens: usage.input, outputTokens: usage.output, costUsd: usage.cost.total, createdAt: timestamp() }); appendRunEvent(store, request, "run.usage", { type: "system", id: "usage" }, { inputTokens: usage.input, outputTokens: usage.output, reasoningTokens: usage.reasoning, costUsd: usage.cost.total }); post({ type: "run.usage", runId: request.runId, usage }); }
  });
  await agent.prompt((await buildRunContext(request, store)).messages);
  const context = runContexts.get(request.runId);
  if (!context || context.cancelled) { active.delete(request.runId); runContexts.delete(request.runId); return; }
  while (waitingApproval && approvalWaiter) {
    context.waitingApproval = true;
    store.finishRun(request.runId, "waiting_approval");
    appendRunEvent(store, request, "run.waiting_approval", { type: "agent", id: agentId, agentVersion: runtime.definition?.version }, { model: model.id });
    const pending = pendingApprovals.get(request.runId);
    const approved = await approvalWaiter;
    pendingApprovals.delete(request.runId);
    approvalWaiter = undefined;
    resolveApproval = undefined;
    if (context.cancelled) return;
    if (!approved || !pending) {
      store.finishRun(request.runId, "failed", "用户拒绝了写入");
      appendRunEvent(store, request, "approval.rejected", { type: "user", id: "user" }, { tool: pending?.toolName, reason: "用户拒绝" });
      appendRunEvent(store, request, "run.error", { type: "system", id: "approval" }, { error: "用户拒绝了写入" });
      context.finished = true;
      active.delete(request.runId);
      runContexts.delete(request.runId);
      return;
    }
    const tool = agent.state.tools.find((candidate) => candidate.name === pending.toolName);
    if (!tool) throw new Error(`待批准工具不存在：${pending.toolName}`);
    const result = await tool.execute(pending.toolCallId, pending.args as never, agent.signal);
    const replacement: ToolResultMessage = { role: "toolResult", toolCallId: pending.toolCallId, toolName: pending.toolName, content: result.content, details: result.details, isError: Boolean(result.isError), timestamp: Date.now() };
    const messages = agent.state.messages.slice();
    const blockedIndex = messages.findLastIndex((message) => message.role === "toolResult" && message.toolCallId === pending.toolCallId);
    if (blockedIndex >= 0) messages[blockedIndex] = replacement;
    else messages.push(replacement);
    agent.state.messages = messages;
    context.waitingApproval = false;
    store.resumeRun(request.runId);
    appendRunEvent(store, request, "approval.granted", { type: "user", id: "user" }, { tool: pending.toolName });
    appendRunEvent(store, request, "run.tool_finished", { type: "agent", id: agentId, agentVersion: runtime.definition?.version }, { tool: pending.toolName, toolCallId: pending.toolCallId, ok: !result.isError, approved: true });
    waitingApproval = false;
    await agent.continue();
  }
  active.delete(request.runId);
  store.finishRun(request.runId, "succeeded");
  appendRunEvent(store, request, "run.finished", { type: "agent", id: agentId, agentVersion: runtime.definition?.version }, { ok: true, model: model.id, reasoning: runtime.modelRef.reasoning, text });
  context.finished = true;
  runContexts.delete(request.runId);
}

async function runMock(request: Extract<WorkerRequest, { type: "run" }>): Promise<void> {
  const store = await ensureRunContext(request);
  store.startRun({ projectId: request.projectId!, sessionId: request.sessionId!, runId: request.runId, prompt: request.prompt, model: "mock" });
  appendRunEvent(store, request, "chat.user_message", { type: "user", id: "user" }, { text: request.rawPrompt ?? request.prompt, mentions: request.mentions ?? [] }, `prompt:${request.runId}`);
  appendRunEvent(store, request, "run.started", { type: "agent", id: request.agentId ?? "writer" }, { agentId: request.agentId ?? "writer", model: "mock", reasoning: request.reasoning ?? "off", mode: "mock", mentions: request.mentions ?? [] });
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
    if (request.type === "session.create") { sendResponse(request.requestId, { session: (await recoverProjectFiles(request.projectId)).createSession({ projectId: request.projectId, id: request.sessionId, title: request.title }) }); return; }
    if (request.type === "session.list") { sendResponse(request.requestId, { sessions: (await recoverProjectFiles(request.projectId)).listSessions(request.projectId) }); return; }
    if (request.type === "session.rename") { if (!request.projectId) throw new Error("重命名会话需要项目ID"); (await recoverProjectFiles(request.projectId)).renameSession(request.sessionId, request.title); sendResponse(request.requestId, { sessionId: request.sessionId }); return; }
    if (request.type === "chat.list") { const store = await recoverProjectFiles(request.projectId); const events = store.listEvents(request.projectId, request.sessionId); sendResponse(request.requestId, { events, items: projectChat(events) }); return; }
    if (request.type === "file.write") { const store = await recoverProjectFiles(request.projectId); const result = await new ControlledFileWriter(store, request.projectId, request.folderPath).writeText(request); sendResponse(request.requestId, result); return; }
    if (request.type === "file.undo") { const store = await recoverProjectFiles(request.projectId); const result = await new ControlledFileWriter(store, request.projectId, request.folderPath).undo(request); sendResponse(request.requestId, result); return; }
    if (request.type === "run.approve") {
      const pending = pendingApprovals.get(request.runId);
      if (!pending) throw new Error("该运行没有等待中的审批");
      pending.resolve(request.approved);
      sendResponse(request.requestId, { runId: request.runId, approved: request.approved });
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
  if (request.type === "abort") { const context = runContexts.get(request.runId); if (context && !context.finished) { context.cancelled = true; context.store.finishRun(request.runId, "cancelled"); appendRunEvent(context.store, context.request, "run.aborted", { type: "system", id: "worker" }, { ok: true }); context.finished = true; pendingApprovals.get(request.runId)?.resolve(false); pendingApprovals.delete(request.runId); runContexts.delete(request.runId); } active.get(request.runId)?.abort(); activeMocks.get(request.runId)?.abort(); activeMocks.delete(request.runId); return; }
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
