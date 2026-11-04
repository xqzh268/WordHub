import type { ChapterSummary, NovelFact } from "./facts.js";
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

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface CommandPayloads {
  "workspace.getSnapshot": undefined;
  "workspace.chooseFolder": undefined;
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
    format: "docx" | "txt-utf8" | "txt-gb18030";
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
  "graph.interviewSave": {
    projectId: string;
    node: string;
    chapter: string;
    mode: "character" | "author";
    turns: Array<{ role: "user" | "character"; text: string; basis?: string[] }>;
  };
  "project.prefs.get": { projectId: string };
  "project.prefs.set": { projectId: string; autoReviewOnFinalize?: boolean };
  "run.start": { prompt: string; rawPrompt?: string; agentId?: string; mentions?: string[]; projectPath?: string; projectId?: string; sessionId?: string; runId?: string };
  "run.estimate": { prompt: string; rawPrompt?: string; agentId?: string; projectPath?: string; workflow?: "write-chapter" | "write-chapter-full" | "review-only" | "finalize-chapter" | "all" };
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
  "app.setTheme": { preference: ThemePreference; resolved: ResolvedTheme };
}

export interface CommandResults {
  "workspace.getSnapshot": WorkspaceSnapshot;
  "workspace.chooseFolder": { path: string | null; projectId?: string; sessionId?: string };
  "project.listRecent": { projects: Array<{ id: string; name: string; folderPath: string; createdAt: string; updatedAt: string }> };
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
  "fact.list": { facts: NovelFact[]; summaries: ChapterSummary[]; finalized: string[] };
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
  "project.prefs.get": { autoReviewOnFinalize: boolean };
  "project.prefs.set": { autoReviewOnFinalize: boolean };
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
