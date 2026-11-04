import { BookMarked, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AnnotationColor,
  AnnotationPayload,
  CollectionPayload,
  CommandResults,
  ReferencePatchPayload,
} from "@wordhub/contracts";
import { cleanIpcError } from "../lib/errors";
import { useWorkbench } from "../state/store";
import { forgetCover } from "./references/Cover";
import { Reader, type Panel } from "./references/Reader";
import { Shelf } from "./references/Shelf";
import type { Book } from "./references/model";

type Chapter = CommandResults["reference.read"];
type Hit = CommandResults["reference.search"]["hits"][number];
type Samples = CommandResults["reference.styleSamples"];

type Message = { ok: boolean; text: string };

/** 参考库：书架（封面网格/列表、筛选排序、标签与集合）+ 阅读器（批注、信息、选段操作）。 */
export function ReferencesView() {
  const folder = useWorkbench((s) => s.project.folder);
  const [books, setBooks] = useState<Book[]>([]);
  const [collections, setCollections] = useState<CollectionPayload[]>([]);
  const [similarGroups, setSimilarGroups] = useState<string[][]>([]);
  const [samples, setSamples] = useState<Samples | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationPayload[]>([]);
  const [panel, setPanel] = useState<Panel>("none");
  const [highlight, setHighlight] = useState<{
    chapterId: string;
    offset: number;
    length: number;
  } | null>(null);

  const [query, setQuery] = useState("");
  const [searchAll, setSearchAll] = useState(true);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [showSamples, setShowSamples] = useState(false);

  const similarIds = useMemo(
    () => new Set(similarGroups.flat()),
    [similarGroups],
  );
  const openBook = books.find((book) => book.id === openId) ?? null;
  const note = (ok: boolean, text: string) => setMessage({ ok, text });
  const fail = useCallback(
    (error: unknown) => setMessage({ ok: false, text: cleanIpcError(error) }),
    [],
  );

  const reload = useCallback(async () => {
    if (!window.wordhub || !folder) return;
    try {
      const [list, styles] = await Promise.all([
        window.wordhub.invoke("reference.list", undefined),
        window.wordhub.invoke("reference.styleSamples", undefined),
      ]);
      setBooks(list.references);
      setCollections(list.collections);
      setSimilarGroups(list.similarGroups);
      setSamples(styles);
    } catch (error) {
      fail(error);
    }
  }, [folder, fail]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const replaceBook = (updated: Book) =>
    setBooks((current) =>
      current.map((book) => (book.id === updated.id ? updated : book)),
    );

  const openChapter = useCallback(
    async (
      book: Book,
      chapterId: string,
      mark?: { offset: number; length: number },
    ) => {
      if (!window.wordhub || !chapterId) return;
      try {
        const result = await window.wordhub.invoke("reference.read", {
          referenceId: book.id,
          chapterId,
        });
        setChapter(result);
        setHighlight(mark ? { chapterId, ...mark } : null);
        // 记录读到哪里；本地同步一份，不必整库重读
        void window.wordhub
          .invoke("reference.opened", { referenceId: book.id, chapterId })
          .catch(() => undefined);
        setBooks((current) =>
          current.map((item) =>
            item.id === book.id
              ? {
                  ...item,
                  progress: { chapterId },
                  lastOpenedAt: new Date().toISOString(),
                  status: item.status === "unread" ? "reading" : item.status,
                }
              : item,
          ),
        );
      } catch (error) {
        fail(error);
      }
    },
    [fail],
  );

  const open = async (
    book: Book,
    startPanel: Panel = "none",
    mark?: { chapterId: string; offset: number; length: number },
  ) => {
    setOpenId(book.id);
    setPanel(startPanel);
    setAnnotations([]);
    setChapter(null);
    setHits(null);
    const wanted =
      mark?.chapterId ?? book.progress?.chapterId ?? book.chapters[0]?.id ?? "";
    await openChapter(
      book,
      book.chapters.some((c) => c.id === wanted)
        ? wanted
        : (book.chapters[0]?.id ?? ""),
      mark,
    );
    if (window.wordhub)
      try {
        setAnnotations(
          (
            await window.wordhub.invoke("reference.annotations", {
              referenceId: book.id,
            })
          ).annotations,
        );
      } catch (error) {
        fail(error);
      }
  };
  const back = () => {
    setOpenId(null);
    setChapter(null);
    void reload();
  };

  // ── 书架操作 ───────────────────────────────────────────
  const update = async (book: Book, patch: ReferencePatchPayload) => {
    if (!window.wordhub) return;
    replaceBook(
      await window.wordhub.invoke("reference.update", {
        referenceId: book.id,
        patch,
      }),
    );
  };
  const createCollection = async (name: string) => {
    await window.wordhub?.invoke("reference.collectionCreate", { name });
    await reload();
  };
  const renameCollection = async (id: string, name: string) => {
    await window.wordhub?.invoke("reference.collectionRename", { id, name });
    await reload();
  };
  const deleteCollection = async (collection: CollectionPayload) => {
    if (
      !window.confirm(
        `删除集合“${collection.name}”？里面的书不会被删除，只是不再属于这个集合。`,
      )
    )
      return;
    await window.wordhub?.invoke("reference.collectionDelete", {
      id: collection.id,
    });
    await reload();
  };
  const remove = async (book: Book) => {
    if (!window.wordhub) return;
    if (
      !window.confirm(
        `从参考库删除《${book.title}》？项目里的解析文本、批注和原件副本都会删除（你电脑上的原文件不受影响）。`,
      )
    )
      return;
    try {
      await window.wordhub.invoke("reference.delete", {
        referenceId: book.id,
      });
      forgetCover(book.id);
      if (openId === book.id) back();
      await reload();
    } catch (error) {
      fail(error);
    }
  };
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
      const similar = fresh.filter((item) => item.similar.length > 0);
      const parts = [
        fresh.length
          ? `已导入 ${fresh.length} 份：${fresh.map((i) => `《${i.title}》`).join("、")}`
          : "",
        dup.length ? `${dup.length} 份已经在库里（未重复导入）` : "",
        ...similar.map(
          (item) =>
            `《${item.title}》与已有的${item.similar.map((s) => `《${s.title}》`).join("、")}书名和作者相同，可能是同一本书的另一个版本（见左侧“可能重复”）`,
        ),
        ...result.failed.map((item) => `${item.name} 导入失败：${item.error}`),
      ].filter(Boolean);
      note(result.failed.length === 0, parts.join("；"));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  // ── 全文检索 ───────────────────────────────────────────
  const search = async () => {
    if (!window.wordhub || !query.trim()) {
      setHits(null);
      return;
    }
    try {
      const result = await window.wordhub.invoke("reference.search", {
        query: query.trim(),
        referenceId: searchAll || !openId ? undefined : openId,
      });
      setHits(result.hits);
    } catch (error) {
      fail(error);
    }
  };
  const openHit = (hit: Hit) => {
    const book = books.find((item) => item.id === hit.referenceId);
    if (!book) return;
    const mark = {
      chapterId: hit.chapterId,
      offset: hit.offset,
      length: query.trim().length,
    };
    if (openId === book.id) void openChapter(book, hit.chapterId, mark);
    else void open(book, panel, mark);
  };

  // ── 选段操作 ───────────────────────────────────────────
  const ask = (quoted: string, source: string) => {
    const store = useWorkbench.getState();
    store.setComposer(
      `> ${quoted.replaceAll("\n", "\n> ")}\n> ——${source}\n\n`,
    );
    store.setView("workspace");
  };
  const copy = async (quoted: string, source: string) => {
    await navigator.clipboard
      .writeText(`“${quoted}”——${source}`)
      .then(() => note(true, "已复制引用"))
      .catch(() => note(false, "复制失败"));
  };
  const addSample = async (range: { start: number; end: number }) => {
    if (!window.wordhub || !chapter) return;
    try {
      const result = await window.wordhub.invoke("reference.addStyleSample", {
        referenceId: chapter.referenceId,
        chapterId: chapter.chapterId,
        ...range,
      });
      note(true, `已加入文风示范（现有 ${result.count} 段）`);
      await reload();
    } catch (error) {
      fail(error);
    }
  };
  const removeSample = async (index: number) => {
    try {
      await window.wordhub?.invoke("reference.removeStyleSample", { index });
      await reload();
    } catch (error) {
      fail(error);
    }
  };

  // ── 批注 ───────────────────────────────────────────────
  const addAnnotation = async (
    range: { start: number; end: number },
    color: AnnotationColor,
    text?: string,
  ) => {
    if (!window.wordhub || !chapter) return;
    try {
      const created = await window.wordhub.invoke("reference.annotationAdd", {
        referenceId: chapter.referenceId,
        chapterId: chapter.chapterId,
        ...range,
        color,
        ...(text?.trim() ? { note: text } : {}),
      });
      setAnnotations((current) => [...current, created]);
    } catch (error) {
      fail(error);
    }
  };
  const updateAnnotation = async (
    id: string,
    patch: { note?: string | null; color?: AnnotationColor },
  ) => {
    if (!window.wordhub || !openId) return;
    try {
      const updated = await window.wordhub.invoke(
        "reference.annotationUpdate",
        {
          referenceId: openId,
          annotationId: id,
          ...patch,
        },
      );
      setAnnotations((current) =>
        current.map((item) => (item.id === id ? updated : item)),
      );
    } catch (error) {
      fail(error);
    }
  };
  const deleteAnnotation = async (id: string) => {
    if (!window.wordhub || !openId) return;
    try {
      await window.wordhub.invoke("reference.annotationDelete", {
        referenceId: openId,
        annotationId: id,
      });
      setAnnotations((current) => current.filter((item) => item.id !== id));
    } catch (error) {
      fail(error);
    }
  };

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

  const banner = message && (
    <p
      className={`refs-message ${message.ok ? "ok" : "bad"}`}
      role={message.ok ? "status" : "alert"}
      data-testid="ref-message"
    >
      {message.text}
    </p>
  );
  const fullText = (
    <>
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
          placeholder="全文检索（在所有书的正文里找）"
          aria-label="检索参考库"
          data-testid="ref-search"
        />
        {openBook && (
          <label className="check-inline" title="取消勾选则只在当前这本里找">
            <input
              type="checkbox"
              checked={searchAll}
              onChange={(event) => setSearchAll(event.target.checked)}
              aria-label="在全部资料中检索"
            />
            全部
          </label>
        )}
        {hits && (
          <button
            type="button"
            className="icon-btn sm"
            aria-label="关闭检索结果"
            onClick={() => setHits(null)}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        )}
      </form>
      {hits && (
        <ul className="refs-hits" data-testid="ref-hits" aria-label="检索结果">
          {hits.length === 0 && <li className="empty">没有找到。</li>}
          {hits.map((hit, index) => (
            <li
              key={`${hit.referenceId}-${hit.chapterId}-${hit.offset}-${index}`}
            >
              <button type="button" onClick={() => openHit(hit)}>
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
    </>
  );
  const samplesPanel = (
    <div className="shelf-samples">
      <button
        type="button"
        className="btn refs-samples-toggle"
        onClick={() => setShowSamples(!showSamples)}
        aria-expanded={showSamples}
        data-testid="ref-samples-toggle"
      >
        文风示范 {samples?.samples.length ?? 0}/{samples?.limits.count ?? 5}
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
    </div>
  );

  if (openBook)
    return (
      <div className="refs" data-testid="references">
        <div className="refs-reader-wrap">
          <div className="refs-reader-top">
            {fullText}
            {banner}
          </div>
          <Reader
            book={openBook}
            chapter={chapter}
            annotations={annotations}
            collections={collections}
            highlight={highlight}
            panel={panel}
            setPanel={setPanel}
            onBack={back}
            onOpenChapter={(chapterId, mark) =>
              void openChapter(openBook, chapterId, mark)
            }
            onAsk={ask}
            onCopy={(q, s) => void copy(q, s)}
            onSample={(range) => void addSample(range)}
            onAddAnnotation={addAnnotation}
            onUpdateAnnotation={updateAnnotation}
            onDeleteAnnotation={deleteAnnotation}
            onSave={(patch) => update(openBook, patch)}
          />
        </div>
      </div>
    );

  return (
    <div className="refs" data-testid="references">
      <Shelf
        books={books}
        collections={collections}
        similarIds={similarIds}
        busy={busy}
        onOpen={(book, startPanel) => void open(book, startPanel ?? "none")}
        onUpdate={update}
        onDelete={(book) => void remove(book)}
        onImport={() => void importFiles()}
        onCreateCollection={createCollection}
        onRenameCollection={renameCollection}
        onDeleteCollection={deleteCollection}
        banner={banner}
        search={fullText}
        samples={samplesPanel}
      />
    </div>
  );
}
