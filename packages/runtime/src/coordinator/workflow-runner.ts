import {
  decideNext,
  markTaskResult,
  type SchedulerState,
  type TaskNode,
} from "./graph.js";
import type { WorkflowDefinition } from "./workflow.js";

export type WorkflowEvent = {
  type:
    | "task.ready"
    | "task.started"
    | "task.succeeded"
    | "task.failed"
    | "task.blocked";
  taskId: string;
};

/** 将声明式工作流变成可重放的任务状态机；事件由调用方持久化。 */
export class WorkflowRun {
  private tasks: TaskNode[];
  private readonly events: WorkflowEvent[] = [];
  private readonly concurrency: number;
  constructor(
    readonly definition: WorkflowDefinition,
    concurrency = 2,
  ) {
    this.concurrency = concurrency;
    this.tasks = definition.nodes.map((node) => ({
      id: node.id,
      dependencies: [...node.dependencies],
      assignedAgent: node.agent,
      maxAttempts: node.maxAttempts ?? 1,
      attempt: node.attempt ?? 0,
      status: node.status,
    }));
  }
  state(): readonly TaskNode[] {
    return this.tasks.map((task) => ({
      ...task,
      dependencies: [...task.dependencies],
    }));
  }
  eventsSinceStart(): readonly WorkflowEvent[] {
    return [...this.events];
  }
  next(): TaskNode[] {
    const decision = decideNext({
      tasks: this.tasks,
      running: this.tasks
        .filter((task) => task.status === "running")
        .map((task) => task.id),
      concurrency: this.concurrency,
    } satisfies SchedulerState);
    for (const id of decision.blocked) {
      const task = this.tasks.find((candidate) => candidate.id === id);
      if (task && task.status !== "blocked") {
        task.status = "blocked";
        this.events.push({ type: "task.blocked", taskId: id });
      }
    }
    for (const task of decision.ready) {
      task.status = "running";
      this.events.push(
        { type: "task.ready", taskId: task.id },
        { type: "task.started", taskId: task.id },
      );
    }
    return decision.ready;
  }
  complete(taskId: string, result: "succeeded" | "failed"): void {
    if (result !== "succeeded" && result !== "failed")
      throw new Error(`非法任务终态：${result}`);
    this.tasks = markTaskResult(this.tasks, taskId, result);
    this.events.push({
      type: result === "succeeded" ? "task.succeeded" : "task.failed",
      taskId,
    });
  }
}
