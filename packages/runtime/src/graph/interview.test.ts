import type {
  ChapterSummary,
  NovelFact,
  NovelFactStatus,
} from "@wordhub/contracts";
import { describe, expect, it } from "vitest";
import {
  InterviewError,
  buildInterviewContext,
  interviewPrompt,
  profileFor,
  readAnswer,
} from "./interview.js";

let n = 0;
const fact = (
  chapter: string,
  kind: NovelFact["kind"],
  subject: string,
  extra: Partial<NovelFact> = {},
  status: NovelFactStatus = "confirmed",
): NovelFact => ({
  id: `f${++n}`,
  kind,
  subject,
  statement: `${subject}的${kind}`,
  chapter: `chapters/${chapter}.md`,
  quote: `${subject}原文${n}`,
  status,
  proposedAt: `2026-11-04T00:00:${String(n).padStart(2, "0")}.000Z`,
  ...extra,
});
const relation = (
  chapter: string,
  a: string,
  b: string,
  rel: string,
  status: NovelFactStatus = "confirmed",
) => fact(chapter, "relation", a, { object: b, relation: rel }, status);

const facts = [
  relation("第一章", "裴照", "老周", "旧识"),
  fact("第一章", "character_state", "裴照", { statement: "裴照是不良人" }),
  fact("第三章", "character_state", "老周", { statement: "老周死亡" }),
  relation("第三章", "裴照", "苏晚", "同伴"),
  fact("第三章", "event", "质库", { statement: "裴照在质库发现了密信" }),
  fact("第三章", "event", "城门", { statement: "城门关闭" }),
  relation("第十章", "苏晚", "裴照", "仇敌"),
  relation("第十章", "裴照", "阿福", "主仆", "proposed"),
  fact("第二章", "term", "质库", { statement: "质库是放款铺" }),
];
const summaries: ChapterSummary[] = [
  { chapter: "chapters/第一章.md", text: "裴照认出老周。", at: "t" },
  { chapter: "chapters/第二章.md", text: "（裴照不在场的一章）", at: "t" },
  { chapter: "chapters/第三章.md", text: "老周死于质库后墙。", at: "t" },
];

const build = (chapter: string, node = "裴照", extra = {}) =>
  buildInterviewContext({
    projectName: "长安夜",
    facts,
    summaries,
    node,
    chapter: `chapters/${chapter}.md`,
    mode: "character",
    ...extra,
  });

describe("buildInterviewContext：知识边界", () => {
  it("只含不晚于所选章节、已确认的事实：后文和待确认的都进不来", () => {
    const ctx = build("第三章");
    expect(ctx.system).toContain("老周死亡");
    expect(ctx.system).toContain("同伴");
    expect(ctx.system).not.toContain("仇敌");
    expect(ctx.system).not.toContain("阿福");
    const early = build("第一章");
    expect(early.system).not.toContain("老周死亡");
    expect(early.system).not.toContain("苏晚");
  });

  it("身边人在他亲历的章节里的状态变化他也知道，不在场章节的不给", () => {
    expect(build("第三章").system).toContain("老周死亡");
    const withOffstage = [
      ...facts,
      fact("第二章", "character_state", "老周", {
        statement: "老周在别处受伤",
      }),
    ];
    const ctx = buildInterviewContext({
      projectName: "长安夜",
      facts: withOffstage,
      summaries,
      node: "裴照",
      chapter: "chapters/第三章.md",
      mode: "character",
    });
    expect(ctx.system).not.toContain("别处受伤");
  });

  it("与他有关的关键事件才给：别人的事件、术语都不给", () => {
    const ctx = build("第三章");
    expect(ctx.system).toContain("裴照在质库发现了密信");
    expect(ctx.system).not.toContain("城门关闭");
    expect(ctx.system).not.toContain("质库是放款铺");
  });

  it("章节摘要只给他亲历过（有他的事实）的章节", () => {
    const ctx = build("第三章");
    expect(ctx.system).toContain("裴照认出老周");
    expect(ctx.system).toContain("老周死于质库后墙");
    expect(ctx.system).not.toContain("不在场");
  });

  it("事实带编号，编号能回查到事实", () => {
    const ctx = build("第三章");
    expect(ctx.facts.size).toBeGreaterThanOrEqual(4);
    expect(ctx.facts.get("F1")?.chapter).toBe("chapters/第一章.md");
    expect(ctx.system).toContain("[F1]");
  });

  it("后文才出现的人物进入越界名单", () => {
    expect(build("第一章").hiddenNames.map((h) => h.name)).toContain("苏晚");
    expect(build("第十章").hiddenNames).toEqual([]);
  });

  it("人物或章节不存在时明确报错", () => {
    expect(() => build("第一章", "苏晚")).toThrow(InterviewError);
    expect(() => build("第一章", "苏晚")).toThrow(/还没有已确认的人物/u);
    expect(() => build("第七章")).toThrow(/不在时间轴/u);
    // 只有待确认事实的人物不能被采访
    expect(() => build("第十章", "阿福")).toThrow(InterviewError);
  });

  it("作者模式与采访模式的口吻规则不同，但同样带知识边界", () => {
    const author = build("第三章", "裴照", { mode: "author" });
    expect(author.system).toContain("创作助手");
    expect(author.system).toContain("依据仍然只能是下面给出的材料");
    expect(author.system).not.toContain("仇敌");
  });

  it("人物档案取 characters.md 里该人物的那一节，并提示不要主动透露", () => {
    const ctx = build("第三章", "裴照", {
      characters:
        "# 人物\n\n## 裴照\n- 身份：不良人\n- 口头禅：且慢\n\n## 老周\n- 掌柜\n",
      setting: "# 设定\n唐代长安。",
    });
    expect(ctx.system).toContain("口头禅：且慢");
    expect(ctx.system).not.toContain("掌柜");
    expect(ctx.system).toContain("不要主动透露");
    expect(ctx.system).toContain("唐代长安");
  });
});

describe("profileFor", () => {
  it("没有该人物或没有文件时返回空", () => {
    expect(profileFor(undefined, "裴照")).toBe("");
    expect(profileFor("## 老周\n- 掌柜", "裴照")).toBe("");
  });
});

describe("readAnswer", () => {
  const ctx = build("第一章");

  it("收集标注的依据，忽略重复与不存在的编号", () => {
    const result = readAnswer("我认得老周[F1]。他是个好人[F1][F99]。", ctx);
    expect(result.basis.map((b) => b.ref)).toEqual(["F1"]);
    expect(result.basis[0]?.quote).toContain("原文");
    expect(result.warnings.join()).toContain("F99");
  });

  it("提到后文才出现的人物给出越界警告", () => {
    const result = readAnswer("我和苏晚一起走的[F1]。", ctx);
    expect(result.warnings.join()).toContain("苏晚");
    expect(result.warnings.join()).toContain("第三章");
  });

  it("没有任何依据时提醒；老实说不知道则不提醒", () => {
    expect(readAnswer("天气不错。", ctx).warnings.join()).toContain("没有标注");
    expect(readAnswer("这件事我不知道。", ctx).warnings).toEqual([]);
  });
});

describe("interviewPrompt", () => {
  it("带上最近的对话与新问题", () => {
    const prompt = interviewPrompt(
      [
        { role: "user", text: "你怎么看老周？" },
        { role: "character", text: "旧识罢了[F1]。" },
      ],
      "那他后来呢？",
      "裴照",
    );
    expect(prompt).toContain("作者：你怎么看老周？");
    expect(prompt).toContain("裴照：旧识罢了");
    expect(prompt).toContain("作者现在问：那他后来呢？");
  });
  it("没有历史时只有问题", () => {
    expect(interviewPrompt([], "你好", "裴照")).toBe("作者现在问：你好");
  });
});
