import { describe, expect, it } from "vitest";
import {
  applyIntakeAnswer,
  extractInitialAnswers,
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
});
