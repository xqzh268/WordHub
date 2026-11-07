// 图谱：认知边与别名的真实模型验证（deepseek-flash）。
// 事实直接写进事件日志（不让史官抽取，省一次调用），再用界面设置“他知道/不知道”和别名合并，
// 然后真的去采访人物，看模型有没有守住边界：
//   · 林小满默认知道师父的秘密（同章在场的身边人）→ 指定她不知道后，回答里不能出现秘密；
//   · 周远默认不知道 → 指定他知道后，回答里要能说出秘密；
//   · 别名合并后，采访规范名人物能说出别名名下发生的事。
// 用法：DEEPSEEK_API_KEY=... node scripts/graph-knowledge-live-e2e.mjs
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";
import { closeApp } from "./lib/close-app.mjs";
import { writeTestModelOverrides } from "./lib/test-models.mjs";

const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) {
  if (process.env.WORDHUB_REQUIRE_LIVE === "1") {
    console.error("失败：真实验证要求 DEEPSEEK_API_KEY。");
    process.exit(2);
  }
  console.log("跳过：未设置 DEEPSEEK_API_KEY");
  process.exit(0);
}
const { ELECTRON_RUN_AS_NODE, ...baseEnv } = process.env;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { WordHubStore } = await import(
  new URL("../packages/store/dist/index.js", import.meta.url).href
);
const electronBinary = createRequire(import.meta.url)("electron");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-graph-know-live-"));
const userData = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
fs.mkdirSync(path.join(folder, ".wordhub", "bible"), { recursive: true });
fs.mkdirSync(path.join(folder, "chapters"), { recursive: true });
writeTestModelOverrides(folder);
fs.writeFileSync(
  path.join(folder, ".wordhub", "bible", "setting.md"),
  "# 设定\n- 唐代，剑门山。\n",
);
fs.writeFileSync(
  path.join(folder, "chapters", "第一章.md"),
  "# 第一章\n\n正文。\n",
);

const report = { model: "deepseek-flash", checks: [] };
const check = (name, passed, detail = "") => {
  report.checks.push({ name, passed, detail });
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  —  ${detail}` : ""}`,
  );
  return passed;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const squash = (text) => text.replace(/\s+/gu, " ");

let app;
let page;
try {
  app = await _electron.launch({
    executablePath: electronBinary,
    args: [path.join(root, "out/main/index.js"), `--user-data-dir=${userData}`],
    cwd: root,
    env: { ...baseEnv, WORDHUB_WORKSPACE_ROOT: root },
  });
  page = await app.firstWindow();
  await page.waitForSelector(".app");
  const idle = () =>
    page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="worker-status"]')
          ?.textContent?.includes("待命"),
      null,
      { timeout: 30000 },
    );
  await idle();
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [chosen],
    });
  }, folder);
  await page.click('[data-testid="link-folder"]');
  await page.waitForSelector('[data-testid="project-card"]');

  const projectsRoot = path.join(userData, "projects");
  const projectId = fs
    .readdirSync(projectsRoot)
    .find((n) => fs.existsSync(path.join(projectsRoot, n, "wordhub.sqlite")));
  const store = new WordHubStore(path.join(projectsRoot, projectId));
  const sessionId = store.listSessions(projectId)[0].id;
  store.startRun({ projectId, sessionId, runId: "run_seed", prompt: "seed" });
  let n = 0;
  const seed = (type, payload, actor = { type: "agent", id: "observer" }) =>
    store.appendEvent({
      schemaVersion: 1,
      occurredAt: new Date(Date.now() + n * 1000).toISOString(),
      projectId,
      sessionId,
      runId: "run_seed",
      type,
      actor,
      payload,
      idempotencyKey: `seed-${++n}`,
    });
  const fact = (id, kind, subject, statement, extra = {}) => {
    seed("fact.proposed", {
      factId: id,
      kind,
      subject,
      statement,
      chapter: "chapters/第一章.md",
      quote: `${id}原文`,
      ...extra,
    });
    seed("fact.confirmed", { factId: id }, { type: "user", id: "user" });
  };
  fact("r1", "relation", "沈砚", "沈砚是林小满的师父", {
    object: "林小满",
    relation: "师徒",
  });
  fact("r2", "relation", "林小满", "林小满与周远是夫妻", {
    object: "周远",
    relation: "夫妻",
  });
  fact(
    "s1",
    "character_state",
    "沈砚",
    "沈砚昨天在廊下收下了赵无咎送来的一张银票",
  );
  fact("s2", "character_state", "福伯", "福伯是沈砚家的管家，为人沉默");
  fact("s3", "character_state", "无名管家", "无名管家每天夜里都在后院烧纸");
  fact("r3", "relation", "福伯", "福伯服侍沈砚多年", {
    object: "沈砚",
    relation: "主仆",
  });
  store.close();
  await page.evaluate(() =>
    window.wordhub.invoke("run.restartWorker", undefined),
  );
  await idle();
  await page.click('[data-testid="rail-graph"]');
  await page.waitForSelector('[data-testid="graph-canvas"]');
  await sleep(500);

  const ask = async (question) => {
    const before = await page.locator('[data-testid="interview-turn"]').count();
    await page.fill('[data-testid="interview-input"]', question);
    await page.click('[data-testid="interview-send"]');
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll('[data-testid="interview-turn"]').length >=
        count + 2,
      before,
      { timeout: 120000 },
    );
    const text =
      (await page
        .locator('[data-testid="interview-turn"]')
        .last()
        .textContent()) ?? "";
    return squash(text);
  };
  const interview = async (name) => {
    await page.click(`[data-testid="graph-node-${name}"]`);
    await page.click('[data-testid="graph-tab-interview"]');
    if (await page.locator('[data-testid="interview-clear"]').isEnabled())
      await page.click('[data-testid="interview-clear"]');
  };
  const secret = /银票|赵无咎/u;
  const question = "沈砚最近有没有收过什么人送来的东西？你知道是什么吗？";

  // 1. 林小满默认知道（同章在场的身边人）
  await interview("林小满");
  const before = await ask(question);
  console.log("林小满（默认）：", before.slice(0, 220));
  check(
    "林小满默认知道（同章在场的身边人的事）：回答里能说出银票或赵无咎",
    secret.test(before),
    before.slice(0, 100),
  );

  // 2. 指定她不知道
  await page.click('[data-testid="graph-tab-knowledge"]');
  await page.waitForSelector('[data-testid="know-deny-s1"]');
  await page.click('[data-testid="know-deny-s1"]');
  await page.waitForSelector(
    '[data-testid="knowledge-unknown"][data-fact="s1"]',
  );
  await page.click('[data-testid="graph-tab-interview"]');
  await page.click('[data-testid="interview-clear"]');
  const after = await ask(question);
  console.log("林小满（指定不知道）：", after.slice(0, 220));
  check(
    "指定她不知道之后：回答里没有银票和赵无咎（模型没有越过认知边）",
    !secret.test(after),
    after.slice(0, 120),
  );
  check(
    "这条回答没有警告（没有越界的人名，也没有无依据的标注）",
    (await page.locator('[data-testid="interview-warning"]').count()) === 0,
  );

  // 3. 周远默认不知道，指定后知道
  await interview("周远");
  const none = await ask(question);
  console.log("周远（默认）：", none.slice(0, 220));
  check(
    "周远默认不知道：回答里没有银票和赵无咎",
    !secret.test(none),
    none.slice(0, 120),
  );
  await page.click('[data-testid="graph-tab-knowledge"]');
  await page.waitForSelector('[data-testid="know-grant-s1"]');
  await page.click('[data-testid="know-grant-s1"]');
  await page.waitForSelector('[data-testid="knowledge-known"][data-fact="s1"]');
  await page.click('[data-testid="graph-tab-interview"]');
  await page.click('[data-testid="interview-clear"]');
  const told = await ask(question);
  console.log("周远（指定知道）：", told.slice(0, 220));
  check(
    "指定周远知道之后：回答里能说出银票或赵无咎",
    secret.test(told),
    told.slice(0, 120),
  );

  // 4. 别名：无名管家 = 福伯
  await page.click('[data-testid="graph-node-无名管家"]');
  await page.click('[data-testid="graph-tab-detail"]');
  await page.selectOption('[data-testid="alias-target"]', "福伯");
  await page.selectOption('[data-testid="alias-chapter"]', "");
  await page.click('[data-testid="alias-link"]');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="graph-node-无名管家"]'),
    null,
    { timeout: 8000 },
  );
  check("合并后图上只剩福伯，无名管家并入", true);
  await interview("福伯");
  const butler = await ask("你夜里在后院做什么？");
  console.log("福伯（合并别名后）：", butler.slice(0, 220));
  check(
    "合并别名后采访福伯：能说出“烧纸”（别名名下发生的事）",
    /烧纸/u.test(butler),
    butler.slice(0, 120),
  );
} catch (error) {
  check("脚本未异常", false, String(error?.stack ?? error).slice(0, 600));
} finally {
  await closeApp(app);
  const failed = report.checks.filter((c) => !c.passed);
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "artifacts", "graph-knowledge-live-result.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `\n${report.checks.length - failed.length}/${report.checks.length} 项通过`,
  );
  await fsp
    .rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 })
    .catch(() => undefined);
  if (failed.length) process.exitCode = 1;
}
