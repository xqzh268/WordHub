import iconv from "iconv-lite";
import { type Block, parseChapter, plainText } from "./blocks.js";

export type TextEncoding = "utf-8" | "gb18030";

export type ExportChapter = {
  /** 章节文件名，如“第一章.md”，标题缺失时用来兜底 */
  name: string;
  markdown: string;
};

/** 中文排版习惯：段首空两个全角空格。 */
const INDENT = "　　";
const NEWLINE = "\r\n";

const blockText = (block: Block): string => {
  switch (block.kind) {
    case "heading":
      return plainText(block.runs).trim();
    case "quote":
      return `${INDENT}${plainText(block.runs).trim()}`;
    case "rule":
      return "* * *";
    case "paragraph":
      return plainText(block.runs)
        .split("\n")
        .map((line) => `${INDENT}${line.trim()}`)
        .join(NEWLINE);
  }
};

export const chapterTitle = (chapter: ExportChapter): string =>
  parseChapter(chapter.markdown).title ??
  chapter.name.replace(/\.(?:md|markdown|txt)$/iu, "");

/** 整理成纯文本：章标题、空行、段落（段首缩进）；多章之间空两行。 */
export function toPlainText(
  chapters: ExportChapter[],
  options: { bookTitle?: string } = {},
): string {
  const parts: string[] = [];
  if (options.bookTitle) parts.push(options.bookTitle, "");
  chapters.forEach((chapter, index) => {
    const parsed = parseChapter(chapter.markdown);
    const lines = [chapterTitle(chapter)];
    for (const block of parsed.blocks) lines.push("", blockText(block));
    if (index > 0) parts.push("", "");
    parts.push(lines.join(NEWLINE));
  });
  return `${parts.join(NEWLINE)}${NEWLINE}`;
}

export class UnencodableTextError extends Error {
  constructor(
    readonly encoding: string,
    readonly characters: string[],
  ) {
    super(
      `${encoding} 无法编码这些字符：${characters.slice(0, 10).join(" ")}${characters.length > 10 ? "……" : ""}。请改用 UTF-8，或先修改这些字符。`,
    );
    this.name = "UnencodableTextError";
  }
}

/**
 * 按所选编码转成字节。GB18030 理论上覆盖全部 Unicode，但孤立代理项等仍可能无法编码；
 * 这里编码后再解码比对，发现被替换的字符就明确报错，不让 iconv 静默换成问号。
 */
export function encodeText(text: string, encoding: TextEncoding): Buffer {
  if (encoding === "utf-8") return Buffer.from(text, "utf8");
  const encoded = iconv.encode(text, encoding);
  const decoded = iconv.decode(encoded, encoding);
  if (decoded === text) return encoded;
  const lost = new Set<string>();
  const original = Array.from(text);
  const roundTrip = Array.from(decoded);
  // 长度可能不同（被替换成问号后码点数不变，但保险起见逐个比较较短的一侧）
  for (let index = 0; index < original.length; index += 1)
    if (original[index] !== roundTrip[index]) lost.add(original[index] ?? "");
  throw new UnencodableTextError(encoding, [...lost]);
}
