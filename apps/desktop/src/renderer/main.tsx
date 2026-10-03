import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppEvent, WorkspaceSnapshot } from "@wordhub/contracts";
import "./styles.css";

const seed: WorkspaceSnapshot = { projectName: "未命名项目", linkedFolder: null, worker: "offline" };

function App() {
  const [snapshot, setSnapshot] = useState(seed);
  const [prompt, setPrompt] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [stream, setStream] = useState<string[]>([]);
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    void window.wordhub.invoke("workspace.getSnapshot", undefined).then(setSnapshot);
    return window.wordhub.subscribe((event: AppEvent) => {
      if (event.type === "worker.state") setSnapshot((current) => ({ ...current, worker: (event.payload as { state: WorkspaceSnapshot["worker"] }).state }));
      if (event.type !== "run.event") return;
      const message = event.payload as { type?: string; runId?: string; delta?: string };
      if (message.type) setEvents((current) => [...current.slice(-14), message.type as string]);
      if (message.type === "run.text" && message.delta) setStream((current) => [...current, message.delta as string]);
    });
  }, []);

  const statusLabel = useMemo(() => ({ offline: "离线", starting: "启动中", ready: "待命", busy: "工作中", stopped: "已停止", crashed: "已崩溃" })[snapshot.worker], [snapshot.worker]);

  async function linkFolder() {
    const result = await window.wordhub.invoke("workspace.chooseFolder", undefined);
    const selectedPath = result.path;
    if (selectedPath) setSnapshot((current) => ({ ...current, linkedFolder: selectedPath, projectName: selectedPath.split(/[\\/]/).pop() ?? current.projectName }));
  }

  async function startRun() {
    if (!prompt.trim()) return;
    setStream([]);
    const result = await window.wordhub.invoke("run.start", { prompt, projectPath: snapshot.linkedFolder ?? undefined });
    setRunId(result.runId);
  }

  async function abortRun() {
    if (!runId) return;
    await window.wordhub.invoke("run.abort", { runId });
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">文</span><div><strong>文枢</strong><small>WORDHUB</small></div></div>
        <button className="new-project" onClick={linkFolder}>＋ 链接写作文件夹</button>
        <div className="section-label">项目</div>
        <div className="project-card active"><span className="project-dot" />{snapshot.projectName}<small>{snapshot.linkedFolder ?? "尚未链接本地文件夹"}</small></div>
        <div className="section-label">会话</div>
        <div className="session-row active"><span>◌</span>新建小说工作台</div>
        <div className="session-row"><span>◌</span>最近的写作</div>
        <div className="sidebar-footer"><span className={`status-dot ${snapshot.worker}`} />后台Agent：{statusLabel}</div>
      </aside>
      <section className="conversation">
        <header className="topbar"><div><small>PROJECT / {snapshot.projectName}</small><h1>小说工作台</h1></div><div className="top-actions"><button aria-label="设置">⚙</button><button aria-label="更多">•••</button></div></header>
        <div className="timeline">
          <div className="welcome-card"><div className="stamp">○</div><div><strong>纲领 Agent</strong><p>准备好把一个念头写成完整的故事了吗？从一句话开始，我会和你一起搭好世界。</p></div></div>
          {stream.length > 0 && <div className="stream-card"><div className="stamp ink">写</div><div><strong>Pi后台进程</strong><p>{stream.join("")}</p></div></div>}
          {events.length > 0 && <div className="event-strip">{events.map((event, index) => <span key={`${event}-${index}`}>{event}</span>)}</div>}
        </div>
        <div className="composer"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="告诉纲领 Agent，你想写一个怎样的故事……" rows={3} /><div className="composer-actions"><span>⌘ Enter 发送</span><div><button className="ghost" onClick={abortRun} disabled={!runId}>暂停</button><button className="send" onClick={startRun}>发送 ↗</button></div></div></div>
      </section>
      <aside className="paper-column"><div className="paper-tabs"><span className="selected">纸面</span><span>大纲</span><span>事实</span></div><article className="paper"><div className="paper-kicker">DRAFT · 01</div><h2>长安夜</h2><p className="paper-subtitle">一部唐代悬疑短篇</p><hr /><h3>尚未开始</h3><p>你的第一章会在确认写作计划后出现在这里。Agent的提议会以修订版本保存，随时可以撤销。</p><div className="paper-note">⌁ 版本 0 · 等待纲领</div></article></aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
