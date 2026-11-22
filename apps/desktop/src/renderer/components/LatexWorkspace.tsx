import type { LatexFilesPayload } from "@wordhub/contracts";
import { FileCode2, FileImage, Pin } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cleanIpcError } from "../lib/errors";
import { LatexCompilePanel } from "./LatexCompilePanel";
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
  const [error, setError] = useState<string>();
  const [updatingFiles, setUpdatingFiles] = useState(false);
  const request = useRef<symbol | null>(null);

  const updateFiles = useCallback(
    async (load: () => Promise<LatexFilesPayload>) => {
      if (request.current) return;
      const id = Symbol();
      request.current = id;
      setUpdatingFiles(true);
      setError(undefined);
      try {
        const next = await load();
        if (request.current === id) setFiles(next);
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
  const selected =
    selectedPath ??
    mainFile ??
    files?.files.find((file) => isTextFile(file.path))?.path;
  const maySetMain =
    selected &&
    selected !== mainFile &&
    selected.toLowerCase().endsWith(".tex") &&
    files?.files.some((file) => file.path === selected);

  const setMain = () => {
    if (!files || !selected || !maySetMain) return;
    void updateFiles(async () => {
      const next = await window.wordhub.invoke("latex.setMainFile", {
        projectId,
        mainFile: selected,
      });
      return { ...files, mainFile: next.mainFile };
    });
  };

  return (
    <>
      <LatexCompilePanel
        projectId={projectId}
        mainFile={mainFile}
        updatingFiles={updatingFiles}
      />
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
              className={`latex-file-item${selected === file.path ? " active" : ""}`}
              key={file.path}
              aria-current={selected === file.path ? "true" : undefined}
              onClick={() => setSelectedPath(file.path)}
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
            <strong title={selected}>{selected ?? "选择文件"}</strong>
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
          {selected && isTextFile(selected) ? (
            <LatexSourceEditor
              key={selected}
              projectId={projectId}
              path={selected}
            />
          ) : (
            <div className="latex-editor-empty">
              {selected ? "此处仅支持编辑源码文件。" : "选择一个源码文件。"}
            </div>
          )}
          {error && (
            <p className="project-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
