import { ChevronsUpDown, FolderPlus, Plus, RotateCw } from "lucide-react";
import type { CommandResults } from "@wordhub/contracts";
import { useCallback, useEffect, useState } from "react";
import { AGENTS, WORKER_LABEL } from "../lib/agents";
import { pickReasoning, shortModel } from "../lib/models";
import { useWorkbench } from "../state/store";
import { Seal } from "./Seal";

type ModelData = CommandResults["settings.models"];

export function SessionPanel() {
  const project = useWorkbench((s) => s.project);
  const sessions = useWorkbench((s) => s.sessions);
  const activeId = useWorkbench((s) => s.activeSessionId);
  const worker = useWorkbench((s) => s.worker);
  const activeRunId = useWorkbench((s) => s.activeRunId);
  const modelsVersion = useWorkbench((s) => s.modelsVersion);
  const sessionActions = useWorkbench.getState();
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const reloadModels = useCallback(() => {
    void window.wordhub
      ?.invoke("settings.models", undefined)
      .then(setModelData)
      .catch(() => undefined);
  }, []);
  // 切换项目、设置页或这里改了模型后重新读取；项目文件夹不同，逐 Agent 配置也可能不同。
  useEffect(reloadModels, [reloadModels, modelsVersion, project.folder]);

  const working = (agentId: string): boolean =>
    sessions.some((session) =>
      session.items.some(
        (item) =>
          item.kind === "agent" &&
          item.agentId === agentId &&
          (item.status === "thinking" || item.status === "streaming"),
      ),
    );

  /** 当前会话里该 Agent 最近一次实际运行所用的模型（来自 run.started）。 */
  const lastUsed = (agentId: string) => {
    const items = sessions.find((session) => session.id === activeId)?.items;
    for (let i = (items?.length ?? 0) - 1; i >= 0; i -= 1) {
      const item = items?.[i];
      if (item?.kind === "agent" && item.agentId === agentId && item.model)
        return { model: item.model, reasoning: item.reasoningLevel };
    }
    return undefined;
  };
  const saveModel = (
    agentId: string,
    model: { provider: string; id: string; reasoning: string },
  ) =>
    void window.wordhub
      ?.invoke("settings.setAgentModel", { agentId, model })
      .then(() => sessionActions.bumpModels());

  return (
    <aside className="sessions" aria-label="项目与会话">
      <div className="sessions-scroll">
        {project.folder ? (
          <button
            className="project-card"
            onClick={() => void sessionActions.linkFolder()}
            data-testid="project-card"
          >
            <span className="project-name">{project.name}</span>
            <ChevronsUpDown size={14} strokeWidth={1.5} aria-hidden="true" />
            <span className="project-path" title={project.folder}>
              {project.folder}
            </span>
          </button>
        ) : (
          <button
            className="project-card empty"
            onClick={() => void sessionActions.linkFolder()}
            data-testid="link-folder"
          >
            <FolderPlus size={18} strokeWidth={1.5} aria-hidden="true" />
            <span>
              <strong>链接写作文件夹</strong>
              <small>稿件与设定都保存在这里</small>
            </span>
          </button>
        )}

        <div className="section-head">
          <span>会话</span>
          <button
            className="icon-btn sm tip tip-below"
            data-tip="新会话"
            aria-label="新会话"
            onClick={sessionActions.newSession}
          >
            <Plus size={15} strokeWidth={1.5} />
          </button>
        </div>
        <ul className="session-list" role="list">
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                className={`session-row ${session.id === activeId ? "active" : ""}`}
                onClick={() => sessionActions.selectSession(session.id)}
              >
                <span className="session-title">{session.title}</span>
                {session.items.some(
                  (item) => item.kind === "approval" && !item.resolved,
                ) && <span className="badge-dot" title="有待裁决事项" />}
              </button>
            </li>
          ))}
        </ul>

        <div className="section-head">
          <span>Agents</span>
        </div>
        <ul className="agent-list" role="list">
          {AGENTS.map((agent) => {
            const configured = modelData?.agents.find(
              (item) => item.id === agent.id,
            )?.model;
            const used = lastUsed(agent.id);
            const isWorking = working(agent.id);
            // 运行中显示实际在用的模型，否则显示已配置的模型
            const shownId =
              isWorking && used ? used.model : (configured?.id ?? agent.model);
            const shownReasoning =
              isWorking && used?.reasoning
                ? used.reasoning
                : (configured?.reasoning ?? agent.reasoning);
            const mentionable = agent.id !== "observer";
            const providers = modelData?.providers ?? [];
            const currentModel = providers
              .find((item) => item.id === configured?.provider)
              ?.models.find((item) => item.id === configured?.id);
            const levels = currentModel?.supportedReasoning ?? [
              configured?.reasoning ?? agent.reasoning,
            ];
            return (
              <li key={agent.id} data-testid={`agent-${agent.id}`}>
                <div className="agent-line">
                  <button
                    className="agent-row"
                    onClick={() =>
                      mentionable && sessionActions.mention(agent.name)
                    }
                    title={
                      mentionable
                        ? `@${agent.name} · ${agent.role}`
                        : `${agent.name} · ${agent.role}（定稿时自动运行，不单独对话）`
                    }
                  >
                    <Seal glyph={agent.glyph} color={agent.color} size={22} />
                    <span className="agent-name">{agent.name}</span>
                    {isWorking && (
                      <span className="pulse-dot" aria-label="工作中" />
                    )}
                  </button>
                  <button
                    className="agent-model agent-model-btn"
                    data-testid={`agent-model-${agent.id}`}
                    onClick={() =>
                      setPickerFor(pickerFor === agent.id ? null : agent.id)
                    }
                    title={
                      used
                        ? `已配置 ${configured?.provider ?? ""}/${configured?.id ?? ""} · 最近一次实际使用 ${used.model}${used.reasoning ? ` / ${used.reasoning}` : ""}。点击切换`
                        : `已配置 ${configured?.provider ?? ""}/${configured?.id ?? ""}。点击切换`
                    }
                    aria-label={`${agent.name}的模型`}
                  >
                    {shortModel(shownId)} · {shownReasoning}
                  </button>
                </div>
                {pickerFor === agent.id && configured && (
                  <div className="agent-picker" data-testid="agent-picker">
                    <select
                      className="text-input mono"
                      value={`${configured.provider}/${configured.id}`}
                      aria-label={`${agent.name}模型`}
                      onChange={(event) => {
                        // 模型ID本身可含斜杠（如OpenRouter），只按第一个斜杠拆分
                        const value = event.target.value;
                        const slash = value.indexOf("/");
                        if (slash < 1) return;
                        const provider = value.slice(0, slash);
                        const id = value.slice(slash + 1);
                        const supported =
                          providers
                            .find((item) => item.id === provider)
                            ?.models.find((item) => item.id === id)
                            ?.supportedReasoning ?? [];
                        saveModel(agent.id, {
                          provider,
                          id,
                          reasoning: pickReasoning(
                            supported,
                            configured.reasoning,
                          ),
                        });
                      }}
                    >
                      {providers.map((provider) => (
                        <optgroup key={provider.id} label={provider.label}>
                          {provider.models.map((model) => (
                            <option
                              key={`${provider.id}/${model.id}`}
                              value={`${provider.id}/${model.id}`}
                            >
                              {model.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <select
                      className="text-input mono"
                      value={configured.reasoning}
                      aria-label={`${agent.name}思考强度`}
                      onChange={(event) =>
                        saveModel(agent.id, {
                          provider: configured.provider,
                          id: configured.id,
                          reasoning: event.target.value,
                        })
                      }
                    >
                      {levels.map((level) => (
                        <option key={level} value={level}>
                          思考 {level}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </li>
            );
          })}
          <li>
            <button
              className="agent-row add"
              disabled
              title="自建 Agent 将在 M5 开放"
            >
              <span className="seal-add">
                <Plus size={13} strokeWidth={1.5} />
              </span>
              <span className="agent-name">新建 Agent</span>
            </button>
          </li>
        </ul>
      </div>

      <footer className="sessions-foot">
        <span
          className={`status-dot ${worker} ${activeRunId ? "busy" : ""}`}
          aria-hidden="true"
        />
        <span data-testid="worker-status">
          {WORKER_LABEL[activeRunId ? "busy" : worker]}
        </span>
        {(worker === "crashed" || worker === "stopped") && (
          <button
            className="icon-btn sm tip"
            data-tip="重启后台"
            aria-label="重启后台"
            onClick={() => void sessionActions.restartWorker()}
          >
            <RotateCw size={14} strokeWidth={1.5} />
          </button>
        )}
      </footer>
    </aside>
  );
}
