// 通过真实 Electron 界面创建和打开项目。只替换系统文件夹对话框，后台使用 mock 模式。
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
const temp = await mkdtemp(path.join(os.tmpdir(), "wordhub-project-kind-"));
const storageRoot = path.join(temp, "appdata");
const novel = path.join(temp, "new-novel");
const academic = path.join(temp, "new-academic");
const legacy = path.join(temp, "legacy-novel");
const legacyId = "project_legacy";
const legacyText = "旧项目的正文可以继续阅读和编辑。";
const descriptorPath = (folder) =>
  path.join(folder, ".wordhub", "project.json");

const {
  ELECTRON_RUN_AS_NODE,
  DEEPSEEK_API_KEY: _ambientKey,
  WORDHUB_DEEPSEEK_API_KEY: _appKey,
  WORDHUB_DEMO: _demo,
  ...env
} = process.env;

let app;
async function launch() {
  app = await _electron.launch({
    executablePath: electronBinary,
    args: [...mainArgs(root), `--user-data-dir=${storageRoot}`],
    cwd: root,
    env: { ...env, WORDHUB_MOCK: "1", WORDHUB_WORKSPACE_ROOT: root },
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

async function restart() {
  await closeApp(app);
  app = undefined;
  return launch();
}

async function stubFolderDialog(folder) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selected],
    });
  }, folder);
}

async function expectProject(page, folder, kind) {
  await page
    .getByTestId("project-card")
    .filter({ hasText: path.basename(folder) })
    .waitFor();
  const snapshot = await page.evaluate(() =>
    window.wordhub.invoke("workspace.getSnapshot", undefined),
  );
  assert.equal(snapshot.linkedFolder, folder);
  assert.equal(snapshot.projectKind, kind);
  assert.ok(snapshot.projectId, "项目快照应有 ID");
  return snapshot.projectId;
}

async function createProject(page, folder, kind) {
  await stubFolderDialog(folder);
  await page.getByTestId("new-project").click();
  const dialog = page.getByTestId("new-project-dialog");
  const select = dialog.getByTestId("new-project-kind");
  assert.equal(await select.inputValue(), "novel", "新建时默认选择小说");
  await select.selectOption(kind);
  await dialog.getByTestId("new-project-choose-folder").click();
  const id = await expectProject(page, folder, kind);
  const descriptor = JSON.parse(await readFile(descriptorPath(folder), "utf8"));
  assert.equal(descriptor.kind, kind);
  assert.equal(descriptor.projectId, id);
  return id;
}

async function expectAcademicWorkspace(page) {
  const workspace = page.getByTestId("academic-workspace");
  await workspace.getByRole("heading", { name: "学术写作" }).waitFor();
  await workspace.getByText("LaTeX 工作台将在后续版本开放").waitFor();
  assert.equal(await page.getByTestId("composer-input").count(), 0);
  assert.equal(await page.getByTestId("paper-sheet").count(), 0);
}

async function expectNovelWorkspace(page) {
  await page.getByTestId("paper-sheet").waitFor();
  await page.getByTestId("composer-input").waitFor();
  assert.equal(await page.getByTestId("academic-workspace").count(), 0);
}

try {
  await Promise.all([
    mkdir(novel),
    mkdir(academic),
    mkdir(path.dirname(descriptorPath(legacy)), { recursive: true }),
    mkdir(path.join(legacy, "chapters"), { recursive: true }),
  ]);
  await writeFile(
    descriptorPath(legacy),
    JSON.stringify({
      schemaVersion: 1,
      projectId: legacyId,
      linkedFolder: legacy,
      storage: "appData/WordHub/projects",
    }),
    "utf8",
  );
  await writeFile(
    path.join(legacy, "chapters", "第一章.md"),
    `# 第一章\n\n${legacyText}\n`,
    "utf8",
  );

  let page = await launch();
  const novelId = await createProject(page, novel, "novel");
  await expectNovelWorkspace(page);
  console.log("PASS  界面新建小说，project.json 持久化 novel");

  const academicId = await createProject(page, academic, "academic");
  assert.notEqual(academicId, novelId);
  await expectAcademicWorkspace(page);
  console.log("PASS  界面新建学术项目，显示学术工作台占位并持久化 academic");

  await assert.rejects(
    page.evaluate(
      (projectId) => window.wordhub.invoke("chapter.list", { projectId }),
      academicId,
    ),
    /学术写作工作台尚未开放/u,
  );
  await assert.rejects(stat(path.join(academic, "chapters")), {
    code: "ENOENT",
  });
  console.log("PASS  学术项目拒绝小说章节 IPC，项目目录未创建 chapters");

  page = await restart();
  assert.equal(await expectProject(page, academic, "academic"), academicId);
  await expectAcademicWorkspace(page);
  console.log("PASS  重开应用后恢复同一个学术项目和占位工作区");

  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings").waitFor();
  await page.getByTestId("rail-workspace").click();
  await expectAcademicWorkspace(page);
  console.log("PASS  学术项目可进入设置并返回工作区");

  await stubFolderDialog(novel);
  await page.getByTestId("project-card").click();
  assert.equal(await expectProject(page, novel, "novel"), novelId);
  await expectNovelWorkspace(page);
  console.log("PASS  从学术项目重新打开小说，恢复同一项目的聊天和纸面");

  page = await restart();
  assert.equal(await expectProject(page, novel, "novel"), novelId);
  await expectNovelWorkspace(page);
  console.log("PASS  再次重开后恢复最近打开的小说项目");

  await stubFolderDialog(legacy);
  await page.getByTestId("project-card").click();
  assert.equal(await expectProject(page, legacy, "novel"), legacyId);
  await expectNovelWorkspace(page);
  await page.getByTestId("paper-sheet").getByText(legacyText).waitFor();
  await page.getByTestId("edit-paper").waitFor();
  console.log("PASS  缺少 kind 的旧描述符沿用原项目 ID，并按小说打开章节");
} finally {
  await closeApp(app);
  await rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 400,
  });
}
