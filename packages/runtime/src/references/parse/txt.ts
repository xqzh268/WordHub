import {
  decodeText,
  isChapterHeading,
  normalizeText,
  splitChapters,
} from "../split.js";
import type { ParsedChapter, ParsedReference } from "../types.js";

const baseName = (name: string): string =>
  name.replace(/^.*[\\/]/u, "").replace(/\.[^.]+$/u, "");

/** Markdown：用一、二级标题分章；没有标题就走和 TXT 一样的章标题识别。 */
function splitMarkdown(text: string): ParsedChapter[] {
  const lines = normalizeText(text).split("\n");
  const marks: number[] = [];
  lines.forEach((line, index) => {
    if (/^#{1,2}[ \t]+\S/u.test(line)) marks.push(index);
  });
  if (marks.length < 2) return splitChapters(text);
  const chapters: ParsedChapter[] = [];
  const lead = lines.slice(0, marks[0]).join("\n").trim();
  if (lead.length >= 200) chapters.push({ title: "开篇", text: lead });
  marks.forEach((start, position) => {
    const end = marks[position + 1] ?? lines.length;
    const title = (lines[start] ?? "").replace(/^#{1,2}[ \t]+/u, "").trim();
    const body = lines
      .slice(start + 1, end)
      .join("\n")
      .trim();
    if (body) chapters.push({ title, text: body });
  });
  return chapters;
}

export function parseText(
  buffer: Buffer,
  fileName: string,
  format: "txt" | "md",
): ParsedReference {
  const text = decodeText(buffer);
  const chapters = format === "md" ? splitMarkdown(text) : splitChapters(text);
  // 第一行像书名（短、不是章标题）时当作书名
  const firstLine = normalizeText(text).split("\n")[0]?.trim() ?? "";
  const titled =
    firstLine && firstLine.length <= 40 && !isChapterHeading(firstLine)
      ? firstLine.replace(/^#+\s*/u, "")
      : "";
  return { title: titled || baseName(fileName), format, chapters };
}
