import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseChapter, parseInline } from "./blocks.js";
import { buildDocx } from "./docx.js";
import { listInstalledFonts, normalizeFontNames } from "./fonts.js";
import { exportChapters } from "./run.js";
import { UnencodableTextError, encodeText, toPlainText } from "./txt.js";

const CHAPTER_ONE =
  "# 第一章 暮鼓\n\n暮鼓三百声，**长安**闭坊。\n第二行同段。\n\n> 风从城门来\n\n---\n\n他说：“别走。”\n";
const CHAPTER_TWO = "# 第二章 残月\n\n价格是 5\\*3\\*2。\n";

async function docxParts(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const document = await zip.file("word/document.xml")?.async("string");
  const styles = await zip.file("word/styles.xml")?.async("string");
  return { document: document ?? "", styles: styles ?? "", zip };
}
const textOf = (xml: string) =>
  [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/gu)].map((m) => m[1]).join("");

describe("导出：Markdown 解析", () => {
  it("行内粗体、斜体与转义", () => {
    expect(parseInline("a**b**c*d*")).toEqual([
      { text: "a" },
      { text: "b", bold: true },
      { text: "c" },
      { text: "d", italic: true },
    ]);
    expect(parseInline("5\\*3\\*2 与 a\\_b")).toEqual([
      { text: "5*3*2 与 a_b" },
    ]);
  });

  it("章标题单独取出，正文里不重复", () => {
    const parsed = parseChapter(CHAPTER_ONE);
    expect(parsed.title).toBe("第一章 暮鼓");
    expect(parsed.blocks.map((b) => b.kind)).toEqual([
      "paragraph",
      "quote",
      "rule",
      "paragraph",
    ]);
  });
});

describe("导出：TXT", () => {
  const chapters = [
    { name: "第一章.md", markdown: CHAPTER_ONE },
    { name: "第二章.md", markdown: CHAPTER_TWO },
  ];

  it("章标题、段首缩进两个全角空格、章间空两行、CRLF", () => {
    const text = toPlainText(chapters, { bookTitle: "长安夜" });
    expect(text.startsWith("长安夜\r\n\r\n第一章 暮鼓\r\n\r\n")).toBe(true);
    expect(text).toContain("　　暮鼓三百声，长安闭坊。\r\n　　第二行同段。");
    expect(text).toContain("* * *");
    expect(text).toContain("\r\n\r\n\r\n第二章 残月\r\n");
    expect(text).toContain("　　价格是 5*3*2。");
    expect(text).not.toContain("**");
  });

  it("没有标题的章节用文件名兜底", () => {
    expect(
      toPlainText([{ name: "chapter-03.md", markdown: "只有正文\n" }]),
    ).toMatch(/^chapter-03\r\n/u);
  });

  it("UTF-8 与 GB18030 编码，GB18030 能还原生僻字和全角标点", () => {
    const text = toPlainText(chapters);
    expect(encodeText(text, "utf-8").toString("utf8")).toBe(text);
    const gb = encodeText(`${text}龘㐀𠮷`, "gb18030");
    expect(iconv.decode(gb, "gb18030")).toBe(`${text}龘㐀𠮷`);
    // GB18030 字节不同于 UTF-8
    expect(gb.equals(Buffer.from(`${text}龘㐀𠮷`, "utf8"))).toBe(false);
  });

  it("无法编码的字符明确报错并点名，不静默替换", () => {
    const lone = "正常文字\ud800结尾";
    let error: unknown;
    try {
      encodeText(lone, "gb18030");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UnencodableTextError);
    expect((error as UnencodableTextError).message).toContain("无法编码");
  });
});

describe("导出：DOCX", () => {
  const chapters = [
    { name: "第一章.md", markdown: CHAPTER_ONE },
    { name: "第二章.md", markdown: CHAPTER_TWO },
  ];

  it("默认宋体正文、楷体标题，章标题居中且每章另起一页，正文首行缩进两字", async () => {
    const { document, styles } = await docxParts(await buildDocx(chapters));
    expect(document).toContain('w:eastAsia="宋体"');
    expect(document).toContain('w:eastAsia="楷体"');
    expect(styles).toContain('w:eastAsia="宋体"');
    expect(document).toContain('w:firstLineChars="200"');
    // 第二章另起一页，第一章不分页
    expect(document.match(/<w:pageBreakBefore\/>/gu)?.length).toBe(1);
    expect(document).toContain('<w:jc w:val="center"/>');
    const text = textOf(document);
    expect(text).toContain("第一章 暮鼓");
    expect(text).toContain("暮鼓三百声，");
    expect(text).toContain("价格是 5*3*2。");
    expect(document).toContain("<w:b/>");
  });

  it("用户指定已安装字体：正文、标题、西文字体都写进文档", async () => {
    const { document } = await docxParts(
      await buildDocx(chapters, {
        fonts: { body: "方正书宋_GBK", heading: "汉仪楷体", latin: "Garamond" },
      }),
    );
    expect(document).toContain('w:eastAsia="方正书宋_GBK"');
    expect(document).toContain('w:eastAsia="汉仪楷体"');
    expect(document).toContain('w:ascii="Garamond"');
    expect(document).not.toContain('w:eastAsia="宋体"');
  });

  it("书名页、字号与行距可调", async () => {
    const { document } = await docxParts(
      await buildDocx(chapters, {
        bookTitle: "长安夜",
        bodySizePt: 14,
        lineSpacing: 2,
      }),
    );
    expect(textOf(document).startsWith("长安夜")).toBe(true);
    expect(document).toContain('<w:sz w:val="28"/>');
    expect(document).toContain('w:line="480"');
    // 有书名页时第一章也另起一页
    expect(document.match(/<w:pageBreakBefore\/>/gu)?.length).toBe(2);
  });

  it("拒绝不合法的字体名、字号和行距", async () => {
    await expect(
      buildDocx(chapters, { fonts: { body: '宋体"><w:evil/>' } }),
    ).rejects.toThrow("字体名无效");
    await expect(
      buildDocx(chapters, { fonts: { heading: "   " } }),
    ).rejects.toThrow("字体名无效");
    await expect(buildDocx(chapters, { bodySizePt: 2 })).rejects.toThrow(
      "字号",
    );
    await expect(buildDocx(chapters, { lineSpacing: 9 })).rejects.toThrow(
      "行距",
    );
  });

  it("转义字符不会破坏 XML：标点、尖括号和 & 原样出现在文字里", async () => {
    const { document } = await docxParts(
      await buildDocx([
        { name: "x.md", markdown: "# 标题\n\n甲 & 乙 <丙> “丁”\n" },
      ]),
    );
    expect(textOf(document)).toContain("甲 &amp; 乙 &lt;丙&gt; “丁”");
  });
});

describe("导出：写出文件", () => {
  async function project() {
    const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-export-"));
    const folder = path.join(root, "写作", "长安夜");
    await mkdir(path.join(folder, "chapters"), { recursive: true });
    await writeFile(path.join(folder, "chapters", "第一章.md"), CHAPTER_ONE);
    await writeFile(path.join(folder, "chapters", "第二章.md"), CHAPTER_TWO);
    await writeFile(
      path.join(folder, "chapters", "第十章.md"),
      "# 第十章\n\n终章。\n",
    );
    return { root, folder };
  }

  it("全书按章号排序导出（第十章在第二章之后），中文路径可写", async () => {
    const { root, folder } = await project();
    const out = path.join(root, "输出", "长安夜.txt");
    const result = await exportChapters({
      folder,
      scope: "book",
      format: "txt-utf8",
      outPath: out,
      bookTitle: "长安夜",
    });
    expect(result.chapters).toBe(3);
    const text = await readFile(out, "utf8");
    expect(text.indexOf("第一章 暮鼓")).toBeLessThan(
      text.indexOf("第二章 残月"),
    );
    expect(text.indexOf("第二章 残月")).toBeLessThan(text.indexOf("第十章"));
  });

  it("当前章导出；GB18030 文件按该编码写出", async () => {
    const { root, folder } = await project();
    const out = path.join(root, "第一章.txt");
    await exportChapters({
      folder,
      scope: "chapter",
      chapterPath: "chapters/第一章.md",
      format: "txt-gb18030",
      outPath: out,
    });
    const bytes = await readFile(out);
    expect(iconv.decode(bytes, "gb18030")).toContain("暮鼓三百声");
    expect(bytes.toString("utf8")).not.toContain("暮鼓三百声");
  });

  it("DOCX 文件能被读回", async () => {
    const { root, folder } = await project();
    const out = path.join(root, "全书.docx");
    await exportChapters({
      folder,
      scope: "book",
      format: "docx",
      outPath: out,
      docx: { fonts: { body: "仿宋" } },
    });
    const { document } = await docxParts(await readFile(out));
    expect(document).toContain('w:eastAsia="仿宋"');
    expect(textOf(document)).toContain("终章。");
  });

  it("没有章节、章节路径越界时报错，不产生文件", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-export-"));
    const folder = path.join(root, "空项目");
    await mkdir(folder, { recursive: true });
    await expect(
      exportChapters({
        folder,
        scope: "book",
        format: "txt-utf8",
        outPath: path.join(root, "x.txt"),
      }),
    ).rejects.toThrow("还没有章节");
    await expect(
      exportChapters({
        folder,
        scope: "chapter",
        chapterPath: "../outside.md",
        format: "txt-utf8",
        outPath: path.join(root, "y.txt"),
      }),
    ).rejects.toThrow();
    await expect(readFile(path.join(root, "x.txt"))).rejects.toThrow();
  });
});

describe("导出：字体列表", () => {
  it("名称去重排序，去掉竖排变体", () => {
    expect(
      normalizeFontNames(["宋体", " 宋体 ", "@宋体", "Arial", "", "楷体"]),
    ).toEqual(["Arial", "宋体", "楷体"]);
  });

  it("本机字体枚举不抛错（失败时返回空数组）", async () => {
    const fonts = await listInstalledFonts();
    expect(Array.isArray(fonts)).toBe(true);
    if (process.platform === "win32") expect(fonts.length).toBeGreaterThan(0);
  });
});
