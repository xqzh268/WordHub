import {
  type AliasLink,
  type ChapterSummary,
  FACT_KIND_LABELS,
  type KnowledgeEntry,
  type NovelFact,
  characterKnowledge,
  graphTimeline,
  resolveName,
} from "@wordhub/contracts";

/**
 * 人物采访：以图谱里的一个人物的身份回答作者的提问。
 * 知识边界在这里“硬过滤”——模型只会看到截至所选章节、已确认、与这个人物有关的事实，
 * 看不到之后的章节，也看不到待确认或已驳回的事实。回答之后再做一次人名越界检查。
 */

export type InterviewMode = "character" | "author";
export type InterviewTurn = { role: "user" | "character"; text: string };

export type InterviewBasis = {
  /** 回答里的标注，如 F3 */
  ref: string;
  factId: string;
  chapter: string;
  kind: NovelFact["kind"];
  statement: string;
  quote: string;
};

export type InterviewContext = {
  system: string;
  /** F1… → 事实 */
  facts: Map<string, NovelFact>;
  /** 截至所选章节还没出现的人物名；回答里出现就是越界 */
  hiddenNames: Array<{ name: string; chapterLabel: string }>;
  chapterLabel: string;
};

export class InterviewError extends Error {}

const baseName = (chapter: string): string =>
  (chapter.replaceAll("\\", "/").split("/").at(-1) ?? chapter).replace(
    /\.[^.]+$/u,
    "",
  );

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/** 取 characters.md 里标题含这个名字的那一节；没有就不给。 */
export function profileFor(
  characters: string | undefined,
  name: string,
): string {
  if (!characters) return "";
  const lines = characters.split(/\r?\n/u);
  const start = lines.findIndex(
    (line) => /^#{1,6}\s/u.test(line) && line.includes(name),
  );
  if (start < 0) return "";
  const level = /^(#{1,6})/u.exec(lines[start] ?? "")?.[1]?.length ?? 1;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const heading = /^(#{1,6})\s/u.exec(line);
    if (heading && (heading[1]?.length ?? 7) <= level) break;
    body.push(line);
  }
  return clip(body.join("\n").trim(), 800);
}

export function buildInterviewContext(input: {
  projectName: string;
  facts: readonly NovelFact[];
  summaries: readonly ChapterSummary[];
  node: string;
  /** 所选章节的相对路径 */
  chapter: string;
  mode: InterviewMode;
  characters?: string;
  setting?: string;
  /** 作者建立的别名合并 */
  aliases?: readonly AliasLink[];
  /** 作者指定的“他知道/不知道哪些事” */
  knowledge?: readonly KnowledgeEntry[];
  /** interview（默认）：采访；simulate：推演里的一个参与者 */
  purpose?: "interview" | "simulate";
  /** 推演：起始局面（作者设定的“假如……”） */
  premise?: string;
  /** 推演：到目前为止公开发生的事，每条一行 */
  publicLog?: readonly string[];
}): InterviewContext {
  const timeline = graphTimeline(input.facts, input.summaries);
  const upTo = timeline.findIndex((entry) => entry.chapter === input.chapter);
  if (upTo < 0) throw new InterviewError("所选章节不在时间轴上");
  const chapterLabel = timeline[upTo]?.label ?? baseName(input.chapter);
  const aliases = input.aliases ?? [];
  const knowledge = characterKnowledge({
    node: input.node,
    facts: input.facts,
    timeline,
    upToIndex: upTo,
    aliases,
    entries: input.knowledge,
  });
  if (!knowledge)
    throw new InterviewError(
      `到「${chapterLabel}」为止，图谱里还没有已确认的人物「${input.node}」。`,
    );
  const node = knowledge.node;
  const position = new Map(
    timeline.map((entry) => [entry.chapter, entry.index]),
  );
  // 他知道的事：默认推断 + 作者指定（见 characterKnowledge）；其余事实一概不给。
  const known = knowledge.known.map((item) => item.fact);
  const facts = new Map<string, NovelFact>();
  const lines = known.map((fact, i) => {
    const ref = `F${i + 1}`;
    facts.set(ref, fact);
    const head =
      fact.kind === "relation"
        ? `${fact.subject} →${fact.relation}→ ${fact.object}：${fact.statement}`
        : fact.statement;
    return `[${ref}]（${baseName(fact.chapter)}·${FACT_KIND_LABELS[fact.kind]}）${head}　原文：“${fact.quote}”`;
  });

  // 他亲历过的章节（有他的事实的章节）的摘要
  const present = new Set(known.map((fact) => fact.chapter));
  const summaryLines = input.summaries
    .filter(
      (summary) =>
        present.has(summary.chapter) &&
        (position.get(summary.chapter) ?? Number.POSITIVE_INFINITY) <= upTo,
    )
    .sort(
      (a, b) => (position.get(a.chapter) ?? 0) - (position.get(b.chapter) ?? 0),
    )
    .map(
      (summary) => `- ${baseName(summary.chapter)}：${clip(summary.text, 400)}`,
    );

  const profile = profileFor(input.characters, node.id);
  const setting = input.setting ? clip(input.setting.trim(), 1200) : "";

  // 越界名单：起点章节之后才第一次出现的名字（按原始名字算；已揭晓并入他的别名不算）
  const firstSeen = new Map<string, number>();
  for (const fact of input.facts) {
    if (fact.status !== "confirmed") continue;
    if (fact.kind !== "character_state" && fact.kind !== "relation") continue;
    const at = position.get(fact.chapter);
    if (at === undefined) continue;
    for (const name of [fact.subject, fact.object])
      if (name && at < (firstSeen.get(name) ?? Number.POSITIVE_INFINITY))
        firstSeen.set(name, at);
  }
  const knownNames = new Set([node.id, ...node.aliases.map((a) => a.name)]);
  const hiddenNames = [...firstSeen.entries()]
    .filter(
      ([name, at]) =>
        at > upTo &&
        !knownNames.has(name) &&
        resolveName(name, aliases, position, upTo) === name,
    )
    .map(([name, at]) => ({
      name,
      chapterLabel: timeline[at]?.label ?? "",
    }));
  const alsoCalled = node.aliases.length
    ? `你在故事里还有这些称呼：${node.aliases.map((a) => a.name).join("、")}（它们指的都是你）。`
    : "";

  const simulate = input.purpose === "simulate";
  const rules = simulate
    ? [
        `你是小说《${input.projectName}》里的人物「${node.id}」。下面是一次“推演”：故事从「${chapterLabel}」刚结束的局面继续往下走，由你和其他人物各自决定自己的下一步。`,
        "你要以这个人物的身份、性格和处境行事，而不是替作者安排剧情。",
      ]
    : input.mode === "character"
      ? [
          `你是小说《${input.projectName}》里的人物「${node.id}」。现在是「${chapterLabel}」刚结束的时候，作者在采访你。`,
          "全程以第一人称、用符合你身份和说话方式的口吻回答，不要出戏，不要提到“作者”“小说”“章节”这些字眼。",
        ]
      : [
          `你是小说《${input.projectName}》的创作助手，正在帮作者分析人物「${node.id}」截至「${chapterLabel}」时的内心与动机。`,
          "可以用第三人称、以分析的口吻回答，但依据仍然只能是下面给出的材料。",
        ];
  const obey = simulate
    ? [
        "必须遵守：",
        "1. 只能依据下面“已知的事”“人物档案”和“推演中已经发生的事”行事。不要违背已知的事实，也不要编造你不可能知道的信息。",
        "2. 你只知道公开发生的事（别人说了什么、做了什么），不知道别人心里怎么想。",
        "3. 不要预言后文，不要引入下面没有出现的人物。",
        "4. 严格按下面的格式输出，不要写别的：",
        "【行动】你这一轮说的话或做的事，1–3 句，具体、能被别人看到。",
        "【心思】你此刻真实的想法和打算，1–2 句（只有你自己知道）。",
      ]
    : [
        "必须遵守：",
        "1. 只能依据下面“已知的事”和“人物档案”回答。没写到的事，就说你不知道、没听说或不确定（作者模式下说“依据不足”）；不要编造新的情节、人物或过去。",
        "2. 你不知道「这一章之后」会发生什么，不要预言、暗示后文，也不要提到下面没有出现的人物。",
        "3. 回答里用到某条已知的事时，在那句话末尾标注它的编号，如 [F2]；只能用下面出现的编号。纯属推测的地方写“（推测）”。",
        "4. 回答控制在 300 字以内，直接回答，不要复述问题。",
      ];
  const system = [
    simulate ? "【文枢·人物推演】" : "【文枢·人物采访】",
    ...rules,
    ...(alsoCalled ? [alsoCalled] : []),
    "",
    ...obey,
    "",
    "## 已知的事（截至所选章节，作者已确认）",
    lines.length ? lines.join("\n") : "（暂无）",
    ...(summaryLines.length
      ? ["", "## 你亲历过的章节概要", ...summaryLines]
      : []),
    ...(profile
      ? [
          "",
          "## 人物档案（作者设定；其中尚未在上面“已知的事”里出现的内容不要主动透露）",
          profile,
        ]
      : []),
    ...(setting ? ["", "## 世界背景", setting] : []),
    ...(simulate
      ? [
          "",
          "## 推演开始时的局面",
          input.premise?.trim() || "没有额外设定，从当前的局面自然发展。",
          "",
          "## 推演中已经发生的事（公开）",
          input.publicLog?.length ? input.publicLog.join("\n") : "（还没有）",
        ]
      : []),
  ].join("\n");
  return { system, facts, hiddenNames, chapterLabel };
}

/** 把历史对话和新问题拼成一次提问（模型接口是单轮的，历史以对话记录的形式带上）。 */
export function interviewPrompt(
  history: readonly InterviewTurn[],
  question: string,
  node: string,
): string {
  const recent = history.slice(-12);
  const transcript = recent
    .map(
      (turn) =>
        `${turn.role === "user" ? "作者" : node}：${clip(turn.text, 800)}`,
    )
    .join("\n");
  return [
    ...(transcript ? ["此前的对话：", transcript, ""] : []),
    `作者现在问：${question}`,
  ].join("\n");
}

export type InterviewAnswer = {
  answer: string;
  basis: InterviewBasis[];
  warnings: string[];
};

/** 解析回答：收集 [F#] 标注对应的事实，检查有没有提到后文才出现的人物。 */
export function readAnswer(
  text: string,
  context: InterviewContext,
): InterviewAnswer {
  const answer = text.trim();
  const basis: InterviewBasis[] = [];
  const seen = new Set<string>();
  for (const match of answer.matchAll(/\[(F\d+)\]/gu)) {
    const ref = match[1] as string;
    const fact = context.facts.get(ref);
    if (!fact || seen.has(ref)) continue;
    seen.add(ref);
    basis.push({
      ref,
      factId: fact.id,
      chapter: fact.chapter,
      kind: fact.kind,
      statement: fact.statement,
      quote: fact.quote,
    });
  }
  const warnings: string[] = [];
  for (const hidden of context.hiddenNames)
    if (answer.includes(hidden.name))
      warnings.push(
        `回答里提到了「${hidden.name}」，这个人物要到「${hidden.chapterLabel}」才出现，超出了你选的「${context.chapterLabel}」。`,
      );
  const unknown = [...answer.matchAll(/\[(F\d+)\]/gu)].filter(
    (match) => !context.facts.has(match[1] as string),
  );
  if (unknown.length)
    warnings.push(
      `回答标注了不存在的依据（${[...new Set(unknown.map((m) => m[1]))].join("、")}），这些说法没有出处。`,
    );
  const admitsIgnorance = /不知道|不清楚|没听说|不确定|依据不足|说不准/u.test(
    answer,
  );
  if (basis.length === 0 && answer.length > 0 && !admitsIgnorance)
    warnings.push("回答没有标注任何依据，请谨慎采信。");
  return { answer, basis, warnings };
}
