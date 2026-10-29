import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { flashOnly, writeTestModelOverrides } from "./test-models.mjs";

const dirs = [];
const folder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-models-"));
  dirs.push(dir);
  return path.join(dir, "项目");
};
afterEach(() => {
  delete process.env.WORDHUB_TEST_FULL_MODELS;
});

describe("测试模型覆盖", () => {
  it("默认把所有子代理指向 deepseek-flash", () => {
    const dir = folder();
    expect(writeTestModelOverrides(dir)).toBe(true);
    const config = JSON.parse(
      fs.readFileSync(path.join(dir, ".wordhub", "agent-models.json"), "utf8"),
    );
    expect(Object.keys(config).sort()).toEqual([
      "editor",
      "observer",
      "planner",
      "reviewer",
      "writer",
    ]);
    for (const ref of Object.values(config))
      expect(ref).toMatchObject({ provider: "deepseek", id: "deepseek-flash" });
  });

  it("WORDHUB_TEST_FULL_MODELS=1 时不覆盖，沿用产品默认", () => {
    process.env.WORDHUB_TEST_FULL_MODELS = "1";
    const dir = folder();
    expect(flashOnly()).toBe(false);
    expect(writeTestModelOverrides(dir)).toBe(false);
    expect(fs.existsSync(path.join(dir, ".wordhub", "agent-models.json"))).toBe(
      false,
    );
  });
});
