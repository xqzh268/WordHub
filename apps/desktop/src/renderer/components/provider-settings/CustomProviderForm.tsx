import { useState } from "react";
import { cleanIpcError } from "../../lib/errors";
import {
  EMPTY_ROW,
  mergeRemoteRows,
  type ModelRow,
  toInputModels,
  toRows,
} from "./model-draft";
import { ProviderModelRows } from "./ProviderModelRows";
import { RemoteModelDiscovery } from "./RemoteModelDiscovery";
import type { CustomInput, ProviderItem } from "./types";

const API_LABELS: Record<CustomInput["api"], string> = {
  "openai-completions": "OpenAI 兼容（Chat Completions）",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
};

function createDraft(provider?: ProviderItem) {
  return {
    id: provider?.id ?? "",
    label: provider?.label ?? "",
    baseUrl: provider?.baseUrl ?? "",
    api: (provider?.api as CustomInput["api"]) ?? "openai-completions",
    apiKey: "",
    models: provider?.models?.length
      ? toRows(provider.models)
      : [{ ...EMPTY_ROW }],
  };
}

export function CustomProviderForm({
  provider,
  encryption,
  onSaved,
  setError,
}: {
  provider?: ProviderItem;
  encryption: boolean;
  onSaved: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const [custom, setCustom] = useState(() => createDraft(provider));
  const editing = provider !== undefined;

  const changeRows = (update: (rows: ModelRow[]) => ModelRow[]) =>
    setCustom((current) => ({ ...current, models: update(current.models) }));

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
      // 表单里填的密钥一并加密保存，省去再到上方填一次。
      if (custom.apiKey.trim() && encryption)
        await window.wordhub?.invoke("settings.setCredential", {
          provider: custom.id.trim(),
          secret: custom.apiKey.trim(),
        });
      await onSaved();
    } catch (cause) {
      setError(cleanIpcError(cause));
    }
  };

  return (
    <div
      data-testid="custom-provider-form"
      style={{ marginTop: 12, display: "grid", gap: 8 }}
    >
      <input
        className="text-input mono"
        value={custom.id}
        disabled={editing}
        onChange={(event) => setCustom({ ...custom, id: event.target.value })}
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

      <RemoteModelDiscovery
        connection={custom}
        providerId={provider?.id}
        rows={custom.models}
        onApiKeyChange={(apiKey) =>
          setCustom((current) => ({ ...current, apiKey }))
        }
        onPicked={(models) =>
          changeRows((rows) => mergeRemoteRows(rows, models))
        }
        setError={setError}
      />
      <ProviderModelRows rows={custom.models} onChange={changeRows} />
      <p className="section-note">
        价格不填时，会先按模型 ID 在 Pi
        目录里找同名模型作参考；找不到就标为“价格未知”，运行前估算会明确提示费用未计入。思考选“自动”时沿用目录同名模型的档位，找不到则最高到
        high。
      </p>
      <div>
        <button className="btn btn-primary" onClick={() => void saveCustom()}>
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
  );
}
