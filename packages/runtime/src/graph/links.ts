import {
  type Event,
  type NovelFact,
  graphTimeline,
  projectAliases,
  projectFacts,
  projectKnowledge,
  projectSummaries,
  resolveName,
  wouldCycle,
} from "@wordhub/contracts";
import type { WordHubStore } from "@wordhub/store";
import type { ProjectService } from "../projects/service.js";

/**
 * 别名合并与认知边的写入：只由作者（用户）通过界面发起，记为事件。
 * 这里负责校验——别名必须是图上真实存在的人物名，章节必须在时间轴上，合并不能成环。
 */

export type EventAnchor = { runId: string; sessionId: string };
export type LinkDeps = {
  projectService: ProjectService;
  /** 以用户身份追加一条事件；runId/sessionId 借用相关事实的来源运行 */
  append: (
    store: WordHubStore,
    projectId: string,
    anchor: EventAnchor,
    type: string,
    payload: Record<string, unknown>,
  ) => void;
};

export type AliasLinkRequest = {
  projectId: string;
  alias: string;
  canonical: string;
  /** 揭晓于哪一章（相对路径）；缺省 = 一直是同一人 */
  chapter?: string;
};
export type AliasUnlinkRequest = { projectId: string; aliasId: string };
export type KnowledgeSetRequest = {
  projectId: string;
  factId: string;
  character: string;
  mode: "knows" | "unaware";
  chapter?: string;
};
export type KnowledgeClearRequest = {
  projectId: string;
  factId: string;
  character: string;
};

/** 图上出现过的人物名（已确认的人物状态与关系里的名字，别名合并前的原始写法）。 */
export function graphNames(facts: readonly NovelFact[]): Set<string> {
  const names = new Set<string>();
  for (const fact of facts) {
    if (fact.status !== "confirmed") continue;
    if (fact.kind !== "character_state" && fact.kind !== "relation") continue;
    names.add(fact.subject);
    if (fact.object) names.add(fact.object);
  }
  return names;
}

export function createLinkService(deps: LinkDeps) {
  async function load(projectId: string) {
    const store = await deps.projectService.store(projectId);
    const events = store.listEvents(projectId);
    const facts = projectFacts(events);
    return {
      store,
      events,
      facts,
      aliases: projectAliases(events),
      timeline: graphTimeline(facts, projectSummaries(events)),
    };
  }
  /** 借用某个事实（或名字）来源的运行来挂事件，和 fact.decide 一样。 */
  const anchorFor = (
    events: readonly Event[],
    predicate: (payload: Record<string, unknown>) => boolean,
  ): EventAnchor => {
    const origin =
      events.find(
        (event) =>
          event.type === "fact.proposed" &&
          predicate((event.payload ?? {}) as Record<string, unknown>),
      ) ?? events.find((event) => event.type === "fact.proposed");
    if (!origin) throw new Error("还没有任何事实，无法记录");
    return { runId: origin.runId as string, sessionId: origin.sessionId };
  };
  const checkChapter = (
    chapter: string | undefined,
    timeline: ReturnType<typeof graphTimeline>,
  ) => {
    if (chapter && !timeline.some((entry) => entry.chapter === chapter))
      throw new Error("所选章节不在时间轴上");
  };

  async function aliasLink(
    request: AliasLinkRequest,
  ): Promise<{ aliasId: string }> {
    const alias = request.alias.trim();
    const canonical = request.canonical.trim();
    const { store, events, facts, aliases, timeline } = await load(
      request.projectId,
    );
    const names = graphNames(facts);
    if (!alias || !canonical) throw new Error("请选择要合并的两个人物");
    if (alias === canonical) throw new Error("不能把一个人物合并到他自己");
    if (!names.has(alias)) throw new Error(`图谱里没有人物「${alias}」`);
    if (!names.has(canonical))
      throw new Error(`图谱里没有人物「${canonical}」`);
    checkChapter(request.chapter, timeline);
    const existing = aliases.find((item) => item.alias === alias);
    if (existing)
      throw new Error(
        `「${alias}」已经设为「${existing.canonical}」的别名，请先取消再重新设置`,
      );
    if (wouldCycle(alias, canonical, aliases))
      throw new Error(
        `「${canonical}」已经是「${alias}」的别名，不能反过来合并`,
      );
    const aliasId = `alias_${Date.now().toString(36)}_${aliases.length}`;
    deps.append(
      store,
      request.projectId,
      anchorFor(events, (p) => p.subject === alias || p.object === alias),
      "alias.linked",
      {
        aliasId,
        alias,
        canonical,
        ...(request.chapter ? { chapter: request.chapter } : {}),
      },
    );
    return { aliasId };
  }

  async function aliasUnlink(
    request: AliasUnlinkRequest,
  ): Promise<{ aliasId: string }> {
    const { store, events, aliases } = await load(request.projectId);
    const link = aliases.find((item) => item.id === request.aliasId);
    if (!link) throw new Error("这条别名不存在或已经取消");
    deps.append(
      store,
      request.projectId,
      anchorFor(
        events,
        (p) => p.subject === link.alias || p.object === link.alias,
      ),
      "alias.unlinked",
      { aliasId: link.id },
    );
    return { aliasId: link.id };
  }

  /** 作者填的人物可以是别名；按最终时间轴解析成规范名后必须在图上。 */
  const checkCharacter = (
    character: string,
    facts: readonly NovelFact[],
    aliases: ReturnType<typeof projectAliases>,
    timeline: ReturnType<typeof graphTimeline>,
  ) => {
    const names = graphNames(facts);
    if (!names.has(character))
      throw new Error(`图谱里没有人物「${character}」`);
    const position = new Map(
      timeline.map((entry) => [entry.chapter, entry.index]),
    );
    return resolveName(character, aliases, position, timeline.length - 1);
  };

  async function knowledgeSet(
    request: KnowledgeSetRequest,
  ): Promise<{ factId: string }> {
    if (request.mode !== "knows" && request.mode !== "unaware")
      throw new Error("认知状态只能是“知道”或“不知道”");
    const { store, events, facts, aliases, timeline } = await load(
      request.projectId,
    );
    const fact = facts.find((item) => item.id === request.factId);
    if (fact?.status !== "confirmed")
      throw new Error("只能为已确认的事实设置谁知道");
    checkCharacter(request.character, facts, aliases, timeline);
    checkChapter(request.chapter, timeline);
    deps.append(
      store,
      request.projectId,
      anchorFor(events, (p) => p.factId === request.factId),
      "knowledge.set",
      {
        factId: request.factId,
        character: request.character,
        mode: request.mode,
        ...(request.mode === "knows" && request.chapter
          ? { chapter: request.chapter }
          : {}),
      },
    );
    return { factId: request.factId };
  }

  async function knowledgeClear(
    request: KnowledgeClearRequest,
  ): Promise<{ factId: string }> {
    const { store, events } = await load(request.projectId);
    const entry = projectKnowledge(events).find(
      (item) =>
        item.factId === request.factId && item.character === request.character,
    );
    if (!entry) throw new Error("没有可恢复的设置");
    deps.append(
      store,
      request.projectId,
      anchorFor(events, (p) => p.factId === request.factId),
      "knowledge.cleared",
      { factId: request.factId, character: request.character },
    );
    return { factId: request.factId };
  }

  return { aliasLink, aliasUnlink, knowledgeSet, knowledgeClear };
}
