export type ReferenceFormat = "txt" | "md" | "epub" | "docx" | "pdf";

export type ParsedChapter = { title: string; text: string };

export type ParsedReference = {
  title: string;
  author?: string;
  format: ReferenceFormat;
  chapters: ParsedChapter[];
};

export type ReferenceChapterInfo = {
  /** 四位序号，如 0003，也是 text/ 下的文件名 */
  id: string;
  index: number;
  title: string;
  chars: number;
};

/** reference.json 的版本。以后加标签、批注、文献元数据等字段只增不改，读取端按版本容忍缺失字段。 */
export const REFERENCE_SCHEMA_VERSION = 1;

export type ReferenceMeta = {
  schemaVersion: number;
  /** ref- 加原件 sha256 前 12 位：同一本书重复导入得到同一个 id */
  id: string;
  title: string;
  author?: string;
  format: ReferenceFormat;
  originalName: string;
  sha256: string;
  importedAt: string;
  totalChars: number;
  chapters: ReferenceChapterInfo[];
};

/** 选段锚点。用时必须校验 quote 与原文一致，对不上就明说。 */
export type ReferenceAnchor = {
  referenceId: string;
  chapterId: string;
  start: number;
  end: number;
  quote: string;
};

export type ReferenceHit = {
  referenceId: string;
  referenceTitle: string;
  chapterId: string;
  chapterTitle: string;
  offset: number;
  snippet: string;
};

/** 导入失败的原因，信息直接给用户看。 */
export class ReferenceLibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceLibraryError";
  }
}

export const LIMITS = {
  /** 原件大小上限 */
  fileBytes: 200 * 1024 * 1024,
  /** 解析出的总字数上限 */
  totalChars: 30_000_000,
  chapters: 5000,
  /** 压缩包（EPUB/DOCX）条目数与解压总量上限，防 zip 炸弹 */
  zipEntries: 20_000,
  zipUncompressedBytes: 500 * 1024 * 1024,
  pdfPages: 3000,
  /** 单次读取返回的字数上限 */
  readChars: 20_000,
} as const;
