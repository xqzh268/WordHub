import { describe, expect, it } from "vitest";
import type { NovelFact, NovelFactStatus } from "./facts.js";
import { graphTimeline, projectGraph } from "./graph.js";

let n = 0;
const fact = (
  chapter: string,
  extra: Partial<NovelFact> & Pick<NovelFact, "subject" | "kind">,
  status: NovelFactStatus = "confirmed",
): NovelFact => ({
  id: `f${++n}`,
  statement: "陈述",
  quote: "原文",
  chapter: `chapters/${chapter}.md`,
  status,
  proposedAt: `2026-11-04T00:00:${String(n).padStart(2, "0")}.000Z`,
  ...extra,
});
const relation = (
  chapter: string,
  subject: string,
  object: string,
  rel: string,
  status: NovelFactStatus = "confirmed",
) =>
  fact(chapter, { kind: "relation", subject, object, relation: rel }, status);

const facts = [
  relation("第一章", "裴照", "老周", "旧识"),
  fact("第一章", { kind: "character_state", subject: "裴照", statement: "裴照是不良人" }),
  relation("第三章", "裴照", "苏晚", "同伴"),
  fact("第三章", { kind: "character_state", subject: "老周", statement: "老周死亡" }),
  relation("第十章", "苏晚", "裴照", "仇敌"),
  relation("第十章", "裴照", "阿福", "主仆", "proposed"),
  relation("第二章", "裴照", "路人", "路过", "rejected"),
  fact("第二章", { kind: "term", subject: "质库" }),
];

describe("graphTimeline", () => {
  it("按章号（不是字典序）排序，并排除只有被驳回事实的章节", () => {
    const timeline = graphTimeline(facts);
    expect(timeline.map((entry) => entry.label)).toEqual([
      "第一章",
      "第二章",
      "第三章",
      "第十章",
    ]);
    // 第二章因为有一条 term 事实而存在；被驳回的不单独撑起章节
    expect(
      graphTimeline([relation("第二章", "甲", "乙", "友", "rejected")]),
    ).toEqual([]);
  });

  it("摘要也算章节", () => {
    const timeline = graphTimeline([], [
      { chapter: "chapters/第四章.md", text: "x", at: "t" },
    ]);
    expect(timeline).toHaveLength(1);
  });
});

describe("projectGraph", () => {
  const timeline = graphTimeline(facts);

  it("只画已确认的：待确认默认不出现，已驳回永远不出现", () => {
    const graph = projectGraph(facts, timeline);
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(
      ["苏晚", "老周", "裴照"].sort(),
    );
    expect(graph.nodes.some((node) => node.id === "阿福")).toBe(false);
    expect(graph.nodes.some((node) => node.id === "路人")).toBe(false);
    expect(
      projectGraph(facts, timeline, { includeProposed: true }).nodes.map(
        (node) => node.id,
      ),
    ).toContain("阿福");
    expect(
      projectGraph(facts, timeline, { includeProposed: true }).nodes.some(
        (node) => node.id === "路人",
      ),
    ).toBe(false);
  });

  it("待确认的节点与边带 pending 标记", () => {
    const graph = projectGraph(facts, timeline, { includeProposed: true });
    expect(graph.nodes.find((node) => node.id === "阿福")?.pending).toBe(true);
    expect(graph.nodes.find((node) => node.id === "裴照")?.pending).toBe(false);
    expect(
      graph.edges.find((edge) => edge.target === "阿福")?.pending,
    ).toBe(true);
  });

  it("时间滑块：拖到更早章节时，后来才揭示的人物和关系消失", () => {
    const early = projectGraph(facts, timeline, { upToIndex: 0 });
    expect(early.nodes.map((node) => node.id).sort()).toEqual(
      ["老周", "裴照"].sort(),
    );
    expect(early.edges).toHaveLength(1);
    const mid = projectGraph(facts, timeline, { upToIndex: 2 });
    expect(mid.nodes.map((node) => node.id)).toContain("苏晚");
    expect(mid.nodes.find((node) => node.id === "老周")?.state?.statement).toBe(
      "老周死亡",
    );
    const beforeDeath = projectGraph(facts, timeline, { upToIndex: 1 });
    expect(beforeDeath.nodes.find((node) => node.id === "老周")?.state).toBeUndefined();
  });

  it("同一对人物的关系变化：当前显示最新的，历史按章节保留", () => {
    const late = projectGraph(facts, timeline);
    const edge = late.edges.find(
      (item) => item.id.includes("苏晚") && item.id.includes("裴照"),
    );
    expect(edge?.label).toBe("仇敌");
    expect(edge?.source).toBe("苏晚");
    expect(edge?.history.map((item) => item.relation)).toEqual([
      "同伴",
      "仇敌",
    ]);
    const earlier = projectGraph(facts, timeline, { upToIndex: 2 });
    expect(
      earlier.edges.find((item) => item.id.includes("苏晚"))?.label,
    ).toBe("同伴");
  });

  it("节点详情的事实只含截至当前时刻的，并按章节先后", () => {
    const graph = projectGraph(facts, timeline, { upToIndex: 2 });
    const node = graph.nodes.find((item) => item.id === "裴照");
    expect(node?.facts.map((item) => item.chapter)).toEqual([
      "chapters/第一章.md",
      "chapters/第一章.md",
      "chapters/第三章.md",
    ]);
  });

  it("自指的关系和缺字段的关系被忽略", () => {
    const bad = [
      relation("第一章", "甲", "甲", "自己"),
      fact("第一章", { kind: "relation", subject: "甲" }),
    ];
    const graph = projectGraph(bad, graphTimeline(bad));
    expect(graph.edges).toEqual([]);
    expect(graph.nodes).toEqual([]);
  });

  it("没有任何事实时是空图", () => {
    expect(projectGraph([], [])).toEqual({ nodes: [], edges: [] });
  });
});

describe("projectGraph：别名合并", () => {
  const al = (alias: string, canonical: string, chapter?: string) => ({
    id: `a${alias}`,
    alias,
    canonical,
    ...(chapter ? { chapter } : {}),
    at: "t",
  });
  const fs = [
    fact("第一章", { kind: "character_state", subject: "黑衣人", statement: "黑衣人夜袭" }),
    relation("第二章", "黑衣人", "老周", "指使"),
    relation("第三章", "萧某", "裴照", "师徒"),
    fact("第三章", { kind: "character_state", subject: "萧某", statement: "萧某受伤" }),
    relation("第三章", "裴照", "老周", "旧识"),
  ];
  const tl = graphTimeline(fs);
  const aliases = [al("黑衣人", "萧某", "chapters/第三章.md")];

  it("揭晓之前是两个人物，揭晓那一章起合成一个，关系与状态并到规范名下", () => {
    const early = projectGraph(fs, tl, { upToIndex: 1, aliases });
    expect(early.nodes.map((node) => node.id).sort()).toEqual(["老周", "黑衣人"].sort());
    const late = projectGraph(fs, tl, { upToIndex: 2, aliases });
    expect(late.nodes.map((node) => node.id).sort()).toEqual(["萧某", "裴照", "老周"].sort());
    const xiao = late.nodes.find((node) => node.id === "萧某");
    expect(xiao?.aliases.map((a) => a.name)).toEqual(["黑衣人"]);
    expect(xiao?.facts.map((f) => f.statement)).toContain("黑衣人夜袭");
    expect(xiao?.firstIndex).toBe(0);
    expect(late.edges.length).toBe(3);
    expect(late.edges.some((e) => e.source === "萧某" && e.target === "老周")).toBe(true);
  });

  it("没有指明章节就一直是同一个人", () => {
    const always = projectGraph(fs, tl, { upToIndex: 0, aliases: [al("黑衣人", "萧某")] });
    expect(always.nodes.map((node) => node.id)).toEqual(["萧某"]);
  });

  it("别名与规范名之间的关系合并后消失（不画自己指向自己）", () => {
    const extra = [...fs, relation("第三章", "黑衣人", "萧某", "同一人")];
    const graph = projectGraph(extra, graphTimeline(extra), { aliases });
    expect(graph.edges.some((e) => e.source === e.target)).toBe(false);
    expect(graph.edges.length).toBe(3);
  });

  it("原始事实不被改动", () => {
    const before = JSON.stringify(fs);
    projectGraph(fs, tl, { aliases });
    expect(JSON.stringify(fs)).toBe(before);
  });
});
