import { describe, expect, it } from "vitest";
import { decideNext, markTaskResult, type TaskNode } from "./graph.js";

const task = (
  id: string,
  dependencies: string[] = [],
  status: TaskNode["status"] = "pending",
): TaskNode => ({
  id,
  dependencies,
  status,
  maxAttempts: 2,
});

describe("任务图调度器", () => {
  it("只调度依赖已完成的节点并尊重并发度", () => {
    const tasks = [
      task("writer"),
      task("editor", ["writer"]),
      task("reviewer", ["writer"]),
      task("missing", ["nope"]),
    ] as const;
    const first = decideNext({ tasks, running: [], concurrency: 2 });
    expect(first.ready.map((item) => item.id)).toEqual(["writer"]);
    const second = decideNext({
      tasks: tasks.map((item) =>
        item.id === "writer" ? { ...item, status: "succeeded" } : item,
      ),
      running: [],
      concurrency: 2,
    });
    expect(second.ready.map((item) => item.id)).toEqual(["editor", "reviewer"]);
    expect(second.blocked).toContain("missing");
  });

  it("失败时只重试到声明的次数", () => {
    let tasks = [task("writer")];
    tasks = markTaskResult(tasks, "writer", "failed");
    expect(tasks[0]?.status).toBe("ready");
    tasks = markTaskResult(tasks, "writer", "failed");
    expect(tasks[0]?.status).toBe("failed");
  });
});
