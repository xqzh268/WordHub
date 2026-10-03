import { ArrowUp, AtSign, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AGENTS, routeMessage, type AgentMeta } from "../lib/agents";
import { useWorkbench } from "../state/store";
import { Seal } from "./Seal";

/** 光标前最后一个未完成的 @token（位于开头或空白之后）。 */
function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  return { start: caret - match[1]!.length - 1, query: match[1]! };
}

export function Composer() {
  const text = useWorkbench((s) => s.composer);
  const setText = useWorkbench((s) => s.setComposer);
  const send = useWorkbench((s) => s.send);
  const abort = useWorkbench((s) => s.abort);
  const running = useWorkbench((s) => s.activeRunId !== null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const mention = useMemo(() => (dismissed ? null : activeMention(text, caret)), [text, caret, dismissed]);
  const candidates = useMemo<AgentMeta[]>(() => (mention ? AGENTS.filter((agent) => agent.name.startsWith(mention.query)) : []), [mention]);
  const target = routeMessage(text).agent;

  useLayoutEffect(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
  }, [text]);

  useEffect(() => setIndex(0), [mention?.query]);

  // 外部写入（点击 Agent / 起手式）后，把焦点交回输入框并将光标放到末尾。
  const lastExternal = useRef(text);
  useEffect(() => {
    if (text !== lastExternal.current && document.activeElement !== field.current && text) {
      field.current?.focus();
      field.current?.setSelectionRange(text.length, text.length);
      setCaret(text.length);
    }
    lastExternal.current = text;
  }, [text]);

  const pick = (agent: AgentMeta) => {
    if (!mention) return;
    const next = `${text.slice(0, mention.start)}@${agent.name} ${text.slice(caret)}`;
    const position = mention.start + agent.name.length + 2;
    setText(next);
    setDismissed(false);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(position, position);
      setCaret(position);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (candidates.length > 0) {
      if (event.key === "ArrowDown") { event.preventDefault(); setIndex((value) => (value + 1) % candidates.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setIndex((value) => (value - 1 + candidates.length) % candidates.length); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); pick(candidates[index]!); return; }
      if (event.key === "Escape") { event.preventDefault(); setDismissed(true); return; }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!running) void send(text);
    }
  };

  const canSend = text.trim().length > 0 && !running;

  return (
    <div className="composer-wrap">
      <div className="composer">
        <AnimatePresence>
          {candidates.length > 0 && (
            <motion.ul className="mention-pop" role="listbox" aria-label="选择 Agent" initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.98 }} transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}>
              {candidates.map((agent, i) => (
                <li key={agent.id} role="option" aria-selected={i === index}>
                  <button className={i === index ? "active" : ""} onMouseEnter={() => setIndex(i)} onMouseDown={(event) => { event.preventDefault(); pick(agent); }}>
                    <Seal glyph={agent.glyph} color={agent.color} size={22} />
                    <span className="mention-name">{agent.name}</span>
                    <span className="mention-role">{agent.role}</span>
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>

        <textarea
          ref={field}
          value={text}
          rows={1}
          data-testid="composer-input"
          placeholder="告诉纲领你想写什么，或用 @ 指名某个 Agent"
          aria-label="给 Agent 的消息"
          onChange={(event) => { setText(event.target.value); setCaret(event.target.selectionStart); setDismissed(false); }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
        />

        <div className="composer-bar">
          <button className="icon-btn sm tip" data-tip="提及 Agent" aria-label="提及 Agent" onClick={() => { setText(`${text}${text && !/\s$/.test(text) ? " " : ""}@`); field.current?.focus(); }}>
            <AtSign size={16} strokeWidth={1.5} />
          </button>
          <span className="model-chip" title={`${target.name} 使用的模型与思考强度`}>
            <i style={{ background: target.color }} aria-hidden="true" />
            {target.name} · {target.model.replace("deepseek-", "DeepSeek ")} · 思考 {target.reasoning}
          </span>
          <span className="composer-spacer" />
          <span className="composer-hint"><span className="kbd">Enter</span> 发送</span>
          {running ? (
            <button className="send-btn stop" onClick={() => void abort()} aria-label="停止" data-testid="stop">
              <Square size={13} strokeWidth={0} fill="currentColor" />
            </button>
          ) : (
            <button className="send-btn" disabled={!canSend} onClick={() => void send(text)} aria-label="发送" data-testid="send">
              <ArrowUp size={16} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
