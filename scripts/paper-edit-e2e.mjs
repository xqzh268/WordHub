// 可编辑纸面的端到端检查（mock 后台，不调用模型）：
// 立即退出时先保存、不可无损编辑的章节禁止编辑、编辑中锁定章节导航、冲突两种处理、撤销、重启后内容保留。
// 用法：npm run build:desktop && node scripts/paper-edit-e2e.mjs
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

const { ELECTRON_RUN_AS_NODE, DEEPSEEK_API_KEY, ...baseEnv } = process.env;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = createRequire(import.meta.url)("electron");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-paper-edit-"));
const userData = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
const chapterDir = path.join(folder, "chapters");
fs.mkdirSync(chapterDir, { recursive: true });
const chapter1 = path.join(chapterDir, "第一章.md");
const ORIGINAL = "# 第一章 暮鼓\n\n暮鼓三百声，长安闭坊。\n";
fs.writeFileSync(chapter1, ORIGINAL, "utf8");
fs.writeFileSync(
  path.join(chapterDir, "第二章.md"),
  "# 第二章\n\n__这种粗体写法编辑器会改写__\n",
  "utf8",
);

const findings = [];
const check = (name, passed, detail = "") => {
  findings.push({ name, passed, detail });
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  —  ${detail}` : ""}`,
  );
  return passed;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const read = () => fs.readFileSync(chapter1, "utf8");
const waitFile = async (predicate, timeout = 8000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate(read())) return true;
    await sleep(150);
  }
  return false;
};

async function launch(extraEnv = {}) {
  const app = await _electron.launch({
    executablePath: electronBinary,
    args: [
      path.join(root, "out", "main", "index.js"),
      `--user-data-dir=${userData}`,
    ],
    cwd: root,
    env: {
      ...baseEnv,
      WORDHUB_MOCK: "1",
      WORDHUB_WORKSPACE_ROOT: root,
      ...extraEnv,
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
    { timeout: 20000 },
  );
  return { app, page };
}
async function link(app, page) {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [chosen],
    });
  }, folder);
  // 重启后应用可能自己恢复上次链接的项目，而且在慢机器上恢复发生在“检查按钮在不在”和“点击”之间：
  // 先等到两种状态之一，再点；按钮中途消失（已恢复）就不点。
  await page.waitForSelector(
    '[data-testid="link-folder"], [data-testid="project-card"]',
    { timeout: 20000 },
  );
  if ((await page.locator('[data-testid="project-card"]').count()) === 0)
    await page
      .click('[data-testid="link-folder"]', { timeout: 5000 })
      .catch(() => undefined);
  await page.waitForSelector('[data-testid="project-card"]', {
    timeout: 20000,
  });
  await page.waitForSelector('[data-testid="paper-sheet"]');
}
const editorLoc = (page) =>
  page.locator('[data-testid="paper-sheet"] .paper-editor-content');
const reading = (page) => page.locator('[data-testid="paper-reading"]');
const startEdit = async (page) => {
  await page.click('[data-testid="edit-paper"]');
  await page.waitForSelector('.paper-editor-content[contenteditable="true"]', {
    timeout: 4000,
  });
};

let app;
let page;
try {
  ({ app, page } = await launch());
  await link(app, page);
  await page.selectOption('[data-testid="chapter-select"]', {
    label: "第一章",
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="paper-reading"]')
        ?.textContent?.includes("暮鼓三百声"),
    null,
    { timeout: 8000 },
  );
  check("默认是阅读视图，没有编辑器", (await editorLoc(page).count()) === 0);

  // 窄窗口下工具栏不挤压换行：按钮保持单行高度，状态文字不被竖排
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(906, 720),
  );
  await sleep(600);
  const toolbarBoxes = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        ".paper-edit-toolbar .btn, .paper-edit-toolbar .save-state",
      ),
    ].map((el) => {
      const rect = el.getBoundingClientRect();
      return { text: el.textContent?.trim(), w: rect.width, h: rect.height };
    }),
  );
  check(
    "窄窗口下编辑工具栏的按钮和状态文字不被压成竖排",
    toolbarBoxes.length >= 3 &&
      toolbarBoxes.every((box) => box.h <= 34 && box.w >= 36),
    JSON.stringify(toolbarBoxes),
  );

  // ── 1. 编辑后立刻点“完成”（早于 1.2 秒自动保存）也不丢 ───────────
  await startEdit(page);
  check(
    "编辑中章节导航被锁定",
    await page.locator('[data-testid="chapter-select"]').isDisabled(),
  );
  await editorLoc(page).fill("第一段改过。\n\n第二段新增。");
  await page.click('[data-testid="finish-edit"]');
  const flushed = await waitFile((text) => text.includes("第二段新增"), 6000);
  check("立即点完成会先保存再退出编辑", flushed, read().slice(0, 60));
  await page.waitForSelector('[data-testid="paper-reading"]', {
    timeout: 6000,
  });
  check(
    "退出编辑后阅读视图显示新内容并解锁导航",
    (await reading(page).textContent()).includes("第二段新增") &&
      !(await page.locator('[data-testid="chapter-select"]').isDisabled()),
  );
  check(
    "保存结果是规范的 Markdown",
    read() === "# 第一段改过。\n\n第二段新增。\n",
    JSON.stringify(read()),
  );

  // ── 2. 撤销：以新 revision 回到编辑前的版本 ─────────────────────
  const undo = page.getByRole("button", { name: /撤销/u });
  await page
    .waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].find((b) =>
          b.textContent?.includes("撤销"),
        )?.disabled,
      null,
      { timeout: 6000 },
    )
    .catch(() => undefined);
  check("保存后撤销可用", !(await undo.isDisabled()));
  await undo.click();
  check(
    "撤销后磁盘回到编辑前的内容",
    await waitFile((text) => text === ORIGINAL, 6000),
    JSON.stringify(read()),
  );

  // ── 3. 不可无损编辑的章节不能进入编辑 ───────────────────────────
  await page.selectOption('[data-testid="chapter-select"]', {
    label: "第二章",
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="paper-reading"]')
        ?.textContent?.includes("这种粗体写法"),
    null,
    { timeout: 6000 },
  );
  check(
    "含会被改写的写法的章节：编辑按钮禁用",
    await page.locator('[data-testid="edit-paper"]').isDisabled(),
  );
  await page.selectOption('[data-testid="chapter-select"]', {
    label: "第一章",
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="paper-reading"]')
        ?.textContent?.includes("暮鼓三百声"),
    null,
    { timeout: 6000 },
  );

  // ── 4. 冲突：保留我的版本 ───────────────────────────────────────
  await startEdit(page);
  await editorLoc(page).fill("第一章\n\n我的版本。");
  fs.writeFileSync(chapter1, "# 第一章\n\n外部版本一。\n", "utf8");
  check(
    "编辑期间外部修改出现冲突提示",
    await page
      .waitForSelector('[data-testid="paper-conflict"]', { timeout: 10000 })
      .then(
        () => true,
        () => false,
      ),
  );
  check("冲突时磁盘上的外部版本没有被覆盖", read().includes("外部版本一"));
  await page.getByRole("button", { name: "保留我的版本" }).click();
  check(
    "保留我的版本后写入磁盘",
    await waitFile((text) => text.includes("我的版本"), 6000),
  );
  await page.click('[data-testid="finish-edit"]');

  // ── 5. 冲突：载入新版本 ─────────────────────────────────────────
  await page.waitForSelector('[data-testid="paper-reading"]', {
    timeout: 6000,
  });
  await startEdit(page);
  await editorLoc(page).fill("第一章\n\n又一个本地版本。");
  fs.writeFileSync(chapter1, "# 第一章\n\n外部版本二。\n", "utf8");
  await page.waitForSelector('[data-testid="paper-conflict"]', {
    timeout: 10000,
  });
  await page.getByRole("button", { name: "载入新版本" }).click();
  check(
    "载入新版本后编辑器显示外部内容，磁盘保持外部版本",
    (await editorLoc(page).textContent()).includes("外部版本二") &&
      read().includes("外部版本二"),
  );
  await page.click('[data-testid="finish-edit"]');
  await page.waitForSelector('[data-testid="paper-reading"]', {
    timeout: 6000,
  });

  // ── 6. 重启后保存的内容仍在 ────────────────────────────────────
  await startEdit(page);
  await editorLoc(page).fill("第一章\n\n重启前保存的内容。");
  await page.click('[data-testid="finish-edit"]');
  await waitFile((text) => text.includes("重启前保存"), 6000);
  await app.close();
  ({ app, page } = await launch());
  await link(app, page);
  await page.selectOption('[data-testid="chapter-select"]', {
    label: "第一章",
  });
  check(
    "重启后阅读视图显示已保存的内容",
    await page
      .waitForFunction(
        () =>
          document
            .querySelector('[data-testid="paper-reading"]')
            ?.textContent?.includes("重启前保存的内容"),
        null,
        { timeout: 8000 },
      )
      .then(
        () => true,
        () => false,
      ),
  );

  // ── 7. Agent 运行期间纸面只读 ──────────────────────────────────
  await app.close();
  ({ app, page } = await launch({ WORDHUB_MOCK_TOKEN_RATE: "3" }));
  await link(app, page);
  await page.selectOption('[data-testid="chapter-select"]', {
    label: "第一章",
  });
  await page.fill('[data-testid="composer-input"]', "@写手 请写入第一章");
  await page.click('[data-testid="send"]');
  await page.waitForSelector('[data-testid="stop"]', { timeout: 8000 });
  check(
    "Agent 运行期间编辑按钮禁用并说明原因",
    (await page.locator('[data-testid="edit-paper"]').isDisabled()) &&
      (await page.locator(".save-state").textContent()).includes("正在写入"),
  );
  await page.click('[data-testid="stop"]').catch(() => undefined);
} catch (error) {
  const toolbar = await page
    ?.locator(".paper-edit-toolbar")
    .textContent()
    .catch(() => "");
  const disk = fs.existsSync(chapter1) ? read() : "";
  check(
    "脚本异常",
    false,
    `${String(error?.stack ?? error).slice(0, 400)} | 工具栏：${toolbar} | 磁盘：${JSON.stringify(disk)}`,
  );
}
await app?.close().catch(() => undefined);
const failed = findings.filter((item) => !item.passed);
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
fs.writeFileSync(
  path.join(root, "artifacts", "paper-edit-e2e-result.json"),
  JSON.stringify({ findings }, null, 2),
);
console.log(`\n${findings.length - failed.length}/${findings.length} 通过`);
await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
process.exit(failed.length ? 1 : 0);
