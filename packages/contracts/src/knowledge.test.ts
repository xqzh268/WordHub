import { describe, expect, it } from "vitest";
import { projectAliases } from "./aliases.js";
import type { Event } from "./domain.js";
import type { NovelFact, NovelFactStatus } from "./facts.js";
import { graphTimeline } from "./graph.js";
import { characterKnowledge, projectKnowledge } from "./knowledge.js";

let seq = 0;
const event = (type: string, payload: Record<string, unknown>): Event =>
  ({
    schemaVersion: 1,
    id: `e${++seq}`,
    projectId: "p",
    sessionId: "s",
    runId: "r",
    seq,
    type,
    actor: { type: "user", id: "user" },
    occurredAt: `2026-11-08T00:00:${String(seq).padStart(2, "0")}.000Z`,
    payload,
  }) as Event;

let n = 0;
const fact = (
  id: string,
  chapter: string,
  kind: NovelFact["kind"],
  subject: string,
  extra: Partial<NovelFact> = {},
  status: NovelFactStatus = "confirmed",
): NovelFact => ({
  id,
  kind,
  subject,
  statement: `${subject}的${kind}`,
  chapter: `chapters/${chapter}.md`,
  quote: `${id}原文`,
  status,
  proposedAt: `2026-11-08T00:00:${String(++n).padStart(2, "0")}.000Z`,
  ...extra,
});

describe("projectKnowledge", () => {
  it("设定、覆盖、恢复默认；残缺的事件被忽略", () => {
    const entries = projectKnowledge([
      event("knowledge.set", {
        factId: "f1",
        character: "裴照",
        mode: "knows",
        chapter: "chapters/第三章.md",
      }),
      event("knowledge.set", { factId: "f2", character: "裴照", mode: "unaware" }),
      event("knowledge.set", { factId: "f2", character: "裴照", mode: "knows" }),
      event("knowledge.set", { factId: "f3", character: "裴照", mode: "乱写" }),
      event("knowledge.set", { factId: "f4", mode: "knows" }),
      event("knowledge.set", { factId: "f5", character: "裴照", mode: "unaware" }),
      event("knowledge.cleared", { factId: "f5", character: "裴照" }),
    ]);
    expect(entries.map((e) => `${e.factId}:${e.mode}`).sort()).toEqual([
      "f1:knows",
      "f2:knows",
    ]);
    expect(entries.find((e) => e.factId === "f1")?.chapter).toBe(
      "chapters/第三章.md",
    );
  });

  it("unaware 不带章节", () => {
    const [entry] = projectKnowledge([
      event("knowledge.set", {
        factId: "f1",
        character: "甲",
        mode: "unaware",
        chapter: "chapters/第一章.md",
      }),
    ]);
    expect(entry?.chapter).toBeUndefined();
  });
});

describe("characterKnowledge", () => {
  const facts = [
    fact("s1", "第一章", "character_state", "裴照", { statement: "裴照是不良人" }),
    fact("r1", "第一章", "relation", "裴照", { object: "老周", relation: "旧识" }),
    fact("s2", "第一章", "character_state", "老周", { statement: "老周当上掌柜" }),
    fact("e1", "第二章", "event", "老周", { statement: "老周暗中替黑衣人传信" }),
    fact("e2", "第二章", "event", "质库", { statement: "裴照在质库发现了脚印" }),
    fact("t1", "第二章", "term", "质库", { statement: "质库是放款铺" }),
    fact("s3", "第三章", "character_state", "老周", { statement: "老周被捕" }),
    fact(
      "p1",
      "第三章",
      "character_state",
      "老周",
      { statement: "待确认的事" },
      "proposed",
    ),
  ];
  const timeline = graphTimeline(facts);
  // 返回值一定存在（裴照在图上）；测试里统一断言
  const know = (extra = {}, upTo = 2) => {
    const result = characterKnowledge({
      node: "裴照",
      facts,
      timeline,
      upToIndex: upTo,
      ...extra,
    });
    if (!result) throw new Error("裴照应在图上");
    return result;
  };

  it("默认：本人的状态与关系、在场的事件、身边人在他亲历章节里的变化（他不在场的第三章，老周被捕他不知道）", () => {
    const k = know();
    expect(k.known.map((item) => item.fact.id)).toEqual(["s1", "r1", "s2", "e2"]);
    expect(k.known.every((item) => item.source === "default")).toBe(true);
  });

  it("读者已知但他不知道的列在 unknown（不含名词解释、待确认、更晚的章节）", () => {
    const k = know();
    expect(k.unknown.map((item) => item.fact.id)).toEqual(["e1", "s3"]);
    expect(k.unknown[0]?.reason).toBe("default");
    expect(know({}, 0).unknown).toEqual([]);
  });

  it("作者指定他知道：到了起知章节才算；没写章节则从事实发生的章节起", () => {
    const entries = projectKnowledge([
      event("knowledge.set", {
        factId: "e1",
        character: "裴照",
        mode: "knows",
        chapter: "chapters/第三章.md",
      }),
    ]);
    expect(know({ entries }, 1).known.some((i) => i.fact.id === "e1")).toBe(false);
    const later = know({ entries }, 2);
    const granted = later.known.find((i) => i.fact.id === "e1");
    expect(granted?.source).toBe("granted");
    expect(granted?.since).toBe("chapters/第三章.md");
    expect(later.unknown.some((i) => i.fact.id === "e1")).toBe(false);

    const noChapter = projectKnowledge([
      event("knowledge.set", { factId: "e1", character: "裴照", mode: "knows" }),
    ]);
    expect(
      know({ entries: noChapter }, 1).known.some((i) => i.fact.id === "e1"),
    ).toBe(true);
  });

  it("作者指定他不知道：从默认里去掉，列入 unknown 并标 denied", () => {
    const entries = projectKnowledge([
      event("knowledge.set", { factId: "e2", character: "裴照", mode: "unaware" }),
    ]);
    const k = know({ entries });
    expect(k.known.some((i) => i.fact.id === "e2")).toBe(false);
    expect(k.unknown.find((i) => i.fact.id === "e2")?.reason).toBe("denied");
  });

  it("别人的认知边、不存在的事实、未确认的事实都不影响他", () => {
    const entries = projectKnowledge([
      event("knowledge.set", { factId: "e1", character: "老周", mode: "knows" }),
      event("knowledge.set", { factId: "不存在", character: "裴照", mode: "knows" }),
      event("knowledge.set", { factId: "p1", character: "裴照", mode: "knows" }),
    ]);
    const k = know({ entries }, 2);
    expect(k.known.map((i) => i.fact.id)).not.toContain("e1");
    expect(k.known.map((i) => i.fact.id)).not.toContain("p1");
  });

  it("人物不在图上时返回 undefined", () => {
    expect(
      characterKnowledge({ node: "无名氏", facts, timeline, upToIndex: 2 }),
    ).toBeUndefined();
  });

  it("别名合并后：别名名下的事实也算他的；作者按别名填的认知边也生效", () => {
    const withAlias = [
      ...facts,
      fact("b1", "第一章", "character_state", "黑衣人", { statement: "黑衣人夜袭质库" }),
      fact("b2", "第二章", "event", "裴照", { statement: "黑衣人在质库留下暗号" }),
    ];
    const tl = graphTimeline(withAlias);
    const aliases = projectAliases([
      event("alias.linked", {
        aliasId: "a1",
        alias: "黑衣人",
        canonical: "裴照",
        chapter: "chapters/第二章.md",
      }),
    ]);
    const run = (upTo: number, entries = projectKnowledge([])) =>
      characterKnowledge({
        node: "裴照",
        facts: withAlias,
        timeline: tl,
        upToIndex: upTo,
        aliases,
        entries,
      });
    expect(run(0)?.known.some((i) => i.fact.id === "b1")).toBe(false);
    const after = run(1);
    expect(after?.node.aliases.map((a) => a.name)).toEqual(["黑衣人"]);
    expect(after?.known.some((i) => i.fact.id === "b1")).toBe(true);
    expect(after?.known.some((i) => i.fact.id === "b2")).toBe(true);
    const entries = projectKnowledge([
      event("knowledge.set", { factId: "b2", character: "黑衣人", mode: "unaware" }),
    ]);
    expect(run(1, entries)?.known.some((i) => i.fact.id === "b2")).toBe(false);
  });
});
