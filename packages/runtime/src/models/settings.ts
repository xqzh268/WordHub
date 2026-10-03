import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createModels,
  getSupportedThinkingLevels,
  type Models,
} from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { AgentRegistry } from "../agents/registry.js";
import type { ProjectService } from "../projects/service.js";
import type {
  AgentDefinition,
  ModelConfig,
  ModelRef,
  ReasoningLevel,
} from "../types.js";
import { loadModelConfig, ModelResolver } from "./resolver.js";

export function liveModels(): Models {
  const models = createModels();
  models.setProvider(deepseekProvider());
  return models;
}
export function builtinModelConfig(): ModelConfig {
  const models = liveModels();
  return {
    schemaVersion: 1,
    defaults: { provider: "deepseek", id: "deepseek-flash", reasoning: "low" },
    providers: [
      {
        id: "deepseek",
        label: "DeepSeek",
        kind: "builtin",
        enabled: true,
        models: ["deepseek-v4-pro", "deepseek-flash"].map((id) => {
          const model = models.getModel("deepseek", id);
          if (!model) throw new Error(`Pi未提供内置模型${id}`);
          return {
            id,
            label: model.name,
            contextWindow: model.contextWindow,
            maxOutputTokens: model.maxTokens,
            supportsReasoning: model.reasoning,
            supportedReasoning: getSupportedThinkingLevels(
              model,
            ) as ReasoningLevel[],
            pricing: {
              inputUsdPerMillion: model.cost.input,
              outputUsdPerMillion: model.cost.output,
              cacheReadUsdPerMillion: model.cost.cacheRead,
            },
          };
        }),
      },
    ],
  };
}
export class ModelSettings {
  constructor(
    private readonly projects: ProjectService,
    private readonly builtinRoot: string,
  ) {}
  async config(projectPath?: string): Promise<ModelConfig> {
    const global = await loadModelConfig(
      path.join(this.projects.storageRoot, "models.json"),
      builtinModelConfig(),
    );
    return projectPath
      ? loadModelConfig(path.join(projectPath, ".wordhub/models.json"), global)
      : global;
  }
  private async overrides(
    projectPath?: string,
  ): Promise<Record<string, ModelRef>> {
    const file = projectPath
      ? path.join(projectPath, ".wordhub/agent-models.json")
      : path.join(this.projects.storageRoot, "agent-models.json");
    return readFile(file, "utf8")
      .then((text) => JSON.parse(text) as Record<string, ModelRef>)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return {};
        throw error;
      });
  }
  async definitions(projectPath?: string) {
    const registry = new AgentRegistry(this.builtinRoot);
    const definitions = await registry.load(projectPath);
    const global = await this.overrides();
    const project = projectPath ? await this.overrides(projectPath) : {};
    const configured = [...definitions.values()].map((definition) => ({
      ...definition,
      model:
        project[definition.name] ?? global[definition.name] ?? definition.model,
    }));
    return {
      definitions: configured,
      errors: [...registry.getErrors().values()],
      warnings: [...registry.getWarnings().values()],
    };
  }
  async resolve(input: {
    agentId?: string;
    projectPath?: string;
    model?: string;
    reasoning?: string;
  }) {
    const config = await this.config(input.projectPath);
    const registry = await this.definitions(input.projectPath);
    const definition = registry.definitions.find(
      (agent) => agent.name === (input.agentId ?? "planner"),
    );
    if (!definition)
      throw new Error(
        `Agent不存在或配置无效：${input.agentId ?? "planner"}；${registry.errors.join("；")}`,
      );
    const message =
      input.model || input.reasoning
        ? {
            id: input.model,
            reasoning: input.reasoning as ReasoningLevel | undefined,
          }
        : undefined;
    const ref = new ModelResolver(config).resolve({
      message,
      agent: definition,
      global: config.defaults,
    });
    return { definition, ref, config };
  }
  async view(projectPath?: string) {
    const config = await this.config(projectPath);
    const registry = await this.definitions(projectPath);
    return {
      agents: registry.definitions.map((definition) => ({
        id: definition.name,
        displayName: definition.displayName,
        description: definition.description,
        avatar: definition.avatar,
        model: definition.model,
        source: definition.source,
        writeScopes: definition.writeScopes ?? [],
        confirmBeforeWrite: definition.confirmBeforeWrite ?? false,
      })),
      providers: config.providers.filter((provider) => provider.enabled),
      errors: registry.errors,
      warnings: registry.warnings,
    };
  }
  async set(
    agentId: string,
    model: ModelRef,
    projectPath?: string,
  ): Promise<void> {
    new ModelResolver(await this.config(projectPath)).assertSupported(model);
    const registry = await this.definitions(projectPath);
    if (!registry.definitions.some((definition) => definition.name === agentId))
      throw new Error("Agent不存在");
    const current = await this.overrides(projectPath);
    current[agentId] = model;
    await this.projects.saveJson(
      projectPath
        ? path.join(projectPath, ".wordhub/agent-models.json")
        : path.join(this.projects.storageRoot, "agent-models.json"),
      current,
    );
  }
}

export type ResolvedAgent = {
  definition: AgentDefinition;
  ref: ModelRef;
  config: ModelConfig;
};
