import type { State } from "./store";
import type { ChatItem } from "./types";

type AgentItem = Extract<ChatItem, { kind: "agent" }>;

/** 事件处理函数能用到的 store 能力：读写状态，以及按会话 / 运行修改聊天条目。 */
export type Ctx = {
  set: (partial: Partial<State> | ((state: State) => Partial<State>)) => void;
  get: () => State;
  patchItems: (
    sessionId: string,
    update: (items: ChatItem[]) => ChatItem[],
  ) => void;
  patchRun: (runId: string, update: (item: AgentItem) => AgentItem) => void;
};
