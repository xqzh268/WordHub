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
  | "chapter.watch"
  | "fact.list"
  | "fact.decide"
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
  "chapter.watch": { projectId: string };
  "fact.list": { projectId: string };
  "fact.decide": { projectId: string; factId: string; decision: "confirm" | "reject" };
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
  "chapter.watch": { watching: boolean };
  "fact.list": { facts: NovelFact[]; summaries: ChapterSummary[]; finalized: string[] };
  "fact.decide": { factId: string; status: "confirmed" | "rejected" };
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
  "settings.models": { agents: Array<{ id: string; displayName: string; model: { provider: string; id: string; reasoning: string }; source: string }>; providers: Array<{ id: string; label: string; models: Array<{ id: string; label: string; supportedReasoning?: string[] }> }> };
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
