import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleAlert,
  Feather,
  Loader,
  RotateCcw,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
} from "react";
import { agentById, agentByName } from "../lib/agents";
import { useWorkbench } from "../state/store";
import type { ChatItem, ToolStep } from "../state/types";
import { Composer } from "./Composer";
import { Seal } from "./Seal";

type AgentItem = Extract<ChatItem, { kind: "agent" }>;
type ThreadItem = Extract<ChatItem, { kind: "thread" }>;
type ApprovalItem = Extract<ChatItem, { kind: "approval" }>;
type QuestionItem = Extract<ChatItem, { kind: "question" }>;

const fmtTime = (at: number): string =>
  new Date(at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const fmtDuration = (ms: number): string =>
  ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

const enter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const },
};

export function ChatPane() {
  const session = useWorkbench((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId),
  );
  const items = session?.items ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const last = items[items.length - 1];
  const signal = `${items.length}:${last?.kind === "agent" ? last.text.length + last.tools.length : 0}`;
  const send = useWorkbench((s) => s.send);
  const project = useWorkbench((s) => s.project);
  const activeRunId = useWorkbench((s) => s.activeRunId);
  const usage = items.reduce(
    (sum, item) =>
      item.kind === "agent" && item.usage
        ? {
            input: sum.input + item.usage.input,
            output: sum.output + item.usage.output,
            cost: sum.cost + (item.usage.cost ?? 0),
          }
        : sum,
    { input: 0, output: 0, cost: 0 },
  );

  useEffect(() => {
    const node = scroller.current;
    if (node && stick.current)
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [signal, session?.id]);

  return (
    <section className="chat grain" aria-label="Agent 群聊">
      <div
        className="chat-scroll selectable"
        ref={scroller}
        data-testid="chat-scroll"
        onScroll={(event) => {
          const node = event.currentTarget;
          stick.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        {items.length === 0 ? (
          <EmptyChat />
        ) : (
          <ol className="timeline">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <motion.li
                  key={item.id}
                  className={`entry entry-${item.kind}`}
                  {...enter}
                >
                  <Entry item={item} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </div>
      {usage.input + usage.output > 0 && (
        <div className="usage-summary" data-testid="session-usage">
          本会话用量：输入{usage.input} · 输出{usage.output} token · $
          {usage.cost.toFixed(6)}
        </div>
      )}
      {project.folder && !activeRunId && (
        <button
          className="review-shortcut"
          data-testid="request-review"
          onClick={() => void send("请评审当前章节的一致性")}
        >
          请评审当前章节
        </button>
      )}
      <Composer />
    </section>
  );
}

function Entry({ item }: { item: ChatItem }) {
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

function inlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/gu);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={key}>{part.slice(1, -1)}</code>;
    return <span key={key}>{part}</span>;
  });
}

function MarkdownMessage({
  text,
  className,
  streaming = false,
}: {
  text: string;
  className: string;
  streaming?: boolean;
}) {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(
      <p key={`p-${blocks.length}`}>
        {inlineMarkdown(paragraph.join("\n"), `p-${blocks.length}`)}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const List = list.ordered ? "ol" : "ul";
    blocks.push(
      <List key={`list-${blocks.length}`}>
        {list.items.map((item, index) => (
          <li key={`list-${blocks.length}-${index}`}>
            {inlineMarkdown(item, `list-${blocks.length}-${index}`)}
          </li>
        ))}
      </List>,
    );
    list = null;
  };
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/u.exec(line);
    const unordered = /^\s*[-*+]\s+(.+)$/u.exec(line);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const marks = heading[1] ?? "#";
      const headingText = heading[2] ?? "";
      const Tag = `h${marks.length}` as ElementType;
      blocks.push(
        <Tag key={`h-${blocks.length}`}>
          {inlineMarkdown(headingText, `h-${blocks.length}`)}
        </Tag>,
      );
    } else if (ordered || unordered) {
      flushParagraph();
      const orderedList = Boolean(ordered);
      if (!list || list.ordered !== orderedList) {
        flushList();
        list = { ordered: orderedList, items: [] };
      }
      const listItem = ordered?.[1] ?? unordered?.[1];
      if (listItem) list.items.push(listItem);
    } else {
      if (list) flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return (
    <div className={className}>
      {blocks}
      {streaming && <span className="ink-dot" aria-hidden="true" />}
    </div>
  );
}

function UserMessage({ item }: { item: Extract<ChatItem, { kind: "user" }> }) {
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

function AgentMessage({ item }: { item: AgentItem }) {
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

function ToolRow({ tool }: { tool: ToolStep }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(tool.detail);
  return (
    <li className={`tool tool-${tool.status}`}>
      <button
        className="tool-row"
        onClick={() => expandable && setOpen((value) => !value)}
        aria-expanded={expandable ? open : undefined}
        data-expandable={expandable}
      >
        <span className="tool-state" aria-hidden="true">
          {tool.status === "running" ? (
            <Loader size={12} strokeWidth={2} className="spin" />
          ) : tool.status === "error" ? (
            <X size={12} strokeWidth={2} />
          ) : (
            <Check size={12} strokeWidth={2} />
          )}
        </span>
        <span className="tool-label">{tool.label}</span>
        {tool.durationMs !== undefined && (
          <span className="tool-time">{fmtDuration(tool.durationMs)}</span>
        )}
        {expandable && (
          <ChevronRight
            size={13}
            strokeWidth={1.5}
            className={`tool-chev ${open ? "open" : ""}`}
            aria-hidden="true"
          />
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && tool.detail && (
          <motion.div
            className="tool-detail mono"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <div>{tool.detail}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  timeline: "时间线",
  character: "人物塑造",
  fact: "基本事实",
  commonsense: "常识",
  style: "风格",
};

function ThreadCard({ item }: { item: ThreadItem }) {
  const [open, setOpen] = useState(false);
  const from = agentById(item.from);
  const to = agentById(item.to);
  return (
    <>
      <div className="thread-rail" aria-hidden="true" />
      <div className={`thread thread-${item.severity}`}>
        <button
          className="thread-head"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <span className="thread-pair">
            <Seal glyph={from.glyph} color={from.color} size={18} />
            <span className="thread-arrows" aria-hidden="true">
              ⇄
            </span>
            <Seal glyph={to.glyph} color={to.color} size={18} />
          </span>
          <span className="thread-title">
            {from.name} 质询 {to.name}
          </span>
          <span className="tag">
            第 {item.round}/{item.maxRounds} 轮
          </span>
          {item.category && (
            <span className="tag">
              {CATEGORY_LABELS[item.category] ?? item.category}
            </span>
          )}
          {item.severity === "blocking" && (
            <span className="tag tag-danger">阻塞</span>
          )}
          <ChevronRight
            size={14}
            strokeWidth={1.5}
            className={`tool-chev ${open ? "open" : ""}`}
            aria-hidden="true"
          />
        </button>
        <blockquote className="thread-claim">{item.claim}</blockquote>
        {item.citations && item.citations.length > 0 && (
          <ul className="thread-cites" data-testid="thread-cites">
            {item.citations.map((cite) => (
              <li key={`${cite.source}:${cite.quote}`}>
                <q>{cite.quote}</q>
                <span>
                  {cite.source.replace(/^\.wordhub\/bible\//u, "设定/")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <AnimatePresence initial={false}>
          {open && (
            <motion.ol
              className="thread-replies"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            >
              {item.replies.map((reply, index) => {
                const agent = agentById(reply.agentId);
                return (
                  <li key={index}>
                    <Seal glyph={agent.glyph} color={agent.color} size={20} />
                    <p>{reply.text}</p>
                  </li>
                );
              })}
            </motion.ol>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

function ApprovalCard({ item }: { item: ApprovalItem }) {
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

function DraftCard({ item }: { item: Extract<ChatItem, { kind: "draft" }> }) {
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

function QuestionCard({ item }: { item: QuestionItem }) {
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

const STARTERS = [
  "写一部唐代悬疑短篇，主角是个不良人",
  "为这本书建立人物档案",
  "帮我梳理第三章的节奏",
];

function EmptyChat() {
  const setComposer = useWorkbench((s) => s.setComposer);
  return (
    <div className="empty-chat" data-testid="empty-chat">
      <div className="empty-seal">
        <Feather size={26} strokeWidth={1.25} aria-hidden="true" />
      </div>
      <h2>从一个念头开始</h2>
      <p>
        告诉纲领你想写什么。它会先问清几件必要的事，再和写手、编辑、评审一起把故事一章章写出来。
      </p>
      <div className="starters">
        {STARTERS.map((text) => (
          <button
            key={text}
            className="starter"
            onClick={() => setComposer(text)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
