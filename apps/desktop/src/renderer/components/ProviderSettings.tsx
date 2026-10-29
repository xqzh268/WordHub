import { useCallback, useEffect, useState } from "react";
import type { CommandPayloads, CommandResults } from "@wordhub/contracts";

type ProviderList = CommandResults["settings.providers"];
type ProviderItem = ProviderList["providers"][number];
type ModelList = CommandResults["settings.models"];
type CustomInput = NonNullable<
  CommandPayloads["settings.addProvider"]["custom"]
>;

const API_LABELS: Record<CustomInput["api"], string> = {
  "openai-completions": "OpenAI 兼容（Chat Completions）",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
};

type ModelRow = {
  id: string;
  label: string;
  contextWindow: string;
  input: string;
  output: string;
  reasoning: boolean;
};
const EMPTY_ROW: ModelRow = {
  id: "",
  label: "",
  contextWindow: "",
  input: "",
  output: "",
  reasoning: false,
};
const EMPTY_CUSTOM = {
  id: "",
  label: "",
  baseUrl: "",
  api: "openai-completions" as CustomInput["api"],
  models: [{ ...EMPTY_ROW }] as ModelRow[],
};

const PRICING_TEXT = {
  user: "价格为你填写的",
  catalog: "价格参考 Pi 目录中的同名模型",
  unknown: "价格未知，费用不计入估算",
} as const;

/** 空白视为未填；非数字会变成 NaN，由后端校验报错，不静默当成 0。 */
const optionalNumber = (text: string): number | undefined =>
  text.trim() === "" ? undefined : Number(text);

function toInputModels(rows: ModelRow[]): CustomInput["models"] {
  return rows
    .filter((row) => row.id.trim() || row.label.trim())
    .map((row) => ({
      id: row.id.trim(),
      label: row.label.trim() || undefined,
      reasoning: row.reasoning,
      contextWindow: optionalNumber(row.contextWindow),
      inputUsdPerMillion: optionalNumber(row.input),
      outputUsdPerMillion: optionalNumber(row.output),
    }));
}

/** 编辑时把已保存的模型还原成表单行；来自目录的价格不回填，保存时会再次匹配目录。 */
function toRows(models: NonNullable<ProviderItem["models"]>): ModelRow[] {
  return models.map((model) => ({
    id: model.id,
    label: model.label === model.id ? "" : model.label,
    contextWindow: String(model.contextWindow),
    input:
      model.pricingSource === "user"
        ? String(model.pricing.inputUsdPerMillion)
        : "",
    output:
      model.pricingSource === "user"
        ? String(model.pricing.outputUsdPerMillion)
        : "",
    reasoning: model.supportsReasoning,
  }));
}

export function ProviderSettings({
  onChanged,
}: {
  /** 增删Provider后通知外层刷新模型下拉。 */
  onChanged: () => void;
}) {
  const [data, setData] = useState<ProviderList | null>(null);
  const [catalog, setCatalog] = useState<ModelList["providers"]>([]);
  const [encryption, setEncryption] = useState(true);
  const [message, setMessage] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [testModel, setTestModel] = useState<Record<string, string>>({});
  const [preset, setPreset] = useState("");
  const [custom, setCustom] = useState(EMPTY_CUSTOM);
  const [editing, setEditing] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const [providers, status, models] = await Promise.all([
      window.wordhub?.invoke("settings.providers", undefined),
      window.wordhub?.invoke("settings.credentialStatus", undefined),
      window.wordhub?.invoke("settings.models", undefined),
    ]);
    if (providers) setData(providers);
    if (status) setEncryption(status.encryptionAvailable);
    if (models) setCatalog(models.providers);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const note = (id: string, text: string) =>
    setMessage((current) => ({ ...current, [id]: text }));
  const changed = async () => {
    await refresh();
    onChanged();
  };
  const fail = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : String(cause));

  const saveSecret = async (id: string) => {
    const secret = secrets[id]?.trim();
    if (!secret) return;
    try {
      await window.wordhub?.invoke("settings.setCredential", {
        provider: id,
        secret,
      });
      setSecrets((current) => ({ ...current, [id]: "" }));
      note(id, "密钥已加密保存");
      await refresh();
    } catch (cause) {
      note(id, cause instanceof Error ? cause.message : String(cause));
    }
  };
  const removeSecret = async (id: string) => {
    await window.wordhub?.invoke("settings.deleteCredential", { provider: id });
    note(id, "已删除保存的密钥");
    await refresh();
  };
  const test = async (id: string) => {
    note(id, "测试中…");
    const result = await window.wordhub?.invoke("settings.testConnection", {
      provider: id,
      model: testModel[id] || undefined,
    });
    note(id, result?.message ?? "");
  };
  const removeProvider = async (id: string) => {
    try {
      await window.wordhub?.invoke("settings.removeProvider", { id });
      await window.wordhub?.invoke("settings.deleteCredential", {
        provider: id,
      });
      await changed();
    } catch (cause) {
      fail(cause);
    }
  };
  const addPreset = async () => {
    if (!preset) return;
    try {
      setError("");
      await window.wordhub?.invoke("settings.addProvider", { preset });
      setPreset("");
      await changed();
    } catch (cause) {
      fail(cause);
    }
  };
  const saveCustom = async () => {
    try {
      setError("");
      await window.wordhub?.invoke("settings.addProvider", {
        custom: {
          id: custom.id.trim(),
          label: custom.label.trim(),
          baseUrl: custom.baseUrl.trim(),
          api: custom.api,
          models: toInputModels(custom.models),
        },
        replace: editing,
      });
      setCustom(EMPTY_CUSTOM);
      setEditing(false);
      setShowCustom(false);
      await changed();
    } catch (cause) {
      fail(cause);
    }
  };
  const startEdit = (provider: ProviderItem) => {
    setError("");
    setEditing(true);
    setShowCustom(true);
    setCustom({
      id: provider.id,
      label: provider.label,
      baseUrl: provider.baseUrl ?? "",
      api: (provider.api as CustomInput["api"]) ?? "openai-completions",
      models: provider.models?.length
        ? toRows(provider.models)
        : [{ ...EMPTY_ROW }],
    });
  };
  const closeCustom = () => {
    setShowCustom(false);
    setEditing(false);
    setCustom(EMPTY_CUSTOM);
    setError("");
  };
  const patchRow = (index: number, patch: Partial<ModelRow>) =>
    setCustom((current) => ({
      ...current,
      models: current.models.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    }));

  const sourceText = (auth: { configured: boolean; source?: string }) =>
    !auth.configured
      ? "尚未配置密钥"
      : auth.source === "stored credential"
        ? "密钥已加密保存"
        : `使用环境变量 ${auth.source ?? ""}`;
  const available = data?.presets.filter((item) => !item.added) ?? [];
  const unpriced = (provider: ProviderItem) =>
    provider.models?.filter((model) => model.pricingSource === "unknown") ?? [];

  return (
    <section className="panel-section" data-testid="provider-settings">
      <h2>服务商与密钥</h2>
      <p className="section-note">
        预设来自 Pi
        内置的服务商目录，也可添加任意兼容的自定义服务商。密钥用系统安全存储加密，不写入项目文件。
        {!encryption && "（当前系统的安全存储不可用，无法保存密钥。）"}
      </p>
      {data?.providers.map((provider) => {
        const models =
          catalog.find((item) => item.id === provider.id)?.models ?? [];
        return (
          <div
            className="field"
            key={provider.id}
            data-testid={`provider-${provider.id}`}
          >
            <div className="field-label">
              <strong>{provider.label}</strong>
              <span>
                {provider.userDefined ? "自定义" : "预设"} ·{" "}
                {provider.modelCount} 个模型
                {provider.baseUrl ? ` · ${provider.baseUrl}` : ""}
              </span>
              <span>{sourceText(provider.auth)}</span>
              {unpriced(provider).length > 0 && (
                <span data-testid={`unpriced-${provider.id}`}>
                  价格未知：
                  {unpriced(provider)
                    .map((m) => m.id)
                    .join("、")}
                  （费用不计入估算，可点“编辑”填写）
                </span>
              )}
            </div>
            <div>
              <div className="credential-row" style={{ marginTop: 0 }}>
                <input
                  className="text-input mono"
                  type="password"
                  value={secrets[provider.id] ?? ""}
                  onChange={(event) =>
                    setSecrets((current) => ({
                      ...current,
                      [provider.id]: event.target.value,
                    }))
                  }
                  placeholder="输入API key，不会回显"
                  aria-label={`${provider.label} API key`}
                />
                <button
                  className="btn btn-primary"
                  disabled={!secrets[provider.id]?.trim() || !encryption}
                  onClick={() => void saveSecret(provider.id)}
                >
                  保存
                </button>
                {models.length > 1 && (
                  <select
                    className="text-input"
                    value={testModel[provider.id] ?? ""}
                    onChange={(event) =>
                      setTestModel((current) => ({
                        ...current,
                        [provider.id]: event.target.value,
                      }))
                    }
                    aria-label={`${provider.label}测试用模型`}
                  >
                    <option value="">测试用模型：自动选最便宜</option>
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                )}
                <button className="btn" onClick={() => void test(provider.id)}>
                  测试连接
                </button>
                {provider.userDefined && (
                  <button
                    className="btn"
                    onClick={() => startEdit(provider)}
                    aria-label={`编辑${provider.label}`}
                  >
                    编辑
                  </button>
                )}
                {provider.removable && (
                  <button
                    className="btn"
                    onClick={() => void removeProvider(provider.id)}
                  >
                    移除
                  </button>
                )}
              </div>
              {provider.auth.source === "stored credential" && (
                <button
                  className="btn"
                  style={{ marginTop: 8 }}
                  onClick={() => void removeSecret(provider.id)}
                >
                  删除已保存的密钥
                </button>
              )}
              {message[provider.id] && (
                <p className="section-note">{message[provider.id]}</p>
              )}
            </div>
          </div>
        );
      })}

      <div className="field">
        <div className="field-label">
          <strong>添加服务商</strong>
          <span>从预设选择，或自行填写接口地址。</span>
        </div>
        <div>
          <div className="credential-row" style={{ marginTop: 0 }}>
            <select
              className="text-input"
              value={preset}
              onChange={(event) => setPreset(event.target.value)}
              aria-label="选择预设服务商"
            >
              <option value="">选择预设服务商…</option>
              {available.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}（{item.modelCount} 个模型）
                </option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              disabled={!preset}
              onClick={() => void addPreset()}
            >
              添加
            </button>
            <button
              className="btn"
              onClick={() => (showCustom ? closeCustom() : setShowCustom(true))}
            >
              {showCustom ? "收起自定义" : "自定义…"}
            </button>
          </div>
          {showCustom && (
            <div
              data-testid="custom-provider-form"
              style={{ marginTop: 12, display: "grid", gap: 8 }}
            >
              <input
                className="text-input mono"
                value={custom.id}
                disabled={editing}
                onChange={(event) =>
                  setCustom({ ...custom, id: event.target.value })
                }
                placeholder="ID（小写字母、数字、连字符，如 my-gateway）"
                aria-label="Provider ID"
              />
              <input
                className="text-input"
                value={custom.label}
                onChange={(event) =>
                  setCustom({ ...custom, label: event.target.value })
                }
                placeholder="显示名称"
                aria-label="Provider 名称"
              />
              <input
                className="text-input mono"
                value={custom.baseUrl}
                onChange={(event) =>
                  setCustom({ ...custom, baseUrl: event.target.value })
                }
                placeholder="Base URL，如 https://api.example.com/v1"
                aria-label="Base URL"
              />
              <select
                className="text-input"
                value={custom.api}
                onChange={(event) =>
                  setCustom({
                    ...custom,
                    api: event.target.value as CustomInput["api"],
                  })
                }
                aria-label="接口协议"
              >
                {Object.entries(API_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {custom.models.map((row, index) => (
                <div
                  key={index}
                  className="credential-row"
                  style={{ marginTop: 0, flexWrap: "wrap" }}
                  data-testid={`model-row-${index}`}
                >
                  <input
                    className="text-input mono"
                    value={row.id}
                    onChange={(event) =>
                      patchRow(index, { id: event.target.value })
                    }
                    placeholder="模型ID"
                    aria-label={`模型ID-${index}`}
                  />
                  <input
                    className="text-input"
                    value={row.label}
                    onChange={(event) =>
                      patchRow(index, { label: event.target.value })
                    }
                    placeholder="显示名（可空）"
                    aria-label={`显示名-${index}`}
                  />
                  <input
                    className="text-input mono"
                    value={row.contextWindow}
                    onChange={(event) =>
                      patchRow(index, { contextWindow: event.target.value })
                    }
                    placeholder="上下文长度（默认128000）"
                    aria-label={`上下文长度-${index}`}
                  />
                  <input
                    className="text-input mono"
                    value={row.input}
                    onChange={(event) =>
                      patchRow(index, { input: event.target.value })
                    }
                    placeholder="输入价 $/百万token"
                    aria-label={`输入价格-${index}`}
                  />
                  <input
                    className="text-input mono"
                    value={row.output}
                    onChange={(event) =>
                      patchRow(index, { output: event.target.value })
                    }
                    placeholder="输出价 $/百万token"
                    aria-label={`输出价格-${index}`}
                  />
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={row.reasoning}
                      onChange={(event) =>
                        patchRow(index, { reasoning: event.target.checked })
                      }
                      aria-label={`支持思考-${index}`}
                    />
                    <span>思考</span>
                  </label>
                  <button
                    className="btn"
                    disabled={custom.models.length === 1}
                    onClick={() =>
                      setCustom((current) => ({
                        ...current,
                        models: current.models.filter((_, i) => i !== index),
                      }))
                    }
                    aria-label={`删除模型行-${index}`}
                  >
                    删除
                  </button>
                </div>
              ))}
              <div>
                <button
                  className="btn"
                  onClick={() =>
                    setCustom((current) => ({
                      ...current,
                      models: [...current.models, { ...EMPTY_ROW }],
                    }))
                  }
                >
                  添加模型行
                </button>
              </div>
              <p className="section-note">
                价格不填时，会先按模型 ID 在 Pi
                目录里找同名模型作参考；找不到就标为“价格未知”，运行前估算会明确提示费用未计入。
              </p>
              <div>
                <button
                  className="btn btn-primary"
                  onClick={() => void saveCustom()}
                >
                  {editing ? "保存修改" : "添加自定义服务商"}
                </button>
              </div>
              <p className="section-note">
                {editing ? "已保存的密钥保持不变。" : "添加后在上方填入密钥；"}
                也可设置环境变量{" "}
                {custom.id
                  ? `${custom.id.toUpperCase().replaceAll("-", "_")}_API_KEY`
                  : "<ID>_API_KEY"}
                。
              </p>
            </div>
          )}
          {error && (
            <p className="section-note" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
