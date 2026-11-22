import type { AliasLink } from "./aliases.js";
import type { ChapterSummary, NovelFact } from "./facts.js";
import type { KnowledgeEntry } from "./knowledge.js";
import type { ProjectKind } from "./projects.js";
import type { NovelExportFormat, NovelWorkflowId } from "@wordhub/novel";
export type WorkspaceCommand =
  | "workspace.getSnapshot"
  | "workspace.chooseFolder"
  | "project.listRecent"
  | "session.list"
  | "session.create"
  | "session.rename"
  | "chat.list"
  | "chapter.list"
  | "chapter.read"
  | "chapter.write"
  | "chapter.undo"
  | "chapter.revisions"
  | "export.fonts"
  | "agent.catalog"
  | "agent.get"
  | "agent.save"
  | "agent.delete"
  | "export.run"
  | "reference.list"
  | "reference.import"
  | "reference.read"
  | "reference.search"
  | "reference.delete"
  | "reference.styleSamples"
  | "reference.addStyleSample"
  | "reference.removeStyleSample"
  | "reference.update"
  | "reference.collectionCreate"
  | "reference.collectionRename"
  | "reference.collectionDelete"
  | "reference.opened"
  | "reference.annotations"
  | "reference.annotationAdd"
  | "reference.annotationUpdate"
  | "reference.annotationDelete"
  | "reference.cover"
  | "chapter.watch"
  | "fact.list"
  | "fact.decide"
  | "graph.interview"
  | "graph.interviewSave"
  | "graph.aliasLink"
  | "graph.aliasUnlink"
  | "graph.knowledgeSet"
  | "graph.knowledgeClear"
  | "graph.simulateEstimate"
  | "graph.simulateStep"
  | "graph.simulateReport"
  | "graph.simulateSave"
  | "project.prefs.get"
  | "project.prefs.set"
  | "run.start"
  | "run.estimate"
  | "run.abort"
  | "run.resume"
  | "run.approve"
  | "challenge.decide"
  | "intake.answer"
  | "intake.confirm"
  | "run.restartWorker"
  | "settings.credentialStatus"
  | "settings.setCredential"
  | "settings.deleteCredential"
  | "settings.providers"
  | "settings.addProvider"
  | "settings.removeProvider"
  | "settings.models"
  | "settings.setAgentModel"
  | "settings.testConnection"
  | "settings.setProviderEnabled"
  | "settings.fetchModels"
  | "latex.engineStatus"
  | "latex.installEngine"
  | "latex.cancelInstall"
  | "latex.clearCache"
  | "latex.files"
  | "latex.readFile"
  | "latex.writeFile"
  | "latex.setMainFile"
  | "latex.trustStatus"
  | "latex.setTrust"
  | "latex.compile"
  | "latex.abort"
  | "app.setTheme";

export interface SimulationBasePayload {
  projectId: string;
  /** 起点章节的相对路径 */
  chapter: string;
  premise?: string;
  participants: string[];
}
export interface SimulationEntryPayload {
  round: number;
  name: string;
  action: string;
  intent?: string;
}

/** 自建 Agent 表单（与 runtime 的 AgentFormInput 同形） */
export interface AgentFormPayload {
  name: string;
  displayName: string;
  description: string;
  prompt: string;
  model: { provider: string; id: string; reasoning: string };
  tools: string[];
  write: "none" | "propose" | "write";
  writeScopes: string[];
  readScopes: string[];
  confirmBeforeWrite: boolean;
  maxTurns: number;
  avatar?: { glyph?: string; color?: string };
}

export type AnnotationColor = "yellow" | "green" | "blue" | "pink";
export type ReferenceKindPayload = "novel" | "paper" | "report" | "material" | "other";
export type ReadingStatusPayload = "unread" | "reading" | "finished";

export interface CollectionPayload {
  id: string;
  name: string;
  createdAt: string;
}

export interface AnnotationPayload {
  id: string;
  chapterId: string;
  start: number;
  end: number;
  quote: string;
  color: AnnotationColor;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** null 表示清除该字段，不出现表示不改 */
export interface ReferencePatchPayload {
  title?: string;
  author?: string | null;
  kind?: ReferenceKindPayload;
  year?: number | null;
  publisher?: string | null;
  doi?: string | null;
  isbn?: string | null;
  note?: string | null;
  tags?: string[];
  favorite?: boolean;
  status?: ReadingStatusPayload;
  collectionIds?: string[];
}

export interface ReferenceMetaPayload {
  kind: ReferenceKindPayload;
  year?: number;
  publisher?: string;
  doi?: string;
  isbn?: string;
  note?: string;
  tags: string[];
  favorite: boolean;
  status: ReadingStatusPayload;
  collectionIds: string[];
  lastOpenedAt?: string;
  progress?: { chapterId: string };
  hasCover: boolean;
  id: string;
  title: string;
  author?: string;
  format: "txt" | "md" | "epub" | "docx" | "pdf";
  originalName: string;
  importedAt: string;
  totalChars: number;
  chapters: Array<{ id: string; index: number; title: string; chars: number }>;
}

export interface ReferenceHitPayload {
  referenceId: string;
  referenceTitle: string;
  chapterId: string;
  chapterTitle: string;
  offset: number;
  snippet: string;
}

export interface WorkspaceSnapshot {
  projectId?: string;
  projectKind?: ProjectKind;
  projectName: string;
  linkedFolder: string | null;
  activeSessionId?: string;
  worker: "offline" | "starting" | "ready" | "busy" | "stopped" | "crashed";
}

export interface ChapterInfo {
  /** 相对项目根目录，统一用 `/` */
  path: string;
  name: string;
  number?: number;
  size: number;
  mtimeMs: number;
}
export interface ChapterContent {
  path: string;
  content: string;
  contentHash: string;
  mtimeMs: number;
}

/** LaTeX 项目中可在工作台打开的文件。path 始终是相对项目根的 `/` 路径。 */
export interface LatexFileInfo {
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
}

export interface LatexFilesPayload {
  files: LatexFileInfo[];
  /** 当前主文件。旧项目没有 latex.json 时默认为 main.tex。 */
  mainFile: string;
}

export interface LatexFileContentPayload {
  path: string;
  content: string;
  contentHash: string;
  mtimeMs: number;
}

export type LatexWriteFilePayload =
  | { status: "saved"; file: LatexFileContentPayload }
  | { status: "conflict" };

export interface LatexMainFilePayload {
  mainFile: string;
}

export interface LatexEngineStatusPayload {
  state: "missing" | "ready" | "corrupt";
  version: string;
  cacheDir: string;
  cacheBytes: number;
  /** 后台正在安装引擎。 */
  installing: boolean;
}

/** 安装进度事件：经 run.event 推送，payload.type 为 latex.installProgress。 */
export interface LatexInstallProgress {
  type: "latex.installProgress";
  receivedBytes: number;
  totalBytes: number;
}

export interface LatexTrustPayload {
  trusted: boolean;
  /** created：在 WordHub 内新建的空文件夹；user：用户手动确认；untrusted：尚未信任。 */
  reason: "created" | "user" | "untrusted";
  updatedAt?: string;
}

export type LatexCompileStatusPayload =
  | "succeeded"
  | "failed"
  | "timeout"
  | "aborted"
  | "missing-tool"
  | "offline-cache-miss"
  | "untrusted";

export interface LatexDiagnosticLocationPayload {
  /** 规范化的项目内源码相对路径，使用 `/` 分隔。 */
  relativePath: string;
  /** 源码行号，从 1 开始。 */
  line: number;
}

export interface LatexDiagnosticPayload {
  severity: "error" | "warning";
  message: string;
  /** 仅可在工作台中打开的源码才有定位。 */
  location?: LatexDiagnosticLocationPayload;
}

export interface LatexCompileResultPayload {
  status: LatexCompileStatusPayload;
  /** 给用户看的补充说明（例如未信任、引擎未安装）。 */
  message?: string;
  pdfPath?: string;
  logPath?: string;
  synctexPath?: string;
  missingTool?: string;
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
  /** 编译输出尾部，仅给用户界面显示，不得转交 Agent。 */
  log: string;
  /** 从本次编译输出提取的问题，仅供用户界面显示。 */
  diagnostics: LatexDiagnosticPayload[];
  /** 编译读取了项目外的绝对路径。 */
  readOutsideProject: boolean;
  /** 仅路径，绝不含内容。 */
  outsidePaths: string[];
}

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface CommandPayloads {
  "workspace.getSnapshot": undefined;
  "workspace.chooseFolder": { kind?: ProjectKind } | undefined;
  "project.listRecent": undefined;
  "session.list": { projectId: string };
  "session.create": { projectId: string; title: string; sessionId?: string };
  "session.rename": { projectId?: string; sessionId: string; title: string };
  "chat.list": { projectId: string; sessionId: string };
  "chapter.list": { projectId: string };
  "chapter.read": { projectId: string; path: string };
  "chapter.write": { projectId: string; path: string; content: string; expectedHash?: string | null; sessionId?: string };
  "chapter.undo": { projectId: string; path: string; sessionId?: string };
  "chapter.revisions": { projectId: string; path: string };
  "export.fonts": undefined;
  "agent.catalog": undefined;
  "agent.get": { name: string };
  "agent.save": { mode: "create" | "update"; agent: AgentFormPayload };
  "agent.delete": { name: string };
  "reference.list": undefined;
  "reference.import": undefined;
  "reference.read": { referenceId: string; chapterId: string };
  "reference.search": { query: string; referenceId?: string };
  "reference.delete": { referenceId: string };
  "reference.styleSamples": undefined;
  "reference.addStyleSample": { referenceId: string; chapterId: string; start: number; end: number };
  "reference.removeStyleSample": { index: number };
  "reference.update": { referenceId: string; patch: ReferencePatchPayload };
  "reference.collectionCreate": { name: string };
  "reference.collectionRename": { id: string; name: string };
  "reference.collectionDelete": { id: string };
  "reference.opened": { referenceId: string; chapterId: string };
  "reference.annotations": { referenceId: string };
  "reference.annotationAdd": { referenceId: string; chapterId: string; start: number; end: number; color?: AnnotationColor; note?: string };
  "reference.annotationUpdate": { referenceId: string; annotationId: string; note?: string | null; color?: AnnotationColor };
  "reference.annotationDelete": { referenceId: string; annotationId: string };
  "reference.cover": { referenceId: string };
  "export.run": {
    scope: "chapter" | "book";
    chapterPath?: string;
    format: NovelExportFormat;
    fonts?: { body?: string; heading?: string; latin?: string };
    bodySizePt?: number;
    lineSpacing?: number;
  };
  "chapter.watch": { projectId: string };
  "fact.list": { projectId: string };
  "fact.decide": { projectId: string; factId: string; decision: "confirm" | "reject" };
  "graph.interview": {
    projectId: string;
    node: string;
    chapter: string;
    mode: "character" | "author";
    question: string;
    history: Array<{ role: "user" | "character"; text: string }>;
  };
  "graph.simulateEstimate": SimulationBasePayload & { rounds: number };
  "graph.simulateStep": SimulationBasePayload & {
    node: string;
    round: number;
    rounds: number;
    log: SimulationEntryPayload[];
  };
  "graph.simulateReport": SimulationBasePayload & {
    log: SimulationEntryPayload[];
  };
  "graph.simulateSave": SimulationBasePayload & {
    rounds: number;
    log: SimulationEntryPayload[];
    report: string;
  };
  "graph.aliasLink": {
    projectId: string;
    alias: string;
    canonical: string;
    chapter?: string;
  };
  "graph.aliasUnlink": { projectId: string; aliasId: string };
  "graph.knowledgeSet": {
    projectId: string;
    factId: string;
    character: string;
    mode: "knows" | "unaware";
    chapter?: string;
  };
  "graph.knowledgeClear": {
    projectId: string;
    factId: string;
    character: string;
  };
  "graph.interviewSave": {
    projectId: string;
    node: string;
    chapter: string;
    mode: "character" | "author";
    turns: Array<{ role: "user" | "character"; text: string; basis?: string[] }>;
  };
  "project.prefs.get": { projectId: string };
  "project.prefs.set": { projectId: string; autoReviewOnFinalize?: boolean; runBudgetUsd?: number | null };
  "run.start": { prompt: string; rawPrompt?: string; agentId?: string; mentions?: string[]; projectPath?: string; projectId?: string; sessionId?: string; runId?: string };
  "run.estimate": { prompt: string; rawPrompt?: string; agentId?: string; projectPath?: string; workflow?: NovelWorkflowId };
  "run.abort": { runId: string };
  "run.resume": { runId: string };
  "run.approve": { runId: string; approved: boolean };
  "challenge.decide": { workflowId: string; threadId: string; decision: "accept" | "keep" };
  "intake.answer": { projectId: string; sessionId: string; intakeId: string; questionId: string; value: string };
  "intake.confirm": { projectId: string; sessionId: string; intakeId: string };
  "run.restartWorker": undefined;
  "settings.credentialStatus": undefined;
  "settings.setCredential": { provider: string; secret: string };
  "settings.deleteCredential": { provider: string };
  "settings.providers": undefined;
  "settings.addProvider": {
    preset?: string;
    custom?: {
      id: string;
      label: string;
      baseUrl: string;
      api: "openai-completions" | "openai-responses" | "anthropic-messages";
      models: Array<{
        id: string;
        label?: string;
        contextWindow?: number;
        maxOutputTokens?: number;
        reasoning?: boolean;
        reasoningLevels?: Array<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max">;
        inputUsdPerMillion?: number;
        outputUsdPerMillion?: number;
        cacheReadUsdPerMillion?: number;
      }>;
    };
    /** 编辑已有的自定义服务商时为真。 */
    replace?: boolean;
  };
  "settings.removeProvider": { id: string };
  "settings.models": undefined;
  "settings.setAgentModel": { projectId?: string; agentId: string; model: { provider: string; id: string; reasoning: string } };
  "settings.testConnection": { provider: string; model?: string };
  "settings.setProviderEnabled": { id: string; enabled: boolean };
  "settings.fetchModels": { baseUrl: string; api: "openai-completions" | "openai-responses" | "anthropic-messages"; provider?: string; apiKey?: string };
  "latex.engineStatus": undefined;
  "latex.installEngine": undefined;
  "latex.cancelInstall": undefined;
  "latex.clearCache": undefined;
  "latex.files": { projectId: string };
  "latex.readFile": { projectId: string; path: string };
  "latex.writeFile": { projectId: string; path: string; content: string; expectedHash: string };
  "latex.setMainFile": { projectId: string; mainFile: string };
  "latex.trustStatus": { projectId: string };
  "latex.setTrust": { projectId: string; trusted: boolean };
  "latex.compile": { projectId: string; mainFile: string };
  "latex.abort": { projectId: string };
  "app.setTheme": { preference: ThemePreference; resolved: ResolvedTheme };
}

export interface CommandResults {
  "workspace.getSnapshot": WorkspaceSnapshot;
  "workspace.chooseFolder": { path: string | null; projectId?: string; sessionId?: string; kind?: ProjectKind };
  "project.listRecent": { projects: Array<{ id: string; name: string; folderPath: string; kind: ProjectKind; createdAt: string; updatedAt: string }> };
  "session.list": { sessions: Array<{ id: string; projectId: string; title: string; createdAt: string; updatedAt: string }> };
  "session.create": { session: { id: string; projectId: string; title: string; createdAt: string; updatedAt: string } };
  "session.rename": { sessionId: string };
  "chat.list": { events: unknown[]; items: unknown[] };
  "chapter.list": { chapters: ChapterInfo[] };
  "chapter.read": ChapterContent;
  "chapter.write": { relativePath: string; contentHash: string; revision: { id: string; revisionNo: number; author: { type: string; id: string }; createdAt: string } };
  "chapter.undo": { relativePath: string; contentHash: string; revision: { id: string; revisionNo: number; author: { type: string; id: string }; createdAt: string } };
  "export.fonts": { presets: string[]; installed: string[] };
  "agent.catalog": { tools: string[]; writeScopes: string[]; readScopes: string[] };
  "agent.get": AgentFormPayload;
  "agent.save": { name: string };
  "agent.delete": { deleted: boolean };
  "reference.list": { references: ReferenceMetaPayload[]; collections: CollectionPayload[]; similarGroups: string[][] };
  "reference.import": {
    canceled: boolean;
    imported: Array<{ id: string; title: string; duplicate: boolean; similar: Array<{ id: string; title: string }> }>;
    failed: Array<{ name: string; error: string }>;
  };
  "reference.read": { referenceId: string; referenceTitle: string; chapterId: string; chapterTitle: string; totalChars: number; start: number; end: number; text: string };
  "reference.search": { hits: ReferenceHitPayload[] };
  "reference.delete": { deleted: boolean };
  "reference.styleSamples": { samples: Array<{ source: string; anchor?: string; text: string }>; limits: { count: number; minChars: number; maxChars: number } };
  "reference.addStyleSample": { count: number };
  "reference.removeStyleSample": { count: number };
  "reference.update": ReferenceMetaPayload;
  "reference.collectionCreate": CollectionPayload;
  "reference.collectionRename": CollectionPayload;
  "reference.collectionDelete": { deleted: boolean };
  "reference.opened": { ok: boolean };
  "reference.annotations": { annotations: AnnotationPayload[] };
  "reference.annotationAdd": AnnotationPayload;
  "reference.annotationUpdate": AnnotationPayload;
  "reference.annotationDelete": { deleted: boolean };
  "reference.cover": { dataUrl: string | null };
  "export.run": { canceled: boolean; path?: string; bytes?: number; chapters?: number };
  "chapter.revisions": { revisions: Array<{ id: string; revisionNo: number; status: string; contentHash: string; author: { type: string; id: string }; createdAt: string }> };
  "chapter.watch": { watching: boolean };
  "fact.list": {
    facts: NovelFact[];
    summaries: ChapterSummary[];
    finalized: string[];
    aliases: AliasLink[];
    knowledge: KnowledgeEntry[];
  };
  "fact.decide": { factId: string; status: "confirmed" | "rejected" };
  "graph.interview": {
    answer: string;
    basis: Array<{
      ref: string;
      factId: string;
      chapter: string;
      kind: NovelFact["kind"];
      statement: string;
      quote: string;
    }>;
    warnings: string[];
    usage: { input: number; output: number; total: number; cost?: number };
    model: string;
  };
  "graph.interviewSave": { path: string };
  "graph.aliasLink": { aliasId: string };
  "graph.aliasUnlink": { aliasId: string };
  "graph.knowledgeSet": { factId: string };
  "graph.knowledgeClear": { factId: string };
  "graph.simulateEstimate": {
    calls: number;
    inputTokens: number;
    outputTokens: number;
  };
  "graph.simulateStep": {
    action: string;
    intent?: string;
    warnings: string[];
    usage: { input: number; output: number; total: number; cost?: number };
    model: string;
  };
  "graph.simulateReport": {
    report: string;
    usage: { input: number; output: number; total: number; cost?: number };
    model: string;
  };
  "graph.simulateSave": { path: string };
  "project.prefs.get": { autoReviewOnFinalize: boolean; runBudgetUsd: number | null };
  "project.prefs.set": { autoReviewOnFinalize: boolean; runBudgetUsd: number | null };
  "run.start": { runId: string; projectId?: string; sessionId?: string };
  "run.estimate": { inputTokens: number; outputTokens: number; costUsd: number; unpricedModels?: string[]; tasks: unknown[]; workflow?: string; label?: string };
  "run.abort": { runId: string; aborted: boolean };
  "run.resume": { runId: string; resumed: boolean };
  "run.approve": { runId: string; approved: boolean };
  "challenge.decide": { workflowId: string; threadId: string; decision: "accept" | "keep" };
  "intake.answer": { intakeId: string; questionId: string };
  "intake.confirm": { intakeId: string; confirmed: boolean };
  "run.restartWorker": { worker: WorkspaceSnapshot["worker"] };
  "settings.credentialStatus": { encryptionAvailable: boolean; saved: string[] };
  "settings.setCredential": { saved: boolean };
  "settings.deleteCredential": { deleted: boolean };
  "settings.providers": {
    presets: Array<{ id: string; label: string; baseUrl?: string; modelCount: number; added: boolean }>;
    providers: Array<{
      id: string;
      label: string;
      kind: "builtin" | "openai-compatible" | "custom";
      enabled: boolean;
      baseUrl?: string;
      api?: string;
      modelCount: number;
      removable: boolean;
      userDefined: boolean;
      /** 仅自定义服务商：完整模型清单（含价格与来源），供编辑。 */
      models?: Array<{
        id: string;
        label: string;
        contextWindow: number;
        maxOutputTokens?: number;
        supportedReasoning?: string[];
        supportsReasoning: boolean;
        pricing: { inputUsdPerMillion: number; outputUsdPerMillion: number; cacheReadUsdPerMillion: number };
        pricingSource?: "user" | "catalog" | "unknown";
      }>;
      auth: { configured: boolean; source?: string };
    }>;
  };
  "settings.addProvider": { saved: boolean };
  "settings.removeProvider": { saved: boolean };
  "settings.models": { agents: Array<{ id: string; displayName: string; description?: string; avatar?: { glyph?: string; color?: string }; model: { provider: string; id: string; reasoning: string }; source: string }>; providers: Array<{ id: string; label: string; models: Array<{ id: string; label: string; supportedReasoning?: string[] }> }>; errors?: string[] };
  "settings.setAgentModel": { saved: boolean };
  "settings.testConnection": { ok: boolean; message: string };
  "settings.setProviderEnabled": { saved: boolean };
  "settings.fetchModels": {
    models: Array<{
      id: string;
      label: string;
      contextWindow?: number;
      maxOutputTokens?: number;
      reasoning: boolean;
      supportedReasoning?: string[];
      inputUsdPerMillion?: number;
      outputUsdPerMillion?: number;
      cacheReadUsdPerMillion?: number;
      source: "remote" | "catalog" | "unknown";
    }>;
  };
  "latex.engineStatus": LatexEngineStatusPayload;
  "latex.installEngine": { canceled: boolean; status: LatexEngineStatusPayload };
  "latex.cancelInstall": { canceled: boolean };
  "latex.clearCache": LatexEngineStatusPayload;
  "latex.files": LatexFilesPayload;
  "latex.readFile": LatexFileContentPayload;
  "latex.writeFile": LatexWriteFilePayload;
  "latex.setMainFile": LatexMainFilePayload;
  "latex.trustStatus": LatexTrustPayload;
  "latex.setTrust": LatexTrustPayload;
  "latex.compile": LatexCompileResultPayload;
  "latex.abort": { aborted: boolean };
  "app.setTheme": { applied: boolean };
}

export interface AppEvent {
  type: "worker.state" | "run.event" | "workspace.snapshot";
  payload: unknown;
}

export type InvokeRequest<C extends WorkspaceCommand> = {
  command: C;
  payload: CommandPayloads[C];
};

export type InvokeResponse<C extends WorkspaceCommand> = CommandResults[C];
