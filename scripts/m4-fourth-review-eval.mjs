// M4.7 第四章评审间歇性收尾评测：固定跨章矛盾，独立项目重复评审。
// 用法：DEEPSEEK_API_KEY=... WORDHUB_REQUIRE_LIVE=1 node scripts/m4-fourth-review-eval.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { _electron } from "playwright";
import { WordHubStore, createId, timestamp } from "@wordhub/store";
import { writeTestModelOverrides } from "./lib/test-models.mjs";
import { summarizeRunEvents } from "./lib/m4-diagnostics.mjs";

const KEY = process.env.DEEPSEEK_API_KEY;
const trials = Math.max(
  1,
  Number(process.env.WORDHUB_FOURTH_REVIEW_TRIALS ?? 3),
);
if (!KEY) {
  if (process.env.WORDHUB_REQUIRE_LIVE === "1") {
    console.error("失败：第四章评审评测要求 DEEPSEEK_API_KEY。");
    process.exit(2);
  }
  console.log("跳过：未设置 DEEPSEEK_API_KEY");
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeFixture(folder, projectId) {
  const bible = path.join(folder, ".wordhub", "bible");
  const chapters = path.join(folder, "chapters");
  fs.mkdirSync(bible, { recursive: true });
  fs.mkdirSync(chapters, { recursive: true });
  fs.writeFileSync(
    path.join(folder, ".wordhub", "project.json"),
    JSON.stringify({
      schemaVersion: 1,
      projectId,
      linkedFolder: folder,
      storage: "appData/WordHub/projects",
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(bible, "outline.md"),
    "# 大纲\n\n## 第三章 宫门影子\n- 目标：老周死亡。\n\n## 第四章 旧案回响\n- 目标：查清老周死亡后的线索。\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(bible, "characters.md"),
    "# 人物档案\n\n## 主角：裴照\n- 身份：不良人。\n\n## 配角：老周\n- 身份：质库掌柜。\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(bible, "setting.md"),
    "# 设定\n- 唐代长安崇仁坊。\n- 老周在第三章末尾已经死亡。\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(bible, "style.md"),
    "# 文风\n- 冷峻克制，第三人称限知。\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(chapters, "第三章.md"),
    "# 第三章 宫门影子\n\n裴照赶到质库后墙时，老周已经倒地。胸口中了一刀，血已凉透，呼吸全无。裴照替老周合上眼睛，确认质库掌柜老周已死。\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(chapters, "第四章.md"),
    "# 第四章 旧案回响\n\n翌日清晨，老周仍站在质库柜台后，笑着招呼裴照。\n",
    "utf8",
  );
  writeTestModelOverrides(folder);
}

function seedProject(storageRoot, projectId, folder) {
  const store = new WordHubStore(path.join(storageRoot, "projects", projectId));
  const project = store.createProject({
    id: projectId,
    name: "第四章评审评测",
    folderPath: folder,
  });
  const session = store.createSession({ projectId, title: "评测" });
  const append = (type, payload) =>
    store.appendEvent({
      schemaVersion: 1,
      id: createId("evt"),
      projectId,
      sessionId: session.id,
      runId: "seed_review_eval",
      type,
      actor: { type: "system", id: "eval" },
      occurredAt: timestamp(),
      visibility: "room",
      payload,
    });
  append("chapter.summary", {
    chapter: "chapters/第三章.md",
    text: "老周在质库后墙被杀，裴照确认其死亡。",
  });
  append("fact.proposed", {
    factId: "seed_death",
    kind: "character_state",
    subject: "老周",
    statement: "老周在第三章末尾死亡。",
    chapter: "chapters/第三章.md",
    quote: "确认质库掌柜老周已死",
  });
  append("fact.confirmed", { factId: "seed_death" });
  store.close();
  return session.id;
}

function readEvents(userData) {
  const projects = path.join(userData, "projects");
  const id = fs
    .readdirSync(projects)
    .find((name) => fs.existsSync(path.join(projects, name, "wordhub.sqlite")));
  if (!id) return [];
  const database = new DatabaseSync(path.join(projects, id, "wordhub.sqlite"), {
    readOnly: true,
  });
  const rows = database.prepare("SELECT * FROM events ORDER BY seq").all();
  database.close();
  return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));
}

async function runTrial(index) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-fourth-review-"));
  const userData = path.join(tmp, "appdata");
  const projectId = `fourth_review_${index}`;
  const folder = path.join(tmp, "项目", "长安夜");
  writeFixture(folder, projectId);
  seedProject(userData, projectId, folder);
  const env = {
    ...process.env,
    DEEPSEEK_API_KEY: KEY,
    WORDHUB_WORKSPACE_ROOT: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.WORDHUB_TEST_FULL_MODELS;
  let app;
  const startedAt = Date.now();
  try {
    app = await _electron.launch({
      executablePath: electron,
      args: [
        path.join(root, "out/main/index.js"),
        `--user-data-dir=${userData}`,
      ],
      cwd: root,
      env,
    });
    const page = await app.firstWindow();
    await page.waitForSelector(".app");
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="worker-status"]')
          ?.textContent?.includes("待命"),
      null,
      { timeout: 30000 },
    );
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [chosen],
      });
    }, folder);
    await page.click('[data-testid="link-folder"]');
    await page.waitForSelector('[data-testid="project-card"]');
    const before = readEvents(userData).length;
    await page.fill('[data-testid="composer-input"]', "请评审第四章");
    await page.click('[data-testid="send"]');
    const deadline = Date.now() + 600000;
    let finished;
    let failed;
    while (Date.now() < deadline && !finished && !failed) {
      const slice = readEvents(userData).slice(before);
      finished = slice.find((event) => event.type === "workflow.finished");
      failed = slice.find((event) => event.type === "workflow.failed");
      await sleep(1500);
    }
    const slice = readEvents(userData).slice(before);
    return {
      trial: index,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      finished: Boolean(finished),
      failed: Boolean(failed),
      failure: failed?.payload,
      challenges: slice.filter((event) => event.type === "challenge.raise")
        .length,
      categories: [
        ...new Set(
          slice
            .filter((event) => event.type === "challenge.raise")
            .map((event) => event.payload.category),
        ),
      ],
      errors: slice
        .filter((event) => ["run.error", "task.failed"].includes(event.type))
        .map((event) => ({ type: event.type, payload: event.payload })),
      tail: slice
        .slice(-14)
        .map(
          (event) =>
            `${event.type}${event.payload?.error ? `:${String(event.payload.error).slice(0, 240)}` : ""}`,
        ),
      diagnostics: summarizeRunEvents(slice),
    };
  } catch (error) {
    return {
      trial: index,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      finished: false,
      failed: true,
      error: error instanceof Error ? error.message : String(error),
      challenges: 0,
      categories: [],
      errors: [],
      tail: [],
      diagnostics: [],
    };
  } finally {
    if (app)
      spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"], {
        stdio: "ignore",
      });
    await fsp
      .rm(tmp, { recursive: true, force: true, maxRetries: 5 })
      .catch(() => undefined);
  }
}

const report = { model: "deepseek-flash", trials, results: [] };
for (let index = 1; index <= trials; index += 1) {
  const result = await runTrial(index);
  report.results.push(result);
  console.log(
    `${result.finished ? "PASS" : "FAIL"}  第${index}次：finished=${result.finished} failed=${result.failed} challenges=${result.challenges}`,
  );
}
report.summary = {
  workflowFinished: report.results.filter((result) => result.finished).length,
  workflowFailed: report.results.filter((result) => result.failed).length,
  challengeRuns: report.results.filter((result) => result.challenges > 0)
    .length,
};
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
fs.writeFileSync(
  path.join(root, "artifacts", "m4-fourth-review-eval-result.json"),
  JSON.stringify(report, null, 2),
  "utf8",
);
console.log(
  `\nworkflow.finished：${report.summary.workflowFinished}/${trials}`,
);
