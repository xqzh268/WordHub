import { splitChapters, usableAuthor } from "../split.js";
import {
  LIMITS,
  type ParsedChapter,
  type ParsedReference,
  ReferenceLibraryError,
} from "../types.js";

const CJK = /[　-鿿＀-￯]/u;

type TextItem = { str: string; hasEOL?: boolean };

/** PDF 元数据里的标题常常是垃圾：网页地址、“Microsoft Word - x.docx”、“Untitled”。这些不当书名，用文件名。 */
export function usablePdfTitle(title: string | undefined): string | undefined {
  const value = title?.trim();
  if (!value || value.length > 200) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value) || value.includes("://"))
    return undefined;
  if (/^(untitled|无标题|未命名)/iu.test(value)) return undefined;
  if (/^microsoft (word|powerpoint|excel)\s*-/iu.test(value)) return undefined;
  if (/\.(docx?|pptx?|xlsx?|tex|indd|pdf)$/iu.test(value)) return undefined;
  return value;
}

/**
 * Electron 的 utilityProcess 里 process.type 是 "utility"，pdf.js 因此不把它当 Node，
 * 走浏览器分支并要求 DOMMatrix 等对象。我们只取文字、不渲染，给一个最小的 DOMMatrix 占位即可
 * （普通 Node 和测试环境不受影响：已有就不覆盖）。
 */
function ensurePdfEnvironment(): void {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (typeof scope.DOMMatrix !== "undefined") return;
  scope.DOMMatrix = class DOMMatrixStub {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    constructor(init?: ArrayLike<number> | string) {
      if (init && typeof init !== "string" && init.length >= 6) {
        this.a = init[0] ?? 1;
        this.b = init[1] ?? 0;
        this.c = init[2] ?? 0;
        this.d = init[3] ?? 1;
        this.e = init[4] ?? 0;
        this.f = init[5] ?? 0;
      }
    }
    multiplySelf(): this {
      return this;
    }
    preMultiplySelf(): this {
      return this;
    }
    translate(): this {
      return this;
    }
    scale(): this {
      return this;
    }
    invertSelf(): this {
      return this;
    }
  };
}

/** 拼一页文字：按 pdf.js 给的换行标记分行；相邻两侧都是中日韩文字不加空格。 */
function pageText(items: TextItem[]): string {
  let out = "";
  for (const item of items) {
    if (!item.str) {
      if (item.hasEOL) out += "\n";
      continue;
    }
    const last = out.at(-1) ?? "";
    const first = item.str[0] ?? "";
    if (
      last &&
      last !== "\n" &&
      !CJK.test(last) &&
      !CJK.test(first) &&
      !/\s/u.test(last) &&
      !/\s/u.test(first)
    )
      out += " ";
    out += item.str;
    if (item.hasEOL) out += "\n";
  }
  return out;
}

/** 有文本层的 PDF：按页取文字。没有文本层（扫描件）明确报错，不做 OCR。 */
export async function parsePdf(
  buffer: Buffer,
  fileName: string,
): Promise<ParsedReference> {
  ensurePdfEnvironment();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // 非 Node 判定下 pdf.js 要求指定 worker 文件；指向同一份 legacy worker，由 pdf.js 在本进程内回退为“假 worker”运行
  if (!pdfjs.GlobalWorkerOptions.workerSrc)
    pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve(
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
    );
  let document: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: false,
      verbosity: 0,
    }).promise;
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "PasswordException")
      throw new ReferenceLibraryError("这个 PDF 设置了密码，无法导入");
    const detail = error instanceof Error ? error.message : String(error);
    throw new ReferenceLibraryError(
      `PDF 文件已损坏或格式不受支持，无法读取（${detail.slice(0, 120)}）`,
    );
  }
  try {
    if (document.numPages > LIMITS.pdfPages)
      throw new ReferenceLibraryError(
        `这个 PDF 有 ${document.numPages} 页，超过上限 ${LIMITS.pdfPages} 页`,
      );
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(
        pageText(
          content.items.filter(
            (item): item is typeof item & TextItem => "str" in item,
          ),
        ),
      );
      page.cleanup();
    }
    const total = pages.join("").replace(/\s/gu, "").length;
    if (total < 20 || total < document.numPages * 10)
      throw new ReferenceLibraryError(
        "这个 PDF 没有可提取的文字层（可能是扫描件）。文枢暂不支持 OCR，请先用其他工具转成带文字层的 PDF，或改用 EPUB/TXT。",
      );
    const info = (await document.getMetadata().catch(() => undefined))?.info as
      | { Title?: string; Author?: string }
      | undefined;
    // 先按章标题切；切不出来就每 10 页一段
    let chapters: ParsedChapter[] = splitChapters(pages.join("\n\n"));
    if (chapters.length <= 1 && pages.length > 10) {
      chapters = [];
      for (let start = 0; start < pages.length; start += 10) {
        const slice = pages
          .slice(start, start + 10)
          .join("\n\n")
          .trim();
        if (slice)
          chapters.push({
            title: `第 ${start + 1}–${Math.min(start + 10, pages.length)} 页`,
            text: slice,
          });
      }
    }
    return {
      title: usablePdfTitle(info?.Title) ?? fileName.replace(/\.[^.]+$/u, ""),
      author: usableAuthor(info?.Author),
      format: "pdf",
      chapters,
    };
  } finally {
    await document.destroy();
  }
}
