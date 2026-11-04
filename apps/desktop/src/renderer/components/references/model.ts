import type { AnnotationPayload, CommandResults } from "@wordhub/contracts";

export type Book = CommandResults["reference.list"]["references"][number];
export type SortKey = "recent" | "opened" | "title" | "author" | "year";
export type ShelfFilter =
  | { kind: "all" }
  | { kind: "favorite" }
  | { kind: "status"; status: Book["status"] }
  | { kind: "collection"; id: string }
  | { kind: "tag"; tag: string }
  | { kind: "similar" };

export const SORT_LABELS: Record<SortKey, string> = {
  recent: "最近导入",
  opened: "最近阅读",
  title: "书名",
  author: "作者",
  year: "年份",
};
export const KIND_LABELS: Record<Book["kind"], string> = {
  novel: "小说",
  paper: "论文",
  report: "报告",
  material: "资料",
  other: "其他",
};
export const STATUS_LABELS: Record<Book["status"], string> = {
  unread: "未读",
  reading: "在读",
  finished: "读完",
};

/** 筛选框：空格分隔的词都要命中（书名、作者、标签、出版方、DOI、ISBN、备注），不区分大小写。 */
export function matchesQuery(book: Book, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [
    book.title,
    book.author,
    book.publisher,
    book.doi,
    book.isbn,
    book.note,
    ...book.tags,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function applyFilter(
  books: Book[],
  filter: ShelfFilter,
  similarIds: ReadonlySet<string> = new Set(),
): Book[] {
  switch (filter.kind) {
    case "all":
      return books;
    case "favorite":
      return books.filter((book) => book.favorite);
    case "status":
      return books.filter((book) => book.status === filter.status);
    case "collection":
      return books.filter((book) => book.collectionIds.includes(filter.id));
    case "tag":
      return books.filter((book) =>
        book.tags.some((tag) => tag.toLowerCase() === filter.tag.toLowerCase()),
      );
    case "similar":
      return books.filter((book) => similarIds.has(book.id));
  }
}

const collator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

/** 排序：缺少排序依据的（没读过、没填作者/年份）排在最后。返回新数组。 */
export function sortBooks(books: Book[], key: SortKey): Book[] {
  const missingLast = <T>(
    a: T | undefined,
    b: T | undefined,
    compare: (x: T, y: T) => number,
  ): number => {
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return 1;
    if (b === undefined) return -1;
    return compare(a, b);
  };
  return [...books].sort((a, b) => {
    switch (key) {
      case "recent":
        return b.importedAt.localeCompare(a.importedAt);
      case "opened":
        return (
          missingLast(a.lastOpenedAt, b.lastOpenedAt, (x, y) =>
            y.localeCompare(x),
          ) || b.importedAt.localeCompare(a.importedAt)
        );
      case "title":
        return collator.compare(a.title, b.title);
      case "author":
        return (
          missingLast(a.author, b.author, (x, y) => collator.compare(x, y)) ||
          collator.compare(a.title, b.title)
        );
      case "year":
        return (
          missingLast(a.year, b.year, (x, y) => y - x) ||
          collator.compare(a.title, b.title)
        );
      default:
        return 0;
    }
  });
}

/** 标签及其出现次数，按次数降序、同次数按字序。 */
export function tagCounts(books: Book[]): Array<[string, number]> {
  const counts = new Map<string, { label: string; count: number }>();
  for (const book of books)
    for (const tag of book.tags) {
      const key = tag.toLowerCase();
      const current = counts.get(key);
      counts.set(key, {
        label: current?.label ?? tag,
        count: (current?.count ?? 0) + 1,
      });
    }
  return [...counts.values()]
    .map((item): [string, number] => [item.label, item.count])
    .sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
}

/** 读到第几章 / 总章数，0–100。没读过是 0；读完固定 100。 */
export function progressPercent(book: Book): number {
  if (book.status === "finished") return 100;
  const index = book.chapters.findIndex(
    (chapter) => chapter.id === book.progress?.chapterId,
  );
  if (index < 0 || book.chapters.length === 0) return 0;
  return Math.round(((index + 1) / book.chapters.length) * 100);
}

/** 没有封面的书用 id 派生一个稳定的底色（同一本书每次一样）。 */
export function coverHue(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return hash % 360;
}

export type Segment = {
  text: string;
  /** 覆盖这一段的批注 id（可能多条重叠） */
  annotationIds: string[];
  color?: AnnotationPayload["color"];
  /** 是检索命中的高亮 */
  search: boolean;
};

/**
 * 把一行文字按“批注区间 + 检索命中区间”切成连续的片段：边界处断开，
 * 重叠的批注同时记录；片段拼起来恰好是原文，选区偏移的计算因此不受影响。
 */
export function segmentsFor(
  text: string,
  rowOffset: number,
  annotations: ReadonlyArray<
    Pick<AnnotationPayload, "id" | "start" | "end" | "color">
  >,
  search?: { offset: number; length: number } | null,
): Segment[] {
  const rowEnd = rowOffset + text.length;
  const overlapping = annotations.filter(
    (a) => a.start < rowEnd && a.end > rowOffset,
  );
  const searchRange =
    search &&
    search.offset < rowEnd &&
    search.offset + search.length > rowOffset
      ? { start: search.offset, end: search.offset + search.length }
      : null;
  if (overlapping.length === 0 && !searchRange)
    return [{ text, annotationIds: [], search: false }];
  const cuts = new Set<number>([0, text.length]);
  const clamp = (value: number) =>
    Math.min(Math.max(value - rowOffset, 0), text.length);
  for (const a of overlapping) {
    cuts.add(clamp(a.start));
    cuts.add(clamp(a.end));
  }
  if (searchRange) {
    cuts.add(clamp(searchRange.start));
    cuts.add(clamp(searchRange.end));
  }
  const points = [...cuts].sort((x, y) => x - y);
  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i] ?? 0;
    const to = points[i + 1] ?? 0;
    if (to <= from) continue;
    const absoluteFrom = rowOffset + from;
    const covering = overlapping.filter(
      (a) => a.start <= absoluteFrom && a.end >= rowOffset + to,
    );
    segments.push({
      text: text.slice(from, to),
      annotationIds: covering.map((a) => a.id),
      color: covering[0]?.color,
      search: Boolean(
        searchRange &&
          searchRange.start <= absoluteFrom &&
          searchRange.end >= rowOffset + to,
      ),
    });
  }
  return segments;
}

/** 章节文本按行拆开，并记住每行在整章文本里的起始偏移（选段时用来换算区间）。 */
export function textRows(
  text: string,
): Array<{ offset: number; text: string }> {
  const rows: Array<{ offset: number; text: string }> = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    if (line.trim()) rows.push({ offset, text: line });
    offset += line.length + 1;
  }
  return rows;
}
