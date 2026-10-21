import { describe, expect, it } from "vitest";
import type { Event } from "./domain.js";
import { projectFacts, projectFinalized, projectSummaries } from "./facts.js";

let seq = 0;
const event = (
  type: string,
  payload: Record<string, unknown>,
  runId = "run1",
): Event =>
  ({
    schemaVersion: 1,
    id: `e${++seq}`,
    projectId: "p",
    sessionId: "s",
    runId,
    seq,
    type,
    actor: { type: "agent", id: "observer" },
    occurredAt: `2026-10-22T00:00:${String(seq).padStart(2, "0")}.000Z`,
    payload,
  }) as Event;

const proposed = (id: string, extra: Record<string, unknown> = {}) =>
  event("fact.proposed", {
    factId: id,
    kind: "character_state",
    subject: "老周",
    statement: "老周在质库后墙被杀",
    chapter: "chapters/第五章.md",
    quote: "老周倒在质库后墙下",
    ...extra,
  });

describe("projectFacts", () => {
  it("新提出的事实是待确认状态，保留锚点与出处", () => {
    const [fact] = projectFacts([proposed("f1")]);
    expect(fact).toMatchObject({
      id: "f1",
      status: "proposed",
      kind: "character_state",
      chapter: "chapters/第五章.md",
      quote: "老周倒在质库后墙下",
    });
  });

  it("确认与驳回按最后一次决定为准", () => {
    const events = [
      proposed("f1"),
      proposed("f2", { subject: "刘伯", statement: "刘伯是坊正" }),
      event("fact.confirmed", { factId: "f1" }),
      event("fact.rejected", { factId: "f2" }),
      event("fact.rejected", { factId: "f1" }),
      event("fact.confirmed", { factId: "f1" }),
    ];
    const facts = projectFacts(events);
    expect(facts.map((f) => [f.id, f.status])).toEqual([
      ["f1", "confirmed"],
      ["f2", "rejected"],
    ]);
    expect(facts[0]?.decidedAt).toBeTruthy();
  });

  it("缺字段、未知类别的事实被忽略；对不存在事实的决定被忽略", () => {
    const facts = projectFacts([
      proposed("bad1", { kind: "weird" }),
      proposed("bad2", { quote: "" }),
      event("fact.confirmed", { factId: "ghost" }),
      proposed("ok"),
    ]);
    expect(facts.map((f) => f.id)).toEqual(["ok"]);
  });

  it("按事件顺序而不是输入顺序投影", () => {
    const a = proposed("f1");
    const b = event("fact.confirmed", { factId: "f1" });
    expect(projectFacts([b, a])[0]?.status).toBe("confirmed");
  });
});

describe("projectSummaries / projectFinalized", () => {
  it("每章只保留最新一份摘要", () => {
    const list = projectSummaries([
      event("chapter.summary", { chapter: "chapters/第一章.md", text: "旧" }),
      event("chapter.summary", { chapter: "chapters/第一章.md", text: "新" }),
      event("chapter.summary", { chapter: "chapters/第二章.md", text: "二" }),
      event("chapter.summary", { chapter: "", text: "x" }),
    ]);
    expect(list.map((x) => [x.chapter, x.text])).toEqual([
      ["chapters/第一章.md", "新"],
      ["chapters/第二章.md", "二"],
    ]);
  });

  it("定稿过的章节集合", () => {
    const set = projectFinalized([
      event("chapter.finalized", { chapter: "chapters/第一章.md" }),
      event("chapter.finalized", { chapter: "chapters/第二章.md" }),
      event("chapter.finalized", {}),
    ]);
    expect([...set]).toEqual(["chapters/第一章.md", "chapters/第二章.md"]);
  });
});
