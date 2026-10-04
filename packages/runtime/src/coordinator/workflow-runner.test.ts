import { describe, expect, it } from "vitest";
import { WorkflowRun } from "./workflow-runner.js";
import type { WorkflowDefinition } from "./workflow.js";

const definition: WorkflowDefinition = {
  id: "demo",
  label: "演示",
  nodes: [
    {
      id: "writer",
      kind: "write",
      agent: "writer",
      dependencies: [],
      status: "pending",
      maxAttempts: 1,
    },
    {
      id: "editor",
      kind: "edit",
      agent: "editor",
      dependencies: ["writer"],
      status: "pending",
      maxAttempts: 1,
    },
  ],
};

describe("声明式工作流运行器", () => {
  it("按依赖顺序发出可重放任务事件", () => {
    const run = new WorkflowRun(definition);
    expect(run.next().map((task) => task.id)).toEqual(["writer"]);
    run.complete("writer", "succeeded");
    expect(run.next().map((task) => task.id)).toEqual(["editor"]);
    expect(run.eventsSinceStart().map((event) => event.type)).toEqual([
      "task.ready",
      "task.started",
      "task.succeeded",
      "task.ready",
      "task.started",
    ]);
  });
});
