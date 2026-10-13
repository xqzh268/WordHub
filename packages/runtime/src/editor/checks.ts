/** 编辑节点可重复执行的语言检查；不调用模型，也不改变正文。 */

export type EditorCheckRules = {
  minWords?: number;
  maxWords?: number;
  aiClicheWords?: readonly string[];
  maxDialogueRatio?: number;
  maxConsecutiveFourCharIdioms?: number;
};

export type EditorViolationCode =
  | "word-count"
  | "ai-cliche"
  | "dialogue-ratio"
  | "four-char-idiom";

export type EditorViolation = {
  code: EditorViolationCode;
  message: string;
  details: Record<string, unknown>;
};

export type EditorCheckMetrics = {
  wordCount: number;
  dialogueCharacters: number;
  dialogueRatio: number;
  aiClicheHits: { term: string; count: number }[];
  fourCharIdiomRuns: string[][];
};

export type EditorCheckResult = {
  ok: boolean;
  metrics: EditorCheckMetrics;
  violations: EditorViolation[];
};

/** 负面清单来自文风规范；项目可以通过规则覆盖或缩减。 */
export const DEFAULT_AI_CLICHE_WORDS = [
  "此外",
  "与此同时",
  "综上所述",
  "总而言之",
  "值得注意的是",
  "值得一提的是",
  "显而易见",
  "毋庸置疑",
  "在某种程度上",
  "从某种意义上说",
  "不禁",
  "仿佛",
] as const;

/** 默认只提示三段及以上相邻四字成语，允许正常的两段成语表达。 */
export const DEFAULT_EDITOR_RULES = {
  aiClicheWords: DEFAULT_AI_CLICHE_WORDS,
  maxConsecutiveFourCharIdioms: 2,
  maxDialogueRatio: 0.65,
} as const satisfies EditorCheckRules;

const FOUR_CHAR_IDIOMS = [
  "不约而同",
  "意味深长",
  "若有所思",
  "恍然大悟",
  "四面八方",
  "小心翼翼",
  "电光火石",
  "风平浪静",
  "一言不发",
  "不知所措",
  "难以置信",
  "毫不犹豫",
  "如释重负",
  "微微一笑",
  "心中一动",
] as const;

const wordPattern = /[\p{Script=Han}A-Za-z0-9]/gu;
const dialoguePattern = /“([^”]*)”|「([^」]*)」|『([^』]*)』|"([^"]*)"/gu;

const countWords = (text: string): number =>
  [...text.matchAll(wordPattern)].length;

const countOccurrences = (text: string, term: string): number => {
  if (!term) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= text.length - term.length) {
    const index = text.indexOf(term, offset);
    if (index < 0) break;
    count += 1;
    offset = index + term.length;
  }
  return count;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const findFourCharIdiomRuns = (text: string): string[][] => {
  const pattern = new RegExp(
    FOUR_CHAR_IDIOMS.map(escapeRegExp).join("|"),
    "gu",
  );
  const occurrences = [...text.matchAll(pattern)].flatMap((match) => {
    const term = match[0];
    const start = match.index ?? -1;
    return start >= 0 ? [{ term, start, end: start + term.length }] : [];
  });
  const runs: string[][] = [];
  let current: string[] = [];
  let previousEnd = -1;
  for (const occurrence of occurrences) {
    // 允许一个中文逗号或空格作为成语之间的排版分隔，普通叙述会自然断开。
    const adjacent = previousEnd >= 0 && occurrence.start - previousEnd <= 2;
    if (!adjacent) {
      if (current.length > 1) runs.push(current);
      current = [occurrence.term];
    } else current.push(occurrence.term);
    previousEnd = occurrence.end;
  }
  if (current.length > 1) runs.push(current);
  return runs;
};

export function checkEditorText(
  text: string,
  rules: EditorCheckRules = DEFAULT_EDITOR_RULES,
): EditorCheckResult {
  const wordCount = countWords(text);
  const dialogueCharacters = [...text.matchAll(dialoguePattern)].reduce(
    (total, match) =>
      total + countWords(match[1] ?? match[2] ?? match[3] ?? match[4] ?? ""),
    0,
  );
  const totalCharacters = countWords(text);
  const dialogueRatio =
    totalCharacters === 0 ? 0 : dialogueCharacters / totalCharacters;
  const aiClicheHits = (rules.aiClicheWords ?? []).flatMap((term) => {
    const count = countOccurrences(text, term);
    return count > 0 ? [{ term, count }] : [];
  });
  const fourCharIdiomRuns = findFourCharIdiomRuns(text);
  const violations: EditorViolation[] = [];

  if (rules.minWords !== undefined && wordCount < rules.minWords)
    violations.push({
      code: "word-count",
      message: `正文${wordCount}字，少于最低要求${rules.minWords}字。`,
      details: { actual: wordCount, min: rules.minWords },
    });
  if (rules.maxWords !== undefined && wordCount > rules.maxWords)
    violations.push({
      code: "word-count",
      message: `正文${wordCount}字，超过最高要求${rules.maxWords}字。`,
      details: { actual: wordCount, max: rules.maxWords },
    });
  if (aiClicheHits.length)
    violations.push({
      code: "ai-cliche",
      message: `发现AI腔词：${aiClicheHits.map((hit) => `${hit.term}×${hit.count}`).join("、")}。`,
      details: { hits: aiClicheHits },
    });
  if (
    rules.maxDialogueRatio !== undefined &&
    dialogueRatio > rules.maxDialogueRatio
  )
    violations.push({
      code: "dialogue-ratio",
      message: `对话占比${(dialogueRatio * 100).toFixed(1)}%，超过${(rules.maxDialogueRatio * 100).toFixed(1)}%上限。`,
      details: { actual: dialogueRatio, max: rules.maxDialogueRatio },
    });
  const maxIdioms = rules.maxConsecutiveFourCharIdioms;
  if (
    maxIdioms !== undefined &&
    fourCharIdiomRuns.some((run) => run.length > maxIdioms)
  )
    violations.push({
      code: "four-char-idiom",
      message: `连续四字成语超过${maxIdioms}段：${fourCharIdiomRuns
        .filter((run) => run.length > maxIdioms)
        .map((run) => run.join("、"))
        .join("；")}。`,
      details: {
        max: maxIdioms,
        runs: fourCharIdiomRuns,
      },
    });

  return {
    ok: violations.length === 0,
    metrics: {
      wordCount,
      dialogueCharacters,
      dialogueRatio,
      aiClicheHits,
      fourCharIdiomRuns,
    },
    violations,
  };
}
