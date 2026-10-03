import { ChevronsUpDown, FolderPlus, Plus, RotateCw } from "lucide-react";
import { AGENTS, WORKER_LABEL } from "../lib/agents";
import { useWorkbench } from "../state/store";
import { Seal } from "./Seal";

export function SessionPanel() {
  const project = useWorkbench((s) => s.project);
  const sessions = useWorkbench((s) => s.sessions);
  const activeId = useWorkbench((s) => s.activeSessionId);
  const worker = useWorkbench((s) => s.worker);
  const activeRunId = useWorkbench((s) => s.activeRunId);
  const sessionActions = useWorkbench.getState();

  const working = (agentId: string): boolean =>
    sessions.some((session) => session.items.some((item) => item.kind === "agent" && item.agentId === agentId && (item.status === "thinking" || item.status === "streaming")));

  return (
    <aside className="sessions" aria-label="项目与会话">
      <div className="sessions-scroll">
        {project.folder ? (
          <button className="project-card" onClick={() => void sessionActions.linkFolder()} data-testid="project-card">
            <span className="project-name">{project.name}</span>
            <ChevronsUpDown size={14} strokeWidth={1.5} aria-hidden="true" />
            <span className="project-path" title={project.folder}>{project.folder}</span>
          </button>
        ) : (
          <button className="project-card empty" onClick={() => void sessionActions.linkFolder()} data-testid="link-folder">
            <FolderPlus size={18} strokeWidth={1.5} aria-hidden="true" />
            <span>
              <strong>链接写作文件夹</strong>
              <small>稿件与设定都保存在这里</small>
            </span>
          </button>
        )}

        <div className="section-head">
          <span>会话</span>
          <button className="icon-btn sm tip tip-below" data-tip="新会话" aria-label="新会话" onClick={sessionActions.newSession}>
            <Plus size={15} strokeWidth={1.5} />
          </button>
        </div>
        <ul className="session-list" role="list">
          {sessions.map((session) => (
            <li key={session.id}>
              <button className={`session-row ${session.id === activeId ? "active" : ""}`} onClick={() => sessionActions.selectSession(session.id)}>
                <span className="session-title">{session.title}</span>
                {session.items.some((item) => item.kind === "approval" && !item.resolved) && <span className="badge-dot" title="有待裁决事项" />}
              </button>
            </li>
          ))}
        </ul>

        <div className="section-head"><span>Agents</span></div>
        <ul className="agent-list" role="list">
          {AGENTS.map((agent) => (
            <li key={agent.id}>
              <button className="agent-row" onClick={() => sessionActions.mention(agent.name)} title={`@${agent.name} · ${agent.role}`}>
                <Seal glyph={agent.glyph} color={agent.color} size={22} />
                <span className="agent-name">{agent.name}</span>
                {working(agent.id) ? <span className="pulse-dot" aria-label="工作中" /> : <span className="agent-model">{agent.model.replace("deepseek-", "")}</span>}
              </button>
            </li>
          ))}
          <li>
            <button className="agent-row add" disabled title="自建 Agent 将在 M5 开放">
              <span className="seal-add"><Plus size={13} strokeWidth={1.5} /></span>
              <span className="agent-name">新建 Agent</span>
            </button>
          </li>
        </ul>
      </div>

      <footer className="sessions-foot">
        <span className={`status-dot ${worker} ${activeRunId ? "busy" : ""}`} aria-hidden="true" />
        <span data-testid="worker-status">{WORKER_LABEL[activeRunId ? "busy" : worker]}</span>
        {(worker === "crashed" || worker === "stopped") && (
          <button className="icon-btn sm tip" data-tip="重启后台" aria-label="重启后台" onClick={() => void sessionActions.restartWorker()}>
            <RotateCw size={14} strokeWidth={1.5} />
          </button>
        )}
      </footer>
    </aside>
  );
}
