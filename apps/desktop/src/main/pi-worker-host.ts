import { utilityProcess, type UtilityProcess } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppEvent, WorkspaceSnapshot } from "@wordhub/contracts";
import { randomUUID } from "node:crypto";

type WorkerMessage = {
  type: string;
  [key: string]: unknown;
};

export type WorkerRunRequest = {
  runId: string;
  prompt: string;
  rawPrompt?: string;
  agentId?: string;
  mentions?: string[];
  apiKey?: string;
  model?: string;
  reasoning?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  mode?: "live" | "mock";
  toolRoundTrip?: boolean;
  projectPath?: string;
  projectId?: string;
  sessionId?: string;
};

export class PiWorkerHost {
  private child: UtilityProcess | null = null;
  private state: WorkspaceSnapshot["worker"] = "offline";
  private crashing = false;
  private storageRoot: string | undefined;
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();
  private readonly listeners = new Set<(event: AppEvent) => void>();

  constructor(private readonly emit: (event: AppEvent) => void) {}

  setStorageRoot(storageRoot: string): void {
    this.storageRoot = storageRoot;
  }

  get status(): WorkspaceSnapshot["worker"] {
    return this.state;
  }

  subscribe(listener: (event: AppEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.child) return;
    this.crashing = false;
    this.setState("starting");
    const workerPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "worker.js",
    );
    const child = utilityProcess.fork(workerPath, [], {
      cwd: process.env.WORDHUB_WORKSPACE_ROOT ?? process.cwd(),
      env: {
        ...process.env,
        ...(this.storageRoot ? { WORDHUB_STORAGE_ROOT: this.storageRoot } : {}),
      },
    });
    this.child = child;
    child.on("spawn", () => {
      console.error(`[wordhub-worker] spawned ${workerPath}`);
      const event: AppEvent = {
        type: "worker.state",
        payload: { state: "spawned", workerPath },
      };
      this.emit(event);
      for (const listener of this.listeners) listener(event);
    });
    child.on("error", (error) => {
      const errorMessage = String(error);
      console.error(`[wordhub-worker] error ${errorMessage}`);
      const event: AppEvent = {
        type: "worker.state",
        payload: { state: "error", error: errorMessage },
      };
      this.emit(event);
      for (const listener of this.listeners) listener(event);
    });
    child.stderr?.on("data", (chunk) =>
      console.error(`[wordhub-worker:stderr] ${String(chunk)}`),
    );
    child.on("message", (message: WorkerMessage) => {
      if (
        message.type === "response" &&
        typeof message.requestId === "string"
      ) {
        const pending = this.pending.get(message.requestId);
        if (pending) {
          this.pending.delete(message.requestId);
          if (message.ok === false)
            pending.reject(new Error(String(message.error ?? "后台请求失败")));
          else pending.resolve(message.result);
        }
        return;
      }
      if (message.type === "ready") this.setState("ready");
      if (message.type === "run.started") this.setState("busy");
      if (
        message.type === "run.finished" ||
        message.type === "run.aborted" ||
        message.type === "error"
      )
        this.setState("ready");
      const event: AppEvent = { type: "run.event", payload: message };
      this.emit(event);
      for (const listener of this.listeners) listener(event);
    });
    child.on("exit", (code) => {
      console.error(`[wordhub-worker] exit ${code}`);
      this.child = null;
      this.setState(this.crashing || code !== 0 ? "crashed" : "stopped");
      this.crashing = false;
      for (const pending of this.pending.values())
        pending.reject(new Error("后台进程已退出"));
      this.pending.clear();
    });
  }

  stop(): void {
    this.crashing = false;
    this.child?.kill();
    this.child = null;
    this.setState("stopped");
  }

  crash(): void {
    this.crashing = true;
    this.child?.kill();
  }

  restart(): void {
    this.stop();
    this.start();
  }

  run(request: WorkerRunRequest): void {
    this.start();
    this.child?.postMessage({ type: "run", ...request });
  }

  abort(runId: string): void {
    this.child?.postMessage({ type: "abort", runId });
  }

  request<T = unknown>(message: Record<string, unknown>): Promise<T> {
    this.start();
    const requestId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.child?.postMessage({ ...message, requestId });
    });
  }

  private setState(state: WorkspaceSnapshot["worker"]): void {
    this.state = state;
    const event: AppEvent = { type: "worker.state", payload: { state } };
    this.emit(event);
    for (const listener of this.listeners) listener(event);
  }
}
