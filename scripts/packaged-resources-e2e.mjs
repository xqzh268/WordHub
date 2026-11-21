// 用法：node scripts/packaged-resources-e2e.mjs <unpacked/WordHub.exe>
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron } from "playwright";
import { closeApp } from "./lib/close-app.mjs";

const executable = process.argv[2];
assert.ok(executable, "请传入已打包的 WordHub.exe 路径");
const executablePath = path.resolve(executable);
const resources = path.join(path.dirname(executablePath), "resources");
const temp = await mkdtemp(path.join(os.tmpdir(), "wordhub-packaged-e2e-"));
const cwd = path.join(temp, "standalone");
const folder = path.join(temp, "novel-project");
const {
  ELECTRON_RUN_AS_NODE,
  ELECTRON_RENDERER_URL: _rendererUrl,
  DEEPSEEK_API_KEY: _ambientKey,
  WORDHUB_DEEPSEEK_API_KEY: _appKey,
  WORDHUB_DEMO: _demo,
  WORDHUB_WORKSPACE_ROOT: _originalWorkspace,
  ...env
} = process.env;

async function openPackaged(userData, workspaceRoot, check) {
  const app = await _electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`],
    cwd,
    env: {
      ...env,
      WORDHUB_MOCK: "1",
      ...(workspaceRoot ? { WORDHUB_WORKSPACE_ROOT: workspaceRoot } : {}),
    },
  });
  try {
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    const page = await app.firstWindow({ timeout: 15000 });
    page.setDefaultTimeout(15000);
    await page.waitForFunction(
      async () =>
        (await window.wordhub?.invoke("workspace.getSnapshot", undefined))
          ?.worker === "ready",
      null,
      { polling: 100 },
    );
    await check(app, page);
  } finally {
    await closeApp(app);
  }
}

async function estimateReview(page) {
  return page.evaluate(() =>
    window.wordhub.invoke("run.estimate", { prompt: "请评审当前章节的一致性" }),
  );
}

try {
  await Promise.all([mkdir(cwd), mkdir(folder)]);
  await openPackaged(
    path.join(temp, "appdata"),
    undefined,
    async (app, page) => {
      const settings = await page.evaluate(() =>
        window.wordhub.invoke("settings.models", undefined),
      );
      assert.deepEqual(
        settings.agents
          .filter((agent) => agent.source === "builtin")
          .map((agent) => agent.id)
          .sort(),
        ["editor", "observer", "planner", "reviewer", "writer"],
      );

      await app.evaluate(({ dialog }, selected) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selected],
        });
      }, folder);
      await page.getByTestId("link-folder").click();
      await page.getByTestId("project-card").waitFor();
      assert.equal((await estimateReview(page)).workflow, "review-only");

      await page.getByTestId("request-review").click();
      const response = page.locator(".entry-agent").filter({
        hasText: "文枢后台进程正在流式写作",
      });
      await response.getByText("评审", { exact: true }).waitFor();
      await page.getByTestId("send").waitFor();
      console.log("PASS  仓库外启动打包版，加载五个内置角色并完成模拟评审");
    },
  );

  const override = path.join(temp, "override");
  const relativeNovelRoot = path.join("packages", "novel");
  const overrideNovel = path.join(override, relativeNovelRoot);
  await cp(path.join(resources, relativeNovelRoot), overrideNovel, {
    recursive: true,
  });
  const reviewFile = path.join(overrideNovel, "workflows", "review-only.json");
  const definition = JSON.parse(await readFile(reviewFile, "utf8"));
  const overrideLabel = "评审资源根覆盖测试";
  await writeFile(
    reviewFile,
    JSON.stringify({ ...definition, label: overrideLabel }),
    "utf8",
  );
  await openPackaged(
    path.join(temp, "override-appdata"),
    override,
    async (_app, page) => {
      const estimate = await estimateReview(page);
      assert.equal(estimate.workflow, "review-only");
      assert.equal(estimate.label, overrideLabel);
      console.log("PASS  打包版优先使用显式指定的小说资源根");
    },
  );
} finally {
  await rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 400,
  });
}
