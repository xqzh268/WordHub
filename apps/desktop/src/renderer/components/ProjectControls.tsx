import type { ProjectKind } from "@wordhub/contracts";
import { ChevronsUpDown, FolderPlus, Plus } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cleanIpcError } from "../lib/errors";
import { useWorkbench } from "../state/store";

export function ProjectControls() {
  const project = useWorkbench((s) => s.project);
  const linkFolder = useWorkbench((s) => s.linkFolder);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const kindId = useId();
  const [kind, setKind] = useState<ProjectKind>("novel");
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [error, setError] = useState<{ message: string; kind?: ProjectKind }>();

  const chooseFolder = async (kind?: ProjectKind) => {
    setError(undefined);
    setChoosingFolder(true);
    try {
      if (await linkFolder(kind)) dialog.current?.close();
    } catch (cause) {
      setError({ message: cleanIpcError(cause), kind });
    } finally {
      setChoosingFolder(false);
    }
  };

  return (
    <div className="project-controls">
      {project.folder ? (
        <button
          className="project-card"
          disabled={choosingFolder}
          onClick={() => void chooseFolder()}
          data-testid="project-card"
        >
          <span className="project-name">{project.name}</span>
          <ChevronsUpDown size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="project-path" title={project.folder}>
            {project.folder}
          </span>
        </button>
      ) : (
        <button
          className="project-card empty"
          disabled={choosingFolder}
          onClick={() => void chooseFolder()}
          data-testid="link-folder"
        >
          <FolderPlus size={18} strokeWidth={1.5} aria-hidden="true" />
          <span>
            <strong>链接写作文件夹</strong>
            <small>稿件与设定都保存在这里</small>
          </span>
        </button>
      )}
      <button
        type="button"
        className="btn project-new"
        data-testid="new-project"
        disabled={choosingFolder}
        onClick={() => {
          setKind("novel");
          setError(undefined);
          dialog.current?.showModal();
        }}
      >
        <Plus size={15} strokeWidth={1.5} aria-hidden="true" />
        新建项目
      </button>
      {error && !error.kind && (
        <p className="project-error" role="alert">
          {error.message}
        </p>
      )}

      <dialog
        ref={dialog}
        className="project-kind-dialog"
        data-testid="new-project-dialog"
        aria-labelledby={titleId}
        onCancel={(event) => {
          if (choosingFolder) event.preventDefault();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void chooseFolder(kind);
          }}
        >
          <h2 id={titleId}>新建项目</h2>
          <label htmlFor={kindId}>项目类型</label>
          <select
            id={kindId}
            className="text-input"
            data-testid="new-project-kind"
            value={kind}
            disabled={choosingFolder}
            onChange={(event) =>
              setKind(event.target.value === "academic" ? "academic" : "novel")
            }
          >
            <option value="novel">小说写作</option>
            <option value="academic">学术写作（占位）</option>
          </select>
          {error?.kind && (
            <p className="project-error" role="alert">
              {error.message}
            </p>
          )}
          <div className="project-kind-actions">
            <button
              type="button"
              className="btn"
              disabled={choosingFolder}
              onClick={() => dialog.current?.close()}
            >
              取消
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={choosingFolder}
              data-testid="new-project-choose-folder"
            >
              {choosingFolder ? "正在选择…" : "选择文件夹"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
