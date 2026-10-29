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

  private credentialSource?: () => Promise<Record<string, string>>;
  private syncedCredentials = "";
  private sendChain: Promise<void> = Promise.resolve();

  constructor(private readonly emit: (event: AppEvent) => void) {}

  /** 设置密钥来源；每次发消息前若密钥有变化，会先同步给后台进程。 */
  setCredentialSource(source: () => Promise<Record<string, string>>): void {
    this.credentialSource = source;
  }

  /** 按调用顺序串行发送，保证密钥同步总在依赖它的消息之前。 */
  private send(message: Record<string, unknown>): void {
    this.sendChain = this.sendChain.then(async () => {
      try {
        const keys = await this.credentialSource?.().catch(() => undefined);
        if (keys) {
          const serialized = JSON.stringify(keys);
          if (serialized !== this.syncedCredentials) {
            this.child?.postMessage({ type: "credentials.sync", keys });
            this.syncedCredentials = serialized;
          }
        }
        this.child?.postMessage(message);
      } catch (error) {
        // 单条消息发送失败不能卡住后面的队列；有等待响应的请求要让调用方知道。
        console.error("[wordhub-worker] 发送失败", error);
        const requestId = message.requestId;
        if (typeof requestId === "string") {
          const pending = this.pending.get(requestId);
          this.pending.delete(requestId);
          pending?.reject(error);
        }
      }
    });
  }

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
    this.syncedCredentials = "";
    this.setState("starting");
    const workerPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "worker.js",
    );
    const child = utilityProcess.fork(workerPath, [], {
      cwd: process.env.WORDHUB_WORKSPACE_ROOT ?? process.cwd(),
      env: {
        ...process.env,
        ...(process.env.DEEPSEEK_API_KEY || process.env.WORDHUB_DEEPSEEK_API_KEY
          ? {
              DEEPSEEK_API_KEY:
                process.env.DEEPSEEK_API_KEY ??
                process.env.WORDHUB_DEEPSEEK_API_KEY,
            }
          : {}),
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
    this.send({ type: "run", ...request });
  }

  abort(runId: string): void {
    this.send({ type: "abort", runId });
  }

  request<T = unknown>(message: Record<string, unknown>): Promise<T> {
    this.start();
    const requestId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.send({ ...message, requestId });
    });
  }

  private setState(state: WorkspaceSnapshot["worker"]): void {
    this.state = state;
    const event: AppEvent = { type: "worker.state", payload: { state } };
    this.emit(event);
    for (const listener of this.listeners) listener(event);
  }
}
