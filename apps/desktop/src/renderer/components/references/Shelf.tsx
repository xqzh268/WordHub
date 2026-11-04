import {
  Check,
  FilePlus2,
  FolderPlus,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type {
  CollectionPayload,
  ReferencePatchPayload,
} from "@wordhub/contracts";
import { Cover } from "./Cover";
import {
  type Book,
  KIND_LABELS,
  STATUS_LABELS,
  SORT_LABELS,
  type ShelfFilter,
  type SortKey,
  applyFilter,
  matchesQuery,
  progressPercent,
  sortBooks,
  tagCounts,
} from "./model";

const PREFS_KEY = "wordhub.shelf.prefs";
type Prefs = { view: "grid" | "list"; sort: SortKey };

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(PREFS_KEY) ?? "{}",
    ) as Partial<Prefs>;
    return {
      view: raw.view === "list" ? "list" : "grid",
      sort: raw.sort && raw.sort in SORT_LABELS ? raw.sort : "recent",
    };
  } catch {
    return { view: "grid", sort: "recent" };
  }
}

export type ShelfProps = {
  books: Book[];
  collections: CollectionPayload[];
  similarIds: ReadonlySet<string>;
  busy: boolean;
  onOpen: (book: Book, panel?: "info") => void;
  onUpdate: (book: Book, patch: ReferencePatchPayload) => Promise<void>;
  onDelete: (book: Book) => void;
  onImport: () => void;
  onCreateCollection: (name: string) => Promise<void>;
  onRenameCollection: (id: string, name: string) => Promise<void>;
  onDeleteCollection: (collection: CollectionPayload) => Promise<void>;
  /** 导入提示、全文检索、文风示范等放在书架上方/侧边的内容由外层提供 */
  banner?: ReactNode;
  search?: ReactNode;
  samples?: ReactNode;
};

/** 左侧导航里的一项（全部/收藏/状态/集合）；放在 Shelf 外面，重渲染时不会被当成新组件而重挂载。 */
function NavItem({
  target,
  label,
  total,
  testId,
  current,
  onSelect,
}: {
  target: ShelfFilter;
  label: string;
  total: number;
  testId: string;
  current: ShelfFilter;
  onSelect: (filter: ShelfFilter) => void;
}) {
  const active = JSON.stringify(target) === JSON.stringify(current);
  return (
    <button
      type="button"
      className={`shelf-nav-item ${active ? "on" : ""}`}
      onClick={() => onSelect(target)}
      data-testid={testId}
      aria-current={active ? "true" : undefined}
    >
      <span>{label}</span>
      <small>{total}</small>
    </button>
  );
}

export function Shelf(props: ShelfProps) {
  const { books, collections, similarIds } = props;
  const [filter, setFilter] = useState<ShelfFilter>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [naming, setNaming] = useState<{
    id: string | null;
    text: string;
  } | null>(null);
  const [error, setError] = useState("");

  const updatePrefs = (patch: Partial<Prefs>) =>
    setPrefs((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // 存不进去只影响这次
      }
      return next;
    });

  // 当前选中的筛选项被删（集合删了、标签没了）时回到“全部”
  useEffect(() => {
    if (
      filter.kind === "collection" &&
      !collections.some((c) => c.id === filter.id)
    )
      setFilter({ kind: "all" });
    if (
      filter.kind === "tag" &&
      !books.some((b) =>
        b.tags.some((t) => t.toLowerCase() === filter.tag.toLowerCase()),
      )
    )
      setFilter({ kind: "all" });
    if (filter.kind === "similar" && similarIds.size === 0)
      setFilter({ kind: "all" });
  }, [filter, collections, books, similarIds]);

  const visible = useMemo(
    () =>
      sortBooks(
        applyFilter(books, filter, similarIds).filter((book) =>
          matchesQuery(book, query),
        ),
        prefs.sort,
      ),
    [books, filter, similarIds, query, prefs.sort],
  );
  const tags = useMemo(() => tagCounts(books), [books]);
  const count = (predicate: (b: Book) => boolean) =>
    books.filter(predicate).length;
  const isActive = (candidate: ShelfFilter) =>
    JSON.stringify(candidate) === JSON.stringify(filter);

  const guard = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const submitName = () =>
    guard(async () => {
      if (!naming) return;
      if (naming.id) await props.onRenameCollection(naming.id, naming.text);
      else await props.onCreateCollection(naming.text);
      setNaming(null);
    });

  return (
    <div className="shelf" data-testid="shelf">
      <nav className="shelf-nav" aria-label="书架导航">
        <NavItem
          current={filter}
          onSelect={setFilter}
          target={{ kind: "all" }}
          label="全部"
          total={books.length}
          testId="nav-all"
        />
        <NavItem
          current={filter}
          onSelect={setFilter}
          target={{ kind: "favorite" }}
          label="收藏"
          total={count((b) => b.favorite)}
          testId="nav-favorite"
        />
        {(["reading", "unread", "finished"] as const).map((status) => (
          <NavItem
            current={filter}
            onSelect={setFilter}
            key={status}
            target={{ kind: "status", status }}
            label={STATUS_LABELS[status]}
            total={count((b) => b.status === status)}
            testId={`nav-status-${status}`}
          />
        ))}
        {similarIds.size > 0 && (
          <NavItem
            current={filter}
            onSelect={setFilter}
            target={{ kind: "similar" }}
            label="可能重复"
            total={similarIds.size}
            testId="nav-similar"
          />
        )}

        <div className="shelf-nav-head">
          <span>集合</span>
          <button
            type="button"
            className="icon-btn sm"
            aria-label="新建集合"
            data-testid="collection-new"
            onClick={() => setNaming({ id: null, text: "" })}
          >
            <FolderPlus size={14} strokeWidth={1.5} />
          </button>
        </div>
        {naming && (
          <form
            className="shelf-name-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitName();
            }}
          >
            <input
              className="text-input"
              value={naming.text}
              onChange={(event) =>
                setNaming({ ...naming, text: event.target.value })
              }
              placeholder={naming.id ? "新名字" : "集合名，如：毕业论文"}
              aria-label="集合名"
              data-testid="collection-name"
              // 刚展开时直接输入
              ref={(node) => node?.focus()}
            />
            <button
              type="submit"
              className="icon-btn sm"
              aria-label="确定"
              data-testid="collection-ok"
            >
              <Check size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className="icon-btn sm"
              aria-label="取消"
              onClick={() => setNaming(null)}
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </form>
        )}
        {collections.length === 0 && !naming && (
          <p className="shelf-nav-empty">还没有集合</p>
        )}
        {collections.map((collection) => (
          <div className="shelf-nav-row" key={collection.id}>
            <NavItem
              current={filter}
              onSelect={setFilter}
              target={{ kind: "collection", id: collection.id }}
              label={collection.name}
              total={count((b) => b.collectionIds.includes(collection.id))}
              testId={`nav-collection-${collection.id}`}
            />
            <button
              type="button"
              className="icon-btn sm"
              aria-label={`重命名集合“${collection.name}”`}
              onClick={() =>
                setNaming({ id: collection.id, text: collection.name })
              }
            >
              <Pencil size={12} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className="icon-btn sm"
              aria-label={`删除集合“${collection.name}”`}
              onClick={() =>
                void guard(() => props.onDeleteCollection(collection))
              }
            >
              <Trash2 size={12} strokeWidth={1.5} />
            </button>
          </div>
        ))}

        {tags.length > 0 && (
          <>
            <div className="shelf-nav-head">
              <span>标签</span>
            </div>
            <div className="shelf-tags">
              {tags.map(([tag, total]) => (
                <button
                  key={tag}
                  type="button"
                  className={`tag-chip ${isActive({ kind: "tag", tag }) ? "on" : ""}`}
                  onClick={() =>
                    setFilter(
                      isActive({ kind: "tag", tag })
                        ? { kind: "all" }
                        : { kind: "tag", tag },
                    )
                  }
                  data-testid={`nav-tag-${tag}`}
                >
                  {tag}
                  <small>{total}</small>
                </button>
              ))}
            </div>
          </>
        )}
        {props.samples}
      </nav>

      <section className="shelf-main" aria-label="书架">
        <header className="shelf-toolbar">
          <h1>参考库</h1>
          <input
            className="text-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选：书名、作者、标签、备注…"
            aria-label="筛选书架"
            data-testid="shelf-filter"
          />
          <select
            className="text-input"
            value={prefs.sort}
            onChange={(event) =>
              updatePrefs({ sort: event.target.value as SortKey })
            }
            aria-label="排序"
            data-testid="shelf-sort"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
          <span className="seg view-toggle" role="group" aria-label="视图">
            <button
              type="button"
              className={prefs.view === "grid" ? "active" : ""}
              aria-label="网格视图"
              aria-pressed={prefs.view === "grid"}
              onClick={() => updatePrefs({ view: "grid" })}
              data-testid="view-grid"
            >
              <LayoutGrid size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className={prefs.view === "list" ? "active" : ""}
              aria-label="列表视图"
              aria-pressed={prefs.view === "list"}
              onClick={() => updatePrefs({ view: "list" })}
              data-testid="view-list"
            >
              <List size={14} strokeWidth={1.5} />
            </button>
          </span>
          <button
            type="button"
            className="btn btn-primary shelf-import"
            onClick={props.onImport}
            disabled={props.busy}
            data-testid="ref-import"
          >
            <FilePlus2 size={14} strokeWidth={1.5} /> 导入
          </button>
        </header>
        <p className="refs-note">
          资料只保存在项目文件夹里，不会上传。向 Agent
          提问时，所选文字会发给你配置的模型服务商。
        </p>
        {props.banner}
        {props.search}
        {error && (
          <p
            className="refs-message bad"
            role="alert"
            data-testid="shelf-error"
          >
            {error}
          </p>
        )}

        {books.length === 0 ? (
          <p className="shelf-empty" data-testid="ref-empty">
            还没有资料。点“导入”添加 TXT、Markdown、EPUB、DOCX 或带文字层的
            PDF。
          </p>
        ) : visible.length === 0 ? (
          <p className="shelf-empty" data-testid="shelf-none">
            没有符合条件的资料。
          </p>
        ) : (
          <ul
            className={`shelf-books ${prefs.view}`}
            role="list"
            data-testid="shelf-books"
          >
            {visible.map((book) => (
              <BookItem
                key={book.id}
                book={book}
                view={prefs.view}
                collections={collections}
                menuOpen={menuFor === book.id}
                setMenuOpen={(open) => setMenuFor(open ? book.id : null)}
                onOpen={props.onOpen}
                onUpdate={(patch) => guard(() => props.onUpdate(book, patch))}
                onDelete={() => props.onDelete(book)}
                similar={similarIds.has(book.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BookItem({
  book,
  view,
  collections,
  menuOpen,
  setMenuOpen,
  onOpen,
  onUpdate,
  onDelete,
  similar,
}: {
  book: Book;
  view: "grid" | "list";
  collections: CollectionPayload[];
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  onOpen: ShelfProps["onOpen"];
  onUpdate: (patch: ReferencePatchPayload) => Promise<void>;
  onDelete: () => void;
  similar: boolean;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setMenuOpen(false);
        return;
      }
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menuOpen, setMenuOpen]);

  const percent = progressPercent(book);
  const sub = [
    book.author,
    book.year,
    KIND_LABELS[book.kind] === "其他" ? undefined : KIND_LABELS[book.kind],
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className={`book ${view}`} data-testid={`book-${book.id}`}>
      <button
        type="button"
        className="book-open"
        onClick={() => onOpen(book)}
        aria-label={`打开《${book.title}》`}
      >
        <Cover book={book} className="book-cover" />
        <span className="book-text">
          <strong className="book-title">{book.title}</strong>
          {sub && <span className="book-sub">{sub}</span>}
          {view === "list" && (
            <span className="book-sub">
              {book.format.toUpperCase()} · {book.chapters.length} 章 ·{" "}
              {STATUS_LABELS[book.status]}
            </span>
          )}
          {book.tags.length > 0 && (
            <span className="book-tags">
              {book.tags.slice(0, view === "grid" ? 2 : 5).map((tag) => (
                <em key={tag}>{tag}</em>
              ))}
              {view === "grid" && book.tags.length > 2 && (
                <em>+{book.tags.length - 2}</em>
              )}
            </span>
          )}
          {similar && <span className="book-flag">可能重复</span>}
        </span>
      </button>
      <div
        className="book-progress"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`《${book.title}》阅读进度`}
      >
        <i style={{ width: `${percent}%` }} />
      </div>
      <button
        type="button"
        className={`icon-btn sm book-star ${book.favorite ? "on" : ""}`}
        aria-label={
          book.favorite ? `取消收藏《${book.title}》` : `收藏《${book.title}》`
        }
        aria-pressed={book.favorite}
        onClick={() => void onUpdate({ favorite: !book.favorite })}
        data-testid={`star-${book.id}`}
      >
        <Star
          size={14}
          strokeWidth={1.5}
          fill={book.favorite ? "currentColor" : "none"}
        />
      </button>
      <div className="book-menu-wrap" ref={menu}>
        <button
          type="button"
          className="icon-btn sm"
          aria-label={`《${book.title}》的更多操作`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
          data-testid={`menu-${book.id}`}
        >
          <MoreHorizontal size={15} strokeWidth={1.5} />
        </button>
        {menuOpen && (
          <div
            className="book-menu"
            role="menu"
            data-testid={`menu-panel-${book.id}`}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onOpen(book);
              }}
            >
              打开
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onOpen(book, "info");
              }}
            >
              编辑信息…
            </button>
            <div className="book-menu-group" role="group" aria-label="阅读状态">
              {(["unread", "reading", "finished"] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  role="menuitemradio"
                  aria-checked={book.status === status}
                  className={book.status === status ? "on" : ""}
                  onClick={() => void onUpdate({ status })}
                >
                  {STATUS_LABELS[status]}
                </button>
              ))}
            </div>
            <div className="book-menu-label">加入集合</div>
            {collections.length === 0 && (
              <div className="book-menu-empty">还没有集合（在左侧新建）</div>
            )}
            {collections.map((collection) => {
              const inside = book.collectionIds.includes(collection.id);
              return (
                <button
                  key={collection.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={inside}
                  onClick={() =>
                    void onUpdate({
                      collectionIds: inside
                        ? book.collectionIds.filter(
                            (id) => id !== collection.id,
                          )
                        : [...book.collectionIds, collection.id],
                    })
                  }
                  data-testid={`menu-collection-${collection.id}`}
                >
                  <span className="check-mark">{inside ? "✓" : ""}</span>
                  {collection.name}
                </button>
              );
            })}
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
            >
              删除…
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
