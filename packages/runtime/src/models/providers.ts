import {
  createProvider,
  envApiKeyAuth,
  getSupportedThinkingLevels,
  type Api,
  type CreateModelsOptions,
  type Model,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import {
  builtinModels,
  builtinProviders,
} from "@earendil-works/pi-ai/providers/all";
import type {
  CustomProviderApi,
  ModelCatalogEntry,
  ModelConfig,
  ProviderConfig,
  ReasoningLevel,
} from "../types.js";

/** 需要云账号、OAuth或额外端点的Provider，不作为“填密钥即用”的预设。 */
const EXCLUDED_PRESETS = new Set([
  "amazon-bedrock",
  "azure-openai-responses",
  "cloudflare-ai-gateway",
  "cloudflare-workers-ai",
  "github-copilot",
  "google-vertex",
  "openai-codex",
  "radius",
]);

export type ProviderPreset = {
  id: string;
  label: string;
  baseUrl?: string;
  modelCount: number;
};

export type CustomProviderInput = {
  id: string;
  label: string;
  baseUrl: string;
  api: CustomProviderApi;
  models: Array<{
    id: string;
    label?: string;
    contextWindow?: number;
    maxOutputTokens?: number;
    reasoning?: boolean;
    /** 美元/百万token；三项都不填时尝试按模型ID匹配Pi目录，匹配不到则标为价格未知。 */
    inputUsdPerMillion?: number;
    outputUsdPerMillion?: number;
    cacheReadUsdPerMillion?: number;
  }>;
};

const API_FACTORIES = {
  "openai-completions": openAICompletionsApi,
  "openai-responses": openAIResponsesApi,
  "anthropic-messages": anthropicMessagesApi,
} as const;

export const PROVIDER_ID = /^[a-z][a-z0-9-]{1,63}$/u;

function presetProviders(): Provider[] {
  return builtinProviders().filter(
    (provider) =>
      !EXCLUDED_PRESETS.has(provider.id) &&
      provider.auth.apiKey &&
      provider.getModels().length > 0,
  );
}

/** Pi内置目录中可直接使用的Provider预设。 */
export function listPresets(): ProviderPreset[] {
  return presetProviders()
    .map((provider) => ({
      id: provider.id,
      label: provider.name,
      baseUrl: provider.baseUrl,
      modelCount: provider.getModels().length,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function catalogEntry(model: Model<Api>): ModelCatalogEntry {
  return {
    id: model.id,
    label: model.name,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxTokens,
    supportsReasoning: model.reasoning,
    supportedReasoning: getSupportedThinkingLevels(model) as ReasoningLevel[],
    pricing: {
      inputUsdPerMillion: model.cost.input,
      outputUsdPerMillion: model.cost.output,
      cacheReadUsdPerMillion: model.cost.cacheRead,
    },
  };
}

/** 模型清单直接取自Pi目录，随Pi升级更新，不写入models.json。 */
export function presetModels(id: string): ModelCatalogEntry[] {
  const provider = builtinProviders().find((item) => item.id === id);
  return provider ? provider.getModels().map(catalogEntry) : [];
}

export function presetConfig(id: string): ProviderConfig {
  const provider = presetProviders().find((item) => item.id === id);
  if (!provider) throw new Error(`没有这个预设：${id}`);
  return {
    id: provider.id,
    label: provider.name,
    kind: "builtin",
    enabled: true,
    baseUrl: provider.baseUrl,
    models: [],
  };
}

/** 按模型ID在Pi内置目录里找同名模型（网关常转发官方模型），用其价格作参考。 */
function catalogPricing(
  id: string,
):
  | { pricing: ModelCatalogEntry["pricing"]; contextWindow: number }
  | undefined {
  const bare = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  for (const provider of builtinProviders())
    for (const model of provider.getModels())
      if (model.id === id || model.id === bare)
        return {
          pricing: catalogEntry(model).pricing,
          contextWindow: model.contextWindow,
        };
  return undefined;
}

const finiteNonNegative = (value: number | undefined, name: string) => {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${name}必须是不小于0的数字`);
  return value;
};

/** 构造自定义Provider的配置并校验输入。 */
export function customConfig(input: CustomProviderInput): ProviderConfig {
  if (!PROVIDER_ID.test(input.id))
    throw new Error("Provider ID需以小写字母开头，只含小写字母、数字和连字符");
  if (builtinProviders().some((item) => item.id === input.id))
    throw new Error(`ID ${input.id} 与内置Provider重名，请换一个`);
  if (!(input.api in API_FACTORIES)) throw new Error("不支持的接口协议");
  try {
    const url = new URL(input.baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error();
  } catch {
    throw new Error("Base URL必须是有效的http(s)地址");
  }
  if (input.models.length === 0) throw new Error("至少需要添加一个模型");
  return {
    id: input.id,
    label: input.label.trim() || input.id,
    kind: input.api === "anthropic-messages" ? "custom" : "openai-compatible",
    enabled: true,
    baseUrl: input.baseUrl.trim().replace(/\/+$/u, ""),
    api: input.api,
    models: input.models.map((model) => {
      const id = model.id.trim();
      if (!id) throw new Error("模型ID不能为空");
      const reasoning = model.reasoning ?? false;
      const input = finiteNonNegative(
        model.inputUsdPerMillion,
        `${id}的输入价格`,
      );
      const output = finiteNonNegative(
        model.outputUsdPerMillion,
        `${id}的输出价格`,
      );
      const cacheRead = finiteNonNegative(
        model.cacheReadUsdPerMillion,
        `${id}的缓存价格`,
      );
      const found =
        input === undefined && output === undefined && cacheRead === undefined
          ? catalogPricing(id)
          : undefined;
      const pricingSource: ModelCatalogEntry["pricingSource"] = found
        ? "catalog"
        : input !== undefined || output !== undefined || cacheRead !== undefined
          ? "user"
          : "unknown";
      const contextWindow =
        model.contextWindow ?? found?.contextWindow ?? 128000;
      if (!Number.isInteger(contextWindow) || contextWindow < 1)
        throw new Error(`${id}的上下文长度必须是正整数`);
      return {
        id,
        label: model.label?.trim() || id,
        contextWindow,
        maxOutputTokens: model.maxOutputTokens ?? 8192,
        supportsReasoning: reasoning,
        supportedReasoning: reasoning
          ? ["off", "minimal", "low", "medium", "high"]
          : ["off"],
        pricing: found?.pricing ?? {
          inputUsdPerMillion: input ?? 0,
          outputUsdPerMillion: output ?? 0,
          cacheReadUsdPerMillion: cacheRead ?? 0,
        },
        pricingSource,
      };
    }),
  };
}

export function envVarName(providerId: string): string {
  return `${providerId.toUpperCase().replaceAll("-", "_")}_API_KEY`;
}

/** 把用户定义的Provider配置转成Pi Provider（Pi自身models.json自定义Provider同走createProvider）。 */
export function customPiProvider(config: ProviderConfig): Provider {
  if (!config.api || !config.baseUrl)
    throw new Error(`自定义Provider ${config.id} 缺少api或baseUrl`);
  const api = config.api;
  const baseUrl = config.baseUrl;
  return createProvider({
    id: config.id,
    name: config.label,
    baseUrl,
    auth: {
      apiKey: envApiKeyAuth(`${config.label} API key`, [envVarName(config.id)]),
    },
    models: config.models.map((entry) => ({
      id: entry.id,
      name: entry.label,
      api,
      provider: config.id,
      baseUrl,
      input: ["text"] as ("text" | "image")[],
      reasoning: entry.supportsReasoning,
      cost: {
        input: entry.pricing.inputUsdPerMillion,
        output: entry.pricing.outputUsdPerMillion,
        cacheRead: entry.pricing.cacheReadUsdPerMillion,
        cacheWrite: 0,
      },
      contextWindow: entry.contextWindow,
      maxTokens: entry.maxOutputTokens ?? 8192,
    })),
    api: API_FACTORIES[api](),
  });
}

/** 全部Pi内置Provider，加上配置中的自定义Provider。 */
export function createRuntimeModels(
  options?: CreateModelsOptions,
): MutableModels {
  return builtinModels(options);
}

export function isUserDefined(provider: ProviderConfig): boolean {
  return provider.kind !== "builtin";
}

export function registerCustomProviders(
  models: MutableModels,
  config: ModelConfig,
): void {
  const wanted = new Set<string>();
  for (const provider of config.providers) {
    if (!isUserDefined(provider) || !provider.enabled) continue;
    wanted.add(provider.id);
    models.setProvider(customPiProvider(provider));
  }
  const builtin = new Set(builtinProviders().map((item) => item.id));
  for (const provider of models.getProviders())
    if (!builtin.has(provider.id) && !wanted.has(provider.id))
      models.deleteProvider(provider.id);
}
