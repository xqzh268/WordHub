import { JSDOM } from "jsdom";
import { normalizeText, splitChapters, usableAuthor } from "../split.js";
import {
  type ParsedChapter,
  type ParsedReference,
  ReferenceLibraryError,
} from "../types.js";
import { openZip, readEntry } from "./zip.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const xml = (text: string): Document =>
  new JSDOM(text, { contentType: "text/xml" }).window.document;

const textOfRuns = (paragraph: Element): string => {
  let out = "";
  for (const node of Array.from(paragraph.getElementsByTagNameNS(W, "*"))) {
    if (node.localName === "t") out += node.textContent ?? "";
    else if (node.localName === "tab") out += "\t";
    else if (node.localName === "br") out += "\n";
  }
  return out;
};

/** styleId → 标题级别（1–9），来自 styles.xml 里样式名“heading N / 标题 N”。 */
function headingLevels(stylesXml: string | undefined): Map<string, number> {
  const levels = new Map<string, number>();
  if (!stylesXml) return levels;
  for (const style of Array.from(
    xml(stylesXml).getElementsByTagNameNS(W, "style"),
  )) {
    const id = style.getAttributeNS(W, "styleId") ?? "";
    const name =
      style.getElementsByTagNameNS(W, "name")[0]?.getAttributeNS(W, "val") ??
      "";
    const match = /^(?:heading|标题)\s*([1-9])$/iu.exec(name.trim());
    if (id && match?.[1]) levels.set(id, Number(match[1]));
  }
  return levels;
}

export async function parseDocx(
  buffer: Buffer,
  fileName: string,
): Promise<ParsedReference> {
  const zip = await openZip(buffer, "DOCX ");
  const body = await readEntry(zip, "word/document.xml");
  if (!body)
    throw new ReferenceLibraryError(
      "这不是有效的 DOCX（缺少 word/document.xml）",
    );
  const levels = headingLevels(await readEntry(zip, "word/styles.xml"));
  const doc = xml(body);

  const blocks: Array<{ level: number; text: string }> = [];
  for (const paragraph of Array.from(doc.getElementsByTagNameNS(W, "p"))) {
    const text = textOfRuns(paragraph).trim();
    if (!text) continue;
    const styleId =
      paragraph
        .getElementsByTagNameNS(W, "pStyle")[0]
        ?.getAttributeNS(W, "val") ?? "";
    blocks.push({ level: levels.get(styleId) ?? 0, text });
  }
  if (!blocks.length)
    throw new ReferenceLibraryError("DOCX 里没有可读取的文字");

  // 用最高一级标题分章（一级优先，没有就用二级…）
  const top = Math.min(
    ...blocks.filter((b) => b.level > 0).map((b) => b.level),
  );
  let chapters: ParsedChapter[] = [];
  if (
    Number.isFinite(top) &&
    blocks.filter((b) => b.level === top).length >= 2
  ) {
    let current: { title: string; lines: string[] } | undefined;
    const lead: string[] = [];
    for (const block of blocks) {
      if (block.level === top) {
        if (current)
          chapters.push({
            title: current.title,
            text: current.lines.join("\n\n"),
          });
        current = { title: block.text, lines: [] };
      } else if (current) current.lines.push(block.text);
      else lead.push(block.text);
    }
    if (current)
      chapters.push({ title: current.title, text: current.lines.join("\n\n") });
    const leadText = lead.join("\n\n");
    if (leadText.length >= 200)
      chapters.unshift({ title: "开篇", text: leadText });
    chapters = chapters
      .map((chapter) => ({ ...chapter, text: normalizeText(chapter.text) }))
      .filter((chapter) => chapter.text);
  } else chapters = splitChapters(blocks.map((b) => b.text).join("\n\n"));

  const core = await readEntry(zip, "docProps/core.xml");
  const coreDoc = core ? xml(core) : undefined;
  const meta = (name: string) =>
    coreDoc?.getElementsByTagNameNS("*", name)[0]?.textContent?.trim() ||
    undefined;
  return {
    title: meta("title") ?? fileName.replace(/\.[^.]+$/u, ""),
    author: usableAuthor(meta("creator")),
    format: "docx",
    chapters,
  };
}
