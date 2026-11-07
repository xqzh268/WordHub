import { describe, expect, it } from "vitest";
import { projectAliases, resolveName, wouldCycle } from "./aliases.js";
import type { Event } from "./domain.js";

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
const link = (id: string, alias: string, canonical: string, chapter?: string) =>
  event("alias.linked", {
    aliasId: id,
    alias,
    canonical,
    ...(chapter ? { chapter } : {}),
  });

describe("projectAliases", () => {
  it("建立、取消，并忽略残缺或自指的事件", () => {
    const links = projectAliases([
      link("a1", "黑衣人", "萧某", "chapters/第三章.md"),
      link("a2", "老王", "老王"),
      event("alias.linked", { aliasId: "a3", alias: "甲" }),
      link("a4", "阿福", "福伯"),
      event("alias.unlinked", { aliasId: "a4" }),
    ]);
    expect(links.map((item) => item.id)).toEqual(["a1"]);
    expect(links[0]).toMatchObject({
      alias: "黑衣人",
      canonical: "萧某",
      chapter: "chapters/第三章.md",
    });
  });

  it("同一别名重新设置时取代旧的", () => {
    const links = projectAliases([
      link("a1", "黑衣人", "萧某"),
      link("a2", "黑衣人", "周某", "chapters/第五章.md"),
    ]);
    expect(links.map((item) => item.id)).toEqual(["a2"]);
  });
});

describe("resolveName", () => {
  const position = new Map([
    ["chapters/第一章.md", 0],
    ["chapters/第三章.md", 1],
    ["chapters/第五章.md", 2],
  ]);
  const links = projectAliases([
    link("a1", "黑衣人", "萧某", "chapters/第三章.md"),
    link("a2", "萧某", "萧掌门", "chapters/第五章.md"),
    link("a3", "老王", "王掌柜"),
  ]);

  it("揭晓章节之前不合并，之后才合并；没有章节表示一直合并", () => {
    expect(resolveName("黑衣人", links, position, 0)).toBe("黑衣人");
    expect(resolveName("黑衣人", links, position, 1)).toBe("萧某");
    expect(resolveName("老王", links, position, 0)).toBe("王掌柜");
  });

  it("顺着别名链走到底", () => {
    expect(resolveName("黑衣人", links, position, 2)).toBe("萧掌门");
    expect(resolveName("萧某", links, position, 1)).toBe("萧某");
  });

  it("揭晓章节不在时间轴上时视为尚未揭晓", () => {
    const stray = projectAliases([link("a9", "甲", "乙", "chapters/没有.md")]);
    expect(resolveName("甲", stray, position, 2)).toBe("甲");
  });

  it("成环也不会死循环", () => {
    const loop = projectAliases([link("x", "甲", "乙"), link("y", "乙", "甲")]);
    expect(["甲", "乙"]).toContain(resolveName("甲", loop, position, 0));
  });
});

describe("wouldCycle", () => {
  const links = projectAliases([link("a1", "乙", "丙"), link("a2", "丙", "丁")]);
  it("发现会绕成圈的合并", () => {
    expect(wouldCycle("丁", "乙", links)).toBe(true);
    expect(wouldCycle("丁", "丁", links)).toBe(true);
    expect(wouldCycle("甲", "乙", links)).toBe(false);
  });
});
