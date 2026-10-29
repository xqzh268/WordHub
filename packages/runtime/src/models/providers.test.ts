import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { estimateRun } from "../budget/estimate.js";
import { ProjectService } from "../projects/service.js";
import { ModelSettings } from "./settings.js";
import {
  createRuntimeModels,
  customConfig,
  listPresets,
  registerCustomProviders,
} from "./providers.js";

async function settings() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-providers-"));
  const projects = new ProjectService(path.join(root, "store"));
  await projects.init();
  return {
    root,
    projects,
    settings: new ModelSettings(
      projects,
      path.join(process.cwd(), "packages/novel/agents"),
    ),
  };
}

const gateway = {
  id: "my-gateway",
  label: "我的网关",
  baseUrl: "https://llm.example.com/v1/",
  api: "openai-completions" as const,
  models: [
    { id: "writer-1", label: "写作一号", reasoning: true },
    { id: "plain" },
  ],
};

describe("Provider预设与自定义", () => {
  it("预设来自Pi目录，包含主流服务商", () => {
    const ids = listPresets().map((item) => item.id);
    expect(ids).toEqual(
      expect.arrayContaining(["deepseek", "openai", "anthropic"]),
    );
    expect(ids).not.toContain("amazon-bedrock");
  });

  it("添加预设后模型清单来自Pi，且可在模型配置里选中", async () => {
    const { settings: s, projects } = await settings();
    await s.addPreset("openai");
    const config = await s.config();
    const openai = config.providers.find((item) => item.id === "openai");
    expect(openai?.models.length).toBeGreaterThan(0);
    expect(config.providers.some((item) => item.id === "deepseek")).toBe(true);
    // 文件里只记预设一条，不复制整份模型目录
    const saved = JSON.parse(
      await (await import("node:fs/promises")).readFile(
        path.join(projects.storageRoot, "models.json"),
        "utf8",
      ),
    ) as { providers: Array<{ id: string; models: unknown[] }> };
    expect(
      saved.providers.find((item) => item.id === "openai")?.models,
    ).toEqual([]);
    projects.close();
  });

  it("自定义Provider校验输入，注册进Pi并可解析密钥", async () => {
    expect(() => customConfig({ ...gateway, id: "OpenAI" })).toThrow();
    expect(() => customConfig({ ...gateway, id: "openai" })).toThrow("重名");
    expect(() => customConfig({ ...gateway, baseUrl: "ftp://x" })).toThrow();
    expect(() => customConfig({ ...gateway, models: [] })).toThrow();

    const { settings: s, projects } = await settings();
    await s.addCustom(gateway);
    await expect(s.addCustom(gateway)).rejects.toThrow("已存在");
    const config = await s.config();
    const entry = config.providers.find((item) => item.id === "my-gateway");
    expect(entry?.baseUrl).toBe("https://llm.example.com/v1");
    expect(entry?.models.map((item) => item.id)).toEqual(["writer-1", "plain"]);

    const models = createRuntimeModels();
    registerCustomProviders(models, config);
    const model = models.getModel("my-gateway", "writer-1");
    expect(model?.baseUrl).toBe("https://llm.example.com/v1");
    expect(model?.reasoning).toBe(true);
    expect(await models.getAuth("my-gateway")).toBeUndefined();
    process.env.MY_GATEWAY_API_KEY = "env-key";
    try {
      expect((await models.getAuth("my-gateway"))?.auth.apiKey).toBe("env-key");
    } finally {
      delete process.env.MY_GATEWAY_API_KEY;
    }
    projects.close();
  });

  it("删除Provider会清掉指向它的Agent模型设置，默认服务商不可删", async () => {
    const { settings: s, projects, root } = await settings();
    await s.addCustom(gateway);
    await s.set(
      "writer",
      { provider: "my-gateway", id: "writer-1", reasoning: "low" },
      undefined,
    );
    expect(
      (await s.view()).agents.find((item) => item.id === "writer")?.model
        .provider,
    ).toBe("my-gateway");
    await s.removeProvider("my-gateway");
    expect(
      (await s.view()).agents.find((item) => item.id === "writer")?.model
        .provider,
    ).toBe("deepseek");
    await expect(s.removeProvider("deepseek")).rejects.toThrow("不能删除");
    const models = createRuntimeModels();
    registerCustomProviders(models, await s.config());
    expect(models.getProvider("my-gateway")).toBeUndefined();
    projects.close();
    expect(root).toBeTruthy();
  });

  it("价格：用户填写按填的算；同名模型参考目录；都没有标为未知", () => {
    const config = customConfig({
      ...gateway,
      models: [
        {
          id: "mine",
          inputUsdPerMillion: 2,
          outputUsdPerMillion: 8,
          contextWindow: 32000,
        },
        { id: "deepseek-v4-pro" },
        { id: "vendor/deepseek-v4-pro" },
        { id: "mystery" },
      ],
    });
    const [mine, known, prefixed, unknown] = config.models;
    expect(mine?.pricingSource).toBe("user");
    expect(mine?.pricing.outputUsdPerMillion).toBe(8);
    expect(mine?.contextWindow).toBe(32000);
    expect(known?.pricingSource).toBe("catalog");
    expect(known?.pricing.outputUsdPerMillion).toBeGreaterThan(0);
    expect(prefixed?.pricingSource).toBe("catalog");
    expect(unknown?.pricingSource).toBe("unknown");
    expect(unknown?.pricing.outputUsdPerMillion).toBe(0);
    expect(() =>
      customConfig({
        ...gateway,
        models: [{ id: "x", inputUsdPerMillion: -1 }],
      }),
    ).toThrow("不小于0");
    expect(() =>
      customConfig({
        ...gateway,
        models: [{ id: "x", contextWindow: Number.NaN }],
      }),
    ).toThrow("正整数");
  });

  it("估算：价格未知的模型被点名，已知价格的不点名", () => {
    const config = {
      schemaVersion: 1 as const,
      defaults: { provider: "gw", id: "a", reasoning: "off" as const },
      providers: [
        customConfig({
          ...gateway,
          id: "gw",
          models: [
            { id: "a", inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
            { id: "b" },
          ],
        }),
      ],
    };
    const estimate = estimateRun(
      [
        {
          id: "t1",
          model: { provider: "gw", id: "a", reasoning: "off" },
          contextTokens: 1000,
        },
        {
          id: "t2",
          model: { provider: "gw", id: "b", reasoning: "off" },
          contextTokens: 1000,
        },
      ],
      config,
    );
    expect(estimate.unpricedModels).toEqual(["gw/b"]);
    expect(estimate.costUsd).toBeGreaterThan(0);
  });

  it("编辑自定义Provider：replace覆盖同ID，预设与默认服务商不可被覆盖", async () => {
    const { settings: s, projects } = await settings();
    await s.addCustom(gateway);
    await s.addCustom(
      { ...gateway, label: "新名字", models: [{ id: "plain" }] },
      true,
    );
    const list = await s.providerList();
    const entry = list.find((item) => item.id === "my-gateway");
    expect(entry?.label).toBe("新名字");
    expect(entry?.models?.map((item) => item.id)).toEqual(["plain"]);
    await s.addPreset("openai");
    await expect(
      s.addCustom({ ...gateway, id: "openai" }, true),
    ).rejects.toThrow();
    await expect(
      s.addCustom({ ...gateway, id: "deepseek" }, true),
    ).rejects.toThrow("已存在");
    projects.close();
  });
});
