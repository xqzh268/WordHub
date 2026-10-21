import { describe, expect, it } from "vitest";
import {
  applyIntakeAnswer,
  extractInitialAnswers,
  normalizeProtagonist,
  nextIntakeKey,
  type IntakeState,
} from "./intake.js";

const base = (): IntakeState => ({
  intakeId: "i",
  runId: "r",
  sourcePrompt: "",
  answers: {},
  confirmed: false,
});

describe("M4.1纲领问答", () => {
  it("从首句提取premise和主角并从第一个缺口继续", () => {
    const answers = extractInitialAnswers("写一部唐代悬疑短篇，主角是不良人");
    expect(answers.premise).toContain("唐代悬疑");
    expect(answers.protagonist).toBe("不良人");
    expect(nextIntakeKey({ answers, confirmed: false })).toBe("conflict");
  });

  it("L1必答，L2可跳过，完成后进入确认", () => {
    let state = base();
    state = applyIntakeAnswer(state, "premise", "一桩旧案");
    state = applyIntakeAnswer(state, "protagonist", "不良人");
    state = applyIntakeAnswer(state, "conflict", "真相与官府对抗");
    expect(nextIntakeKey(state)).toBe("world");
    for (const key of [
      "world",
      "viewpointTone",
      "theme",
      "audience",
      "chapterCount",
      "mustInclude",
      "forbidden",
    ] as const)
      state = applyIntakeAnswer(state, key, "");
    expect(nextIntakeKey(state)).toBe("confirm");
  });

  it("回到早期问题会清空后续答案", () => {
    let state = base();
    for (const [key, value] of [
      ["premise", "一桩旧案"],
      ["protagonist", "不良人"],
      ["conflict", "追凶"],
    ] as const)
      state = applyIntakeAnswer(state, key, value);
    state = applyIntakeAnswer(state, "protagonist", "女捕快");
    expect(state.answers.conflict).toBeUndefined();
    expect(nextIntakeKey(state)).toBe("conflict");
  });

  describe("首句主角提取", () => {
    const cases: Array<[string, string | undefined]> = [
      ["写一部唐代悬疑短篇，主角是不良人", "不良人"],
      // 回归：量词“个”不能留在人物档案里
      ["写一部唐代悬疑短篇，主角是个不良人裴照", "不良人裴照"],
      ["主角是一个失忆的剑客，写一部武侠", "失忆的剑客"],
      ["主角是一位年迈的盐商，写个故事", "年迈的盐商"],
      ["主角是一名女捕快，名叫苏晚", "女捕快"],
      ["写一部小说，主角叫裴照", "裴照"],
      ["写一部小说，主角名叫裴照。", "裴照"],
      ["写一部小说，主角名为裴照", "裴照"],
      ["写一部小说，主角的名字是裴照", "裴照"],
      ["写一部小说，主角：裴照", "裴照"],
      ["写一部小说，主角:裴照", "裴照"],
      ["写一部小说，主角为不良人裴照", "不良人裴照"],
      ["写一部小说，主人公是个落魄书生", "落魄书生"],
      ["写一部小说，男主是个镖师", "镖师"],
      ["写一部小说，女主是一名医女", "医女"],
      ["以裴照为主角写一部唐代悬疑小说", "裴照"],
      ["写一部小说，主角是个叫裴照的不良人", "裴照（不良人）"],
      ["写一部小说，主角是不良人的故事", "不良人"],
      ["写一部小说，主角 是 个 不良人", "不良人"],
      ["写一部唐代悬疑短篇", undefined],
    ];
    for (const [input, expected] of cases)
      it(`「${input}」→ ${expected ?? "（无）"}`, () => {
        expect(extractInitialAnswers(input).protagonist).toBe(expected);
      });

    it("premise 始终保留完整首句", () => {
      const text = "写一部唐代悬疑短篇，主角是个不良人裴照";
      expect(extractInitialAnswers(text).premise).toBe(text);
    });

    it("normalizeProtagonist 不会把以“名”开头的人名误删", () => {
      expect(normalizeProtagonist("名剑客")).toBe("剑客");
      expect(normalizeProtagonist("名")).toBe("名");
    });
  });
});
