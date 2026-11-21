import { Check, ChevronRight, Loader, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { ToolStep } from "../../state/types";

const fmtDuration = (ms: number): string =>
  ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

export function ToolRow({ tool }: { tool: ToolStep }) {
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
