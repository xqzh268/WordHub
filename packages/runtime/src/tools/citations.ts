import { readFile } from "node:fs/promises";
import { safeProjectTarget } from "@wordhub/store";

/** 评审质询的一致性分类（M4.4 清单）。 */
export const CHALLENGE_CATEGORIES = [
  "timeline",
  "character",
  "fact",
  "commonsense",
  "style",
] as const;
export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ChallengeCategory, string> = {
  timeline: "时间线",
  character: "人物塑造",
  fact: "基本事实",
  commonsense: "常识",
  style: "风格",
};

/** 时间线、人物、基本事实类矛盾必须同时引用矛盾的两端；常识与风格至少引用正文一处。 */
const NEEDS_TWO_SIDES = new Set<ChallengeCategory>([
  "timeline",
  "character",
  "fact",
]);

export type Citation = { source: string; quote: string };

const MIN_QUOTE_LENGTH = 4;

/** 去掉空白与引号差异：模型复制原文时常常改动换行、全半角引号。 */
const normalize = (text: string): string =>
  text.replace(/[\s　]+/gu, "").replace(/[“”「」『』"'‘’]/gu, "");

/** 模型常用省略号连接两段原文；逐段核验。 */
const segments = (quote: string): string[] =>
  quote
    .split(/…+|\.{3,}|⋯+/u)
    .map(normalize)
    .filter((part) => part.length > 0);

/**
 * 逐条核验引文：出处必须是项目里的章节或设定文件，引文必须逐字出现在出处里。
 * 任何一条不成立就抛错（工具错误会回到模型，让它重新核对原文或撤销质询）。
 */
export async function verifyCitations(
  projectPath: string,
  category: ChallengeCategory,
  citations: readonly Citation[] | undefined,
): Promise<void> {
  const list = citations ?? [];
  const needed = NEEDS_TWO_SIDES.has(category) ? 2 : 1;
  if (list.length < needed)
    throw new Error(
      `「${CATEGORY_LABELS[category]}」类质询至少要引用${needed}处原文（${
        needed === 2
          ? "矛盾的两端：正文与设定，或正文与另一章"
          : "正文中的问题处"
      }），并写明出处文件。`,
    );
  const distinct = new Set(
    list.map((item) => `${item.source}\u0000${normalize(item.quote)}`),
  );
  if (distinct.size < needed)
    throw new Error("引用的原文重复，请分别引用矛盾的两端。");
  for (const item of list) {
    const source = item.source.replaceAll("\\", "/").replace(/#.*$/u, "");
    if (!/^(chapters\/|\.wordhub\/bible\/)/u.test(source))
      throw new Error(
        `出处「${item.source}」无效：只能引用 chapters/ 下的章节或 .wordhub/bible/ 下的设定文件。`,
      );
    const parts = segments(item.quote);
    if (!parts.length || parts.some((part) => part.length < MIN_QUOTE_LENGTH))
      throw new Error(
        `引文「${item.quote.slice(0, 30)}」太短，请逐字引用至少 ${MIN_QUOTE_LENGTH} 个字的原文。`,
      );
    let text: string;
    try {
      const target = await safeProjectTarget(projectPath, source, true);
      text = normalize(await readFile(target, "utf8"));
    } catch {
      throw new Error(`出处「${source}」读取失败或不存在，请核对路径。`);
    }
    const missing = parts.find((part) => !text.includes(part));
    if (missing)
      throw new Error(
        `引文没有逐字出现在 ${source} 中：「${missing.slice(0, 40)}」。请重新读取该文件并逐字复制原文，或撤销这条质询。`,
      );
  }
}
