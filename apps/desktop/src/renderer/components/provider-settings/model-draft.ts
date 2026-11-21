import type { CustomInput, ProviderItem, RemoteModel } from "./types";

/** 思考档位从低到高；“最高档”决定该模型可选的思考强度范围。 */
const THINK_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
type ThinkLevel = (typeof THINK_LEVELS)[number];
/** none=不支持思考；auto=沿用Pi目录同名模型的档位，匹配不到则到high。 */
export type ThinkSetting = "none" | "auto" | ThinkLevel;

export type ModelRow = {
  id: string;
  label: string;
  contextWindow: string;
  maxOutput: string;
  input: string;
  output: string;
  think: ThinkSetting;
};
export const EMPTY_ROW: ModelRow = {
  id: "",
  label: "",
  contextWindow: "",
  maxOutput: "",
  input: "",
  output: "",
  think: "none",
};
const isBlankRow = (row: ModelRow) => !row.id.trim() && !row.label.trim();

/** 空白视为未填；非数字会变成 NaN，由后端校验报错，不静默当成 0。 */
const optionalNumber = (text: string): number | undefined =>
  text.trim() === "" ? undefined : Number(text);

export function toInputModels(rows: ModelRow[]): CustomInput["models"] {
  return rows
    .filter((row) => !isBlankRow(row))
    .map((row) => ({
      id: row.id.trim(),
      label: row.label.trim() || undefined,
      reasoning: row.think !== "none",
      reasoningLevels:
        row.think === "none" || row.think === "auto"
          ? undefined
          : [...THINK_LEVELS.slice(0, THINK_LEVELS.indexOf(row.think) + 1)],
      contextWindow: optionalNumber(row.contextWindow),
      maxOutputTokens: optionalNumber(row.maxOutput),
      inputUsdPerMillion: optionalNumber(row.input),
      outputUsdPerMillion: optionalNumber(row.output),
    }));
}

/** 编辑时把已保存的模型还原成表单行；来自目录的价格不回填，保存时会再次匹配目录。 */
export function toRows(
  models: NonNullable<ProviderItem["models"]>,
): ModelRow[] {
  return models.map((model) => ({
    id: model.id,
    label: model.label === model.id ? "" : model.label,
    contextWindow: String(model.contextWindow),
    maxOutput: model.maxOutputTokens ? String(model.maxOutputTokens) : "",
    input:
      model.pricingSource === "user"
        ? String(model.pricing.inputUsdPerMillion)
        : "",
    output:
      model.pricingSource === "user"
        ? String(model.pricing.outputUsdPerMillion)
        : "",
    think: !model.supportsReasoning
      ? "none"
      : highestLevel(model.supportedReasoning),
  }));
}

/**
 * 档位是从 minimal 起连续的一段时，记成“最高某档”；否则（如 DeepSeek 的 off/low/high/max）
 * 记成“自动”，保存时由后端沿用目录里的准确档位，不凭空补出服务商不支持的档。
 */
function highestLevel(levels?: string[]): ThinkSetting {
  const found = [...THINK_LEVELS]
    .reverse()
    .find((level) => levels?.includes(level));
  if (!found) return "auto";
  const expected = THINK_LEVELS.slice(0, THINK_LEVELS.indexOf(found) + 1);
  const actual = (levels ?? []).filter((level) => level !== "off");
  return actual.length === expected.length &&
    expected.every((level) => actual.includes(level))
    ? found
    : "auto";
}

/** 接口返回的模型转成表单行；只回填接口给出的价格，目录同名价格保存时自动匹配。 */
function remoteRow(model: RemoteModel): ModelRow {
  const fromRemote = model.source === "remote";
  return {
    id: model.id,
    label: model.label === model.id ? "" : model.label,
    contextWindow: model.contextWindow ? String(model.contextWindow) : "",
    maxOutput: model.maxOutputTokens ? String(model.maxOutputTokens) : "",
    input:
      fromRemote && model.inputUsdPerMillion !== undefined
        ? String(model.inputUsdPerMillion)
        : "",
    output:
      fromRemote && model.outputUsdPerMillion !== undefined
        ? String(model.outputUsdPerMillion)
        : "",
    think: !model.reasoning
      ? "none"
      : model.supportedReasoning
        ? highestLevel(model.supportedReasoning)
        : "auto",
  };
}

export function mergeRemoteRows(
  rows: ModelRow[],
  picked: RemoteModel[],
): ModelRow[] {
  const kept = rows.filter((row) => !isBlankRow(row));
  const existing = new Set(kept.map((row) => row.id.trim()));
  const added = picked
    .filter((model) => !existing.has(model.id))
    .map(remoteRow);
  const models = [...kept, ...added];
  return models.length ? models : [{ ...EMPTY_ROW }];
}
