// M3 第5步：真实DeepSeek工作流回归。默认跳过，WORDHUB_REQUIRE_LIVE=1时缺密钥直接失败。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { _electron } from "playwright";

const key = process.env.DEEPSEEK_API_KEY;
if (!key) {
  if (process.env.WORDHUB_REQUIRE_LIVE === "1") {
    console.error("失败：M3真实回归要求DEEPSEEK_API_KEY。");
    process.exit(2);
  }
  console.log("跳过：未设置DEEPSEEK_API_KEY（本地可选）。");
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-m3-live-"));
const userData = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
fs.mkdirSync(path.join(folder, ".wordhub", "bible"), { recursive: true });
fs.mkdirSync(path.join(folder, "chapters"), { recursive: true });
fs.writeFileSync(
  path.join(folder, ".wordhub", "bible", "bible.md"),
  "裴照是左撇子，惯用横刀。评审必须检查左右手矛盾。",
  "utf8",
);
fs.writeFileSync(
  path.join(folder, "chapters", "第三章.md"),
  "裴照走进崇仁坊，右手按住刀柄。",
  "utf8",
);
const cleanEnv = () => {
  const { ELECTRON_RUN_AS_NODE, ...rest } = process.env;
  return rest;
};
const launch = () =>
  _electron.launch({
    executablePath: electron,
    args: [path.join(root, "out/main/index.js"), `--user-data-dir=${userData}`],
    cwd: root,
    env: { ...cleanEnv(), DEEPSEEK_API_KEY: key, WORDHUB_WORKSPACE_ROOT: root },
  });
const database = () => {
  const id = fs
    .readdirSync(path.join(userData, "projects"))
    .find((name) =>
      fs.existsSync(path.join(userData, "projects", name, "wordhub.sqlite")),
    );
  return new DatabaseSync(
    path.join(userData, "projects", id, "wordhub.sqlite"),
    { readOnly: true },
  );
};
const events = () => {
  const db = database();
  const rows = db.prepare("SELECT * FROM events ORDER BY seq").all();
  db.close();
  return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));
};
const waitEvent = async (runId, type, timeout = 300000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (events().some((event) => event.run_id === runId && event.type === type))
      return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`等待${type}超时`);
};
const app = await launch();
try {
  const page = await app.firstWindow();
  await page.waitForSelector(".app");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="worker-status"]')
        ?.textContent?.includes("待命"),
    null,
    { timeout: 20000 },
  );
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selected],
    });
  }, folder);
  await page.click('[data-testid="link-folder"]');
  await page.waitForSelector('[data-testid="project-card"]');
  const runId = `m3-live-${Date.now().toString(36)}`;
  await page.fill('[data-testid="composer-input"]', "写第三章");
  await page.click('[data-testid="send"]');
  await waitEvent(runId, "workflow.finished").catch(async () => {
    const started = events().find((event) => event.type === "workflow.started");
    if (!started) throw new Error("没有创建工作流");
    await waitEvent(started.run_id, "workflow.finished");
  });
  const first = events();
  const workflow = first.find((event) => event.type === "workflow.started");
  const workflowId = workflow?.run_id;
  if (!workflowId) throw new Error("没有工作流运行ID");
  const taskAgents = first
    .filter((event) => event.type === "run.started" && event.payload?.agentId)
    .map((event) => event.payload.agentId);
  if (!taskAgents.includes("writer") || !taskAgents.includes("editor"))
    throw new Error(`写手→编辑节点不完整：${taskAgents.join(",")}`);
  await page.fill('[data-testid="composer-input"]', "请评审第三章的一致性");
  await page.click('[data-testid="send"]');
  await page.waitForSelector(".approval:not(.resolved), .entry-thread", {
    timeout: 300000,
  });
  const afterReview = events();
  if (!afterReview.some((event) => event.type === "challenge.raise"))
    throw new Error("评审未提出质询");
  if (!afterReview.some((event) => event.type === "escalation.created"))
    throw new Error("质询没有升级为裁决");
  await page.locator(".approval:not(.resolved) .btn-primary").last().click();
  await page.waitForTimeout(2000);
  const finalEvents = events();
  const chapter = fs.readFileSync(
    path.join(folder, "chapters", "第三章.md"),
    "utf8",
  );
  const result = {
    workflowId,
    agents: taskAgents,
    challenge: finalEvents.some((event) => event.type === "challenge.raise"),
    escalation: finalEvents.some(
      (event) => event.type === "escalation.created",
    ),
    resolved: finalEvents.some((event) => event.type === "escalation.resolved"),
    chapter,
  };
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "artifacts", "m3-live-e2e-result.json"),
    JSON.stringify(result, null, 2),
    "utf8",
  );
  console.log("M3真实回归通过", JSON.stringify(result));
} finally {
  spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"], {
    stdio: "ignore",
  });
}
