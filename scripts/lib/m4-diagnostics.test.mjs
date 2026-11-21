import { describe, expect, it } from "vitest";
import {
  assessPlantedContradiction,
  reportedModelUsage,
  summarizeRunEvents,
} from "./m4-diagnostics.mjs";

describe("M4.7运行诊断", () => {
  it("按Agent节点汇总耗时、工具调用和上下文层", () => {
    const result = summarizeRunEvents([
      {
        run_id: "run_writer",
        type: "run.started",
        occurred_at: "2026-10-29T00:00:00.000Z",
        payload: { nodeId: "writer", agentId: "writer" },
      },
      {
        run_id: "run_writer",
        type: "context.injected",
        occurred_at: "2026-10-29T00:00:01.000Z",
        payload: {
          estimatedTokens: 3200,
          manifest: [{ id: "characters", estimatedTokens: 600 }],
        },
      },
      {
        run_id: "run_writer",
        type: "run.tool_started",
        occurred_at: "2026-10-29T00:00:02.000Z",
        payload: { tool: "doc.read" },
      },
      {
        run_id: "run_writer",
        type: "run.usage",
        occurred_at: "2026-10-29T00:00:03.000Z",
        payload: { inputTokens: 100, outputTokens: 40 },
      },
      {
        run_id: "run_writer",
        type: "run.finished",
        occurred_at: "2026-10-29T00:00:05.000Z",
        payload: {},
      },
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        runId: "run_writer",
        nodeId: "writer",
        seconds: 5,
        toolCalls: 1,
        contextTokens: 3200,
        inputTokens: 100,
        outputTokens: 40,
      }),
    ]);
  });
});

it("预埋矛盾的两处引用必须属于同一条相关质询", () => {
  const third = "chapters/第三章.md",
    fourth = "chapters/第四章.md";
  const prev = { source: third, quote: "老周已死" },
    next = { source: fourth, quote: "老周笑着招呼他" };
  const challenge = (claim, citations) => ({
    type: "challenge.raise",
    payload: { claim, citations },
  });
  const split = [
    challenge("老周为何又活着？", [prev]),
    challenge("第四章时辰不符", [next]),
  ];
  expect(assessPlantedContradiction(split, third, fourth).citesBoth).toBe(
    false,
  );
  expect(
    assessPlantedContradiction(
      [challenge("人物状态前后冲突", [prev, next])],
      third,
      fourth,
    ).citesBoth,
  ).toBe(true);
  expect(
    assessPlantedContradiction([challenge("失物数量不符", [])], third, fourth)
      .detected,
  ).toBe(false);
});

it("总用量包括成功的纲领草稿，不重复使用工作流汇总", () => {
  expect(
    reportedModelUsage([
      {
        type: "intake.draft.ready",
        payload: { source: "model", usage: { total: 20, cost: 0.004 } },
      },
      {
        type: "run.usage",
        payload: { usage: { totalTokens: 30, cost: { total: 0.005 } } },
      },
      { type: "workflow.finished", payload: { tokens: 30, cost: 0.005 } },
      { type: "intake.draft.ready", payload: { source: "template" } },
    ]),
  ).toEqual({ tokens: 50, costUsd: 0.009 });
});
