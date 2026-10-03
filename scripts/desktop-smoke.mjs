import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

// IDE 终端可能注入 ELECTRON_RUN_AS_NODE=1，会让 Electron 退化为 Node；启动应用时必须去掉。
const cleanEnv = () => { const { ELECTRON_RUN_AS_NODE, ...rest } = process.env; return rest; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = createRequire(import.meta.url)("electron");
const electron = await _electron.launch({
  executablePath: electronBinary,
  args: [path.join(root, "out", "main", "index.js")],
  cwd: root,
  env: { ...cleanEnv(), WORDHUB_MOCK: "1", WORDHUB_WORKSPACE_ROOT: root }
});

const problems = [];
const check = (name, passed, detail) => { if (!passed) problems.push(detail ? `${name}: ${detail}` : name); return passed; };

try {
  const page = await electron.firstWindow();
  page.on("console", (message) => { if (message.type() === "error") problems.push(`renderer console.error: ${message.text()}`); });
  page.on("pageerror", (error) => problems.push(`renderer pageerror: ${error.message}`));

  await page.waitForSelector(".app");
  await page.waitForSelector('[data-testid="empty-chat"]');

  // 1) 后台进程就绪
  await page.waitForFunction(() => document.querySelector('[data-testid="worker-status"]')?.textContent?.includes("待命"), null, { timeout: 15000 });

  // 2) @ 弹层与路由：键盘选择“写手”，发送后由写手回复，并流式出现文本
  await page.fill('[data-testid="composer-input"]', "@写");
  await page.waitForSelector('[role="listbox"]');
  await page.keyboard.press("Enter");
  const composed = await page.inputValue('[data-testid="composer-input"]');
  check("mention completes to @写手", composed.startsWith("@写手 "), composed);
  await page.keyboard.type("写一个两句的唐代悬疑开头");
  await page.click('[data-testid="send"]');
  await page.waitForSelector("text=文枢后台进程正在流式写作", { timeout: 8000 });
  await page.waitForSelector('[data-testid="send"]', { timeout: 8000 }); // 运行结束后恢复为“发送”
  const author = await page.locator(".entry-agent .msg-head strong").first().textContent();
  check("reply comes from 写手", author === "写手", String(author));

  // 3) 主题切换：同步到 <html data-theme> 与窗口（app.setTheme）
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('[aria-label="切换明暗主题"]');
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  check("theme toggles", before !== after && (after === "light" || after === "dark"), `${before} -> ${after}`);

  // 4) 导航与设置页
  await page.click('[data-testid="rail-settings"]');
  await page.waitForSelector('[data-testid="settings"]');
  await page.click('[data-testid="reading-literary"]');
  check("reading font applies", (await page.evaluate(() => document.documentElement.dataset.reading)) === "literary");
  await page.click('[data-testid="rail-workspace"]');
  await page.waitForSelector('[data-testid="paper-sheet"]');

  const snapshot = await page.evaluate(() => window.wordhub.invoke("workspace.getSnapshot", undefined));
  check("snapshot", snapshot.projectName === "未命名项目" && Boolean(snapshot.worker), JSON.stringify(snapshot));

  const result = { ok: problems.length === 0, problems, snapshot, title: await page.title() };
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(path.join(root, "artifacts", "desktop-smoke-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  await electron.close();
}
