// M3 第 5 步：真实 DeepSeek 工作流回归。缺密钥时可跳过，CI 要求真实运行。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";
import { closeApp } from "./lib/close-app.mjs";
import { electronBinary, mainArgs } from "./lib/electron-target.mjs";
import { flashOnly, writeTestModelOverrides } from "./lib/test-models.mjs";

const key =
  process.env.DEEPSEEK_API_KEY ?? process.env.WORDHUB_DEEPSEEK_API_KEY;
if (!key) {
  if (process.env.WORDHUB_REQUIRE_LIVE === "1") {
    console.error("失败：M3 真实回归要求 DEEPSEEK_API_KEY。");
    process.exit(2);
  }
  console.log("跳过：未设置 DEEPSEEK_API_KEY（本地可选）。");
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-m3-live-"));
const userData = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
const chapterDir = path.join(folder, "chapters");
const original = "裴照走进崇仁坊，听见坊门后的更鼓。\n";
const characterFile = ".wordhub/bible/characters.md";
const characterText =
  "# 人物档案\n## 主角：裴照\n裴照是左撇子，惯用横刀。裴照右手因旧伤不能握刀。\n";
const reviewChapter = "chapters/第四章.md";
const contradiction = "# 第四章 石桥\n\n裴照用右手握住刀柄，缓步走下石桥。\n";
const clean =
  "# 第五章 晚钟\n\n裴照左手按住刀柄，站在坊墙下。远处的晚钟响了两遍。\n";
const reportDir = process.env.WORDHUB_M3_REPORT_DIR
  ? path.resolve(process.env.WORDHUB_M3_REPORT_DIR)
  : path.join(root, "artifacts");
const reportPath = path.join(reportDir, "m3-live-e2e-result.json");
const failurePath = path.join(reportDir, "m3-live-e2e-failure.json");
const phases = {};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readProjectFile = (relative) =>
  fs.readFileSync(path.join(folder, relative), "utf8");
const redact = (message) => String(message).replaceAll(key, "[已隐藏]");

function withDatabase(read) {
  const dir = path.join(userData, "projects");
  const file = fs
    .readdirSync(dir)
    .map((id) => path.join(dir, id, "wordhub.sqlite"))
    .find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error("项目数据库未创建");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

const events = () =>
  withDatabase((db) =>
    db
      .prepare("SELECT * FROM events ORDER BY seq")
      .all()
      .map((row) => ({ ...row, payload: JSON.parse(row.payload_json) })),
  );
const tasks = (runId) =>
  withDatabase((db) =>
    db
      .prepare(
        "SELECT id, kind, status, attempt FROM tasks WHERE run_id=? ORDER BY id",
      )
      .all(runId),
  );
const belongsTo = (event, workflowId) =>
  event.run_id === workflowId || event.payload.workflowId === workflowId;
const workflowEvents = (workflowId) => {
  const rows = events();
  const runIds = new Set(
    rows
      .filter((event) => belongsTo(event, workflowId))
      .map((event) => event.run_id),
  );
  return rows.filter((event) => runIds.has(event.run_id));
};

async function waitUntil(description, check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = await check();
    if (match) return match;
    await delay(250);
  }
  throw new Error(`等待超时：${description}`);
}

async function waitForChapter(page, relativePath) {
  await page
    .getByTestId("chapter-select")
    .locator(`option[value=${JSON.stringify(relativePath)}]`)
    .waitFor({ state: "attached", timeout: 15000 });
}

const approvalEvents = (items) =>
  items.filter((event) =>
    ["approval.granted", "approval.rejected", "escalation.resolved"].includes(
      event.type,
    ),
  );

async function runWorkflow(page, name, prompt, expectedWorkflow) {
  const before = events().at(-1)?.seq ?? 0;
  const result = { prompt };
  phases[name] = result;
  console.log(`M3 开始：${name}`);
  await page.waitForSelector('[data-testid="stop"]', {
    state: "hidden",
    timeout: 20000,
  });
  await page.fill('[data-testid="composer-input"]', prompt);
  await page.click('[data-testid="send"]');
  const started = await waitUntil(
    `开始 ${name}`,
    () =>
      events().find(
        (event) => event.seq > before && event.type === "workflow.started",
      ),
    30000,
  );
  const workflowId = started.run_id;
  result.workflowId = workflowId;
  assert.equal(
    started.payload.workflow,
    expectedWorkflow,
    `${name} 路由不正确`,
  );
  const approve = page
    .locator(".entry-approval .approval:not(.resolved) .btn-primary:visible")
    .first();
  const terminal = await waitUntil(
    `结束 ${name}`,
    async () => {
      const current = workflowEvents(workflowId);
      const finished = current.find((event) =>
        ["workflow.finished", "workflow.failed"].includes(event.type),
      );
      if (finished) return finished;
      if (await approve.isVisible()) {
        const count = approvalEvents(current).length;
        await approve.click({ timeout: 10000 });
        await waitUntil(
          `记录 ${name} 的审批或裁决`,
          () => approvalEvents(workflowEvents(workflowId)).length > count,
          15000,
        );
      }
      return undefined;
    },
    420000,
  );

  const current = workflowEvents(workflowId);
  const agentRuns = current.filter(
    (event) => event.type === "run.started" && event.payload.agentId,
  );
  const pendingDecisions = current
    .filter((event) => event.type === "escalation.created")
    .filter(
      (event) =>
        !current.some(
          (candidate) =>
            candidate.type === "escalation.resolved" &&
            candidate.payload.threadId === event.payload.threadId,
        ),
    );
  const taskRows = tasks(workflowId);
  Object.assign(result, {
    terminal: terminal.type,
    agents: [...new Set(agentRuns.map((event) => event.payload.agentId))],
    models: [...new Set(agentRuns.map((event) => event.payload.model))],
    challenges: current.filter((event) => event.type === "challenge.raise")
      .length,
    escalations: current.filter((event) => event.type === "escalation.created")
      .length,
    decisions: current.filter((event) => event.type === "escalation.resolved")
      .length,
    tasks: taskRows,
  });
  assert.equal(terminal.type, "workflow.finished", `${name} 没有正常结束`);
  assert.ok(
    taskRows.length && taskRows.every((task) => task.status === "succeeded"),
    `${name} 有尚未成功收尾的任务`,
  );
  assert.equal(pendingDecisions.length, 0, `${name} 有遗留裁决`);
  assert.equal(
    current.filter((event) => event.type === "approval.requested").length,
    current.filter((event) =>
      ["approval.granted", "approval.rejected"].includes(event.type),
    ).length,
    `${name} 有遗留工具审批`,
  );
  if (flashOnly())
    assert.deepEqual(
      result.models,
      ["deepseek-flash"],
      `${name} 未使用指定的 flash`,
    );
  return { current, result, agentRuns };
}

const normalizeQuote = (text) => text.replace(/[\s“”「」『』"'‘’]/gu, "");
function hasEvidence(citations, source, originalText, detail) {
  return citations.some((citation) => {
    if (
      typeof citation.source !== "string" ||
      typeof citation.quote !== "string"
    )
      return false;
    const actualSource = citation.source
      .replaceAll("\\", "/")
      .replace(/#.*$/u, "");
    const quote = normalizeQuote(citation.quote);
    return (
      actualSource === source &&
      detail.test(quote) &&
      normalizeQuote(originalText).includes(quote)
    );
  });
}

// 改用左手或删去持刀动作均可。右手不能握刀等否定句与设定一致。
const rightHandGripsKnife =
  /(?:右手|右掌)(?:\s|紧紧|死死|一把|反手|顺势|下意识地)*(?:(?:紧握|握|攥|执|持|提|按|扣|抓|捏)(?:住|紧|着|起|上)?(?:那把|那柄|这把|自己的|腰间的|\s)*(?:横刀|刀柄|刀)|(?:把|将)(?:横刀|刀柄|刀)(?:握|攥|紧握|提|抓|按))/u;

function writeReport(outcome, file = reportPath) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(outcome, null, 2)}\n`, "utf8");
}

let app;
let phase = "启动应用";
try {
  writeTestModelOverrides(folder);
  fs.mkdirSync(path.join(folder, ".wordhub", "bible"), { recursive: true });
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.writeFileSync(path.join(folder, characterFile), characterText, "utf8");
  fs.writeFileSync(path.join(chapterDir, "第三章.md"), original, "utf8");
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  app = await _electron.launch({
    executablePath: electronBinary,
    args: [...mainArgs(root), `--user-data-dir=${userData}`],
    cwd: root,
    env: {
      ...env,
      DEEPSEEK_API_KEY: key,
      WORDHUB_DEEPSEEK_API_KEY: key,
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
    { timeout: 20000 },
  );
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selected],
    });
  }, folder);
  await page.click('[data-testid="link-folder"]');
  await page.waitForSelector('[data-testid="project-card"]');

  phase = "全流程写章";
  const writing = await runWorkflow(
    page,
    phase,
    "全流程写第三章。",
    "write-chapter-full",
  );
  const roleOrder = writing.agentRuns.map((event) => event.payload.agentId);
  assert.deepEqual(roleOrder.slice(0, 3), ["writer", "editor", "reviewer"]);
  const writtenAgents = writing.current
    .filter(
      (event) =>
        event.type === "revision.committed" &&
        event.payload.relativePath === "chapters/第三章.md",
    )
    .map((event) => event.actor_id);
  assert.ok(writtenAgents.includes("writer"), "写手没有提交章节修订");
  const chapter = readProjectFile("chapters/第三章.md");
  assert.ok(
    chapter !== original && chapter.includes("裴照"),
    "纸面对应的章节文件未写入正文",
  );
  await page.waitForSelector(".entry-agent");
  await page.waitForSelector(".usage-summary");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="paper-sheet"]')
        ?.textContent?.includes("裴照"),
    null,
    { timeout: 15000 },
  );
  Object.assign(writing.result, {
    revisionsBy: writtenAgents,
    chapterCharacters: chapter.length,
  });

  phase = "固定矛盾评审与返工";
  // 单独提交评审，避免写手在评审之前已消除预埋矛盾。
  fs.writeFileSync(path.join(folder, reviewChapter), contradiction, "utf8");
  await waitForChapter(page, reviewChapter);
  const reviewed = await runWorkflow(
    page,
    phase,
    "请评审第四章。",
    "review-only",
  );
  const repaired = readProjectFile(reviewChapter);
  reviewed.result.revisedChapter = repaired;
  const raised = reviewed.current.find((event) => {
    const { citations, severity } = event.payload;
    return (
      event.type === "challenge.raise" &&
      severity === "blocking" &&
      Array.isArray(citations) &&
      hasEvidence(citations, reviewChapter, contradiction, /右手握住刀柄/u) &&
      hasEvidence(
        citations,
        characterFile,
        characterText,
        /右手因旧伤不能握刀/u,
      )
    );
  });
  assert.ok(raised, "真实评审没有以两端原文指出预埋的持刀矛盾");
  Object.assign(reviewed.result, {
    threadId: raised.payload.threadId,
    claim: raised.payload.claim,
    citations: raised.payload.citations,
  });
  assert.ok(
    reviewed.current.some(
      (event) =>
        ["challenge.resolved", "escalation.resolved"].includes(event.type) &&
        event.payload.threadId === raised.payload.threadId,
    ),
    "未解决预埋矛盾对应的质询",
  );
  assert.ok(
    reviewed.current.some(
      (event) =>
        event.type === "revision.committed" &&
        event.payload.relativePath === reviewChapter &&
        event.actor_id === "writer",
    ),
    "没有受控返工修订",
  );
  assert.ok(
    repaired !== contradiction &&
      repaired.includes("裴照") &&
      repaired.includes("石桥") &&
      !rightHandGripsKnife.test(repaired),
    "返工正文仍未修正持刀动作",
  );
  await page.waitForSelector(".entry-thread");
  await page
    .locator('[data-testid="thread-cites"]')
    .filter({ hasText: "右手握住刀柄" })
    .first()
    .waitFor({ timeout: 15000 });

  phase = "干净章节评审";
  const cleanChapter = "chapters/第五章.md";
  fs.writeFileSync(path.join(folder, cleanChapter), clean, "utf8");
  await waitForChapter(page, cleanChapter);
  const cleanReview = await runWorkflow(
    page,
    phase,
    "请评审第五章。",
    "review-only",
  );
  assert.equal(cleanReview.result.challenges, 0, "无矛盾章节出现误报质询");
  assert.equal(
    readProjectFile(cleanChapter),
    clean,
    "干净章节在只评审时被修改",
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="paper-sheet"]')
        ?.textContent?.includes("晚钟响了两遍"),
    null,
    { timeout: 15000 },
  );
  assert.equal(
    await page.getByTestId("chapter-select").inputValue(),
    cleanChapter,
  );

  phase = "全体协作";
  const all = await runWorkflow(
    page,
    phase,
    "@all 请分别给出当前项目的协作意见",
    "all",
  );
  for (const agent of ["writer", "editor", "reviewer", "observer", "planner"])
    assert.ok(all.result.agents.includes(agent), `全体协作缺少 ${agent} 节点`);
  writeReport({ status: "passed", phases });
  console.log(
    "M3 真实回归通过：全流程写章、矛盾质询与返工、干净章节、全体协作。",
  );
} catch (error) {
  let details;
  try {
    details = events()
      .filter(
        (event) =>
          /^(workflow\.|challenge\.|escalation\.|approval\.)/u.test(
            event.type,
          ) ||
          [
            "run.started",
            "run.finished",
            "run.error",
            "task.failed",
            "revision.committed",
            "file.updated",
          ].includes(event.type),
      )
      .map((event) => ({
        seq: event.seq,
        type: event.type,
        runId: event.run_id,
        actor: event.actor_id,
        model: event.payload.model,
        path: event.payload.relativePath ?? event.payload.path,
        taskId: event.payload.taskId,
        claim: event.payload.claim,
        citations: event.payload.citations,
        chapterText:
          event.type === "revision.committed" &&
          event.payload.relativePath === reviewChapter &&
          typeof event.payload.text === "string"
            ? redact(event.payload.text)
            : undefined,
        error:
          event.payload.error === undefined
            ? undefined
            : redact(event.payload.error),
      }));
  } catch {
    /* 应用启动失败时数据库可能尚未创建。 */
  }
  const message = redact(error instanceof Error ? error.message : error);
  writeReport(
    { status: "failed", phase, error: message, phases, details },
    failurePath,
  );
  throw new Error(`M3 ${phase}失败：${message}`);
} finally {
  await closeApp(app);
  try {
    fs.rmSync(tmp, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 400,
    });
  } catch {
    /* Windows 句柄尚未释放，留给系统清理。 */
  }
}
