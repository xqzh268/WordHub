import { describe, expect, it } from "vitest";
import {
  type Book,
  applyFilter,
  coverHue,
  matchesQuery,
  progressPercent,
  segmentsFor,
  sortBooks,
  tagCounts,
  textRows,
} from "./model";

const book = (patch: Partial<Book> & { id: string }): Book => ({
  title: patch.id,
  format: "txt",
  originalName: `${patch.id}.txt`,
  importedAt: "2026-01-01T00:00:00.000Z",
  totalChars: 1000,
  chapters: [
    { id: "0001", index: 1, title: "一", chars: 500 },
    { id: "0002", index: 2, title: "二", chars: 500 },
    { id: "0003", index: 3, title: "三", chars: 500 },
    { id: "0004", index: 4, title: "四", chars: 500 },
  ],
  kind: "other",
  tags: [],
  favorite: false,
  status: "unread",
  collectionIds: [],
  hasCover: false,
  ...patch,
});

const shelf = [
  book({
    id: "a",
    title: "寒江记",
    author: "某作者",
    year: 2019,
    tags: ["小说", "文风"],
    importedAt: "2026-03-01T00:00:00.000Z",
    favorite: true,
    status: "reading",
    lastOpenedAt: "2026-05-02T00:00:00.000Z",
    collectionIds: ["col-1"],
  }),
  book({
    id: "b",
    title: "论智能写作",
    author: "李四",
    year: 2023,
    kind: "paper",
    tags: ["论文", "AI"],
    importedAt: "2026-02-01T00:00:00.000Z",
    status: "finished",
    note: "第三节讲评审",
    doi: "10.1000/abc",
  }),
  book({
    id: "c",
    title: "夜航船",
    importedAt: "2026-04-01T00:00:00.000Z",
    collectionIds: ["col-1", "col-2"],
  }),
  book({
    id: "d",
    title: "A Study",
    author: "Zed",
    year: 2021,
    tags: ["AI"],
    importedAt: "2026-01-15T00:00:00.000Z",
    lastOpenedAt: "2026-06-01T00:00:00.000Z",
  }),
];

describe("书架筛选框", () => {
  it("多个词都要命中，覆盖书名、作者、标签、备注、DOI，不区分大小写", () => {
    expect(
      shelf.filter((b) => matchesQuery(b, "寒江")).map((b) => b.id),
    ).toEqual(["a"]);
    expect(
      shelf.filter((b) => matchesQuery(b, "ai 论文")).map((b) => b.id),
    ).toEqual(["b"]);
    expect(
      shelf.filter((b) => matchesQuery(b, "评审")).map((b) => b.id),
    ).toEqual(["b"]);
    expect(
      shelf.filter((b) => matchesQuery(b, "10.1000")).map((b) => b.id),
    ).toEqual(["b"]);
    expect(
      shelf.filter((b) => matchesQuery(b, "zed")).map((b) => b.id),
    ).toEqual(["d"]);
    expect(shelf.filter((b) => matchesQuery(b, "  ")).length).toBe(4);
    expect(shelf.filter((b) => matchesQuery(b, "寒江 不存在")).length).toBe(0);
  });
});

describe("书架过滤", () => {
  it("收藏、状态、集合、标签（不区分大小写）、疑似重复", () => {
    const ids = (
      filter: Parameters<typeof applyFilter>[1],
      similar = new Set<string>(),
    ) => applyFilter(shelf, filter, similar).map((b) => b.id);
    expect(ids({ kind: "all" })).toEqual(["a", "b", "c", "d"]);
    expect(ids({ kind: "favorite" })).toEqual(["a"]);
    expect(ids({ kind: "status", status: "finished" })).toEqual(["b"]);
    expect(ids({ kind: "status", status: "unread" })).toEqual(["c", "d"]);
    expect(ids({ kind: "collection", id: "col-1" })).toEqual(["a", "c"]);
    expect(ids({ kind: "tag", tag: "ai" })).toEqual(["b", "d"]);
    expect(ids({ kind: "similar" }, new Set(["c", "d"]))).toEqual(["c", "d"]);
  });
});

describe("书架排序", () => {
  const order = (key: Parameters<typeof sortBooks>[1]) =>
    sortBooks(shelf, key).map((b) => b.id);
  it("最近导入、最近阅读（没读过的排最后）", () => {
    expect(order("recent")).toEqual(["c", "a", "b", "d"]);
    expect(order("opened")).toEqual(["d", "a", "c", "b"]);
  });
  it("书名按中文字序与数字自然序；作者与年份缺失的排最后", () => {
    // 中文排序依赖 ICU（Electron 自带完整 ICU 按拼音，CI 的 Node 不一定），这里只钉住与环境无关的不变量
    expect([...order("title")].sort()).toEqual(["a", "b", "c", "d"]);
    expect(
      sortBooks(
        [book({ id: "x", title: "第10章" }), book({ id: "y", title: "第2章" })],
        "title",
      ).map((b) => b.id),
    ).toEqual(["y", "x"]);
    expect(order("author").slice(-1)).toEqual(["c"]);
    expect(order("year")).toEqual(["b", "d", "a", "c"]);
  });
  it("不改动原数组", () => {
    const before = shelf.map((b) => b.id);
    sortBooks(shelf, "title");
    expect(shelf.map((b) => b.id)).toEqual(before);
  });
});

describe("标签与进度", () => {
  it("标签计数：按次数降序，大小写合并并保留首次写法", () => {
    expect(
      tagCounts([
        book({ id: "1", tags: ["AI", "论文"] }),
        book({ id: "2", tags: ["ai"] }),
        book({ id: "3", tags: ["小说"] }),
      ]),
    ).toEqual([
      ["AI", 2],
      ["论文", 1],
      ["小说", 1],
    ]);
  });

  it("进度：按读到的章节比例；读完固定 100；没读或章节失效是 0", () => {
    expect(
      progressPercent(book({ id: "p", progress: { chapterId: "0002" } })),
    ).toBe(50);
    expect(
      progressPercent(book({ id: "p", progress: { chapterId: "0004" } })),
    ).toBe(100);
    expect(progressPercent(book({ id: "p", status: "finished" }))).toBe(100);
    expect(progressPercent(book({ id: "p" }))).toBe(0);
    expect(
      progressPercent(book({ id: "p", progress: { chapterId: "9999" } })),
    ).toBe(0);
  });

  it("没有封面时的底色按 id 稳定派生", () => {
    expect(coverHue("ref-aaaaaaaaaaaa")).toBe(coverHue("ref-aaaaaaaaaaaa"));
    expect(coverHue("ref-aaaaaaaaaaaa")).not.toBe(coverHue("ref-bbbbbbbbbbbb"));
    expect(coverHue("x")).toBeGreaterThanOrEqual(0);
    expect(coverHue("x")).toBeLessThan(360);
  });
});

describe("高亮分段", () => {
  const text = "暮色像一层薄薄的灰，压在坊墙之上。";
  const reassembled = (segments: ReturnType<typeof segmentsFor>) =>
    segments.map((s) => s.text).join("");

  it("没有批注也没有检索时整行一段", () => {
    expect(segmentsFor(text, 0, [])).toEqual([
      { text, annotationIds: [], search: false },
    ]);
  });

  it("批注区间把一行切成前、中、后三段，拼回来与原文逐字一致", () => {
    const segments = segmentsFor(text, 100, [
      { id: "a1", start: 102, end: 106, color: "green" },
    ]);
    expect(segments.map((s) => s.text)).toEqual([
      "暮色",
      "像一层薄",
      "薄的灰，压在坊墙之上。",
    ]);
    expect(segments[1]).toMatchObject({
      annotationIds: ["a1"],
      color: "green",
      search: false,
    });
    expect(segments[0]?.annotationIds).toEqual([]);
    expect(reassembled(segments)).toBe(text);
  });

  it("跨行的批注在每一行里只取落在本行内的部分", () => {
    const annotation = {
      id: "a2",
      start: 90,
      end: 110,
      color: "yellow" as const,
    };
    const row = segmentsFor(text, 100, [annotation]);
    expect(row[0]).toMatchObject({
      text: text.slice(0, 10),
      annotationIds: ["a2"],
    });
    expect(reassembled(row)).toBe(text);
    // 完全在行外的批注不影响
    expect(
      segmentsFor(text, 100, [{ id: "far", start: 0, end: 50, color: "pink" }]),
    ).toHaveLength(1);
  });

  it("重叠的批注同时记录 id，边界处断开", () => {
    const segments = segmentsFor(text, 0, [
      { id: "x", start: 2, end: 8, color: "yellow" },
      { id: "y", start: 5, end: 12, color: "blue" },
    ]);
    expect(reassembled(segments)).toBe(text);
    const both = segments.find((s) => s.annotationIds.length === 2);
    expect(both?.text).toBe(text.slice(5, 8));
    expect(both?.annotationIds.sort()).toEqual(["x", "y"]);
  });

  it("检索命中与批注可以叠加，片段仍拼回原文", () => {
    const segments = segmentsFor(
      text,
      0,
      [{ id: "x", start: 0, end: 6, color: "yellow" }],
      { offset: 4, length: 4 },
    );
    expect(reassembled(segments)).toBe(text);
    expect(
      segments.some((s) => s.search && s.annotationIds.includes("x")),
    ).toBe(true);
    expect(
      segments
        .filter((s) => s.search)
        .map((s) => s.text)
        .join(""),
    ).toBe(text.slice(4, 8));
  });

  it("行首、行尾、整行被覆盖的边界情况", () => {
    expect(
      segmentsFor(text, 0, [
        { id: "all", start: 0, end: text.length, color: "pink" },
      ]),
    ).toEqual([{ text, annotationIds: ["all"], color: "pink", search: false }]);
    const head = segmentsFor(text, 0, [
      { id: "h", start: 0, end: 2, color: "yellow" },
    ]);
    expect(head[0]).toMatchObject({ text: "暮色", annotationIds: ["h"] });
    const tail = segmentsFor(text, 0, [
      { id: "t", start: text.length - 2, end: text.length, color: "yellow" },
    ]);
    expect(tail.at(-1)).toMatchObject({ annotationIds: ["t"] });
    expect(reassembled(head) + reassembled(tail)).toBe(text + text);
  });
});

describe("章节分行", () => {
  it("跳过空行，记录每行在整章里的起始偏移", () => {
    const rows = textRows("第一行\n\n第二行\n 第三行");
    expect(rows).toEqual([
      { offset: 0, text: "第一行" },
      { offset: 5, text: "第二行" },
      { offset: 9, text: " 第三行" },
    ]);
    const full = "第一行\n\n第二行\n 第三行";
    for (const row of rows)
      expect(full.slice(row.offset, row.offset + row.text.length)).toBe(
        row.text,
      );
  });
});
