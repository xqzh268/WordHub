import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** 项目级偏好，存在写作文件夹的 .wordhub/preferences.json 里（用户可读、可随项目带走）。 */
export type ProjectPrefs = {
  /** 定稿后自动评审，默认关闭 */
  autoReviewOnFinalize: boolean;
};

export const DEFAULT_PROJECT_PREFS: ProjectPrefs = {
  autoReviewOnFinalize: false,
};

const fileOf = (folder: string) =>
  path.join(folder, ".wordhub", "preferences.json");

export async function loadProjectPrefs(folder: string): Promise<ProjectPrefs> {
  try {
    const raw = JSON.parse(await readFile(fileOf(folder), "utf8")) as Partial<
      Record<keyof ProjectPrefs, unknown>
    >;
    return {
      autoReviewOnFinalize: raw.autoReviewOnFinalize === true,
    };
  } catch {
    // 不存在或损坏都回到默认值，不影响写作
    return { ...DEFAULT_PROJECT_PREFS };
  }
}

export async function saveProjectPrefs(
  folder: string,
  patch: Partial<ProjectPrefs>,
): Promise<ProjectPrefs> {
  const next = { ...(await loadProjectPrefs(folder)), ...patch };
  await mkdir(path.dirname(fileOf(folder)), { recursive: true });
  await writeFile(fileOf(folder), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
