import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import iconv from "iconv-lite";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  deleteReference,
  getReference,
  importReference,
  listReferences,
  quoteFromRange,
  readReferenceChapter,
  searchReferences,
  verifyAnchor,
} from "./library.js";
import { parseReferenceFile } from "./parse/index.js";
import { usablePdfTitle } from "./parse/pdf.js";
import { isChapterHeading, splitChapters, usableAuthor } from "./split.js";
import {
  STYLE_SAMPLE_LIMITS,
  StyleSampleError,
  addStyleSample,
  parseStyleSamples,
  removeStyleSample,
} from "./style.js";
import { ReferenceLibraryError } from "./types.js";

const BODY = (label: string, repeat = 12) =>
  `${label}的正文。`.repeat(repeat) + "他走进暮色里，风从城门来。";

const NOVEL = [
  "长安夜",
  "",
  `第一章 夜巡\n${BODY("第一章")}`,
  `第二章 残月\n${BODY("第二章")}`,
  `第十章 归来\n${BODY("第十章")}`,
].join("\n\n");

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-ref-"));
  const folder = path.join(root, "写作", "长安夜");
  await mkdir(folder, { recursive: true });
  return { root, folder };
}
async function fixture(root: string, name: string, data: Buffer | string) {
  const file = path.join(root, name);
  await writeFile(file, data);
  return file;
}

// ── fixtures ────────────────────────────────────────────────

async function makeEpub(options: {
  encryption?: string;
  toc?: "nav" | "ncx" | "none";
  chapters?: Array<{ title: string; html: string }>;
  noContainer?: boolean;
}): Promise<Buffer> {
  const chapters = options.chapters ?? [
    { title: "夜巡", html: `<h1>夜巡</h1><p>${BODY("一")}</p>` },
    { title: "残月", html: `<h1>残月</h1><p>${BODY("二")}</p>` },
  ];
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  if (!options.noContainer)
    zip.file(
      "META-INF/container.xml",
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    );
  if (options.encryption)
    zip.file("META-INF/encryption.xml", options.encryption);
  const toc = options.toc ?? "nav";
  const items = chapters
    .map(
      (_, i) =>
        `<item id="c${i}" href="text/c${i}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join("");
  const navItem =
    toc === "nav"
      ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
      : toc === "ncx"
        ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
        : "";
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>长安夜（EPUB）</dc:title><dc:creator>某作者</dc:creator></metadata><manifest>${items}${navItem}</manifest><spine${toc === "ncx" ? ' toc="ncx"' : ""}>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("")}</spine></package>`,
  );
  for (const [i, chapter] of chapters.entries())
    zip.file(
      `OEBPS/text/c${i}.xhtml`,
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${chapter.html}</body></html>`,
    );

  if (toc === "nav")
    zip.file(
      "OEBPS/nav.xhtml",
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${chapters.map((c, i) => `<li><a href="text/c${i}.xhtml">目录：${c.title}</a></li>`).join("")}</ol></nav></body></html>`,
    );
  if (toc === "ncx")
    zip.file(
      "OEBPS/toc.ncx",
      `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${chapters.map((c, i) => `<navPoint id="n${i}"><navLabel><text>目录：${c.title}</text></navLabel><content src="text/c${i}.xhtml"/></navPoint>`).join("")}</navMap></ncx>`,
    );
  return zip.generateAsync({ type: "nodebuffer" });
}

/** 手写最小 PDF（标准 Helvetica 字体）：用来测提取与“没有文本层”的判断。 */
function makePdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  add("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((text, i) => {
    const content = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : "";
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

// ── 章标题与切分 ─────────────────────────────────────────────

describe("章标题识别与切分", () => {
  it("认得中文章回标题，不把正文句子当标题", () => {
    for (const heading of [
      "第一章 夜巡",
      "第十二回　风雪夜归人",
      "第 3 章",
      "楔子",
      "序章：暮鼓",
      "番外",
      "Chapter 12",
      "  第二百零五章 再会",
    ])
      expect(isChapterHeading(heading), heading).toBe(true);
    for (const text of [
      "第三章里他说，不要去。",
      "这是普通的一句话。",
      "序言太长了，".repeat(10),
      "",
    ])
      expect(isChapterHeading(text), text).toBe(false);
  });

  it("按章标题切分；开头的书名行不算一章", () => {
    const chapters = splitChapters(NOVEL);
    expect(chapters.map((c) => c.title)).toEqual([
      "第一章 夜巡",
      "第二章 残月",
      "第十章 归来",
    ]);
    expect(chapters[0]?.text).toContain("第一章的正文");
  });

  it("没有章标题时按约 8000 字在段落边界分块", () => {
    const paragraphs = Array.from(
      { length: 40 },
      (_, i) => `第${i}段。${"字".repeat(400)}`,
    );
    const chapters = splitChapters(paragraphs.join("\n\n"));
    expect(chapters.length).toBeGreaterThan(1);
    expect(chapters[0]?.title).toBe("第 1 段");
    for (const chapter of chapters)
      expect(chapter.text.length).toBeLessThanOrEqual(8500);
    // 一段不被拦腰截断
    expect(chapters.map((c) => c.text).join("\n\n")).toBe(
      paragraphs.join("\n\n"),
    );
  });
});

describe("元数据清洗", () => {
  it("占位符作者当作没有，真实作者保留", () => {
    for (const junk of [
      "Un-named",
      "unknown",
      "Administrator",
      "admin",
      "佚名",
      "  ",
      undefined,
      null,
    ])
      expect(usableAuthor(junk), String(junk)).toBeUndefined();
    expect(usableAuthor("  某  作者 ")).toBe("某 作者");
  });
});

// ── 各格式解析 ───────────────────────────────────────────────

describe("解析：TXT / Markdown", () => {
  it("UTF-8、带 BOM、GB18030、UTF-16 都能正确解码", async () => {
    const utf8 = await parseReferenceFile(
      Buffer.from(NOVEL, "utf8"),
      "长安夜.txt",
    );
    const bom = await parseReferenceFile(
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(NOVEL, "utf8"),
      ]),
      "a.txt",
    );
    const gbk = await parseReferenceFile(
      iconv.encode(NOVEL, "gb18030"),
      "b.txt",
    );
    const utf16 = await parseReferenceFile(
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        iconv.encode(NOVEL, "utf16le"),
      ]),
      "c.txt",
    );
    for (const parsed of [utf8, bom, gbk, utf16]) {
      expect(parsed.chapters.map((c) => c.title)).toContain("第十章 归来");
      expect(parsed.chapters[0]?.text).toContain("暮色里，风从城门来");
    }
    expect(utf8.title).toBe("长安夜");
  });

  it("第一行是章标题时书名取文件名", async () => {
    const parsed = await parseReferenceFile(
      Buffer.from(
        `第一章 开始\n${BODY("a")}\n\n第二章 继续\n${BODY("b")}`,
        "utf8",
      ),
      "某部小说.txt",
    );
    expect(parsed.title).toBe("某部小说");
  });

  it("Markdown 用一、二级标题分章", async () => {
    const parsed = await parseReferenceFile(
      Buffer.from(`# 夜巡\n${BODY("一")}\n\n# 残月\n${BODY("二")}`, "utf8"),
      "x.md",
    );
    expect(parsed.chapters.map((c) => c.title)).toEqual(["夜巡", "残月"]);
  });

  it("不支持的扩展名给出明确提示（含 MOBI、旧 .doc 的建议）", async () => {
    await expect(
      parseReferenceFile(Buffer.from("x"), "a.mobi"),
    ).rejects.toThrow("EPUB");
    await expect(parseReferenceFile(Buffer.from("x"), "a.doc")).rejects.toThrow(
      ".docx",
    );
    await expect(parseReferenceFile(Buffer.from("x"), "a.exe")).rejects.toThrow(
      "不支持的文件类型",
    );
  });
});

describe("解析：EPUB", () => {
  it("按 spine 取章，用 EPUB3 目录的标题，读出书名与作者", async () => {
    const parsed = await parseReferenceFile(await makeEpub({}), "x.epub");
    expect(parsed.title).toBe("长安夜（EPUB）");
    expect(parsed.author).toBe("某作者");
    expect(parsed.chapters.map((c) => c.title)).toEqual([
      "目录：夜巡",
      "目录：残月",
    ]);
    expect(parsed.chapters[0]?.text).toContain("一的正文");
  });

  it("没有 nav 时用 EPUB2 的 toc.ncx；都没有就用章内标题", async () => {
    const ncx = await parseReferenceFile(
      await makeEpub({ toc: "ncx" }),
      "x.epub",
    );
    expect(ncx.chapters.map((c) => c.title)).toEqual([
      "目录：夜巡",
      "目录：残月",
    ]);
    const none = await parseReferenceFile(
      await makeEpub({ toc: "none" }),
      "x.epub",
    );
    expect(none.chapters.map((c) => c.title)).toEqual(["夜巡", "残月"]);
  });

  it("源文件里硬折行的中文被接成整段，英文折行换成空格，段落保持分开", async () => {
    const parsed = await parseReferenceFile(
      await makeEpub({
        chapters: [
          {
            title: "折行",
            html: "<p>他走进暮色\n里，风从城门\n来。</p><p>Hello\nworld again and again.</p><p>第二段。</p>",
          },
        ],
      }),
      "x.epub",
    );
    expect(parsed.chapters[0]?.text).toBe(
      "他走进暮色里，风从城门来。\n\nHello world again and again.\n\n第二段。",
    );
  });

  it("DRM 加密的 EPUB 被明确拒绝；仅字体混淆不算 DRM", async () => {
    const enc = (algorithm: string) =>
      `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="${algorithm}"/></EncryptedData></encryption>`;
    await expect(
      parseReferenceFile(
        await makeEpub({
          encryption: enc("http://www.w3.org/2001/04/xmlenc#aes128-cbc"),
        }),
        "x.epub",
      ),
    ).rejects.toThrow("DRM");
    const fontOnly = await parseReferenceFile(
      await makeEpub({ encryption: enc("http://www.idpf.org/2008/embedding") }),
      "x.epub",
    );
    expect(fontOnly.chapters.length).toBe(2);
  });

  it("损坏的、改了扩展名的文件给出可读的错误", async () => {
    await expect(
      parseReferenceFile(Buffer.from("not a zip"), "x.epub"),
    ).rejects.toThrow("文件头不对");
    await expect(
      parseReferenceFile(await makeEpub({ noContainer: true }), "x.epub"),
    ).rejects.toThrow("container.xml");
    const truncated = (await makeEpub({})).subarray(0, 200);
    await expect(parseReferenceFile(truncated, "x.epub")).rejects.toThrow(
      ReferenceLibraryError,
    );
  });
});

describe("解析：DOCX", () => {
  async function docx(paragraphs: Paragraph[]) {
    return Packer.toBuffer(
      new Document({
        creator: "某作者",
        title: "长安夜（DOCX）",
        sections: [{ children: paragraphs }],
      }),
    );
  }
  const run = (text: string) => new TextRun({ text });

  it("用一级标题分章，读出书名与作者", async () => {
    const parsed = await parseReferenceFile(
      await docx([
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [run("夜巡")],
        }),
        new Paragraph({ children: [run(BODY("一"))] }),
        new Paragraph({ children: [run("第二段。")] }),
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [run("残月")],
        }),
        new Paragraph({ children: [run(BODY("二"))] }),
      ]),
      "x.docx",
    );
    expect(parsed.title).toBe("长安夜（DOCX）");
    expect(parsed.author).toBe("某作者");
    expect(parsed.chapters.map((c) => c.title)).toEqual(["夜巡", "残月"]);
    expect(parsed.chapters[0]?.text).toContain("第二段。");
    expect(parsed.chapters[1]?.text).toContain("二的正文");
  });

  it("没有标题样式时回退到“第N章”文字识别", async () => {
    const parsed = await parseReferenceFile(
      await docx([
        new Paragraph({ children: [run("第一章 夜巡")] }),
        new Paragraph({ children: [run(BODY("一"))] }),
        new Paragraph({ children: [run("第二章 残月")] }),
        new Paragraph({ children: [run(BODY("二"))] }),
      ]),
      "x.docx",
    );
    expect(parsed.chapters.map((c) => c.title)).toEqual([
      "第一章 夜巡",
      "第二章 残月",
    ]);
  });

  it("不是 DOCX 的压缩包被拒绝", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "hi");
    await expect(
      parseReferenceFile(
        await zip.generateAsync({ type: "nodebuffer" }),
        "x.docx",
      ),
    ).rejects.toThrow("document.xml");
  });
});

describe("解析：PDF", () => {
  it("提取有文本层的 PDF，按页聚合", async () => {
    const parsed = await parseReferenceFile(
      makePdf(["Hello reference library", "Second page text here"]),
      "paper.pdf",
    );
    const all = parsed.chapters.map((c) => c.text).join("\n");
    expect(all).toContain("Hello reference library");
    expect(all).toContain("Second page text here");
    expect(parsed.format).toBe("pdf");
  });

  it("元数据里的垃圾标题（网页地址、Word 文件名、Untitled）不当书名", () => {
    for (const junk of [
      "data:text/html;charset=utf-8,<html>",
      "https://example.com/a.html",
      "Microsoft Word - 论文终稿.docx",
      "Untitled",
      "无标题",
      "report.docx",
      "  ",
      undefined,
    ])
      expect(usablePdfTitle(junk), String(junk)).toBeUndefined();
    expect(usablePdfTitle("  长安夜研究  ")).toBe("长安夜研究");
  });

  it("没有文本层（扫描件）明确报错，不做 OCR", async () => {
    await expect(
      parseReferenceFile(makePdf(["", ""]), "scan.pdf"),
    ).rejects.toThrow("没有可提取的文字层");
  });

  it("损坏的 PDF 与改了扩展名的文件被拒绝", async () => {
    await expect(
      parseReferenceFile(Buffer.from("%PDF-1.4 garbage"), "x.pdf"),
    ).rejects.toThrow(ReferenceLibraryError);
    await expect(
      parseReferenceFile(Buffer.from("hello"), "x.pdf"),
    ).rejects.toThrow("文件头不对");
  });
});

// ── 参考库 ──────────────────────────────────────────────────

describe("参考库：导入、阅读、检索、删除", () => {
  it("导入后写出原件副本、元数据与按章文本；同一文件重复导入得到同一个 id", async () => {
    const { root, folder } = await workspace();
    const file = await fixture(root, "长安夜.txt", NOVEL);
    const first = await importReference(folder, file);
    expect(first.duplicate).toBe(false);
    expect(first.meta.id).toMatch(/^ref-[0-9a-f]{12}$/u);
    expect(first.meta.chapters.map((c) => c.id)).toEqual([
      "0001",
      "0002",
      "0003",
    ]);
    const dir = path.join(folder, ".wordhub", "references", first.meta.id);
    expect((await readdir(dir)).sort()).toEqual([
      "reference.json",
      "source.txt",
      "text",
    ]);
    expect(await readFile(path.join(dir, "source.txt"), "utf8")).toBe(NOVEL);
    const second = await importReference(folder, file);
    expect(second.duplicate).toBe(true);
    expect(second.meta.id).toBe(first.meta.id);
    expect(await listReferences(folder)).toHaveLength(1);
  });

  it("读章节：整章、按区间、单次上限；章节与标识校验", async () => {
    const { root, folder } = await workspace();
    const { meta } = await importReference(
      folder,
      await fixture(root, "a.txt", NOVEL),
    );
    const whole = await readReferenceChapter(folder, meta.id, "0002");
    expect(whole.chapterTitle).toBe("第二章 残月");
    expect(whole.text).toContain("第二章的正文");
    expect(whole.end).toBe(whole.totalChars);
    const part = await readReferenceChapter(folder, meta.id, "0002", {
      start: 0,
      end: 10,
    });
    expect(part.text).toHaveLength(10);
    expect(whole.text.startsWith(part.text)).toBe(true);
    await expect(readReferenceChapter(folder, meta.id, "0099")).rejects.toThrow(
      "没有章节",
    );
    await expect(readReferenceChapter(folder, meta.id, "../x")).rejects.toThrow(
      "章节标识无效",
    );
    await expect(
      readReferenceChapter(folder, "ref-../../..", "0001"),
    ).rejects.toThrow("标识无效");
    await expect(
      readReferenceChapter(folder, "ref-000000000000", "0001"),
    ).rejects.toThrow("没有这份资料");
  });

  it("超长章节单次最多返回 2 万字，可用 start 续读", async () => {
    const { root, folder } = await workspace();
    const long = `第一章 长\n${"字".repeat(50000)}\n\n第二章 短\n${BODY("短")}`;
    const { meta } = await importReference(
      folder,
      await fixture(root, "long.txt", long),
    );
    const first = await readReferenceChapter(folder, meta.id, "0001");
    expect(first.text).toHaveLength(20000);
    expect(first.totalChars).toBe(50000);
    const next = await readReferenceChapter(folder, meta.id, "0001", {
      start: first.end,
    });
    expect(next.start).toBe(20000);
  });

  it("全文检索：跨书跨章、不区分大小写、限定某本、带片段与偏移", async () => {
    const { root, folder } = await workspace();
    const a = await importReference(
      folder,
      await fixture(root, "a.txt", NOVEL),
    );
    const b = await importReference(
      folder,
      await fixture(
        root,
        "b.txt",
        `第一章 英文\nThe Lantern burns low. ${BODY("b")}\n\n第二章 二\n${BODY("c")}`,
      ),
    );
    const hits = await searchReferences(folder, "暮色里");
    expect(new Set(hits.map((h) => h.referenceId))).toEqual(
      new Set([a.meta.id, b.meta.id]),
    );
    const lantern = await searchReferences(folder, "LANTERN");
    expect(lantern).toHaveLength(1);
    expect(lantern[0]?.snippet).toContain("Lantern burns low");
    const only = await searchReferences(folder, "暮色里", {
      referenceId: a.meta.id,
    });
    expect(only.every((h) => h.referenceId === a.meta.id)).toBe(true);
    const text = (
      await readReferenceChapter(folder, a.meta.id, only[0]!.chapterId)
    ).text;
    expect(text.slice(only[0]!.offset, only[0]!.offset + 3)).toBe("暮色里");
    expect(await searchReferences(folder, "绝对不会出现的词")).toEqual([]);
    expect(await searchReferences(folder, "暮色里", { limit: 2 })).toHaveLength(
      2,
    );
    await expect(searchReferences(folder, "  ")).rejects.toThrow("不能为空");
    await expect(searchReferences(folder, "字".repeat(101))).rejects.toThrow(
      "过长",
    );
  });

  it("锚点：区间原文逐字校验，对不上就判为无效", async () => {
    const { root, folder } = await workspace();
    const { meta } = await importReference(
      folder,
      await fixture(root, "a.txt", NOVEL),
    );
    const anchor = await quoteFromRange(folder, meta.id, "0001", 2, 14);
    expect(anchor.quote).toHaveLength(12);
    expect(anchor.referenceTitle).toBe("长安夜");
    expect(await verifyAnchor(folder, anchor)).toBe(true);
    expect(
      await verifyAnchor(folder, { ...anchor, quote: `${anchor.quote}错` }),
    ).toBe(false);
    expect(await verifyAnchor(folder, { ...anchor, chapterId: "0002" })).toBe(
      false,
    );
    await expect(
      quoteFromRange(folder, meta.id, "0001", 10, 5),
    ).rejects.toThrow("选段范围无效");
    await expect(
      quoteFromRange(folder, meta.id, "0001", 0, 999999),
    ).rejects.toThrow("选段范围无效");
  });

  it("删除后目录消失，也搜不到", async () => {
    const { root, folder } = await workspace();
    const { meta } = await importReference(
      folder,
      await fixture(root, "a.txt", NOVEL),
    );
    await deleteReference(folder, meta.id);
    expect(await listReferences(folder)).toEqual([]);
    expect(await searchReferences(folder, "暮色里")).toEqual([]);
    await expect(getReference(folder, meta.id)).rejects.toThrow("没有这份资料");
    await expect(deleteReference(folder, meta.id)).rejects.toThrow(
      "没有这份资料",
    );
  });

  it("失败的导入不留下半本书（无临时目录、无残留）", async () => {
    const { root, folder } = await workspace();
    await expect(
      importReference(
        folder,
        await fixture(root, "bad.epub", Buffer.from("PK nope")),
      ),
    ).rejects.toThrow();
    await expect(
      importReference(folder, await fixture(root, "empty.txt", "   \n  ")),
    ).rejects.toThrow("没有解析出任何正文");
    await expect(
      importReference(folder, path.join(root, "不存在.txt")),
    ).rejects.toThrow("找不到文件");
    const library = path.join(folder, ".wordhub", "references");
    const left = await readdir(library).catch(() => [] as string[]);
    expect(left).toEqual([]);
  });

  it("EPUB、DOCX、PDF 经由导入流程落盘，原件副本保持原扩展名", async () => {
    const { root, folder } = await workspace();
    const epub = await importReference(
      folder,
      await fixture(root, "书.epub", await makeEpub({})),
    );
    const pdf = await importReference(
      folder,
      await fixture(
        root,
        "论文.PDF",
        makePdf(["Some english text for pdf import"]),
      ),
    );
    expect(epub.meta.format).toBe("epub");
    expect(pdf.meta.format).toBe("pdf");
    expect(
      await readdir(path.join(folder, ".wordhub", "references", epub.meta.id)),
    ).toContain("source.epub");
    expect(
      await readdir(path.join(folder, ".wordhub", "references", pdf.meta.id)),
    ).toContain("source.pdf");
  });

  it("参考库目录是符号链接时拒绝导入，项目外不产生文件", async () => {
    const { root, folder } = await workspace();
    const outside = path.join(root, "外部");
    await mkdir(outside, { recursive: true });
    await mkdir(path.join(folder, ".wordhub"), { recursive: true });
    const linked = await symlink(
      outside,
      path.join(folder, ".wordhub", "references"),
      "junction",
    ).then(
      () => true,
      () => false,
    );
    if (!linked) return;
    await expect(
      importReference(folder, await fixture(root, "a.txt", NOVEL)),
    ).rejects.toThrow("符号链接");
    expect(await readdir(outside)).toEqual([]);
  });
});

// ── 文风示范 ─────────────────────────────────────────────────

describe("文风示范文件", () => {
  const sample = (n: number) => ({
    source: `《某书》第${n}章 标题`,
    anchor: `ref-aaaaaaaaaaaa/0001/${n}-${n + 40}`,
    text: `这是第${n}段示范文字。风从城门来，他在暮色里站了很久，没有说话。\n第二行也在。`,
  });

  it("追加、解析、删除保持往返一致，多行与空行原样保留", () => {
    let file = addStyleSample(undefined, sample(1));
    file = addStyleSample(file, sample(2));
    const parsed = parseStyleSamples(file);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual(sample(1));
    expect(file).toContain("不得照抄");
    expect(parseStyleSamples(removeStyleSample(file, 0))).toEqual([sample(2)]);
    const blank = addStyleSample(undefined, {
      source: "来源",
      text: "第一段文字，长度足够用来示范，没有问题。\n\n第二段文字，同样足够长，也要保留。",
    });
    expect(parseStyleSamples(blank)[0]?.text).toContain("\n\n");
  });

  it("引文里以“## ”开头的行不会被当成新的示例", () => {
    const file = addStyleSample(undefined, {
      source: "来源",
      text: "这是一段足够长的文字。\n## 示例 9 · 伪造的标题\n后面还有一句话。",
    });
    expect(parseStyleSamples(file)).toHaveLength(1);
    expect(parseStyleSamples(file)[0]?.text).toContain(
      "## 示例 9 · 伪造的标题",
    );
  });

  it("太短、太长、超过数量、重复都明确拒绝", () => {
    expect(() =>
      addStyleSample(undefined, { source: "s", text: "太短" }),
    ).toThrow("太短");
    expect(() =>
      addStyleSample(undefined, {
        source: "s",
        text: "字".repeat(STYLE_SAMPLE_LIMITS.maxChars + 1),
      }),
    ).toThrow("太长");
    let file: string | undefined;
    for (let i = 1; i <= STYLE_SAMPLE_LIMITS.count; i += 1)
      file = addStyleSample(file, sample(i));
    expect(() => addStyleSample(file, sample(99))).toThrow("最多保留");
    expect(() =>
      addStyleSample(addStyleSample(undefined, sample(1)), sample(1)),
    ).toThrow("已经在文风示范里");
    expect(() => removeStyleSample(file ?? "", 9)).toThrow(StyleSampleError);
  });
});
