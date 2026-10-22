/**
 * 中文小说“AI 味”的可数指标（不调用模型）。
 *
 * 这些是**相对指标**，用来比较同一题材下不同提示词 / 流程的产出，而不是“检测是不是 AI 写的”：
 * 人类作者也会写短句、排比和比喻，只是密度与成片方式不同。阈值偏保守，用来标出值得改写的句子。
 */

export type StyleFlagCode =
  | "short-run"
  | "not-but"
  | "list-run"
  | "number-density"
  | "simile-density";

export type StyleFlag = {
  code: StyleFlagCode;
  label: string;
  /** 命中的原文片段（最多几条），供编辑逐句改写 */
  examples: string[];
  count: number;
};

export type StyleMetrics = {
  characters: number;
  sentences: number;
  avgSentenceLength: number;
  /** 句长标准差：越小越单调 */
  sentenceLengthStdDev: number;
  /** 8 字及以内的短句占比 */
  shortSentenceRatio: number;
  /** 连续 4 句及以上的短句段落数 */
  shortRuns: number;
  /** “不是……而是……”“并非……而是……”次数 */
  notButCount: number;
  /** 4 个及以上短词条逗号并列（“面白，无须，个子不高，穿青”）的次数 */
  listRuns: number;
  /** 每千字的精确数字（阿拉伯数字、“五下”“三步”这类数量）个数 */
  numbersPerThousand: number;
  /** 每千字的比喻词（像、仿佛、如同、宛如、好似）个数 */
  similesPerThousand: number;
  /** 每千字破折号与分号 */
  dashesPerThousand: number;
};

export type StyleReport = {
  metrics: StyleMetrics;
  flags: StyleFlag[];
  /** 综合“可疑处”密度：每千字的标记数，用于横向比较，越低越好 */
  index: number;
};

const SHORT = 8;
const MIN_RUN = 4;

const han = (text: string): number =>
  [...text.matchAll(/[\p{Script=Han}A-Za-z0-9]/gu)].length;

/** 去掉标题行与空行，按句末标点切句；引号内的句末标点也算句界，足够做统计。 */
export function splitSentences(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim() && !/^#{1,6}\s/u.test(line.trim()))
    .flatMap((line) =>
      line
        .split(/(?<=[。！？!?…])|；/u)
        .map((sentence) => sentence.trim())
        .filter((sentence) => han(sentence) > 0),
    );
}

const NOT_BUT =
  /(?:不是|并非|不单是|不只是)[^。！？\n]{1,24}?[，,、]?(?:而是|是)/gu;
const NUMBER =
  /[0-9０-９]+|[二三四五六七八九十两百千]+(?=[个下声次只名步条道把口里尺寸丈年天日夜更遍回层间扇盏支根张])/gu;
const SIMILE = /像|仿佛|如同|宛如|好似|似的|恍如/gu;

/** 4 个及以上、每段不超过 5 个字的逗号并列。 */
function findListRuns(text: string): string[] {
  const runs: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    for (const clause of line.split(/[。！？!?；]/u)) {
      const parts = clause.split(/[，,、]/u).map((part) => part.trim());
      let start = 0;
      for (let index = 0; index <= parts.length; index += 1) {
        const short =
          index < parts.length &&
          han(parts[index] ?? "") > 0 &&
          han(parts[index] ?? "") <= 5;
        if (short) continue;
        if (index - start >= 4) runs.push(parts.slice(start, index).join("，"));
        start = index + 1;
      }
    }
  }
  return runs;
}

export function analyzeStyle(text: string): StyleReport {
  const sentences = splitSentences(text);
  const lengths = sentences.map(han);
  const characters = han(text);
  const mean = lengths.length
    ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length
    : 0;
  const variance = lengths.length
    ? lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      lengths.length
    : 0;

  const shortRunExamples: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= MIN_RUN) shortRunExamples.push(run.join(""));
    run = [];
  };
  sentences.forEach((sentence, index) => {
    // 对话来回本来就短，不算碎句；只看叙述里的连串短句
    const isDialogue = /[“”「」『』"]/u.test(sentence);
    if ((lengths[index] ?? 0) <= SHORT && !isDialogue) run.push(sentence);
    else flush();
  });
  flush();

  const notBut = [...text.matchAll(NOT_BUT)].map((match) => match[0]);
  const listRuns = findListRuns(text);
  const numbers = [...text.matchAll(NUMBER)].map((match) => match[0]);
  const similes = [...text.matchAll(SIMILE)];
  const dashes = [...text.matchAll(/——|；/gu)];
  const perThousand = (count: number) =>
    characters ? (count * 1000) / characters : 0;

  const metrics: StyleMetrics = {
    characters,
    sentences: sentences.length,
    avgSentenceLength: Number(mean.toFixed(1)),
    sentenceLengthStdDev: Number(Math.sqrt(variance).toFixed(1)),
    shortSentenceRatio: lengths.length
      ? Number(
          (
            lengths.filter((value) => value <= SHORT).length / lengths.length
          ).toFixed(3),
        )
      : 0,
    shortRuns: shortRunExamples.length,
    notButCount: notBut.length,
    listRuns: listRuns.length,
    numbersPerThousand: Number(perThousand(numbers.length).toFixed(1)),
    similesPerThousand: Number(perThousand(similes.length).toFixed(1)),
    dashesPerThousand: Number(perThousand(dashes.length).toFixed(1)),
  };

  const flags: StyleFlag[] = [];
  if (shortRunExamples.length)
    flags.push({
      code: "short-run",
      label: `连续${MIN_RUN}句及以上的碎短句（每句不超过${SHORT}字）`,
      examples: shortRunExamples.slice(0, 5),
      count: shortRunExamples.length,
    });
  if (notBut.length >= 2)
    flags.push({
      code: "not-but",
      label: "“不是……而是……”式句型反复出现",
      examples: notBut.slice(0, 5),
      count: notBut.length,
    });
  if (listRuns.length)
    flags.push({
      code: "list-run",
      label: "短词条逗号并列（像在列清单）",
      examples: listRuns.slice(0, 5),
      count: listRuns.length,
    });
  // 密度类指标在过短的文字里噪声太大，只对整章（300 字以上）判断
  if (characters >= 300 && metrics.numbersPerThousand > 8)
    flags.push({
      code: "number-density",
      label: `精确数字过密（每千字 ${metrics.numbersPerThousand} 处）`,
      examples: numbers.slice(0, 8),
      count: numbers.length,
    });
  if (characters >= 300 && metrics.similesPerThousand > 8)
    flags.push({
      code: "simile-density",
      label: `比喻词过密（每千字 ${metrics.similesPerThousand} 处）`,
      examples: [],
      count: similes.length,
    });

  const marks =
    shortRunExamples.length +
    notBut.length +
    listRuns.length +
    Math.max(0, numbers.length - Math.ceil(characters / 125)) +
    Math.max(0, similes.length - Math.ceil(characters / 125));
  return {
    metrics,
    flags,
    index: Number(perThousand(marks).toFixed(2)),
  };
}

/** 给编辑看的改写清单：只列被标出的位置，要求保留情节与信息，只调整表达。 */
export function styleBrief(report: StyleReport): string {
  if (!report.flags.length) return "";
  const lines = report.flags.map(
    (flag) =>
      `- ${flag.label}${flag.examples.length ? `：${flag.examples.map((x) => `「${x}」`).join("、")}` : ""}`,
  );
  return `静态检查标出了以下“机器味”表达，请在不改变情节、信息和人物设定的前提下重写这些位置：把碎句合并成有因果、有衔接的长短句，把清单式并列改成一两处有取舍的描写，减少“不是……而是……”和精确计数，比喻只留最贴切的一处。\n${lines.join("\n")}`;
}
