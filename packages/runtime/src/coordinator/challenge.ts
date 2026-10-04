export type ChallengeDisposition = "accept" | "refute" | "partial";
export type ChallengeState = {
  threadId: string;
  round: number;
  maxRounds: 2;
  status: "open" | "escalated" | "resolved";
};

/** 质询协议的纯状态转移；第3次仍未接受时只能升级给用户。 */
export function replyToChallenge(
  state: ChallengeState,
  disposition: ChallengeDisposition,
): ChallengeState {
  if (state.status !== "open") return state;
  if (disposition === "accept") return { ...state, status: "resolved" };
  if (state.round >= state.maxRounds) return { ...state, status: "escalated" };
  return { ...state, round: state.round + 1 };
}
