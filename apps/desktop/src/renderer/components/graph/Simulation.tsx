import { FlaskConical, Play, Save, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CommandResults } from "@wordhub/contracts";
import { cleanIpcError } from "../../lib/errors";
import { useWorkbench } from "../../state/store";

type Entry = {
  round: number;
  name: string;
  action: string;
  intent?: string;
  warnings?: string[];
};
type Estimate = CommandResults["graph.simulateEstimate"];
type Status = "idle" | "running" | "reporting" | "done" | "stopped";

export type SimState = {
  participants: string[];
  premise: string;
  rounds: number;
  status: Status;
  /** 开始时固定下来的起点章节，运行中拖滑块不影响这一次推演 */
  chapter?: string;
  chapterLabel?: string;
  log: Entry[];
  report?: string;
  tokens: number;
  savedAs?: string;
};

export const initialSim = (participants: string[]): SimState => ({
  participants,
  premise: "",
  rounds: 3,
  status: "idle",
  log: [],
  tokens: 0,
});

const fmtTokens = (n: number): string =>
  n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : String(n);

export function Simulation({
  candidates,
  chapter,
  chapterLabel,
  state,
  setState,
}: {
  candidates: string[];
  chapter: string;
  chapterLabel: string;
  state: SimState;
  setState: (update: (current: SimState) => SimState) => void;
}) {
  const projectId = useWorkbench((s) => s.project.id);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [error, setError] = useState("");
  const stop = useRef(false);
  const running = state.status === "running" || state.status === "reporting";
  const editable = state.status === "idle" || state.status === "stopped";
  const base = {
    projectId: projectId ?? "",
    chapter: state.chapter ?? chapter,
    ...(state.premise.trim() ? { premise: state.premise.trim() } : {}),
    participants: state.participants,
  };
  const valid =
    state.participants.length >= 2 && state.participants.length <= 6;

  // 开始前的估算（参与人物、轮数、起点变化时重算）
  useEffect(() => {
    if (!projectId || !window.wordhub || !valid || state.status !== "idle") {
      setEstimate(null);
      return;
    }
    let alive = true;
    window.wordhub
      .invoke("graph.simulateEstimate", {
        projectId,
        chapter,
        participants: state.participants,
        rounds: state.rounds,
      })
      .then((result) => alive && setEstimate(result))
      .catch(() => alive && setEstimate(null));
    return () => {
      alive = false;
    };
  }, [
    projectId,
    chapter,
    state.participants,
    state.rounds,
    valid,
    state.status,
  ]);

  const toggle = (name: string) =>
    setState((current) => ({
      ...current,
      participants: current.participants.includes(name)
        ? current.participants.filter((item) => item !== name)
        : current.participants.length >= 6
          ? current.participants
          : [...current.participants, name],
    }));

  const finish = async (log: Entry[]) => {
    if (!window.wordhub || log.length === 0) {
      setState((current) => ({ ...current, status: "stopped" }));
      return;
    }
    setState((current) => ({ ...current, status: "reporting" }));
    try {
      const result = await window.wordhub.invoke("graph.simulateReport", {
        ...base,
        log: log.map(({ round, name, action, intent }) => ({
          round,
          name,
          action,
          intent,
        })),
      });
      setState((current) => ({
        ...current,
        status: "done",
        report: result.report,
        tokens: current.tokens + result.usage.total,
      }));
    } catch (cause) {
      setError(cleanIpcError(cause));
      setState((current) => ({ ...current, status: "stopped" }));
    }
  };

  const start = async () => {
    if (!window.wordhub || !projectId || !valid || running) return;
    stop.current = false;
    setError("");
    setState((current) => ({
      ...current,
      status: "running",
      chapter,
      chapterLabel,
      log: [],
      report: undefined,
      tokens: 0,
      savedAs: undefined,
    }));
    const log: Entry[] = [];
    try {
      for (let round = 1; round <= state.rounds; round += 1)
        for (const name of state.participants) {
          if (stop.current) {
            setState((current) => ({ ...current, status: "stopped" }));
            return;
          }
          const step = await window.wordhub.invoke("graph.simulateStep", {
            projectId,
            chapter,
            ...(state.premise.trim() ? { premise: state.premise.trim() } : {}),
            participants: state.participants,
            node: name,
            round,
            rounds: state.rounds,
            log: log.map(({ round: r, name: n, action, intent }) => ({
              round: r,
              name: n,
              action,
              intent,
            })),
          });
          const entry: Entry = {
            round,
            name,
            action: step.action,
            intent: step.intent,
            warnings: step.warnings,
          };
          log.push(entry);
          setState((current) => ({
            ...current,
            log: [...log],
            tokens: current.tokens + step.usage.total,
          }));
        }
    } catch (cause) {
      setError(cleanIpcError(cause));
      setState((current) => ({ ...current, status: "stopped" }));
      return;
    }
    if (stop.current) {
      setState((current) => ({ ...current, status: "stopped" }));
      return;
    }
    await finish(log);
  };

  const save = async () => {
    if (!window.wordhub || !projectId || !state.report) return;
    try {
      const result = await window.wordhub.invoke("graph.simulateSave", {
        ...base,
        chapter: state.chapter ?? chapter,
        rounds: state.rounds,
        log: state.log.map(({ round, name, action, intent }) => ({
          round,
          name,
          action,
          intent,
        })),
        report: state.report,
      });
      setState((current) => ({ ...current, savedAs: result.path }));
    } catch (cause) {
      setError(cleanIpcError(cause));
    }
  };

  const total = state.rounds * state.participants.length;
  return (
    <div className="sim" data-testid="sim-panel">
      <h2>
        <FlaskConical size={16} strokeWidth={1.5} aria-hidden="true" /> 推演
      </h2>
      <p className="interview-scope">
        从「{state.chapterLabel ?? chapterLabel}
        」结束时的局面出发，让几个人物各自按已知信息逐轮行动，最后给出推演报告。
        <strong>这是推演，不是预言</strong>
        ：结果存为非正史，不会改动章节、设定或事实。
      </p>

      <fieldset className="sim-field" disabled={!editable}>
        <legend>参与人物（2–6 个）</legend>
        <div className="sim-people">
          {candidates.map((name) => (
            <label key={name} className="check-inline">
              <input
                type="checkbox"
                checked={state.participants.includes(name)}
                onChange={() => toggle(name)}
                data-testid={`sim-participant-${name}`}
              />
              {name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="sim-field">
        <span>假如……（可选）</span>
        <textarea
          className="text-input"
          rows={3}
          maxLength={500}
          value={state.premise}
          disabled={!editable}
          placeholder="例如：苏晚在这时拿到了那封密信，并且决定不告诉裴照。"
          onChange={(event) =>
            setState((current) => ({ ...current, premise: event.target.value }))
          }
          data-testid="sim-premise"
        />
      </label>
      <label className="sim-field sim-inline">
        <span>推演轮数</span>
        <select
          className="text-input"
          value={state.rounds}
          disabled={!editable}
          onChange={(event) =>
            setState((current) => ({
              ...current,
              rounds: Number(event.target.value),
            }))
          }
          data-testid="sim-rounds"
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n} 轮
            </option>
          ))}
        </select>
      </label>

      {state.status === "idle" && (
        <p className="refs-note" data-testid="sim-estimate">
          {valid
            ? estimate
              ? `开始前的估算：约 ${estimate.calls} 次模型调用，输入约 ${fmtTokens(estimate.inputTokens)} token、输出约 ${fmtTokens(estimate.outputTokens)} token。用的是写手的模型设置。`
              : "正在估算…"
            : "先选 2–6 个人物。"}
        </p>
      )}
      <div className="interview-tools">
        {!running ? (
          <button
            type="button"
            className="btn btn-primary sim-start"
            disabled={!valid}
            onClick={() => void start()}
            data-testid="sim-start"
          >
            <Play size={13} strokeWidth={1.6} aria-hidden="true" />
            {state.status === "idle" ? "开始推演" : "重新推演"}
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => {
              stop.current = true;
            }}
            disabled={state.status === "reporting"}
            data-testid="sim-stop"
          >
            <Square size={12} strokeWidth={1.6} aria-hidden="true" /> 停止
          </button>
        )}
        {state.status !== "idle" && !running && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              setState((current) => ({
                ...initialSim(current.participants),
                premise: current.premise,
                rounds: current.rounds,
              }))
            }
            data-testid="sim-reset"
          >
            清空结果
          </button>
        )}
        {state.status === "stopped" && state.log.length > 0 && (
          <button
            type="button"
            className="btn"
            onClick={() => void finish(state.log)}
            data-testid="sim-finish"
          >
            用已有记录生成报告
          </button>
        )}
      </div>
      {running && (
        <p className="interview-busy" data-testid="sim-progress">
          {state.status === "reporting"
            ? "正在写推演报告……"
            : `推演中：已完成 ${state.log.length}/${total} 步`}
        </p>
      )}
      {error && (
        <p className="refs-message bad" role="alert" data-testid="sim-error">
          {error}
        </p>
      )}

      {state.log.length > 0 && (
        <ol className="sim-log" data-testid="sim-log">
          {state.log.map((entry) => (
            <li key={`${entry.round}-${entry.name}`} data-testid="sim-entry">
              <small>
                第{entry.round}轮 · {entry.name}
              </small>
              <p>{entry.action}</p>
              {entry.intent && (
                <details className="sim-intent">
                  <summary>心思（只有他自己知道）</summary>
                  <p>{entry.intent}</p>
                </details>
              )}
              {entry.warnings?.map((warning) => (
                <p
                  key={warning}
                  className="interview-warning"
                  role="alert"
                  data-testid="sim-warning"
                >
                  {warning}
                </p>
              ))}
            </li>
          ))}
        </ol>
      )}
      {state.report && (
        <section className="sim-report" data-testid="sim-report">
          <h3>推演报告（非正史）</h3>
          <pre>{state.report}</pre>
          <div className="interview-tools">
            <button
              type="button"
              className="btn"
              onClick={() => void save()}
              data-testid="sim-save"
            >
              <Save size={13} strokeWidth={1.6} aria-hidden="true" /> 保存为参考
            </button>
            {state.savedAs && (
              <span className="interview-saved" data-testid="sim-saved">
                已保存：{state.savedAs}
              </span>
            )}
          </div>
        </section>
      )}
      {state.tokens > 0 && (
        <p className="refs-note" data-testid="sim-tokens">
          本次推演已用 {fmtTokens(state.tokens)} token。
        </p>
      )}
    </div>
  );
}
