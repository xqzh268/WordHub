export type WorkspaceCommand =
  | "workspace.getSnapshot"
  | "workspace.chooseFolder"
  | "run.start"
  | "run.abort"
  | "run.restartWorker"
  | "app.setTheme";

export interface WorkspaceSnapshot {
  projectName: string;
  linkedFolder: string | null;
  worker: "offline" | "starting" | "ready" | "busy" | "stopped" | "crashed";
}

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface CommandPayloads {
  "workspace.getSnapshot": undefined;
  "workspace.chooseFolder": undefined;
  "run.start": { prompt: string; projectPath?: string; runId?: string };
  "run.abort": { runId: string };
  "run.restartWorker": undefined;
  "app.setTheme": { preference: ThemePreference; resolved: ResolvedTheme };
}

export interface CommandResults {
  "workspace.getSnapshot": WorkspaceSnapshot;
  "workspace.chooseFolder": { path: string | null };
  "run.start": { runId: string };
  "run.abort": { runId: string; aborted: boolean };
  "run.restartWorker": { worker: WorkspaceSnapshot["worker"] };
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
