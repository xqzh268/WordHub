/**
 * 推演：选一个起点章节和一个“假如……”，让几个人物各自按自己已知的信息逐轮行动，最后写一份推演报告。
 * 推演只是作者的参考：结果存成非正史的 Markdown，不会写进章节、设定或事实。
 */

export const SIM_LIMITS = {
  minParticipants: 2,
  maxParticipants: 6,
  maxRounds: 6,
  maxPremise: 500,
  maxActionChars: 600,
} as const;

export type SimEntry = {
  round: number;
  name: string;
  /** 公开的行动或话语，其他人物看得到 */
  action: string;
  /** 内心想法，只有本人和最后的报告看得到 */
  intent?: string;
};

export class SimulationError extends Error {}

export function checkSimulationInput(input: {
  participants: readonly string[];
  rounds: number;
  premise?: string;
}): void {
  const names = new Set(input.participants);
  if (names.size !== input.participants.length)
    throw new SimulationError("参与的人物不能重复");
  if (
    names.size < SIM_LIMITS.minParticipants ||
    names.size > SIM_LIMITS.maxParticipants
  )
    throw new SimulationError(
      `推演需要 ${SIM_LIMITS.minParticipants}–${SIM_LIMITS.maxParticipants} 个人物参与`,
    );
  if (
    !Number.isInteger(input.rounds) ||
    input.rounds < 1 ||
    input.rounds > SIM_LIMITS.maxRounds
  )
    throw new SimulationError(`轮数需要在 1–${SIM_LIMITS.maxRounds} 之间`);
  if ((input.premise ?? "").length > SIM_LIMITS.maxPremise)
    throw new SimulationError(`“假如……”最多 ${SIM_LIMITS.maxPremise} 字`);
}

/** 其他人物能看到的：只有公开的行动，没有心思。 */
export function publicLogLines(log: readonly SimEntry[]): string[] {
  return log.map(
    (entry) => `第${entry.round}轮 · ${entry.name}：${entry.action}`,
  );
}

export function stepPrompt(
  round: number,
  rounds: number,
  name: string,
): string {
  return `现在是推演的第 ${round}/${rounds} 轮，轮到你（${name}）。请按格式给出本轮的【行动】和【心思】。`;
}

/** 解析“【行动】…【心思】…”；模型没按格式写时，整段当作行动。 */
export function parseStep(text: string): { action: string; intent?: string } {
  const clean = text.trim();
  const action = /【行动】([\s\S]*?)(?=【心思】|$)/u.exec(clean)?.[1]?.trim();
  const intent = /【心思】([\s\S]*)$/u.exec(clean)?.[1]?.trim();
  const fallback = clean
    .replace(/【心思】[\s\S]*$/u, "")
    .replace(/【行动】/u, "")
    .trim();
  const result = (action || fallback).slice(0, SIM_LIMITS.maxActionChars);
  return {
    action: result,
    ...(intent ? { intent: intent.slice(0, 400) } : {}),
  };
}

export function reportSystem(projectName: string): string {
  return [
    "【文枢·推演报告】",
    `你是小说《${projectName}》的创作顾问。下面是一次“推演”的完整记录：作者给了一个起始局面，几个人物各自按已知信息逐轮行动。`,
    "请写一份给作者的推演报告，用 Markdown，包含这几节（每节简短）：",
    "## 推演小结（3–5 句：局面怎么发展、谁占上风）",
    "## 可能的走向（列 2–3 种，每种写清触发条件，并用“较大/中等/较小”标注可能性）",
    "## 关键转折点（引用具体的轮次与人物）",
    "## 与既有设定的冲突或存疑之处（人物行为是否违背已知事实或性格；没有就写“未发现”）",
    "## 对后续章节的建议（2–4 条，作者可自行取舍）",
    "要求：只依据下面给出的记录，不要编造记录里没有的事；这是推演，不是定论，语气保持克制。",
  ].join("\n");
}

export function reportPrompt(input: {
  chapterLabel: string;
  premise?: string;
  participants: readonly string[];
  log: readonly SimEntry[];
  knownFacts: readonly string[];
}): string {
  return [
    `起点：「${input.chapterLabel}」结束时的局面。`,
    `起始设定（假如）：${input.premise?.trim() || "没有额外设定，自然发展"}`,
    `参与人物：${input.participants.join("、")}`,
    "",
    "## 起点时的已知事实（作者已确认）",
    input.knownFacts.length ? input.knownFacts.join("\n") : "（暂无）",
    "",
    "## 推演记录",
    ...input.log.map(
      (entry) =>
        `第${entry.round}轮 · ${entry.name}\n　行动：${entry.action}${entry.intent ? `\n　心思（仅本人知道）：${entry.intent}` : ""}`,
    ),
  ].join("\n");
}

/** 粗估：中文按约 1.6 字一个 token。只用来在开始前让作者心里有数。 */
export function estimateSimulation(input: {
  /** 每个参与者的系统提示字数 */
  contextChars: readonly number[];
  rounds: number;
}): { calls: number; inputTokens: number; outputTokens: number } {
  const per = (chars: number) => Math.ceil(chars / 1.6);
  const participants = input.contextChars.length;
  let inputTokens = 0;
  for (let round = 1; round <= input.rounds; round += 1)
    for (const chars of input.contextChars) {
      // 公开记录随轮次增长：每条约 80 字
      const logChars = (round - 1) * participants * 80;
      inputTokens += per(chars + logChars + 120);
    }
  const reportInput = per(
    input.contextChars.reduce((a, b) => a + b, 0) / Math.max(participants, 1) +
      input.rounds * participants * 160,
  );
  return {
    calls: input.rounds * participants + 1,
    inputTokens: inputTokens + reportInput,
    outputTokens: input.rounds * participants * 220 + 900,
  };
}
