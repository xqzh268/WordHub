import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  deleteReference,
  getReference,
  importReference,
  listReferences,
  readReferenceChapter,
} from "./library.js";
import {
  addAnnotation,
  cleanTags,
  coverFile,
  createCollection,
  deleteAnnotation,
  deleteCollection,
  findSimilarGroups,
  listAnnotations,
  listCollections,
  recordOpened,
  renameCollection,
  updateAnnotation,
  updateReference,
} from "./shelf.js";
import { ReferenceLibraryError } from "./types.js";

const BODY = (label: string) =>
  `${label}的正文。`.repeat(14) + "他走进暮色里，风从城门来。";

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-shelf-"));
  const folder = path.join(root, "写作", "长安夜");
  await mkdir(folder, { recursive: true });
  return { root, folder };
}
async function book(root: string, name: string, title = name, author?: string) {
  const file = path.join(root, `${name}.txt`);
  await writeFile(
    file,
    `${title}\n${author ? `${author}\n` : ""}\n第一章 开始\n${BODY(name)}\n\n第二章 继续\n${BODY(`${name}二`)}`,
    "utf8",
  );
  return file;
}
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function epubWithCover(kind: "epub3" | "epub2" | "svg" | "none") {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  const coverItem =
    kind === "epub3"
      ? '<item id="cv" href="images/cover.png" media-type="image/png" properties="cover-image"/>'
      : kind === "epub2"
        ? '<item id="cv" href="images/cover.png" media-type="image/png"/>'
        : kind === "svg"
          ? '<item id="cv" href="images/cover.svg" media-type="image/svg+xml" properties="cover-image"/>'
          : "";
  const meta = kind === "epub2" ? '<meta name="cover" content="cv"/>' : "";
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>带封面的书</dc:title><dc:creator>某作者</dc:creator>${meta}</metadata><manifest><item id="c0" href="c0.xhtml" media-type="application/xhtml+xml"/>${coverItem}</manifest><spine><itemref idref="c0"/></spine></package>`,
  );
  zip.file(
    "OEBPS/c0.xhtml",
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>序</h1><p>${BODY("封面书")}</p></body></html>`,
  );
  if (kind === "svg")
    zip.file(
      "OEBPS/images/cover.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
  else if (kind !== "none") zip.file("OEBPS/images/cover.png", PNG);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("书架：元数据与个人状态", () => {
  it("新导入的书带默认值；v1 旧元数据读取时补齐", async () => {
    const { root, folder } = await workspace();
    const { meta } = await importReference(folder, await book(root, "甲"));
    expect(meta).toMatchObject({
      kind: "other",
      tags: [],
      favorite: false,
      status: "unread",
      collectionIds: [],
    });
    // 模拟 v1 时代写下的文件：没有任何新字段
    const file = path.join(
      folder,
      ".wordhub",
      "references",
      meta.id,
      "reference.json",
    );
    const raw = JSON.parse(await readFile(file, "utf8"));
    for (const key of [
      "kind",
      "tags",
      "favorite",
      "status",
      "collectionIds",
      "schemaVersion",
    ])
      delete raw[key];
    await writeFile(file, JSON.stringify(raw));
    const legacy = await getReference(folder, meta.id);
    expect(legacy).toMatchObject({
      kind: "other",
      tags: [],
      favorite: false,
      status: "unread",
      collectionIds: [],
      schemaVersion: 1,
    });
    // 改一次之后升级到当前版本，原有章节信息不丢
    const updated = await updateReference(folder, meta.id, { favorite: true });
    expect(updated.schemaVersion).toBe(2);
    expect(updated.chapters).toHaveLength(2);
  });

  it("编辑书名、作者、年份、出版方、类型、DOI、ISBN、备注；null 清除字段", async () => {
    const { root, folder } = await workspace();
    const { meta } = await importReference(folder, await book(root, "甲"));
    const next = await updateReference(folder, meta.id, {
      title: "  改过的书名 ",
      author: "某作者",
      year: 2019,
      publisher: "某出版社",
      kind: "paper",
      doi: "10.1000/xyz123",
      isbn: "978-7-5000-0000-0",
      note: "第三章的论证值得引用",
    });
    expect(next).toMatchObject({
      title: "改过的书名",
      author: "某作者",
      year: 2019,
      publisher: "某出版社",
      kind: "paper",
      doi: "10.1000/xyz123",
      isbn: "978-7-5000-0000-0",
      note: "第三章的论证值得引用",
    });
    const cleared = await updateReference(folder, meta.id, {
      author: null,
      year: null,
      doi: "  ",
      note: null,
    });
    expect(cleared.author).toBeUndefined();
    expect(cleared.year).toBeUndefined();
    expect(cleared.doi).toBeUndefined();
    expect(cleared.note).toBeUndefined();
    expect(cleared.title).toBe("改过的书名");
  });

  it("非法输入逐项被拒绝，且不改动已有数据", async () => {
    const { root, folder } = await workspace();
    const { meta } = await importReference(folder, await book(root, "甲"));
    const bad: Array<[Parameters<typeof updateReference>[2], string]> = [
      [{ title: "  " }, "书名"],
      [{ title: "字".repeat(201) }, "书名"],
      [{ year: 999 }, "年份"],
      [{ year: 2019.5 }, "年份"],
      [{ doi: "not-a-doi" }, "DOI"],
      [{ isbn: "12" }, "ISBN"],
      [{ author: "字".repeat(121) }, "作者"],
      [{ note: "字".repeat(5001) }, "备注"],
      [{ kind: "weird" as never }, "资料类型"],
      [{ status: "done" as never }, "阅读状态"],
      [{ collectionIds: ["col-00000000"] }, "集合不存在"],
      [{ tags: ["a,b"] }, "标签"],
      [{ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, "最多 20"],
    ];
    for (const [patch, message] of bad)
      await expect(
        updateReference(folder, meta.id, patch),
        message,
      ).rejects.toThrow(message);
    expect(await getReference(folder, meta.id)).toMatchObject({
      title: "甲",
      status: "unread",
      tags: [],
    });
    await expect(
      updateReference(folder, "ref-000000000000", { favorite: true }),
    ).rejects.toThrow("没有这份资料");
    await expect(updateReference(folder, "bad id", {})).rejects.toThrow(
      "标识无效",
    );
  });

  it("标签：去空白、不区分大小写去重、保留首次写法", () => {
    expect(
      cleanTags([" 论文 ", "论文", "AI", "ai", "", "  ", "写 作"]),
    ).toEqual(["论文", "AI", "写 作"]);
    expect(() => cleanTags(["x".repeat(31)])).toThrow("标签太长");
  });

  it("并发改不同字段不会互相覆盖（没有串行化时后写的会用旧数据盖掉先写的）", async () => {
    const { root, folder } = await workspace();
    const { meta } = await importReference(folder, await book(root, "甲"));
    await Promise.all([
      updateReference(folder, meta.id, { favorite: true }),
      updateReference(folder, meta.id, { note: "备注" }),
      updateReference(folder, meta.id, { year: 2020 }),
      updateReference(folder, meta.id, { kind: "paper" }),
      updateReference(folder, meta.id, { tags: ["甲", "乙"] }),
      updateReference(folder, meta.id, { author: "某作者" }),
      recordOpened(folder, meta.id, "0002"),
    ]);
    const final = await getReference(folder, meta.id);
    expect(final).toMatchObject({
      favorite: true,
      note: "备注",
      year: 2020,
      kind: "paper",
      tags: ["甲", "乙"],
      author: "某作者",
      progress: { chapterId: "0002" },
    });
    const file = path.join(
      folder,
      ".wordhub",
      "references",
      meta.id,
      "reference.json",
    );
    expect(() => JSON.parse(readFileSync(file, "utf8"))).not.toThrow();
    expect(
      (await readdir(path.dirname(file))).filter((n) => n.endsWith(".tmp")),
    ).toEqual([]);
  });
});

describe("书架：阅读进度", () => {
  it("打开章节记下读到哪里与最近阅读时间；未读自动变在读，读完不被改回", async () => {
    const { root, folder } = await workspace();
    const { meta } = await importReference(folder, await book(root, "甲"));
    await recordOpened(folder, meta.id, "0002");
    const opened = await getReference(folder, meta.id);
    expect(opened.status).toBe("reading");
    expect(opened.progress).toEqual({ chapterId: "0002" });
    expect(
      Date.now() - new Date(opened.lastOpenedAt ?? 0).getTime(),
    ).toBeLessThan(10000);
    await updateReference(folder, meta.id, { status: "finished" });
    await recordOpened(folder, meta.id, "0001");
    expect((await getReference(folder, meta.id)).status).toBe("finished");
    // 不存在的章节、不存在的书都静默忽略，不报错也不改数据
    await recordOpened(folder, meta.id, "0099");
    await recordOpened(folder, "ref-000000000000", "0001");
    expect((await getReference(folder, meta.id)).progress).toEqual({
      chapterId: "0001",
    });
  });
});

describe("书架：集合", () => {
  it("新建、重命名、一本书可在多个集合里；重名拒绝", async () => {
    const { root, folder } = await workspace();
    const a = await importReference(folder, await book(root, "甲"));
    const first = await createCollection(folder, " 毕业论文 ");
    const second = await createCollection(folder, "文风参考");
    expect(first.name).toBe("毕业论文");
    await expect(createCollection(folder, "毕业论文")).rejects.toThrow(
      "已经有叫",
    );
    await expect(createCollection(folder, "   ")).rejects.toThrow("集合名");
    await updateReference(folder, a.meta.id, {
      collectionIds: [first.id, second.id, first.id],
    });
    expect((await getReference(folder, a.meta.id)).collectionIds).toEqual([
      first.id,
      second.id,
    ]);
    await renameCollection(folder, first.id, "硕士论文");
    expect((await listCollections(folder)).map((c) => c.name)).toEqual([
      "硕士论文",
      "文风参考",
    ]);
    await expect(
      renameCollection(folder, first.id, "文风参考"),
    ).rejects.toThrow("已经有叫");
    await expect(renameCollection(folder, "col-ffffffff", "x")).rejects.toThrow(
      "集合不存在",
    );
  });

  it("删除集合：书保留，只是从集合里移出", async () => {
    const { root, folder } = await workspace();
    const a = await importReference(folder, await book(root, "甲"));
    const b = await importReference(folder, await book(root, "乙"));
    const keep = await createCollection(folder, "保留");
    const drop = await createCollection(folder, "删除");
    await updateReference(folder, a.meta.id, {
      collectionIds: [keep.id, drop.id],
    });
    await updateReference(folder, b.meta.id, { collectionIds: [drop.id] });
    await deleteCollection(folder, drop.id);
    expect((await listCollections(folder)).map((c) => c.id)).toEqual([keep.id]);
    expect((await getReference(folder, a.meta.id)).collectionIds).toEqual([
      keep.id,
    ]);
    expect((await getReference(folder, b.meta.id)).collectionIds).toEqual([]);
    expect(await listReferences(folder)).toHaveLength(2);
    await expect(deleteCollection(folder, drop.id)).rejects.toThrow(
      "集合不存在",
    );
  });
});

describe("书架：疑似重复", () => {
  it("书名和作者对得上的另一个文件，导入时提示、也出现在重复分组里；不同内容的同名书不算同一文件", async () => {
    const { root, folder } = await workspace();
    const first = await importReference(
      folder,
      await book(root, "一", "寒江记", "某作者"),
    );
    expect(first.similar).toEqual([]);
    // 内容不同（所以不是同一个文件）、书名作者相同，只差标点和大小写
    const second = await importReference(
      folder,
      await book(root, "二", "《寒江记》", " 某 作者 "),
    );
    expect(second.duplicate).toBe(false);
    expect(second.similar.map((m) => m.id)).toEqual([first.meta.id]);
    const other = await importReference(
      folder,
      await book(root, "三", "别的书", "别人"),
    );
    expect(other.similar).toEqual([]);
    const groups = await findSimilarGroups(folder);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.map((m) => m.id).sort()).toEqual(
      [first.meta.id, second.meta.id].sort(),
    );
    await deleteReference(folder, second.meta.id);
    expect(await findSimilarGroups(folder)).toEqual([]);
  });
});

describe("书架：封面", () => {
  it("EPUB3 的 cover-image 与 EPUB2 的 meta cover 都能取到，落成 cover.png", async () => {
    const { root, folder } = await workspace();
    for (const kind of ["epub3", "epub2"] as const) {
      const file = path.join(root, `${kind}.epub`);
      await writeFile(file, await epubWithCover(kind));
      const { meta } = await importReference(folder, file);
      expect(meta.cover, kind).toEqual({
        file: "cover.png",
        mime: "image/png",
      });
      const cover = await coverFile(folder, meta.id);
      expect(cover?.mime).toBe("image/png");
      expect((await readFile(cover?.path ?? "")).equals(PNG)).toBe(true);
      expect(
        await readdir(path.join(folder, ".wordhub", "references", meta.id)),
      ).toContain("cover.png");
      await deleteReference(folder, meta.id);
    }
  });

  it("没有封面的、以及 SVG（可能带脚本）封面一律不接收", async () => {
    const { root, folder } = await workspace();
    for (const kind of ["none", "svg"] as const) {
      const file = path.join(root, `${kind}.epub`);
      await writeFile(file, await epubWithCover(kind));
      const { meta } = await importReference(folder, file);
      expect(meta.cover, kind).toBeUndefined();
      expect(await coverFile(folder, meta.id)).toBeUndefined();
      await deleteReference(folder, meta.id);
    }
    const txt = await importReference(folder, await book(root, "文本"));
    expect(await coverFile(folder, txt.meta.id)).toBeUndefined();
  });
});

describe("书架：批注与高亮", () => {
  async function setup() {
    const { root, folder } = await workspace();
    const { meta } = await importReference(folder, await book(root, "甲"));
    return { folder, id: meta.id };
  }

  it("引文由服务端按区间从原文切出，批注保存、排序、更新、删除", async () => {
    const { folder, id } = await setup();
    const chapter = await readReferenceChapter(folder, id, "0001");
    const a = await addAnnotation(folder, {
      referenceId: id,
      chapterId: "0001",
      start: 20,
      end: 40,
      note: " 这里写得好 ",
    });
    expect(a.quote).toBe(chapter.text.slice(20, 40));
    expect(a).toMatchObject({
      color: "yellow",
      note: "这里写得好",
      chapterId: "0001",
    });
    const b = await addAnnotation(folder, {
      referenceId: id,
      chapterId: "0001",
      start: 2,
      end: 8,
      color: "green",
    });
    const c = await addAnnotation(folder, {
      referenceId: id,
      chapterId: "0002",
      start: 0,
      end: 5,
      color: "pink",
    });
    expect((await listAnnotations(folder, id)).map((x) => x.id)).toEqual([
      b.id,
      a.id,
      c.id,
    ]);
    const updated = await updateAnnotation(folder, id, a.id, {
      note: null,
      color: "blue",
    });
    expect(updated.note).toBeUndefined();
    expect(updated.color).toBe("blue");
    expect(updated.quote).toBe(a.quote);
    expect(
      (await updateAnnotation(folder, id, a.id, { note: "又写了" })).note,
    ).toBe("又写了");
    await deleteAnnotation(folder, id, b.id);
    expect((await listAnnotations(folder, id)).map((x) => x.id)).toEqual([
      a.id,
      c.id,
    ]);
  });

  it("越界区间、不存在的章节与书、非法颜色、过长批注都被拒绝", async () => {
    const { folder, id } = await setup();
    await expect(
      addAnnotation(folder, {
        referenceId: id,
        chapterId: "0001",
        start: 10,
        end: 5,
      }),
    ).rejects.toThrow("选段范围无效");
    await expect(
      addAnnotation(folder, {
        referenceId: id,
        chapterId: "0001",
        start: 0,
        end: 999999,
      }),
    ).rejects.toThrow("选段范围无效");
    await expect(
      addAnnotation(folder, {
        referenceId: id,
        chapterId: "0099",
        start: 0,
        end: 5,
      }),
    ).rejects.toThrow("没有章节");
    await expect(
      addAnnotation(folder, {
        referenceId: "ref-000000000000",
        chapterId: "0001",
        start: 0,
        end: 5,
      }),
    ).rejects.toThrow("没有这份资料");
    await expect(
      addAnnotation(folder, {
        referenceId: id,
        chapterId: "0001",
        start: 0,
        end: 5,
        color: "red" as never,
      }),
    ).rejects.toThrow("高亮颜色");
    await expect(
      addAnnotation(folder, {
        referenceId: id,
        chapterId: "0001",
        start: 0,
        end: 5,
        note: "字".repeat(2001),
      }),
    ).rejects.toThrow("批注太长");
    await expect(
      updateAnnotation(folder, id, "ann-00000000", { note: "x" }),
    ).rejects.toThrow("不存在");
    await expect(deleteAnnotation(folder, id, "ann-00000000")).rejects.toThrow(
      "不存在",
    );
    expect(await listAnnotations(folder, id)).toEqual([]);
  });

  it("并发添加 15 条批注不丢（同一文件的读改写被串行化）", async () => {
    const { folder, id } = await setup();
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        addAnnotation(folder, {
          referenceId: id,
          chapterId: "0001",
          start: i * 3,
          end: i * 3 + 2,
        }),
      ),
    );
    expect(await listAnnotations(folder, id)).toHaveLength(15);
  });

  it("删除书的同时批注也消失；批注文件损坏时按空处理而不是崩溃", async () => {
    const { folder, id } = await setup();
    await addAnnotation(folder, {
      referenceId: id,
      chapterId: "0001",
      start: 0,
      end: 5,
    });
    const file = path.join(
      folder,
      ".wordhub",
      "references",
      id,
      "annotations.json",
    );
    await writeFile(file, "{ 这不是 json");
    expect(await listAnnotations(folder, id)).toEqual([]);
    await deleteReference(folder, id);
    await expect(listAnnotations(folder, id)).rejects.toThrow(
      ReferenceLibraryError,
    );
  });
});
