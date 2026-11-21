import { AlertTriangle, ChevronRight, RotateCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { agentById, agentByName } from "../../lib/agents";
import { useWorkbench } from "../../state/store";
import type { ChatItem } from "../../state/types";
import { Seal } from "../Seal";
import { MarkdownMessage } from "./MarkdownMessage";
import { ToolRow } from "./ToolRow";

type AgentItem = Extract<ChatItem, { kind: "agent" }>;

const fmtTime = (at: number): string =>
  new Date(at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

function Mentioned({ text }: { text: string }): ReactNode {
  const match = /^@(\S+)(\s*)/.exec(text);
  const agent = match?.[1] ? agentByName(match[1]) : undefined;
  if (!match || !agent) return text;
  return (
    <>
      <span
        className="mention"
        style={{ "--mention": agent.color } as React.CSSProperties}
      >
        @{agent.name}
      </span>
      {match[2]}
      {text.slice(match[0].length)}
    </>
  );
}

export function UserMessage({
  item,
}: {
  item: Extract<ChatItem, { kind: "user" }>;
}) {
  return (
    <>
      <Seal
        glyph="你"
        color="var(--user-ink)"
        size={28}
        round
        className="seal-user"
      />
      <div className="msg">
        <header className="msg-head">
          <strong>你</strong>
          <time>{fmtTime(item.at)}</time>
        </header>
        <p className="msg-text user-text">{Mentioned({ text: item.text })}</p>
      </div>
    </>
  );
}

export function AgentMessage({ item }: { item: AgentItem }) {
  const agent = agentById(item.agentId);
  const streaming = item.status === "streaming";
  const thinking = item.status === "thinking";
  // 思考过程只在生成时自动展开；结束后折叠，用户点开后以用户的选择为准。
  const [reasoningToggle, setReasoningToggle] = useState<boolean | null>(null);
  const reasoningOpen = reasoningToggle ?? (thinking || streaming);
  const [contextOpen, setContextOpen] = useState(false);
  const [undone, setUndone] = useState(false);
  const resumeRun = useWorkbench((s) => s.resumeRun);

  return (
    <>
      <Seal glyph={agent.glyph} color={agent.color} size={28} />
      <div className="msg">
        <header className="msg-head">
          <strong style={{ color: agent.color }}>{agent.name}</strong>
          <time>{fmtTime(item.at)}</time>
          {item.status === "aborted" && <span className="tag">已停止</span>}
          {item.status === "interrupted" && <span className="tag">已中断</span>}
          {item.status === "waiting_approval" && (
            <span className="tag">等待确认</span>
          )}
        </header>

        {item.tools.length > 0 && (
          <ul className="tools" role="list">
            {item.tools.map((tool) => (
              <ToolRow key={tool.id} tool={tool} />
            ))}
          </ul>
        )}

        {thinking && item.tools.every((tool) => tool.status !== "running") && (
          <p className="thinking">
            正在构思<span className="thinking-sheen">…</span>
          </p>
        )}

        {item.reasoning && (
          <div className="reasoning-panel">
            <button
              className="reasoning-toggle"
              onClick={() => setReasoningToggle(!reasoningOpen)}
              aria-expanded={reasoningOpen}
            >
              <span>思考过程（模型原文，可能是英文，仅本次运行显示）</span>
              {item.reasoningLevel && (
                <span className="tag">{item.reasoningLevel}</span>
              )}
              {item.model && (
                <span className="mono reasoning-model">{item.model}</span>
              )}
              <ChevronRight
                size={13}
                strokeWidth={1.5}
                className={`tool-chev ${reasoningOpen ? "open" : ""}`}
              />
            </button>
            {reasoningOpen && (
              <p className="reasoning-text">{item.reasoning}</p>
            )}
          </div>
        )}

        {(item.text || streaming) && (
          <MarkdownMessage
            className="msg-text agent-text"
            text={item.text}
            streaming={streaming}
          />
        )}
        {item.usage && (
          <p className="usage-line">
            输入 {item.usage.input} · 输出 {item.usage.output} token
            {item.usage.cost !== undefined
              ? ` · $${item.usage.cost.toFixed(6)}`
              : ""}
          </p>
        )}

        {item.context && item.context.length > 0 && (
          <div className="context-panel">
            <button
              className="reasoning-toggle"
              onClick={() => setContextOpen((value) => !value)}
              aria-expanded={contextOpen}
            >
              <span>查看上下文</span>
              <span className="tag">{item.context.length}层</span>
              <ChevronRight
                size={13}
                strokeWidth={1.5}
                className={`tool-chev ${contextOpen ? "open" : ""}`}
              />
            </button>
            {contextOpen && (
              <ul className="context-list" role="list">
                {item.context.map((layer) => (
                  <li key={layer.id}>
                    <span>{layer.kind}</span>
                    <span className="mono">{layer.sourcePath ?? layer.id}</span>
                    <small>
                      {layer.estimatedTokens}
                      {layer.tokenBudget !== undefined
                        ? `/${layer.tokenBudget}`
                        : ""}{" "}
                      token
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {item.edit && (
          <div className="edit-chip">
            <span className="edit-label">
              {undone ? "已撤销" : item.edit.label}
            </span>
            <button onClick={() => setUndone((value) => !value)}>
              <RotateCcw size={12} strokeWidth={1.75} />
              {undone ? "重做" : "撤销"}
            </button>
          </div>
        )}

        {item.error && (
          <p className="msg-error" role="alert">
            <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>{item.error}</span>
          </p>
        )}
        {item.status === "interrupted" && item.runId && (
          <button
            className="btn btn-primary"
            onClick={() => void resumeRun(item.runId!)}
          >
            继续运行
          </button>
        )}
      </div>
    </>
  );
}
