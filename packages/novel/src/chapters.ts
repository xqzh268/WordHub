// 仅描述小说项目的章节规则，运行时和渲染进程都可使用。
export const CHAPTER_DIRECTORY = "chapters";
export const CHAPTER_PATH_PREFIX = `${CHAPTER_DIRECTORY}/`;
export const CHAPTER_GLOB = `${CHAPTER_PATH_PREFIX}**`;

const CHAPTER_EXTENSIONS = "(?:md|markdown|txt)";
const EXTENSIONS = new RegExp(`\\.${CHAPTER_EXTENSIONS}$`, "iu");
const PATH_MENTION = new RegExp(
  `${CHAPTER_PATH_PREFIX}[^\\s"“”'，。；;]+?\\.${CHAPTER_EXTENSIONS}`,
  "iu",
);
const ORDINAL_DIGITS = "零〇一二两三四五六七八九十百千\\d";
type ChapterSuffixes = "章回" | "章回节";

/** 小说工作流接受“写第三章”“生成3章”等写作请求。 */
export function isChapterWritingRequest(prompt: string): boolean {
  return /(写|撰写|生成).{0,8}第?[一二三四五六七八九十\d]+章/u.test(prompt);
}

export const normalizeChapterPath = (value: string): string =>
  value.replaceAll("\\", "/");

/** 只识别目录前缀，调用方仍负责限制文件类型和保护项目路径。 */
export const isChapterPath = (value: string): boolean =>
  normalizeChapterPath(value).startsWith(CHAPTER_PATH_PREFIX);

export const chapterPathForName = (name: string): string =>
  `${CHAPTER_PATH_PREFIX}${name}`;

export const chapterFileStem = (name: string): string =>
  (normalizeChapterPath(name).split("/").at(-1) ?? name).replace(
    EXTENSIONS,
    "",
  );

/** UI 显示项目内路径时保留可能的子目录。 */
export function chapterPathLabel(relativePath: string): string {
  const name = relativePath.startsWith(CHAPTER_PATH_PREFIX)
    ? relativePath.slice(CHAPTER_PATH_PREFIX.length)
    : relativePath;
  return name.replace(/\.[^.]+$/u, "");
}

/** 隐藏文件和临时文件不参与章节读取及列表显示。 */
export function isChapterFileName(name: string): boolean {
  return (
    EXTENSIONS.test(name) && !name.startsWith(".") && !name.endsWith(".tmp")
  );
}

/** 纸面只允许编辑一级目录中的 Markdown 文件。 */
export function isEditableChapterPath(relativePath: string): boolean {
  const normalized = normalizeChapterPath(relativePath);
  const name = normalized.slice(CHAPTER_PATH_PREFIX.length);
  return (
    normalized.toLowerCase().startsWith(CHAPTER_PATH_PREFIX) &&
    /^[^/]+\.(?:md|markdown)$/iu.test(name) &&
    !normalized.includes("..")
  );
}

/** 提取定稿提示中的显式章节路径，不改变匹配文本的拼写。 */
export const chapterPathInText = (text: string): string | undefined =>
  text.match(PATH_MENTION)?.[0];

export const chapterOrdinal = (token: string | number): string =>
  `第${token}章`;

function chapterMentions(
  text: string,
  suffixes: ChapterSuffixes,
  allowTenThousands = false,
) {
  const digits = allowTenThousands ? `${ORDINAL_DIGITS}万` : ORDINAL_DIGITS;
  return text.matchAll(
    new RegExp(`第\\s*([${digits}]+)\\s*[${suffixes}]`, "gu"),
  );
}

export function chapterNumberTokenInText(
  text: string,
  suffixes: ChapterSuffixes = "章回节",
  options: { allowTenThousands?: boolean } = {},
): string | undefined {
  return chapterMentions(text, suffixes, options.allowTenThousands).next()
    .value?.[1];
}

export function chapterNumbersInText(
  text: string,
  suffixes: ChapterSuffixes = "章回节",
): (number | undefined)[] {
  return Array.from(chapterMentions(text, suffixes), (match) =>
    parseChapterNumber(match[1] ?? ""),
  );
}

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
const CHINESE_DIGITS = [
  "零",
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
];

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
  return `${chapterOrdinal(formatChapterNumber(number))}.md`;
}

export const canonicalChapterPath = (number: number): string =>
  chapterPathForName(canonicalChapterName(number));

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
  const base = chapterFileStem(name);
  const ordinal = chapterNumberTokenInText(base);
  if (ordinal) return parseChapterNumber(ordinal);
  const prefix = base.match(/^(\d{1,4})(?:[\s._-]|$)/u);
  if (prefix?.[1]) return Number(prefix[1]);
  const en = base.match(/^chapter[\s._-]*(\d{1,4})/iu);
  if (en?.[1]) return Number(en[1]);
  return undefined;
}

/** 有章号的按章号升序排在前面，其余按名称排序。 */
type ChapterOrderKey = { name: string; number?: number };

export function compareChapters(
  a: ChapterOrderKey,
  b: ChapterOrderKey,
): number {
  if (a.number !== undefined && b.number !== undefined && a.number !== b.number)
    return a.number - b.number;
  if (a.number !== undefined && b.number === undefined) return -1;
  if (a.number === undefined && b.number !== undefined) return 1;
  return a.name.localeCompare(b.name, "zh-CN");
}
