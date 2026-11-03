import {
  type ParsedReference,
  type ReferenceFormat,
  ReferenceLibraryError,
} from "../types.js";
import { parseDocx } from "./docx.js";
import { parseEpub } from "./epub.js";
import { parsePdf } from "./pdf.js";
import { parseText } from "./txt.js";

const EXTENSIONS: Record<string, ReferenceFormat> = {
  ".txt": "txt",
  ".md": "md",
  ".markdown": "md",
  ".epub": "epub",
  ".docx": "docx",
  ".pdf": "pdf",
};

export const SUPPORTED_EXTENSIONS = Object.keys(EXTENSIONS).map((ext) =>
  ext.slice(1),
);

export function detectFormat(fileName: string): ReferenceFormat {
  const ext = /\.[^.\\/]+$/u.exec(fileName.toLowerCase())?.[0] ?? "";
  const format = EXTENSIONS[ext];
  if (!format) {
    const hint =
      ext === ".mobi" || ext === ".azw3"
        ? "（MOBI/AZW3 暂不支持，可先用 Calibre 转成 EPUB）"
        : ext === ".doc"
          ? "（旧版 .doc 暂不支持，请另存为 .docx）"
          : "";
    throw new ReferenceLibraryError(
      `不支持的文件类型 ${ext || "（无扩展名）"}${hint}。支持：${SUPPORTED_EXTENSIONS.join("、")}`,
    );
  }
  return format;
}

export async function parseReferenceFile(
  buffer: Buffer,
  fileName: string,
): Promise<ParsedReference> {
  const format = detectFormat(fileName);
  // 扩展名与内容对不上时给出明确提示，而不是解析出乱码
  if (
    (format === "epub" || format === "docx") &&
    buffer.subarray(0, 2).toString("latin1") !== "PK"
  )
    throw new ReferenceLibraryError(
      `${fileName} 的内容不是 ${format.toUpperCase()} 文件（文件头不对），请确认文件没有损坏或改错了扩展名`,
    );
  if (format === "pdf" && buffer.subarray(0, 5).toString("latin1") !== "%PDF-")
    throw new ReferenceLibraryError(
      `${fileName} 的内容不是 PDF 文件（文件头不对）`,
    );
  switch (format) {
    case "txt":
    case "md":
      return parseText(buffer, fileName, format);
    case "epub":
      return parseEpub(buffer, fileName);
    case "docx":
      return parseDocx(buffer, fileName);
    case "pdf":
      return parsePdf(buffer, fileName);
  }
}
