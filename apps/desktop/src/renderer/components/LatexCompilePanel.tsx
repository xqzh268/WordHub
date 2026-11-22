import type {
  LatexCompileResultPayload,
  LatexTrustPayload,
} from "@wordhub/contracts";
import { ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cleanIpcError } from "../lib/errors";

function describe(result: LatexCompileResultPayload): string {
  const seconds = (result.durationMs / 1000).toFixed(1);
  switch (result.status) {
    case "succeeded":
      return `编译成功，用时 ${seconds} 秒`;
    case "failed":
      return `编译失败（退出码 ${result.exitCode ?? "无"}）`;
    case "timeout":
      return "编译超时，已停止";
    case "aborted":
      return "编译已停止";
    case "offline-cache-miss":
      return "离线且缓存中缺少所需宏包";
    case "missing-tool":
      return (
        result.message ??
        `缺少外部工具${result.missingTool ? `：${result.missingTool}` : ""}`
      );
    case "untrusted":
      return result.message ?? "项目未信任，已拒绝编译";
  }
}

export function LatexCompilePanel({
  projectId,
  mainFile,
  updatingFiles,
}: {
  projectId: string;
  mainFile?: string;
  updatingFiles: boolean;
}) {
  const [trust, setTrust] = useState<LatexTrustPayload | null>(null);
  const [compiling, setCompiling] = useState<string>();
  const [lastResult, setLastResult] = useState<{
    mainFile: string;
    result: LatexCompileResultPayload;
  }>();
  const [error, setError] = useState<string>();
  const trustRequest = useRef<symbol | null>(null);
  const result =
    lastResult?.mainFile === mainFile ? lastResult?.result : undefined;

  const updateTrust = useCallback(
    async (confirm: boolean) => {
      const id = Symbol();
      trustRequest.current = id;
      try {
        const next = confirm
          ? await window.wordhub.invoke("latex.setTrust", {
              projectId,
              trusted: true,
            })
          : await window.wordhub.invoke("latex.trustStatus", { projectId });
        if (trustRequest.current === id) setTrust(next);
      } catch (cause) {
        if (trustRequest.current === id) setError(cleanIpcError(cause));
      }
    },
    [projectId],
  );

  useEffect(() => {
    void updateTrust(false);
    return () => {
      trustRequest.current = null;
    };
  }, [updateTrust]);

  const confirmTrust = () => {
    setError(undefined);
    void updateTrust(true);
  };

  const compile = async () => {
    if (!mainFile || updatingFiles || compiling || !trust?.trusted) return;
    setError(undefined);
    setLastResult(undefined);
    setCompiling(mainFile);
    try {
      const next = await window.wordhub.invoke("latex.compile", {
        projectId,
        mainFile,
      });
      setLastResult({ mainFile, result: next });
      if (next.status === "untrusted" && trustRequest.current)
        void updateTrust(false);
    } catch (cause) {
      setError(cleanIpcError(cause));
    } finally {
      setCompiling(undefined);
    }
  };

  const stop = () =>
    void window.wordhub.invoke("latex.abort", { projectId }).catch(() => {
      /* 没有进行中的编译时无需处理 */
    });

  return (
    <div className="latex-panel" data-testid="latex-panel">
      {trust && !trust.trusted && (
        <div
          className="latex-trust-banner"
          role="alert"
          data-testid="latex-trust-banner"
        >
          <ShieldAlert size={18} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <strong>此项目来自外部，尚未信任</strong>
            <p>
              LaTeX 编译可读写项目外的文件：不可信的 .tex
              可能读取你的私密文件并写进
              PDF，或在任意位置写文件。只有确认来源可靠才选择信任。
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => void confirmTrust()}
            data-testid="latex-trust-button"
          >
            信任此项目
          </button>
        </div>
      )}
      <div className="latex-compile-row">
        <button
          className="btn btn-primary"
          disabled={
            !trust?.trusted || Boolean(compiling) || updatingFiles || !mainFile
          }
          onClick={() => void compile()}
          data-testid="latex-compile"
        >
          {mainFile ? `编译 ${mainFile}` : "编译"}
        </button>
        <button
          className="btn"
          disabled={!compiling}
          onClick={stop}
          data-testid="latex-stop"
        >
          停止
        </button>
        <span
          className="latex-compile-status"
          role="status"
          data-testid="latex-compile-status"
          data-status={compiling ? "running" : (result?.status ?? "idle")}
        >
          {compiling
            ? `正在编译 ${compiling}…`
            : result
              ? describe(result)
              : trust?.trusted
                ? mainFile
                  ? "尚未编译"
                  : updatingFiles
                    ? "正在读取项目文件…"
                    : "请选择主文件"
                : ""}
        </span>
      </div>
      {result?.readOutsideProject && (
        <div
          className="latex-outside-warning"
          role="alert"
          data-testid="latex-outside-warning"
        >
          <strong>编译读取了项目外的文件</strong>
          <ul>
            {result.outsidePaths.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>如果这不是你预期的，请不要继续信任此项目。</p>
        </div>
      )}
      {error && (
        <p
          className="project-error"
          role="alert"
          data-testid="latex-panel-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
