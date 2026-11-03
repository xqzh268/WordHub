import iconv from "iconv-lite";
import type { ParsedChapter } from "./types.js";

const HEADING_START =
  /^[ \t　]*(?:第[ \t　]*[零〇一二两三四五六七八九十百千万\d]{1,9}[ \t　]*[章回节卷集部篇幕]|(?:楔子|序章|序言|序|引子|前言|后记|尾声|终章|番外)|chapter[ \t]+(?:\d+|[ivxlc]+)|prologue|epilogue)/iu;

/** 一行是不是章标题：以“第N章/序章/Chapter N”之类起头，不长，不像一句完整的话。 */
export function isChapterHeading(line: string): boolean {
  const text = line.trim();
  if (!text || text.length > 40) return false;
  if (!HEADING_START.test(text)) return false;
  // 带句号、感叹号或引号的更像正文（如“第三章里他说……”）
  return !/[。！？“”「」]/u.test(text);
}

/** 解码文本文件：BOM → 严格 UTF-8 → 失败回退 GB18030。 */
export function decodeText(buffer: Buffer): string {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  )
    return buffer.subarray(3).toString("utf8");
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe)
    return iconv.decode(buffer.subarray(2), "utf16le");
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff)
    return iconv.decode(buffer.subarray(2), "utf16-be");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return iconv.decode(buffer, "gb18030");
  }
}

/** 统一换行、去掉行尾空白，三个以上空行收成一个空行。 */
export function normalizeText(text: string): string {
  return text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/[ \t　]+$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

const CHUNK_CHARS = 8000;

/** 没有章标题时：在段落边界按约 8000 字分块。 */
function chunkByParagraph(text: string): ParsedChapter[] {
  const paragraphs = text.split(/\n{2,}|\n/u).filter((p) => p.trim());
  const chapters: ParsedChapter[] = [];
  let current: string[] = [];
  let size = 0;
  const flush = () => {
    if (current.length)
      chapters.push({
        title: `第 ${chapters.length + 1} 段`,
        text: current.join("\n\n"),
      });
    current = [];
    size = 0;
  };
  for (const paragraph of paragraphs) {
    if (size > 0 && size + paragraph.length > CHUNK_CHARS) flush();
    current.push(paragraph);
    size += paragraph.length;
  }
  flush();
  return chapters;
}

/** 把整本书的文本切成章：按章标题；找不到（少于 2 个）就按段落分块。 */
export function splitChapters(raw: string): ParsedChapter[] {
  const text = normalizeText(raw);
  if (!text) return [];
  const lines = text.split("\n");
  const headings: number[] = [];
  lines.forEach((line, index) => {
    if (isChapterHeading(line)) headings.push(index);
  });
  if (headings.length < 2) return chunkByParagraph(text);
  const chapters: ParsedChapter[] = [];
  const first = headings[0] ?? 0;
  const lead = lines.slice(0, first).join("\n").trim();
  // 章标题之前的内容（书名、简介等）够长就单独成一段，否则丢掉（多半只是书名行）
  if (lead.length >= 200) chapters.push({ title: "开篇", text: lead });
  headings.forEach((start, position) => {
    const end = headings[position + 1] ?? lines.length;
    const title = (lines[start] ?? "").trim();
    const body = lines
      .slice(start + 1, end)
      .join("\n")
      .trim();
    if (body) chapters.push({ title, text: body });
  });
  return chapters;
}

const PLACEHOLDER_AUTHORS =
  /^(un-?named|unknown|anonymous|administrator|admin|user|owner|author|作者|佚名|未知|匿名|microsoft office user)$/iu;

/** 文件元数据里的作者常是占位符（docx 库默认的 “Un-named”、Word 的 “Administrator”）：当作没有。 */
export function usableAuthor(
  author: string | undefined | null,
): string | undefined {
  const value = author?.replace(/\s+/gu, " ").trim();
  if (!value || value.length > 120 || PLACEHOLDER_AUTHORS.test(value))
    return undefined;
  return value;
}
