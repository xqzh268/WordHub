import { Monitor, Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import type { ThemePreference } from "@wordhub/contracts";
import { AGENTS } from "../lib/agents";
import { useWorkbench, type ReadingFont } from "../state/store";
import { Seal } from "./Seal";
import { useEffect, useState } from "react";

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
  const [secret, setSecret] = useState("");
  const [credentialState, setCredentialState] = useState<{
    configured: boolean;
    source?: "saved" | "environment" | "none";
    encryptionAvailable: boolean;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [modelData, setModelData] = useState<Awaited<
    ReturnType<NonNullable<typeof window.wordhub>["invoke"]>
  > | null>(null);

  useEffect(() => {
    void window.wordhub
      ?.invoke("settings.credentialStatus", undefined)
      .then((result) => setCredentialState(result));
    void window.wordhub
      ?.invoke("settings.models", undefined)
      .then((result) => setModelData(result));
  }, []);

  const saveCredential = async () => {
    if (!secret.trim()) return;
    await window.wordhub?.invoke("settings.setCredential", {
      provider: "deepseek",
      secret,
    });
    setSecret("");
    setSaved(true);
    setCredentialState((state) =>
      state ? { ...state, configured: true, source: "saved" } : state,
    );
  };

  return (
    <div className="page selectable" data-testid="settings">
      <div className="page-inner">
        <header className="page-head">
          <h1>设置</h1>
          <p>让写作的环境，贴近你习惯的纸。</p>
        </header>

        <section className="panel-section">
          <h2>服务商与密钥</h2>
          <div className="field">
            <div className="field-label">
              <strong>DeepSeek</strong>
              <span>
                {credentialState?.encryptionAvailable === false
                  ? "系统安全存储不可用"
                  : credentialState?.source === "environment"
                    ? "使用系统环境变量密钥"
                    : credentialState?.configured
                      ? "密钥已加密保存"
                      : "尚未配置密钥"}
              </span>
            </div>
            <div className="credential-row">
              <input
                className="text-input mono"
                type="password"
                value={secret}
                onChange={(event) => {
                  setSecret(event.target.value);
                  setSaved(false);
                }}
                placeholder="输入API key，不会回显"
                aria-label="DeepSeek API key"
              />
              <button
                className="btn btn-primary"
                onClick={() => void saveCredential()}
                disabled={
                  !secret.trim() ||
                  credentialState?.encryptionAvailable === false
                }
              >
                {saved ? "已保存" : "保存"}
              </button>
              <button
                className="btn"
                onClick={() =>
                  void window.wordhub
                    ?.invoke("settings.testConnection", {
                      provider: "deepseek",
                    })
                    .then((result) => setConnectionMessage(result.message))
                }
              >
                测试连接
              </button>
            </div>
            {connectionMessage && (
              <p className="section-note">{connectionMessage}</p>
            )}
          </div>
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
            模型和思考强度保存到当前项目的`.wordhub/agent-models.json`。
          </p>
          <ul className="model-table" role="list">
            {(modelData && "agents" in modelData
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
              const provider =
                modelData && "providers" in modelData
                  ? modelData.providers.find(
                      (item) => item.id === agent.model.provider,
                    )
                  : undefined;
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
                  .then(
                    () =>
                      void window.wordhub
                        ?.invoke("settings.models", undefined)
                        .then((result) => setModelData(result)),
                  );
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
                      const [provider, id] = event.target.value.split("/");
                      if (!provider || !id) return;
                      const providerModel =
                        modelData && "providers" in modelData
                          ? modelData.providers
                              .find((item) => item.id === provider)
                              ?.models.find((item) => item.id === id)
                          : undefined;
                      const supported = providerModel?.supportedReasoning ?? [];
                      const reasoning = supported.includes(
                        agent.model.reasoning as (typeof supported)[number],
                      )
                        ? agent.model.reasoning
                        : (supported[0] ?? agent.model.reasoning);
                      saveModel({ provider, id, reasoning });
                    }}
                    aria-label={`${agent.displayName}模型`}
                  >
                    {(modelData && "providers" in modelData
                      ? modelData.providers
                      : []
                    ).flatMap((provider) =>
                      provider.models.map((model) => (
                        <option
                          key={`${provider.id}/${model.id}`}
                          value={`${provider.id}/${model.id}`}
                        >
                          {model.label}
                        </option>
                      )),
                    )}
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
