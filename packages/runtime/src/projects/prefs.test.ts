import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProjectPrefs, saveProjectPrefs } from "./prefs.js";

const folder = async () =>
  path.join(await mkdtemp(path.join(os.tmpdir(), "wordhub-prefs-")), "长安夜");

describe("项目偏好", () => {
  it("没有偏好文件时用默认值：定稿后自动评审关闭", async () => {
    expect(await loadProjectPrefs(await folder())).toEqual({
      autoReviewOnFinalize: false,
      runBudgetUsd: null,
    });
  });

  it("保存后可读回，文件在 .wordhub/preferences.json", async () => {
    const dir = await folder();
    await saveProjectPrefs(dir, { autoReviewOnFinalize: true });
    expect(await loadProjectPrefs(dir)).toEqual({
      autoReviewOnFinalize: true,
      runBudgetUsd: null,
    });
    expect(
      JSON.parse(
        await readFile(path.join(dir, ".wordhub", "preferences.json"), "utf8"),
      ),
    ).toEqual({ autoReviewOnFinalize: true, runBudgetUsd: null });
    await saveProjectPrefs(dir, { autoReviewOnFinalize: false });
    expect((await loadProjectPrefs(dir)).autoReviewOnFinalize).toBe(false);
  });

  it("空补丁不改变已有值", async () => {
    const dir = await folder();
    await saveProjectPrefs(dir, { autoReviewOnFinalize: true });
    expect(await saveProjectPrefs(dir, {})).toEqual({
      autoReviewOnFinalize: true,
      runBudgetUsd: null,
    });
  });

  it("文件损坏时阻止无限额运行，旧版自动评审字段仍可回退", async () => {
    const dir = await folder();
    await mkdir(path.join(dir, ".wordhub"), { recursive: true });
    await writeFile(
      path.join(dir, ".wordhub", "preferences.json"),
      "{坏",
      "utf8",
    );
    await expect(loadProjectPrefs(dir)).rejects.toThrow();
    await writeFile(
      path.join(dir, ".wordhub", "preferences.json"),
      JSON.stringify({ autoReviewOnFinalize: "yes" }),
      "utf8",
    );
    expect((await loadProjectPrefs(dir)).autoReviewOnFinalize).toBe(false);
  });
  it("并发修改互不覆盖，非法上限保留原值，null 显式关闭", async () => {
    const dir = await folder();
    await Promise.all([
      saveProjectPrefs(dir, { runBudgetUsd: 0.02 }),
      saveProjectPrefs(dir, { autoReviewOnFinalize: true }),
    ]);
    for (const value of [0, -1, Infinity, NaN])
      await expect(
        saveProjectPrefs(dir, { runBudgetUsd: value }),
      ).rejects.toThrow(/预算/);
    expect(await loadProjectPrefs(dir)).toEqual({
      runBudgetUsd: 0.02,
      autoReviewOnFinalize: true,
    });
    expect(
      (await saveProjectPrefs(dir, { runBudgetUsd: null })).runBudgetUsd,
    ).toBeNull();
  });
});
