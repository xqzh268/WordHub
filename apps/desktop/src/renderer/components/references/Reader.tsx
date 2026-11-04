import { ArrowLeft, Quote, Star, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnnotationColor,
  AnnotationPayload,
  CollectionPayload,
  CommandResults,
  ReferencePatchPayload,
} from "@wordhub/contracts";
import { BookInfo } from "./BookInfo";
import { type Book, segmentsFor, textRows } from "./model";

type Chapter = CommandResults["reference.read"];
export type Panel = "none" | "annotations" | "info";

const COLORS: Array<{ id: AnnotationColor; label: string }> = [
  { id: "yellow", label: "黄" },
  { id: "green", label: "绿" },
  { id: "blue", label: "蓝" },
  { id: "pink", label: "粉" },
];

/** 选区在整章文本里的 [start, end)；选区不在阅读区内返回 null。 */
function selectionRange(
  container: HTMLElement,
): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
    return null;
  const range = selection.getRangeAt(0);
  if (
    !container.contains(range.startContainer) ||
    !container.contains(range.endContainer)
  )
    return null;
  const paragraphOf = (node: Node): HTMLElement | null =>
    (node.nodeType === 1
      ? (node as Element)
      : node.parentElement
    )?.closest<HTMLElement>("[data-offset]") ?? null;
  const first = paragraphOf(range.startContainer);
  const last = paragraphOf(range.endContainer);
  if (!first || !last) return null;
  const within = (
    paragraph: HTMLElement,
    node: Node,
    offset: number,
  ): number => {
    const probe = document.createRange();
    probe.selectNodeContents(paragraph);
    probe.setEnd(node, offset);
    return probe.toString().length;
  };
  const start =
    Number(first.dataset.offset) +
    within(first, range.startContainer, range.startOffset);
  const end =
    Number(last.dataset.offset) +
    within(last, range.endContainer, range.endOffset);
  return end > start ? { start, end } : null;
}

export type ReaderProps = {
  book: Book;
  chapter: Chapter | null;
  annotations: AnnotationPayload[];
  collections: CollectionPayload[];
  highlight: { chapterId: string; offset: number; length: number } | null;
  panel: Panel;
  setPanel: (panel: Panel) => void;
  onBack: () => void;
  onOpenChapter: (
    chapterId: string,
    mark?: { offset: number; length: number },
  ) => void;
  onAsk: (quote: string, source: string) => void;
  onCopy: (quote: string, source: string) => void;
  onSample: (range: { start: number; end: number }) => void;
  onAddAnnotation: (
    range: { start: number; end: number },
    color: AnnotationColor,
    note?: string,
  ) => Promise<void>;
  onUpdateAnnotation: (
    id: string,
    patch: { note?: string | null; color?: AnnotationColor },
  ) => Promise<void>;
  onDeleteAnnotation: (id: string) => Promise<void>;
  onSave: (patch: ReferencePatchPayload) => Promise<void>;
};

export function Reader(props: ReaderProps) {
  const { book, chapter, annotations, panel } = props;
  const reader = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [noting, setNoting] = useState<string | null>(null);
  const [activeAnnotation, setActiveAnnotation] = useState<string | null>(null);

  const rows = useMemo(
    () => (chapter ? textRows(chapter.text) : []),
    [chapter],
  );
  const here = useMemo(
    () =>
      annotations.filter((a) => chapter && a.chapterId === chapter.chapterId),
    [annotations, chapter],
  );
  const chapterIndex = book.chapters.findIndex(
    (c) => c.id === chapter?.chapterId,
  );
  const source = chapter
    ? `《${chapter.referenceTitle}》${chapter.chapterTitle}`
    : "";
  const quoted =
    chapter && selection
      ? chapter.text.slice(selection.start, selection.end)
      : "";

  // 选区变化与点击高亮：阅读区是只读文本，用原生事件监听，不在 JSX 上挂事件
  useEffect(() => {
    const container = reader.current;
    if (!container) return;
    const capture = () => {
      const range = selectionRange(container);
      setSelection(range);
      if (!range) setNoting(null);
    };
    const click = (event: MouseEvent) => {
      const target = (event.target as Element | null)?.closest<HTMLElement>(
        "[data-annotation]",
      );
      if (target && window.getSelection()?.isCollapsed !== false) {
        setActiveAnnotation(target.dataset.annotation ?? null);
        props.setPanel("annotations");
      }
    };
    container.addEventListener("mouseup", capture);
    container.addEventListener("keyup", capture);
    container.addEventListener("click", click);
    return () => {
      container.removeEventListener("mouseup", capture);
      container.removeEventListener("keyup", capture);
      container.removeEventListener("click", click);
    };
  }, [chapter, props.setPanel]);

  // 切章时清掉选区；跳到检索命中或被选中的批注
  useEffect(() => {
    setSelection(null);
    setNoting(null);
  }, [chapter?.chapterId]);
  useEffect(() => {
    const container = reader.current;
    if (!container) return;
    const target =
      (activeAnnotation &&
        container.querySelector(`[data-annotation="${activeAnnotation}"]`)) ||
      container.querySelector("mark");
    target?.scrollIntoView({ block: "center" });
  }, [chapter, props.highlight, activeAnnotation]);

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setNoting(null);
  };

  return (
    <div className={`reader panel-${panel}`} data-testid="reader">
      <aside className="reader-toc" aria-label="目录">
        <button
          type="button"
          className="btn reader-back"
          onClick={props.onBack}
          aria-label="返回书架"
          data-testid="reader-back"
        >
          <ArrowLeft size={14} strokeWidth={1.5} /> 书架
        </button>
        <h2 className="reader-book-title">{book.title}</h2>
        {book.author && <p className="refs-note">{book.author}</p>}
        <ol className="refs-chapters" aria-label="章节">
          {book.chapters.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={chapter?.chapterId === item.id ? "on" : ""}
                onClick={() => props.onOpenChapter(item.id)}
              >
                {item.title}
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <section className="reader-main" aria-label="阅读">
        <header className="refs-reader-head">
          <div>
            <small>
              《{book.title}》 · {chapterIndex + 1}/{book.chapters.length}
            </small>
            <h2>{chapter?.chapterTitle ?? ""}</h2>
          </div>
          <div className="refs-step">
            <button
              type="button"
              className={`icon-btn sm book-star ${book.favorite ? "on" : ""}`}
              aria-label={book.favorite ? "取消收藏" : "收藏"}
              aria-pressed={book.favorite}
              onClick={() => void props.onSave({ favorite: !book.favorite })}
            >
              <Star
                size={15}
                strokeWidth={1.5}
                fill={book.favorite ? "currentColor" : "none"}
              />
            </button>
            <button
              type="button"
              className="btn"
              disabled={chapterIndex <= 0}
              onClick={() =>
                props.onOpenChapter(book.chapters[chapterIndex - 1]?.id ?? "")
              }
            >
              上一章
            </button>
            <button
              type="button"
              className="btn"
              disabled={
                chapterIndex < 0 || chapterIndex >= book.chapters.length - 1
              }
              onClick={() =>
                props.onOpenChapter(book.chapters[chapterIndex + 1]?.id ?? "")
              }
            >
              下一章
            </button>
            <button
              type="button"
              className={`btn ${panel === "annotations" ? "active" : ""}`}
              aria-pressed={panel === "annotations"}
              onClick={() =>
                props.setPanel(panel === "annotations" ? "none" : "annotations")
              }
              data-testid="panel-annotations-toggle"
            >
              批注 {annotations.length}
            </button>
            <button
              type="button"
              className={`btn ${panel === "info" ? "active" : ""}`}
              aria-pressed={panel === "info"}
              onClick={() => props.setPanel(panel === "info" ? "none" : "info")}
              data-testid="panel-info-toggle"
            >
              信息
            </button>
          </div>
        </header>

        {selection && chapter && (
          <div
            className="refs-actions"
            role="toolbar"
            aria-label="选段操作"
            data-testid="ref-actions"
          >
            <span>已选 {selection.end - selection.start} 字</span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                props.onAsk(quoted, source);
                clearSelection();
              }}
              data-testid="ref-ask"
            >
              <Quote size={13} strokeWidth={1.5} /> 提问
            </button>
            <span className="hl-picks" role="group" aria-label="高亮颜色">
              {COLORS.map((color) => (
                <button
                  key={color.id}
                  type="button"
                  className={`hl-dot ${color.id}`}
                  aria-label={`高亮（${color.label}）`}
                  data-testid={`hl-${color.id}`}
                  onClick={() =>
                    void props
                      .onAddAnnotation(selection, color.id)
                      .then(clearSelection)
                  }
                />
              ))}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => setNoting(noting === null ? "" : null)}
              data-testid="ref-note-toggle"
            >
              批注…
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                props.onSample(selection);
                clearSelection();
              }}
              data-testid="ref-sample"
            >
              作为文风示范
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => props.onCopy(quoted, source)}
            >
              复制引用
            </button>
            {noting !== null && (
              <form
                className="note-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void props
                    .onAddAnnotation(selection, "yellow", noting)
                    .then(clearSelection);
                }}
              >
                <textarea
                  className="text-input"
                  rows={2}
                  value={noting}
                  onChange={(event) => setNoting(event.target.value)}
                  placeholder="写下你的批注（会同时高亮这段）"
                  aria-label="批注内容"
                  data-testid="note-input"
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  data-testid="note-save"
                >
                  保存批注
                </button>
              </form>
            )}
          </div>
        )}

        <div ref={reader} className="refs-text prose" data-testid="ref-text">
          {rows.map((row) => (
            <p key={row.offset} data-offset={row.offset}>
              {segmentsFor(
                row.text,
                row.offset,
                here,
                props.highlight &&
                  chapter &&
                  props.highlight.chapterId === chapter.chapterId
                  ? props.highlight
                  : null,
              ).map((segment, index) => {
                const key = `${row.offset}-${index}`;
                if (segment.annotationIds.length > 0)
                  return (
                    <span
                      key={key}
                      className={`hl ${segment.color ?? "yellow"} ${segment.annotationIds.includes(activeAnnotation ?? "") ? "active" : ""}`}
                      data-annotation={segment.annotationIds[0]}
                    >
                      {segment.search ? (
                        <mark>{segment.text}</mark>
                      ) : (
                        segment.text
                      )}
                    </span>
                  );
                return segment.search ? (
                  <mark key={key}>{segment.text}</mark>
                ) : (
                  <span key={key}>{segment.text}</span>
                );
              })}
            </p>
          ))}
        </div>
      </section>

      {panel !== "none" && (
        <aside
          className="reader-panel"
          aria-label={panel === "info" ? "书籍信息" : "批注"}
        >
          {panel === "info" ? (
            <BookInfo
              book={book}
              collections={props.collections}
              onSave={props.onSave}
            />
          ) : (
            <AnnotationList
              book={book}
              annotations={annotations}
              active={activeAnnotation}
              onJump={(a) => {
                setActiveAnnotation(a.id);
                props.onOpenChapter(a.chapterId);
              }}
              onUpdate={props.onUpdateAnnotation}
              onDelete={props.onDeleteAnnotation}
            />
          )}
        </aside>
      )}
    </div>
  );
}

function AnnotationList({
  book,
  annotations,
  active,
  onJump,
  onUpdate,
  onDelete,
}: {
  book: Book;
  annotations: AnnotationPayload[];
  active: string | null;
  onJump: (annotation: AnnotationPayload) => void;
  onUpdate: ReaderProps["onUpdateAnnotation"];
  onDelete: ReaderProps["onDeleteAnnotation"];
}) {
  if (annotations.length === 0)
    return (
      <p className="refs-note" data-testid="annotations-empty">
        还没有批注。在阅读区选中文字，点颜色圆点高亮，或点“批注…”写下想法。
      </p>
    );
  const titleOf = (chapterId: string) =>
    book.chapters.find((c) => c.id === chapterId)?.title ?? chapterId;
  return (
    <ul className="annotation-list" role="list" data-testid="annotation-list">
      {annotations.map((annotation) => (
        <li
          key={annotation.id}
          className={annotation.id === active ? "active" : ""}
          data-testid={`annotation-${annotation.id}`}
        >
          <button
            type="button"
            className="annotation-quote"
            onClick={() => onJump(annotation)}
          >
            <i className={`hl-dot ${annotation.color}`} aria-hidden="true" />
            <small>{titleOf(annotation.chapterId)}</small>
            <span>
              {annotation.quote.length > 120
                ? `${annotation.quote.slice(0, 120)}…`
                : annotation.quote}
            </span>
          </button>
          <textarea
            className="text-input"
            rows={2}
            defaultValue={annotation.note ?? ""}
            placeholder="批注（可空）"
            aria-label="批注内容"
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next !== (annotation.note ?? ""))
                void onUpdate(annotation.id, { note: next || null });
            }}
          />
          <div className="annotation-tools">
            <span className="hl-picks" role="group" aria-label="改颜色">
              {COLORS.map((color) => (
                <button
                  key={color.id}
                  type="button"
                  className={`hl-dot ${color.id} ${annotation.color === color.id ? "on" : ""}`}
                  aria-label={`改成${color.label}色`}
                  onClick={() =>
                    void onUpdate(annotation.id, { color: color.id })
                  }
                />
              ))}
            </span>
            <button
              type="button"
              className="icon-btn sm"
              aria-label="删除这条批注"
              onClick={() => void onDelete(annotation.id)}
            >
              <Trash2 size={13} strokeWidth={1.5} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
