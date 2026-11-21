import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CommandResults } from "@wordhub/contracts";

export type ProjectPrefs = CommandResults["project.prefs.get"];

export const DEFAULT_PROJECT_PREFS: ProjectPrefs = {
  autoReviewOnFinalize: false,
  runBudgetUsd: null,
};

const fileOf = (folder: string) =>
  path.join(folder, ".wordhub", "preferences.json");

function budgetValue(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error("单次运行预算必须是大于零的有限美元金额");
  return value;
}

export async function loadProjectPrefs(folder: string): Promise<ProjectPrefs> {
  let text: string;
  try {
    text = await readFile(fileOf(folder), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { ...DEFAULT_PROJECT_PREFS };
    throw error;
  }
  // 无法读取已保存的上限时，不允许误按无限额启动。
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(
      "无法读取预算，请检查 .wordhub/preferences.json 是否为有效 JSON",
    );
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("项目偏好文件 .wordhub/preferences.json 格式无效");
  return {
    autoReviewOnFinalize:
      "autoReviewOnFinalize" in raw && raw.autoReviewOnFinalize === true,
    runBudgetUsd: budgetValue("runBudgetUsd" in raw ? raw.runBudgetUsd : null),
  };
}

const pending = new Map<string, Promise<ProjectPrefs>>();

export function saveProjectPrefs(
  folder: string,
  patch: Partial<ProjectPrefs>,
): Promise<ProjectPrefs> {
  const file = fileOf(path.resolve(folder));
  const key = process.platform === "win32" ? file.toLowerCase() : file;
  const saving = (pending.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const next = await loadProjectPrefs(folder);
      if (patch.autoReviewOnFinalize !== undefined)
        next.autoReviewOnFinalize = patch.autoReviewOnFinalize;
      if (patch.runBudgetUsd !== undefined)
        next.runBudgetUsd = budgetValue(patch.runBudgetUsd);
      await mkdir(path.dirname(file), { recursive: true });
      const temporary = file + "." + randomUUID() + ".tmp";
      try {
        await writeFile(
          temporary,
          JSON.stringify(next, null, 2) + "\n",
          "utf8",
        );
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
      return next;
    });
  pending.set(key, saving);
  return saving.finally(() => {
    if (pending.get(key) === saving) pending.delete(key);
  });
}
