import { useState } from "react";
import { cleanIpcError } from "../../lib/errors";
import type { ModelRow } from "./model-draft";
import type { CustomInput, RemoteModel } from "./types";

export function RemoteModelDiscovery({
  connection,
  providerId,
  rows,
  onApiKeyChange,
  onPicked,
  setError,
}: {
  connection: Pick<CustomInput, "baseUrl" | "api"> & { apiKey: string };
  providerId?: string;
  rows: ModelRow[];
  onApiKeyChange: (apiKey: string) => void;
  onPicked: (models: RemoteModel[]) => void;
  setError: (message: string) => void;
}) {
  const [remote, setRemote] = useState<RemoteModel[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [remoteFilter, setRemoteFilter] = useState("");
  const [fetching, setFetching] = useState(false);

  const matches = (model: RemoteModel) =>
    `${model.id} ${model.label}`
      .toLowerCase()
      .includes(remoteFilter.trim().toLowerCase());
  const fetchRemote = async () => {
    setError("");
    setFetching(true);
    try {
      const result = await window.wordhub?.invoke("settings.fetchModels", {
        baseUrl: connection.baseUrl.trim(),
        api: connection.api,
        provider: providerId,
        apiKey: connection.apiKey.trim() || undefined,
      });
      const list = result?.models ?? [];
      const existing = new Set(rows.map((row) => row.id.trim()));
      setRemote(list);
      setRemoteFilter("");
      // 模型不多时默认全选新模型；网关动辄上百个，让用户自己挑。
      setPicked(
        new Set(
          list.length <= 20
            ? list.filter((m) => !existing.has(m.id)).map((m) => m.id)
            : [],
        ),
      );
      if (list.length === 0)
        setError("接口返回了空的模型列表，请手动填写模型ID");
    } catch (cause) {
      setRemote(null);
      setError(cleanIpcError(cause));
    } finally {
      setFetching(false);
    }
  };

  const addPicked = () => {
    if (!remote) return;
    onPicked(remote.filter((model) => picked.has(model.id)));
    setRemote(null);
    setPicked(new Set());
  };

  return (
    <>
      <div className="credential-row" style={{ marginTop: 0 }}>
        <input
          className="text-input mono"
          type="password"
          value={connection.apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          placeholder={
            providerId !== undefined
              ? "API key（留空则沿用已保存的密钥）"
              : "API key（可选；用于获取模型列表，保存时一并加密保存）"
          }
          aria-label="自定义服务商API key"
        />
        <button
          className="btn"
          disabled={!connection.baseUrl.trim() || fetching}
          onClick={() => void fetchRemote()}
        >
          {fetching ? "获取中…" : "从接口获取模型"}
        </button>
      </div>
      {remote && remote.length > 0 && (
        <div
          data-testid="remote-models"
          style={{
            border: "1px solid var(--line, #ddd)",
            borderRadius: 6,
            padding: 8,
            display: "grid",
            gap: 6,
          }}
        >
          <div className="credential-row" style={{ marginTop: 0 }}>
            <input
              className="text-input"
              value={remoteFilter}
              onChange={(event) => setRemoteFilter(event.target.value)}
              placeholder={`筛选 ${remote.length} 个模型`}
              aria-label="筛选接口模型"
            />
            <button
              className="btn"
              onClick={() =>
                setPicked((current) => {
                  const next = new Set(current);
                  for (const model of remote.filter(matches))
                    next.add(model.id);
                  return next;
                })
              }
            >
              全选筛选结果
            </button>
            <button className="btn" onClick={() => setPicked(new Set())}>
              清空
            </button>
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {remote.filter(matches).map((model) => (
              <label
                key={model.id}
                className="toggle-row"
                style={{ display: "flex", gap: 6 }}
              >
                <input
                  type="checkbox"
                  checked={picked.has(model.id)}
                  onChange={(event) =>
                    setPicked((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(model.id);
                      else next.delete(model.id);
                      return next;
                    })
                  }
                  aria-label={`选择模型 ${model.id}`}
                />
                <span className="mono">{model.id}</span>
                <span className="section-note" style={{ margin: 0 }}>
                  {[
                    model.contextWindow
                      ? `${Math.round(model.contextWindow / 1000)}K`
                      : "",
                    model.reasoning ? "思考" : "",
                    model.source === "unknown" ? "价格未知" : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </label>
            ))}
          </div>
          <div className="credential-row" style={{ marginTop: 0 }}>
            <button
              className="btn btn-primary"
              disabled={picked.size === 0}
              onClick={addPicked}
            >
              添加选中的 {picked.size} 个模型
            </button>
            <button className="btn" onClick={() => setRemote(null)}>
              关闭列表
            </button>
          </div>
        </div>
      )}
    </>
  );
}
