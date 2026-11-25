// SyncTeX Electron 端到端验收：编译、源码到 PDF、PDF 到源码、多文件、项目隔离，
// 以及失败编译保留上一次成功预览。引擎使用 scripts/fixtures/fake-synctex-tectonic.mjs。

import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { _electron } from "playwright";
import { closeApp } from "./lib/close-app.mjs";
import { electronBinary, mainArgs } from "./lib/electron-target.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "scripts", "fixtures", "synctex-e2e");
const fakeEngine = path.join(
  root,
  "scripts",
  "fixtures",
  "fake-synctex-tectonic.mjs",
);
const temp = await mkdtemp(path.join(os.tmpdir(), "wordhub-synctex-e2e-"));
const storageRoot = path.join(temp, "appdata");
const projectA = path.join(temp, "project-a");
const projectB = path.join(temp, "project-b");

const cleanEnv = () => {
  const {
    ELECTRON_RUN_AS_NODE: _runAsNode,
    DEEPSEEK_API_KEY: _deepseek,
    WORDHUB_DEEPSEEK_API_KEY: _wordhubKey,
    WORDHUB_DEMO: _demo,
    ...rest
  } = process.env;
  return rest;
};

let app;
let page;
const pass = (message) => console.log(`PASS  ${message}`);

async function launch() {
  app = await _electron.launch({
    executablePath: electronBinary,
    args: [...mainArgs(root), `--user-data-dir=${storageRoot}`],
    cwd: root,
    env: {
      ...cleanEnv(),
      WORDHUB_MOCK: "1",
      WORDHUB_TECTONIC_PATH: fakeEngine,
      WORDHUB_WORKSPACE_ROOT: root,
    },
  });
  page = await app.firstWindow({ timeout: 15000 });
  page.setDefaultTimeout(15000);
  await page.waitForFunction(
    async () =>
      (await window.wordhub?.invoke("workspace.getSnapshot", undefined))
        ?.worker === "ready",
    null,
    { polling: 100 },
  );
  return page;
}

async function stubFolderDialog(folder) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selected],
    });
  }, folder);
}

async function createProject(folder) {
  await stubFolderDialog(folder);
  await page.getByTestId("new-project").click();
  const dialog = page.getByTestId("new-project-dialog");
  await dialog.getByTestId("new-project-kind").selectOption("academic");
  await dialog.getByTestId("new-project-choose-folder").click();
  await page
    .getByTestId("project-card")
    .filter({ hasText: path.basename(folder) })
    .waitFor();
  const snapshot = await page.evaluate(() =>
    window.wordhub.invoke("workspace.getSnapshot", undefined),
  );
  assert.equal(snapshot.projectKind, "academic");
  return snapshot.projectId;
}

async function openProject(folder, projectId) {
  await stubFolderDialog(folder);
  await page
    .getByTestId("project-card")
    .filter({ hasText: path.basename(folder) })
    .click();
  await page.getByTestId("academic-workspace").waitFor();
  await page.waitForFunction(
    (id) =>
      window.wordhub
        .invoke("workspace.getSnapshot", undefined)
        .then((snapshot) => snapshot.projectId === id),
    projectId,
  );
}

async function invoke(command, payload) {
  return page.evaluate(
    ({ command, payload }) => window.wordhub.invoke(command, payload),
    { command, payload },
  );
}

async function compileFromUi() {
  await page.getByTestId("latex-compile").click();
  await page
    .locator('[data-testid="latex-compile-status"][data-status="succeeded"]')
    .waitFor();
}

async function waitForSyncControls() {
  // Both controls are part of the user-visible path. Their presence also
  // catches a regression where SyncTeX is silently available only over IPC.
  await page.getByTestId("sync-source-button").first().waitFor();
  await page.getByTestId("sync-pdf-surface").waitFor();
}

async function assertSyncRoundTrip(
  projectId,
  source,
  expectedPage,
  expectedLine,
) {
  const forward = await invoke("latex.syncSourceToPdf", {
    projectId,
    mainFile: "main.tex",
    relativePath: source,
    line: expectedLine,
    column: 1,
  });
  assert.ok(
    forward,
    `source -> PDF returned no result for ${source}:${expectedLine}`,
  );
  assert.equal(forward.page, expectedPage);
  assert.ok(Number.isFinite(forward.x) && Number.isFinite(forward.y));
  const backward = await invoke("latex.syncPdfToSource", {
    projectId,
    mainFile: "main.tex",
    page: forward.page,
    x: forward.x,
    y: forward.y,
  });
  assert.ok(
    backward,
    `PDF -> source returned no result for ${source}:${expectedLine}`,
  );
  assert.equal(backward.relativePath, source);
  assert.equal(backward.line, expectedLine);
  return forward;
}

try {
  for (const project of [projectA, projectB]) {
    await mkdir(path.join(project, "parts"), { recursive: true });
    await cp(path.join(fixture, "main.tex"), path.join(project, "main.tex"));
    await cp(
      path.join(fixture, "parts", "chapter.tex"),
      path.join(project, "parts", "chapter.tex"),
    );
  }
  await launch();

  // A linked project starts untrusted. Trust it explicitly before compiling.
  const idA = await createProject(projectA);
  await page.getByTestId("latex-trust-button").click();
  await page.getByTestId("latex-trust-banner").waitFor({ state: "detached" });
  await compileFromUi();
  await waitForSyncControls();

  const pdfPath = path.join(projectA, ".wordhub", "build", "latex", "main.pdf");
  const synctexPath = path.join(
    projectA,
    ".wordhub",
    "build",
    "latex",
    "main.synctex.gz",
  );
  assert.match(await readFile(pdfPath, "utf8"), /^%PDF/u);
  const syncText = gunzipSync(await readFile(synctexPath)).toString("utf8");
  assert.match(syncText, /^SyncTeX Version:1\r?$/mu);
  assert.match(syncText, /^Output:pdf\r?$/mu);
  assert.match(syncText, /^Input:1:.*main\.tex$/mu);
  assert.match(syncText, /^Input:7:.*parts[\\/]chapter\.tex$/mu);
  assert.match(syncText, /^Postamble:\r?$/mu);
  assert.equal(
    await page.getByTestId("latex-pdf-status").getAttribute("data-status"),
    "ready",
  );
  pass("模拟引擎生成带文字层 PDF 和合法 SyncTeX，预览已渲染");

  // Main file and included file both resolve to the expected page and round-trip.
  const mainFirst = await assertSyncRoundTrip(idA, "main.tex", 1, 3);
  await assertSyncRoundTrip(idA, "parts/chapter.tex", 1, 1);
  await assertSyncRoundTrip(idA, "main.tex", 2, 6);
  pass("源码到 PDF、PDF 到源码支持主文件与 included 多文件并完成往返");

  // Exercise the UI path as well as the direct IPC contract. The click target is
  // intentionally generic so the test does not depend on the editor widget.
  await page.getByTestId("sync-source-button").first().click();
  const surface = page.getByTestId("sync-pdf-surface");
  const box = await surface.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0);
  await surface.click({
    position: {
      x: Math.min(140, box.width - 1),
      y: Math.min(140, box.height - 1),
    },
  });
  pass("源码和 PDF 预览均暴露可操作的 SyncTeX 跳转控件");

  // A failed compile must leave the old successful PDF and mark it stale.
  await writeFile(
    path.join(projectA, "main.tex"),
    "%FAKE-SYNCTEX-FAIL\n",
    "utf8",
  );
  const previousRevision = await page
    .getByTestId("latex-pdf-preview")
    .getAttribute("data-revision");
  await page.getByTestId("latex-compile").click();
  await page
    .locator('[data-testid="latex-compile-status"][data-status="failed"]')
    .waitFor();
  await page
    .locator('[data-testid="latex-pdf-status"][data-status="stale"]')
    .waitFor();
  assert.equal(
    await page.getByTestId("latex-pdf-preview").getAttribute("data-revision"),
    previousRevision,
  );
  const stale = await invoke("latex.readPdf", { projectId: idA });
  assert.equal(stale.status, "ready");
  assert.equal(stale.stale, true);
  pass("失败编译保留上一次成功 PDF，修订号不变并标记 stale");

  // A second project gets an independent SyncTeX index. Cross-project access
  // through the renderer IPC is rejected while that project is active.
  const idB = await createProject(projectB);
  await page.getByTestId("latex-trust-button").click();
  await page.getByTestId("latex-trust-banner").waitFor({ state: "detached" });
  await compileFromUi();
  await assertSyncRoundTrip(idB, "main.tex", 1, 3);
  await assert.rejects(
    () =>
      invoke("latex.syncSourceToPdf", {
        projectId: idA,
        mainFile: "main.tex",
        relativePath: "main.tex",
        line: 3,
        column: 1,
      }),
    /当前活动项目|当前项目|active project/u,
  );
  await assert.rejects(
    () => invoke("latex.readPdf", { projectId: idA }),
    /当前活动项目|当前项目|active project/u,
  );
  pass("两个项目的 SyncTeX/PDF 预览隔离，跨项目 IPC 被拒绝");
} finally {
  await closeApp(app);
  await rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 400,
  });
}
