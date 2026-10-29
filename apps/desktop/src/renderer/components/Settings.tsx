import { Monitor, Moon, Sun } from "lucide-react";
import type { CommandResults } from "@wordhub/contracts";
import { ProviderSettings } from "./ProviderSettings";
import { motion } from "motion/react";
import type { ThemePreference } from "@wordhub/contracts";
import { AGENTS } from "../lib/agents";
import { pickReasoning } from "../lib/models";
import { useWorkbench, type ReadingFont } from "../state/store";
import { Seal } from "./Seal";
import { useCallback, useEffect, useState } from "react";

type ModelData = CommandResults["settings.models"];

const THEMES: { id: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { id: "light", label: "宣纸", Icon: Sun },
  { id: "dark", label: "墨", Icon: Moon },
  { id: "system", label: "跟随系统", Icon: Monitor },
];

const READINGS: {
  id: ReadingFont;
  name: string;
  hint: string;
  sample: string;
  family: string;
}[] = [
  {
    id: "serif",
    name: "学术",
    hint: "Source Serif 4 · 思源宋体",
    sample: "暮鼓三百声，坊门次第而闭。The night begins.",
    family: "var(--font-serif)",
  },
  {
    id: "literary",
    name: "文艺",
    hint: "Newsreader · 霞鹜文楷",
    sample: "暮鼓三百声，坊门次第而闭。The night begins.",
    family: "var(--font-literary)",
  },
];

export function SettingsView() {
  const theme = useWorkbench((s) => s.theme);
  const reading = useWorkbench((s) => s.reading);
  const setTheme = useWorkbench((s) => s.setTheme);
  const setReading = useWorkbench((s) => s.setReading);
  const projectId = useWorkbench((s) => s.project.id);
  const [autoReview, setAutoReview] = useState(false);
  useEffect(() => {
    if (!projectId) return;
    void window.wordhub
      ?.invoke("project.prefs.get", { projectId })
      .then((prefs) => setAutoReview(prefs.autoReviewOnFinalize))
      .catch(() => undefined);
  }, [projectId]);
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const reloadModels = useCallback(() => {
    void window.wordhub
      ?.invoke("settings.models", undefined)
      .then((result) => setModelData(result));
  }, []);
  const modelsVersion = useWorkbench((s) => s.modelsVersion);
  const bumpModels = useWorkbench((s) => s.bumpModels);
  useEffect(reloadModels, [reloadModels, modelsVersion]);

  return (
    <div className="page selectable" data-testid="settings">
      <div className="page-inner">
        <header className="page-head">
          <h1>设置</h1>
          <p>让写作的环境，贴近你习惯的纸。</p>
        </header>

        <ProviderSettings onChanged={bumpModels} />

        <section className="panel-section">
          <h2>写作流程</h2>
          <label className="toggle-row" data-testid="auto-review-toggle">
            <input
              type="checkbox"
              checked={autoReview}
              disabled={!projectId}
              onChange={(event) => {
                const next = event.target.checked;
                setAutoReview(next);
                void window.wordhub?.invoke("project.prefs.set", {
                  projectId: projectId!,
                  autoReviewOnFinalize: next,
                });
              }}
            />
            <span>定稿后自动评审</span>
          </label>
          <p className="section-note">
            {projectId
              ? "章节定稿（史官抽取事实、写摘要）之后，自动再跑一轮评审。默认关闭。"
              : "先链接一个项目文件夹，才能设置项目级的写作流程。"}
          </p>
        </section>

        <section className="panel-section">
          <h2>外观</h2>
          <div className="field">
            <div className="field-label">
              <strong>主题</strong>
              <span>宣纸适合白天，墨适合夜里。</span>
            </div>
            <div className="seg seg-lg" role="radiogroup" aria-label="主题">
              {THEMES.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  role="radio"
                  aria-checked={theme === id}
                  className={theme === id ? "active" : ""}
                  onClick={() => setTheme(id)}
                  data-testid={`theme-${id}`}
                >
                  {theme === id && (
                    <motion.span
                      layoutId="theme-pill"
                      className="seg-pill"
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 36,
                      }}
                    />
                  )}
                  <Icon size={15} strokeWidth={1.5} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <div className="field-label">
              <strong>阅读字体</strong>
              <span>作用于纸面正文与 Agent 的长回复。</span>
            </div>
            <div
              className="reading-cards"
              role="radiogroup"
              aria-label="阅读字体"
            >
              {READINGS.map((option) => (
                <button
                  key={option.id}
                  role="radio"
                  aria-checked={reading === option.id}
                  className={`reading-card ${reading === option.id ? "active" : ""}`}
                  onClick={() => setReading(option.id)}
                  data-testid={`reading-${option.id}`}
                >
                  <span
                    className="reading-sample"
                    style={{ fontFamily: option.family }}
                  >
                    {option.sample}
                  </span>
                  <span className="reading-meta">
                    <strong>{option.name}</strong>
                    <span>{option.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="panel-section">
          <h2>模型分配</h2>
          <p className="section-note">
            为每个 Agent 选择服务商下的模型和思考强度。已链接项目时保存到项目的
            `.wordhub/agent-models.json`，否则保存为全局默认。史官在你点“定稿”时抽取事实、写章节摘要。
          </p>
          <div className="credential-row" style={{ marginBottom: 12 }}>
            <input
              className="text-input"
              value={modelFilter}
              onChange={(event) => setModelFilter(event.target.value)}
              placeholder="筛选模型（名称或ID）"
              aria-label="筛选模型"
            />
            <select
              className="text-input"
              value=""
              onChange={(event) => {
                const value = event.target.value;
                const slash = value.indexOf("/");
                if (slash < 1 || !modelData) return;
                const provider = value.slice(0, slash);
                const id = value.slice(slash + 1);
                const supported =
                  modelData.providers
                    .find((item) => item.id === provider)
                    ?.models.find((item) => item.id === id)
                    ?.supportedReasoning ?? [];
                // 必须顺序提交：每次都是读-改-写同一个 agent-models.json，并发会互相覆盖。
                void (async () => {
                  for (const agent of modelData.agents)
                    await window.wordhub?.invoke("settings.setAgentModel", {
                      agentId: agent.id,
                      model: {
                        provider,
                        id,
                        reasoning: pickReasoning(
                          supported,
                          agent.model.reasoning,
                        ),
                      },
                    });
                  bumpModels();
                })();
              }}
              aria-label="全部角色使用同一模型"
            >
              <option value="">全部角色改用…</option>
              {(modelData?.providers ?? []).map((provider) => (
                <optgroup key={provider.id} label={provider.label}>
                  {provider.models
                    .filter((model) =>
                      `${model.label} ${model.id}`
                        .toLowerCase()
                        .includes(modelFilter.trim().toLowerCase()),
                    )
                    .map((model) => (
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
          </div>
          <ul className="model-table" role="list">
            {(modelData
              ? modelData.agents
              : AGENTS.map((agent) => ({
                  id: agent.id,
                  displayName: agent.name,
                  model: {
                    provider: "deepseek",
                    id: agent.model,
                    reasoning: agent.reasoning,
                  },
                  source: "builtin",
                }))
            ).map((agent) => {
              const provider = modelData?.providers.find(
                (item) => item.id === agent.model.provider,
              );
              const selectedModel = provider?.models.find(
                (item) => item.id === agent.model.id,
              );
              const reasoningOptions = selectedModel?.supportedReasoning ?? [
                agent.model.reasoning,
              ];
              const saveModel = (model: {
                provider: string;
                id: string;
                reasoning: string;
              }) =>
                void window.wordhub
                  ?.invoke("settings.setAgentModel", {
                    agentId: agent.id,
                    model,
                  })
                  .then(bumpModels);
              return (
                <li key={agent.id}>
                  <Seal
                    glyph={
                      AGENTS.find((item) => item.id === agent.id)?.glyph ?? "A"
                    }
                    color={
                      AGENTS.find((item) => item.id === agent.id)?.color ??
                      "var(--agent-writer)"
                    }
                    size={24}
                  />
                  <span className="mt-name">{agent.displayName}</span>
                  <select
                    className="text-input mono"
                    value={`${agent.model.provider}/${agent.model.id}`}
                    onChange={(event) => {
                      // 模型ID本身可含"/"（如OpenRouter），只按第一个"/"拆分。
                      const value = event.target.value;
                      const slash = value.indexOf("/");
                      const provider = value.slice(0, slash);
                      const id = value.slice(slash + 1);
                      if (slash < 1 || !id) return;
                      const providerModel = modelData?.providers
                        .find((item) => item.id === provider)
                        ?.models.find((item) => item.id === id);
                      saveModel({
                        provider,
                        id,
                        reasoning: pickReasoning(
                          providerModel?.supportedReasoning ?? [],
                          agent.model.reasoning,
                        ),
                      });
                    }}
                    aria-label={`${agent.displayName}模型`}
                  >
                    {(modelData?.providers ?? []).map((provider) => (
                      <optgroup key={provider.id} label={provider.label}>
                        {provider.models
                          .filter(
                            (model) =>
                              (provider.id === agent.model.provider &&
                                model.id === agent.model.id) ||
                              `${model.label} ${model.id}`
                                .toLowerCase()
                                .includes(modelFilter.trim().toLowerCase()),
                          )
                          .map((model) => (
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
                    value={agent.model.reasoning}
                    onChange={(event) =>
                      saveModel({
                        provider: agent.model.provider,
                        id: agent.model.id,
                        reasoning: event.target.value,
                      })
                    }
                    aria-label={`${agent.displayName}思考强度`}
                  >
                    {reasoningOptions.map((level) => (
                      <option key={level} value={level}>
                        思考 {level}
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel-section about">
          <h2>关于</h2>
          <p>
            文枢 WordHub <span className="mono">0.1.0-alpha</span> · 以 AGPL-3.0
            开源。
          </p>
          <p className="section-note">
            字体：Inter、Source Serif 4、Newsreader、Fraunces、思源宋体 /
            黑体、霞鹜文楷、JetBrains Mono，均为 OFL 许可。
          </p>
        </section>
      </div>
    </div>
  );
}
