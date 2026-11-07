import { useState } from "react";
import type {
  AliasLink,
  FactGraphNode,
  TimelineEntry,
} from "@wordhub/contracts";
import { cleanIpcError } from "../../lib/errors";
import { useWorkbench } from "../../state/store";

const chapterName = (chapter: string): string =>
  chapter.replace(/^chapters\//u, "").replace(/\.[^.]+$/u, "");

/**
 * 别名合并：同一个人在不同章节用了不同的称呼（“黑衣人”其实是“萧某”）。
 * 由作者说明，并指明读者在哪一章得知——揭晓之前图上仍是两个人物，之后合成一个。
 */
export function Aliases({
  node,
  timeline,
  position,
  links,
  allNames,
}: {
  node: FactGraphNode;
  timeline: readonly TimelineEntry[];
  position: number;
  links: readonly AliasLink[];
  /** 图上出现过的全部人物名（含还没登场的） */
  allNames: readonly string[];
}) {
  const projectId = useWorkbench((s) => s.project.id);
  const refreshFacts = useWorkbench((s) => s.refreshFacts);
  const current = timeline[position];
  const [target, setTarget] = useState("");
  const [chapter, setChapter] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const taken = new Set(links.map((link) => link.alias));
  const options = allNames.filter(
    (name) =>
      name !== node.id &&
      !node.aliases.some((alias) => alias.name === name) &&
      // 已经是别人的别名的名字不再作为合并目标，免得绕成链
      !taken.has(name),
  );
  const intoThis = links.filter((link) => link.canonical === node.id);
  const thisInto = links.filter((link) => link.alias === node.id);
  const reveal = chapter ?? current?.chapter ?? "";

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refreshFacts();
    } catch (cause) {
      setError(cleanIpcError(cause));
    } finally {
      setBusy(false);
    }
  };
  const label = (link: AliasLink): string =>
    link.chapter ? `${chapterName(link.chapter)}揭晓` : "一直是同一人";

  return (
    <section data-testid="aliases">
      <h3>别名</h3>
      {intoThis.length === 0 && thisInto.length === 0 && (
        <p className="muted">
          还没有。如果它其实是另一个人物的别名，可以在下面合并。
        </p>
      )}
      <ul className="graph-links alias-list">
        {intoThis.map((link) => (
          <li key={link.id} data-testid="alias-item">
            <span>
              也称 <strong>{link.alias}</strong>（{label(link)}）
            </span>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (projectId && window.wordhub)
                    await window.wordhub.invoke("graph.aliasUnlink", {
                      projectId,
                      aliasId: link.id,
                    });
                })
              }
              data-testid={`alias-unlink-${link.id}`}
            >
              取消
            </button>
          </li>
        ))}
        {thisInto.map((link) => (
          <li key={link.id} data-testid="alias-item">
            <span>
              其实是 <strong>{link.canonical}</strong>（{label(link)}）
            </span>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (projectId && window.wordhub)
                    await window.wordhub.invoke("graph.aliasUnlink", {
                      projectId,
                      aliasId: link.id,
                    });
                })
              }
              data-testid={`alias-unlink-${link.id}`}
            >
              取消
            </button>
          </li>
        ))}
      </ul>
      {thisInto.length === 0 && options.length > 0 && (
        <form
          className="alias-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!target || !projectId || !window.wordhub) return;
            void run(async () => {
              await window.wordhub?.invoke("graph.aliasLink", {
                projectId,
                alias: node.id,
                canonical: target,
                ...(reveal ? { chapter: reveal } : {}),
              });
              setTarget("");
            });
          }}
        >
          <label>
            <span>「{node.id}」其实是</span>
            <select
              className="text-input"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              data-testid="alias-target"
            >
              <option value="">选择人物…</option>
              {options.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>读者得知于</span>
            <select
              className="text-input"
              value={reveal}
              onChange={(event) => setChapter(event.target.value)}
              data-testid="alias-chapter"
            >
              <option value="">一直是同一人</option>
              {timeline.map((entry) => (
                <option key={entry.chapter} value={entry.chapter}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !target}
            data-testid="alias-link"
          >
            合并
          </button>
        </form>
      )}
      {error && (
        <p className="refs-message bad" role="alert" data-testid="alias-error">
          {error}
        </p>
      )}
    </section>
  );
}
