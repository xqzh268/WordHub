// 使用模拟模型检查项目硬预算的界面、worker 和重启路径。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron } from "playwright";
import { closeApp } from "./lib/close-app.mjs";
import { electronBinary, mainArgs } from "./lib/electron-target.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "wordhub-budget-e2e-"));
const userData = path.join(temp, "appdata");
const folder = path.join(temp, "budget-novel");
const lowBudget = 0.000001;
const highBudget = 100;
const reviewPrompt = "请评审当前章节的一致性";
const directPrompt = "@评审 请简短说明你能核验哪些内容。";
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
    args: [...mainArgs(root), `--user-data-dir=${userData}`],
    cwd: root,
    env: { ...env, WORDHUB_MOCK: "1", WORDHUB_WORKSPACE_ROOT: root },
  });
  const page = await app.firstWindow({ timeout: 15000 });
  page.setDefaultTimeout(15000);
  await page.getByTestId("worker-status").filter({ hasText: "待命" }).waitFor();
  await page.evaluate(() => {
    window.budgetEvents = [];
    window.wordhub.subscribe((event) => {
      if (event.type === "run.event") window.budgetEvents.push(event.payload);
    });
  });
  return page;
}

const invoke = (page, command, payload) =>
  page.evaluate(
    ({ command, payload }) => window.wordhub.invoke(command, payload),
    { command, payload },
  );
const markEvents = (page) => page.evaluate(() => window.budgetEvents.length);

async function waitForEvent(page, { from, type, runId }) {
  const event = await page.waitForFunction(
    ({ from, type, runId }) =>
      window.budgetEvents
        .slice(from)
        .find(
          (entry) =>
            entry.type === type &&
            (runId === undefined || entry.runId === runId),
        ),
    { from, type, runId },
  );
  return event.jsonValue();
}

async function expectNoModelOutput(page, from) {
  const unexpected = await page.evaluate(
    (from) =>
      window.budgetEvents.slice(from).filter((entry) => {
        if (entry.type === "run.usage")
          return entry.usage.totalTokens > 0 || entry.costUsd > 0;
        return ["run.text", "run.tool_execution_start"].includes(entry.type);
      }),
    from,
  );
  assert.deepEqual(unexpected, [], "预算拒绝后没有模型输出、用量或工具调用");
}

async function expectNoReservation(page, projectId, sessionId, runId) {
  const { events } = await invoke(page, "chat.list", { projectId, sessionId });
  const runEvents = events.filter((event) => event.runId === runId);
  assert.equal(
    runEvents.find((event) => event.type === "run.budget.configured")?.payload
      .limitUsd,
    lowBudget,
  );
  assert.ok(!runEvents.some((event) => event.type === "run.budget.reserved"));
}

async function expectBlocked(page, from, runId) {
  const event = await waitForEvent(page, { from, runId, type: "error" });
  assert.match(event.error, /运行预算不足/u);
  await expectNoModelOutput(page, from);
  return event.runId;
}

async function expectBudget(page, projectId, runBudgetUsd) {
  await page.waitForFunction(
    async ({ projectId, runBudgetUsd }) =>
      (await window.wordhub.invoke("project.prefs.get", { projectId }))
        .runBudgetUsd === runBudgetUsd,
    { projectId, runBudgetUsd },
    { polling: 100 },
  );
}

async function setBudget(page, projectId, value) {
  await page.getByTestId("rail-settings").click();
  const input = page.getByTestId("run-budget-usd");
  await input.fill(String(value));
  await page.getByTestId("run-budget-save").click();
  await expectBudget(page, projectId, value);
  await page
    .getByTestId("run-budget-status")
    .filter({ hasText: `当前上限：${value} 美元` })
    .waitFor();
  await page.getByTestId("rail-workspace").click();
}

async function send(page, prompt) {
  await page.getByTestId("composer-input").fill(prompt);
  await page.getByTestId("send").click();
}

async function verifyIntakeFallback(page, projectId, sessionId) {
  const from = await markEvents(page);
  await send(page, "写一部唐代悬疑短篇，主角是巡夜人裴照。");
  const { intakeId, runId } = await waitForEvent(page, {
    from,
    type: "intake.started",
  });
  // 纲领答题也能从受支持的 IPC 入口提交，此处直接走完十道题。
  const answers = {
    premise: "巡夜人追查坊门失踪案。",
    protagonist: "裴照，想找到失踪的坊门守卫。",
    conflict: "案子牵涉裴照的老师。",
    world: "",
    viewpointTone: "",
    theme: "",
    audience: "",
    chapterCount: "",
    mustInclude: "",
    forbidden: "",
  };
  for (const [key, value] of Object.entries(answers)) {
    await invoke(page, "intake.answer", {
      projectId,
      sessionId,
      intakeId,
      questionId: `${intakeId}:${key}`,
      value,
    });
  }
  const draft = await waitForEvent(page, {
    from,
    runId,
    type: "intake.draft.ready",
  });
  assert.equal(draft.source, "template");
  assert.match(draft.error, /运行预算不足/u);
  assert.equal(draft.usage, undefined);
  await expectNoModelOutput(page, from);
  await expectNoReservation(page, projectId, sessionId, runId);
  await page
    .getByTestId("draft-card")
    .getByText(/问答整理/u)
    .waitFor();
  await page.getByTestId("draft-doc").first().waitFor();
  await page.getByRole("button", { name: "确认并写入", exact: true }).click();
  await waitForEvent(page, { from, runId, type: "intake.confirmed" });
  const outline = await readFile(
    path.join(folder, ".wordhub", "bible", "outline.md"),
    "utf8",
  );
  assert.ok(outline.includes(answers.premise));
}

try {
  await mkdir(folder);
  let page = await launch();
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selected],
    });
  }, folder);
  await page.getByTestId("link-folder").click();
  await page.getByTestId("project-card").waitFor();
  const { projectId, activeSessionId } = await invoke(
    page,
    "workspace.getSnapshot",
  );
  assert.ok(projectId && activeSessionId);
  await expectBudget(page, projectId, null);
  await setBudget(page, projectId, lowBudget);

  let from = await markEvents(page);
  await send(page, directPrompt);
  await page
    .getByTestId("chat-scroll")
    .locator(".notice")
    .filter({ hasText: "预估：" })
    .filter({ hasText: `本次运行预算上限：${lowBudget} 美元` })
    .waitFor();
  const blockedChatId = await expectBlocked(page, from);
  await expectNoReservation(page, projectId, activeSessionId, blockedChatId);
  await page
    .getByTestId("chat-scroll")
    .locator(".msg-error")
    .filter({
      hasText: "运行预算",
    })
    .waitFor();
  await page.getByTestId("send").waitFor();
  console.log("PASS  有聊天预估的单角色运行被预算阻止，界面显示原因");

  from = await markEvents(page);
  const { runId } = await invoke(page, "run.start", {
    projectId,
    sessionId: activeSessionId,
    agentId: "reviewer",
    prompt: "直接请求评审，无界面估算。",
  });
  await expectBlocked(page, from, runId);
  await expectNoReservation(page, projectId, activeSessionId, runId);
  await page.getByTestId("send").waitFor();
  console.log("PASS  直接 run.start 绕过界面估算仍受硬预算限制");

  from = await markEvents(page);
  await page.getByTestId("request-review").click();
  await expectBlocked(page, from);
  const stoppedWorkflow = await waitForEvent(page, {
    from,
    type: "workflow.failed",
  });
  await expectNoModelOutput(page, from);
  await expectNoReservation(
    page,
    projectId,
    activeSessionId,
    stoppedWorkflow.runId,
  );
  await page.getByTestId("send").waitFor();
  console.log("PASS  界面启动的评审工作流受预算限制并结束");

  await verifyIntakeFallback(page, projectId, activeSessionId);
  console.log("PASS  纲领生成受预算限制后仍可查看、确认本地模板草稿");

  await closeApp(app);
  app = undefined;
  page = await launch();
  await page.getByTestId("project-card").waitFor();
  assert.equal(
    (await invoke(page, "workspace.getSnapshot")).projectId,
    projectId,
  );
  await expectBudget(page, projectId, lowBudget);
  await setBudget(page, projectId, highBudget);
  from = await markEvents(page);
  await send(page, directPrompt);
  await waitForEvent(page, { from, type: "run.finished" });
  await page.getByTestId("send").waitFor();
  console.log("PASS  重启保留项目预算，放宽后可重新启动同一个请求");

  await page.getByTestId("rail-settings").click();
  await page.getByTestId("run-budget-disable").click();
  await expectBudget(page, projectId, null);
  await page
    .getByTestId("run-budget-status")
    .filter({ hasText: "当前无上限" })
    .waitFor();
  await page.getByTestId("rail-workspace").click();
  from = await markEvents(page);
  await send(page, reviewPrompt);
  await waitForEvent(page, { from, type: "workflow.finished" });
  console.log("PASS  清空预算后，无上限的评审工作流正常结束");
} finally {
  await closeApp(app);
  await rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 400,
  });
}
