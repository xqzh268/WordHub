// 史官人物死亡事实小评测：固定章节，独立临时项目，多次定稿，统计人物状态事实的抽出率。
// 用法：DEEPSEEK_API_KEY=... WORDHUB_REQUIRE_LIVE=1 node scripts/facts-death-eval.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { _electron } from "playwright";
import { writeTestModelOverrides } from "./lib/test-models.mjs";

const KEY = process.env.DEEPSEEK_API_KEY;
const trials = Math.max(1, Number(process.env.WORDHUB_DEATH_FACT_TRIALS ?? 5));
if (!KEY) {
  if (process.env.WORDHUB_REQUIRE_LIVE === "1") {
    console.error("失败：人物死亡事实评测要求 DEEPSEEK_API_KEY。");
    process.exit(2);
  }
  console.log("跳过：未设置 DEEPSEEK_API_KEY");
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deathWords =
  /死|亡|杀|毙|殒|尸|遗体|命绝|丧命|断气|身亡|遇害|已故|不在人世|没了/u;
const report = {
  model: "deepseek-flash",
  trials,
  results: [],
};

function writeFixture(folder) {
  const bible = path.join(folder, ".wordhub", "bible");
  const chapters = path.join(folder, "chapters");
  fs.mkdirSync(bible, { recursive: true });
  fs.mkdirSync(chapters, { recursive: true });
  fs.writeFileSync(
    path.join(bible, "outline.md"),
    "## 第一章 旧案\n- 目标：老周在质库后墙遇害，裴照确认其死亡。\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(bible, "characters.md"),
    "# 人物档案\n\n## 主角：裴照\n- 身份：不良人。\n\n## 配角：老周\n- 身份：质库掌柜。\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(bible, "setting.md"),
    "# 设定\n- 唐代长安，崇仁坊。\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(bible, "style.md"),
    "# 文风\n- 冷峻克制，事实必须有逐字原文锚点。\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(chapters, "第一章.md"),
    "# 第一章 旧案\n\n裴照赶到质库后墙时，老周已经倒在地上。胸口中了一刀，血已经凉透，呼吸全无。裴照伸手探过鼻息，又替老周合上眼睛，确认质库掌柜老周已死。\n",
    "utf8",
  );
  writeTestModelOverrides(folder);
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-death-fact-"));
  const userData = path.join(tmp, "appdata");
  const folder = path.join(tmp, "项目", `死亡事实-${index}`);
  writeFixture(folder);
  const env = {
    ...process.env,
    DEEPSEEK_API_KEY: KEY,
    WORDHUB_WORKSPACE_ROOT: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.WORDHUB_TEST_FULL_MODELS;
  let app;
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
    await page.fill(
      '[data-testid="composer-input"]',
      "定稿 chapters/第一章.md",
    );
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
    const characterStates = slice
      .filter(
        (event) =>
          event.type === "fact.proposed" &&
          event.payload.kind === "character_state",
      )
      .map((event) => ({
        subject: String(event.payload.subject ?? ""),
        statement: String(event.payload.statement ?? ""),
        quote: String(event.payload.quote ?? ""),
      }));
    const subjectMatches = characterStates.filter((fact) =>
      /老周/u.test(fact.subject),
    );
    const deathMatches = subjectMatches.filter((fact) =>
      deathWords.test(`${fact.statement}${fact.quote}`),
    );
    return {
      trial: index,
      finished: Boolean(finished),
      failed: Boolean(failed),
      failure: failed?.payload,
      errors: slice
        .filter((event) => ["run.error", "task.failed"].includes(event.type))
        .map((event) => ({ type: event.type, payload: event.payload })),
      tail: slice
        .slice(-14)
        .map(
          (event) =>
            `${event.type}${event.payload?.error ? `:${String(event.payload.error).slice(0, 240)}` : ""}`,
        ),
      characterStateCount: characterStates.length,
      characterStates,
      subjectMatches,
      deathMatches,
    };
  } catch (error) {
    return {
      trial: index,
      finished: false,
      failed: true,
      error: error instanceof Error ? error.message : String(error),
      errors: [],
      tail: [],
      characterStateCount: 0,
      characterStates: [],
      subjectMatches: [],
      deathMatches: [],
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

for (let index = 1; index <= trials; index += 1) {
  const result = await runTrial(index);
  report.results.push(result);
  console.log(
    `${result.deathMatches.length > 0 ? "PASS" : "FAIL"}  第${index}次：人物状态${result.characterStateCount}条，老周主体${result.subjectMatches.length}条，死亡匹配${result.deathMatches.length}条`,
  );
}

report.summary = {
  finished: report.results.filter((result) => result.finished).length,
  subjectMentioned: report.results.filter(
    (result) => result.subjectMatches.length > 0,
  ).length,
  deathMatched: report.results.filter(
    (result) => result.deathMatches.length > 0,
  ).length,
};
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
fs.writeFileSync(
  path.join(root, "artifacts", "facts-death-eval-result.json"),
  JSON.stringify(report, null, 2),
  "utf8",
);
console.log(`\n死亡事实匹配：${report.summary.deathMatched}/${trials}`);
if (report.summary.finished !== trials) process.exitCode = 1;
