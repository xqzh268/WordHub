import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { listChapters, readChapter } from "../chapters/service.js";
import { type DocxOptions, buildDocx } from "./docx.js";
import {
  type ExportChapter,
  type TextEncoding,
  encodeText,
  toPlainText,
} from "./txt.js";

export type ExportFormat = "docx" | "txt-utf8" | "txt-gb18030";

export type ExportRequest = {
  /** 写作文件夹（含 chapters/） */
  folder: string;
  scope: "chapter" | "book";
  /** scope 为 chapter 时的章节路径，如 chapters/第一章.md */
  chapterPath?: string;
  format: ExportFormat;
  /** 输出文件的绝对路径（由主进程的保存对话框得到） */
  outPath: string;
  bookTitle?: string;
  docx?: Pick<DocxOptions, "fonts" | "bodySizePt" | "lineSpacing">;
};

export type ExportResult = { path: string; bytes: number; chapters: number };

const ENCODINGS: Record<string, TextEncoding> = {
  "txt-utf8": "utf-8",
  "txt-gb18030": "gb18030",
};

async function collect(request: ExportRequest): Promise<ExportChapter[]> {
  if (request.scope === "chapter") {
    if (!request.chapterPath) throw new Error("导出当前章需要指定章节");
    const file = await readChapter(request.folder, request.chapterPath);
    return [{ name: path.basename(file.path), markdown: file.content }];
  }
  const list = await listChapters(request.folder);
  const chapters: ExportChapter[] = [];
  for (const info of list) {
    const file = await readChapter(request.folder, info.path);
    chapters.push({ name: info.name, markdown: file.content });
  }
  if (!chapters.length) throw new Error("项目的 chapters/ 里还没有章节可导出");
  return chapters;
}

/** 构建并写出文件；先写临时文件再替换，失败不会留下半截输出。 */
export async function exportChapters(
  request: ExportRequest,
): Promise<ExportResult> {
  const chapters = await collect(request);
  const bookTitle =
    request.scope === "book"
      ? request.bookTitle?.trim() || undefined
      : undefined;
  const bytes =
    request.format === "docx"
      ? await buildDocx(chapters, { ...request.docx, bookTitle })
      : encodeText(
          toPlainText(chapters, { bookTitle }),
          ENCODINGS[request.format] ?? "utf-8",
        );
  await mkdir(path.dirname(request.outPath), { recursive: true });
  const temporary = `${request.outPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, request.outPath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return {
    path: request.outPath,
    bytes: bytes.length,
    chapters: chapters.length,
  };
}
