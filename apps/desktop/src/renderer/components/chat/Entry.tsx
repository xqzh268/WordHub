import type { ChatItem } from "../../state/types";
import { ApprovalCard } from "./ApprovalCard";
import { AgentMessage, UserMessage } from "./Messages";
import { DraftCard, QuestionCard } from "./IntakeCards";
import { ThreadCard } from "./ThreadCard";

export function Entry({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return <UserMessage item={item} />;
    case "agent":
      return <AgentMessage item={item} />;
    case "thread":
      return <ThreadCard item={item} />;
    case "approval":
      return <ApprovalCard item={item} />;
    case "question":
      return <QuestionCard item={item} />;
    case "draft":
      return <DraftCard item={item} />;
    case "notice":
      return <p className={`notice ${item.tone ?? ""}`}>{item.text}</p>;
    case "task":
      return (
        <div className={`task-progress task-${item.status}`}>
          <span className="task-dot" aria-hidden="true" />
          <span className="task-name">{item.label}</span>
        </div>
      );
  }
}
