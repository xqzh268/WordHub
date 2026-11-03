import { BookMarked, FilePlus2, Quote, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommandResults } from "@wordhub/contracts";
import { cleanIpcError } from "../lib/errors";
import { useWorkbench } from "../state/store";

type Reference = CommandResults["reference.list"]["references"][number];
type Chapter = CommandResults["reference.read"];
type Hit = CommandResults["reference.search"]["hits"][number];
type Samples = CommandResults["reference.styleSamples"];

const FORMAT_LABEL: Record<Reference["format"], string> = {
  txt: "TXT",
  md: "MD",
  epub: "EPUB",
  docx: "DOCX",
  pdf: "PDF",
};

const formatChars = (chars: number): string =>
  chars >= 10000 ? `${(chars / 10000).toFixed(1)} 万字` : `${chars} 字`;

/** 把章节文本按行拆开，并记住每行在整章文本里的起始偏移，选段时用来换算区间。 */
function lines(text: string): Array<{ offset: number; text: string }> {
  const out: Array<{ offset: number; text: string }> = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    if (line.trim()) out.push({ offset, text: line });
    offset += line.length + 1;
  }
  return out;
}

/** 选区在整章文本里的 [start, end)；选区不在阅读区内返回 null。 */
function selectionRange(
  container: HTMLElement,
): { start: number; end: number; quote: string } | null {
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
  return end > start ? { start, end, quote: "" } : null;
}

export function ReferencesView() {
  const folder = useWorkbench((s) => s.project.folder);
  const [references, setReferences] = useState<Reference[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searchAll, setSearchAll] = useState(true);
  const [highlight, setHighlight] = useState<{
    chapterId: string;
    offset: number;
    length: number;
  } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [samples, setSamples] = useState<Samples | null>(null);
  const [showSamples, setShowSamples] = useState(false);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const reader = useRef<HTMLDivElement>(null);

  const active = references.find((item) => item.id === activeId) ?? null;

  const reload = useCallback(async () => {
    if (!window.wordhub || !folder) return;
    try {
      const [list, styles] = await Promise.all([
        window.wordhub.invoke("reference.list", undefined),
        window.wordhub.invoke("reference.styleSamples", undefined),
      ]);
      setReferences(list.references);
      setSamples(styles);
      setActiveId((current) =>
        current && list.references.some((item) => item.id === current)
          ? current
          : (list.references[0]?.id ?? null),
      );
    } catch (error) {
      setMessage({ ok: false, text: cleanIpcError(error) });
    }
  }, [folder]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const openChapter = useCallback(
    async (
      referenceId: string,
      chapterId: string,
      mark?: { offset: number; length: number },
    ) => {
      if (!window.wordhub) return;
      try {
        const result = await window.wordhub.invoke("reference.read", {
          referenceId,
          chapterId,
        });
        setChapter(result);
        setSelection(null);
        setHighlight(mark ? { chapterId, ...mark } : null);
        setActiveId(referenceId);
      } catch (error) {
        setMessage({ ok: false, text: cleanIpcError(error) });
      }
    },
    [],
  );

  // 切换资料时默认打开第一章
  useEffect(() => {
    if (active && chapter?.referenceId !== active.id && active.chapters[0])
      void openChapter(active.id, active.chapters[0].id);
    if (!active) setChapter(null);
  }, [active, chapter?.referenceId, openChapter]);

  // 跳到检索命中处
  useEffect(() => {
    if (!highlight || chapter?.chapterId !== highlight.chapterId) return;
    reader.current?.querySelector("mark")?.scrollIntoView({ block: "center" });
  }, [highlight, chapter]);

  const importFiles = async () => {
    if (!window.wordhub) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.wordhub.invoke("reference.import", undefined);
      if (result.canceled) return;
      await reload();
      const fresh = result.imported.filter((item) => !item.duplicate);
      const dup = result.imported.filter((item) => item.duplicate);
      const parts = [
        fresh.length
          ? `已导入 ${fresh.length} 份：${fresh.map((i) => `《${i.title}》`).join("、")}`
          : "",
        dup.length ? `${dup.length} 份已经在库里（未重复导入）` : "",
        ...result.failed.map((item) => `${item.name} 导入失败：${item.error}`),
      ].filter(Boolean);
      setMessage({ ok: result.failed.length === 0, text: parts.join("；") });
      if (fresh[0]) setActiveId(fresh[0].id);
    } catch (error) {
      setMessage({ ok: false, text: cleanIpcError(error) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (reference: Reference) => {
    if (!window.wordhub) return;
    if (
      !window.confirm(
        `从参考库删除《${reference.title}》？项目里的解析文本和原件副本都会删除（你电脑上的原文件不受影响）。`,
      )
    )
      return;
    try {
      await window.wordhub.invoke("reference.delete", {
        referenceId: reference.id,
      });
      if (chapter?.referenceId === reference.id) setChapter(null);
      await reload();
    } catch (error) {
      setMessage({ ok: false, text: cleanIpcError(error) });
    }
  };

  const search = async () => {
    if (!window.wordhub || !query.trim()) {
      setHits(null);
      return;
    }
    try {
      const result = await window.wordhub.invoke("reference.search", {
        query: query.trim(),
        referenceId: searchAll ? undefined : (activeId ?? undefined),
      });
      setHits(result.hits);
    } catch (error) {
      setMessage({ ok: false, text: cleanIpcError(error) });
    }
  };

  // 选区变化用原生事件监听（阅读区是只读文本，不是交互控件，不在 JSX 上挂事件）
  useEffect(() => {
    const container = reader.current;
    if (!container) return;
    const capture = () => {
      const range = selectionRange(container);
      setSelection(range ? { start: range.start, end: range.end } : null);
    };
    container.addEventListener("mouseup", capture);
    container.addEventListener("keyup", capture);
    return () => {
      container.removeEventListener("mouseup", capture);
      container.removeEventListener("keyup", capture);
    };
  }, [chapter]);
  const quoted =
    chapter && selection
      ? chapter.text.slice(selection.start, selection.end)
      : "";
  const source = chapter
    ? `《${chapter.referenceTitle}》${chapter.chapterTitle}`
    : "";

  const ask = () => {
    if (!quoted) return;
    const store = useWorkbench.getState();
    store.setComposer(
      `> ${quoted.replaceAll("\n", "\n> ")}\n> ——${source}\n\n`,
    );
    store.setView("workspace");
  };
  const copyCitation = async () => {
    if (!quoted) return;
    await navigator.clipboard
      .writeText(`“${quoted}”——${source}`)
      .then(() => setMessage({ ok: true, text: "已复制引用" }))
      .catch(() => setMessage({ ok: false, text: "复制失败" }));
  };
  const addSample = async () => {
    if (!window.wordhub || !chapter || !selection) return;
    try {
      const result = await window.wordhub.invoke("reference.addStyleSample", {
        referenceId: chapter.referenceId,
        chapterId: chapter.chapterId,
        start: selection.start,
        end: selection.end,
      });
      setMessage({
        ok: true,
        text: `已加入文风示范（现有 ${result.count} 段）`,
      });
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      await reload();
    } catch (error) {
      setMessage({ ok: false, text: cleanIpcError(error) });
    }
  };
  const removeSample = async (index: number) => {
    if (!window.wordhub) return;
    try {
      await window.wordhub.invoke("reference.removeStyleSample", { index });
      await reload();
    } catch (error) {
      setMessage({ ok: false, text: cleanIpcError(error) });
    }
  };

  const rows = useMemo(() => (chapter ? lines(chapter.text) : []), [chapter]);
  const chapterIndex =
    active?.chapters.findIndex((c) => c.id === chapter?.chapterId) ?? -1;
  const step = (delta: number) => {
    const target = active?.chapters[chapterIndex + delta];
    if (active && target) void openChapter(active.id, target.id);
  };
  const sampleCount = samples?.samples.length ?? 0;
  const sampleLimit = samples?.limits.count ?? 5;

  if (!folder)
    return (
      <div className="page selectable" data-testid="references">
        <div className="page-inner narrow coming">
          <span className="coming-icon">
            <BookMarked size={26} strokeWidth={1.25} aria-hidden="true" />
          </span>
          <h1>参考库</h1>
          <p className="lead">
            先链接写作文件夹：参考资料保存在项目的 .wordhub/references/ 里。
          </p>
        </div>
      </div>
    );

  return (
    <div className="refs" data-testid="references">
      <aside className="refs-side" aria-label="参考资料">
        <header className="refs-head">
          <h1>参考库</h1>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void importFiles()}
            disabled={busy}
            data-testid="ref-import"
          >
            <FilePlus2 size={14} strokeWidth={1.5} /> 导入
          </button>
        </header>
        <p className="refs-note">
          资料只保存在项目文件夹里，不会上传。向 Agent
          提问时，所选文字会发给你配置的模型服务商。
        </p>
        {message && (
          <p
            className={`refs-message ${message.ok ? "ok" : "bad"}`}
            role={message.ok ? "status" : "alert"}
            data-testid="ref-message"
          >
            {message.text}
          </p>
        )}
        <form
          className="refs-search"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <Search size={14} strokeWidth={1.5} aria-hidden="true" />
          <input
            className="text-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="全文检索"
            aria-label="检索参考库"
            data-testid="ref-search"
          />
          <label className="check-inline" title="取消勾选则只在当前这本里找">
            <input
              type="checkbox"
              checked={searchAll}
              onChange={(event) => setSearchAll(event.target.checked)}
              aria-label="在全部资料中检索"
            />
            全部
          </label>
        </form>
        {hits && (
          <ul
            className="refs-hits"
            data-testid="ref-hits"
            aria-label="检索结果"
          >
            {hits.length === 0 && <li className="empty">没有找到。</li>}
            {hits.map((hit, index) => (
              <li
                key={`${hit.referenceId}-${hit.chapterId}-${hit.offset}-${index}`}
              >
                <button
                  type="button"
                  onClick={() =>
                    void openChapter(hit.referenceId, hit.chapterId, {
                      offset: hit.offset,
                      length: query.trim().length,
                    })
                  }
                >
                  <small>
                    《{hit.referenceTitle}》{hit.chapterTitle}
                  </small>
                  <span>{hit.snippet}</span>
                </button>
              </li>
            ))}
            {hits.length >= 100 && (
              <li className="empty">只显示前 100 条，请换更具体的词。</li>
            )}
          </ul>
        )}
        <ul className="refs-list" role="list">
          {references.length === 0 && (
            <li className="empty" data-testid="ref-empty">
              还没有资料。点“导入”添加 TXT、Markdown、EPUB、DOCX 或带文字层的
              PDF。
            </li>
          )}
          {references.map((reference) => (
            <li
              key={reference.id}
              className={reference.id === activeId ? "active" : ""}
              data-testid={`ref-${reference.id}`}
            >
              <button
                type="button"
                className="ref-card"
                onClick={() => setActiveId(reference.id)}
              >
                <strong>{reference.title}</strong>
                <span>
                  {reference.author ? `${reference.author} · ` : ""}
                  {FORMAT_LABEL[reference.format]} · {reference.chapters.length}{" "}
                  章 · {formatChars(reference.totalChars)}
                </span>
              </button>
              <button
                type="button"
                className="icon-btn sm"
                aria-label={`删除《${reference.title}》`}
                onClick={() => void remove(reference)}
              >
                <Trash2 size={14} strokeWidth={1.5} />
              </button>
              {reference.id === activeId && (
                <ol className="refs-chapters" aria-label="章节">
                  {reference.chapters.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={
                          chapter?.chapterId === item.id &&
                          chapter.referenceId === reference.id
                            ? "on"
                            : ""
                        }
                        onClick={() => void openChapter(reference.id, item.id)}
                      >
                        {item.title}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn refs-samples-toggle"
          onClick={() => setShowSamples(!showSamples)}
          aria-expanded={showSamples}
          data-testid="ref-samples-toggle"
        >
          文风示范 {sampleCount}/{sampleLimit}
        </button>
        {showSamples && (
          <div className="refs-samples" data-testid="ref-samples">
            <p className="refs-note">
              作者认可的片段。写手、编辑、纲领写作时会参考它的笔法与节奏，但不得照抄情节与原句。
            </p>
            {samples?.samples.length === 0 && (
              <p className="empty">
                还没有。在阅读区选中一段文字，点“作为文风示范”。
              </p>
            )}
            {samples?.samples.map((sample, index) => (
              <figure key={`${sample.source}-${index}`}>
                <figcaption>
                  {sample.source}
                  <button
                    type="button"
                    className="icon-btn sm"
                    aria-label={`移除第 ${index + 1} 段示范`}
                    onClick={() => void removeSample(index)}
                  >
                    <X size={13} strokeWidth={1.5} />
                  </button>
                </figcaption>
                <blockquote>{sample.text}</blockquote>
              </figure>
            ))}
          </div>
        )}
      </aside>

      <section className="refs-reader" aria-label="阅读">
        {chapter ? (
          <>
            <header className="refs-reader-head">
              <div>
                <small>
                  《{chapter.referenceTitle}》 · {chapterIndex + 1}/
                  {active?.chapters.length ?? "?"}
                </small>
                <h2>{chapter.chapterTitle}</h2>
              </div>
              <div className="refs-step">
                <button
                  type="button"
                  className="btn"
                  disabled={chapterIndex <= 0}
                  onClick={() => step(-1)}
                >
                  上一章
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={
                    !active || chapterIndex >= active.chapters.length - 1
                  }
                  onClick={() => step(1)}
                >
                  下一章
                </button>
              </div>
            </header>
            {selection && (
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
                  onClick={ask}
                  data-testid="ref-ask"
                >
                  <Quote size={13} strokeWidth={1.5} /> 提问
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void addSample()}
                  data-testid="ref-sample"
                >
                  作为文风示范
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void copyCitation()}
                >
                  复制引用
                </button>
              </div>
            )}
            <div
              ref={reader}
              className="refs-text prose"
              data-testid="ref-text"
            >
              {rows.map((row) => {
                const mark =
                  highlight &&
                  highlight.chapterId === chapter.chapterId &&
                  highlight.offset >= row.offset &&
                  highlight.offset < row.offset + row.text.length
                    ? highlight.offset - row.offset
                    : -1;
                return (
                  <p key={row.offset} data-offset={row.offset}>
                    {mark >= 0 ? (
                      <>
                        {row.text.slice(0, mark)}
                        <mark>
                          {row.text.slice(
                            mark,
                            mark + (highlight?.length ?? 0),
                          )}
                        </mark>
                        {row.text.slice(mark + (highlight?.length ?? 0))}
                      </>
                    ) : (
                      row.text
                    )}
                  </p>
                );
              })}
            </div>
          </>
        ) : (
          <div className="refs-blank">
            <BookMarked size={22} strokeWidth={1.25} aria-hidden="true" />
            <p>在左边导入一份参考资料，或选一章开始阅读。</p>
          </div>
        )}
      </section>
    </div>
  );
}
