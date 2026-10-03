import type { Usage } from "@earendil-works/pi-ai";

export type RuntimeRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "waiting_approval";
export type RuntimeRun = {
  id: string;
  agentId: string;
  model: string;
  reasoning: string;
  status: RuntimeRunStatus;
  startedAt: string;
  endedAt?: string;
  usage?: Usage;
  error?: string;
};

export class RunService {
  private readonly runs = new Map<string, RuntimeRun>();
  start(input: Omit<RuntimeRun, "status" | "startedAt">): RuntimeRun {
    const run = {
      ...input,
      status: "running" as const,
      startedAt: new Date().toISOString(),
    };
    this.runs.set(run.id, run);
    return run;
  }
  finish(
    id: string,
    status: Exclude<RuntimeRunStatus, "running">,
    error?: string,
    usage?: Usage,
  ): RuntimeRun | undefined {
    const run = this.runs.get(id);
    if (!run) return undefined;
    Object.assign(run, {
      status,
      endedAt: new Date().toISOString(),
      error,
      usage,
    });
    return run;
  }
  interruptRunning(): RuntimeRun[] {
    const interrupted: RuntimeRun[] = [];
    for (const run of this.runs.values())
      if (run.status === "running") {
        run.status = "interrupted";
        run.endedAt = new Date().toISOString();
        interrupted.push(run);
      }
    return interrupted;
  }
  get(id: string): RuntimeRun | undefined {
    return this.runs.get(id);
  }
}
