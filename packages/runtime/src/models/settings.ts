import { readFile } from "node:fs/promises";
import path from "node:path";
import { AgentRegistry } from "../agents/registry.js";
import type { ProjectService } from "../projects/service.js";
import type {
  AgentDefinition,
  ModelConfig,
  ModelRef,
  ProviderConfig,
  ReasoningLevel,
} from "../types.js";
import {
  catalogEntry,
  customConfig,
  isUserDefined,
  listPresets,
  presetConfig,
  presetModels,
  createRuntimeModels,
  type CustomProviderInput,
} from "./providers.js";
import { loadModelConfig, ModelResolver } from "./resolver.js";

/** DeepSeek是默认服务商，始终存在，不能删除。 */
export const DEFAULT_PROVIDER = "deepseek";

export function liveModels() {
  return createRuntimeModels();
}
export function builtinModelConfig(): ModelConfig {
  const models = liveModels();
  const entries = ["deepseek-v4-pro", "deepseek-flash"].map((id) => {
    const model = models.getModel(DEFAULT_PROVIDER, id);
    if (!model) throw new Error(`Pi未提供内置模型${id}`);
    return catalogEntry(model);
  });
  return {
    schemaVersion: 1,
    defaults: { provider: "deepseek", id: "deepseek-flash", reasoning: "low" },
    providers: [
      {
        id: DEFAULT_PROVIDER,
        label: "DeepSeek",
        kind: "builtin",
        enabled: true,
        models: entries,
      },
    ],
  };
}
export class ModelSettings {
  constructor(
    private readonly projects: ProjectService,
    private readonly builtinRoot: string,
  ) {}
  private get globalFile(): string {
    return path.join(this.projects.storageRoot, "models.json");
  }
  /** 预设Provider只在文件里记一条，模型清单每次从Pi目录读取。 */
  private hydrate(config: ModelConfig): ModelConfig {
    return {
      ...config,
      providers: config.providers.map((provider) =>
        provider.kind === "builtin" && provider.models.length === 0
          ? { ...provider, models: presetModels(provider.id) }
          : provider,
      ),
    };
  }
  async config(projectPath?: string): Promise<ModelConfig> {
    const global = await loadModelConfig(this.globalFile, builtinModelConfig());
    return this.hydrate(
      projectPath
        ? await loadModelConfig(
            path.join(projectPath, ".wordhub/models.json"),
            global,
          )
        : global,
    );
  }
  /** 用户自己维护的全局models.json，不含内置默认。 */
  private async userConfig(): Promise<ModelConfig> {
    return readFile(this.globalFile, "utf8")
      .then((text) => JSON.parse(text) as ModelConfig)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return builtinModelConfig();
        throw error;
      });
  }
  private async saveUserConfig(providers: ProviderConfig[]): Promise<void> {
    const current = await this.userConfig();
    await this.projects.saveJson(this.globalFile, {
      schemaVersion: 1,
      defaults: current.defaults,
      providers,
    });
  }
  async presets() {
    const config = await this.config();
    const added = new Set(config.providers.map((item) => item.id));
    return listPresets().map((preset) => ({
      ...preset,
      added: added.has(preset.id),
    }));
  }
  async addPreset(id: string): Promise<void> {
    const current = await this.userConfig();
    const entry = presetConfig(id);
    await this.saveUserConfig([
      ...current.providers.filter((item) => item.id !== id),
      entry,
    ]);
  }
  /** replace为真时覆盖同ID的自定义Provider（编辑）；预设和默认服务商不能被覆盖。 */
  async addCustom(input: CustomProviderInput, replace = false): Promise<void> {
    const current = await this.userConfig();
    const existing = current.providers.find((item) => item.id === input.id);
    if (input.id === DEFAULT_PROVIDER || (existing && !replace))
      throw new Error(`Provider ID已存在：${input.id}`);
    if (existing && !isUserDefined(existing))
      throw new Error(`${input.id}是预设服务商，不能用自定义配置覆盖`);
    const entry = customConfig(input);
    await this.saveUserConfig(
      existing
        ? current.providers.map((item) => (item.id === input.id ? entry : item))
        : [...current.providers, entry],
    );
  }
  /** 删除Provider，并清除指向它的逐Agent模型设置。 */
  async removeProvider(id: string, projectPath?: string): Promise<void> {
    if (id === DEFAULT_PROVIDER) throw new Error("默认服务商不能删除");
    const current = await this.userConfig();
    await this.saveUserConfig(
      current.providers.filter((item) => item.id !== id),
    );
    for (const scope of projectPath ? [undefined, projectPath] : [undefined]) {
      const overrides = await this.overrides(scope);
      const kept = Object.fromEntries(
        Object.entries(overrides).filter(([, ref]) => ref.provider !== id),
      );
      if (Object.keys(kept).length !== Object.keys(overrides).length)
        await this.projects.saveJson(
          scope
            ? path.join(scope, ".wordhub/agent-models.json")
            : path.join(this.projects.storageRoot, "agent-models.json"),
          kept,
        );
    }
  }
  /** 已配置的Provider清单（含用户定义的），供设置页展示。 */
  async providerList(projectPath?: string) {
    const config = await this.config(projectPath);
    return config.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      api: provider.api,
      modelCount: provider.models.length,
      removable: provider.id !== DEFAULT_PROVIDER,
      userDefined: isUserDefined(provider),
      // 自定义服务商带回完整模型清单，供设置页编辑；预设的清单来自Pi目录。
      models: isUserDefined(provider) ? provider.models : undefined,
    }));
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
