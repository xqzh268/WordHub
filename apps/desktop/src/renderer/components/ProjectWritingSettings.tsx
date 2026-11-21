import type { CommandPayloads, CommandResults } from "@wordhub/contracts";
import { useEffect, useId, useState } from "react";
import { cleanIpcError } from "../lib/errors";

type ProjectPrefs = CommandResults["project.prefs.get"];
type PrefsPatch = Omit<CommandPayloads["project.prefs.set"], "projectId">;

export function ProjectWritingSettings({ projectId }: { projectId?: string }) {
  const [prefs, setPrefs] = useState<ProjectPrefs>();
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const amountId = useId();
  const hintId = useId();

  useEffect(() => {
    if (!projectId || !window.wordhub) return;
    let current = true;
    void window.wordhub
      .invoke("project.prefs.get", { projectId })
      .then((result) => {
        if (!current) return;
        setPrefs(result);
        setAmount(result.runBudgetUsd?.toString() ?? "");
      })
      .catch((cause) => {
        if (current) setError(cleanIpcError(cause));
      });
    return () => {
      current = false;
    };
  }, [projectId]);

  const save = async (patch: PrefsPatch) => {
    if (!projectId || !prefs || !window.wordhub || saving) return;
    setSaving(true);
    setError("");
    if (patch.autoReviewOnFinalize !== undefined)
      setPrefs({ ...prefs, autoReviewOnFinalize: patch.autoReviewOnFinalize });
    try {
      const result = await window.wordhub.invoke("project.prefs.set", {
        projectId,
        ...patch,
      });
      setPrefs(result);
      if (patch.runBudgetUsd !== undefined)
        setAmount(result.runBudgetUsd?.toString() ?? "");
    } catch (cause) {
      setPrefs(prefs);
      setError(cleanIpcError(cause));
    } finally {
      setSaving(false);
    }
  };

  const saveBudget = () => {
    const value = Number(amount);
    if (amount.trim() === "" || !Number.isFinite(value) || value <= 0) {
      setError("请输入大于 0 的美元金额。");
      return;
    }
    void save({ runBudgetUsd: value });
  };

  const budget = prefs?.runBudgetUsd;

  return (
    <section className="panel-section">
      <h2>写作流程</h2>
      <label className="toggle-row" data-testid="auto-review-toggle">
        <input
          type="checkbox"
          checked={prefs?.autoReviewOnFinalize ?? false}
          disabled={!prefs || saving}
          onChange={(event) =>
            void save({ autoReviewOnFinalize: event.target.checked })
          }
        />
        <span>定稿后自动评审</span>
      </label>
      <p className="section-note">
        {projectId
          ? "章节定稿（史官抽取事实、写摘要）之后，自动再跑一轮评审。默认关闭。"
          : "先链接一个项目文件夹，才能设置项目级的写作流程。"}
      </p>
      <form
        className="field"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          saveBudget();
        }}
      >
        <label className="field-label" htmlFor={amountId}>
          <strong>单次运行预算（USD）</strong>
          <span data-testid="run-budget-status">
            {prefs &&
              (budget == null ? "当前无上限" : `当前上限：${budget} 美元`)}
          </span>
        </label>
        <div>
          <div className="credential-row" style={{ marginTop: 0 }}>
            <input
              className="text-input mono"
              id={amountId}
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              placeholder="美元金额"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-describedby={hintId}
              disabled={!prefs || saving}
              data-testid="run-budget-usd"
            />
            <button
              className="btn btn-primary"
              type="submit"
              disabled={!prefs || saving || !amount.trim()}
              data-testid="run-budget-save"
            >
              保存
            </button>
            {budget != null && (
              <button
                className="btn"
                type="button"
                disabled={saving}
                onClick={() => void save({ runBudgetUsd: null })}
                data-testid="run-budget-disable"
              >
                关闭上限
              </button>
            )}
          </div>
          <p id={hintId} className="section-note" style={{ margin: "8px 0 0" }}>
            预算适用于对话与写作流程，按配置的模型单价计算。启用后只调用价格已知的模型。
            每次调用前按模型的上下文与输出上限预留费用。预估低于上限时，余额也可能不足以发起下一次调用，运行会在调用前停止。设置从下一次新运行生效。
          </p>
        </div>
      </form>
      {error && (
        <p className="section-note" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
