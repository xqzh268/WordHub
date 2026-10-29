import { describe, expect, it } from "vitest";
import { summarizeRunEvents } from "./m4-diagnostics.mjs";

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
