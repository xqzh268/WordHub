// 参考库的真实模型验证（deepseek-flash）：
// 1) 导入一本书 → 让写手用 reference.search / reference.read 找到并引用其中一句，答案要有书名、章节和原句；
// 2) 在阅读区把一段加入文风示范 → 写手下一次运行的上下文清单里出现 style-samples 层；
// 3) 声明了参考库工具却没有 references 读取范围的 Agent（只能手写 AGENT.md），调用被权限层拒绝。
// 用法：DEEPSEEK_API_KEY=... node scripts/references-live-e2e.mjs
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { _electron } from "playwright";
import { closeApp } from "./lib/close-app.mjs";
import { writeTestModelOverrides } from "./lib/test-models.mjs";

const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) {
  if (process.env.WORDHUB_REQUIRE_LIVE === "1") {
    console.error("失败：真实验证要求 DEEPSEEK_API_KEY。");
    process.exit(2);
  }
  console.log("跳过：未设置 DEEPSEEK_API_KEY");
  process.exit(0);
}
const { ELECTRON_RUN_AS_NODE, ...baseEnv } = process.env;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = createRequire(import.meta.url)("electron");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-refs-live-"));
const userData = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
fs.mkdirSync(path.join(folder, ".wordhub", "bible"), { recursive: true });
fs.mkdirSync(path.join(folder, "chapters"), { recursive: true });
writeTestModelOverrides(folder);
fs.writeFileSync(
  path.join(folder, ".wordhub", "bible", "style.md"),
  "# 文风\n- 克制。\n",
);
fs.writeFileSync(
  path.join(folder, ".wordhub", "bible", "setting.md"),
  "# 设定\n- 唐代长安。\n",
);

// 参考书：第二章里藏一句只此一处的话
const SECRET = "月光落在第七级台阶上，像一枚没有人认领的银钱";
const book = [
  "寒江记",
  "",
  `第一章 渡口\n${"江面起了雾，渡船迟迟不来。老船工蹲在岸边抽烟，一言不发。".repeat(6)}`,
  `第二章 夜泊\n${"船靠了岸，客人们各自散去。".repeat(5)}${SECRET}。${"没有人回头看他。".repeat(5)}`,
  `第三章 归途\n${"天亮时雾散了，江水平静得像什么都没有发生过。".repeat(6)}`,
].join("\n\n");
const bookFile = path.join(tmp, "寒江记.txt");
fs.writeFileSync(bookFile, book, "utf8");

const report = { checks: [] };
const check = (name, passed, detail = "") => {
  report.checks.push({ name, passed, detail });
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  —  ${detail}` : ""}`,
  );
  return passed;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const events = () => {
  const dir = path.join(userData, "projects");
  const id = fs
    .readdirSync(dir)
    .find((n) => fs.existsSync(path.join(dir, n, "wordhub.sqlite")));
  if (!id) return [];
  const database = new DatabaseSync(path.join(dir, id, "wordhub.sqlite"), {
    readOnly: true,
  });
  const rows = database.prepare("SELECT * FROM events ORDER BY seq").all();
  database.close();
  return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));
};
const textOf = (slice) =>
  slice
    .filter((e) => e.type === "run.text_delta")
    .map((e) => String(e.payload.delta ?? e.payload.text ?? ""))
    .join("");
const toolNames = (slice) =>
  slice
    .filter((e) => e.type === "run.tool_started")
    .map((e) => String(e.payload.tool ?? ""));

let app;
let page;
async function ask(message, timeout = 240000) {
  const before = events().length;
  await page.fill('[data-testid="composer-input"]', message);
  await page.click('[data-testid="send"]');
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const slice = events().slice(before);
    if (slice.some((e) => e.type === "run.finished" || e.type === "run.error"))
      break;
    const card = page.locator(".approval:not(.resolved) .btn-primary");
    if ((await card.count()) > 0)
      await card
        .last()
        .click()
        .catch(() => undefined);
    await sleep(1500);
  }
  await sleep(800);
  return events().slice(before);
}

try {
  app = await _electron.launch({
    executablePath: electronBinary,
    args: [path.join(root, "out/main/index.js"), `--user-data-dir=${userData}`],
    cwd: root,
    env: { ...baseEnv, WORDHUB_WORKSPACE_ROOT: root },
  });
  page = await app.firstWindow();
  await page.waitForSelector(".app");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="worker-status"]')
        ?.textContent?.includes("待命"),
    null,
    { timeout: 30000 },
  );
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [chosen],
    });
  }, folder);
  await page.click('[data-testid="link-folder"]');
  await page.waitForSelector('[data-testid="project-card"]');

  // 导入
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, bookFile);
  await page.click('[data-testid="rail-references"]');
  await page.click('[data-testid="ref-import"]');
  await page.waitForSelector('[data-testid^="ref-ref-"]', { timeout: 30000 });
  check(
    "导入《寒江记》",
    (await page.locator('[data-testid^="ref-ref-"]').count()) === 1,
  );

  // ── 1. 写手用工具找到并引用 ───────────────────────────────
  await page.click('[data-testid="rail-workspace"]');
  const found = await ask(
    "@写手 参考库里有一句话包含“第七级台阶”，请用参考库工具找到它，告诉我它出自哪本书的哪一章，并把那一整句原样引用出来。",
  );
  const answer = textOf(found);
  const tools = toolNames(found);
  check(
    "运行正常结束",
    found.some((e) => e.type === "run.finished"),
    found.find((e) => e.type === "run.error")?.payload?.error ?? "",
  );
  check(
    "调用了 reference.search（真实工具调用）",
    tools.some(
      (t) => t.includes("reference.search") || t.includes("reference_search"),
    ),
    tools.join(","),
  );
  check(
    "答案点明了书名与章节",
    answer.includes("寒江记") && answer.includes("夜泊"),
    answer.slice(0, 200),
  );
  check(
    "答案原样引用了那一句",
    answer.includes("月光落在第七级台阶上"),
    answer.slice(0, 200),
  );
  check(
    "写手没有改动任何章节文件",
    fs.readdirSync(path.join(folder, "chapters")).length === 0,
  );

  // ── 2. 文风示范进入写手上下文 ─────────────────────────────
  await page.click('[data-testid="rail-references"]');
  await page.locator(".ref-card", { hasText: "寒江记" }).first().click();
  await page.locator(".refs-chapters button", { hasText: "第二章" }).click();
  await page.waitForSelector('[data-testid="ref-text"] p');
  await page.evaluate(() => {
    const container = document.querySelector('[data-testid="ref-text"]');
    const node = container.querySelector("p").firstChild;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(60, node.length));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.click('[data-testid="ref-sample"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="ref-message"]')
        ?.textContent?.includes("已加入文风示范"),
    null,
    { timeout: 10000 },
  );
  await page.click('[data-testid="rail-workspace"]');
  const styled = await ask(
    "@写手 只回复“收到”两个字，不要读取或写入任何文件。",
  );
  const injected = styled.find((e) => e.type === "context.injected");
  const manifest = JSON.stringify(injected?.payload?.manifest ?? []);
  check(
    "写手的上下文清单里出现 style-samples 层",
    manifest.includes("style-samples"),
    manifest.slice(0, 300),
  );
  const reviewerRun = await ask("@评审 只回复“收到”两个字，不要读取任何文件。");
  const reviewerManifest = JSON.stringify(
    reviewerRun.find((e) => e.type === "context.injected")?.payload?.manifest ??
      [],
  );
  check(
    "评审（只读）的上下文里没有 style-samples 层",
    !reviewerManifest.includes("style-samples"),
    reviewerManifest.slice(0, 200),
  );

  // ── 3. 声明了工具、却没有参考库读取范围的 Agent：权限层拒绝 ───────
  // 表单不允许这种组合（会被校验拦下），只能手写 AGENT.md；应用运行中新增，@ 它时自动刷新。
  const sneaky = path.join(folder, ".wordhub", "agents", "sneaky");
  fs.mkdirSync(sneaky, { recursive: true });
  fs.writeFileSync(
    path.join(sneaky, "AGENT.md"),
    [
      "---",
      "name: sneaky",
      "displayName: 偷看",
      "description: 声明了参考库工具但没有参考库读取范围",
      "model: { provider: deepseek, id: deepseek-flash, reasoning: low }",
      "tools: [reference.list, reference.search, reference.read]",
      "write: none",
      "writeScopes: []",
      "memoryScopes: { read: [chapters], write: [] }",
      "maxTurns: 4",
      "---",
      "你按用户要求调用工具，并把工具返回的结果原样告诉用户。",
    ].join("\n"),
  );
  const denied = await ask(
    "@偷看 请调用 reference.search，query 设为“台阶”，把工具返回的结果原样告诉我。",
  );
  const deniedEvent = denied.find(
    (e) =>
      e.type === "permission.denied" ||
      JSON.stringify(e.payload).includes("没有参考库的读取范围"),
  );
  check(
    "声明了工具但没有 references 读取范围：权限层拒绝并留下事件",
    Boolean(deniedEvent),
    deniedEvent
      ? JSON.stringify(deniedEvent.payload).slice(0, 160)
      : textOf(denied).slice(0, 160),
  );
  check(
    "被拒绝的 Agent 没有拿到书里的内容",
    !textOf(denied).includes("月光落在第七级台阶上"),
  );
} catch (error) {
  check("脚本异常", false, String(error?.stack ?? error).slice(0, 700));
}
await closeApp(app);
const failed = report.checks.filter((c) => !c.passed);
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
fs.writeFileSync(
  path.join(root, "artifacts", "references-live-result.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  `\n${report.checks.length - failed.length}/${report.checks.length} 项通过`,
);
await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
process.exit(failed.length ? 1 : 0);
