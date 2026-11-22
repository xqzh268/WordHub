import type {
  LatexFileContentPayload,
  LatexFileInfo,
  LatexFilesPayload,
} from "@wordhub/contracts";
import { FileCode2, FileImage } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cleanIpcError } from "../lib/errors";

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
]);

function isTextFile(file: LatexFileInfo): boolean {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return textExtensions.has(extension);
}

export function LatexWorkspace({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<LatexFilesPayload>();
  const [selected, setSelected] = useState<string>();
  const [content, setContent] = useState<LatexFileContentPayload>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const next = await window.wordhub.invoke("latex.files", { projectId });
      setFiles(next);
      setSelected((current) => current ?? next.mainFile);
    } catch (cause) {
      setError(cleanIpcError(cause));
    }
  }, [projectId]);

  useEffect(() => {
    setFiles(undefined);
    setSelected(undefined);
    setContent(undefined);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    const file = files?.files.find((item) => item.path === selected);
    if (!file || !isTextFile(file)) {
      setContent(undefined);
      return;
    }
    let active = true;
    void window.wordhub
      .invoke("latex.readFile", { projectId, path: selected })
      .then((next) => {
        if (active) {
          setContent(next);
        }
      })
      .catch((cause) => active && setError(cleanIpcError(cause)));
    return () => {
      active = false;
    };
  }, [files, projectId, selected]);

  const choose = async (file: LatexFileInfo) => {
    setSelected(file.path);
    if (file.path.endsWith(".tex")) {
      try {
        const next = await window.wordhub.invoke("latex.setMainFile", {
          projectId,
          mainFile: file.path,
        });
        setFiles((current) =>
          current ? { ...current, mainFile: next.mainFile } : current,
        );
      } catch (cause) {
        setError(cleanIpcError(cause));
      }
    }
  };

  return (
    <section className="latex-workspace" data-testid="latex-workspace">
      <aside className="latex-file-tree" aria-label="LaTeX 文件树">
        <div className="latex-file-tree-head">
          <strong>项目文件</strong>
          <button
            className="btn btn-small"
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
            onClick={() => void choose(file)}
            type="button"
          >
            {isTextFile(file) ? (
              <FileCode2 size={15} />
            ) : (
              <FileImage size={15} />
            )}
            <span>{file.path}</span>
            {files.mainFile === file.path && <small>主文件</small>}
          </button>
        ))}
        {!files?.files.length && (
          <p className="section-note">项目中还没有可打开的 LaTeX 文件。</p>
        )}
      </aside>
      <div className="latex-editor-panel">
        <div className="latex-editor-head">
          <strong>{selected ?? "选择文件"}</strong>
          <span className="section-note">只读预览</span>
        </div>
        {content ? (
          <textarea
            className="latex-editor"
            value={content.content}
            readOnly
            spellCheck={false}
            aria-label="LaTeX 源码编辑器"
          />
        ) : (
          <div className="latex-editor-empty">选择一个源文件开始查看。</div>
        )}
        {error && (
          <p className="project-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
