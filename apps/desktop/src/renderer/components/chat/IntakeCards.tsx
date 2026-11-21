import { useEffect, useState } from "react";
import { useWorkbench } from "../../state/store";
import type { ChatItem } from "../../state/types";

type QuestionItem = Extract<ChatItem, { kind: "question" }>;

export function DraftCard({
  item,
}: {
  item: Extract<ChatItem, { kind: "draft" }>;
}) {
  return (
    <>
      <span className="approval-mark" aria-hidden="true">
        稿
      </span>
      <div className="approval draft-card" data-testid="draft-card">
        <h3>
          纲领草稿
          {item.status === "ready" &&
            (item.source === "model" ? " · 模型生成" : " · 问答整理")}
        </h3>
        {item.status === "generating" ? (
          <p className="draft-wait">
            正在根据你的回答生成大纲、人物档案、设定词典和文风基准，通常需要两三分钟……
          </p>
        ) : (
          <>
            {item.error && (
              <p className="draft-warn">
                {item.source === "template"
                  ? `模型没能生成草稿（${item.error}），下面是按你的回答直接整理的基础版本。`
                  : item.error}
              </p>
            )}
            <p className="draft-hint">
              这些文档确认后才会写入项目设定集（.wordhub/bible/）。标注“（建议）”的是模型替你补全的部分。
            </p>
            {item.documents.map((doc, index) => (
              <details
                key={doc.file}
                className="draft-doc"
                open={index === 0}
                data-testid="draft-doc"
              >
                <summary>{doc.title}</summary>
                <pre>{doc.content}</pre>
              </details>
            ))}
          </>
        )}
      </div>
    </>
  );
}

export function QuestionCard({ item }: { item: QuestionItem }) {
  const answer = useWorkbench((s) => s.answerQuestion);
  const drafting = useWorkbench((s) =>
    s.sessions.some((session) =>
      session.items.some(
        (entry) =>
          entry.kind === "draft" &&
          entry.intakeId === item.intakeId &&
          entry.status === "generating",
      ),
    ),
  );
  const confirm = useWorkbench((s) => s.confirmIntake);
  const [value, setValue] = useState(item.value ?? "");
  const [editing, setEditing] = useState(!item.resolved);
  useEffect(() => {
    setValue(item.value ?? "");
    setEditing(!item.resolved);
  }, [item.value, item.resolved]);
  const submit = (next: string) => {
    if (item.key === "confirm" && next === "确认并写入") void confirm(item);
    else if (next === "继续修改") setEditing(true);
    else void answer(item, next);
  };
  return (
    <>
      <span className="approval-mark" aria-hidden="true">
        问
      </span>
      <div
        className={`approval question-card ${item.resolved && !editing ? "resolved" : ""}`}
      >
        <h3>{item.level === 1 ? "纲领 · 必答" : "纲领 · 可选"}</h3>
        <p>{item.prompt}</p>
        {item.resolved && !editing ? (
          <div className="approval-actions">
            <p className="question-answer">{item.value || "已跳过"}</p>
            <button className="btn" onClick={() => setEditing(true)}>
              修改
            </button>
          </div>
        ) : item.key === "confirm" ? (
          <div className="approval-actions">
            {item.options.map((option, index) => (
              <button
                key={option}
                className={index === 0 ? "btn btn-primary" : "btn"}
                disabled={drafting && option !== "继续修改"}
                onClick={() => submit(option)}
              >
                {option}
              </button>
            ))}
          </div>
        ) : (
          <>
            <textarea
              className="question-input"
              value={value}
              rows={2}
              placeholder={
                item.required ? "请填写后继续" : "可以填写，也可以跳过"
              }
              onChange={(event) => setValue(event.target.value)}
            />
            <div className="approval-actions">
              <button
                className="btn btn-primary"
                disabled={item.required && !value.trim()}
                onClick={() => submit(value)}
              >
                继续
              </button>
              {item.options.map((option) => (
                <button key={option} className="btn" onClick={() => submit("")}>
                  {option}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
