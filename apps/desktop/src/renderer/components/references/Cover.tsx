import { useEffect, useState } from "react";
import { type Book, coverHue } from "./model";

const FORMAT_LABEL: Record<Book["format"], string> = {
  txt: "TXT",
  md: "MD",
  epub: "EPUB",
  docx: "DOCX",
  pdf: "PDF",
};

/** 缩略图缓存：同一本书只向主进程要一次；null 表示没有或读不出来。 */
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function loadCover(id: string): Promise<string | null> {
  const cached = cache.get(id);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = inflight.get(id);
  if (pending) return pending;
  const request = (
    window.wordhub?.invoke("reference.cover", { referenceId: id }) ??
    Promise.resolve({ dataUrl: null })
  )
    .then((result) => result.dataUrl)
    .catch(() => null)
    .then((dataUrl) => {
      cache.set(id, dataUrl);
      inflight.delete(id);
      return dataUrl;
    });
  inflight.set(id, request);
  return request;
}

/** 删除资料后清掉缓存，避免同一个 id 再导入时显示旧封面。 */
export function forgetCover(id: string): void {
  cache.delete(id);
  inflight.delete(id);
}

/** 书封面：书里自带的就用，没有就按 id 生成一个书脊式的文字封面（书名、作者、格式）。 */
export function Cover({
  book,
  className = "",
}: {
  book: Pick<Book, "id" | "title" | "author" | "format" | "hasCover">;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(cache.get(book.id) ?? null);
  useEffect(() => {
    if (!book.hasCover) {
      setSrc(null);
      return;
    }
    let alive = true;
    void loadCover(book.id).then((value) => {
      if (alive) setSrc(value);
    });
    return () => {
      alive = false;
    };
  }, [book.id, book.hasCover]);

  if (src)
    return (
      <div className={`cover ${className}`} data-testid={`cover-${book.id}`}>
        <img src={src} alt={`《${book.title}》封面`} draggable={false} />
      </div>
    );
  const hue = coverHue(book.id);
  return (
    <div
      className={`cover generated ${className}`}
      data-testid={`cover-${book.id}`}
      style={{
        background: `linear-gradient(160deg, hsl(${hue} 30% 40%), hsl(${(hue + 24) % 360} 34% 28%))`,
      }}
      role="img"
      aria-label={`《${book.title}》封面`}
    >
      <span className="cover-title">{book.title}</span>
      {book.author && <span className="cover-author">{book.author}</span>}
      <span className="cover-format">{FORMAT_LABEL[book.format]}</span>
    </div>
  );
}
