import type { LatexEngineStatusPayload } from "@wordhub/contracts";
import { useCallback, useEffect, useState } from "react";
import { cleanIpcError } from "../lib/errors";

const STATE_LABEL: Record<LatexEngineStatusPayload["state"], string> = {
  missing: "未安装",
  ready: "就绪",
  corrupt: "损坏",
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function LatexEngineSettings() {
  const [status, setStatus] = useState<LatexEngineStatusPayload | null>(null);
  const [progress, setProgress] = useState<{
    received: number;
    total: number;
  } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const next = await window.wordhub?.invoke(
        "latex.engineStatus",
        undefined,
      );
      if (next) {
        setStatus(next);
        setInstalling(next.installing);
      }
    } catch (cause) {
      setError(cleanIpcError(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    // 安装进度由后台经 run.event 推送；这里直接订阅，不经过写作工作台的消息状态。
    return window.wordhub?.subscribe((event) => {
      if (event.type !== "run.event") return;
      const message = event.payload as {
        type?: string;
        receivedBytes?: number;
        totalBytes?: number;
      };
      if (message.type === "latex.installProgress")
        setProgress({
          received: message.receivedBytes ?? 0,
          total: message.totalBytes ?? 0,
        });
    });
  }, [refresh]);

  const install = async () => {
    setError(undefined);
    setNotice(undefined);
    setInstalling(true);
    setProgress({ received: 0, total: 0 });
    try {
      const result = await window.wordhub.invoke(
        "latex.installEngine",
        undefined,
      );
      setStatus(result.status);
      if (result.canceled) setNotice("已取消安装。");
    } catch (cause) {
      setError(cleanIpcError(cause));
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  };

  const clearCache = async () => {
    setError(undefined);
    setNotice(undefined);
    setBusy(true);
    try {
      setStatus(await window.wordhub.invoke("latex.clearCache", undefined));
      setNotice("缓存已清理。");
    } catch (cause) {
      setError(cleanIpcError(cause));
    } finally {
      setBusy(false);
    }
  };

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : 0;

  return (
    <section className="panel-section" data-testid="latex-engine">
      <h2>LaTeX 引擎</h2>
      <p className="section-note">
        学术写作使用 Tectonic 编译
        LaTeX。引擎首次使用时下载，宏包按需下载并缓存在应用数据目录。
        该引擎的可执行文件没有代码签名，系统可能给出安全提示；下载后会校验固定的
        SHA-256。
      </p>
      <div className="field">
        <div className="field-label">
          <strong>状态</strong>
          <span>{status ? `Tectonic ${status.version}` : "正在读取…"}</span>
        </div>
        <div className="latex-engine-body">
          <div className="latex-engine-line">
            <span
              className={`latex-state latex-state-${status?.state ?? "missing"}`}
              data-testid="latex-engine-state"
            >
              {status ? STATE_LABEL[status.state] : "…"}
            </span>
            {installing ? (
              <button
                className="btn"
                onClick={() =>
                  void window.wordhub.invoke("latex.cancelInstall", undefined)
                }
                data-testid="latex-cancel-install"
              >
                取消
              </button>
            ) : (
              <button
                className="btn btn-primary"
                disabled={!status || status.state === "ready"}
                onClick={() => void install()}
                data-testid="latex-install"
              >
                {status?.state === "corrupt" ? "重新安装" : "安装"}
              </button>
            )}
          </div>
          {installing && (
            <div className="latex-progress-wrap">
              <div
                className="latex-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                data-testid="latex-install-progress"
              >
                <span style={{ width: `${percent}%` }} />
              </div>
              <span className="latex-progress-text">
                {progress && progress.total > 0
                  ? `${formatBytes(progress.received)} / ${formatBytes(progress.total)}`
                  : "准备下载…"}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="field">
        <div className="field-label">
          <strong>缓存</strong>
          <span>编译用到的宏包与字体。</span>
        </div>
        <div className="latex-engine-body">
          <div className="latex-engine-line">
            <span data-testid="latex-cache-size">
              {status ? formatBytes(status.cacheBytes) : "…"}
            </span>
            <button
              className="btn"
              disabled={busy || !status || status.cacheBytes === 0}
              onClick={() => void clearCache()}
              data-testid="latex-clear-cache"
            >
              清理缓存
            </button>
          </div>
        </div>
      </div>
      {notice && (
        <p className="section-note" role="status" data-testid="latex-notice">
          {notice}
        </p>
      )}
      {error && (
        <p className="project-error" role="alert" data-testid="latex-error">
          {error}
        </p>
      )}
    </section>
  );
}
