// 事实页签 / 定稿按钮 / 定稿后自动评审开关的端到端检查（真实 Electron，mock 后台，不调用模型）。
// 用法：npm run build:desktop && node scripts/facts-e2e.mjs
// 做法：先链接项目，再把“待确认事实”直接写进该项目的事件日志，重新链接让界面读取，然后用界面操作确认/驳回/定稿。
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { WordHubStore } = await import(
  new URL("../packages/store/dist/index.js", import.meta.url).href
);
const electronBinary = createRequire(import.meta.url)("electron");
const {
  ELECTRON_RUN_AS_NODE,
  DEEPSEEK_API_KEY: _key,
  ...cleanEnv
} = process.env;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-facts-e2e-"));
const storageRoot = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
fs.mkdirSync(path.join(folder, "chapters"), { recursive: true });
fs.writeFileSync(
  path.join(folder, "chapters", "第五章.md"),
  "老周倒在质库后墙下，再没有起来。\n",
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
const until = async (predicate, timeout = 10000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};

let app;
try {
  app = await _electron.launch({
    executablePath: electronBinary,
    args: [
      path.join(root, "out", "main", "index.js"),
      `--user-data-dir=${storageRoot}`,
    ],
    cwd: root,
    env: { ...cleanEnv, WORDHUB_MOCK: "1", WORDHUB_WORKSPACE_ROOT: root },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".app");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="worker-status"]')
        ?.textContent?.includes("待命"),
    null,
    { timeout: 15000 },
  );
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [chosen],
    });
  }, folder);
  await page.click('[data-testid="link-folder"]');
  await page.waitForSelector('[data-testid="project-card"]', { timeout: 8000 });

  // 找到项目的存储目录，并写入待确认事实
  const projectsRoot = path.join(storageRoot, "projects");
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
      occurredAt: new Date().toISOString(),
      projectId,
      sessionId,
      runId: "run_seed",
      type,
      actor,
      payload,
      idempotencyKey: `seed-${++n}`,
    });
  seed("fact.proposed", {
    factId: "f1",
    kind: "character_state",
    subject: "老周",
    statement: "老周在质库后墙死亡",
    chapter: "chapters/第五章.md",
    quote: "老周倒在质库后墙下",
  });
  seed("fact.proposed", {
    factId: "f2",
    kind: "term",
    subject: "质库",
    statement: "质库是当铺一类的放款铺",
    chapter: "chapters/第五章.md",
    quote: "质库后墙",
  });
  seed("chapter.summary", {
    chapter: "chapters/第五章.md",
    text: "老周死于质库后墙。",
  });
  store.close();

  // 重启后台进程：界面在后台回到“待命”时会重新读取事实
  await page.evaluate(() =>
    window.wordhub.invoke("run.restartWorker", undefined),
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="worker-status"]')
        ?.textContent?.includes("待命"),
    null,
    { timeout: 20000 },
  );
  await page.getByRole("tab", { name: /事实/u }).click();
  check(
    "事实页签列出待确认事实与章节摘要",
    (await until(
      async () => (await page.locator('[data-testid="fact"]').count()) === 2,
    )) &&
      (await page.locator('[data-testid="facts-panel"]').innerText()).includes(
        "老周死于质库后墙",
      ),
  );
  check(
    "页签上的徽标显示待确认数量",
    (await page.locator('[data-testid="facts-badge"]').innerText()) === "2",
  );

  await page
    .locator('[data-testid="fact"]')
    .first()
    .getByRole("button", { name: "确认" })
    .click();
  check(
    "确认一条事实后徽标减一",
    await until(
      async () =>
        (await page.locator('[data-testid="facts-badge"]').innerText()) === "1",
    ),
  );
  const decided = await until(() => {
    const db = new WordHubStore(path.join(projectsRoot, projectId));
    const ok = db
      .listEvents(projectId)
      .some((e) => e.type === "fact.confirmed" && e.payload.factId === "f1");
    db.close();
    return ok;
  });
  check("确认写入事件日志（fact.confirmed）", decided);

  await page.getByText("只看待确认").click();
  check(
    "“只看待确认”只留下未决的一条",
    (await page.locator('[data-testid="fact"]').count()) === 1,
  );
  await page.getByText("只看待确认").click();

  // 定稿按钮（mock 后台：观察者不会真的提事实，但链路应当走完并记录定稿）
  await page.getByRole("tab", { name: /纸面/u }).click();
  await page.waitForSelector('[data-testid="finalize"]');
  check(
    "章节导航里有“定稿”按钮",
    (await page.locator('[data-testid="finalize"]').innerText()) === "定稿",
  );
  await page.click('[data-testid="finalize"]');
  const finalized = await until(
    async () =>
      (await page.locator('[data-testid="finalize"]').innerText()) ===
      "重新定稿",
    30000,
  );
  check("定稿完成后按钮变为“重新定稿”", finalized);

  // 设置里的“定稿后自动评审”开关
  await page.click('[data-testid="rail-settings"]');
  const toggle = page.locator('[data-testid="auto-review-toggle"] input');
  check("“定稿后自动评审”默认关闭", !(await toggle.isChecked()));
  await toggle.check();
  const prefsFile = path.join(folder, ".wordhub", "preferences.json");
  check(
    "打开开关后写入项目偏好文件",
    await until(() => {
      try {
        return (
          JSON.parse(fs.readFileSync(prefsFile, "utf8"))
            .autoReviewOnFinalize === true
        );
      } catch {
        return false;
      }
    }),
  );
} catch (error) {
  check("脚本未异常", false, String(error?.message ?? error).slice(0, 300));
  try {
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    await (await app?.firstWindow())?.screenshot({
      path: path.join(root, "artifacts", "facts-e2e-failure.png"),
    });
  } catch {
    /* 取证失败忽略 */
  }
} finally {
  await app?.close().catch(() => undefined);
  const failed = findings.filter((f) => !f.passed);
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "artifacts", "facts-e2e-result.json"),
    JSON.stringify({ ok: failed.length === 0, findings }, null, 2),
  );
  console.log(`\n${findings.length - failed.length}/${findings.length} 通过`);
  await fsp
    .rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 })
    .catch(() => undefined);
  if (failed.length) process.exitCode = 1;
}
