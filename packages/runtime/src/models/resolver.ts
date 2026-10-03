import { readFile } from "node:fs/promises";
import type { Api, Model, Models, Usage } from "@earendil-works/pi-ai";
import {
  calculateCost,
  getSupportedThinkingLevels,
} from "@earendil-works/pi-ai";
import type {
  AgentDefinition,
  ModelConfig,
  ModelRef,
  ReasoningLevel,
} from "../types.js";

export type ModelSelection = {
  message?: Partial<ModelRef>;
  agent?: AgentDefinition;
  project?: ModelRef;
  global: ModelRef;
};

export function parseModelConfig(
  value: unknown,
  source = "models.json",
): ModelConfig {
  if (!value || typeof value !== "object")
    throw new Error(`${source}必须是对象`);
  const data = value as Record<string, unknown>;
  if (
    data.schemaVersion !== 1 ||
    !data.defaults ||
    !Array.isArray(data.providers)
  )
    throw new Error(
      `${source}格式无效：需要schemaVersion、defaults和providers`,
    );
  const ref = data.defaults as Record<string, unknown>;
  if (
    typeof ref.provider !== "string" ||
    typeof ref.id !== "string" ||
    typeof ref.reasoning !== "string"
  )
    throw new Error(`${source}.defaults不是有效模型引用`);
  for (const provider of data.providers) {
    if (!provider || typeof provider !== "object")
      throw new Error(`${source}.providers包含无效项`);
    const item = provider as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      typeof item.label !== "string" ||
      typeof item.enabled !== "boolean" ||
      !Array.isArray(item.models)
    )
      throw new Error(`${source}.providers包含无效Provider`);
  }
  return value as ModelConfig;
}

export async function loadModelConfig(
  filePath: string,
  fallback: ModelConfig,
): Promise<ModelConfig> {
  const text = await readFile(filePath, "utf8").catch(() => undefined);
  if (!text) return fallback;
  return parseModelConfig(JSON.parse(text) as unknown, filePath);
}

export function mergeModelConfig(
  base: ModelConfig,
  override: ModelConfig,
): ModelConfig {
  const providers = new Map(
    base.providers.map((provider) => [provider.id, provider]),
  );
  for (const provider of override.providers)
    providers.set(provider.id, provider);
  return {
    schemaVersion: 1,
    defaults: override.defaults,
    providers: [...providers.values()],
  };
}

export class ModelResolver {
  constructor(private readonly config: ModelConfig) {}

  resolve(selection: ModelSelection): ModelRef {
    const candidate: ModelRef = {
      provider:
        selection.message?.provider ??
        selection.agent?.model.provider ??
        selection.project?.provider ??
        selection.global.provider,
      id:
        selection.message?.id ??
        selection.agent?.model.id ??
        selection.project?.id ??
        selection.global.id,
      reasoning: (selection.message?.reasoning ??
        selection.agent?.model.reasoning ??
        selection.project?.reasoning ??
        selection.global.reasoning) as ReasoningLevel,
    };
    this.assertSupported(candidate);
    return candidate;
  }

  assertSupported(ref: ModelRef): void {
    const provider = this.config.providers.find(
      (item) => item.id === ref.provider && item.enabled,
    );
    const model = provider?.models.find((item) => item.id === ref.id);
    if (!provider || !model)
      throw new Error(`模型不存在或未启用：${ref.provider}/${ref.id}`);
    if (ref.reasoning !== "off" && !model.supportsReasoning)
      throw new Error(`模型不支持思考强度：${ref.id}`);
    if (
      model.supportedReasoning &&
      !model.supportedReasoning.includes(ref.reasoning)
    )
      throw new Error(`模型不支持思考强度${ref.reasoning}：${ref.id}`);
  }

  supportedReasoning(ref: ModelRef): ReasoningLevel[] {
    const provider = this.config.providers.find(
      (item) => item.id === ref.provider,
    );
    const model = provider?.models.find((item) => item.id === ref.id);
    return (
      model?.supportedReasoning ??
      (model?.supportsReasoning
        ? ["minimal", "low", "medium", "high", "xhigh", "max"]
        : ["off"])
    );
  }

  estimate(
    ref: ModelRef,
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
    },
  ): number {
    const model = this.config.providers
      .find((item) => item.id === ref.provider)
      ?.models.find((item) => item.id === ref.id);
    if (!model) throw new Error(`模型不存在：${ref.provider}/${ref.id}`);
    return (
      (usage.inputTokens * model.pricing.inputUsdPerMillion) / 1_000_000 +
      (usage.outputTokens * model.pricing.outputUsdPerMillion) / 1_000_000 +
      ((usage.cacheReadTokens ?? 0) * model.pricing.cacheReadUsdPerMillion) /
        1_000_000
    );
  }
}

export class MemoryCredentialStore {
  private readonly secrets = new Map<string, string>();
  async get(
    provider: string,
    reference = "default",
  ): Promise<string | undefined> {
    return this.secrets.get(`${provider}:${reference}`);
  }
  async set(
    provider: string,
    secret: string,
    reference = "default",
  ): Promise<void> {
    this.secrets.set(`${provider}:${reference}`, secret);
  }
  async delete(provider: string, reference = "default"): Promise<void> {
    this.secrets.delete(`${provider}:${reference}`);
  }
}

export type PiModelResolver = {
  resolve(ref: ModelRef): Model<Api> | undefined;
  supportedReasoning(model: Model<Api>): string[];
  cost(model: Model<Api>, usage: Usage): Usage["cost"];
};

export function createPiModelResolver(models: Models): PiModelResolver {
  return {
    resolve: (ref) => models.getModel(ref.provider, ref.id),
    supportedReasoning: (model) => getSupportedThinkingLevels(model),
    cost: (model, usage) => calculateCost(model, usage),
  };
}
