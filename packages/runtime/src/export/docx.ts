import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { type Block, type Run, parseChapter } from "./blocks.js";
import { type ExportChapter, chapterTitle } from "./txt.js";

export type DocxFonts = {
  /** 正文字体（中文）；默认“宋体” */
  body: string;
  /** 标题字体（中文）；默认“楷体” */
  heading: string;
  /** 西文与数字字体；默认 Times New Roman */
  latin?: string;
};

export const DEFAULT_DOCX_FONTS: DocxFonts = {
  body: "宋体",
  heading: "楷体",
  latin: "Times New Roman",
};

export type DocxOptions = {
  fonts?: Partial<DocxFonts>;
  bookTitle?: string;
  /** 正文字号（磅），默认 12（小四） */
  bodySizePt?: number;
  /** 行距倍数，默认 1.5 */
  lineSpacing?: number;
};

const HEADING_SIZE: Record<1 | 2 | 3, number> = { 1: 2, 2: 1.5, 3: 1.25 };
const HEADING_LEVEL = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
} as const;

/** 字体名只能是名字：不允许控制字符，长度有限，避免把任意内容写进 OOXML 属性。 */
export function assertFontName(name: string, label: string): string {
  const trimmed = name.trim();
  const hasControl = Array.from(trimmed).some(
    (char) => (char.codePointAt(0) ?? 0) < 32,
  );
  if (!trimmed || trimmed.length > 80 || hasControl || /[<>"&]/u.test(trimmed))
    throw new Error(`${label}字体名无效：${JSON.stringify(name)}`);
  return trimmed;
}

export async function buildDocx(
  chapters: ExportChapter[],
  options: DocxOptions = {},
): Promise<Buffer> {
  const fonts: DocxFonts = {
    ...DEFAULT_DOCX_FONTS,
    ...options.fonts,
  } as DocxFonts;
  const body = assertFontName(fonts.body, "正文");
  const heading = assertFontName(fonts.heading, "标题");
  const latin = assertFontName(fonts.latin ?? "Times New Roman", "西文");
  const sizePt = options.bodySizePt ?? 12;
  if (!(sizePt >= 6 && sizePt <= 72))
    throw new Error("正文字号需在 6–72 磅之间");
  const spacing = options.lineSpacing ?? 1.5;
  if (!(spacing >= 1 && spacing <= 3)) throw new Error("行距需在 1–3 倍之间");
  const halfPoints = Math.round(sizePt * 2);

  const bodyFont = { ascii: latin, hAnsi: latin, cs: latin, eastAsia: body };
  const headingFont = {
    ascii: latin,
    hAnsi: latin,
    cs: latin,
    eastAsia: heading,
  };
  const runs = (items: Run[], font: typeof bodyFont, size?: number) =>
    items.flatMap((item) =>
      item.text.split("\n").map(
        (text, index) =>
          new TextRun({
            text,
            font,
            size: size ?? halfPoints,
            bold: item.bold,
            italics: item.italic,
            // 行内换行：第二行起带 break
            ...(index > 0 ? { break: 1 } : {}),
          }),
      ),
    );

  const blockParagraph = (block: Block): Paragraph => {
    switch (block.kind) {
      case "heading":
        return new Paragraph({
          heading: HEADING_LEVEL[block.level],
          alignment: AlignmentType.CENTER,
          spacing: { before: 240, after: 240 },
          children: runs(
            block.runs.map((item) => ({ ...item, bold: true })),
            headingFont,
            Math.round(halfPoints * HEADING_SIZE[block.level]),
          ),
        });
      case "quote":
        return new Paragraph({
          indent: { left: 840 },
          spacing: { line: Math.round(240 * spacing) },
          children: runs(
            block.runs.map((item) => ({ ...item, italic: true })),
            bodyFont,
          ),
        });
      case "rule":
        return new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 240, after: 240 },
          children: [new TextRun({ text: "* * *", font: bodyFont })],
        });
      case "paragraph":
        return new Paragraph({
          // 首行缩进两个字符，随字号变化
          indent: { firstLineChars: 200 },
          spacing: { line: Math.round(240 * spacing) },
          children: runs(block.runs, bodyFont),
        });
    }
  };

  const children: Paragraph[] = [];
  if (options.bookTitle)
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 4800, after: 480 },
        children: runs(
          [{ text: options.bookTitle, bold: true }],
          headingFont,
          Math.round(halfPoints * 2.5),
        ),
      }),
    );
  chapters.forEach((chapter, index) => {
    const parsed = parseChapter(chapter.markdown);
    // 每章另起一页（书名页之后的第一章同样另起）
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        pageBreakBefore: index > 0 || Boolean(options.bookTitle),
        spacing: { before: 480, after: 360 },
        children: runs(
          [{ text: chapterTitle(chapter), bold: true }],
          headingFont,
          Math.round(halfPoints * 1.5),
        ),
      }),
    );
    for (const block of parsed.blocks) children.push(blockParagraph(block));
  });

  const document = new Document({
    creator: "文枢 WordHub",
    title:
      options.bookTitle ??
      chapterTitle(chapters[0] ?? { name: "", markdown: "" }),
    styles: {
      default: {
        document: {
          run: { font: bodyFont, size: halfPoints },
        },
      },
    },
    sections: [{ children }],
  });
  return Packer.toBuffer(document);
}
