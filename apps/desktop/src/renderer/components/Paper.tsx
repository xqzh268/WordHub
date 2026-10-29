import { motion } from "motion/react";
import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  ListTree,
  Quote,
} from "lucide-react";
import { type CSSProperties, useState } from "react";
import { agentById } from "../lib/agents";
import { formatUpdated, neighborChapter } from "../state/chapters";
import { FACT_KIND_LABELS, type NovelFact } from "@wordhub/contracts";
import { useWorkbench } from "../state/store";
import type { PaperTab } from "../state/types";

const TABS: { id: PaperTab; label: string }[] = [
  { id: "paper", label: "纸面" },
  { id: "outline", label: "大纲" },
  { id: "facts", label: "事实" },
];

const countChars = (text: string): number =>
  (text.match(/[㐀-鿿]/g) ?? []).length;

export function PaperPane() {
  const tab = useWorkbench((s) => s.paperTab);
  const setTab = useWorkbench((s) => s.setPaperTab);
  const paper = useWorkbench((s) => s.paper);
  const project = useWorkbench((s) => s.project.name);
  const demo = useWorkbench((s) => s.demo);
  const chapters = useWorkbench((s) => s.chapters);
  const activeChapter = useWorkbench((s) => s.activeChapter);
  const selectChapter = useWorkbench((s) => s.selectChapter);
  const proposedCount = useWorkbench(
    (s) => s.facts.filter((fact) => fact.status === "proposed").length,
  );
  const finalized = useWorkbench((s) => s.finalized);
  const busy = useWorkbench((s) => s.activeRunId !== null);
  const send = useWorkbench((s) => s.send);
  const isFinalized = activeChapter ? finalized.includes(activeChapter) : false;
  const prev = neighborChapter(chapters, activeChapter, -1);
  const next = neighborChapter(chapters, activeChapter, 1);
  const words = paper
    ? paper.paragraphs.reduce((sum, p) => sum + countChars(p.text), 0)
    : 0;

  return (
    <section className="paper-pane grain" aria-label="文档工作台">
      <header className="paper-bar">
        <div className="seg" role="tablist" aria-label="工作台视图">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              {tab === item.id && (
                <motion.span
                  layoutId="paper-tab"
                  className="seg-pill"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                />
              )}
              <span>{item.label}</span>
              {item.id === "facts" && proposedCount > 0 && (
                <span className="tab-badge" data-testid="facts-badge">
                  {proposedCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="paper-meta">
          {paper ? (
            <>
              <span>{words.toLocaleString("zh-CN")} 字</span>
              <i aria-hidden="true" />
              <span>
                {demo
                  ? "示例稿"
                  : paper.mtimeMs !== undefined
                    ? formatUpdated(paper.mtimeMs)
                    : "已保存"}
              </span>
            </>
          ) : (
            <span>尚无章节</span>
          )}
        </div>
      </header>

      {chapters.length > 0 && tab === "paper" && (
        <nav className="chapter-nav" aria-label="章节">
          <button
            type="button"
            aria-label="上一章"
            disabled={!prev}
            onClick={() => prev && void selectChapter(prev)}
          >
            <ChevronLeft size={15} strokeWidth={1.5} />
          </button>
          <select
            aria-label="选择章节"
            data-testid="chapter-select"
            value={activeChapter ?? ""}
            onChange={(event) => void selectChapter(event.target.value)}
          >
            {chapters.map((chapter) => (
              <option key={chapter.path} value={chapter.path}>
                {chapter.name.replace(/\.(?:md|markdown|txt)$/iu, "")}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="下一章"
            disabled={!next}
            onClick={() => next && void selectChapter(next)}
          >
            <ChevronRight size={15} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className={`btn finalize-btn ${isFinalized ? "done" : ""}`}
            data-testid="finalize"
            disabled={busy || !activeChapter}
            title="史官会抽取待确认的事实并写章节摘要"
            onClick={() => activeChapter && void send(`定稿 ${activeChapter}`)}
          >
            {isFinalized ? "重新定稿" : "定稿"}
          </button>
        </nav>
      )}

      <div className="paper-stage selectable">
        {tab === "paper" &&
          (paper ? (
            <article className="sheet grain" data-testid="paper-sheet">
              <div className="sheet-head">
                <span>{project}</span>
                <span>{paper.page}页</span>
              </div>
              <header className="chapter">
                <span className="chapter-no">{paper.no}</span>
                {paper.title !== paper.no && <h2>{paper.title}</h2>}
                <i className="ornament" aria-hidden="true" />
              </header>
              <div className="prose">
                {paper.paragraphs.map((p) => (
                  <p
                    key={p.id}
                    className={`${p.author ? "revised" : ""} ${p.flag ? "flagged" : ""}`}
                    style={
                      p.author
                        ? ({
                            "--author": agentById(p.author).color,
                          } as CSSProperties)
                        : undefined
                    }
                    data-author={p.author}
                  >
                    {p.text}
                    {p.flag && (
                      <span
                        className="margin-pin tip"
                        data-tip="评审提出了未决质询"
                        aria-label="评审质询"
                      >
                        审
                      </span>
                    )}
                  </p>
                ))}
              </div>
              <footer className="sheet-foot">· {paper.page} ·</footer>
            </article>
          ) : (
            <article
              className="sheet sheet-blank grain"
              data-testid="paper-sheet"
            >
              <div className="sheet-head">
                <span>{project}</span>
                <span />
              </div>
              <div className="blank-note">
                <Quote size={20} strokeWidth={1.25} aria-hidden="true" />
                <p>项目的 chapters/ 文件夹里还没有章节。</p>
                <p className="sub">
                  写好的章节，或你在别的编辑器里放进去的稿子，都会显示在这里（纸面只读）。
                </p>
              </div>
              <footer className="sheet-foot">· 1 ·</footer>
            </article>
          ))}

        {tab === "outline" && (
          <Soft
            icon={<ListTree size={22} strokeWidth={1.25} />}
            title="大纲尚未建立"
            text="纲领完成问询后，章节大纲、悬念线与设定词典会列在这里。"
          />
        )}
        {tab === "facts" && <FactsPanel />}
      </div>
    </section>
  );
}

const STATUS_LABELS: Record<NovelFact["status"], string> = {
  proposed: "待确认",
  confirmed: "已确认",
  rejected: "已驳回",
};

function FactsPanel() {
  const facts = useWorkbench((s) => s.facts);
  const summaries = useWorkbench((s) => s.summaries);
  const decide = useWorkbench((s) => s.decideFact);
  const [onlyPending, setOnlyPending] = useState(false);
  const visible = facts.filter(
    (fact) => !onlyPending || fact.status === "proposed",
  );
  if (facts.length === 0 && summaries.length === 0)
    return (
      <Soft
        icon={<BookOpenText size={22} strokeWidth={1.25} />}
        title="还没有事实"
        text="章节定稿时，史官会把人物状态、新名词与伏笔整理成待确认的候选事实，由你确认或驳回。"
      />
    );
  const chapters = [
    ...new Set([
      ...visible.map((fact) => fact.chapter),
      ...(onlyPending ? [] : summaries.map((item) => item.chapter)),
    ]),
  ].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  return (
    <div className="facts-panel" data-testid="facts-panel">
      <div className="facts-toolbar">
        <label>
          <input
            type="checkbox"
            checked={onlyPending}
            onChange={(event) => setOnlyPending(event.target.checked)}
          />
          只看待确认
        </label>
        <span className="facts-hint">
          只有“已确认”的事实会作为评审的硬校验依据。
        </span>
      </div>
      {chapters.map((chapter) => {
        const summary = summaries.find((item) => item.chapter === chapter);
        return (
          <section key={chapter} className="facts-chapter">
            <h4>
              {chapter.replace(/^chapters\//u, "").replace(/\.[^.]+$/u, "")}
            </h4>
            {summary && <p className="facts-summary">{summary.text}</p>}
            <ul>
              {visible
                .filter((fact) => fact.chapter === chapter)
                .map((fact) => (
                  <li
                    key={fact.id}
                    className={`fact fact-${fact.status}`}
                    data-testid="fact"
                  >
                    <div className="fact-head">
                      <span className="tag">{FACT_KIND_LABELS[fact.kind]}</span>
                      <strong>{fact.subject}</strong>
                      <span className="fact-status">
                        {STATUS_LABELS[fact.status]}
                      </span>
                    </div>
                    <p>{fact.statement}</p>
                    <q className="fact-quote">{fact.quote}</q>
                    {fact.note && <p className="fact-note">{fact.note}</p>}
                    <div className="fact-actions">
                      {fact.status !== "confirmed" && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => void decide(fact.id, "confirm")}
                        >
                          确认
                        </button>
                      )}
                      {fact.status !== "rejected" && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void decide(fact.id, "reject")}
                        >
                          驳回
                        </button>
                      )}
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Soft({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="soft-empty">
      <span className="soft-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
