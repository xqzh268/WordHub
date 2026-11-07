import { type AliasLink, resolveName } from "./aliases.js";
import type { Event } from "./domain.js";
import type { ChapterSummary, NovelFact } from "./facts.js";
import {
  type FactGraphNode,
  type TimelineEntry,
  graphTimeline,
  projectGraph,
  resolveFactNames,
} from "./graph.js";

/**
 * 认知边 knows(人物, 事实, since)：作者指定某个人物知不知道某条已确认的事实。
 * 没有指定时用默认推断（见 characterKnowledge）；指定了就以作者为准。
 * 这样能表达“读者知道、人物不知道”（戏剧反讽）和“人物私下知道、读者后来才知道”。
 */
export type KnowledgeMode = "knows" | "unaware";

export type KnowledgeEntry = {
  factId: string;
  character: string;
  mode: KnowledgeMode;
  /** 仅 knows：从哪一章起知道（相对路径）；缺省 = 从事实发生的那一章起 */
  chapter?: string;
  at: string;
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const entryKey = (factId: string, character: string): string =>
  `${factId}\u0000${character}`;

/** 由事件日志投影：knowledge.set 设定，knowledge.cleared 恢复默认；同一（事实，人物）以最后一次为准。 */
export function projectKnowledge(events: readonly Event[]): KnowledgeEntry[] {
  const entries = new Map<string, KnowledgeEntry>();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const factId = asString(payload.factId);
    const character = asString(payload.character);
    if (!factId || !character) continue;
    if (event.type === "knowledge.set") {
      const mode = payload.mode;
      if (mode !== "knows" && mode !== "unaware") continue;
      const chapter = mode === "knows" ? asString(payload.chapter) : undefined;
      entries.set(entryKey(factId, character), {
        factId,
        character,
        mode,
        ...(chapter ? { chapter } : {}),
        at: event.occurredAt,
      });
    } else if (event.type === "knowledge.cleared") {
      entries.delete(entryKey(factId, character));
    }
  }
  return [...entries.values()];
}

export type KnownFact = {
  fact: NovelFact;
  /** default：默认推断；granted：作者指定他知道 */
  source: "default" | "granted";
  /** granted 时的“从哪一章起” */
  since?: string;
};
export type UnknownFact = {
  fact: NovelFact;
  /** default：默认推断他不知道；denied：作者指定他不知道 */
  reason: "default" | "denied";
};
export type Knowledge = {
  node: FactGraphNode;
  known: KnownFact[];
  /** 已确认、不晚于所选章节、读者已知但他不知道的事实（不含名词解释） */
  unknown: UnknownFact[];
};

/**
 * 到第 upTo 章（0 起）为止，这个人物知道什么。
 * 默认推断：他本人的人物状态与关系、他在其中出现的关键事件、身边人（有直接关系的人）在他亲历的章节里的状态变化。
 * 作者指定的认知边覆盖默认：knows 在“起知章节”到了之后加入；unaware 一律去掉。
 * 只涉及已确认、不晚于所选章节的事实——人物不会知道读者都还没读到的事。
 */
export function characterKnowledge(input: {
  node: string;
  facts: readonly NovelFact[];
  summaries?: readonly ChapterSummary[];
  upToIndex: number;
  aliases?: readonly AliasLink[];
  entries?: readonly KnowledgeEntry[];
  timeline?: readonly TimelineEntry[];
}): Knowledge | undefined {
  const timeline = input.timeline ?? graphTimeline(input.facts, input.summaries);
  const position = new Map(timeline.map((entry) => [entry.chapter, entry.index]));
  const upTo = input.upToIndex;
  const aliases = input.aliases ?? [];
  const graph = projectGraph(input.facts, timeline, { upToIndex: upTo, aliases });
  const node = graph.nodes.find((item) => item.id === input.node);
  if (!node) return undefined;
  const names = new Set([node.id, ...node.aliases.map((alias) => alias.name)]);
  const at = (fact: NovelFact): number =>
    position.get(fact.chapter) ?? Number.POSITIVE_INFINITY;
  const confirmed = resolveFactNames(
    input.facts.filter((fact) => fact.status === "confirmed"),
    position,
    upTo,
    aliases,
  ).filter((fact) => at(fact) <= upTo);

  const involvedEvents = confirmed.filter(
    (fact) =>
      fact.kind === "event" &&
      (fact.subject === node.id ||
        [...names].some((name) => fact.statement.includes(name))),
  );
  const neighbours = new Set(
    graph.edges.flatMap((edge) =>
      edge.source === node.id
        ? [edge.target]
        : edge.target === node.id
          ? [edge.source]
          : [],
    ),
  );
  const presentChapters = new Set(node.facts.map((fact) => fact.chapter));
  const nearby = confirmed.filter(
    (fact) =>
      fact.kind === "character_state" &&
      neighbours.has(fact.subject) &&
      presentChapters.has(fact.chapter),
  );
  const byId = new Map<string, NovelFact>();
  for (const fact of [...node.facts, ...involvedEvents, ...nearby])
    if (fact.status === "confirmed") byId.set(fact.id, fact);

  const known = new Map<string, KnownFact>();
  for (const [id, fact] of byId) known.set(id, { fact, source: "default" });
  const denied = new Set<string>();
  const confirmedById = new Map(confirmed.map((fact) => [fact.id, fact]));
  for (const entry of input.entries ?? []) {
    // 作者填的名字可能是别名：按所选章节解析成规范名再比
    if (resolveName(entry.character, aliases, position, upTo) !== node.id)
      continue;
    const fact = confirmedById.get(entry.factId);
    if (!fact) continue;
    if (entry.mode === "unaware") {
      known.delete(fact.id);
      denied.add(fact.id);
    } else {
      const since = entry.chapter ? position.get(entry.chapter) : at(fact);
      if (since === undefined || since > upTo) continue;
      known.set(fact.id, {
        fact,
        source: "granted",
        ...(entry.chapter ? { since: entry.chapter } : {}),
      });
      denied.delete(fact.id);
    }
  }
  const order = (a: NovelFact, b: NovelFact): number =>
    at(a) - at(b) ||
    a.proposedAt.localeCompare(b.proposedAt) ||
    a.id.localeCompare(b.id);
  return {
    node,
    known: [...known.values()].sort((a, b) => order(a.fact, b.fact)),
    unknown: confirmed
      .filter((fact) => fact.kind !== "term" && !known.has(fact.id))
      .sort(order)
      .map((fact) => ({
        fact,
        reason: denied.has(fact.id) ? ("denied" as const) : ("default" as const),
      })),
  };
}
