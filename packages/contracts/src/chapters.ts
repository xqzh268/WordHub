import type { ChapterInfo } from "./ipc.js";

// 章号解析与排序：纯函数、不依赖 Node，渲染进程与运行时共用。
const EXTENSIONS = /\.(?:md|markdown|txt)$/iu;

const DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
const CHINESE_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 把有限范围内的章号格式化成产品使用的中文文件名。 */
export function formatChapterNumber(number: number): string {
  if (!Number.isSafeInteger(number) || number < 1 || number > 9999)
    throw new Error(`章号超出支持范围：${number}`);
  if (number < 10) return CHINESE_DIGITS[number] ?? String(number);
  const units = ["", "十", "百", "千"];
  const digits = String(number).split("").map(Number);
  let result = "";
  let zero = false;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = digits[index] ?? 0;
    const position = digits.length - index - 1;
    if (digit === 0) {
      if (result) zero = true;
      continue;
    }
    if (zero) result += "零";
    if (!(digit === 1 && position === 1 && result === ""))
      result += CHINESE_DIGITS[digit] ?? String(digit);
    result += units[position] ?? "";
    zero = false;
  }
  return result;
}

/** 新建章节的规范文件名，避免模型在英文或阿拉伯数字文件名之间漂移。 */
export function canonicalChapterName(number: number): string {
  return `第${formatChapterNumber(number)}章.md`;
}

/** 中文数字或阿拉伯数字转整数：`十二`→12，`一百零五`→105，`二十`→20，`03`→3。 */
export function parseChapterNumber(token: string): number | undefined {
  if (/^\d+$/u.test(token)) return Number(token);
  let total = 0;
  let current = 0;
  let seen = false;
  for (const char of token) {
    if (char in DIGITS) {
      current = DIGITS[char] ?? 0;
      seen = true;
    } else if (char in UNITS) {
      const unit = UNITS[char] ?? 1;
      // “十二”里的“十”前面没有数字，按 1 处理
      total +=
        (current === 0 && !/零|〇/u.test(token.slice(0, 1)) ? 1 : current) *
        unit;
      current = 0;
      seen = true;
    } else return undefined;
  }
  return seen ? total + current : undefined;
}

/** 从文件名取章号：支持 `第三章`、`第3章`、`第十二章 标题`、`03-标题`、`chapter-3`。 */
export function chapterNumberFromName(name: string): number | undefined {
  const base = (name.replaceAll("\\", "/").split("/").at(-1) ?? name).replace(
    EXTENSIONS,
    "",
  );
  const zh = base.match(
    /第\s*([零〇一二两三四五六七八九十百千\d]+)\s*[章回节]/u,
  );
  if (zh?.[1]) return parseChapterNumber(zh[1]);
  const prefix = base.match(/^(\d{1,4})(?:[\s._-]|$)/u);
  if (prefix?.[1]) return Number(prefix[1]);
  const en = base.match(/^chapter[\s._-]*(\d{1,4})/iu);
  if (en?.[1]) return Number(en[1]);
  return undefined;
}

/** 有章号的按章号升序排在前面，其余按名称排序。 */
export function compareChapters(
  a: Pick<ChapterInfo, "name" | "number">,
  b: Pick<ChapterInfo, "name" | "number">,
): number {
  if (a.number !== undefined && b.number !== undefined && a.number !== b.number)
    return a.number - b.number;
  if (a.number !== undefined && b.number === undefined) return -1;
  if (a.number === undefined && b.number !== undefined) return 1;
  return a.name.localeCompare(b.name, "zh-CN");
}

