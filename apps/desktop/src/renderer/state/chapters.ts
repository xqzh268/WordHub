import {
  type ChapterInfo,
  chapterNumberFromName,
  parseChapterNumber,
} from "@wordhub/contracts";
import type { PaperParagraph } from "./types";

// 纸面与项目章节文件的对接逻辑：全部是不依赖 window 的纯函数，便于单测。

export type PaperDoc = {
  no: string;
  page: number;
  title: string;
  paragraphs: PaperParagraph[];
  /** 来自磁盘时才有：相对路径与读取时的修改时间，用于判断是否需要重读 */
  path?: string;
  mtimeMs?: number;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** 把章节 Markdown 整理成纸面：首个 `#` 标题作章名，其余按空行分段。 */
export function paperFromText(
  filePath: string,
  text: string,
  meta: { mtimeMs?: number } = {},
): PaperDoc {
  const name = filePath.split(/[\\/]/u).at(-1) ?? filePath;
  const stem = name.replace(/\.(?:md|markdown|txt)$/iu, "") || "当前章节";
  const number = chapterNumberFromName(name);
  const chapterToken = stem.match(
    /第\s*([零〇一二两三四五六七八九十百千\d]+)\s*[章回]/u,
  );
  const no = chapterToken
    ? `第${chapterToken[1]}章`
    : number !== undefined
      ? `第${number}章`
      : "当前章节";

  const blocks = text
    .split(/\r?\n\s*\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  let title = stem;
  const heading = blocks[0]?.match(/^#{1,6}\s+(.+)$/u);
  if (heading?.[1] && !blocks[0]?.includes("\n")) {
    blocks.shift();
    // 标题里重复的“第N章”去掉，只留章名：`第四章 残月` → `残月`
    const rest = heading[1]
      .trim()
      .replace(new RegExp(`^${escapeRegExp(no)}\\s*[·:：—\\-]?\\s*`, "u"), "")
      .trim();
    title = rest || no;
  } else if (chapterToken) {
    title = no;
  }
  return {
    no,
    page: 1,
    title,
    paragraphs: blocks.map((value, index) => ({
      id: `paper-${index}`,
      text: value.replace(/^#{1,6}\s+/u, ""),
    })),
    path: filePath.replaceAll("\\", "/"),
    mtimeMs: meta.mtimeMs,
  };
}

/**
 * 选择应当显示的章节：显式指定（且存在）> 当前正在看的（且仍存在）> 最近修改的。
 * 空列表返回 null。
 */
export function pickActiveChapter(
  chapters: readonly ChapterInfo[],
  preferred?: string | null,
  current?: string | null,
): string | null {
  if (chapters.length === 0) return null;
  for (const wanted of [preferred, current])
    if (wanted && chapters.some((chapter) => chapter.path === wanted))
      return wanted;
  return [...chapters].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path ?? null;
}

/** 磁盘上的修改时间与已加载版本不同（或还没加载过）就需要重读。 */
export function needsReload(
  info: ChapterInfo | undefined,
  loaded: Pick<PaperDoc, "path" | "mtimeMs"> | null | undefined,
): boolean {
  if (!info) return false;
  if (!loaded || loaded.path !== info.path) return true;
  if (loaded.mtimeMs === undefined) return true;
  return Math.round(loaded.mtimeMs) !== Math.round(info.mtimeMs);
}

/** 上一章 / 下一章；越界返回 undefined。 */
export function neighborChapter(
  chapters: readonly ChapterInfo[],
  current: string | null,
  delta: -1 | 1,
): string | undefined {
  const index = chapters.findIndex((chapter) => chapter.path === current);
  if (index < 0) return undefined;
  return chapters[index + delta]?.path;
}

/** 用户消息里提到“第三章”，并且项目里有这一章，就返回对应路径。 */
export function chapterFromPrompt(
  prompt: string,
  chapters: readonly ChapterInfo[],
): string | undefined {
  const match = prompt.match(
    /第\s*([零〇一二两三四五六七八九十百千\d]+)\s*[章回]/u,
  );
  if (!match?.[1]) return undefined;
  const wanted = parseChapterNumber(match[1]);
  if (wanted === undefined) return undefined;
  return chapters.find((chapter) => chapter.number === wanted)?.path;
}

/** 纸面右上角的更新时间：今天显示 `HH:mm`，更早显示 `M月D日`。 */
export function formatUpdated(
  mtimeMs: number,
  now: number = Date.now(),
): string {
  const date = new Date(mtimeMs);
  const today = new Date(now);
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${hh}:${mm} 更新`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日更新`;
}
