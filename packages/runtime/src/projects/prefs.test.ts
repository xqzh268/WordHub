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
    });
  });

  it("保存后可读回，文件在 .wordhub/preferences.json", async () => {
    const dir = await folder();
    await saveProjectPrefs(dir, { autoReviewOnFinalize: true });
    expect(await loadProjectPrefs(dir)).toEqual({ autoReviewOnFinalize: true });
    expect(
      JSON.parse(
        await readFile(path.join(dir, ".wordhub", "preferences.json"), "utf8"),
      ),
    ).toEqual({ autoReviewOnFinalize: true });
    await saveProjectPrefs(dir, { autoReviewOnFinalize: false });
    expect((await loadProjectPrefs(dir)).autoReviewOnFinalize).toBe(false);
  });

  it("空补丁不改变已有值", async () => {
    const dir = await folder();
    await saveProjectPrefs(dir, { autoReviewOnFinalize: true });
    expect(await saveProjectPrefs(dir, {})).toEqual({
      autoReviewOnFinalize: true,
    });
  });

  it("文件损坏或字段类型不对时回到默认值，不抛错", async () => {
    const dir = await folder();
    await mkdir(path.join(dir, ".wordhub"), { recursive: true });
    await writeFile(
      path.join(dir, ".wordhub", "preferences.json"),
      "{坏",
      "utf8",
    );
    expect((await loadProjectPrefs(dir)).autoReviewOnFinalize).toBe(false);
    await writeFile(
      path.join(dir, ".wordhub", "preferences.json"),
      JSON.stringify({ autoReviewOnFinalize: "yes" }),
      "utf8",
    );
    expect((await loadProjectPrefs(dir)).autoReviewOnFinalize).toBe(false);
  });
});
