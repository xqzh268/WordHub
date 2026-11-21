import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createAssistantMessageEventStream,
  createModels,
  type Api,
  type AssistantMessage,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";
import { WordHubStore } from "@wordhub/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { customPiProvider } from "../models/providers.js";
import { saveProjectPrefs } from "../projects/prefs.js";
import type { RunRequest } from "../runs/run-types.js";
import type { ModelConfig } from "../types.js";
import {
  budgetedStream,
  budgetForRun,
  configureRunBudget,
} from "./hard-limit.js";

const model: Model<Api> = {
  id: "flash",
  name: "Flash",
  api: "openai-completions",
  provider: "test",
  baseUrl: "http://localhost",
  input: ["text"],
  reasoning: false,
  contextWindow: 100,
  maxTokens: 100,
  cost: { input: 100, output: 200, cacheRead: 0, cacheWrite: 0 },
};
const config: ModelConfig = {
  schemaVersion: 1,
  defaults: { provider: "test", id: "flash", reasoning: "off" },
  providers: [
    {
      id: "test",
      label: "Test",
      kind: "openai-compatible",
      enabled: true,
      models: [
        {
          id: "flash",
          label: "Flash",
          contextWindow: 100,
          maxOutputTokens: 100,
          supportsReasoning: false,
          pricing: {
            inputUsdPerMillion: 100,
            outputUsdPerMillion: 200,
            cacheReadUsdPerMillion: 0,
          },
        },
      ],
    },
  ],
};
const reply = (
  output: number,
  stopReason: "stop" | "length" | "error" = "stop",
): AssistantMessage => ({
  role: "assistant",
  api: model.api,
  provider: model.provider,
  model: model.id,
  timestamp: Date.now(),
  content: [{ type: "text", text: "答" }],
  stopReason,
  usage: {
    input: 1,
    output,
    totalTokens: output + 1,
    cacheRead: 0,
    cacheWrite: 0,
    cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 },
  },
});

let root: string;
let store: WordHubStore;
let request: RunRequest;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "wordhub-budget-"));
  store = new WordHubStore(path.join(root, "db"));
  const project = store.createProject({
    name: "测试",
    folderPath: path.join(root, "project"),
  });
  const session = store.createSession({ title: "测试", projectId: project.id });
  request = {
    type: "run",
    runId: "workflow",
    prompt: "你好",
    projectId: project.id,
    projectPath: project.folderPath,
    sessionId: session.id,
  };
});
afterEach(async () => {
  store.close();
  await rm(root, { recursive: true, force: true });
});

async function enabled(amount = 0.0152) {
  await saveProjectPrefs(request.projectPath!, { runBudgetUsd: amount });
  await configureRunBudget(store, request);
  return budgetForRun(store, request)!;
}

describe("单次运行硬费用预算", () => {
  it("默认不限额，启用后续跑和子节点沿用原额度", async () => {
    await configureRunBudget(store, request);
    expect(budgetForRun(store, request)).toBeUndefined();
    await expect(
      configureRunBudget(store, { ...request, maxCostUsd: Number.NaN }),
    ).rejects.toThrow("运行预算");
    const budget = await enabled(0.0152);
    const first = budget.reserve(0.01, 0.0002, 100, "parent");
    expect(first.maxTokens).toBeLessThan(100);
    await saveProjectPrefs(request.projectPath!, { runBudgetUsd: null });

    store.close();
    store = new WordHubStore(path.join(root, "db"));
    const subtask = {
      ...request,
      resume: true,
      workflowId: request.runId,
      runId: "child",
    };
    await configureRunBudget(store, subtask);
    const restored = budgetForRun(store, subtask)!;
    expect(() => restored.reserve(0.01, 0.0002, 100, "child")).toThrow(
      "运行预算不足",
    );
  });

  it("并发子节点共用预留，结算后才归还未用额度", async () => {
    const parent = await enabled(0.0152);
    const sibling = budgetForRun(store, {
      ...request,
      workflowId: request.runId,
      runId: "parallel",
    })!;
    const pending = parent.reserve(0.01, 0.0002, 100, "first");
    expect(() => sibling.reserve(0.01, 0.0002, 100, "second")).toThrow(
      "运行预算不足",
    );
    pending.settle(0.001);
    expect(
      sibling.reserve(0.01, 0.0002, 100, "second").maxTokens,
    ).toBeGreaterThan(0);
  });

  it("无价格或无法保证上限的 API 在模型调用前拒绝", async () => {
    const budget = await enabled();
    const underlying = vi.fn<Models["streamSimple"]>();
    const models = { streamSimple: underlying } as unknown as Models;
    const stream = budgetedStream(models, config, budget);
    expect(() => stream({ ...model, id: "未知" }, { messages: [] })).toThrow(
      "模型价格未知",
    );
    expect(() =>
      stream({ ...model, api: "clandestine" as Api }, { messages: [] }),
    ).toThrow("运行预算不支持");
    expect(underlying).not.toHaveBeenCalled();
  });

  it("限制实际输出参数、关闭隐藏重试并报告预算造成的截断", async () => {
    const budget = await enabled();
    const upstream = createAssistantMessageEventStream();
    const underlying = vi.fn<Models["streamSimple"]>(() => upstream);
    const models = { streamSimple: underlying } as unknown as Models;
    const stream = budgetedStream(models, config, budget);
    const output = stream(model, { messages: [] });
    const [sentModel, , options] = underlying.mock.calls[0]!;
    expect(sentModel.maxTokens).toBeGreaterThan(0);
    expect(sentModel.maxTokens).toBeLessThan(100);
    expect(options).toMatchObject({
      maxRetries: 0,
      maxTokens: sentModel.maxTokens,
    });
    await expect(
      options!.onPayload!(
        { max_completion_tokens: sentModel.maxTokens },
        sentModel,
      ),
    ).resolves.toBeDefined();
    await expect(options!.onPayload!({}, sentModel)).rejects.toThrow(
      "已应用输出上限",
    );
    upstream.push({
      type: "done",
      reason: "length",
      message: reply(sentModel.maxTokens, "length"),
    });
    await expect(output.result()).resolves.toMatchObject({
      stopReason: "error",
      errorMessage: expect.stringContaining("任务未完成"),
    });
  });

  it("取消和异常保留本次预留，回退模型不能重复分配余额", async () => {
    const budget = await enabled();
    const upstream = createAssistantMessageEventStream();
    const underlying = vi.fn<Models["streamSimple"]>(() => upstream);
    const models = { streamSimple: underlying } as unknown as Models;
    const stream = budgetedStream(models, config, budget);
    const output = stream(model, { messages: [] });
    upstream.push({ type: "error", reason: "error", error: reply(0, "error") });
    await expect(output.result()).resolves.toMatchObject({
      stopReason: "error",
    });
    expect(() => stream(model, { messages: [] })).toThrow("运行预算不足");
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it("发现服务商实际超出预留范围时关闭账本", async () => {
    const budget = await enabled(0.05);
    const upstream = createAssistantMessageEventStream();
    const models = { streamSimple: () => upstream } as unknown as Models;
    const stream = budgetedStream(models, config, budget);
    const output = stream(model, { messages: [] });
    upstream.push({ type: "done", reason: "stop", message: reply(101) });
    await expect(output.result()).resolves.toMatchObject({
      stopReason: "error",
      errorMessage: expect.stringContaining("已停止运行"),
    });
    expect(() => stream(model, { messages: [] })).toThrow("运行预算已停止");
  });

  it.each([
    ["openai-completions", "max_completion_tokens"],
    ["openai-responses", "max_output_tokens"],
    ["anthropic-messages", "max_tokens"],
  ] as const)(
    "通过实际 Pi %s 适配器发送输出上限，5xx 只尝试一次",
    async (api, tokenField) => {
      const budget = await enabled(0.0552);
      const models = createModels();
      const entry = config.providers[0]!;
      models.setProvider(
        customPiProvider({ ...entry, api, baseUrl: "http://localhost:10/v1" }),
      );
      const nativeModel = models.getModel("test", "flash")!;
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response("{}", {
            status: 500,
            headers: { "retry-after": "0", "content-type": "application/json" },
          }),
      );
      const stream = budgetedStream(models, config, budget);
      const result = await stream(
        nativeModel,
        {
          messages: [{ role: "user", content: "嗨", timestamp: Date.now() }],
        },
        { apiKey: "unit-test", maxTokens: 25, maxRetries: 3, fetch },
      ).result();
      expect(result.stopReason).toBe("error");
      expect(fetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<
        string,
        number
      >;
      const sent = body[tokenField] ?? body.max_tokens;
      expect(sent).toBeGreaterThan(0);
      expect(sent).toBeLessThanOrEqual(25);
    },
  );
});
