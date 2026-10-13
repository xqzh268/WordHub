import { describe, expect, it } from "vitest";
import { hasPendingEscalation } from "./escalation.js";

const created = (threadId = "thread-1") => ({
  type: "escalation.created",
  runId: "workflow-1",
  payload: { threadId },
});
const resolved = (threadId = "thread-1") => ({
  type: "escalation.resolved",
  runId: "workflow-1",
  payload: { threadId, decision: "accept" },
});

describe("升级裁决时序", () => {
  it("裁决在暂停检查前到达时不再等待审批", () => {
    expect(hasPendingEscalation([resolved(), created()])).toBe(false);
  });

  it("暂停后尚未裁决时保持待决", () => {
    expect(hasPendingEscalation([created()])).toBe(true);
  });

  it("裁决在暂停后到达时解除待决", () => {
    expect(hasPendingEscalation([created(), resolved()])).toBe(false);
  });
});
