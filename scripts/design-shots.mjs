// 设计检视：用 Electron 实际渲染界面并截图，输出到 docs/design/screenshots/。
// 用法：npm run build:desktop && node scripts/design-shots.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

// IDE 终端可能注入 ELECTRON_RUN_AS_NODE=1，会让 Electron 退化为 Node；启动应用时必须去掉。
const cleanEnv = () => {
  const { ELECTRON_RUN_AS_NODE, ...rest } = process.env;
  return rest;
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "docs", "design", "screenshots");
fs.mkdirSync(out, { recursive: true });
const electronBinary = createRequire(import.meta.url)("electron");

async function launch(env) {
  const app = await _electron.launch({
    executablePath: electronBinary,
    args: [
      path.join(root, "out", "main", "index.js"),
      `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-test-"))}`,
    ],
    cwd: root,
    env: {
      ...cleanEnv(),
      WORDHUB_MOCK: "1",
      WORDHUB_WORKSPACE_ROOT: root,
      ...env,
    },
  });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1440, 940);
    win.center();
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) =>
    console.error(`[renderer:error] ${error.message}`),
  );
  await page.waitForSelector(".app");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  return { app, page };
}

// JPEG + CSS 像素：单张约 150–250KB，适合入库作文档配图。
const shot = (page, name) =>
  page.screenshot({
    path: path.join(out, `${name}.jpg`),
    type: "jpeg",
    quality: 88,
    scale: "css",
  });
const setTheme = (page, id) =>
  page.evaluate((theme) => {
    localStorage.setItem(
      "wordhub.prefs",
      JSON.stringify({ theme, reading: "serif" }),
    );
  }, id);

// 1) 演示数据：亮 / 暗
{
  const { app, page } = await launch({ WORDHUB_DEMO: "1" });
  await setTheme(page, "light");
  await page.reload();
  await page.waitForSelector(".app");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await shot(page, "workspace-light");

  await page.click("text=阻塞"); // 展开质询线程
  await page.waitForTimeout(400);
  await shot(page, "workspace-light-thread");

  await page.click('[aria-label="切换明暗主题"]');
  await page.waitForTimeout(700);
  await shot(page, "workspace-dark");

  await page.click('[data-testid="rail-settings"]');
  await page.waitForTimeout(500);
  await page.click('[data-testid="theme-light"]');
  await page.click('[data-testid="reading-literary"]');
  await page.waitForTimeout(700);
  await shot(page, "settings-light");

  await app.close();
}

// 2) 首次启动的空状态
{
  const { app, page } = await launch({});
  await setTheme(page, "light");
  await page.reload();
  await page.waitForSelector(".app");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await shot(page, "empty-light");
  await page.fill('[data-testid="composer-input"]', "@");
  await page.waitForTimeout(400);
  await shot(page, "mention-popover");
  await app.close();
}

console.log(`screenshots → ${out}`);
