import type { ModelRef, ModelConfig } from "../types.js";

export type EstimateTask = {
  id: string;
  model: ModelRef;
  contextTokens: number;
  historicalOutputTokens?: number;
};
export type RunEstimate = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  tasks: Array<EstimateTask & { costUsd: number }>;
};

const priceFor = (config: ModelConfig, ref: ModelRef) => {
  const provider = config.providers.find((item) => item.id === ref.provider);
  return (
    provider?.models.find((item) => item.id === ref.id)?.pricing ?? {
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
      cacheReadUsdPerMillion: 0,
    }
  );
};

/** 运行前估算只读上下文和历史用量，不改变预算状态。缺少历史时采用保守的输出常数。 */
export function estimateRun(
  tasks: readonly EstimateTask[],
  config: ModelConfig,
): RunEstimate {
  const values = tasks.map((task) => {
    const outputTokens = task.historicalOutputTokens ?? 1200;
    const pricing = priceFor(config, task.model);
    const costUsd =
      (task.contextTokens * pricing.inputUsdPerMillion +
        outputTokens * pricing.outputUsdPerMillion) /
      1_000_000;
    return { ...task, outputTokens, costUsd };
  });
  return {
    inputTokens: values.reduce((total, task) => total + task.contextTokens, 0),
    outputTokens: values.reduce((total, task) => total + task.outputTokens, 0),
    costUsd: values.reduce((total, task) => total + task.costUsd, 0),
    tasks: values,
  };
}
