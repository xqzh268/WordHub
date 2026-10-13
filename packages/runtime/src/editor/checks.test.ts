import { describe, expect, it } from "vitest";
import { DEFAULT_EDITOR_RULES, checkEditorText } from "./checks.js";

describe("编辑确定性检查", () => {
  it("统计字数并用显式上下限判定", () => {
    const result = checkEditorText("长安夜AB12。", {
      minWords: 8,
      maxWords: 10,
    });

    expect(result.metrics.wordCount).toBe(7);
    expect(result.violations.map((item) => item.code)).toEqual(["word-count"]);
    expect(result.violations[0]?.message).toContain("最低要求8");
  });

  it("检出AI腔词并报告每个词的出现次数", () => {
    const result = checkEditorText(
      "值得注意的是，夜色很深。值得注意的是，门已经关上。",
      {
        aiClicheWords: ["值得注意的是"],
      },
    );

    expect(result.metrics.aiClicheHits).toEqual([
      { term: "值得注意的是", count: 2 },
    ]);
    expect(result.violations.map((item) => item.code)).toEqual(["ai-cliche"]);
  });

  it("按引号内的文字计算对话占比", () => {
    const result = checkEditorText("“快走。”他说。门外风声很大。", {
      maxDialogueRatio: 0.1,
    });

    expect(result.metrics.dialogueCharacters).toBe(2);
    expect(result.metrics.dialogueRatio).toBeCloseTo(2 / 10, 5);
    expect(result.violations.map((item) => item.code)).toEqual([
      "dialogue-ratio",
    ]);
  });

  it("检出连续四字成语但不把普通四字短语当成成语", () => {
    const result = checkEditorText(
      "他不约而同，意味深长，若有所思地看向门外。风从窗缝吹入。",
      { maxConsecutiveFourCharIdioms: 2 },
    );

    expect(result.metrics.fourCharIdiomRuns).toEqual([
      ["不约而同", "意味深长", "若有所思"],
    ]);
    expect(result.violations.map((item) => item.code)).toEqual([
      "four-char-idiom",
    ]);
  });

  it("干净正文在默认规则下通过", () => {
    const result = checkEditorText(
      "裴照推门入院，先看见案上的灯，再听见屋后传来脚步。",
      {
        ...DEFAULT_EDITOR_RULES,
      },
    );

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.metrics.wordCount).toBeGreaterThan(0);
  });
});
