import type { LatexPdfPreviewPayload } from "@wordhub/contracts";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf.mjs";
import type {
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist/types/src/display/api";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cleanIpcError } from "../lib/errors";

GlobalWorkerOptions.workerSrc = workerUrl;

export function LatexPdfPreview({
  projectId,
  mainFile,
  refreshRef,
}: {
  projectId: string;
  mainFile?: string;
  refreshRef: { current: (() => Promise<void>) | null };
}) {
  const [artifact, setArtifact] = useState<LatexPdfPreviewPayload | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageHostRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(undefined);
    try {
      const next = await window.wordhub.invoke("latex.readPdf", { projectId });
      if (requestRef.current !== requestId) return;
      setArtifact(next);
      setPageNumber(1);
    } catch (cause) {
      if (requestRef.current === requestId) setError(cleanIpcError(cause));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    return () => {
      requestRef.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    refreshRef.current = refresh;
    return () => {
      if (refreshRef.current === refresh) refreshRef.current = null;
    };
  }, [refresh, refreshRef]);

  useEffect(() => {
    const host = pageHostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      setAvailableWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (artifact?.status !== "ready") {
      setDocument(undefined);
      setPageCount(0);
      return;
    }
    let disposed = false;
    const loadingTask = getDocument({ data: artifact.data.slice() });
    void loadingTask.promise
      .then((document) => {
        if (disposed) {
          void document.destroy();
          return;
        }
        setDocument(document);
        setPageCount(document.numPages);
        setPageNumber(1);
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cleanIpcError(cause));
      });
    return () => {
      disposed = true;
      void loadingTask.destroy();
    };
  }, [artifact]);

  useEffect(() => {
    if (!document || availableWidth === 0) return;
    let disposed = false;
    let renderTask: RenderTask | undefined;
    void document
      .getPage(pageNumber)
      .then((page) => {
        const canvas = canvasRef.current;
        if (disposed || !canvas) return;
        const fit = Math.min(
          1,
          availableWidth / page.getViewport({ scale: 1 }).width,
        );
        const viewport = page.getViewport({ scale: fit * zoom });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法初始化 PDF 画布");
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform:
            outputScale === 1
              ? undefined
              : [outputScale, 0, 0, outputScale, 0, 0],
        });
        return renderTask.promise;
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cleanIpcError(cause));
      });
    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [availableWidth, document, pageNumber, zoom]);

  const status = error
    ? "error"
    : artifact?.status === "ready"
      ? artifact.stale
        ? "stale"
        : "ready"
      : loading
        ? "loading"
        : "empty";

  const statusText = error
    ? `PDF 加载失败${artifact?.status === "ready" ? "，保留上次结果" : ""}：${error}`
    : artifact?.status === "ready"
      ? artifact.stale
        ? artifact.mainFile === mainFile
          ? `上次编译未成功，显示 ${artifact.mainFile} 的上次成功结果`
          : `当前主文件为 ${mainFile ?? "未设置"}，上次编译未成功，保留 ${artifact.mainFile} 的成功结果`
        : artifact.mainFile === mainFile
          ? `来自 ${artifact.mainFile}`
          : `当前主文件为 ${mainFile ?? "未设置"}，显示上次成功的 ${artifact.mainFile}`
      : loading
        ? "正在读取 PDF…"
        : artifact?.status === "unavailable"
          ? artifact.message
          : "编译成功后将显示 PDF";

  return (
    <section
      className="latex-pdf-preview"
      data-testid="latex-pdf-preview"
      data-revision={
        artifact?.status === "ready" ? artifact.revision : undefined
      }
      data-main-file={
        artifact?.status === "ready" ? artifact.mainFile : undefined
      }
      aria-label="PDF 预览"
    >
      <header className="latex-pdf-head">
        <strong>PDF 预览</strong>
        <button
          className="btn btn-icon"
          type="button"
          aria-label="刷新 PDF"
          title="刷新 PDF"
          disabled={loading}
          onClick={() => void refresh()}
          data-testid="latex-pdf-refresh"
        >
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </header>
      <div className="latex-pdf-toolbar" aria-label="PDF 控件">
        <button
          className="btn btn-icon"
          type="button"
          aria-label="上一页"
          title="上一页"
          disabled={pageNumber <= 1}
          onClick={() => setPageNumber((page) => Math.max(1, page - 1))}
        >
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        <span className="latex-pdf-page-count">
          {pageCount ? `${pageNumber} / ${pageCount}` : "– / –"}
        </span>
        <button
          className="btn btn-icon"
          type="button"
          aria-label="下一页"
          title="下一页"
          disabled={pageNumber >= pageCount}
          onClick={() => setPageNumber((page) => Math.min(pageCount, page + 1))}
        >
          <ChevronRight size={15} aria-hidden="true" />
        </button>
        <span className="latex-pdf-toolbar-spacer" />
        <button
          className="btn btn-icon"
          type="button"
          aria-label="缩小"
          title="缩小"
          disabled={zoom <= 0.6}
          onClick={() => setZoom((value) => Math.max(0.6, value - 0.1))}
        >
          <ZoomOut size={15} aria-hidden="true" />
        </button>
        <span className="latex-pdf-zoom">{Math.round(zoom * 100)}%</span>
        <button
          className="btn btn-icon"
          type="button"
          aria-label="放大"
          title="放大"
          disabled={zoom >= 1.6}
          onClick={() => setZoom((value) => Math.min(1.6, value + 0.1))}
        >
          <ZoomIn size={15} aria-hidden="true" />
        </button>
      </div>
      <p
        className={`latex-pdf-status${status === "stale" || status === "error" ? " is-alert" : ""}`}
        role={status === "stale" || status === "error" ? "alert" : "status"}
        data-testid="latex-pdf-status"
        data-status={status}
      >
        {statusText}
      </p>
      <div className="latex-pdf-page-host" ref={pageHostRef}>
        {artifact?.status === "ready" && (
          <canvas
            className="latex-pdf-canvas"
            ref={canvasRef}
            data-testid="latex-pdf-canvas"
            aria-label={`第 ${pageNumber} 页`}
          />
        )}
      </div>
    </section>
  );
}
