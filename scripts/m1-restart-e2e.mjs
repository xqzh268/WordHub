// M1 验收：真实 Electron 应用的“链接项目 → 对话 → 强杀 → 重开”端到端检查。
// 用法：npm run build:desktop && node scripts/m1-restart-e2e.mjs
// 说明：用 mock 后台（不调用模型），存储根目录与项目目录都放在临时目录；系统文件夹对话框被替换为固定路径。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { _electron } from "playwright";

const cleanEnv = () => {
  const { ELECTRON_RUN_AS_NODE, ...rest } = process.env;
  return rest;
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = createRequire(import.meta.url)("electron");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-m1-e2e-"));
const storageRoot = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
fs.mkdirSync(folder, { recursive: true });

const findings = [];
const check = (name, passed, detail = "") => {
  findings.push({ name, passed, detail });
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  —  ${detail}` : ""}`,
  );
  return passed;
};

const launch = () =>
  _electron.launch({
    executablePath: electronBinary,
    // 主进程以 app.getPath("userData") 为存储根目录，所以用 --user-data-dir 隔离，避免污染真实数据。
    args: [
      path.join(root, "out", "main", "index.js"),
      `--user-data-dir=${storageRoot}`,
    ],
    cwd: root,
    env: { ...cleanEnv(), WORDHUB_MOCK: "1", WORDHUB_WORKSPACE_ROOT: root },
  });

async function stubFolderDialog(app) {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [chosen],
    });
  }, folder);
}
const chatText = (page) => page.locator(".chat-scroll").innerText();

try {
  // ── 第一次启动：链接项目、对话 ───────────────────────────
  let app = await launch();
  let page = await app.firstWindow();
  await page.waitForSelector(".app");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="worker-status"]')
        ?.textContent?.includes("待命"),
    null,
    { timeout: 15000 },
  );
  await stubFolderDialog(app);
  await page.click('[data-testid="link-folder"]');
  await page.waitForSelector('[data-testid="project-card"]', { timeout: 8000 });
  check(
    "链接含中文路径的文件夹后，生成 .wordhub/project.json",
    fs.existsSync(path.join(folder, ".wordhub", "project.json")),
  );

  await page.fill('[data-testid="composer-input"]', "@评审 核对第三章的设定");
  await page.click('[data-testid="send"]');
  await page.waitForSelector("text=文枢后台进程正在流式写作", {
    timeout: 8000,
  });
  await page.waitForSelector('[data-testid="send"]', { timeout: 8000 });
  const beforeAuthor = await page
    .locator(".entry-agent .msg-head strong")
    .first()
    .textContent();
  const beforeUser = await page
    .locator(".entry-user .user-text")
    .first()
    .innerText();
  check(
    "重启前：回复来自被 @ 的 Agent",
    beforeAuthor === "评审",
    String(beforeAuthor),
  );
  console.log(
    `      重启前 用户消息: ${JSON.stringify(beforeUser)}  回复者: ${beforeAuthor}`,
  );

  // 数据库内容（应用仍在运行时只读检查）
  const dbPath = fs
    .readdirSync(path.join(storageRoot, "projects"))
    .map((id) => path.join(storageRoot, "projects", id, "wordhub.sqlite"))[0];
  check(
    "SQLite 放在应用数据目录而不是写作文件夹",
    Boolean(dbPath) &&
      !fs.existsSync(path.join(folder, ".wordhub", "wordhub.sqlite")),
  );

  // ── 强杀整个应用（不走正常退出） ──────────────────────────
  const pid = app.process().pid;
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const events = db
    .prepare("SELECT seq,type,actor_id,payload_json FROM events ORDER BY seq")
    .all();
  const seqs = events.map((e) => e.seq);
  check(
    "强杀后事件日志完整且 seq 连续无重复",
    seqs.every((s, i) => s === i + 1),
    `共 ${events.length} 条`,
  );
  const userEvents = events.filter((e) => e.type === "chat.user_message");
  check(
    "用户消息只记录一次",
    userEvents.length === 1,
    `${userEvents.length} 条`,
  );
  const started = events.find((e) => e.type === "run.started");
  console.log(
    `      run.started 事件: actor=${started?.actor_id} payload=${started?.payload_json}`,
  );
  console.log(`      用户消息事件 payload=${userEvents[0]?.payload_json}`);
  const secretLeak = events.some((e) =>
    /sk-[A-Za-z0-9]{8,}|DEEPSEEK_API_KEY/.test(e.payload_json),
  );
  check("事件载荷中没有密钥痕迹", !secretLeak);
  db.close();

  // ── 第二次启动：不做任何操作，界面应当恢复 ────────────────
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector(".app");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="worker-status"]')
        ?.textContent?.includes("待命"),
    null,
    { timeout: 15000 },
  );
  await page.waitForTimeout(1500);
  const restoredProject = await page
    .locator(".titlebar-crumb span")
    .first()
    .textContent();
  const restoredChat = await chatText(page);
  check(
    "重开后无需操作，界面自动恢复项目",
    restoredProject === "长安夜",
    `项目名：${restoredProject}`,
  );
  check(
    "重开后无需操作，界面自动恢复聊天记录",
    restoredChat.includes("核对第三章的设定") &&
      restoredChat.includes("文枢后台进程正在流式写作"),
    `聊天区文本：${JSON.stringify(restoredChat.slice(0, 60))}`,
  );

  // ── 手动重新链接同一文件夹后的状态 ────────────────────────
  await stubFolderDialog(app);
  const hasLink = await page.locator('[data-testid="link-folder"]').count();
  await page.click(
    hasLink ? '[data-testid="link-folder"]' : '[data-testid="project-card"]',
  );
  await page.waitForTimeout(1500);
  const relinkedChat = await chatText(page);
  const afterAuthor = await page
    .locator(".entry-agent .msg-head strong")
    .first()
    .textContent()
    .catch(() => null);
  const afterUser = await page
    .locator(".entry-user .user-text")
    .first()
    .innerText()
    .catch(() => null);
  check(
    "手动重新链接后聊天记录恢复",
    relinkedChat.includes("文枢后台进程正在流式写作"),
  );
  check(
    "恢复后回复者与重启前一致（评审）",
    afterAuthor === "评审",
    `恢复后显示：${afterAuthor}`,
  );
  check(
    "恢复后用户消息与重启前一致（保留 @评审）",
    afterUser === beforeUser,
    `恢复后显示：${JSON.stringify(afterUser)}`,
  );
  await app.close();
} finally {
  const failed = findings.filter((f) => !f.passed);
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "artifacts", "m1-restart-e2e-result.json"),
    JSON.stringify({ ok: failed.length === 0, findings }, null, 2),
  );
  console.log(`\n${findings.length - failed.length}/${findings.length} 通过`);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (failed.length) process.exitCode = 1;
}
