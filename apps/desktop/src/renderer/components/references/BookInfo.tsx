import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  CollectionPayload,
  ReferencePatchPayload,
} from "@wordhub/contracts";
import { cleanIpcError } from "../../lib/errors";
import { type Book, KIND_LABELS, STATUS_LABELS } from "./model";

type Draft = {
  title: string;
  author: string;
  year: string;
  publisher: string;
  kind: Book["kind"];
  doi: string;
  isbn: string;
  status: Book["status"];
  favorite: boolean;
  tags: string[];
  collectionIds: string[];
  note: string;
};

const fromBook = (book: Book): Draft => ({
  title: book.title,
  author: book.author ?? "",
  year: book.year === undefined ? "" : String(book.year),
  publisher: book.publisher ?? "",
  kind: book.kind,
  doi: book.doi ?? "",
  isbn: book.isbn ?? "",
  status: book.status,
  favorite: book.favorite,
  tags: book.tags,
  collectionIds: book.collectionIds,
  note: book.note ?? "",
});

/** 只带有变化的字段；清空的文本字段用 null 表示删除。 */
export function diffPatch(book: Book, draft: Draft): ReferencePatchPayload {
  const before = fromBook(book);
  const patch: ReferencePatchPayload = {};
  const text = (key: "author" | "publisher" | "doi" | "isbn" | "note") => {
    if (draft[key].trim() !== before[key].trim())
      patch[key] = draft[key].trim() === "" ? null : draft[key].trim();
  };
  if (draft.title.trim() !== before.title) patch.title = draft.title;
  text("author");
  text("publisher");
  text("doi");
  text("isbn");
  text("note");
  if (draft.year.trim() !== before.year)
    patch.year = draft.year.trim() === "" ? null : Number(draft.year);
  if (draft.kind !== before.kind) patch.kind = draft.kind;
  if (draft.status !== before.status) patch.status = draft.status;
  if (draft.favorite !== before.favorite) patch.favorite = draft.favorite;
  if (JSON.stringify(draft.tags) !== JSON.stringify(before.tags))
    patch.tags = draft.tags;
  if (
    JSON.stringify([...draft.collectionIds].sort()) !==
    JSON.stringify([...before.collectionIds].sort())
  )
    patch.collectionIds = draft.collectionIds;
  return patch;
}

export function BookInfo({
  book,
  collections,
  onSave,
}: {
  book: Book;
  collections: CollectionPayload[];
  onSave: (patch: ReferencePatchPayload) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() => fromBook(book));
  const [tagText, setTagText] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const serialized = JSON.stringify(fromBook(book));
  // 外部（书架里点收藏、改集合）改了这本书，表单跟着刷新
  useEffect(() => setDraft(fromBook(book)), [serialized]);

  const patch = diffPatch(book, draft);
  const dirty = Object.keys(patch).length > 0;
  const set = (change: Partial<Draft>) => {
    setSaved(false);
    setDraft((current) => ({ ...current, ...change }));
  };
  const addTags = (raw: string) => {
    const incoming = raw
      .split(/[,，;；\n]/u)
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (incoming.length === 0) return;
    const merged = [...draft.tags];
    for (const tag of incoming)
      if (!merged.some((item) => item.toLowerCase() === tag.toLowerCase()))
        merged.push(tag);
    set({ tags: merged });
    setTagText("");
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      // 输入框里还没按回车的标签一并带上
      const pending = tagText.trim();
      const effective = pending
        ? {
            ...draft,
            tags: [
              ...new Set([
                ...draft.tags,
                ...pending
                  .split(/[,，;；]/u)
                  .map((t) => t.trim())
                  .filter(Boolean),
              ]),
            ],
          }
        : draft;
      await onSave(diffPatch(book, effective));
      setTagText("");
      setSaved(true);
    } catch (cause) {
      setError(cleanIpcError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="book-info"
      data-testid="book-info"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label>
        <span>书名</span>
        <input
          className="text-input"
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
          aria-label="书名"
        />
      </label>
      <label>
        <span>作者</span>
        <input
          className="text-input"
          value={draft.author}
          onChange={(e) => set({ author: e.target.value })}
          aria-label="作者"
        />
      </label>
      <div className="book-info-row">
        <label>
          <span>年份</span>
          <input
            className="text-input"
            inputMode="numeric"
            value={draft.year}
            onChange={(e) => set({ year: e.target.value })}
            aria-label="年份"
          />
        </label>
        <label>
          <span>类型</span>
          <select
            className="text-input"
            value={draft.kind}
            onChange={(e) => set({ kind: e.target.value as Book["kind"] })}
            aria-label="类型"
          >
            {(Object.keys(KIND_LABELS) as Book["kind"][]).map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        <span>出版方</span>
        <input
          className="text-input"
          value={draft.publisher}
          onChange={(e) => set({ publisher: e.target.value })}
          aria-label="出版方"
        />
      </label>
      <div className="book-info-row">
        <label>
          <span>DOI</span>
          <input
            className="text-input mono"
            value={draft.doi}
            onChange={(e) => set({ doi: e.target.value })}
            placeholder="10.xxxx/xxxx"
            aria-label="DOI"
          />
        </label>
        <label>
          <span>ISBN</span>
          <input
            className="text-input mono"
            value={draft.isbn}
            onChange={(e) => set({ isbn: e.target.value })}
            aria-label="ISBN"
          />
        </label>
      </div>
      <div className="book-info-row">
        <label>
          <span>阅读状态</span>
          <select
            className="text-input"
            value={draft.status}
            onChange={(e) => set({ status: e.target.value as Book["status"] })}
            aria-label="阅读状态"
          >
            {(["unread", "reading", "finished"] as const).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="check-line">
          <input
            type="checkbox"
            checked={draft.favorite}
            onChange={(e) => set({ favorite: e.target.checked })}
            aria-label="收藏"
          />
          <span>收藏</span>
        </label>
      </div>
      <div className="book-info-field">
        <span>标签</span>
        <div className="tag-editor">
          {draft.tags.map((tag) => (
            <em className="tag-chip on" key={tag}>
              {tag}
              <button
                type="button"
                aria-label={`移除标签 ${tag}`}
                onClick={() =>
                  set({ tags: draft.tags.filter((t) => t !== tag) })
                }
              >
                <X size={11} strokeWidth={2} />
              </button>
            </em>
          ))}
          <input
            className="text-input"
            value={tagText}
            placeholder="输入后按回车添加"
            aria-label="添加标签"
            data-testid="tag-input"
            onChange={(e) => setTagText(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addTags(tagText);
              }
            }}
            onBlur={() => addTags(tagText)}
          />
        </div>
      </div>
      <div className="book-info-field">
        <span>所在集合</span>
        {collections.length === 0 ? (
          <small className="muted">还没有集合，可在书架左侧新建。</small>
        ) : (
          <div className="collection-picks">
            {collections.map((collection) => (
              <label key={collection.id} className="check-line">
                <input
                  type="checkbox"
                  checked={draft.collectionIds.includes(collection.id)}
                  onChange={(e) =>
                    set({
                      collectionIds: e.target.checked
                        ? [...draft.collectionIds, collection.id]
                        : draft.collectionIds.filter(
                            (id) => id !== collection.id,
                          ),
                    })
                  }
                  aria-label={`集合：${collection.name}`}
                />
                <span>{collection.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <label>
        <span>备注</span>
        <textarea
          className="text-input"
          rows={4}
          value={draft.note}
          onChange={(e) => set({ note: e.target.value })}
          aria-label="备注"
        />
      </label>
      {error && (
        <p className="refs-message bad" role="alert" data-testid="info-error">
          {error}
        </p>
      )}
      <div className="book-info-actions">
        {saved && !dirty && (
          <small className="muted" role="status">
            已保存
          </small>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || (!dirty && !tagText.trim())}
          data-testid="info-save"
        >
          保存
        </button>
      </div>
      <p className="refs-note">
        原件：{book.originalName} · 导入于{" "}
        {new Date(book.importedAt).toLocaleDateString("zh-CN")} ·{" "}
        {book.totalChars.toLocaleString("zh-CN")} 字
      </p>
    </form>
  );
}
