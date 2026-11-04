import { motion } from "motion/react";
import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  ListTree,
  Quote,
  Undo2,
} from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { agentById } from "../lib/agents";
import { ExportPanel } from "./ExportPanel";
import { formatUpdated, neighborChapter } from "../state/chapters";
import { FACT_KIND_LABELS, type NovelFact } from "@wordhub/contracts";
import { useWorkbench } from "../state/store";
import type { PaperTab } from "../state/types";
import {
  htmlToMarkdown,
  isLosslessMarkdown,
  markdownToHtml,
} from "../state/markdown";

const TABS: { id: PaperTab; label: string }[] = [
  { id: "paper", label: "纸面" },
  { id: "outline", label: "大纲" },
  { id: "facts", label: "事实" },
];

const countChars = (text: string): number =>
  (text.match(/[㐀-鿿]/g) ?? []).length;

export function PaperPane() {
  const tab = useWorkbench((s) => s.paperTab);
  const setTab = useWorkbench((s) => s.setPaperTab);
  const paper = useWorkbench((s) => s.paper);
  const project = useWorkbench((s) => s.project.name);
  const demo = useWorkbench((s) => s.demo);
  const chapters = useWorkbench((s) => s.chapters);
  const activeChapter = useWorkbench((s) => s.activeChapter);
  const selectChapter = useWorkbench((s) => s.selectChapter);
  const proposedCount = useWorkbench(
    (s) => s.facts.filter((fact) => fact.status === "proposed").length,
  );
  const finalized = useWorkbench((s) => s.finalized);
  const busy = useWorkbench((s) => s.activeRunId !== null);
  const editingPaper = useWorkbench((s) => s.paperEditing);
  const send = useWorkbench((s) => s.send);
  const isFinalized = activeChapter ? finalized.includes(activeChapter) : false;
  const prev = neighborChapter(chapters, activeChapter, -1);
  const next = neighborChapter(chapters, activeChapter, 1);
  const words = paper
    ? paper.paragraphs.reduce((sum, p) => sum + countChars(p.text), 0)
    : 0;

  return (
    <section className="paper-pane grain" aria-label="文档工作台">
      <header className="paper-bar">
        <div className="seg" role="tablist" aria-label="工作台视图">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              {tab === item.id && (
                <motion.span
                  layoutId="paper-tab"
                  className="seg-pill"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                />
              )}
              <span>{item.label}</span>
              {item.id === "facts" && proposedCount > 0 && (
                <span className="tab-badge" data-testid="facts-badge">
                  {proposedCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="paper-meta">
          {paper ? (
            <>
              <span>{words.toLocaleString("zh-CN")} 字</span>
              <i aria-hidden="true" />
              <span>
                {demo
                  ? "示例稿"
                  : paper.mtimeMs !== undefined
                    ? formatUpdated(paper.mtimeMs)
                    : "已保存"}
              </span>
            </>
          ) : (
            <span>尚无章节</span>
          )}
        </div>
      </header>

      {chapters.length > 0 && tab === "paper" && (
        <nav className="chapter-nav" aria-label="章节">
          <button
            type="button"
            aria-label="上一章"
            disabled={!prev || editingPaper}
            onClick={() => prev && void selectChapter(prev)}
          >
            <ChevronLeft size={15} strokeWidth={1.5} />
          </button>
          <select
            aria-label="选择章节"
            data-testid="chapter-select"
            value={activeChapter ?? ""}
            disabled={editingPaper}
            onChange={(event) => void selectChapter(event.target.value)}
          >
            {chapters.map((chapter) => (
              <option key={chapter.path} value={chapter.path}>
                {chapter.name.replace(/\.(?:md|markdown|txt)$/iu, "")}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="下一章"
            disabled={!next || editingPaper}
            onClick={() => next && void selectChapter(next)}
          >
            <ChevronRight size={15} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className={`btn finalize-btn ${isFinalized ? "done" : ""}`}
            data-testid="finalize"
            disabled={busy || !activeChapter || editingPaper}
            title="史官会抽取待确认的事实并写章节摘要"
            onClick={() => activeChapter && void send(`定稿 ${activeChapter}`)}
          >
            {isFinalized ? "重新定稿" : "定稿"}
          </button>
          <ExportPanel activeChapter={activeChapter} disabled={editingPaper} />
        </nav>
      )}

      <div className="paper-stage selectable">
        {tab === "paper" &&
          (paper ? (
            <article className="sheet grain" data-testid="paper-sheet">
              <div className="sheet-head">
                <span>{project}</span>
                <span>{paper.page}页</span>
              </div>
              <header className="chapter">
                <span className="chapter-no">{paper.no}</span>
                {paper.title !== paper.no && <h2>{paper.title}</h2>}
                <i className="ornament" aria-hidden="true" />
              </header>
              <EditableSheet
                key={paper.path ?? "demo"}
                paper={paper}
                busy={busy}
                activeChapter={activeChapter}
                sessionId={useWorkbench.getState().activeSessionId}
                onSaved={() =>
                  void useWorkbench
                    .getState()
                    .syncChapters(activeChapter ?? undefined)
                }
              />
              <footer className="sheet-foot">· {paper.page} ·</footer>
            </article>
          ) : (
            <article
              className="sheet sheet-blank grain"
              data-testid="paper-sheet"
            >
              <div className="sheet-head">
                <span>{project}</span>
                <span />
              </div>
              <div className="blank-note">
                <Quote size={20} strokeWidth={1.25} aria-hidden="true" />
                <p>项目的 chapters/ 文件夹里还没有章节。</p>
                <p className="sub">
                  写好的章节，或你在别的编辑器里放进去的稿子，都会显示在这里（纸面只读）。
                </p>
              </div>
              <footer className="sheet-foot">· 1 ·</footer>
            </article>
          ))}

        {tab === "outline" && (
          <Soft
            icon={<ListTree size={22} strokeWidth={1.25} />}
            title="大纲尚未建立"
            text="纲领完成问询后，章节大纲、悬念线与设定词典会列在这里。"
          />
        )}
        {tab === "facts" && <FactsPanel />}
      </div>
    </section>
  );
}

function EditableSheet({
  paper,
  busy,
  activeChapter,
  sessionId,
  onSaved,
}: {
  paper: NonNullable<ReturnType<typeof useWorkbench.getState>["paper"]>;
  busy: boolean;
  activeChapter: string | null;
  sessionId: string;
  onSaved: () => void;
}) {
  const [editing, setEditingState] = useState(false);
  const setPaperEditing = useWorkbench((s) => s.setPaperEditing);
  const setEditing = (value: boolean) => {
    setEditingState(value);
    setPaperEditing(value);
  };
  // 离开纸面或切走时清掉“编辑中”标记，免得章节导航一直被锁
  useEffect(() => () => useWorkbench.getState().setPaperEditing(false), []);
  const lossless = isLosslessMarkdown(paper.source ?? "");
  const [status, setStatus] = useState<
    "saved" | "dirty" | "saving" | "conflict" | "error"
  >("saved");
  const [conflict, setConflict] = useState<{
    latest: string;
    latestHash: string;
  } | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [revisions, setRevisions] = useState(0);
  // 编辑器当前内容与“已落盘/刚载入”的内容一致时不算有修改；
  // 载入内容、切换可编辑状态都会触发 update，不能据此判定为待保存。
  const syncedMarkdown = useRef<string | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        bulletList: false,
        orderedList: false,
      }),
    ],
    content: markdownToHtml(
      paper.source ?? paper.paragraphs.map((p) => p.text).join("\n\n"),
    ),
    editable: false,
    editorProps: { attributes: { class: "paper-editor-content" } },
    onUpdate: ({ editor: current }) => {
      const markdown = htmlToMarkdown(current.getHTML());
      setStatus((previous) =>
        previous === "conflict" || previous === "saving"
          ? previous
          : markdown === syncedMarkdown.current
            ? "saved"
            : "dirty",
      );
    },
  });
  const baselineHash = useRef(paper.contentHash);

  useEffect(() => {
    if (!editing) baselineHash.current = paper.contentHash;
  }, [editing, paper.contentHash]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editing && !busy);
    if (!editing) {
      editor.commands.setContent(markdownToHtml(paper.source ?? ""), {
        emitUpdate: false,
      });
      syncedMarkdown.current = htmlToMarkdown(
        markdownToHtml(paper.source ?? ""),
      );
      setStatus("saved");
    }
  }, [editor, editing, busy, paper.source]);

  useEffect(() => {
    const projectId = useWorkbench.getState().project.id;
    if (!activeChapter || !projectId || !window.wordhub) return;
    void window.wordhub
      .invoke("chapter.revisions", {
        projectId,
        path: activeChapter,
      })
      .then((result) => setRevisions(result.revisions.length))
      .catch(() => undefined);
  }, [activeChapter]);

  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void finishRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing]);

  useEffect(() => {
    if (!editor || !editing || busy || status !== "dirty" || !activeChapter)
      return;
    const timer = window.setTimeout(() => void save(), 1200);
    return () => window.clearTimeout(timer);
  }, [editor, editing, busy, status, activeChapter]);

  const inflightSave = useRef<Promise<boolean> | null>(null);
  /** 同一时刻只关心最近一次保存；退出编辑要等它结束。 */
  function save(expectedHash = baselineHash.current ?? null): Promise<boolean> {
    const promise: Promise<boolean> = doSave(expectedHash).finally(() => {
      if (inflightSave.current === promise) inflightSave.current = null;
    });
    inflightSave.current = promise;
    return promise;
  }
  async function doSave(expectedHash: string | null): Promise<boolean> {
    if (!editor || !activeChapter || busy) return false;
    setStatus("saving");
    try {
      const content = htmlToMarkdown(editor.getHTML());
      const writeResult = await window.wordhub.invoke("chapter.write", {
        projectId: useWorkbench.getState().project.id!,
        path: activeChapter,
        content,
        expectedHash,
        sessionId,
      });
      setStatus("saved");
      syncedMarkdown.current = content;
      baselineHash.current = writeResult.contentHash;
      setConflict(null);
      await onSaved();
      const revisionResult = await window.wordhub.invoke("chapter.revisions", {
        projectId: useWorkbench.getState().project.id!,
        path: activeChapter,
      });
      setRevisions(revisionResult.revisions.length);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes("外部修改")) {
        const latest = await window.wordhub.invoke("chapter.read", {
          projectId: useWorkbench.getState().project.id!,
          path: activeChapter,
        });
        setConflict({ latest: latest.content, latestHash: latest.contentHash });
        setShowDiff(false);
        setStatus("conflict");
      } else setStatus("error");
      return false;
    }
  }

  /** 退出编辑前先把未保存的修改写盘；写不进去（冲突、运行中、失败）就留在编辑状态，不丢稿。 */
  async function finishEditing() {
    // 点“完成”时保存可能正在进行：等它结束，失败（冲突、运行中、出错）就留在编辑状态
    if (inflightSave.current && !(await inflightSave.current)) return;
    if (!inflightSave.current && status === "conflict") return;
    // 以内容是否与已落盘一致为准，而不是 UI 状态（状态更新是异步的）
    if (editor && htmlToMarkdown(editor.getHTML()) !== syncedMarkdown.current)
      if (!(await save())) return;
    setEditing(false);
    setStatus("saved");
  }
  const finishRef = useRef(finishEditing);
  finishRef.current = finishEditing;

  async function loadLatest() {
    if (!activeChapter) return;
    const latest = conflict
      ? conflict.latest
      : (
          await window.wordhub.invoke("chapter.read", {
            projectId: useWorkbench.getState().project.id!,
            path: activeChapter,
          })
        ).content;
    editor?.commands.setContent(markdownToHtml(latest), { emitUpdate: false });
    syncedMarkdown.current = htmlToMarkdown(markdownToHtml(latest));
    if (conflict) baselineHash.current = conflict.latestHash;
    setConflict(null);
    setStatus("saved");
  }

  async function keepMine() {
    if (!conflict) return;
    await save(conflict.latestHash);
  }

  async function undo() {
    if (!activeChapter || !window.wordhub) return;
    try {
      await window.wordhub.invoke("chapter.undo", {
        projectId: useWorkbench.getState().project.id!,
        path: activeChapter,
        sessionId,
      });
      await onSaved();
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return (
    <>
      <div className="paper-edit-toolbar">
        {!editing ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !lossless}
            title={
              lossless
                ? "直接在纸面上修改，自动保存"
                : "本章含编辑器会改写的写法（如 __粗体__、多行引用），为避免改动原文，请在外部编辑器修改"
            }
            onClick={() => setEditing(true)}
            data-testid="edit-paper"
          >
            编辑
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => void finishEditing()}
            data-testid="finish-edit"
          >
            完成
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy || editing || revisions < 2}
          onClick={() => void undo()}
          title="以新 revision 撤销到上一版本"
        >
          <Undo2 size={14} />
          撤销
        </button>
        <span className={`save-state save-${status}`} role="status">
          {busy
            ? "纲领/写手/编辑/评审/史官正在写入，本章暂时只读"
            : status === "saving"
              ? "保存中…"
              : status === "dirty"
                ? "待保存"
                : status === "conflict"
                  ? "检测到冲突"
                  : status === "error"
                    ? "保存失败"
                    : "已保存"}
        </span>
      </div>
      {conflict && (
        <div
          className="paper-conflict"
          role="alert"
          data-testid="paper-conflict"
        >
          <strong>磁盘上的章节已被外部或 Agent 修改。</strong>
          <span>你的内容仍保留在编辑器中，请选择处理方式。</span>
          <div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void keepMine()}
            >
              保留我的版本
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void loadLatest()}
            >
              载入新版本
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setShowDiff(true)}
            >
              查看差异
            </button>
          </div>
          {showDiff && (
            <pre>{`--- 磁盘版本\n${conflict.latest}\n--- 你的版本\n${editor ? htmlToMarkdown(editor.getHTML()) : ""}`}</pre>
          )}
        </div>
      )}
      {editing ? (
        <EditorContent editor={editor} className="prose paper-editor" />
      ) : (
        <div className="prose" data-testid="paper-reading">
          {paper.paragraphs.map((p) => (
            <p
              key={p.id}
              className={`${p.author ? "revised" : ""} ${p.flag ? "flagged" : ""}`}
              style={
                p.author
                  ? ({
                      "--author": agentById(p.author).color,
                    } as CSSProperties)
                  : undefined
              }
              data-author={p.author}
            >
              {p.text}
              {p.flag && (
                <span
                  className="margin-pin tip"
                  data-tip="评审提出了未决质询"
                  aria-label="评审质询"
                >
                  审
                </span>
              )}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

const STATUS_LABELS: Record<NovelFact["status"], string> = {
  proposed: "待确认",
  confirmed: "已确认",
  rejected: "已驳回",
};

function FactsPanel() {
  const facts = useWorkbench((s) => s.facts);
  const summaries = useWorkbench((s) => s.summaries);
  const decide = useWorkbench((s) => s.decideFact);
  const [onlyPending, setOnlyPending] = useState(false);
  const visible = facts.filter(
    (fact) => !onlyPending || fact.status === "proposed",
  );
  if (facts.length === 0 && summaries.length === 0)
    return (
      <Soft
        icon={<BookOpenText size={22} strokeWidth={1.25} />}
        title="还没有事实"
        text="章节定稿时，史官会把人物状态、新名词与伏笔整理成待确认的候选事实，由你确认或驳回。"
      />
    );
  const chapters = [
    ...new Set([
      ...visible.map((fact) => fact.chapter),
      ...(onlyPending ? [] : summaries.map((item) => item.chapter)),
    ]),
  ].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  return (
    <div className="facts-panel" data-testid="facts-panel">
      <div className="facts-toolbar">
        <label>
          <input
            type="checkbox"
            checked={onlyPending}
            onChange={(event) => setOnlyPending(event.target.checked)}
          />
          只看待确认
        </label>
        <span className="facts-hint">
          只有“已确认”的事实会作为评审的硬校验依据。
        </span>
      </div>
      {chapters.map((chapter) => {
        const summary = summaries.find((item) => item.chapter === chapter);
        return (
          <section key={chapter} className="facts-chapter">
            <h4>
              {chapter.replace(/^chapters\//u, "").replace(/\.[^.]+$/u, "")}
            </h4>
            {summary && <p className="facts-summary">{summary.text}</p>}
            <ul>
              {visible
                .filter((fact) => fact.chapter === chapter)
                .map((fact) => (
                  <li
                    key={fact.id}
                    className={`fact fact-${fact.status}`}
                    data-testid="fact"
                  >
                    <div className="fact-head">
                      <span className="tag">{FACT_KIND_LABELS[fact.kind]}</span>
                      <strong>
                        {fact.kind === "relation"
                          ? `${fact.subject} →${fact.relation}→ ${fact.object}`
                          : fact.subject}
                      </strong>
                      <span className="fact-status">
                        {STATUS_LABELS[fact.status]}
                      </span>
                    </div>
                    <p>{fact.statement}</p>
                    <q className="fact-quote">{fact.quote}</q>
                    {fact.note && <p className="fact-note">{fact.note}</p>}
                    <div className="fact-actions">
                      {fact.status !== "confirmed" && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => void decide(fact.id, "confirm")}
                        >
                          确认
                        </button>
                      )}
                      {fact.status !== "rejected" && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void decide(fact.id, "reject")}
                        >
                          驳回
                        </button>
                      )}
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Soft({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="soft-empty">
      <span className="soft-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
