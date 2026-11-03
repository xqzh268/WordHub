// 可编辑纸面的真实模型验证（deepseek-flash）：
// 作者事先放进来的章节（磁盘上没有修订记录）→ 在纸面里改一句 → 保存 → 让写手读取并复述被改动的细节，
// 确认 Agent 读到的是作者改过的内容，且只读提问不会改动文件。（只验证写手读取；没有覆盖评审或写作流程。）
// 用法：DEEPSEEK_API_KEY=... node scripts/paper-edit-live-e2e.mjs
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { _electron } from "playwright";
import { writeTestModelOverrides } from "./lib/test-models.mjs";
import { closeApp } from "./lib/close-app.mjs";

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-paper-live-"));
const userData = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
const chapterFile = path.join(folder, "chapters", "第一章.md");
const bible = path.join(folder, ".wordhub", "bible");
fs.mkdirSync(path.dirname(chapterFile), { recursive: true });
fs.mkdirSync(bible, { recursive: true });
writeTestModelOverrides(folder);
fs.writeFileSync(
  path.join(bible, "outline.md"),
  "## 第一章\n- 目标：裴照夜巡崇仁坊，发现质库后门的血迹\n",
);
fs.writeFileSync(
  path.join(bible, "characters.md"),
  "# 人物\n- 裴照：长安不良人。\n",
);
fs.writeFileSync(
  path.join(bible, "setting.md"),
  "# 设定\n- 唐代长安，夜禁。\n",
);
fs.writeFileSync(path.join(bible, "style.md"), "# 文风\n- 克制。\n");
const ORIGINAL =
  "# 第一章 夜巡\n\n三更鼓响过，裴照提着灯笼走进崇仁坊。\n\n质库的后门虚掩着，门轴上沾着一点暗红。\n";
fs.writeFileSync(chapterFile, ORIGINAL, "utf8");

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

const MARKER = "刀鞘上刻着永泰二字";
let app;
try {
  app = await _electron.launch({
    executablePath: electronBinary,
    args: [path.join(root, "out/main/index.js"), `--user-data-dir=${userData}`],
    cwd: root,
    env: { ...baseEnv, WORDHUB_WORKSPACE_ROOT: root },
  });
  const page = await app.firstWindow();
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
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="paper-reading"]')
        ?.textContent?.includes("三更鼓响过"),
    null,
    { timeout: 10000 },
  );

  // ── 1. 作者事先放进来的章节（无修订记录）：编辑并保存 ──────────
  await page.click('[data-testid="edit-paper"]');
  await page.waitForSelector('.paper-editor-content[contenteditable="true"]');
  const edited = `# 第一章 夜巡\n\n三更鼓响过，裴照提着灯笼走进崇仁坊，他的${MARKER}。\n\n质库的后门虚掩着，门轴上沾着一点暗红。`;
  await page
    .locator('[data-testid="paper-sheet"] .paper-editor-content')
    .fill(edited.replace("# 第一章 夜巡\n\n", "第一章 夜巡\n\n"));
  await page.click('[data-testid="finish-edit"]');
  const end = Date.now() + 8000;
  while (
    Date.now() < end &&
    !fs.readFileSync(chapterFile, "utf8").includes(MARKER)
  )
    await sleep(200);
  check(
    "对既有章节的第一次修改成功落盘（没有误报冲突）",
    fs.readFileSync(chapterFile, "utf8").includes(MARKER),
    JSON.stringify(fs.readFileSync(chapterFile, "utf8").slice(0, 80)),
  );
  const revs = events().filter(
    (e) =>
      e.type === "revision.committed" || e.type === "file.changed_externally",
  );
  check(
    "原文被保存为外部版本修订，作者修改是用户修订",
    revs.some((e) => e.type === "file.changed_externally") &&
      revs.some((e) => e.type === "revision.committed"),
    revs.map((e) => e.type).join(","),
  );

  // ── 2. 让写手读取并复述被改动的细节 ────────────────────────────
  const before = events().length;
  await page.fill(
    '[data-testid="composer-input"]',
    "@写手 请只读取 chapters/第一章.md（不要修改任何文件），用一句话告诉我裴照的刀鞘上刻着哪两个字。",
  );
  await page.click('[data-testid="send"]');
  const deadline = Date.now() + 240000;
  let slice = [];
  while (Date.now() < deadline) {
    slice = events().slice(before);
    if (slice.some((e) => e.type === "run.finished" || e.type === "run.error"))
      break;
    const approve = page.locator(".approval:not(.resolved) .btn-primary");
    if ((await approve.count()) > 0)
      await approve
        .last()
        .click()
        .catch(() => undefined);
    await sleep(1500);
  }
  const text = slice
    .filter((e) => e.type === "run.text_delta")
    .map((e) => String(e.payload.delta ?? e.payload.text ?? ""))
    .join("");
  check(
    "写手读到的是作者改过的内容（复述出“永泰”）",
    text.includes("永泰"),
    text.slice(0, 120),
  );
  check(
    "只读提问没有改动章节文件",
    fs.readFileSync(chapterFile, "utf8").includes(MARKER),
  );
} catch (error) {
  check("脚本异常", false, String(error?.stack ?? error).slice(0, 600));
}
await closeApp(app);
const failed = report.checks.filter((c) => !c.passed);
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
fs.writeFileSync(
  path.join(root, "artifacts", "paper-edit-live-result.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  `\n${report.checks.length - failed.length}/${report.checks.length} 项通过`,
);
await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
process.exit(failed.length ? 1 : 0);
