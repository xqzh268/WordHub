import type { CommandResults } from "@wordhub/contracts";
import { useState } from "react";
import { cleanIpcError } from "../../lib/errors";
import type { ProviderItem } from "./types";

function sourceText(auth: ProviderItem["auth"]) {
  if (!auth.configured) return "尚未配置密钥";
  if (auth.source === "stored credential") return "密钥已加密保存";
  return `使用环境变量 ${auth.source ?? ""}`;
}

export function ProviderEntries({
  providers,
  catalog,
  encryption,
  onRefresh,
  onChanged,
  onEdit,
  onError,
}: {
  providers: ProviderItem[];
  catalog: CommandResults["settings.models"]["providers"];
  encryption: boolean;
  onRefresh: () => Promise<void>;
  onChanged: () => Promise<void>;
  onEdit: (provider: ProviderItem) => void;
  onError: (cause: unknown) => void;
}) {
  const [message, setMessage] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [testModel, setTestModel] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState("");

  const note = (id: string, text: string) =>
    setMessage((current) => ({ ...current, [id]: text }));
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
      await onRefresh();
    } catch (cause) {
      note(id, cleanIpcError(cause));
    }
  };
  const removeSecret = async (id: string) => {
    await window.wordhub?.invoke("settings.deleteCredential", { provider: id });
    note(id, "已删除保存的密钥");
    await onRefresh();
  };
  const test = async (id: string) => {
    note(id, "测试中…");
    const result = await window.wordhub?.invoke("settings.testConnection", {
      provider: id,
      model: testModel[id] || undefined,
    });
    note(id, result?.message ?? "");
  };
  const toggleEnabled = async (id: string, enabled: boolean) => {
    try {
      await window.wordhub?.invoke("settings.setProviderEnabled", {
        id,
        enabled,
      });
      note(id, enabled ? "已启用" : "已停用，模型不再出现在选择列表中");
      await onChanged();
    } catch (cause) {
      note(id, cleanIpcError(cause));
    }
  };
  const removeProvider = async (id: string) => {
    setConfirmRemove("");
    try {
      await window.wordhub?.invoke("settings.removeProvider", { id });
      await window.wordhub?.invoke("settings.deleteCredential", {
        provider: id,
      });
      await onChanged();
    } catch (cause) {
      onError(cause);
    }
  };

  return providers.map((provider) => {
    const models =
      catalog.find((item) => item.id === provider.id)?.models ?? [];
    const unpriced =
      provider.models?.filter((model) => model.pricingSource === "unknown") ??
      [];
    return (
      <div
        className="field"
        key={provider.id}
        data-testid={`provider-${provider.id}`}
      >
        <div className="field-label">
          <strong>{provider.label}</strong>
          <span>
            {provider.enabled ? "" : "已停用 · "}
            {provider.userDefined ? "自定义" : "预设"} · {provider.modelCount}{" "}
            个模型
            {provider.baseUrl ? ` · ${provider.baseUrl}` : ""}
          </span>
          <span>{sourceText(provider.auth)}</span>
          {unpriced.length > 0 && (
            <span data-testid={`unpriced-${provider.id}`}>
              价格未知：
              {unpriced.map((m) => m.id).join("、")}
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
                onClick={() => onEdit(provider)}
                aria-label={`编辑${provider.label}`}
              >
                编辑
              </button>
            )}
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={provider.enabled}
                onChange={(event) =>
                  void toggleEnabled(provider.id, event.target.checked)
                }
                aria-label={`启用${provider.label}`}
              />
              <span>启用</span>
            </label>
            {provider.removable &&
              (confirmRemove === provider.id ? (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={() => void removeProvider(provider.id)}
                  >
                    确认移除（同时删除密钥）
                  </button>
                  <button className="btn" onClick={() => setConfirmRemove("")}>
                    取消
                  </button>
                </>
              ) : (
                <button
                  className="btn"
                  onClick={() => setConfirmRemove(provider.id)}
                >
                  移除
                </button>
              ))}
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
  });
}
