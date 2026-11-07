import { chapterNumberFromName, compareChapters } from "./chapters.js";
import { type AliasLink, resolveName } from "./aliases.js";
import type { ChapterSummary, NovelFact } from "./facts.js";

/**
 * 关系图谱是事实的**投影**，不是另一份可手改的数据：
 * 节点来自人物状态与关系事实里出现的名字，边来自关系事实，
 * 出现时刻（revealed_at）就是事实所在章节在时间轴上的位置。
 * 只有“已确认”的事实算数；待确认的只在用户打开开关时以虚线淡色显示；已驳回的永远不进图。
 */

export type TimelineEntry = {
  chapter: string;
  /** 章节显示名（去掉目录与扩展名） */
  label: string;
  /** 0 起的位置 */
  index: number;
};

export type FactGraphNode = {
  id: string;
  label: string;
  /** 第一次出现的章节位置 */
  firstIndex: number;
  /** 所有支撑它的事实都还没确认 */
  pending: boolean;
  /** 截至当前时刻最近的一条人物状态 */
  state?: NovelFact;
  /** 截至当前时刻与它有关的事实，按章节先后（人名已按别名合并） */
  facts: NovelFact[];
  /** 截至当前时刻已并入它的别名（揭晓章节在所选章节之前或没有指明） */
  aliases: Array<{ name: string; linkId: string; chapter?: string }>;
};

export type FactGraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  /** 这条关系（当前形态）出现的章节位置 */
  index: number;
  pending: boolean;
  fact: NovelFact;
  /** 同一对人物之前的关系变化，按章节先后（含当前这条） */
  history: NovelFact[];
};

export type FactGraph = {
  nodes: FactGraphNode[];
  edges: FactGraphEdge[];
};

const baseName = (path: string): string =>
  (path.replaceAll("\\", "/").split("/").at(-1) ?? path).replace(
    /\.[^.]+$/u,
    "",
  );

/** 时间轴：所有出现过（未被驳回）事实或摘要的章节，按章号再按名称排好。 */
export function graphTimeline(
  facts: readonly NovelFact[],
  summaries: readonly ChapterSummary[] = [],
): TimelineEntry[] {
  const chapters = new Set<string>();
  for (const fact of facts) if (fact.status !== "rejected") chapters.add(fact.chapter);
  for (const summary of summaries) chapters.add(summary.chapter);
  return [...chapters]
    .map((chapter) => ({
      chapter,
      name: baseName(chapter),
      number: chapterNumberFromName(chapter),
    }))
    .sort(compareChapters)
    .map((item, index) => ({
      chapter: item.chapter,
      label: item.name,
      index,
    }));
}

export type ProjectOptions = {
  /** 显示到第几章（0 起、含该章）；默认到最后一章 */
  upToIndex?: number;
  /** 把待确认的也画出来（虚线淡色）；默认不画 */
  includeProposed?: boolean;
  /** 别名合并：到所选章节为止已揭晓的别名并入规范名 */
  aliases?: readonly AliasLink[];
};

/**
 * 按别名把事实里的人名换成规范名（返回副本，原事实不动）。
 * 同一个名字在不同章节可能指不同的人，所以按“到第 upTo 章为止”判断。
 */
export function resolveFactNames(
  facts: readonly NovelFact[],
  position: ReadonlyMap<string, number>,
  upTo: number,
  aliases: readonly AliasLink[] = [],
): NovelFact[] {
  if (aliases.length === 0) return [...facts];
  return facts.map((fact) => {
    const subject = resolveName(fact.subject, aliases, position, upTo);
    const object = fact.object
      ? resolveName(fact.object, aliases, position, upTo)
      : undefined;
    if (subject === fact.subject && object === fact.object) return fact;
    return { ...fact, subject, ...(object ? { object } : {}) };
  });
}

const pairKey = (a: string, b: string): string =>
  [a, b].sort((x, y) => x.localeCompare(y, "zh-CN")).join("\u0000");

export function projectGraph(
  facts: readonly NovelFact[],
  timeline: readonly TimelineEntry[],
  options: ProjectOptions = {},
): FactGraph {
  const position = new Map(timeline.map((entry) => [entry.chapter, entry.index]));
  const upTo = options.upToIndex ?? timeline.length - 1;
  const aliasLinks = options.aliases ?? [];
  const included = resolveFactNames(facts, position, upTo, aliasLinks)
    .filter(
      (fact) =>
        (fact.kind === "character_state" || fact.kind === "relation") &&
        (fact.status === "confirmed" ||
          (options.includeProposed === true && fact.status === "proposed")),
    )
    .filter((fact) => {
      const at = position.get(fact.chapter);
      return at !== undefined && at <= upTo;
    })
    .filter(
      (fact) =>
        fact.kind !== "relation" ||
        (Boolean(fact.object) &&
          Boolean(fact.relation) &&
          fact.object !== fact.subject),
    );
  const at = (fact: NovelFact): number => position.get(fact.chapter) ?? 0;
  const order = (a: NovelFact, b: NovelFact): number =>
    at(a) - at(b) ||
    a.proposedAt.localeCompare(b.proposedAt) ||
    a.id.localeCompare(b.id);

  const byNode = new Map<string, NovelFact[]>();
  const touch = (name: string, fact: NovelFact) => {
    const list = byNode.get(name) ?? [];
    list.push(fact);
    byNode.set(name, list);
  };
  for (const fact of included) {
    touch(fact.subject, fact);
    if (fact.kind === "relation" && fact.object) touch(fact.object, fact);
  }
  const nodes: FactGraphNode[] = [...byNode.entries()]
    .map(([name, list]) => {
      const sorted = [...list].sort(order);
      const states = sorted.filter(
        (fact) => fact.kind === "character_state" && fact.subject === name,
      );
      return {
        id: name,
        label: name,
        firstIndex: at(sorted[0] as NovelFact),
        pending: sorted.every((fact) => fact.status === "proposed"),
        state: states.at(-1),
        facts: sorted,
        aliases: [] as FactGraphNode["aliases"],
      };
    })
    .sort(
      (a, b) =>
        a.firstIndex - b.firstIndex || a.label.localeCompare(b.label, "zh-CN"),
    );

  // 已揭晓并入某个节点的别名（别名自己没有事实也照样显示）
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const link of aliasLinks) {
    if (link.chapter) {
      const revealed = position.get(link.chapter);
      if (revealed === undefined || revealed > upTo) continue;
    }
    const target = byId.get(resolveName(link.alias, aliasLinks, position, upTo));
    if (target && target.id !== link.alias)
      target.aliases.push({
        name: link.alias,
        linkId: link.id,
        ...(link.chapter ? { chapter: link.chapter } : {}),
      });
  }

  const groups = new Map<string, NovelFact[]>();
  for (const fact of included) {
    if (fact.kind !== "relation" || !fact.object) continue;
    const key = pairKey(fact.subject, fact.object);
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  const edges: FactGraphEdge[] = [...groups.entries()]
    .map(([key, list]) => {
      const history = [...list].sort(order);
      const latest = history.at(-1) as NovelFact;
      return {
        id: key,
        source: latest.subject,
        target: latest.object as string,
        label: latest.relation as string,
        index: at(latest),
        pending: latest.status === "proposed",
        fact: latest,
        history,
      };
    })
    .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id, "zh-CN"));
  return { nodes, edges };
}
