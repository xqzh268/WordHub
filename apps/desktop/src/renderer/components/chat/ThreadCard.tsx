import { NOVEL_REVIEW_CHECKLIST } from "@wordhub/novel";
import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { agentById } from "../../lib/agents";
import type { ChatItem } from "../../state/types";
import { Seal } from "../Seal";

type ThreadItem = Extract<ChatItem, { kind: "thread" }>;

export function ThreadCard({ item }: { item: ThreadItem }) {
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
              {NOVEL_REVIEW_CHECKLIST.find(({ id }) => id === item.category)
                ?.label ?? item.category}
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
