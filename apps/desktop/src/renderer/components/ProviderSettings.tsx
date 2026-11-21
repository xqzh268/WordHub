import type { CommandResults } from "@wordhub/contracts";
import { useCallback, useEffect, useState } from "react";
import { cleanIpcError } from "../lib/errors";
import { CustomProviderForm } from "./provider-settings/CustomProviderForm";
import { ProviderEntries } from "./provider-settings/ProviderEntries";
import type { ProviderItem, ProviderList } from "./provider-settings/types";

type ProviderFormSession = { key: number; provider?: ProviderItem };

export function ProviderSettings({
  onChanged,
}: {
  /** 服务商变更后通知外层刷新模型列表。 */
  onChanged: () => void;
}) {
  const [data, setData] = useState<ProviderList | null>(null);
  const [catalog, setCatalog] = useState<
    CommandResults["settings.models"]["providers"]
  >([]);
  const [encryption, setEncryption] = useState(true);
  const [preset, setPreset] = useState("");
  const [form, setForm] = useState<ProviderFormSession | null>(null);
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

  const changed = async () => {
    await refresh();
    onChanged();
  };
  const fail = (cause: unknown) => setError(cleanIpcError(cause));

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

  const startEdit = (provider: ProviderItem) => {
    setError("");
    setForm((current) => ({ key: (current?.key ?? 0) + 1, provider }));
  };
  const toggleCustom = () => {
    if (form) {
      setForm(null);
      setError("");
    } else {
      setForm({ key: 1 });
    }
  };
  const available = data?.presets.filter((item) => !item.added) ?? [];

  return (
    <section className="panel-section" data-testid="provider-settings">
      <h2>服务商与密钥</h2>
      <p className="section-note">
        预设来自 Pi
        内置的服务商目录，也可添加任意兼容的自定义服务商。密钥用系统安全存储加密，不写入项目文件。
        {!encryption && "（当前系统的安全存储不可用，无法保存密钥。）"}
      </p>

      <ProviderEntries
        providers={data?.providers ?? []}
        catalog={catalog}
        encryption={encryption}
        onRefresh={refresh}
        onChanged={changed}
        onEdit={startEdit}
        onError={fail}
      />

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
            <button className="btn" onClick={toggleCustom}>
              {form ? "收起自定义" : "自定义…"}
            </button>
          </div>
          {form && (
            <CustomProviderForm
              key={form.key}
              provider={form.provider}
              encryption={encryption}
              onSaved={() => {
                setForm((current) => (current === form ? null : current));
                return changed();
              }}
              setError={setError}
            />
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
