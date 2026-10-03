import { describe, expect, it } from "vitest";
import { parseAgentMarkdown } from "./agents/registry.js";
import { ContextBuilder } from "./context/builder.js";
import {
  ModelResolver,
  mergeModelConfig,
  parseModelConfig,
} from "./models/resolver.js";
import { createBuiltinTools } from "./tools/builtin.js";
import { PermissionDeniedError, PermissionGuard } from "./tools/permissions.js";
import type { AgentDefinition, ModelConfig } from "./types.js";

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
          supportedReasoning: ["low", "high"],
          pricing: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 2,
            cacheReadUsdPerMillion: 0.1,
          },
        },
      ],
    },
  ],
};

const agent = parseAgentMarkdown(
  `---
name: custom-agent
displayName: 自建Agent
description: 测试Agent
model: { provider: deepseek, id: flash, reasoning: low }
tools: [doc.read, doc.write]
write: write
writeScopes: [chapters/**]
memoryScopes: { read: [bible], write: [] }
maxTurns: 4
---
系统提示`,
  "project/.wordhub/agents/custom-agent/AGENT.md",
  "project",
);

describe("WordHub runtime", () => {
  it("解析AGENT.md并给项目Agent启用确认默认值", () => {
    expect(agent.name).toBe("custom-agent");
    expect(agent.confirmBeforeWrite).toBe(true);
    expect(agent.version).toHaveLength(16);
  });

  it("按消息、Agent、项目、全局顺序解析模型并拒绝不支持的思考强度", () => {
    const resolver = new ModelResolver(config);
    expect(
      resolver.resolve({
        global: config.defaults,
        agent,
        project: { provider: "deepseek", id: "flash", reasoning: "high" },
      }),
    ).toEqual({ provider: "deepseek", id: "flash", reasoning: "low" });
    expect(() =>
      resolver.resolve({
        global: config.defaults,
        message: { reasoning: "max" },
      }),
    ).toThrow("不支持思考强度");
  });

  it("校验并合并项目模型配置", () => {
    expect(parseModelConfig(config).schemaVersion).toBe(1);
    expect(() =>
      parseModelConfig(
        { schemaVersion: 1, defaults: {}, providers: [] },
        "project/models.json",
      ),
    ).toThrow("defaults不是有效模型引用");
    const merged = mergeModelConfig(config, {
      ...config,
      defaults: { provider: "deepseek", id: "flash", reasoning: "high" },
      providers: [],
    });
    expect(merged.defaults.reasoning).toBe("high");
    expect(merged.providers[0]?.id).toBe("deepseek");
  });

  it("权限守卫限制Agent工具和路径", () => {
    const guard = new PermissionGuard();
    guard.assert(agent, "doc.write", "chapters/第一章.md");
    expect(() => guard.assert(agent, "doc.write", "bible/设定.md")).toThrow(
      PermissionDeniedError,
    );
    expect(guard.requiresApproval(agent, "doc.write")).toBe(true);
    expect(guard.requiresApproval(agent, "doc.propose")).toBe(true);
  });

  it("项目Agent未声明写入范围时默认拒绝写入", () => {
    const unrestricted = { ...agent, writeScopes: [] };
    expect(() =>
      new PermissionGuard().assert(
        unrestricted,
        "doc.write",
        "chapters/第一章.md",
      ),
    ).toThrow("未声明写入范围");
  });

  it("首批文档工具只通过运行时适配器读写", async () => {
    const tools = createBuiltinTools({
      readDocument: async (path) => ({
        text: `read:${path}`,
        contentHash: "sha256:test",
      }),
      readBible: async (path) => ({ text: `bible:${path}`, contentHash: null }),
      writeDocument: async ({ path }) => ({
        revisionId: `rev:${path}`,
        contentHash: "sha256:test",
      }),
      proposeDocument: async ({ path }) => ({
        revisionId: `proposal:${path}`,
        contentHash: "sha256:test",
      }),
      searchHistory: async (query) => [
        { type: "chat.user_message", seq: 1, text: query },
      ],
    });
    expect(tools.map((tool) => tool.name)).toEqual([
      "doc.read",
      "doc.write",
      "doc.propose",
      "bible.read",
      "bible.propose",
      "history.search",
      "history.get",
    ]);
    const writeTool = tools.find((tool) => tool.name === "doc.write");
    expect(writeTool).toBeDefined();
    if (!writeTool) throw new Error("doc.write tool missing");
    const result = await writeTool.execute("tool-1", {
      path: "chapters/第一章.md",
      content: "正文",
    });
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(result.details).toMatchObject({
      revisionId: "rev:chapters/第一章.md",
    });
  });

  it("上下文构建产出可审计的分层清单", () => {
    const result = new ContextBuilder().build(
      [{ id: "bible", kind: "bible", text: "人物不能瞬移" }],
      "写第一章",
    );
    expect(result.manifest[0]?.sourcePath).toBeUndefined();
    expect(result.messages).toHaveLength(2);
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });
});

void (agent satisfies AgentDefinition);
