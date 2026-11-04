import { randomBytes } from "node:crypto";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertId,
  exclusive,
  getReference,
  libraryRoot,
  listReferences,
  quoteFromRange,
  readMeta,
  similarityKey,
  writeMeta,
} from "./library.js";
import {
  type Annotation,
  type Collection,
  READING_STATUSES,
  REFERENCE_KINDS,
  type ReadingStatus,
  type ReferenceKind,
  type ReferenceMeta,
  ReferenceLibraryError,
} from "./types.js";

const fail = (message: string): never => {
  throw new ReferenceLibraryError(message);
};

const hasControl = (value: string): boolean =>
  Array.from(value).some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 32 && code !== 10 && code !== 13 && code !== 9;
  });

// ── 元数据与个人状态 ─────────────────────────────────────────

export type MetaPatch = {
  title?: string;
  author?: string | null;
  kind?: ReferenceKind;
  year?: number | null;
  publisher?: string | null;
  doi?: string | null;
  isbn?: string | null;
  note?: string | null;
  tags?: string[];
  favorite?: boolean;
  status?: ReadingStatus;
  collectionIds?: string[];
};

const DOI = /^10\.\d{4,9}\/\S+$/u;
const ISBN = /^(?:\d[\d-]{8,15}[\dXx])$/u;

/** 标签规整：去首尾空白、去重、不含控制字符、每个 ≤ 30 字、最多 20 个。 */
export function cleanTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.replace(/\s+/gu, " ").trim();
    if (!tag) continue;
    if (tag.length > 30) fail(`标签太长（上限 30 字）：${tag.slice(0, 12)}…`);
    if (hasControl(tag) || /[,，;；]/u.test(tag))
      fail(`标签里不能有逗号、分号或控制字符：${tag}`);
    if (!out.some((item) => item.toLowerCase() === tag.toLowerCase()))
      out.push(tag);
  }
  if (out.length > 20) fail("每本书最多 20 个标签");
  return out;
}

const optionalText = (
  value: string | null | undefined,
  label: string,
  max: number,
): string | undefined | null => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) fail(`${label}太长（上限 ${max} 字）`);
  if (hasControl(text)) fail(`${label}含有不允许的控制字符`);
  return text;
};

/** 改元数据与个人状态；返回改完的完整元数据。null 表示清除该字段。 */
export async function updateReference(
  folder: string,
  id: string,
  patch: MetaPatch,
): Promise<ReferenceMeta> {
  assertId(id);
  return exclusive(folder, async () => {
    const root = await libraryRoot(folder);
    const current = await readMeta(path.join(root, id));
    if (!current) return fail(`参考库里没有这份资料：${id}`);
    const next: ReferenceMeta = { ...current };

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title || title.length > 200) fail("书名需要 1–200 个字");
      if (hasControl(title)) fail("书名含有不允许的控制字符");
      next.title = title;
    }
    const assign = <K extends "author" | "publisher" | "doi" | "isbn" | "note">(
      key: K,
      value: string | null | undefined,
      label: string,
      max: number,
      validate?: (text: string) => void,
    ) => {
      const cleaned = optionalText(value, label, max);
      if (cleaned === undefined) return;
      if (cleaned === null) delete next[key];
      else {
        validate?.(cleaned);
        next[key] = cleaned;
      }
    };
    assign("author", patch.author, "作者", 120);
    assign("publisher", patch.publisher, "出版方", 120);
    assign("doi", patch.doi, "DOI", 200, (text) => {
      if (!DOI.test(text)) fail("DOI 格式应为 10.xxxx/xxxx");
    });
    assign("isbn", patch.isbn, "ISBN", 20, (text) => {
      if (!ISBN.test(text))
        fail("ISBN 应为 10 或 13 位数字（可含连字符，末位可为 X）");
    });
    assign("note", patch.note, "备注", 5000);
    if (patch.kind !== undefined) {
      if (!(REFERENCE_KINDS as readonly string[]).includes(patch.kind))
        fail(`不支持的资料类型：${patch.kind}`);
      next.kind = patch.kind;
    }
    if (patch.year !== undefined) {
      if (patch.year === null) delete next.year;
      else if (
        !Number.isInteger(patch.year) ||
        patch.year < 1000 ||
        patch.year > 2200
      )
        fail("年份需要是 1000–2200 之间的整数");
      else next.year = patch.year;
    }
    if (patch.tags !== undefined) next.tags = cleanTags(patch.tags);
    if (patch.favorite !== undefined) next.favorite = Boolean(patch.favorite);
    if (patch.status !== undefined) {
      if (!(READING_STATUSES as readonly string[]).includes(patch.status))
        fail(`不支持的阅读状态：${patch.status}`);
      next.status = patch.status;
    }
    if (patch.collectionIds !== undefined) {
      const known = new Set(
        (await readLibraryFile(folder)).collections.map((c) => c.id),
      );
      const unknown = patch.collectionIds.filter((cid) => !known.has(cid));
      if (unknown.length) fail(`集合不存在：${unknown.join("、")}`);
      next.collectionIds = [...new Set(patch.collectionIds)];
    }
    await writeMeta(folder, next);
    return getReference(folder, id);
  });
}

/** 打开某一章：记下读到哪里与最近阅读时间；未读的自动变成在读。 */
export async function recordOpened(
  folder: string,
  id: string,
  chapterId: string,
): Promise<void> {
  assertId(id);
  await exclusive(folder, async () => {
    const root = await libraryRoot(folder);
    const current = await readMeta(path.join(root, id));
    if (!current) return;
    if (!current.chapters.some((chapter) => chapter.id === chapterId)) return;
    await writeMeta(folder, {
      ...current,
      lastOpenedAt: new Date().toISOString(),
      progress: { chapterId },
      status:
        (current.status ?? "unread") === "unread" ? "reading" : current.status,
    });
  });
}

/** 书名与作者对得上的资料分组（每组 ≥ 2 本）：可能是同一本书的不同版本。 */
export async function findSimilarGroups(
  folder: string,
): Promise<ReferenceMeta[][]> {
  const groups = new Map<string, ReferenceMeta[]>();
  for (const meta of await listReferences(folder)) {
    const key = similarityKey(meta);
    if (key === "|") continue;
    groups.set(key, [...(groups.get(key) ?? []), meta]);
  }
  return [...groups.values()].filter((group) => group.length >= 2);
}

// ── 集合 ────────────────────────────────────────────────────

type LibraryFile = { schemaVersion: number; collections: Collection[] };
const LIBRARY_FILE = "library.json";

async function readLibraryFile(folder: string): Promise<LibraryFile> {
  const root = await libraryRoot(folder);
  const text = await readFile(path.join(root, LIBRARY_FILE), "utf8").catch(
    () => undefined,
  );
  if (!text) return { schemaVersion: 1, collections: [] };
  try {
    const data = JSON.parse(text) as Partial<LibraryFile>;
    return {
      schemaVersion: data.schemaVersion ?? 1,
      collections: Array.isArray(data.collections) ? data.collections : [],
    };
  } catch {
    return { schemaVersion: 1, collections: [] };
  }
}

async function writeLibraryFile(
  folder: string,
  data: LibraryFile,
): Promise<void> {
  const root = await libraryRoot(folder, true);
  const target = path.join(root, LIBRARY_FILE);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

const collectionName = (name: string): string => {
  const value = name.replace(/\s+/gu, " ").trim();
  if (!value || value.length > 40) fail("集合名需要 1–40 个字");
  if (hasControl(value)) fail("集合名含有不允许的控制字符");
  return value;
};

export async function listCollections(folder: string): Promise<Collection[]> {
  return (await readLibraryFile(folder)).collections;
}

export async function createCollection(
  folder: string,
  name: string,
): Promise<Collection> {
  return exclusive(folder, async () => {
    const data = await readLibraryFile(folder);
    const clean = collectionName(name);
    if (
      data.collections.some((c) => c.name.toLowerCase() === clean.toLowerCase())
    )
      fail(`已经有叫“${clean}”的集合`);
    if (data.collections.length >= 100) fail("集合最多 100 个");
    const collection: Collection = {
      id: `col-${randomBytes(4).toString("hex")}`,
      name: clean,
      createdAt: new Date().toISOString(),
    };
    await writeLibraryFile(folder, {
      ...data,
      collections: [...data.collections, collection],
    });
    return collection;
  });
}

export async function renameCollection(
  folder: string,
  id: string,
  name: string,
): Promise<Collection> {
  return exclusive(folder, async () => {
    const data = await readLibraryFile(folder);
    const target = data.collections.find((c) => c.id === id);
    if (!target) return fail("集合不存在");
    const clean = collectionName(name);
    if (
      data.collections.some(
        (c) => c.id !== id && c.name.toLowerCase() === clean.toLowerCase(),
      )
    )
      fail(`已经有叫“${clean}”的集合`);
    const renamed = { ...target, name: clean };
    await writeLibraryFile(folder, {
      ...data,
      collections: data.collections.map((c) => (c.id === id ? renamed : c)),
    });
    return renamed;
  });
}

/** 删集合：书不会被删，只是从这个集合里移出。 */
export async function deleteCollection(
  folder: string,
  id: string,
): Promise<void> {
  await exclusive(folder, async () => {
    const data = await readLibraryFile(folder);
    if (!data.collections.some((c) => c.id === id)) fail("集合不存在");
    for (const meta of await listReferences(folder))
      if (meta.collectionIds?.includes(id)) {
        const root = await libraryRoot(folder);
        const raw = await readMeta(path.join(root, meta.id));
        if (raw)
          await writeMeta(folder, {
            ...raw,
            collectionIds: (raw.collectionIds ?? []).filter(
              (cid) => cid !== id,
            ),
          });
      }
    await writeLibraryFile(folder, {
      ...data,
      collections: data.collections.filter((c) => c.id !== id),
    });
  });
}

// ── 批注与高亮 ──────────────────────────────────────────────

type AnnotationFile = { schemaVersion: number; items: Annotation[] };
const ANNOTATION_COLORS = ["yellow", "green", "blue", "pink"] as const;

async function annotationPath(folder: string, id: string): Promise<string> {
  assertId(id);
  await getReference(folder, id);
  return path.join(await libraryRoot(folder), id, "annotations.json");
}

async function readAnnotations(file: string): Promise<AnnotationFile> {
  const text = await readFile(file, "utf8").catch(() => undefined);
  if (!text) return { schemaVersion: 1, items: [] };
  try {
    const data = JSON.parse(text) as Partial<AnnotationFile>;
    return {
      schemaVersion: data.schemaVersion ?? 1,
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch {
    return { schemaVersion: 1, items: [] };
  }
}

async function writeAnnotations(
  file: string,
  data: AnnotationFile,
): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

const noteText = (note: string | undefined | null): string | undefined => {
  if (note === undefined || note === null) return undefined;
  const text = note.trim();
  if (text.length > 2000) fail("批注太长（上限 2000 字）");
  if (hasControl(text)) fail("批注含有不允许的控制字符");
  return text || undefined;
};

export async function listAnnotations(
  folder: string,
  id: string,
): Promise<Annotation[]> {
  const data = await readAnnotations(await annotationPath(folder, id));
  return [...data.items].sort(
    (a, b) => a.chapterId.localeCompare(b.chapterId) || a.start - b.start,
  );
}

export async function addAnnotation(
  folder: string,
  input: {
    referenceId: string;
    chapterId: string;
    start: number;
    end: number;
    color?: Annotation["color"];
    note?: string;
  },
): Promise<Annotation> {
  return exclusive(folder, async () => {
    const color = input.color ?? "yellow";
    if (!(ANNOTATION_COLORS as readonly string[]).includes(color))
      fail(`不支持的高亮颜色：${color}`);
    // 引文由服务端按区间从原文切出来，不信任调用方传来的文字
    const anchor = await quoteFromRange(
      folder,
      input.referenceId,
      input.chapterId,
      input.start,
      input.end,
    );
    if (anchor.quote.length > 5000) fail("一次高亮最多 5000 字");
    const file = await annotationPath(folder, input.referenceId);
    const data = await readAnnotations(file);
    if (data.items.length >= 2000) fail("每本书最多 2000 条批注");
    const now = new Date().toISOString();
    const annotation: Annotation = {
      id: `ann-${randomBytes(4).toString("hex")}`,
      chapterId: input.chapterId,
      start: input.start,
      end: input.end,
      quote: anchor.quote,
      color,
      ...(noteText(input.note) ? { note: noteText(input.note) } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await writeAnnotations(file, {
      ...data,
      items: [...data.items, annotation],
    });
    return annotation;
  });
}

export async function updateAnnotation(
  folder: string,
  referenceId: string,
  annotationId: string,
  patch: { note?: string | null; color?: Annotation["color"] },
): Promise<Annotation> {
  return exclusive(folder, async () => {
    const file = await annotationPath(folder, referenceId);
    const data = await readAnnotations(file);
    const current = data.items.find((item) => item.id === annotationId);
    if (!current) return fail("这条批注不存在");
    if (
      patch.color !== undefined &&
      !(ANNOTATION_COLORS as readonly string[]).includes(patch.color)
    )
      fail(`不支持的高亮颜色：${patch.color}`);
    const note = patch.note === undefined ? current.note : noteText(patch.note);
    const next: Annotation = {
      ...current,
      color: patch.color ?? current.color,
      updatedAt: new Date().toISOString(),
    };
    if (note) next.note = note;
    else delete next.note;
    await writeAnnotations(file, {
      ...data,
      items: data.items.map((item) => (item.id === annotationId ? next : item)),
    });
    return next;
  });
}

export async function deleteAnnotation(
  folder: string,
  referenceId: string,
  annotationId: string,
): Promise<void> {
  await exclusive(folder, async () => {
    const file = await annotationPath(folder, referenceId);
    const data = await readAnnotations(file);
    if (!data.items.some((item) => item.id === annotationId))
      fail("这条批注不存在");
    await writeAnnotations(file, {
      ...data,
      items: data.items.filter((item) => item.id !== annotationId),
    });
  });
}

/** 列出库里的封面文件路径（用于主进程读取），不存在返回 undefined。 */
export async function coverFile(
  folder: string,
  id: string,
): Promise<{ path: string; mime: string } | undefined> {
  const meta = await getReference(folder, id);
  if (!meta.cover) return undefined;
  const root = await libraryRoot(folder);
  const name = path.basename(meta.cover.file);
  const entries = await readdir(path.join(root, id)).catch(
    () => [] as string[],
  );
  return entries.includes(name)
    ? { path: path.join(root, id, name), mime: meta.cover.mime }
    : undefined;
}
