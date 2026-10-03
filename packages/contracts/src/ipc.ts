export type WorkspaceCommand =
  | "workspace.getSnapshot"
  | "workspace.chooseFolder"
  | "project.listRecent"
  | "session.list"
  | "session.create"
  | "session.rename"
  | "chat.list"
  | "run.start"
  | "run.abort"
  | "run.approve"
  | "run.restartWorker"
  | "settings.credentialStatus"
  | "settings.setCredential"
  | "app.setTheme";

export interface WorkspaceSnapshot {
  projectId?: string;
  projectName: string;
  linkedFolder: string | null;
  activeSessionId?: string;
  worker: "offline" | "starting" | "ready" | "busy" | "stopped" | "crashed";
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
  "run.start": { prompt: string; rawPrompt?: string; agentId?: string; mentions?: string[]; projectPath?: string; projectId?: string; sessionId?: string; runId?: string };
  "run.abort": { runId: string };
  "run.approve": { runId: string; approved: boolean };
  "run.restartWorker": undefined;
  "settings.credentialStatus": undefined;
  "settings.setCredential": { provider: string; secret: string };
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
  "run.start": { runId: string; projectId?: string; sessionId?: string };
  "run.abort": { runId: string; aborted: boolean };
  "run.approve": { runId: string; approved: boolean };
  "run.restartWorker": { worker: WorkspaceSnapshot["worker"] };
  "settings.credentialStatus": { provider: string; configured: boolean; encryptionAvailable: boolean };
  "settings.setCredential": { saved: boolean };
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
