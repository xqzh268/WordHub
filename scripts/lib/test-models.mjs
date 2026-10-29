// 真实模型测试的统一模型配置：为节约成本，测试里所有子代理一律使用 deepseek-flash
// （用户决定，2026-10-22）。通过项目级 .wordhub/agent-models.json 覆盖，不改产品默认分配。
// 需要用默认的 v4-pro 档位跑对照时，设置环境变量 WORDHUB_TEST_FULL_MODELS=1。
import fs from "node:fs";
import path from "node:path";

const AGENTS = {
  planner: "high",
  writer: "high",
  editor: "low",
  reviewer: "high",
  observer: "low",
};

export const flashOnly = () => process.env.WORDHUB_TEST_FULL_MODELS !== "1";

export function writeTestModelOverrides(projectFolder) {
  if (!flashOnly()) return false;
  const dir = path.join(projectFolder, ".wordhub");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "agent-models.json"),
    JSON.stringify(
      Object.fromEntries(
        Object.entries(AGENTS).map(([name, reasoning]) => [
          name,
          { provider: "deepseek", id: "deepseek-flash", reasoning },
        ]),
      ),
      null,
      2,
    ),
    "utf8",
  );
  return true;
}
