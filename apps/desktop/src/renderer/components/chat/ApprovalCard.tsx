import { Check, CircleAlert } from "lucide-react";
import { useWorkbench } from "../../state/store";
import type { ChatItem } from "../../state/types";

type ApprovalItem = Extract<ChatItem, { kind: "approval" }>;

export function ApprovalCard({ item }: { item: ApprovalItem }) {
  const resolve = useWorkbench((s) => s.resolveApproval);
  return (
    <>
      <span className="approval-mark" aria-hidden="true">
        <CircleAlert size={16} strokeWidth={1.75} />
      </span>
      <div
        className={`approval ${item.resolved ? "resolved" : ""}`}
        role="group"
        aria-label={item.title}
      >
        <h3>{item.title}</h3>
        <p>{item.body}</p>
        {item.path && (
          <p className="approval-path">
            路径：<code>{item.path}</code>
            {typeof item.contentLength === "number" &&
              ` · ${item.contentLength}字`}
            {item.diff &&
              ` · 差异 +${item.diff.addedLines}/-${item.diff.removedLines}行`}
          </p>
        )}
        {item.preview && <pre className="approval-preview">{item.preview}</pre>}
        {item.resolved?.includes("过期") ? (
          <div className="approval-actions">
            <span className="approval-done">审批已过期</span>
            <button
              className="btn btn-primary"
              onClick={() => resolve(item.id, "重新发起")}
            >
              重新发起
            </button>
          </div>
        ) : item.resolved ? (
          <p className="approval-done">
            <Check size={14} strokeWidth={2} aria-hidden="true" />
            已裁决：{item.resolved}
          </p>
        ) : (
          <div className="approval-actions">
            {item.options.map((option, index) => (
              <button
                key={option}
                className={index === 0 ? "btn btn-primary" : "btn"}
                onClick={() => resolve(item.id, option)}
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
