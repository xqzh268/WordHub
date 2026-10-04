import type { Task, TaskStatus } from "@wordhub/contracts";

export type TaskNode = Pick<
  Task,
  "id" | "dependencies" | "assignedAgent" | "maxAttempts" | "attempt"
> & { status: TaskStatus };

export type SchedulerState = {
  tasks: readonly TaskNode[];
  running: readonly string[];
  concurrency: number;
};

export type SchedulerDecision = {
  ready: TaskNode[];
  blocked: string[];
  terminal: boolean;
};

const TERMINAL = new Set<TaskStatus>(["succeeded", "failed", "cancelled"]);

/**
 * 纯任务图调度器。它只根据已持久化的任务状态计算下一批，不执行副作用，
 * 因此在线运行、重启恢复和属性测试共用同一个决策面。
 */
export function decideNext(state: SchedulerState): SchedulerDecision {
  const byId = new Map(state.tasks.map((task) => [task.id, task]));
  const running = new Set(state.running);
  const ready: TaskNode[] = [];
  const blocked: string[] = [];
  for (const task of state.tasks) {
    if (task.status !== "pending" && task.status !== "ready") continue;
    const dependencies = task.dependencies.map((id) => byId.get(id));
    if (dependencies.some((dependency) => !dependency)) {
      blocked.push(task.id);
      continue;
    }
    if (
      dependencies.some(
        (dependency) =>
          dependency &&
          (dependency.status === "failed" ||
            dependency.status === "cancelled" ||
            dependency.status === "blocked"),
      )
    ) {
      blocked.push(task.id);
      continue;
    }
    if (
      dependencies.some(
        (dependency) => dependency && dependency.status !== "succeeded",
      )
    )
      continue;
    if (running.has(task.id)) continue;
    ready.push(task);
  }
  const slots = Math.max(0, state.concurrency - running.size);
  const selected = ready.slice(0, slots);
  const terminal =
    state.tasks.length > 0 &&
    state.tasks.every(
      (task) => TERMINAL.has(task.status) || task.status === "blocked",
    );
  return { ready: selected, blocked, terminal };
}

export function markTaskResult(
  tasks: readonly TaskNode[],
  taskId: string,
  result: "succeeded" | "failed",
): TaskNode[] {
  return tasks.map((task) => {
    if (task.id !== taskId) return { ...task };
    if (result === "succeeded") return { ...task, status: "succeeded" };
    const attempt = (task.attempt ?? 0) + 1;
    const maxAttempts = task.maxAttempts ?? 1;
    return {
      ...task,
      attempt,
      status: attempt < maxAttempts ? "ready" : "failed",
    };
  });
}
