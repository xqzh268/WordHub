// 布局回归：在演示数据下检查聊天区不出现横向溢出（长句、长路径必须自动折行）。
// 覆盖最窄窗口与常规窗口、亮色与暗色；同时输出审批卡截图到 artifacts/。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

// IDE 终端可能注入 ELECTRON_RUN_AS_NODE=1，会让 Electron 退化为 Node。
const cleanEnv = () => {
  const { ELECTRON_RUN_AS_NODE, ...rest } = process.env;
  return rest;
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = createRequire(import.meta.url)("electron");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-layout-"));
const problems = [];

const app = await _electron.launch({
  executablePath: electronBinary,
  args: [
    path.join(root, "out", "main", "index.js"),
    `--user-data-dir=${userData}`,
  ],
  cwd: root,
  env: {
    ...cleanEnv(),
    WORDHUB_MOCK: "1",
    WORDHUB_DEMO: "1",
    WORDHUB_WORKSPACE_ROOT: root,
  },
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector(".app");
  await page.evaluate(() => document.fonts.ready);

  for (const [width, height] of [
    [1080, 720],
    [1440, 940],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]);
      },
      [width, height],
    );
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.waitForTimeout(300);
      const card = page.locator(".approval", { hasText: "Agent请求写入" });
      await card.scrollIntoViewIfNeeded();
      const metrics = await page.evaluate(() => {
        const scroller = document.querySelector(".chat-scroll");
        const approval = [...document.querySelectorAll(".approval")].find(
          (node) => node.textContent?.includes("Agent请求写入"),
        );
        const preview = approval?.querySelector(".approval-preview");
        const approvalBox = approval?.getBoundingClientRect();
        const scrollerBox = scroller?.getBoundingClientRect();
        return {
          chatOverflowX: scroller
            ? scroller.scrollWidth - scroller.clientWidth
            : -1,
          previewOverflowX: preview
            ? preview.scrollWidth - preview.clientWidth
            : -1,
          cardRightInsideChat:
            approvalBox && scrollerBox
              ? approvalBox.right <= scrollerBox.right + 0.5
              : false,
          previewWhiteSpace: preview
            ? getComputedStyle(preview).whiteSpace
            : "",
        };
      });
      const label = `${width}x${height} ${theme}`;
      if (metrics.chatOverflowX > 1)
        problems.push(`${label}: 聊天区横向溢出 ${metrics.chatOverflowX}px`);
      if (metrics.previewOverflowX > 1)
        problems.push(`${label}: 预览横向溢出 ${metrics.previewOverflowX}px`);
      if (!metrics.cardRightInsideChat)
        problems.push(`${label}: 审批卡超出聊天区右边界`);
      if (!metrics.previewWhiteSpace.startsWith("pre-wrap"))
        problems.push(
          `${label}: 预览未自动折行（white-space=${metrics.previewWhiteSpace}）`,
        );
      if (width === 1080 && theme === "light") {
        fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
        await card.screenshot({
          path: path.join(root, "artifacts", "approval-card.jpg"),
          type: "jpeg",
          quality: 88,
          scale: "css",
        });
      }
    }
  }
} finally {
  await app.close().catch(() => {});
}

const result = { ok: problems.length === 0, problems };
console.log(JSON.stringify(result, null, 2));
try {
  fs.rmSync(userData, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 400,
  });
} catch {
  /* Windows 句柄尚未释放，留给系统清理 */
}
if (!result.ok) process.exitCode = 1;
