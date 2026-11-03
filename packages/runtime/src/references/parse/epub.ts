import { JSDOM } from "jsdom";
import { normalizeText, usableAuthor } from "../split.js";
import {
  type ParsedChapter,
  type ParsedReference,
  ReferenceLibraryError,
} from "../types.js";
import { openZip, readEntry, resolveEntry } from "./zip.js";

/** 字体混淆不算 DRM；出现其他加密算法就是受保护的书。 */
const FONT_OBFUSCATION = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
]);

const BLOCKS = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "SECTION",
  "ARTICLE",
  "TR",
  "DD",
  "DT",
  "UL",
  "OL",
  "TABLE",
  "BODY",
  "HEADER",
  "FOOTER",
]);
const CJK = /[　-鿿＀-￯]/u;

type Manifest = Map<string, { href: string; type: string; properties: string }>;

const xml = (text: string): Document =>
  new JSDOM(text, { contentType: "text/xml" }).window.document;
const xhtml = (text: string): Document => {
  try {
    return new JSDOM(text, { contentType: "application/xhtml+xml" }).window
      .document;
  } catch {
    // 不是严格的 XML（常见于手工制作的电子书）时按普通 HTML 宽松解析
    return new JSDOM(text).window.document;
  }
};

/** 行内折行：两侧都是中日韩文字就直接连起来，否则换成一个空格。 */
function joinInline(text: string): string {
  return text
    .replace(/\s*\n\s*/gu, (match, offset: number, whole: string) => {
      const before = whole[offset - 1] ?? "";
      const after = whole[offset + match.length] ?? "";
      return CJK.test(before) && CJK.test(after) ? "" : " ";
    })
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

/** 取 XHTML 里的正文段落（块级元素各成一段）。 */
export function xhtmlParagraphs(source: string): string[] {
  const doc = xhtml(source);
  for (const node of Array.from(doc.querySelectorAll("script,style,head,nav")))
    node.remove();
  const out: string[] = [];
  const walk = (element: Element): void => {
    let buffer = "";
    const flush = () => {
      const value = joinInline(buffer);
      if (value) out.push(value);
      buffer = "";
    };
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 3) buffer += node.textContent ?? "";
      else if (node.nodeType === 1) {
        const child = node as Element;
        const tag = child.tagName.toUpperCase();
        if (tag === "BR") flush();
        else if (BLOCKS.has(tag)) {
          flush();
          walk(child);
        } else buffer += child.textContent ?? "";
      }
    }
    flush();
  };
  if (doc.body) walk(doc.body);
  return out;
}

const dirOf = (entry: string): string =>
  entry.includes("/") ? `${entry.slice(0, entry.lastIndexOf("/"))}/` : "";

async function tocTitles(
  zip: Awaited<ReturnType<typeof openZip>>,
  opfDir: string,
  opf: Document,
  manifest: Manifest,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const set = (entry: string, label: string | null | undefined) => {
    const title = (label ?? "").replace(/\s+/gu, " ").trim();
    if (title && !titles.has(entry)) titles.set(entry, title);
  };
  const nav = [...manifest.values()].find((item) =>
    item.properties.split(/\s+/u).includes("nav"),
  );
  if (nav) {
    const base = resolveEntry(opfDir, nav.href);
    const text = await readEntry(zip, base);
    if (text)
      for (const a of Array.from(xhtml(text).querySelectorAll("nav a[href]")))
        set(
          resolveEntry(dirOf(base), a.getAttribute("href") ?? ""),
          a.textContent,
        );
  }
  if (!titles.size) {
    const tocId = opf.querySelector("spine")?.getAttribute("toc");
    const ncx = tocId ? manifest.get(tocId) : undefined;
    if (ncx) {
      const base = resolveEntry(opfDir, ncx.href);
      const text = await readEntry(zip, base);
      if (text)
        for (const point of Array.from(xml(text).querySelectorAll("navPoint")))
          set(
            resolveEntry(
              dirOf(base),
              point.querySelector("content")?.getAttribute("src") ?? "",
            ),
            point.querySelector("navLabel > text")?.textContent,
          );
    }
  }
  return titles;
}

export async function parseEpub(
  buffer: Buffer,
  fileName: string,
): Promise<ParsedReference> {
  const zip = await openZip(buffer, "EPUB ");
  const encryption = await readEntry(zip, "META-INF/encryption.xml");
  if (encryption) {
    const algorithms = Array.from(
      xml(encryption).querySelectorAll("EncryptionMethod"),
    ).map((node) => node.getAttribute("Algorithm") ?? "");
    if (algorithms.some((algorithm) => !FONT_OBFUSCATION.has(algorithm)))
      throw new ReferenceLibraryError(
        "这本 EPUB 带有 DRM 加密保护，文枢不提供去除 DRM 的功能，无法导入。请使用你有权使用的无 DRM 版本。",
      );
  }
  const container = await readEntry(zip, "META-INF/container.xml");
  const opfPath = container
    ? xml(container).querySelector("rootfile")?.getAttribute("full-path")
    : undefined;
  if (!opfPath)
    throw new ReferenceLibraryError(
      "EPUB 缺少 META-INF/container.xml，不是有效的电子书",
    );
  const opfText = await readEntry(zip, opfPath);
  if (!opfText) throw new ReferenceLibraryError("EPUB 找不到包文件（OPF）");
  const opf = xml(opfText);
  const opfDir = dirOf(opfPath);
  const manifest: Manifest = new Map();
  for (const item of Array.from(opf.querySelectorAll("manifest > item")))
    manifest.set(item.getAttribute("id") ?? "", {
      href: item.getAttribute("href") ?? "",
      type: item.getAttribute("media-type") ?? "",
      properties: item.getAttribute("properties") ?? "",
    });
  const titles = await tocTitles(zip, opfDir, opf, manifest);
  const meta = (name: string) =>
    opf.getElementsByTagNameNS("*", name)[0]?.textContent?.trim() || undefined;

  const chapters: ParsedChapter[] = [];
  for (const ref of Array.from(opf.querySelectorAll("spine > itemref"))) {
    const item = manifest.get(ref.getAttribute("idref") ?? "");
    if (!item || !/x?html/iu.test(item.type)) continue;
    const entry = resolveEntry(opfDir, item.href);
    const source = await readEntry(zip, entry);
    if (!source) continue;
    const text = normalizeText(xhtmlParagraphs(source).join("\n\n"));
    if (text.replace(/\s/gu, "").length < 10) continue;
    const heading = xhtml(source)
      .querySelector("h1,h2,h3")
      ?.textContent?.replace(/\s+/gu, " ")
      .trim();
    chapters.push({
      title: titles.get(entry) ?? (heading || `第 ${chapters.length + 1} 部分`),
      text,
    });
  }
  if (!chapters.length)
    throw new ReferenceLibraryError("EPUB 里没有可读取的正文");
  return {
    title: meta("title") ?? fileName.replace(/\.[^.]+$/u, ""),
    author: usableAuthor(meta("creator")),
    format: "epub",
    chapters,
  };
}
