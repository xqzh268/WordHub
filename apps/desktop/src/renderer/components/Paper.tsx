import { motion } from "motion/react";
import { BookOpenText, ListTree, Quote } from "lucide-react";
import type { CSSProperties } from "react";
import { agentById } from "../lib/agents";
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
            </button>
          ))}
        </div>
        <div className="paper-meta">
          {paper ? (
            <>
              <span>{words.toLocaleString("zh-CN")} 字</span>
              <i aria-hidden="true" />
              <span>{demo ? "示例稿" : "已保存"}</span>
            </>
          ) : (
            <span>尚无章节</span>
          )}
        </div>
      </header>

      <div className="paper-stage selectable">
        {tab === "paper" &&
          (paper ? (
            <article className="sheet grain" data-testid="paper-sheet">
              <div className="sheet-head">
                <span>{project}</span>
                <span>{paper.no}</span>
              </div>
              <header className="chapter">
                <span className="chapter-no">{paper.no}</span>
                <h2>{paper.title}</h2>
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
                <p>你的第一章会在确认写作计划后出现在这里。</p>
                <p className="sub">
                  Agent 的每一次改动都会成为一个修订，随时可以撤销。
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
        {tab === "facts" && (
          <Soft
            icon={<BookOpenText size={22} strokeWidth={1.25} />}
            title="还没有事实"
            text="观察者每写完一章，会把人物状态、新名词与伏笔整理成待确认的候选事实。"
          />
        )}
      </div>
    </section>
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
