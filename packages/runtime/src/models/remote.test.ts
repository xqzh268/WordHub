import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectService } from "../projects/service.js";
import { customConfig } from "./providers.js";
import { fetchRemoteModels, parseRemoteModels } from "./remote.js";
import { ModelSettings } from "./settings.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("从接口获取模型列表", () => {
  it("解析OpenAI格式，并用Pi目录同名模型补全能力和价格", () => {
    const models = parseRemoteModels({
      object: "list",
      data: [
        { id: "gpt-4o-mini", object: "model" },
        { id: "totally-unknown-model" },
        { id: "gpt-4o-mini" },
      ],
    });
    expect(models.map((m) => m.id)).toEqual([
      "gpt-4o-mini",
      "totally-unknown-model",
    ]);
    const known = models[0]!;
    expect(known.source).toBe("catalog");
    expect(known.contextWindow).toBeGreaterThan(0);
    expect(known.inputUsdPerMillion).toBeGreaterThan(0);
    expect(models[1]).toMatchObject({ source: "unknown", reasoning: false });
  });

  it("解析OpenRouter格式：上下文、每token价格换算成每百万、思考参数", () => {
    const [model] = parseRemoteModels({
      data: [
        {
          id: "vendor/new-model",
          name: "New Model",
          context_length: 200000,
          pricing: { prompt: "0.000003", completion: "0.000015" },
          top_provider: { max_completion_tokens: 64000 },
          supported_parameters: ["tools", "reasoning"],
        },
      ],
    });
    expect(model).toMatchObject({
      id: "vendor/new-model",
      label: "New Model",
      contextWindow: 200000,
      maxOutputTokens: 64000,
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
      reasoning: true,
      source: "remote",
    });
  });

  it("不是模型列表时报错", () => {
    expect(() => parseRemoteModels({ error: "x" })).toThrow("不是模型列表");
  });

  it("OpenAI协议请求 {base}/models 并带Bearer密钥", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const models = await fetchRemoteModels({
      baseUrl: "https://llm.example.com/v1/",
      api: "openai-completions",
      apiKey: "sk-test",
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string> });
        return json({ data: [{ id: "m1" }] });
      }) as unknown as typeof fetch,
    });
    expect(models.map((m) => m.id)).toEqual(["m1"]);
    expect(calls[0]?.url).toBe("https://llm.example.com/v1/models");
    expect(calls[0]?.headers.authorization).toBe("Bearer sk-test");
  });

  it("Anthropic协议先试 /v1/models，带版本头和x-api-key；404时再试 /models", async () => {
    const urls: string[] = [];
    const models = await fetchRemoteModels({
      baseUrl: "https://claude.example.com",
      api: "anthropic-messages",
      apiKey: "k",
      fetchImpl: (async (url: string, init: RequestInit) => {
        urls.push(url);
        const headers = init.headers as Record<string, string>;
        expect(headers["x-api-key"]).toBe("k");
        expect(headers["anthropic-version"]).toBe("2023-06-01");
        return url.includes("/v1/")
          ? json({}, 404)
          : json({ data: [{ id: "c1", display_name: "C One" }] });
      }) as unknown as typeof fetch,
    });
    expect(urls).toEqual([
      "https://claude.example.com/v1/models?limit=1000",
      "https://claude.example.com/models?limit=1000",
    ]);
    expect(models[0]).toMatchObject({ id: "c1", label: "C One" });
  });

  it("401给出检查密钥的提示，无效地址直接拒绝", async () => {
    await expect(
      fetchRemoteModels({
        baseUrl: "https://llm.example.com/v1",
        api: "openai-completions",
        fetchImpl: (async () => json({}, 401)) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("请检查API密钥");
    await expect(
      fetchRemoteModels({ baseUrl: "ftp://x", api: "openai-completions" }),
    ).rejects.toThrow("Base URL");
  });
});

describe("自定义模型的思考档位与最大输出", () => {
  const base = {
    id: "gw",
    label: "gw",
    baseUrl: "https://llm.example.com/v1",
    api: "openai-completions" as const,
  };
  it("指定最高档时可选到xhigh/max，并保留最大输出", () => {
    const [model] = customConfig({
      ...base,
      models: [
        {
          id: "deep-thinker",
          reasoning: true,
          reasoningLevels: ["minimal", "low", "medium", "high", "xhigh", "max"],
          maxOutputTokens: 32000,
        },
      ],
    }).models;
    expect(model?.supportedReasoning).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(model?.maxOutputTokens).toBe(32000);
  });
  it("不指定档位时到high；不支持思考只有off；非法档位报错", () => {
    const config = customConfig({
      ...base,
      models: [{ id: "x-unknown-1", reasoning: true }, { id: "x-unknown-2" }],
    });
    expect(config.models[0]?.supportedReasoning).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    expect(config.models[1]?.supportedReasoning).toEqual(["off"]);
    expect(() =>
      customConfig({
        ...base,
        models: [
          {
            id: "bad",
            reasoning: true,
            reasoningLevels: ["ultra" as "max"],
          },
        ],
      }),
    ).toThrow("思考档位无效");
  });
});

describe("启用与停用服务商", () => {
  async function settings() {
    const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-enable-"));
    const projects = new ProjectService(path.join(root, "store"));
    await projects.init();
    return new ModelSettings(
      projects,
      path.join(process.cwd(), "packages/novel/agents"),
    );
  }
  it("停用后不出现在模型选择里，再启用恢复", async () => {
    const s = await settings();
    await s.addPreset("openai");
    await s.setEnabled("openai", false);
    expect((await s.view()).providers.some((p) => p.id === "openai")).toBe(
      false,
    );
    const listed = (await s.providerList()).find((p) => p.id === "openai");
    expect(listed?.enabled).toBe(false);
    await s.setEnabled("openai", true);
    expect((await s.view()).providers.some((p) => p.id === "openai")).toBe(
      true,
    );
  });
  it("仍有Agent在用时拒绝停用，并说明是谁在用", async () => {
    const s = await settings();
    await expect(s.setEnabled("deepseek", false)).rejects.toThrow(
      "正在使用该服务商",
    );
  });
});
