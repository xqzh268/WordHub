import { describe, expect, it } from "vitest";
import { replyToChallenge } from "./challenge.js";

describe("质询协议", () => {
  it("最多两轮，仍反驳则升级裁决", () => {
    const first = {
      threadId: "t",
      round: 1,
      maxRounds: 2 as const,
      status: "open" as const,
    };
    const second = replyToChallenge(first, "refute");
    expect(second.round).toBe(2);
    expect(replyToChallenge(second, "partial").status).toBe("escalated");
  });
  it("接受质询直接解决，不生成升级", () => {
    expect(
      replyToChallenge(
        { threadId: "t", round: 2, maxRounds: 2, status: "open" },
        "accept",
      ).status,
    ).toBe("resolved");
  });
});
