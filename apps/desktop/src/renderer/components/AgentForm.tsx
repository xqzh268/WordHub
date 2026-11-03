import { useEffect, useMemo, useState } from "react";
import type { AgentFormPayload, CommandResults } from "@wordhub/contracts";
import { cleanIpcError } from "../lib/errors";
import { pickReasoning } from "../lib/models";
import { useWorkbench } from "../state/store";

type ModelData = CommandResults["settings.models"];

const READ_TOOLS: Array<{ name: string; label: string }> = [
  { name: "doc.read", label: "读章节" },
  { name: "bible.read", label: "读设定集" },
  { name: "history.search", label: "搜对话记录" },
  { name: "history.get", label: "查看历史详情" },
  { name: "question.ask", label: "向我提问" },
  // 一个勾选对应参考库的三个只读工具（列出、检索、阅读）
  { name: "reference.read", label: "查阅参考库" },
];
const WRITE_LEVELS: Array<{
  id: AgentFormPayload["write"];
  label: string;
  hint: string;
}> = [
  { id: "none", label: "只读", hint: "只读取、分析、回答，不改任何文件" },
  { id: "propose", label: "只提出修改", hint: "给出修改方案，不直接落盘" },
  {
    id: "write",
    label: "直接写入",
    hint: "在所选范围内写文件，每次都是可撤销的修订",
  },
];
const WRITE_SCOPES: Array<{ id: string; label: string }> = [
  { id: "chapters/**", label: "章节（chapters/）" },
  { id: ".wordhub/bible/**", label: "设定集（.wordhub/bible/）" },
];
const READ_SCOPES: Array<{ id: string; label: string }> = [
  { id: "chapters", label: "章节" },
  { id: "bible", label: "设定集" },
  { id: "outline", label: "大纲" },
  { id: "references", label: "参考库" },
];
const COLORS = [
  "#3f6b8f",
  "#9a6a3c",
  "#4f7a58",
  "#a8483a",
  "#7b5ea0",
  "#2f7f86",
  "#a07a2e",
  "#6b6b6b",
];

const suffix = () => Math.random().toString(36).slice(2, 6);

type Draft = {
  name: string;
  displayName: string;
  description: string;
  prompt: string;
  provider: string;
  modelId: string;
  reasoning: string;
  readTools: string[];
  write: AgentFormPayload["write"];
  writeScopes: string[];
  readScopes: string[];
  confirmBeforeWrite: boolean;
  maxTurns: string;
  glyph: string;
  color: string;
};

/** 写入类工具由“写权限 + 写入范围”推出，避免勾出自相矛盾的组合。 */
function deriveTools(draft: Draft): string[] {
  const tools = draft.readTools.flatMap((tool) =>
    tool === "reference.read"
      ? ["reference.list", "reference.search", "reference.read"]
      : [tool],
  );
  if (draft.write === "none") return tools;
  if (draft.writeScopes.includes("chapters/**"))
    tools.push(draft.write === "write" ? "doc.write" : "doc.propose");
  if (draft.writeScopes.includes(".wordhub/bible/**"))
    tools.push("bible.propose");
  return tools;
}

export function AgentForm({
  models,
  editing,
  onClose,
}: {
  models: ModelData;
  /** 编辑已有的自建 Agent 时的标识；新建为 null */
  editing: string | null;
  onClose: () => void;
}) {
  const bumpModels = useWorkbench((s) => s.bumpModels);
  const [loading, setLoading] = useState(Boolean(editing));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fallbackModel = models.agents.find((agent) => agent.id === "writer")
    ?.model ?? { provider: "deepseek", id: "deepseek-flash", reasoning: "low" };
  const [draft, setDraft] = useState<Draft>(() => ({
    name: `agent-${suffix()}`,
    displayName: "",
    description: "",
    prompt: "",
    provider: fallbackModel.provider,
    modelId: fallbackModel.id,
    reasoning: fallbackModel.reasoning,
    readTools: ["doc.read", "bible.read"],
    write: "none",
    writeScopes: [],
    readScopes: ["chapters", "bible", "outline"],
    confirmBeforeWrite: true,
    maxTurns: "8",
    glyph: "",
    color: COLORS[0] ?? "#3f6b8f",
  }));
  const patch = (next: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...next }));

  useEffect(() => {
    if (!editing || !window.wordhub) return;
    void window.wordhub
      .invoke("agent.get", { name: editing })
      .then((agent) =>
        setDraft({
          name: agent.name,
          displayName: agent.displayName,
          description: agent.description,
          prompt: agent.prompt,
          provider: agent.model.provider,
          modelId: agent.model.id,
          reasoning: agent.model.reasoning,
          readTools: agent.tools.filter((tool) =>
            READ_TOOLS.some((item) => item.name === tool),
          ),
          write: agent.write,
          writeScopes: agent.writeScopes,
          readScopes: agent.readScopes,
          confirmBeforeWrite: agent.confirmBeforeWrite,
          maxTurns: String(agent.maxTurns),
          glyph: agent.avatar?.glyph ?? "",
          color: agent.avatar?.color ?? COLORS[0] ?? "#3f6b8f",
        }),
      )
      .catch((cause) => setError(cleanIpcError(cause)))
      .finally(() => setLoading(false));
  }, [editing]);

  const provider = models.providers.find((item) => item.id === draft.provider);
  const model = provider?.models.find((item) => item.id === draft.modelId);
  const levels = model?.supportedReasoning ?? [draft.reasoning];
  const tools = useMemo(() => deriveTools(draft), [draft]);
  const toggle = (list: string[], value: string): string[] =>
    list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value];

  const submit = async () => {
    if (!window.wordhub) return;
    if (draft.write !== "none" && draft.writeScopes.length === 0) {
      setError("选择了写权限，请至少选择一个写入范围（章节或设定集）。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const glyph =
        draft.glyph.trim() || Array.from(draft.displayName.trim())[0] || "";
      await window.wordhub.invoke("agent.save", {
        mode: editing ? "update" : "create",
        agent: {
          name: draft.name.trim(),
          displayName: draft.displayName.trim(),
          description: draft.description.trim(),
          prompt: draft.prompt,
          model: {
            provider: draft.provider,
            id: draft.modelId,
            reasoning: draft.reasoning,
          },
          tools,
          write: draft.write,
          writeScopes: draft.write === "none" ? [] : draft.writeScopes,
          // 勾选了参考库工具就带上参考库读取范围，免得提交后被校验拒绝
          readScopes: draft.readTools.includes("reference.read")
            ? [...new Set([...draft.readScopes, "references"])]
            : draft.readScopes,
          confirmBeforeWrite: draft.confirmBeforeWrite,
          maxTurns: Number(draft.maxTurns),
          avatar: { glyph, color: draft.color },
        },
      });
      bumpModels();
      onClose();
    } catch (cause) {
      setError(cleanIpcError(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing || !window.wordhub) return;
    if (
      !window.confirm(
        `删除自建 Agent“${draft.displayName}”？已有的对话记录会保留。`,
      )
    )
      return;
    setBusy(true);
    try {
      await window.wordhub.invoke("agent.delete", { name: editing });
      bumpModels();
      onClose();
    } catch (cause) {
      setError(cleanIpcError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <button
        type="button"
        className="modal-scrim"
        aria-label="关闭"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        className="agent-form"
        role="dialog"
        aria-label={editing ? "编辑 Agent" : "新建 Agent"}
        data-testid="agent-form"
      >
        <h2>{editing ? "编辑 Agent" : "新建 Agent"}</h2>
        {loading ? (
          <p className="section-note">读取中…</p>
        ) : (
          <>
            <label>
              <span>显示名</span>
              <input
                className="text-input"
                value={draft.displayName}
                onChange={(event) => patch({ displayName: event.target.value })}
                placeholder="如：校对（也用于 @校对）"
                aria-label="显示名"
              />
            </label>
            <label>
              <span>标识</span>
              <input
                className="text-input mono"
                value={draft.name}
                disabled={Boolean(editing)}
                onChange={(event) => patch({ name: event.target.value })}
                placeholder="小写英文、数字、连字符"
                aria-label="标识"
              />
            </label>
            <label>
              <span>一句话描述</span>
              <input
                className="text-input"
                value={draft.description}
                onChange={(event) => patch({ description: event.target.value })}
                placeholder="它负责什么"
                aria-label="描述"
              />
            </label>
            <label className="top">
              <span>系统提示词</span>
              <textarea
                className="text-input"
                rows={6}
                value={draft.prompt}
                onChange={(event) => patch({ prompt: event.target.value })}
                placeholder="告诉它是谁、做什么、怎么做、不做什么。例如：你是校对员，只检查错别字与标点，不改情节……"
                aria-label="系统提示词"
              />
            </label>
            <label>
              <span>模型</span>
              <select
                className="text-input mono"
                value={`${draft.provider}/${draft.modelId}`}
                aria-label="模型"
                onChange={(event) => {
                  const value = event.target.value;
                  const slash = value.indexOf("/");
                  if (slash < 1) return;
                  const nextProvider = value.slice(0, slash);
                  const nextId = value.slice(slash + 1);
                  const supported =
                    models.providers
                      .find((item) => item.id === nextProvider)
                      ?.models.find((item) => item.id === nextId)
                      ?.supportedReasoning ?? [];
                  patch({
                    provider: nextProvider,
                    modelId: nextId,
                    reasoning: pickReasoning(supported, draft.reasoning),
                  });
                }}
              >
                {models.providers.map((item) => (
                  <optgroup key={item.id} label={item.label}>
                    {item.models.map((entry) => (
                      <option key={entry.id} value={`${item.id}/${entry.id}`}>
                        {entry.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <select
                className="text-input mono"
                value={draft.reasoning}
                aria-label="思考强度"
                onChange={(event) => patch({ reasoning: event.target.value })}
              >
                {levels.map((level) => (
                  <option key={level} value={level}>
                    思考 {level}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>可以读取</legend>
              {READ_TOOLS.map((tool) => (
                <label key={tool.name} className="check">
                  <input
                    type="checkbox"
                    checked={draft.readTools.includes(tool.name)}
                    onChange={() =>
                      patch({ readTools: toggle(draft.readTools, tool.name) })
                    }
                  />
                  <span>{tool.label}</span>
                </label>
              ))}
              <div className="scope-row">
                <span>读取范围</span>
                {READ_SCOPES.map((scope) => (
                  <label key={scope.id} className="check">
                    <input
                      type="checkbox"
                      checked={draft.readScopes.includes(scope.id)}
                      onChange={() =>
                        patch({
                          readScopes: toggle(draft.readScopes, scope.id),
                        })
                      }
                      aria-label={`读取范围：${scope.label}`}
                    />
                    <span>{scope.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>写权限</legend>
              {WRITE_LEVELS.map((level) => (
                <label key={level.id} className="check">
                  <input
                    type="radio"
                    name="agent-write"
                    checked={draft.write === level.id}
                    onChange={() => patch({ write: level.id })}
                    aria-label={`写权限：${level.label}`}
                  />
                  <span>
                    {level.label}
                    <small>{level.hint}</small>
                  </span>
                </label>
              ))}
              {draft.write !== "none" && (
                <>
                  <div className="scope-row">
                    <span>可写入的范围</span>
                    {WRITE_SCOPES.map((scope) => (
                      <label key={scope.id} className="check">
                        <input
                          type="checkbox"
                          checked={draft.writeScopes.includes(scope.id)}
                          onChange={() =>
                            patch({
                              writeScopes: toggle(draft.writeScopes, scope.id),
                            })
                          }
                          aria-label={`写入范围：${scope.label}`}
                        />
                        <span>{scope.label}</span>
                      </label>
                    ))}
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.confirmBeforeWrite}
                      onChange={(event) =>
                        patch({ confirmBeforeWrite: event.target.checked })
                      }
                      aria-label="写入前先让我确认"
                    />
                    <span>每次写入前先让我确认（推荐）</span>
                  </label>
                </>
              )}
            </fieldset>
            <label>
              <span>最大回合数</span>
              <input
                className="text-input mono"
                value={draft.maxTurns}
                inputMode="numeric"
                onChange={(event) => patch({ maxTurns: event.target.value })}
                aria-label="最大回合数"
              />
            </label>
            <div className="avatar-row">
              <span>头像</span>
              <input
                className="text-input"
                value={draft.glyph}
                maxLength={2}
                onChange={(event) => patch({ glyph: event.target.value })}
                placeholder={Array.from(draft.displayName)[0] ?? "字"}
                aria-label="头像字"
              />
              <span
                className="swatches"
                role="radiogroup"
                aria-label="头像颜色"
              >
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={draft.color === color}
                    aria-label={`颜色 ${color}`}
                    className={draft.color === color ? "on" : ""}
                    style={{ background: color }}
                    onClick={() => patch({ color })}
                  />
                ))}
              </span>
            </div>
            <p className="section-note">
              保存在项目的 .wordhub/agents/{draft.name || "…"}
              /AGENT.md，可用文本编辑器直接修改，也能提交到版本库。
            </p>
            {error && (
              <p
                className="section-note bad"
                role="alert"
                data-testid="agent-form-error"
              >
                {error}
              </p>
            )}
            <div className="agent-form-actions">
              {editing && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void remove()}
                  data-testid="agent-delete"
                >
                  删除
                </button>
              )}
              <span className="spacer" />
              <button type="button" className="btn" onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void submit()}
                data-testid="agent-save"
              >
                {editing ? "保存" : "创建"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
