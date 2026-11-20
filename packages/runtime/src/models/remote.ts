import type { CustomProviderApi, ReasoningLevel } from "../types.js";
import { catalogMatch } from "./providers.js";

/** 从服务商 /models 接口拿到的模型，已尽量用接口数据或Pi目录同名模型补全能力与价格。 */
export type RemoteModel = {
  id: string;
  label: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  reasoning: boolean;
  supportedReasoning?: ReasoningLevel[];
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  cacheReadUsdPerMillion?: number;
  /** 能力与价格的来源：接口返回 / Pi目录同名模型 / 未知。 */
  source: "remote" | "catalog" | "unknown";
};

const toNumber = (value: unknown): number | undefined => {
  const number =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number)
    ? number
    : undefined;
};
const positiveInt = (value: unknown): number | undefined => {
  const number = toNumber(value);
  return number !== undefined && Number.isInteger(number) && number > 0
    ? number
    : undefined;
};
/** OpenRouter等返回每token美元价格（常为字符串），换算成每百万token。负数（如-1表示可变价）视为未知。 */
const perMillion = (value: unknown): number | undefined => {
  const number = toNumber(value);
  return number !== undefined && number >= 0
    ? Math.round(number * 1_000_000 * 1e6) / 1e6
    : undefined;
};

/** 解析 /models 返回；兼容OpenAI、OpenRouter与Anthropic的列表格式。 */
export function parseRemoteModels(body: unknown): RemoteModel[] {
  const data =
    body && typeof body === "object"
      ? (body as { data?: unknown; models?: unknown })
      : {};
  const list = Array.isArray(body)
    ? body
    : Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.models)
        ? data.models
        : undefined;
  if (!list) throw new Error("接口返回的不是模型列表");
  const seen = new Set<string>();
  const result: RemoteModel[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const pricing = (raw.pricing ?? {}) as Record<string, unknown>;
    const top = (raw.top_provider ?? {}) as Record<string, unknown>;
    const params = Array.isArray(raw.supported_parameters)
      ? (raw.supported_parameters as unknown[])
      : undefined;
    const contextWindow =
      positiveInt(raw.context_length) ??
      positiveInt(raw.context_window) ??
      positiveInt(raw.max_input_tokens);
    const maxOutputTokens =
      positiveInt(top.max_completion_tokens) ??
      positiveInt(raw.max_output_tokens) ??
      positiveInt(raw.max_tokens);
    const input = perMillion(pricing.prompt);
    const output = perMillion(pricing.completion);
    const matched = catalogMatch(id);
    const label =
      (typeof raw.display_name === "string" && raw.display_name.trim()) ||
      (typeof raw.name === "string" && raw.name.trim()) ||
      matched?.label ||
      id;
    const remotePrice = input !== undefined || output !== undefined;
    const reasoning = params
      ? params.includes("reasoning") || params.includes("include_reasoning")
      : (matched?.supportsReasoning ?? false);
    result.push({
      id,
      label,
      contextWindow: contextWindow ?? matched?.contextWindow,
      maxOutputTokens: maxOutputTokens ?? matched?.maxOutputTokens,
      reasoning,
      supportedReasoning:
        reasoning && matched?.supportsReasoning
          ? matched.supportedReasoning
          : undefined,
      ...(remotePrice
        ? {
            inputUsdPerMillion: input,
            outputUsdPerMillion: output,
            cacheReadUsdPerMillion: perMillion(pricing.input_cache_read),
          }
        : matched
          ? {
              inputUsdPerMillion: matched.pricing.inputUsdPerMillion,
              outputUsdPerMillion: matched.pricing.outputUsdPerMillion,
              cacheReadUsdPerMillion: matched.pricing.cacheReadUsdPerMillion,
            }
          : {}),
      source:
        remotePrice || contextWindow
          ? "remote"
          : matched
            ? "catalog"
            : "unknown",
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

/** 向服务商的 /models 接口请求模型列表。Anthropic协议的Base URL通常不含/v1，两种路径都会尝试。 */
export async function fetchRemoteModels(input: {
  baseUrl: string;
  api: CustomProviderApi;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<RemoteModel[]> {
  let base: string;
  try {
    const url = new URL(input.baseUrl.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error();
    base = url.toString().replace(/\/+$/u, "");
  } catch {
    throw new Error("Base URL必须是有效的http(s)地址");
  }
  const anthropic = input.api === "anthropic-messages";
  const headers: Record<string, string> = { accept: "application/json" };
  if (input.apiKey) {
    headers.authorization = `Bearer ${input.apiKey}`;
    if (anthropic) headers["x-api-key"] = input.apiKey;
  }
  if (anthropic) headers["anthropic-version"] = "2023-06-01";
  const urls = anthropic
    ? /\/v1$/u.test(base)
      ? [`${base}/models?limit=1000`]
      : [`${base}/v1/models?limit=1000`, `${base}/models?limit=1000`]
    : [`${base}/models`];
  const doFetch = input.fetchImpl ?? fetch;
  let notFound = "";
  for (const url of urls) {
    let response: Response;
    try {
      response = await doFetch(url, {
        headers,
        signal: AbortSignal.timeout(input.timeoutMs ?? 15000),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new Error(
        name === "TimeoutError" || name === "AbortError"
          ? "请求模型列表超时，请检查Base URL和网络"
          : `无法连接服务商：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (response.status === 401 || response.status === 403)
      throw new Error(
        `服务商拒绝了请求（HTTP ${response.status}），请检查API密钥`,
      );
    if (response.status === 404) {
      notFound = url.replace(/\?.*$/u, "");
      continue;
    }
    if (!response.ok)
      throw new Error(`获取模型列表失败（HTTP ${response.status}）`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error("接口返回的不是JSON，请检查Base URL是否指向API地址");
    }
    return parseRemoteModels(body);
  }
  throw new Error(
    `接口不存在（HTTP 404）：${notFound}。该服务商可能不提供模型列表，请手动填写模型ID`,
  );
}
