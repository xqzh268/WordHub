import type {
  LatexDiagnosticLocationPayload,
  LatexFilesPayload,
} from "@wordhub/contracts";
import { FileCode2, FileImage, Pin } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cleanIpcError } from "../lib/errors";
import { LatexCompilePanel } from "./LatexCompilePanel";
import { LatexPdfPreview } from "./LatexPdfPreview";
import { LatexSourceEditor } from "./LatexSourceEditor";

const textExtensions = new Set([
  ".tex",
  ".ltx",
  ".bib",
  ".sty",
  ".cls",
  ".bst",
  ".def",
  ".bbx",
  ".cbx",
  ".dtx",
  ".ins",
  ".gls",
  ".acn",
  ".ist",
]);

function isTextFile(path: string): boolean {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  return textExtensions.has(extension);
}

export function LatexWorkspace({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<LatexFilesPayload>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [sourceJump, setSourceJump] =
    useState<LatexDiagnosticLocationPayload>();
  const [pdfSourceJump, setPdfSourceJump] =
    useState<LatexDiagnosticLocationPayload>();
  const [error, setError] = useState<string>();
  const [updatingFiles, setUpdatingFiles] = useState(false);
  const request = useRef<symbol | null>(null);
  const pdfPreviewRef = useRef<(() => Promise<void>) | null>(null);
  const sourcePaths = useMemo(
    () =>
      new Set(
        files?.files
          .filter((file) => isTextFile(file.path))
          .map((file) => file.path),
      ),
    [files],
  );

  const updateFiles = useCallback(
    async (load: () => Promise<LatexFilesPayload>) => {
      if (request.current) return;
      const id = Symbol();
      request.current = id;
      setUpdatingFiles(true);
      setError(undefined);
      try {
        const next = await load();
        if (request.current !== id) return;
        setFiles(next);
        setSelectedPath(
          (path) =>
            path ??
            next.files.find((file) => file.path === next.mainFile)?.path ??
            next.files.find((file) => isTextFile(file.path))?.path,
        );
      } catch (cause) {
        if (request.current === id) setError(cleanIpcError(cause));
      } finally {
        if (request.current === id) {
          request.current = null;
          setUpdatingFiles(false);
        }
      }
    },
    [],
  );

  const refresh = useCallback(
    () =>
      updateFiles(() => window.wordhub.invoke("latex.files", { projectId })),
    [projectId, updateFiles],
  );

  useEffect(() => {
    void refresh();
    return () => {
      request.current = null;
    };
  }, [refresh]);

  const mainFile = files?.files.find(
    (file) => file.path === files.mainFile,
  )?.path;
  const maySetMain =
    selectedPath &&
    selectedPath !== mainFile &&
    selectedPath.toLowerCase().endsWith(".tex") &&
    files?.files.some((file) => file.path === selectedPath);

  const setMain = () => {
    if (!files || !selectedPath || !maySetMain) return;
    void updateFiles(async () => {
      const next = await window.wordhub.invoke("latex.setMainFile", {
        projectId,
        mainFile: selectedPath,
      });
      return { ...files, mainFile: next.mainFile };
    });
  };

  const jumpToSource = (location: LatexDiagnosticLocationPayload) => {
    setSelectedPath(location.relativePath);
    setSourceJump({ ...location });
  };

  const finishJump = useCallback((location: LatexDiagnosticLocationPayload) => {
    setSourceJump((current) => (current === location ? undefined : current));
  }, []);

  const jumpToPdf = useCallback((location: LatexDiagnosticLocationPayload) => {
    setPdfSourceJump({ ...location });
  }, []);

  const finishPdfJump = useCallback(
    (location: LatexDiagnosticLocationPayload) => {
      setPdfSourceJump((current) =>
        current === location ? undefined : current,
      );
    },
    [],
  );

  return (
    <>
      <LatexCompilePanel
        projectId={projectId}
        mainFile={mainFile}
        updatingFiles={updatingFiles}
        sourcePaths={sourcePaths}
        onJumpToSource={jumpToSource}
        onCompileComplete={() => void pdfPreviewRef.current?.()}
      />
      <div className="latex-editor-preview-layout">
        <section className="latex-workspace" data-testid="latex-workspace">
          <aside className="latex-file-tree" aria-label="LaTeX 文件树">
            <div className="latex-file-tree-head">
              <strong>项目文件</strong>
              <button
                className="btn btn-small"
                disabled={updatingFiles}
                onClick={() => void refresh()}
                type="button"
              >
                刷新
              </button>
            </div>
            {files?.files.map((file) => (
              <button
                className={`latex-file-item${selectedPath === file.path ? " active" : ""}`}
                key={file.path}
                aria-current={selectedPath === file.path ? "true" : undefined}
                onClick={() => {
                  setSourceJump(undefined);
                  setSelectedPath(file.path);
                }}
                type="button"
              >
                {isTextFile(file.path) ? (
                  <FileCode2 size={15} />
                ) : (
                  <FileImage size={15} />
                )}
                <span>{file.path}</span>
                {files.mainFile === file.path && <small>主文件</small>}
              </button>
            ))}
            {files && !files.files.length && (
              <p className="section-note">项目中还没有可打开的 LaTeX 文件。</p>
            )}
          </aside>
          <div className="latex-editor-panel">
            <div className="latex-editor-head">
              <strong title={selectedPath}>{selectedPath ?? "选择文件"}</strong>
              {maySetMain && (
                <button
                  className="btn"
                  type="button"
                  data-testid="latex-set-main"
                  disabled={updatingFiles}
                  onClick={setMain}
                >
                  <Pin size={14} aria-hidden="true" />
                  设为主文件
                </button>
              )}
            </div>
            {selectedPath && isTextFile(selectedPath) ? (
              <LatexSourceEditor
                key={selectedPath}
                projectId={projectId}
                path={selectedPath}
                onJumpToPdf={jumpToPdf}
                sourceJump={
                  sourceJump?.relativePath === selectedPath
                    ? sourceJump
                    : undefined
                }
                onJumpComplete={finishJump}
              />
            ) : (
              <div className="latex-editor-empty">
                {selectedPath
                  ? "此处仅支持编辑源码文件。"
                  : "选择一个源码文件。"}
              </div>
            )}
            {error && (
              <p className="project-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </section>
        <LatexPdfPreview
          projectId={projectId}
          mainFile={mainFile}
          sourceJump={pdfSourceJump}
          onJumpComplete={finishPdfJump}
          onJumpToSource={jumpToSource}
          refreshRef={pdfPreviewRef}
        />
      </div>
    </>
  );
}
