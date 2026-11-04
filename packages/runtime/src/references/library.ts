import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parseReferenceFile } from "./parse/index.js";
import {
  LIMITS,
  REFERENCE_SCHEMA_VERSION,
  type ReferenceAnchor,
  type ReferenceChapterInfo,
  type ReferenceHit,
  type ReferenceMeta,
  ReferenceLibraryError,
} from "./types.js";

const ROOT = [".wordhub", "references"] as const;
const ID_PATTERN = /^ref-[0-9a-f]{12}$/u;
const CHAPTER_PATTERN = /^\d{4}$/u;

const pad = (index: number): string => String(index).padStart(4, "0");

/** 参考库目录；路径链上有符号链接就拒绝，避免借链接读写项目外的文件。 */
export async function libraryRoot(
  folder: string,
  create = false,
): Promise<string> {
  const base = await realpath(folder);
  let current = base;
  for (const part of ROOT) {
    current = path.join(current, part);
    const info = await lstat(current).catch(() => undefined);
    if (info?.isSymbolicLink())
      throw new ReferenceLibraryError(
        "项目的 .wordhub/references 路径含符号链接，已拒绝",
      );
    if (!info && create) await mkdir(current);
  }
  return current;
}

export function assertId(id: string): void {
  if (!ID_PATTERN.test(id))
    throw new ReferenceLibraryError(`参考资料标识无效：${id}`);
}
export function assertChapter(chapterId: string): void {
  if (!CHAPTER_PATTERN.test(chapterId))
    throw new ReferenceLibraryError(`章节标识无效：${chapterId}`);
}

/** 同一把锁串行化同一项目里的元数据读改写（标签、收藏、批注等），避免并发互相覆盖。 */
const locks = new Map<string, Promise<unknown>>();
export async function exclusive<T>(
  folder: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = await realpath(folder);
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  locks.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

/** 读到的元数据补齐 v2 之前没有的字段，调用方不用再判断缺失。 */
export function normalizeMeta(meta: ReferenceMeta): ReferenceMeta {
  return {
    ...meta,
    kind: meta.kind ?? "other",
    tags: meta.tags ?? [],
    favorite: meta.favorite ?? false,
    status: meta.status ?? "unread",
    collectionIds: meta.collectionIds ?? [],
  };
}

/** 原子地改写 reference.json（临时文件 → 改名）。 */
export async function writeMeta(
  folder: string,
  meta: ReferenceMeta,
): Promise<void> {
  assertId(meta.id);
  const root = await libraryRoot(folder);
  const target = path.join(root, meta.id, "reference.json");
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(
      temporary,
      JSON.stringify(
        { ...meta, schemaVersion: REFERENCE_SCHEMA_VERSION },
        null,
        2,
      ),
      "utf8",
    );
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export type ImportResult = {
  meta: ReferenceMeta;
  duplicate: boolean;
  /** 不是同一个文件，但书名和作者都对得上的已有资料：可能是同一本书的另一个版本 */
  similar: ReferenceMeta[];
};

/** 用于判断“可能是同一本书”：书名与作者去掉空白、标点、大小写后相同。 */
export function similarityKey(
  meta: Pick<ReferenceMeta, "title" | "author">,
): string {
  const clean = (value: string | undefined) =>
    (value ?? "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  return `${clean(meta.title)}|${clean(meta.author)}`;
}

/** 导入一个文件：解析 → 写入 .wordhub/references/<id>/（原件副本、reference.json、按章文本）。 */
export async function importReference(
  folder: string,
  filePath: string,
): Promise<ImportResult> {
  const info = await stat(filePath).catch(() => undefined);
  if (!info?.isFile())
    throw new ReferenceLibraryError(`找不到文件：${filePath}`);
  if (info.size > LIMITS.fileBytes)
    throw new ReferenceLibraryError(
      `文件过大（${Math.round(info.size / 1024 / 1024)} MB），上限 ${LIMITS.fileBytes / 1024 / 1024} MB`,
    );
  const buffer = await readFile(filePath);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const id = `ref-${sha256.slice(0, 12)}`;
  const root = await libraryRoot(folder, true);
  const target = path.join(root, id);
  const existing = await readMeta(target).catch(() => undefined);
  if (existing)
    return { meta: normalizeMeta(existing), duplicate: true, similar: [] };

  const originalName = path.basename(filePath);
  const parsed = await parseReferenceFile(buffer, originalName);
  const chapters = parsed.chapters.filter((chapter) => chapter.text.trim());
  if (!chapters.length)
    throw new ReferenceLibraryError("没有解析出任何正文，无法导入");
  if (chapters.length > LIMITS.chapters)
    throw new ReferenceLibraryError(
      `章节数过多（${chapters.length}），上限 ${LIMITS.chapters}`,
    );
  const totalChars = chapters.reduce(
    (sum, chapter) => sum + chapter.text.length,
    0,
  );
  if (totalChars > LIMITS.totalChars)
    throw new ReferenceLibraryError(
      `正文过长（${totalChars} 字），上限 ${LIMITS.totalChars} 字`,
    );

  const infos: ReferenceChapterInfo[] = chapters.map((chapter, index) => ({
    id: pad(index + 1),
    index: index + 1,
    title: chapter.title.trim().slice(0, 120) || `第 ${index + 1} 部分`,
    chars: chapter.text.length,
  }));
  const meta: ReferenceMeta = {
    schemaVersion: REFERENCE_SCHEMA_VERSION,
    id,
    title: parsed.title.trim().slice(0, 200) || originalName,
    author: parsed.author?.slice(0, 120),
    format: parsed.format,
    originalName,
    sha256,
    importedAt: new Date().toISOString(),
    totalChars,
    chapters: infos,
    kind: "other",
    tags: [],
    favorite: false,
    status: "unread",
    collectionIds: [],
    ...(parsed.cover && parsed.cover.data.length <= 5 * 1024 * 1024
      ? {
          cover: {
            file: `cover.${coverExtension(parsed.cover.mime)}`,
            mime: parsed.cover.mime,
          },
        }
      : {}),
  };

  // 先写到临时目录再改名：中途失败不会留下半本书
  const temporary = path.join(root, `${id}.tmp-${process.pid}`);
  await rm(temporary, { recursive: true, force: true });
  try {
    await mkdir(path.join(temporary, "text"), { recursive: true });
    await writeFile(
      path.join(temporary, `source${path.extname(originalName).toLowerCase()}`),
      buffer,
    );
    for (const [index, chapter] of chapters.entries())
      await writeFile(
        path.join(temporary, "text", `${pad(index + 1)}.txt`),
        chapter.text,
        "utf8",
      );
    if (parsed.cover && meta.cover)
      await writeFile(path.join(temporary, meta.cover.file), parsed.cover.data);
    await writeFile(
      path.join(temporary, "reference.json"),
      JSON.stringify(meta, null, 2),
      "utf8",
    );
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
  const key = similarityKey(meta);
  const similar = (await listReferences(folder)).filter(
    (other) => other.id !== meta.id && similarityKey(other) === key,
  );
  return { meta: normalizeMeta(meta), duplicate: false, similar };
}

const COVER_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};
/** 只认几种常见位图；SVG 等可带脚本的格式不接收。 */
export const coverExtension = (mime: string): string =>
  COVER_EXTENSIONS[mime.toLowerCase()] ?? "bin";

export async function readMeta(
  directory: string,
): Promise<ReferenceMeta | undefined> {
  const text = await readFile(
    path.join(directory, "reference.json"),
    "utf8",
  ).catch(() => undefined);
  if (!text) return undefined;
  const meta = JSON.parse(text) as ReferenceMeta;
  // 没有 schemaVersion 的是最早的版本，按 1 处理；比当前新的版本照读（只读不改），不丢数据
  meta.schemaVersion ??= 1;
  return ID_PATTERN.test(meta.id) && Array.isArray(meta.chapters)
    ? meta
    : undefined;
}

export async function listReferences(folder: string): Promise<ReferenceMeta[]> {
  let root: string;
  try {
    root = await libraryRoot(folder);
  } catch (error) {
    if (error instanceof ReferenceLibraryError) throw error;
    return [];
  }
  const names = await readdir(root).catch(() => [] as string[]);
  const metas: ReferenceMeta[] = [];
  for (const name of names) {
    if (!ID_PATTERN.test(name)) continue;
    const meta = await readMeta(path.join(root, name)).catch(() => undefined);
    if (meta) metas.push(normalizeMeta(meta));
  }
  return metas.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

export async function getReference(
  folder: string,
  id: string,
): Promise<ReferenceMeta> {
  assertId(id);
  const root = await libraryRoot(folder);
  const meta = await readMeta(path.join(root, id)).catch(() => undefined);
  if (!meta) throw new ReferenceLibraryError(`参考库里没有这份资料：${id}`);
  return normalizeMeta(meta);
}

export type ChapterText = {
  referenceId: string;
  referenceTitle: string;
  chapterId: string;
  chapterTitle: string;
  /** 整章字数 */
  totalChars: number;
  start: number;
  end: number;
  text: string;
};

async function chapterFile(
  folder: string,
  id: string,
  chapterId: string,
): Promise<{ meta: ReferenceMeta; info: ReferenceChapterInfo; text: string }> {
  assertChapter(chapterId);
  const meta = await getReference(folder, id);
  const info = meta.chapters.find((chapter) => chapter.id === chapterId);
  if (!info)
    throw new ReferenceLibraryError(`《${meta.title}》没有章节 ${chapterId}`);
  const root = await libraryRoot(folder);
  const text = await readFile(
    path.join(root, id, "text", `${chapterId}.txt`),
    "utf8",
  );
  return { meta, info, text };
}

/** 读一章（或其中一段）。单次最多返回 LIMITS.readChars 字，超出的部分用 start 续读。 */
export async function readReferenceChapter(
  folder: string,
  id: string,
  chapterId: string,
  range: { start?: number; end?: number } = {},
  options: { maxChars?: number } = {},
): Promise<ChapterText> {
  const { meta, info, text } = await chapterFile(folder, id, chapterId);
  const start = Math.max(0, Math.min(range.start ?? 0, text.length));
  const requestedEnd = Math.max(
    start,
    Math.min(range.end ?? text.length, text.length),
  );
  const end = Math.min(
    requestedEnd,
    start + (options.maxChars ?? LIMITS.readChars),
  );
  return {
    referenceId: id,
    referenceTitle: meta.title,
    chapterId,
    chapterTitle: info.title,
    totalChars: text.length,
    start,
    end,
    text: text.slice(start, end),
  };
}

/** 全文检索：逐章子串匹配（不区分大小写），返回出处与前后各约 40 字的片段。 */
export async function searchReferences(
  folder: string,
  query: string,
  options: { referenceId?: string; limit?: number } = {},
): Promise<ReferenceHit[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) throw new ReferenceLibraryError("检索词不能为空");
  if (needle.length > 100)
    throw new ReferenceLibraryError("检索词过长（上限 100 字）");
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
  const metas = options.referenceId
    ? [await getReference(folder, options.referenceId)]
    : await listReferences(folder);
  const root = await libraryRoot(folder);
  const hits: ReferenceHit[] = [];
  for (const meta of metas)
    for (const chapter of meta.chapters) {
      const text = await readFile(
        path.join(root, meta.id, "text", `${chapter.id}.txt`),
        "utf8",
      ).catch(() => "");
      const lower = text.toLowerCase();
      let from = 0;
      for (;;) {
        const offset = lower.indexOf(needle, from);
        if (offset < 0) break;
        hits.push({
          referenceId: meta.id,
          referenceTitle: meta.title,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          offset,
          snippet: text
            .slice(Math.max(0, offset - 40), offset + needle.length + 40)
            .replace(/\s+/gu, " "),
        });
        if (hits.length >= limit) return hits;
        from = offset + needle.length;
      }
    }
  return hits;
}

export async function deleteReference(
  folder: string,
  id: string,
): Promise<void> {
  assertId(id);
  const root = await libraryRoot(folder);
  await getReference(folder, id);
  await rm(path.join(root, id), { recursive: true, force: true });
}

/** 校验锚点：引文必须与该章该区间的原文逐字一致。 */
export async function verifyAnchor(
  folder: string,
  anchor: ReferenceAnchor,
): Promise<boolean> {
  try {
    const { text } = await chapterFile(
      folder,
      anchor.referenceId,
      anchor.chapterId,
    );
    return text.slice(anchor.start, anchor.end) === anchor.quote;
  } catch {
    return false;
  }
}

/** 取锚点对应的原文（并校验区间合法）。 */
export async function quoteFromRange(
  folder: string,
  referenceId: string,
  chapterId: string,
  start: number,
  end: number,
): Promise<ReferenceAnchor & { referenceTitle: string; chapterTitle: string }> {
  const { meta, info, text } = await chapterFile(
    folder,
    referenceId,
    chapterId,
  );
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > text.length
  )
    throw new ReferenceLibraryError("选段范围无效");
  return {
    referenceId,
    chapterId,
    start,
    end,
    quote: text.slice(start, end),
    referenceTitle: meta.title,
    chapterTitle: info.title,
  };
}
