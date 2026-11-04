import { MessageSquareText, Save, Send, Trash2 } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import type { CommandResults } from "@wordhub/contracts";
import { cleanIpcError } from "../../lib/errors";
import { useWorkbench } from "../../state/store";

type Basis = CommandResults["graph.interview"]["basis"][number];
export type Mode = "character" | "author";
export type Turn = {
  role: "user" | "character";
  text: string;
  basis?: Basis[];
  warnings?: string[];
  tokens?: number;
};
export type Talk = { mode: Mode; turns: Turn[]; savedAs?: string };
export const emptyTalk = (): Talk => ({ mode: "character", turns: [] });

const chapterName = (chapter: string): string =>
  chapter.replace(/^chapters\//u, "").replace(/\.[^.]+$/u, "");

/** 把回答里的 [F#] 标注换成上标序号；没有对应依据的标注直接去掉。 */
function CitedText({ turn }: { turn: Turn }) {
  const order = new Map((turn.basis ?? []).map((item, i) => [item.ref, i + 1]));
  const parts = turn.text.split(/(\[F\d+\])/u);
  return (
    <>
      {parts.map((part, index) => {
        const ref = /^\[(F\d+)\]$/u.exec(part)?.[1];
        if (!ref) return <Fragment key={`${index}-${part}`}>{part}</Fragment>;
        const number = order.get(ref);
        const basis = turn.basis?.find((item) => item.ref === ref);
        return number ? (
          <sup
            key={`${index}-${ref}`}
            className="cite"
            title={`${chapterName(basis?.chapter ?? "")}：${basis?.statement ?? ""}`}
          >
            {number}
          </sup>
        ) : null;
      })}
    </>
  );
}

export function Interview({
  node,
  chapter,
  chapterLabel,
  talk,
  setTalk,
}: {
  node: string;
  chapter: string;
  chapterLabel: string;
  talk: Talk;
  setTalk: (update: (current: Talk) => Talk) => void;
}) {
  const projectId = useWorkbench((s) => s.project.id);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const log = useRef<HTMLDivElement>(null);

  const scroll = () =>
    requestAnimationFrame(() =>
      log.current?.scrollTo({ top: log.current.scrollHeight }),
    );

  const send = async () => {
    const question = draft.trim();
    if (!question || busy || !projectId || !window.wordhub) return;
    setBusy(true);
    setError("");
    const history = talk.turns.map(({ role, text }) => ({ role, text }));
    setTalk((current) => ({
      ...current,
      turns: [...current.turns, { role: "user", text: question }],
    }));
    setDraft("");
    scroll();
    try {
      const result = await window.wordhub.invoke("graph.interview", {
        projectId,
        node,
        chapter,
        mode: talk.mode,
        question,
        history,
      });
      setTalk((current) => ({
        ...current,
        savedAs: undefined,
        turns: [
          ...current.turns,
          {
            role: "character",
            text: result.answer,
            basis: result.basis,
            warnings: result.warnings,
            tokens: result.usage.total,
          },
        ],
      }));
      scroll();
    } catch (cause) {
      setError(cleanIpcError(cause));
      // 这一问没有得到回答：把问题放回输入框，对话里不留悬空的提问
      setTalk((current) => ({ ...current, turns: current.turns.slice(0, -1) }));
      setDraft(question);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!projectId || !window.wordhub || talk.turns.length === 0) return;
    try {
      const result = await window.wordhub.invoke("graph.interviewSave", {
        projectId,
        node,
        chapter,
        mode: talk.mode,
        turns: talk.turns.map((turn) => ({
          role: turn.role,
          text: turn.text.replace(/\[F\d+\]/gu, ""),
          basis: turn.basis?.map(
            (item) => `${chapterName(item.chapter)}：${item.statement}`,
          ),
        })),
      });
      setTalk((current) => ({ ...current, savedAs: result.path }));
    } catch (cause) {
      setError(cleanIpcError(cause));
    }
  };

  return (
    <div className="interview" data-testid="interview">
      <p className="interview-scope" data-testid="interview-scope">
        以截至「{chapterLabel}」时的<strong>{node}</strong>
        的身份回答。只依据已确认的事实，不知道的事会说不知道。
      </p>
      <div className="interview-modes" role="group" aria-label="采访模式">
        {(
          [
            ["character", "采访（人物口吻）"],
            ["author", "作者（分析动机）"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className={talk.mode === mode ? "on" : ""}
            aria-pressed={talk.mode === mode}
            onClick={() => setTalk((current) => ({ ...current, mode }))}
            data-testid={`interview-mode-${mode}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="interview-log" ref={log} data-testid="interview-log">
        {talk.turns.length === 0 && (
          <p className="interview-empty">
            试着问问：你当时为什么这么做？你怎么看待某某？接下来你打算怎么办？
          </p>
        )}
        {talk.turns.map((turn, index) => (
          <div
            key={`${index}-${turn.role}`}
            className={`turn ${turn.role}`}
            data-testid="interview-turn"
          >
            <b>{turn.role === "user" ? "作者" : node}</b>
            <p>
              <CitedText turn={turn} />
            </p>
            {turn.basis && turn.basis.length > 0 && (
              <ol className="interview-basis" data-testid="interview-basis">
                {turn.basis.map((item) => (
                  <li key={item.ref}>
                    <span>{chapterName(item.chapter)}</span> {item.statement}
                    <q>{item.quote}</q>
                  </li>
                ))}
              </ol>
            )}
            {turn.warnings?.map((warning) => (
              <p
                key={warning}
                className="interview-warning"
                role="alert"
                data-testid="interview-warning"
              >
                {warning}
              </p>
            ))}
          </div>
        ))}
        {busy && (
          <p className="interview-busy" data-testid="interview-busy">
            {node}正在想……
          </p>
        )}
      </div>
      {error && (
        <p
          className="refs-message bad"
          role="alert"
          data-testid="interview-error"
        >
          {error}
        </p>
      )}
      <form
        className="interview-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          className="text-input"
          rows={2}
          value={draft}
          maxLength={1000}
          placeholder={`向${node}提问…`}
          aria-label="采访问题"
          data-testid="interview-input"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="submit"
          className="btn btn-primary interview-send"
          disabled={busy || !draft.trim()}
          data-testid="interview-send"
        >
          <Send size={13} strokeWidth={1.6} aria-hidden="true" /> 提问
        </button>
      </form>
      <div className="interview-tools">
        <button
          type="button"
          className="btn"
          disabled={talk.turns.length === 0}
          onClick={() => void save()}
          data-testid="interview-save"
        >
          <Save size={13} strokeWidth={1.6} aria-hidden="true" /> 保存对话
        </button>
        <button
          type="button"
          className="btn"
          disabled={talk.turns.length === 0 || busy}
          onClick={() => setTalk(() => ({ ...emptyTalk(), mode: talk.mode }))}
          data-testid="interview-clear"
        >
          <Trash2 size={13} strokeWidth={1.6} aria-hidden="true" /> 清空
        </button>
        {talk.savedAs && (
          <span className="interview-saved" data-testid="interview-saved">
            已保存：{talk.savedAs}
          </span>
        )}
      </div>
      <p className="refs-note">
        <MessageSquareText size={11} aria-hidden="true" />{" "}
        回答由模型根据已确认事实生成，不是正文，也不会改变设定；所选章节的文字会发给你配置的模型服务商。
      </p>
    </div>
  );
}
