import { useMemo, useState } from "react";
import {
  type AliasLink,
  FACT_KIND_LABELS,
  type KnowledgeEntry,
  type NovelFact,
  type TimelineEntry,
  characterKnowledge,
} from "@wordhub/contracts";
import { cleanIpcError } from "../../lib/errors";
import { useWorkbench } from "../../state/store";

const chapterName = (chapter: string): string =>
  chapter.replace(/^chapters\//u, "").replace(/\.[^.]+$/u, "");

function FactLine({ fact, note }: { fact: NovelFact; note?: string }) {
  return (
    <>
      <div className="graph-fact-head">
        <span className="tag">{FACT_KIND_LABELS[fact.kind]}</span>
        <small>{chapterName(fact.chapter)}</small>
        {note && <span className="tag know-note">{note}</span>}
      </div>
      <p>
        {fact.kind === "relation"
          ? `${fact.subject} →${fact.relation}→ ${fact.object}：${fact.statement}`
          : fact.statement}
      </p>
      <q className="fact-quote">{fact.quote}</q>
    </>
  );
}

/**
 * 认知边：到所选章节为止，这个人物知道什么、不知道什么（读者已经知道的）。
 * 默认按“他本人 / 他在场 / 身边人在他亲历章节里的变化”推断，作者可以逐条改：
 * 让他知道（从当前章节起）、指定他不知道、恢复默认。采访和推演都按这里的结果给他信息。
 */
export function Knowledge({
  node,
  position,
  timeline,
  aliases,
  entries,
}: {
  node: string;
  position: number;
  timeline: readonly TimelineEntry[];
  aliases: readonly AliasLink[];
  entries: readonly KnowledgeEntry[];
}) {
  const projectId = useWorkbench((s) => s.project.id);
  const facts = useWorkbench((s) => s.facts);
  const summaries = useWorkbench((s) => s.summaries);
  const refreshFacts = useWorkbench((s) => s.refreshFacts);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = timeline[position];

  const knowledge = useMemo(
    () =>
      characterKnowledge({
        node,
        facts,
        summaries,
        upToIndex: position,
        aliases,
        entries,
        timeline,
      }),
    [node, facts, summaries, position, aliases, entries, timeline],
  );

  const act = async (run: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await run();
      await refreshFacts();
    } catch (cause) {
      setError(cleanIpcError(cause));
    } finally {
      setBusy(false);
    }
  };
  const call = (
    command: "graph.knowledgeSet" | "graph.knowledgeClear",
    fact: NovelFact,
    extra: { mode?: "knows" | "unaware"; chapter?: string } = {},
  ) =>
    act(async () => {
      if (!projectId || !window.wordhub) return;
      if (command === "graph.knowledgeClear")
        await window.wordhub.invoke("graph.knowledgeClear", {
          projectId,
          factId: fact.id,
          character: node,
        });
      else
        await window.wordhub.invoke("graph.knowledgeSet", {
          projectId,
          factId: fact.id,
          character: node,
          mode: extra.mode ?? "knows",
          ...(extra.chapter ? { chapter: extra.chapter } : {}),
        });
    });

  if (!knowledge || !current) return null;
  return (
    <div className="knowledge" data-testid="knowledge">
      <p className="interview-scope">
        截至「{current.label}」，<strong>{node}</strong>
        知道什么、不知道什么。默认按“他本人的状态与关系、他在场的事件、身边人在他亲历章节里的变化”推断，你可以逐条改；采访和推演都按这里的结果给他信息。
      </p>
      {error && (
        <p
          className="refs-message bad"
          role="alert"
          data-testid="knowledge-error"
        >
          {error}
        </p>
      )}
      <section>
        <h3 data-testid="knowledge-known-title">
          他知道（{knowledge.known.length}）
        </h3>
        <ul className="graph-facts">
          {knowledge.known.length === 0 && <li className="muted">还没有。</li>}
          {knowledge.known.map(({ fact, source, since }) => (
            <li
              key={fact.id}
              className="graph-fact"
              data-testid="knowledge-known"
              data-fact={fact.id}
            >
              <FactLine
                fact={fact}
                note={
                  source === "granted"
                    ? `你指定他知道${since ? `（自${chapterName(since)}）` : ""}`
                    : undefined
                }
              />
              <div className="know-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void call("graph.knowledgeSet", fact, { mode: "unaware" })
                  }
                  data-testid={`know-deny-${fact.id}`}
                >
                  设为他不知道
                </button>
                {source === "granted" && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void call("graph.knowledgeClear", fact)}
                    data-testid={`know-reset-${fact.id}`}
                  >
                    恢复默认
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 data-testid="knowledge-unknown-title">
          读者知道，他不知道（{knowledge.unknown.length}）
        </h3>
        <ul className="graph-facts">
          {knowledge.unknown.length === 0 && <li className="muted">没有。</li>}
          {knowledge.unknown.map(({ fact, reason }) => (
            <li
              key={fact.id}
              className="graph-fact"
              data-testid="knowledge-unknown"
              data-fact={fact.id}
            >
              <FactLine
                fact={fact}
                note={reason === "denied" ? "你指定他不知道" : undefined}
              />
              <div className="know-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void call("graph.knowledgeSet", fact, {
                      mode: "knows",
                      chapter: current.chapter,
                    })
                  }
                  data-testid={`know-grant-${fact.id}`}
                >
                  让他知道（自{current.label}起）
                </button>
                {reason === "denied" && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void call("graph.knowledgeClear", fact)}
                    data-testid={`know-reset-${fact.id}`}
                  >
                    恢复默认
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
