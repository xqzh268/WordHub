export type ReferenceFormat = "txt" | "md" | "epub" | "docx" | "pdf";

export type ParsedChapter = { title: string; text: string };

export type ParsedReference = {
  title: string;
  author?: string;
  format: ReferenceFormat;
  chapters: ParsedChapter[];
  /** 书里自带的封面（目前只有 EPUB） */
  cover?: { mime: string; data: Buffer };
};

export type ReferenceChapterInfo = {
  /** 四位序号，如 0003，也是 text/ 下的文件名 */
  id: string;
  index: number;
  title: string;
  chars: number;
};

/** reference.json 的版本。以后加标签、批注、文献元数据等字段只增不改，读取端按版本容忍缺失字段。 */
export const REFERENCE_SCHEMA_VERSION = 2;

export const REFERENCE_KINDS = [
  "novel",
  "paper",
  "report",
  "material",
  "other",
] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
export const READING_STATUSES = ["unread", "reading", "finished"] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

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
  /** v2 起：下面这些是可编辑的文献元数据与个人状态，旧版本没有，读取时补默认值（见 normalizeMeta） */
  kind?: ReferenceKind;
  year?: number;
  publisher?: string;
  doi?: string;
  isbn?: string;
  note?: string;
  tags?: string[];
  favorite?: boolean;
  status?: ReadingStatus;
  /** 所属集合（一本书可在多个集合里），集合本身存在 library.json */
  collectionIds?: string[];
  lastOpenedAt?: string;
  /** 读到哪一章 */
  progress?: { chapterId: string };
  cover?: { file: string; mime: string };
};

export type Collection = { id: string; name: string; createdAt: string };

export type Annotation = {
  id: string;
  chapterId: string;
  start: number;
  end: number;
  /** 高亮时的原文；用时与原文校验，章节被改动后对不上就标为失效 */
  quote: string;
  color: "yellow" | "green" | "blue" | "pink";
  note?: string;
  createdAt: string;
  updatedAt: string;
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
