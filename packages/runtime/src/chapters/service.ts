import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  type ChapterContent,
  type ChapterInfo,
  chapterNumberFromName,
  compareChapters,
} from "@wordhub/contracts";
import { contentHash, safeProjectTarget } from "@wordhub/store";

export type { ChapterContent, ChapterInfo };
export {
  chapterNumberFromName,
  compareChapters,
  parseChapterNumber,
} from "@wordhub/contracts";

const CHAPTER_DIR = "chapters";
const EXTENSIONS = /\.(?:md|markdown|txt)$/iu;
const MAX_BYTES = 5 * 1024 * 1024;

/** 隐藏文件、临时文件（原子写盘留下的 .xxx.tmp）不算章节。 */
function isChapterFile(name: string): boolean {
  return (
    EXTENSIONS.test(name) && !name.startsWith(".") && !name.endsWith(".tmp")
  );
}

export async function listChapters(folder: string): Promise<ChapterInfo[]> {
  let directory: string;
  try {
    directory = await safeProjectTarget(folder, CHAPTER_DIR);
  } catch {
    return [];
  }
  const names = await readdir(directory).catch(() => [] as string[]);
  const chapters: ChapterInfo[] = [];
  for (const name of names) {
    if (!isChapterFile(name)) continue;
    const info = await lstat(path.join(directory, name)).catch(() => undefined);
    if (!info?.isFile()) continue; // 跳过目录与符号链接
    chapters.push({
      path: `${CHAPTER_DIR}/${name}`,
      name,
      number: chapterNumberFromName(name),
      size: info.size,
      mtimeMs: info.mtimeMs,
    });
  }
  return chapters.sort(compareChapters);
}

/** 只允许读 chapters/ 下的章节文件；路径穿越、符号链接、超大文件都会被拒绝。 */
export async function readChapter(
  folder: string,
  relativePath: string,
): Promise<ChapterContent> {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    !normalized.startsWith(`${CHAPTER_DIR}/`) ||
    !isChapterFile(path.posix.basename(normalized))
  )
    throw new Error("只能读取 chapters/ 下的章节文件");
  const target = await safeProjectTarget(folder, normalized);
  const info = await lstat(target);
  if (!info.isFile()) throw new Error("章节不是普通文件");
  if (info.size > MAX_BYTES) throw new Error("章节文件过大，暂不支持显示");
  const data = await readFile(target);
  return {
    path: normalized,
    content: data.toString("utf8"),
    contentHash: contentHash(data),
    mtimeMs: info.mtimeMs,
  };
}

const signature = (chapters: readonly ChapterInfo[]): string =>
  chapters.map((c) => `${c.path}:${c.size}:${Math.round(c.mtimeMs)}`).join("|");

/**
 * 轮询式章节监听：用户可能在 Word、记事本、VS Code 里改稿，这些编辑器常用“写临时文件再替换”，
 * fs.watch 在 Windows 上对这类保存并不可靠，而章节目录文件很少，轮询成本可以忽略。
 * 返回停止函数；第一次轮询只建立基线，不触发回调。
 */
export function watchChapters(
  folder: string,
  onChange: (chapters: ChapterInfo[]) => void,
  intervalMs = 800,
): () => void {
  let stopped = false;
  let last: string | undefined;
  let busy = false;
  const poll = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const chapters = await listChapters(folder);
      const next = signature(chapters);
      if (last !== undefined && next !== last && !stopped) onChange(chapters);
      last = next;
    } catch {
      // 目录暂时不可读（正在被替换）时忽略这一轮，下一轮再试。
    } finally {
      busy = false;
    }
  };
  void poll();
  const timer = setInterval(() => void poll(), intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
