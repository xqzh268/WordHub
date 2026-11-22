import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { LatexDiagnosticLocationPayload } from "@wordhub/contracts";
import { basicSetup } from "codemirror";
import { RefreshCw, Save } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  attachSource,
  editSource,
  isSourceDirty,
  loadSource,
  saveSource,
  useSourceBuffer,
} from "../state/latex-source";

const latexLanguage = StreamLanguage.define(stex);

const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--paper-sheet)",
    color: "var(--ink-1)",
    fontSize: "13px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.7" },
  ".cm-content": { padding: "12px 0", caretColor: "var(--ink-1)" },
  ".cm-line": { padding: "0 12px" },
  ".cm-gutters": {
    backgroundColor: "var(--bg-canvas)",
    borderRight: "1px solid var(--line)",
    color: "var(--ink-3)",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "var(--bg-active)",
  },
});

type SourceProps = {
  projectId: string;
  path: string;
  sourceJump?: LatexDiagnosticLocationPayload;
  onJumpComplete: (location: LatexDiagnosticLocationPayload) => void;
};

function SourceCodeMirror({
  initialText,
  path,
  projectId,
  sourceKey,
  readOnly,
  sourceJump,
  onJumpComplete,
}: SourceProps & {
  initialText: string;
  sourceKey: string;
  readOnly: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const openingText = useRef(initialText);
  const readOnlyMode = useMemo(() => new Compartment(), []);

  useLayoutEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: openingText.current,
        extensions: [
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                void saveSource(sourceKey, projectId, path);
                return true;
              },
            },
          ]),
          basicSetup,
          latexLanguage,
          editorTheme,
          readOnlyMode.of(EditorState.readOnly.of(false)),
          EditorView.contentAttributes.of({
            "aria-label": "LaTeX 源码编辑器",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              editSource(sourceKey, update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, [path, projectId, readOnlyMode, sourceKey]);

  useLayoutEffect(() => {
    view.current?.dispatch({
      effects: readOnlyMode.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly, readOnlyMode]);

  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor || !sourceJump || readOnly) return;
    const { doc } = editor.state;
    const position = doc.line(Math.min(sourceJump.line, doc.lines)).from;
    editor.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position, { y: "center" }),
    });
    editor.focus();
    onJumpComplete(sourceJump);
  }, [onJumpComplete, readOnly, sourceJump]);

  return <div className="latex-editor" data-testid="latex-editor" ref={host} />;
}

export function LatexSourceEditor({
  projectId,
  path,
  sourceJump,
  onJumpComplete,
}: SourceProps) {
  const sourceKey = JSON.stringify([projectId, path]);
  const buffer = useSourceBuffer(sourceKey);
  const [confirmReload, setConfirmReload] = useState(false);

  useEffect(
    () => attachSource(sourceKey, projectId, path),
    [sourceKey, projectId, path],
  );

  const document = buffer?.document;
  const dirty = isSourceDirty(buffer);
  const loading = buffer?.operation === "loading";
  const saving = buffer?.operation === "saving";
  const conflict = buffer?.conflict;
  const saveStatus = saving
    ? "saving"
    : conflict
      ? "conflict"
      : dirty
        ? "dirty"
        : "saved";
  const saveMessage = {
    saving: "保存中…",
    conflict: "保存冲突",
    dirty: "未保存",
    saved: "已保存",
  }[saveStatus];

  const reload = () => {
    setConfirmReload(false);
    void loadSource(sourceKey, projectId, path);
  };

  return (
    <>
      <div className="latex-editor-actions">
        {document && (
          <>
            <span
              className="latex-save-status"
              role="status"
              data-testid="latex-save-status"
              data-status={saveStatus}
            >
              {saveMessage}
            </span>
            <button
              className="btn btn-primary"
              type="button"
              data-testid="latex-save"
              disabled={
                !dirty ||
                Boolean(conflict) ||
                saving ||
                loading ||
                confirmReload
              }
              onClick={() => void saveSource(sourceKey, projectId, path)}
            >
              <Save size={14} aria-hidden="true" />
              保存
            </button>
          </>
        )}
        <button
          className="btn"
          type="button"
          data-testid="latex-reload"
          disabled={saving || loading || confirmReload}
          onClick={() => (dirty ? setConfirmReload(true) : reload())}
        >
          <RefreshCw size={14} aria-hidden="true" />
          重新加载
        </button>
      </div>
      {conflict && (
        <p
          className="latex-editor-notice"
          role="alert"
          data-testid="latex-save-conflict"
        >
          磁盘上的文件已有更改，当前草稿已保留。可以复制草稿后重新加载。
        </p>
      )}
      {confirmReload && (
        <div className="latex-editor-notice latex-reload-notice">
          <p>重新加载会放弃此文件的未保存更改。</p>
          <button
            className="btn"
            type="button"
            onClick={() => setConfirmReload(false)}
          >
            取消
          </button>
          <button
            className="btn"
            type="button"
            data-testid="latex-reload-confirm"
            onClick={reload}
          >
            放弃更改并重新加载
          </button>
        </div>
      )}
      {buffer?.error && (
        <p className="project-error latex-editor-notice" role="alert">
          {buffer.error}
        </p>
      )}
      {document ? (
        <SourceCodeMirror
          key={document.version}
          initialText={document.text}
          path={path}
          projectId={projectId}
          sourceKey={sourceKey}
          readOnly={loading || confirmReload}
          sourceJump={sourceJump}
          onJumpComplete={onJumpComplete}
        />
      ) : (
        <div className="latex-editor-empty">
          {buffer?.error ? "无法打开源码文件。" : "正在读取源码…"}
        </div>
      )}
    </>
  );
}
