import { describe, expect, it } from "vitest";
import {
  SIM_LIMITS,
  SimulationError,
  checkSimulationInput,
  estimateSimulation,
  parseStep,
  publicLogLines,
  reportPrompt,
  stepPrompt,
} from "./simulate.js";

describe("checkSimulationInput", () => {
  const ok = { participants: ["甲", "乙"], rounds: 3 };
  it("合法输入通过", () => {
    expect(() => checkSimulationInput(ok)).not.toThrow();
  });
  it("人物数、轮数、重复、设定长度都有上限", () => {
    expect(() => checkSimulationInput({ ...ok, participants: ["甲"] })).toThrow(
      SimulationError,
    );
    expect(() =>
      checkSimulationInput({
        ...ok,
        participants: ["甲", "乙", "丙", "丁", "戊", "己", "庚"],
      }),
    ).toThrow(/人物/u);
    expect(() =>
      checkSimulationInput({ ...ok, participants: ["甲", "甲"] }),
    ).toThrow(/重复/u);
    expect(() => checkSimulationInput({ ...ok, rounds: 0 })).toThrow(/轮数/u);
    expect(() =>
      checkSimulationInput({ ...ok, rounds: SIM_LIMITS.maxRounds + 1 }),
    ).toThrow(/轮数/u);
    expect(() => checkSimulationInput({ ...ok, rounds: 1.5 })).toThrow(/轮数/u);
    expect(() =>
      checkSimulationInput({
        ...ok,
        premise: "假".repeat(SIM_LIMITS.maxPremise + 1),
      }),
    ).toThrow(/最多/u);
  });
});

describe("parseStep", () => {
  it("拆出【行动】与【心思】", () => {
    expect(parseStep("【行动】拔刀。\n【心思】不能让他走。")).toEqual({
      action: "拔刀。",
      intent: "不能让他走。",
    });
  });
  it("没按格式写时整段当作行动；只有心思没有行动时不把心思当行动", () => {
    expect(parseStep("他沉默地走开了。")).toEqual({
      action: "他沉默地走开了。",
    });
    expect(parseStep("【心思】想逃").action).toBe("");
  });
  it("过长的内容被截断", () => {
    expect(parseStep(`【行动】${"字".repeat(2000)}`).action.length).toBe(
      SIM_LIMITS.maxActionChars,
    );
  });
});

describe("公开记录只含行动，不含心思", () => {
  const log = [
    { round: 1, name: "甲", action: "说了一句话", intent: "其实在撒谎" },
    { round: 1, name: "乙", action: "沉默" },
  ];
  it("publicLogLines", () => {
    const lines = publicLogLines(log);
    expect(lines).toEqual(["第1轮 · 甲：说了一句话", "第1轮 · 乙：沉默"]);
    expect(lines.join()).not.toContain("撒谎");
  });
  it("报告的输入才带心思，并标明仅本人知道", () => {
    const prompt = reportPrompt({
      chapterLabel: "第三章",
      participants: ["甲", "乙"],
      log,
      knownFacts: ["- 事实一"],
    });
    expect(prompt).toContain("其实在撒谎");
    expect(prompt).toContain("仅本人知道");
    expect(prompt).toContain("没有额外设定");
  });
  it("轮到谁的提示", () => {
    expect(stepPrompt(2, 3, "甲")).toContain("第 2/3 轮");
  });
});

describe("estimateSimulation", () => {
  it("调用次数 = 轮数 × 人数 + 1 份报告，token 随轮数增长", () => {
    const small = estimateSimulation({ contextChars: [2000, 2000], rounds: 1 });
    const big = estimateSimulation({ contextChars: [2000, 2000], rounds: 4 });
    expect(small.calls).toBe(3);
    expect(big.calls).toBe(9);
    expect(big.inputTokens).toBeGreaterThan(small.inputTokens * 3);
    expect(big.outputTokens).toBeGreaterThan(small.outputTokens);
  });
});
