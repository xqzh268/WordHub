import { FlaskConical, Maximize2, Minus, Plus, Waypoints } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FACT_KIND_LABELS,
  type FactGraphEdge,
  type FactGraphNode,
  type NovelFact,
  graphTimeline,
  projectGraph,
} from "@wordhub/contracts";
import { useWorkbench } from "../../state/store";
import { type Talk, Interview, emptyTalk } from "./Interview";
import { type SimState, Simulation, initialSim } from "./Simulation";
import { type Point, WORLD, layoutGraph } from "./layout";

const NODE_W = 92;
const NODE_H = 36;

type Selection = { kind: "node" | "edge"; id: string } | null;
type View = { x: number; y: number; k: number };

const chapterLabel = (chapter: string): string =>
  chapter.replace(/^chapters\//u, "").replace(/\.[^.]+$/u, "");

/** 线段从 from 指向 to：在 from 的矩形边缘处截断，让箭头落在节点外面。 */
function clip(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return from;
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : NODE_W / 2 / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : NODE_H / 2 / Math.abs(dy),
  );
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

/** 关系图谱：已确认的人物与关系的投影，章节时间滑块，节点/关系详情。 */
export function GraphView() {
  const folder = useWorkbench((s) => s.project.folder);
  const facts = useWorkbench((s) => s.facts);
  const summaries = useWorkbench((s) => s.summaries);
  const refreshFacts = useWorkbench((s) => s.refreshFacts);
  useEffect(() => {
    void refreshFacts();
  }, [refreshFacts]);

  const timeline = useMemo(
    () => graphTimeline(facts, summaries),
    [facts, summaries],
  );
  const [upTo, setUpTo] = useState<number | null>(null);
  const [showPending, setShowPending] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [detailTab, setDetailTab] = useState<"detail" | "interview">("detail");
  const [talks, setTalks] = useState<Record<string, Talk>>({});
  const [simOpen, setSimOpen] = useState(false);
  const [sim, setSim] = useState<SimState>(() => initialSim([]));
  const last = Math.max(timeline.length - 1, 0);
  // null = 跟随最新章节；用户拖过滑块就固定在那一章
  const position = upTo === null ? last : Math.min(upTo, last);

  const graph = useMemo(
    () =>
      projectGraph(facts, timeline, {
        upToIndex: position,
        includeProposed: showPending,
      }),
    [facts, timeline, position, showPending],
  );
  // 布局按“全部章节 + 含待确认”算一次，之后拖滑块、切开关节点都不动
  const positions = useMemo(() => {
    const full = projectGraph(facts, timeline, { includeProposed: true });
    return layoutGraph(
      full.nodes.map((node) => node.id),
      full.edges,
    );
  }, [facts, timeline]);
  const pendingTotal = useMemo(
    () =>
      facts.filter(
        (fact) =>
          fact.status === "proposed" &&
          (fact.kind === "relation" || fact.kind === "character_state"),
      ).length,
    [facts],
  );

  const candidates = useMemo(
    () => graph.nodes.map((node) => node.id),
    [graph.nodes],
  );
  // 没开始推演时，参与名单只保留此刻（所选章节）图上有的人物
  useEffect(() => {
    setSim((current) =>
      current.status === "idle" &&
      current.participants.some((name) => !candidates.includes(name))
        ? {
            ...current,
            participants: current.participants.filter((name) =>
              candidates.includes(name),
            ),
          }
        : current,
    );
  }, [candidates]);
  const openSim = () => {
    setSimOpen(true);
    setSim((current) => {
      if (current.status !== "idle" || current.participants.length > 0)
        return current;
      const picked = new Set<string>();
      if (selection?.kind === "node") picked.add(selection.id);
      for (const edge of graph.edges)
        if (picked.has(edge.source) || picked.has(edge.target)) {
          picked.add(edge.source);
          picked.add(edge.target);
        }
      for (const name of candidates) if (picked.size < 3) picked.add(name);
      return { ...current, participants: [...picked].slice(0, 4) };
    });
  };

  const selectedNode =
    selection?.kind === "node"
      ? graph.nodes.find((node) => node.id === selection.id)
      : undefined;
  const selectedEdge =
    selection?.kind === "edge"
      ? graph.edges.find((edge) => edge.id === selection.id)
      : undefined;
  useEffect(() => {
    if (selection && !selectedNode && !selectedEdge) setSelection(null);
  }, [selection, selectedNode, selectedEdge]);

  // ── 画布：平移与缩放 ───────────────────────────────────
  const canvas = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const touched = useRef(false);
  const fit = () => {
    const el = canvas.current;
    if (!el) return;
    const k = Math.min(
      el.clientWidth / WORLD.width,
      el.clientHeight / WORLD.height,
      1.4,
    );
    setView({
      k,
      x: (el.clientWidth - WORLD.width * k) / 2,
      y: (el.clientHeight - WORLD.height * k) / 2,
    });
  };
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!touched.current) fit();
    });
    observer.observe(el);
    fit();
    return () => observer.disconnect();
  }, [timeline.length > 0]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const zoomAt = (clientX: number, clientY: number, factor: number) => {
      const rect = el.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      touched.current = true;
      setView((current) => {
        const k = Math.min(2.5, Math.max(0.3, current.k * factor));
        const ratio = k / current.k;
        return {
          k,
          x: px - (px - current.x) * ratio,
          y: py - (py - current.y) * ratio,
        };
      });
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    let drag: { x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest("button")) return;
      drag = { x: event.clientX, y: event.clientY };
      el.setPointerCapture(event.pointerId);
      el.classList.add("panning");
    };
    const move = (event: PointerEvent) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag = { x: event.clientX, y: event.clientY };
      touched.current = true;
      setView((current) => ({
        ...current,
        x: current.x + dx,
        y: current.y + dy,
      }));
    };
    const up = (event: PointerEvent) => {
      if (!drag) return;
      drag = null;
      el.classList.remove("panning");
      if (el.hasPointerCapture(event.pointerId))
        el.releasePointerCapture(event.pointerId);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [timeline.length > 0]);
  const zoomBy = (factor: number) => {
    const el = canvas.current;
    if (!el) return;
    touched.current = true;
    setView((current) => {
      const k = Math.min(2.5, Math.max(0.3, current.k * factor));
      const ratio = k / current.k;
      const px = el.clientWidth / 2;
      const py = el.clientHeight / 2;
      return {
        k,
        x: px - (px - current.x) * ratio,
        y: py - (py - current.y) * ratio,
      };
    });
  };

  if (!folder)
    return (
      <div className="graph" data-testid="graph">
        <div className="graph-empty">
          <Waypoints size={26} strokeWidth={1.25} aria-hidden="true" />
          <h1>关系图谱</h1>
          <p>先链接写作文件夹：人物与关系来自章节定稿时史官整理的事实。</p>
        </div>
      </div>
    );
  const hasFacts = facts.some(
    (fact) => fact.kind === "relation" || fact.kind === "character_state",
  );
  if (!hasFacts)
    return (
      <div className="graph" data-testid="graph">
        <div className="graph-empty" data-testid="graph-empty">
          <Waypoints size={26} strokeWidth={1.25} aria-hidden="true" />
          <h1>关系图谱</h1>
          <p>
            还没有人物与关系。章节定稿后，史官会整理出人物状态和人物关系，在“事实”页签里由你确认；确认过的才会出现在这里。
          </p>
        </div>
      </div>
    );

  const current = timeline[position];
  const empty = graph.nodes.length === 0;
  return (
    <div className="graph" data-testid="graph">
      <header className="graph-bar">
        <h1>关系图谱</h1>
        <label className="graph-slider" htmlFor="graph-time">
          <span>章节</span>
          <input
            id="graph-time"
            type="range"
            min={0}
            max={last}
            step={1}
            value={position}
            disabled={timeline.length <= 1}
            onChange={(event) => setUpTo(Number(event.target.value))}
            data-testid="graph-time"
            aria-valuetext={current?.label}
          />
          <strong data-testid="graph-time-label">
            {current?.label ?? "—"}
          </strong>
          <small>
            {position + 1}/{timeline.length}
          </small>
        </label>
        <label className="check-inline" title="待确认的事实用虚线淡色显示">
          <input
            type="checkbox"
            checked={showPending}
            onChange={(event) => setShowPending(event.target.checked)}
            data-testid="graph-pending"
          />
          显示待确认{pendingTotal > 0 ? `（${pendingTotal}）` : ""}
        </label>
        <span className="graph-count" data-testid="graph-count">
          {graph.nodes.length} 人 · {graph.edges.length} 条关系
        </span>
        <button
          type="button"
          className={`btn graph-sim-btn ${simOpen ? "on" : ""}`}
          aria-pressed={simOpen}
          onClick={() => (simOpen ? setSimOpen(false) : openSim())}
          data-testid="sim-open"
        >
          <FlaskConical size={13} strokeWidth={1.5} aria-hidden="true" /> 推演
        </button>
        <span className="graph-zoom">
          <button
            type="button"
            className="icon-btn sm"
            aria-label="缩小"
            onClick={() => zoomBy(1 / 1.2)}
          >
            <Minus size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="icon-btn sm"
            aria-label="放大"
            onClick={() => zoomBy(1.2)}
          >
            <Plus size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="icon-btn sm"
            aria-label="适应窗口"
            data-testid="graph-fit"
            onClick={() => {
              touched.current = false;
              fit();
            }}
          >
            <Maximize2 size={13} strokeWidth={1.5} />
          </button>
        </span>
      </header>
      <div className="graph-body">
        <div className="graph-canvas" ref={canvas} data-testid="graph-canvas">
          {empty && (
            <p className="graph-hint" data-testid="graph-none">
              到这一章为止，还没有已确认的人物或关系。
              {pendingTotal > 0 ? "可以勾选“显示待确认”先看看史官的候选。" : ""}
            </p>
          )}
          <div
            className="graph-world"
            style={{
              width: WORLD.width,
              height: WORLD.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
            }}
          >
            <svg
              className="graph-edges"
              width={WORLD.width}
              height={WORLD.height}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="graph-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
                </marker>
              </defs>
              {graph.edges.map((edge) => {
                const a = positions.get(edge.source);
                const b = positions.get(edge.target);
                if (!a || !b) return null;
                const start = clip(a, b);
                const end = clip(b, a);
                return (
                  <line
                    key={edge.id}
                    className={`graph-edge ${edge.pending ? "pending" : ""} ${selection?.kind === "edge" && selection.id === edge.id ? "on" : ""}`}
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    markerEnd="url(#graph-arrow)"
                  />
                );
              })}
            </svg>
            {graph.edges.map((edge) => {
              const a = positions.get(edge.source);
              const b = positions.get(edge.target);
              if (!a || !b) return null;
              return (
                <button
                  key={`label-${edge.id}`}
                  type="button"
                  className={`graph-edge-label ${edge.pending ? "pending" : ""} ${selection?.kind === "edge" && selection.id === edge.id ? "on" : ""}`}
                  style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 }}
                  onClick={() => setSelection({ kind: "edge", id: edge.id })}
                  data-testid={`graph-edge-${edge.source}-${edge.target}`}
                  aria-label={`${edge.source}与${edge.target}：${edge.label}`}
                >
                  {edge.label}
                </button>
              );
            })}
            {graph.nodes.map((node) => {
              const at = positions.get(node.id);
              if (!at) return null;
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`graph-node ${node.pending ? "pending" : ""} ${selection?.kind === "node" && selection.id === node.id ? "on" : ""}`}
                  style={{
                    left: at.x,
                    top: at.y,
                    width: NODE_W,
                    height: NODE_H,
                  }}
                  onClick={() => setSelection({ kind: "node", id: node.id })}
                  data-testid={`graph-node-${node.id}`}
                  aria-pressed={
                    selection?.kind === "node" && selection.id === node.id
                  }
                  title={node.label}
                >
                  {node.label}
                </button>
              );
            })}
          </div>
        </div>
        <aside
          className="graph-detail"
          aria-label="详情"
          data-testid="graph-detail"
        >
          {simOpen && current ? (
            <Simulation
              candidates={candidates}
              chapter={current.chapter}
              chapterLabel={current.label}
              state={sim}
              setState={(update) => setSim(update)}
            />
          ) : null}
          {!simOpen && selectedNode && (
            <div className="graph-tabs" role="tablist" aria-label="人物">
              {(
                [
                  ["detail", "详情"],
                  ["interview", "采访"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={detailTab === id}
                  className={detailTab === id ? "on" : ""}
                  onClick={() => setDetailTab(id)}
                  data-testid={`graph-tab-${id}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {simOpen ? null : selectedNode &&
            detailTab === "interview" &&
            current ? (
            <Interview
              node={selectedNode.id}
              chapter={current.chapter}
              chapterLabel={current.label}
              talk={
                talks[`${selectedNode.id}@${current.chapter}`] ?? emptyTalk()
              }
              setTalk={(update) =>
                setTalks((all) => {
                  const key = `${selectedNode.id}@${current.chapter}`;
                  return { ...all, [key]: update(all[key] ?? emptyTalk()) };
                })
              }
            />
          ) : selectedNode ? (
            <NodeDetail
              node={selectedNode}
              edges={graph.edges.filter(
                (edge) =>
                  edge.source === selectedNode.id ||
                  edge.target === selectedNode.id,
              )}
              timeline={timeline}
              onPick={(id) => setSelection({ kind: "node", id })}
            />
          ) : selectedEdge ? (
            <EdgeDetail edge={selectedEdge} />
          ) : (
            <p className="graph-detail-empty">
              点人物或关系查看详情和原文出处；点人物后可以切到“采访”，以他的身份提问。拖动滑块可以回到更早的章节，看当时的人物与关系。
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function JumpButton({ fact }: { fact: NovelFact }) {
  const selectChapter = useWorkbench((s) => s.selectChapter);
  const setView = useWorkbench((s) => s.setView);
  const setPaperTab = useWorkbench((s) => s.setPaperTab);
  return (
    <button
      type="button"
      className="graph-jump"
      onClick={() => {
        void selectChapter(fact.chapter);
        setPaperTab("paper");
        setView("workspace");
      }}
      data-testid="graph-jump"
    >
      {chapterLabel(fact.chapter)} ↗
    </button>
  );
}

function FactItem({ fact }: { fact: NovelFact }) {
  return (
    <li
      className={`graph-fact ${fact.status === "proposed" ? "pending" : ""}`}
      data-testid="graph-fact"
    >
      <div className="graph-fact-head">
        <span className="tag">{FACT_KIND_LABELS[fact.kind]}</span>
        {fact.status === "proposed" && <span className="tag">待确认</span>}
        <JumpButton fact={fact} />
      </div>
      <p>
        {fact.kind === "relation"
          ? `${fact.subject} →${fact.relation}→ ${fact.object}：${fact.statement}`
          : fact.statement}
      </p>
      <q className="fact-quote">{fact.quote}</q>
    </li>
  );
}

function NodeDetail({
  node,
  edges,
  timeline,
  onPick,
}: {
  node: FactGraphNode;
  edges: FactGraphEdge[];
  timeline: ReturnType<typeof graphTimeline>;
  onPick: (id: string) => void;
}) {
  const first = timeline[node.firstIndex];
  return (
    <div className="graph-detail-body" data-testid="node-detail">
      <h2>{node.label}</h2>
      <p className="graph-meta">
        首次出现：{first?.label ?? "—"}
        {node.pending ? " · 尚未确认" : ""}
      </p>
      {node.state && (
        <section>
          <h3>当前状态</h3>
          <p className="graph-state" data-testid="node-state">
            {node.state.statement}
            <small>（{chapterLabel(node.state.chapter)}）</small>
          </p>
        </section>
      )}
      <section>
        <h3>关系（{edges.length}）</h3>
        {edges.length === 0 ? (
          <p className="muted">到这一章为止还没有关系。</p>
        ) : (
          <ul className="graph-links">
            {edges.map((edge) => {
              const other = edge.source === node.id ? edge.target : edge.source;
              return (
                <li key={edge.id}>
                  <button
                    type="button"
                    className={edge.pending ? "pending" : ""}
                    onClick={() => onPick(other)}
                  >
                    <span>
                      {edge.source === node.id
                        ? `→ ${edge.label} → `
                        : `← ${edge.label} ← `}
                    </span>
                    <strong>{other}</strong>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section>
        <h3>出处（{node.facts.length}）</h3>
        <ul className="graph-facts">
          {node.facts.map((fact) => (
            <FactItem key={fact.id} fact={fact} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function EdgeDetail({ edge }: { edge: FactGraphEdge }) {
  return (
    <div className="graph-detail-body" data-testid="edge-detail">
      <h2>
        {edge.source} → {edge.target}
      </h2>
      <p className="graph-meta">
        当前关系：<strong>{edge.label}</strong>
        {edge.pending ? " · 尚未确认" : ""}
      </p>
      <section>
        <h3>变化过程（{edge.history.length}）</h3>
        <ul className="graph-facts">
          {edge.history.map((fact) => (
            <FactItem key={fact.id} fact={fact} />
          ))}
        </ul>
      </section>
    </div>
  );
}
