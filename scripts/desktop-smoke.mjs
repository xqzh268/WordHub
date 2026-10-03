import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const electron = await _electron.launch({
  executablePath: electronBinary,
  args: [path.join(root, "out", "main", "index.js")],
  cwd: root,
  env: { ...process.env, WORDHUB_MOCK: "1", WORDHUB_WORKSPACE_ROOT: root }
});
try {
  const page = await electron.firstWindow();
  page.on("console", (message) => console.error(`[renderer:${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => console.error(`[renderer:error] ${error.message}`));
  console.error("renderer url", page.url());
  await page.waitForSelector("text=小说工作台");
  await page.fill("textarea", "写一个两句的唐代悬疑开头");
  await page.click("text=发送 ↗");
  await page.waitForSelector("text=Pi后台进程", { timeout: 5000 });
  const snapshot = await page.evaluate(() => window.wordhub.invoke("workspace.getSnapshot", undefined));
  const result = { ok: snapshot.projectName === "未命名项目" && Boolean(snapshot.worker), snapshot, title: await page.title() };
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(path.join(root, "artifacts", "desktop-smoke-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  await electron.close();
}
