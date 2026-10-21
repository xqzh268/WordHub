import { describe, expect, it } from "vitest";
import { decide } from "./nightly-gate.mjs";

describe("夜间回归闸门：连续 2 晚失败才通知", () => {
  it("本次通过：不通知", () => {
    expect(
      decide({
        evalOutcome: "success",
        previous: { found: true, conclusion: "failure" },
      }).notify,
    ).toBe(false);
  });
  it("首次失败（没有上一次）：不通知", () => {
    expect(
      decide({ evalOutcome: "failure", previous: { found: false } }).notify,
    ).toBe(false);
  });
  it("首次失败（上一次通过）：不通知", () => {
    expect(
      decide({
        evalOutcome: "failure",
        previous: {
          found: true,
          conclusion: "success",
          artifactResult: "success",
        },
      }).notify,
    ).toBe(false);
  });
  it("连续失败（上一次被记录为评测失败，但任务以成功收尾）：通知", () => {
    expect(
      decide({
        evalOutcome: "failure",
        previous: {
          found: true,
          conclusion: "success",
          artifactResult: "failure",
        },
      }).notify,
    ).toBe(true);
  });
  it("上一次任务本身失败（例如构建坏了，没有留下构件）：通知", () => {
    expect(
      decide({
        evalOutcome: "failure",
        previous: { found: true, conclusion: "failure" },
      }).notify,
    ).toBe(true);
  });
  it("评测被取消或跳过：不当作失败", () => {
    expect(
      decide({
        evalOutcome: "cancelled",
        previous: { found: true, conclusion: "failure" },
      }).notify,
    ).toBe(false);
    expect(
      decide({
        evalOutcome: "skipped",
        previous: { found: true, conclusion: "failure" },
      }).notify,
    ).toBe(false);
  });
});
