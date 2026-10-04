import { describe, expect, it } from "vitest";
import { estimateRun } from "./estimate.js";
import type { ModelConfig } from "../types.js";

const config: ModelConfig = {
  schemaVersion: 1,
  defaults: { provider: "deepseek", id: "flash", reasoning: "low" },
  providers: [
    {
      id: "deepseek",
      label: "DeepSeek",
      kind: "builtin",
      enabled: true,
      models: [
        {
          id: "flash",
          label: "Flash",
          contextWindow: 1000,
          supportsReasoning: true,
          pricing: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 2,
            cacheReadUsdPerMillion: 0,
          },
        },
      ],
    },
  ],
};

describe("费用估算", () => {
  it("按上下文和历史输出用量计算，并对缺少历史的任务使用保守值", () => {
    const result = estimateRun(
      [
        {
          id: "writer",
          model: config.defaults,
          contextTokens: 1000,
          historicalOutputTokens: 500,
        },
        { id: "editor", model: config.defaults, contextTokens: 2000 },
      ],
      config,
    );
    expect(result.inputTokens).toBe(3000);
    expect(result.outputTokens).toBe(1700);
    expect(result.costUsd).toBeCloseTo(0.0064);
  });
});
