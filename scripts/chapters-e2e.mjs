// 纸面绑定项目文件的端到端检查：章节列表、磁盘内容、外部编辑自动刷新、增删章节、只读。
// 用法：npm run build:desktop && node scripts/chapters-e2e.mjs
// 说明：mock 后台（不调用模型），存储根目录与项目目录都放在临时目录；系统文件夹对话框被替换为固定路径。
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

const cleanEnv = () => {
  const {
    ELECTRON_RUN_AS_NODE,
    DEEPSEEK_API_KEY: _ambientKey,
    ...rest
  } = process.env;
  return rest;
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = createRequire(import.meta.url)("electron");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-chapters-e2e-"));
const storageRoot = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
const chapterDir = path.join(folder, "chapters");
fs.mkdirSync(chapterDir, { recursive: true });

const write = (name, text, secondsAgo = 0) => {
  const file = path.join(chapterDir, name);
  fs.writeFileSync(file, text, "utf8");
  const when = new Date(Date.now() - secondsAgo * 1000);
  fs.utimesSync(file, when, when);
  return file;
};
write("第一章.md", "# 第一章 暮鼓\n\n暮鼓三百声，长安闭坊。", 300);
write("第二章.md", "# 第二章 残月\n\n残月悬在天边。", 200);
write("第十章.md", "# 第十章 归来\n\n他终于回到崇仁坊。", 100);

const findings = [];
const check = (name, passed, detail = "") => {
  findings.push({ name, passed, detail });
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  —  ${detail}` : ""}`,
  );
  return passed;
};

let app;
try {
  app = await _electron.launch({
    executablePath: electronBinary,
    args: [
      path.join(root, "out", "main", "index.js"),
      `--user-data-dir=${storageRoot}`,
    ],
    cwd: root,
    env: {
      ...cleanEnv(),
      WORDHUB_MOCK: "1",
      WORDHUB_WORKSPACE_ROOT: root,
    },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".app");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="worker-status"]')
        ?.textContent?.includes("待命"),
    null,
    { timeout: 15000 },
  );
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [chosen],
    });
  }, folder);
  await page.click('[data-testid="link-folder"]');
  await page.waitForSelector('[data-testid="project-card"]', { timeout: 8000 });

  const sheet = page.locator('[data-testid="paper-sheet"]');
  const sheetHas = async (text, timeout = 6000) => {
    try {
      await page.waitForFunction(
        (wanted) =>
          document
            .querySelector('[data-testid="paper-sheet"]')
            ?.textContent?.includes(wanted),
        text,
        { timeout },
      );
      return true;
    } catch {
      return false;
    }
  };
  const sheetGone = async (text, timeout = 6000) => {
    try {
      await page.waitForFunction(
        (wanted) =>
          !document
            .querySelector('[data-testid="paper-sheet"]')
            ?.textContent?.includes(wanted),
        text,
        { timeout },
      );
      return true;
    } catch {
      return false;
    }
  };

  check(
    "打开项目后，纸面显示磁盘上最近修改的章节",
    await sheetHas("他终于回到崇仁坊"),
    await sheet.innerText(),
  );
  const options = await page
    .locator('[data-testid="chapter-select"] option')
    .allInnerTexts();
  check(
    "章节选择器按章号排序（第十章在第二章之后）",
    JSON.stringify(options) === JSON.stringify(["第一章", "第二章", "第十章"]),
    options.join(" | "),
  );

  await page.selectOption(
    '[data-testid="chapter-select"]',
    "chapters/第一章.md",
  );
  check("切换到第一章，显示第一章正文", await sheetHas("暮鼓三百声"));
  check("切换章节后不再显示其他章节", await sheetGone("回到崇仁坊"));

  fs.writeFileSync(
    path.join(chapterDir, "第一章.md"),
    "# 第一章 暮鼓\n\n暮鼓三百声，长安闭坊。\n\n我在外面的编辑器里加了一段。",
    "utf8",
  );
  check(
    "在外部编辑器改稿后，纸面自动刷新",
    await sheetHas("我在外面的编辑器里加了一段", 8000),
  );

  write("第三章.md", "# 第三章 更鼓\n\n更鼓一声。", 0);
  const grew = await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('[data-testid="chapter-select"] option')]
          .map((o) => o.textContent)
          .includes("第三章"),
      null,
      { timeout: 8000 },
    )
    .then(
      () => true,
      () => false,
    );
  check("外部新增章节后，章节列表自动出现新章", grew);

  fs.unlinkSync(path.join(chapterDir, "第一章.md")); // 注意：Node 24 的 fs.rmSync 删除中文路径文件会直接崩溃，这里用 unlinkSync

  check(
    "正在查看的章节被删除后，纸面回退到其他章节而不是留着旧内容",
    await sheetGone("我在外面的编辑器里加了一段", 8000),
  );

  const editable = await page
    .locator(
      '[data-testid="paper-sheet"] [contenteditable="true"], [data-testid="paper-sheet"] textarea',
    )
    .count();
  check("纸面只读（没有可编辑区域）", editable === 0);

  await fsp.rm(chapterDir, { recursive: true, force: true });
  fs.mkdirSync(chapterDir);
  check(
    "章节全部删除后显示空状态",
    await sheetHas("还没有章节", 8000),
    await sheet.innerText(),
  );
} finally {
  await app?.close().catch(() => undefined);
  const failed = findings.filter((f) => !f.passed);
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "artifacts", "chapters-e2e-result.json"),
    JSON.stringify({ ok: failed.length === 0, findings }, null, 2),
  );
  console.log(`\n${findings.length - failed.length}/${findings.length} 通过`);
  await fsp.rm(tmp, { recursive: true, force: true });
  if (failed.length) process.exitCode = 1;
}
