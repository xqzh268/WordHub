import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
  type Models,
  type Usage,
} from "@earendil-works/pi-ai";
import { createId, timestamp, type WordHubStore } from "@wordhub/store";
import { loadProjectPrefs } from "../projects/prefs.js";
import type { RunRequest } from "../runs/run-types.js";
import type { ModelConfig } from "../types.js";

const CONFIGURED = "run.budget.configured";
const RESERVED = "run.budget.reserved";
const SETTLED = "run.budget.settled";
const STOPPED = "run.budget.stopped";
const SUPPORTED_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
]);

export class RunBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunBudgetError";
  }
}

type BudgetRun = Pick<
  RunRequest,
  "runId" | "workflowId" | "sessionId" | "projectId"
>;

function ledger(store: WordHubStore, request: BudgetRun) {
  const runId = request.workflowId ?? request.runId;
  const read = () =>
    store.listRunAuditEvents(request.projectId!, runId, "run-budget");
  const write = (
    type: string,
    payload: Record<string, unknown>,
    beforeInsert?: () => void,
    idempotencyKey?: string,
  ) =>
    store.appendEvent(
      {
        schemaVersion: 1,
        projectId: request.projectId!,
        sessionId: request.sessionId!,
        runId,
        type,
        actor: { type: "system", id: "run-budget" },
        occurredAt: timestamp(),
        visibility: "audit",
        payload,
        idempotencyKey,
      },
      beforeInsert,
    );
  return { read, write };
}

/** 新运行读取一次项目配置；子任务以及重启恢复只能使用已有账本。 */
export async function configureRunBudget(
  store: WordHubStore,
  request: RunRequest,
): Promise<void> {
  if (request.resume || request.workflowId) return;
  const explicit = request.maxCostUsd;
  if (explicit !== undefined && (!Number.isFinite(explicit) || explicit <= 0))
    throw new RunBudgetError("运行预算必须是大于 0 的有限金额（USD）");
  const preferred = request.projectPath
    ? ((await loadProjectPrefs(request.projectPath)).runBudgetUsd ?? undefined)
    : undefined;
  const limit =
    preferred === undefined || explicit === undefined
      ? (preferred ?? explicit)
      : Math.min(preferred, explicit);
  if (limit === undefined) return;
  ledger(store, request).write(
    CONFIGURED,
    { limitUsd: limit },
    undefined,
    `run:${request.runId}:budget-configured`,
  );
}

export type RunBudget = {
  reserve(
    inputCost: number,
    outputRate: number,
    requestedTokens: number,
    modelId: string,
  ): {
    maxTokens: number;
    amount: number;
    settle(charged: number): void;
    stop(reason: string): void;
  };
};

export function budgetForRun(
  store: WordHubStore,
  request: BudgetRun,
): RunBudget | undefined {
  const events = ledger(store, request);
  const config = events.read().find((event) => event.type === CONFIGURED);
  if (!config) return undefined;
  const limit = config.payload.limitUsd;
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0)
    throw new RunBudgetError("无法读取这次运行的预算，请重新发起运行");
  return {
    reserve(inputCost, outputRate, requestedTokens, modelId) {
      const reservationId = createId("budget");
      const payload = {
        reservationId,
        model: modelId,
        callerRunId: request.runId,
        maxTokens: 0,
        amountUsd: 0,
      };
      // 在写入事务内读取额度，避免不同进程恢复同一运行时重复分配余额。
      events.write(RESERVED, payload, () => {
        const reservations = new Map<string, number>();
        for (const event of events.read()) {
          if (event.type === STOPPED)
            throw new RunBudgetError("运行预算已停止，无法发起下一次模型调用");
          if (event.type !== RESERVED && event.type !== SETTLED) continue;
          const { reservationId, amountUsd } = event.payload;
          if (
            typeof reservationId !== "string" ||
            typeof amountUsd !== "number" ||
            !Number.isFinite(amountUsd) ||
            amountUsd < 0
          )
            throw new RunBudgetError(
              "无法读取这次运行的费用账本，请重新发起运行",
            );
          reservations.set(reservationId, amountUsd);
        }
        const committed = Array.from(reservations.values()).reduce(
          (sum, value) => sum + value,
          0,
        );
        const remainder = limit - committed;
        const maxTokens =
          outputRate > 0
            ? Math.min(
                requestedTokens,
                Math.floor((remainder - inputCost) / outputRate),
              )
            : requestedTokens;
        const amount = inputCost + maxTokens * outputRate;
        if (
          !Number.isSafeInteger(maxTokens) ||
          maxTokens < 1 ||
          !Number.isFinite(amount) ||
          amount < 0 ||
          amount > remainder
        )
          throw new RunBudgetError(
            `运行预算不足，无法调用 ${modelId}（上限 USD ${limit}，剩余 USD ${Math.max(0, remainder).toPrecision(4)}，输入按上下文窗口预留 USD ${inputCost.toPrecision(4)}）`,
          );
        payload.maxTokens = maxTokens;
        payload.amountUsd = amount;
      });
      return {
        maxTokens: payload.maxTokens,
        amount: payload.amountUsd,
        settle: (charged) =>
          events.write(SETTLED, {
            reservationId,
            amountUsd: charged,
            model: modelId,
            callerRunId: request.runId,
          }),
        stop: (reason) =>
          events.write(STOPPED, {
            reservationId,
            reason,
            model: modelId,
            callerRunId: request.runId,
          }),
      };
    },
  };
}

function limits(
  model: Model<Api>,
  config: ModelConfig,
  mode: RunRequest["mode"],
) {
  const modelId = `${model.provider}/${model.id}`;
  const entry = config.providers
    .find((provider) => provider.id === model.provider)
    ?.models.find((candidate) => candidate.id === model.id);
  if (!entry || entry.pricingSource === "unknown")
    throw new RunBudgetError(`运行预算已启用，模型价格未知：${modelId}`);
  if (mode !== "mock" && !SUPPORTED_APIS.has(model.api))
    throw new RunBudgetError(
      `运行预算不支持此模型的接口：${modelId} (${model.api})`,
    );
  const inputLimit = Math.max(model.contextWindow, entry.contextWindow);
  if (
    !Number.isSafeInteger(inputLimit) ||
    inputLimit < 1 ||
    !Number.isSafeInteger(model.maxTokens) ||
    model.maxTokens < 1
  )
    throw new RunBudgetError(`运行预算缺少可用的模型 Token 上限：${modelId}`);
  const rates = [model.cost, ...(model.cost.tiers ?? [])];
  const inputRate =
    Math.max(
      entry.pricing.inputUsdPerMillion,
      entry.pricing.cacheReadUsdPerMillion,
      ...rates.flatMap(({ input, cacheRead, cacheWrite }) => [
        input,
        cacheRead,
        cacheWrite,
        model.api === "anthropic-messages" ? input * 2 : 0,
      ]),
    ) / 1_000_000;
  const outputRate =
    Math.max(
      entry.pricing.outputUsdPerMillion,
      ...rates.map((rate) => rate.output),
    ) / 1_000_000;
  if (
    ![inputRate, outputRate].every((rate) => Number.isFinite(rate) && rate >= 0)
  )
    throw new RunBudgetError(`运行预算缺少可用的模型价格：${modelId}`);
  return { modelId, inputLimit, inputRate, outputRate };
}

function knownUsage(usage: Usage): boolean {
  return (
    [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].every(
      (count) => Number.isSafeInteger(count) && count >= 0,
    ) &&
    Number.isSafeInteger(usage.totalTokens) &&
    usage.totalTokens > 0 &&
    Number.isFinite(usage.cost.total) &&
    usage.cost.total >= 0
  );
}

function payloadTokenLimits(payload: unknown, api: Api): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  if (api === "openai-responses") return [data.max_output_tokens];
  if (api === "anthropic-messages") return [data.max_tokens];
  return [data.max_completion_tokens, data.max_tokens].filter(
    (cap) => cap !== undefined,
  );
}

function zeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function budgetedStream(
  models: Models,
  config: ModelConfig,
  budget: RunBudget,
  mode?: RunRequest["mode"],
): Models["streamSimple"] {
  return (model, context, options) => {
    const { modelId, inputLimit, inputRate, outputRate } = limits(
      model,
      config,
      mode,
    );
    const requestedTokens = Math.min(
      model.maxTokens,
      options?.maxTokens ?? model.maxTokens,
    );
    const reservation = budget.reserve(
      inputLimit * inputRate,
      outputRate,
      requestedTokens,
      modelId,
    );
    const { maxTokens } = reservation;
    // 关闭 SDK 重试。失败、取消或失联没有可靠账单，保守保留本次预留到运行结束。
    // 推理适配器可能以模型配置为基准上调 maxTokens，因此同时收紧模型配置和请求参数。
    const stream = models.streamSimple({ ...model, maxTokens }, context, {
      ...options,
      maxTokens,
      maxRetries: 0,
      async onPayload(payload, sentModel) {
        const prepared =
          (await options?.onPayload?.(payload, sentModel)) ?? payload;
        const caps = payloadTokenLimits(prepared, model.api);
        if (
          mode !== "mock" &&
          (!caps.length ||
            caps.some(
              (cap) =>
                typeof cap !== "number" ||
                !Number.isSafeInteger(cap) ||
                cap < 1 ||
                cap > maxTokens,
            ))
        )
          throw new RunBudgetError(
            `运行预算无法确认 ${modelId} 已应用输出上限`,
          );
        return prepared;
      },
    });
    const wrapped = createAssistantMessageEventStream();
    const failure = (errorMessage: string, reply?: AssistantMessage) => {
      const error: AssistantMessage = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        content: [],
        usage: zeroUsage(),
        ...reply,
        stopReason: "error",
        errorMessage,
      };
      wrapped.push({ type: "error", reason: "error", error });
    };
    const settle = (reply: AssistantMessage): string | undefined => {
      if (
        !["stop", "length", "toolUse"].includes(reply.stopReason) ||
        !knownUsage(reply.usage)
      )
        return undefined;
      const usage = reply.usage;
      const input = usage.input + usage.cacheRead + usage.cacheWrite;
      const charged = Math.max(
        usage.cost.total,
        input * inputRate + usage.output * outputRate,
      );
      if (
        input > inputLimit ||
        usage.output > maxTokens ||
        charged > reservation.amount
      ) {
        const message = `运行预算无法确认 ${modelId} 遵守请求上限，已停止运行`;
        reservation.stop(message);
        reservation.settle(charged);
        return message;
      }
      reservation.settle(charged);
      return undefined;
    };
    void (async () => {
      try {
        for await (const event of stream) {
          if (event.type === "done") {
            const overrun = settle(event.message);
            if (overrun) {
              failure(overrun, event.message);
              return;
            }
            if (event.reason === "length") {
              failure(
                maxTokens < requestedTokens
                  ? "运行预算限制了本次模型输出，任务未完成"
                  : "模型达到输出上限，任务未完成",
                event.message,
              );
              return;
            }
          }
          wrapped.push(event);
          if (event.type === "done" || event.type === "error") return;
        }
        failure("运行预算无法确认模型请求已结束，已保留这次预留额度");
      } catch (error) {
        failure(error instanceof Error ? error.message : String(error));
      } finally {
        wrapped.end();
      }
    })();
    return wrapped;
  };
}
