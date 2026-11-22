// M7.1 LaTeX 工作台的 Electron 端到端：编辑保存、外部修改冲突、主文件选择、
// 引擎设置、项目编译信任、编译状态和诊断定位。
// 使用 mock 模式、隔离的用户数据目录，引擎用 scripts/fixtures/fake-tectonic.mjs（不下载 21MB）。
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";
import { closeApp } from "./lib/close-app.mjs";
import { electronBinary, mainArgs } from "./lib/electron-target.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fakeEngine = path.join(root, "scripts", "fixtures", "fake-tectonic.mjs");
const shots = path.join(root, "artifacts", "latex-ui");
const temp = await mkdtemp(path.join(os.tmpdir(), "wordhub-latex-ipc-"));
const storageRoot = path.join(temp, "appdata");
const external = path.join(temp, "external-paper");
const fresh = path.join(temp, "fresh-paper");
const secretFile = path.join(temp, "outside-secret.txt");
const chapterPath = "chapters/introduction.tex";
const chapterSource =
  "\\section{引言}\n这里是正文。\n\\WordHubUndefinedProbe\n";
const alternateMain = "manuscript.tex";

const {
  ELECTRON_RUN_AS_NODE,
  DEEPSEEK_API_KEY: _ambientKey,
  WORDHUB_DEEPSEEK_API_KEY: _appKey,
  WORDHUB_DEMO: _demo,
  WORDHUB_MOCK: _mock,
  WORDHUB_TECTONIC_PATH: _engine,
  ...env
} = process.env;

let app;
async function launch({ mock = true } = {}) {
  app = await _electron.launch({
    executablePath: electronBinary,
    args: [...mainArgs(root), `--user-data-dir=${storageRoot}`],
    cwd: root,
    env: {
      ...env,
      ...(mock ? { WORDHUB_MOCK: "1" } : {}),
      WORDHUB_TECTONIC_PATH: fakeEngine,
      WORDHUB_WORKSPACE_ROOT: root,
    },
  });
  const page = await app.firstWindow({ timeout: 15000 });
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
async function restart(options) {
  await closeApp(app);
  app = undefined;
  return launch(options);
}
async function stubFolderDialog(folder) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selected],
    });
  }, folder);
}
async function createProject(page, folder, kind) {
  await stubFolderDialog(folder);
  await page.getByTestId("new-project").click();
  const dialog = page.getByTestId("new-project-dialog");
  await dialog.getByTestId("new-project-kind").selectOption(kind);
  await dialog.getByTestId("new-project-choose-folder").click();
  await page
    .getByTestId("project-card")
    .filter({ hasText: path.basename(folder) })
    .waitFor();
  const snapshot = await page.evaluate(() =>
    window.wordhub.invoke("workspace.getSnapshot", undefined),
  );
  assert.equal(snapshot.projectKind, kind);
  return snapshot.projectId;
}
const mainPath = path.join(external, "main.tex");
const setMain = (source) => writeFile(mainPath, source);
const article = (body) =>
  `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;
const compileViaIpc = (page, projectId, mainFile = "main.tex") =>
  page.evaluate((input) => window.wordhub.invoke("latex.compile", input), {
    projectId,
    mainFile,
  });
const fileItem = (page, file) =>
  page.locator(".latex-file-item").filter({
    has: page.getByText(file, { exact: true }),
  });
const editorSelector = '[data-testid="latex-editor"] .cm-content';
const waitForEditorContent = (page, content) =>
  page.waitForFunction(
    ({ selector, content }) => {
      const lines = [...document.querySelectorAll(`${selector} .cm-line`)];
      return (
        lines.length > 0 &&
        lines.map((line) => line.textContent).join("\n") === content
      );
    },
    { selector: editorSelector, content },
  );
const waitForEditorCursor = (page, line, column) =>
  page.waitForFunction(
    ({ selector, line, column }) => {
      const content = document.querySelector(selector);
      const selection = getSelection();
      const target = content?.querySelectorAll(".cm-line")[line - 1];
      if (
        !target ||
        document.activeElement !== content ||
        !selection?.isCollapsed ||
        !target.contains(selection.anchorNode)
      ) {
        return false;
      }
      const beforeCursor = document.createRange();
      beforeCursor.setStart(target, 0);
      beforeCursor.setEnd(selection.anchorNode, selection.anchorOffset);
      return beforeCursor.toString().length + 1 === column;
    },
    { selector: editorSelector, line, column },
  );
const exists = (file) =>
  stat(file).then(
    () => true,
    () => false,
  );
const pass = (message) => console.log(`PASS  ${message}`);

try {
  await Promise.all([
    mkdir(path.join(external, "chapters"), { recursive: true }),
    mkdir(fresh),
    mkdir(shots, { recursive: true }),
  ]);
  const initialSource = article("Hi");
  await setMain(initialSource);
  await writeFile(path.join(external, chapterPath), chapterSource);
  await writeFile(path.join(external, alternateMain), article("Another entry"));
  await writeFile(secretFile, "TOP-SECRET-CONTENT", "utf8");
  // 预置一点缓存，检查设置页能显示大小并清理
  const cacheDir = path.join(storageRoot, "engines", "tectonic-cache");
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(cacheDir, "bundle.bin"), Buffer.alloc(2048));

  let page = await launch();

  // 1. 设置页 LaTeX 引擎区
  await page.getByTestId("rail-settings").click();
  const section = page.getByTestId("latex-engine");
  await section.waitFor();
  await page.getByTestId("latex-engine-state").getByText("未安装").waitFor();
  assert.match(await section.innerText(), /未签名|没有代码签名/u);
  assert.equal(await page.getByTestId("latex-install").isEnabled(), true);
  assert.equal(
    await page.getByTestId("latex-cache-size").innerText(),
    "2.0 KB",
  );
  await page.getByTestId("latex-engine").scrollIntoViewIfNeeded();
  await section.screenshot({
    path: path.join(shots, "settings-latex-engine.png"),
  });
  await page.getByTestId("latex-clear-cache").click();
  await page.getByTestId("latex-notice").getByText("缓存已清理").waitFor();
  assert.equal(await page.getByTestId("latex-cache-size").innerText(), "0 B");
  assert.equal(await exists(path.join(cacheDir, "bundle.bin")), false);
  assert.deepEqual(
    await page.evaluate(() =>
      window.wordhub.invoke("latex.cancelInstall", undefined),
    ),
    { canceled: false },
  );
  pass("设置页显示引擎状态（未安装、未签名提示）、缓存大小，并可清理缓存");

  // 2. 链接已有文件夹：未信任
  await page.getByTestId("rail-workspace").click();
  const externalId = await createProject(page, external, "academic");
  await page.getByTestId("latex-trust-banner").waitFor();
  assert.match(
    await page.getByTestId("latex-trust-banner").innerText(),
    /来自外部.*读写项目外/su,
  );
  assert.equal(await page.getByTestId("latex-compile").isDisabled(), true);
  await page.screenshot({ path: path.join(shots, "trust-banner.png") });
  const refused = await compileViaIpc(page, externalId);
  assert.equal(refused.status, "untrusted");
  assert.equal(await exists(path.join(external, ".wordhub", "build")), false);
  assert.deepEqual(
    await page.evaluate(
      (id) => window.wordhub.invoke("latex.trustStatus", { projectId: id }),
      externalId,
    ),
    { trusted: false, reason: "untrusted" },
  );
  pass(
    "链接已有文件夹的学术项目显示信任横幅，编译被拒绝（untrusted）且未创建输出目录",
  );

  // 项目文件夹内伪造的信任标记无效
  await writeFile(
    path.join(external, ".wordhub", "latex-trust.json"),
    JSON.stringify({ trusted: true }),
  );
  assert.equal((await compileViaIpc(page, externalId)).status, "untrusted");
  pass("项目文件夹内自带的信任标记无效");

  // 3. 信任后用假引擎编译
  await page.getByTestId("latex-trust-button").click();
  await page.getByTestId("latex-trust-banner").waitFor({ state: "detached" });
  const compileButton = page.getByTestId("latex-compile");
  await compileButton.filter({ hasText: "main.tex" }).waitFor();
  assert.equal(await compileButton.isEnabled(), true);
  await compileButton.click();
  const status = page.getByTestId("latex-compile-status");
  await page
    .locator('[data-testid="latex-compile-status"][data-status="succeeded"]')
    .waitFor();
  assert.match(await status.innerText(), /编译成功/u);
  const pdf = path.join(external, ".wordhub", "build", "latex", "main.pdf");
  assert.match(await readFile(pdf, "utf8"), /^%PDF/u);
  const trustFile = JSON.parse(
    await readFile(path.join(storageRoot, "latex-trust.json"), "utf8"),
  );
  assert.equal(trustFile.projects[externalId].reason, "user");
  assert.equal(
    (
      await readFile(path.join(external, ".wordhub", "project.json"), "utf8")
    ).includes("trusted"),
    false,
  );
  pass(
    "点击信任后编译成功，PDF 输出在项目 .wordhub/build/latex，信任状态存于应用数据目录",
  );

  // 在 CodeMirror 中编辑并保存，再重新打开源文件读回。
  await waitForEditorContent(page, initialSource);
  const editor = page.locator(editorSelector);
  assert.equal(await editor.getAttribute("contenteditable"), "true");
  const savedSource = article("作者写入的新内容");
  await editor.fill(savedSource);
  const saveButton = page.getByTestId("latex-save");
  await saveButton.click();
  await page
    .locator('[data-testid="latex-save-status"][data-status="saved"]')
    .waitFor();
  assert.equal(await readFile(mainPath, "utf8"), savedSource);
  await fileItem(page, chapterPath).click();
  await waitForEditorContent(page, chapterSource);
  assert.match(await compileButton.innerText(), /main\.tex/u);
  const files = await page.evaluate(
    (id) => window.wordhub.invoke("latex.files", { projectId: id }),
    externalId,
  );
  assert.equal(files.mainFile, "main.tex");
  await fileItem(page, "main.tex").click();
  await waitForEditorContent(page, savedSource);
  pass("CodeMirror 修改已保存并读回，浏览章节保留原编译入口");

  // 在另一个写入者保存之后，旧版本提交应保留两份内容供用户处理。
  const localDraft = article("编辑器中的草稿");
  const externalSource = article("外部编辑后的版本");
  await editor.fill(localDraft);
  await setMain(externalSource);
  await saveButton.click();
  const conflict = page.getByTestId("latex-save-conflict");
  await conflict.waitFor();
  await waitForEditorContent(page, localDraft);
  assert.equal(await readFile(mainPath, "utf8"), externalSource);
  await page.getByTestId("latex-reload").click();
  await page.getByTestId("latex-reload-confirm").click();
  await waitForEditorContent(page, externalSource);
  await conflict.waitFor({ state: "detached" });
  pass("外部修改触发保存冲突并保留草稿，确认重载后显示最新磁盘版本");

  // 4. 失败诊断可以跨文件跳转，切换时保留各文件的草稿。
  const diagnosticSource = article(`%FAKE-DIAGNOSTICS ${chapterPath}`);
  await setMain(diagnosticSource);
  await page.getByTestId("latex-reload").click();
  await waitForEditorContent(page, diagnosticSource);
  const mainDraft = article("主文件草稿");
  await editor.fill(mainDraft);
  await compileButton.click();
  await page
    .locator('[data-testid="latex-compile-status"][data-status="failed"]')
    .waitFor();
  const diagnostics = page.getByTestId("latex-diagnostics");
  const chapterDiagnostic = diagnostics
    .getByTestId("latex-diagnostic-jump")
    .and(page.locator(`[data-path="${chapterPath}"][data-line="3"]`));
  const mainDiagnostic = diagnostics
    .getByTestId("latex-diagnostic-jump")
    .and(page.locator('[data-path="main.tex"][data-line="2"]'));
  await chapterDiagnostic.getByText("Undefined control sequence").waitFor();
  await chapterDiagnostic.click();
  await waitForEditorContent(page, chapterSource);
  await waitForEditorCursor(page, 3, 1);

  const draftStatus = page.locator(
    '[data-testid="latex-save-status"][data-status="dirty"]',
  );
  const chapterDraft = chapterSource.replace(
    "这里是正文。",
    "这里是章节草稿。",
  );
  await editor.fill(chapterDraft);
  await draftStatus.waitFor();
  await mainDiagnostic.click();
  await waitForEditorContent(page, mainDraft);
  await waitForEditorCursor(page, 2, 1);
  await draftStatus.waitFor();
  await chapterDiagnostic.click();
  await waitForEditorContent(page, chapterDraft);
  await waitForEditorCursor(page, 3, 1);
  await draftStatus.waitFor();

  await editor.press("ArrowRight");
  await waitForEditorCursor(page, 3, 2);
  await chapterDiagnostic.click();
  await waitForEditorCursor(page, 3, 1);
  assert.equal(await readFile(mainPath, "utf8"), diagnosticSource);
  assert.equal(
    await readFile(path.join(external, chapterPath), "utf8"),
    chapterSource,
  );
  pass("编译诊断可跨文件和重复定位光标，保留两份未保存草稿及磁盘版本");

  // 5. 停止按钮
  await setMain("%FAKE-SLOW\n");
  await compileButton.click();
  await page
    .locator('[data-testid="latex-compile-status"][data-status="running"]')
    .waitFor();
  assert.equal(await page.getByTestId("latex-stop").isEnabled(), true);
  await page.getByTestId("latex-stop").click();
  await page
    .locator('[data-testid="latex-compile-status"][data-status="aborted"]')
    .waitFor();
  assert.match(await status.innerText(), /已停止/u);
  pass("编译中点击停止，状态变为已停止");

  // 6. 单项目单编译：第二个请求取代第一个
  const first = compileViaIpc(page, externalId);
  await page.waitForTimeout(800);
  await setMain("\\documentclass{article}\n");
  const second = compileViaIpc(page, externalId);
  assert.equal((await first).status, "aborted");
  assert.equal((await second).status, "succeeded");
  pass("同一项目的第二次编译取代第一次（第一次 aborted，第二次 succeeded）");

  // 7. 读取项目外文件：警告并上报路径，不含内容
  await setMain(`%FAKE-READ ${secretFile}\n`);
  await compileButton.click();
  await page.getByTestId("latex-outside-warning").waitFor();
  assert.match(
    await page.getByTestId("latex-outside-warning").innerText(),
    /outside-secret\.txt/u,
  );
  const outside = await compileViaIpc(page, externalId);
  assert.equal(outside.readOutsideProject, true);
  assert.deepEqual(outside.outsidePaths, [secretFile]);
  assert.equal(JSON.stringify(outside).includes("TOP-SECRET-CONTENT"), false);
  pass(
    "读取项目外绝对路径时界面警告，结果带 readOutsideProject 与路径（不含内容）",
  );

  // 8. 重启后仍用显式选择的编译入口；信任仍在，撤销后再次拒绝。
  await fileItem(page, alternateMain).click();
  await waitForEditorContent(page, article("Another entry"));
  assert.match(await compileButton.innerText(), /main\.tex/u);
  await page.getByTestId("latex-set-main").click();
  await compileButton.filter({ hasText: alternateMain }).waitFor();
  const alternatePdf = path.join(path.dirname(pdf), "manuscript.pdf");
  assert.equal(await exists(alternatePdf), false);
  await setMain("%FAKE-FAIL\n");
  page = await restart();
  const persistedCompile = page
    .getByTestId("latex-compile")
    .filter({ hasText: alternateMain });
  await persistedCompile.waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-testid="latex-trust-banner"]') &&
      !document.querySelector('[data-testid="latex-compile"]')?.disabled,
  );
  await persistedCompile.click();
  await page
    .locator('[data-testid="latex-compile-status"][data-status="succeeded"]')
    .waitFor();
  assert.match(await readFile(alternatePdf, "utf8"), /^%PDF/u);
  pass("显式设置另一主文件，重启应用后编译该文件并生成对应 PDF");
  const revoked = await page.evaluate(
    (id) =>
      window.wordhub.invoke("latex.setTrust", {
        projectId: id,
        trusted: false,
      }),
    externalId,
  );
  assert.equal(revoked.trusted, false);
  assert.equal(
    (await compileViaIpc(page, externalId, alternateMain)).status,
    "untrusted",
  );
  pass("重启后信任保留；撤销信任后再次拒绝编译");

  // 9. 新建（空文件夹）的学术项目默认信任
  const freshId = await createProject(page, fresh, "academic");
  assert.notEqual(freshId, externalId);
  const freshTree = page.getByRole("complementary", { name: "LaTeX 文件树" });
  await freshTree.getByText("项目中还没有可打开的 LaTeX 文件。").waitFor();
  const freshSource = article("New project");
  await writeFile(path.join(fresh, "main.tex"), freshSource);
  await freshTree.getByRole("button", { name: "刷新" }).click();
  await waitForEditorContent(page, freshSource);
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="latex-compile"]')?.disabled,
  );
  assert.equal(await page.getByTestId("latex-trust-banner").count(), 0);
  const freshTrust = await page.evaluate(
    (id) => window.wordhub.invoke("latex.trustStatus", { projectId: id }),
    freshId,
  );
  assert.equal(freshTrust.trusted, true);
  assert.equal(freshTrust.reason, "created");
  pass("在 WordHub 内新建（空文件夹）的学术项目默认信任，不显示横幅");

  // 10. 非测试模式下假引擎路径不生效
  await page.evaluate(
    (id) =>
      window.wordhub.invoke("latex.setTrust", { projectId: id, trusted: true }),
    freshId,
  );
  page = await restart({ mock: false });
  const real = await compileViaIpc(page, freshId);
  assert.equal(real.status, "missing-tool");
  assert.equal(real.missingTool, "tectonic");
  assert.match(real.message ?? "", /尚未安装/u);
  pass("未开启 WORDHUB_MOCK 时忽略 WORDHUB_TECTONIC_PATH，提示尚未安装引擎");
} finally {
  await closeApp(app);
  await rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 400,
  });
}
