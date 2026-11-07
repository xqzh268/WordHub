// 图谱：别名合并与认知边端到端（真实 Electron，mock 后台，不调用模型）。
// 检查：别名在“揭晓章节”前后是两个人物/一个人物；取消与重设；非法合并被拒绝；
// 认知页签的“他知道 / 读者知道他不知道”、让他知道（起知章节）、设为不知道、恢复默认；
// 认知边与别名真的进了采访的提示词（mock 模型回显“已知的事”）；版面不溢出；重启后仍在。
// 用法：npm run build:desktop && node scripts/graph-knowledge-e2e.mjs
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";
import { closeApp } from "./lib/close-app.mjs";

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-graph-know-e2e-"));
const storageRoot = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
fs.mkdirSync(path.join(folder, "chapters"), { recursive: true });
for (const name of ["第一章", "第二章", "第三章", "第五章"])
  fs.writeFileSync(
    path.join(folder, "chapters", `${name}.md`),
    `# ${name}\n\n正文。\n`,
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, timeout = 10000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return true;
    await sleep(150);
  }
  return false;
};

let app;
let page;
const launch = async () => {
  app = await _electron.launch({
    executablePath: electronBinary,
    args: [
      path.join(root, "out", "main", "index.js"),
      `--user-data-dir=${storageRoot}`,
    ],
    cwd: root,
    env: { ...cleanEnv, WORDHUB_MOCK: "1", WORDHUB_WORKSPACE_ROOT: root },
  });
  page = await app.firstWindow();
  await page.waitForSelector(".app");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="worker-status"]')
        ?.textContent?.includes("待命"),
    null,
    { timeout: 30000 },
  );
};
const nodeNames = () =>
  page.$$eval('[data-testid^="graph-node-"]', (items) =>
    items.map((item) => item.textContent ?? "").sort(),
  );
const edgeLabels = () =>
  page.$$eval('[data-testid^="graph-edge-"]', (items) =>
    items.map((item) => item.getAttribute("aria-label") ?? "").sort(),
  );
const countText = async () =>
  (await page.locator('[data-testid="graph-count"]').textContent()) ?? "";
const setChapter = async (index) => {
  await page.locator('[data-testid="graph-time"]').fill(String(index));
  await sleep(250);
};
const pick = async (name) => {
  await page.click(`[data-testid="graph-node-${name}"]`);
  await page.click('[data-testid="graph-tab-detail"]');
};
const knownIds = () =>
  page.$$eval('[data-testid="knowledge-known"]', (items) =>
    items.map((item) => item.getAttribute("data-fact")),
  );
const unknownIds = () =>
  page.$$eval('[data-testid="knowledge-unknown"]', (items) =>
    items.map((item) => item.getAttribute("data-fact")),
  );
const settled = async (predicate) => until(predicate, 8000);

try {
  await launch();
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [chosen],
    });
  }, folder);
  await page.click('[data-testid="link-folder"]');
  await page.waitForSelector('[data-testid="project-card"]', { timeout: 8000 });

  // ── 写入事实 ────────────────────────────────────────────
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
      occurredAt: new Date(Date.now() + n * 1000).toISOString(),
      projectId,
      sessionId,
      runId: "run_seed",
      type,
      actor,
      payload,
      idempotencyKey: `seed-${++n}`,
    });
  const fact = (id, chapter, kind, subject, statement, extra = {}) => {
    seed("fact.proposed", {
      factId: id,
      kind,
      subject,
      statement,
      chapter: `chapters/${chapter}.md`,
      quote: `${id}原文`,
      ...extra,
    });
    seed("fact.confirmed", { factId: id }, { type: "user", id: "user" });
  };
  fact("r1", "第一章", "relation", "裴照", "裴照认识老周", {
    object: "老周",
    relation: "旧识",
  });
  fact("s1", "第一章", "character_state", "黑衣人", "黑衣人夜袭质库");
  fact("s2", "第一章", "character_state", "裴照", "裴照是不良人");
  fact("r2", "第二章", "relation", "黑衣人", "黑衣人指使老周", {
    object: "老周",
    relation: "指使",
  });
  fact("e1", "第二章", "event", "老周", "老周暗中替黑衣人传信");
  fact("e2", "第二章", "event", "质库", "裴照在质库发现了脚印");
  fact("r3", "第三章", "relation", "萧某", "萧某是裴照的师父", {
    object: "裴照",
    relation: "师徒",
  });
  fact("s3", "第三章", "character_state", "萧某", "萧某受伤");
  fact("s4", "第五章", "character_state", "老周", "老周被捕");
  store.close();

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
  await page.click('[data-testid="rail-graph"]');
  await page.waitForSelector('[data-testid="graph-canvas"]');
  await sleep(500);

  check(
    "合并前：黑衣人与萧某是两个人物（4 人 · 3 条关系）",
    JSON.stringify(await nodeNames()) ===
      JSON.stringify(["老周", "萧某", "裴照", "黑衣人"].sort()) &&
      (await countText()).includes("4 人 · 3 条关系"),
    await countText(),
  );

  // ── 别名合并 ───────────────────────────────────────────
  await pick("黑衣人");
  const options = await page.$$eval(
    '[data-testid="alias-target"] option',
    (items) => items.map((item) => item.textContent),
  );
  check(
    "合并目标里没有自己；列出其余人物（含后来才登场的萧某）",
    !options.includes("黑衣人") &&
      options.includes("萧某") &&
      options.includes("裴照"),
    options.join("、"),
  );
  await page.selectOption('[data-testid="alias-target"]', "萧某");
  await page.selectOption(
    '[data-testid="alias-chapter"]',
    "chapters/第三章.md",
  );
  await page.click('[data-testid="alias-link"]');
  check(
    "第五章时：合并后黑衣人并入萧某（3 人 · 3 条关系）",
    await settled(async () => (await countText()).includes("3 人 · 3 条关系")),
    await countText(),
  );
  check(
    "合并后萧某承接了黑衣人的关系：萧某与老周“指使”",
    (await edgeLabels()).some((label) => label.includes("萧某与老周：指使")),
    (await edgeLabels()).join(" | "),
  );
  await pick("萧某");
  const detail =
    (await page.locator('[data-testid="node-detail"]').textContent()) ?? "";
  check(
    "萧某的详情：首次出现回到第一章、列出别名与揭晓章节、含黑衣人名下的出处",
    detail.includes("首次出现：第一章") &&
      detail.includes("也称 黑衣人（第三章揭晓）") &&
      detail.includes("黑衣人夜袭质库"),
    detail.slice(0, 160),
  );

  // 时间滑块：揭晓之前是两个人物
  await setChapter(1);
  check(
    "拖回第二章（揭晓之前）：黑衣人仍是独立人物，萧某还没出现",
    JSON.stringify(await nodeNames()) ===
      JSON.stringify(["老周", "裴照", "黑衣人"].sort()),
    (await nodeNames()).join("、"),
  );
  await page.click('[data-testid="graph-node-黑衣人"]');
  check(
    "此时黑衣人的详情写着“其实是 萧某（第三章揭晓）”",
    (
      (await page.locator('[data-testid="aliases"]').textContent()) ?? ""
    ).includes("其实是 萧某（第三章揭晓）"),
  );
  await setChapter(2);
  check(
    "拖到第三章（揭晓那一章）：合并生效",
    JSON.stringify(await nodeNames()) ===
      JSON.stringify(["老周", "萧某", "裴照"].sort()),
    (await nodeNames()).join("、"),
  );

  // 非法合并被拒绝（服务端校验）
  const projectIdInUi = projectId;
  const rejected = await page.evaluate(
    async ({ id, alias, canonical }) => {
      try {
        await window.wordhub.invoke("graph.aliasLink", {
          projectId: id,
          alias,
          canonical,
        });
        return "";
      } catch (error) {
        return String(error?.message ?? error);
      }
    },
    { id: projectIdInUi, alias: "萧某", canonical: "黑衣人" },
  );
  check(
    "反过来合并（绕成圈）被拒绝并说明原因",
    /反过来/u.test(rejected),
    rejected,
  );
  const self = await page.evaluate(
    async ({ id }) => {
      try {
        await window.wordhub.invoke("graph.aliasLink", {
          projectId: id,
          alias: "裴照",
          canonical: "裴照",
        });
        return "";
      } catch (error) {
        return String(error?.message ?? error);
      }
    },
    { id: projectIdInUi },
  );
  check("合并到自己被拒绝", /自己/u.test(self), self);

  // 取消再重设
  await setChapter(3);
  await pick("萧某");
  await page.locator('[data-testid^="alias-unlink-"]').first().click();
  check(
    "取消别名后两个人物重新分开（4 人）",
    await settled(async () => (await countText()).includes("4 人 · 3 条关系")),
    await countText(),
  );
  await pick("黑衣人");
  await page.selectOption('[data-testid="alias-target"]', "萧某");
  await page.selectOption(
    '[data-testid="alias-chapter"]',
    "chapters/第三章.md",
  );
  await page.click('[data-testid="alias-link"]');
  check(
    "重新合并后恢复（3 人）",
    await settled(async () => (await countText()).includes("3 人 · 3 条关系")),
  );

  // ── 认知边 ─────────────────────────────────────────────
  await pick("裴照");
  await page.click('[data-testid="graph-tab-knowledge"]');
  await page.waitForSelector('[data-testid="knowledge"]');
  const known = await knownIds();
  const unknown = await unknownIds();
  check(
    "默认：他在场的事件（脚印）、他本人的状态，以及他在场的章节里身边人（含合并后的萧某）的变化他知道",
    known.includes("e2") && known.includes("s1") && known.includes("s2"),
    known.join(","),
  );
  check(
    "读者知道、他不知道：老周替黑衣人传信、老周被捕（他不在场）",
    unknown.includes("e1") && unknown.includes("s4"),
    unknown.join(","),
  );
  check(
    "标题带数量",
    (
      (await page
        .locator('[data-testid="knowledge-known-title"]')
        .textContent()) ?? ""
    ).includes(`（${known.length}）`) &&
      (
        (await page
          .locator('[data-testid="knowledge-unknown-title"]')
          .textContent()) ?? ""
      ).includes(`（${unknown.length}）`),
  );

  await page.click('[data-testid="know-grant-e1"]');
  check(
    "让他知道（自第五章起）：这条移到“他知道”，并标明是你指定的",
    (await settled(async () => (await knownIds()).includes("e1"))) &&
      (
        (await page
          .locator('[data-testid="knowledge-known"][data-fact="e1"]')
          .textContent()) ?? ""
      ).includes("你指定他知道（自第五章）"),
  );
  await setChapter(2);
  check(
    "拖回第三章：起知章节还没到，他又不知道这件事",
    (await unknownIds()).includes("e1") && !(await knownIds()).includes("e1"),
  );
  await setChapter(3);
  check("回到第五章又知道了", (await knownIds()).includes("e1"));

  await page.click('[data-testid="know-deny-e2"]');
  check(
    "设为他不知道：默认知道的脚印移到“不知道”，标明是你指定的",
    (await settled(async () => (await unknownIds()).includes("e2"))) &&
      (
        (await page
          .locator('[data-testid="knowledge-unknown"][data-fact="e2"]')
          .textContent()) ?? ""
      ).includes("你指定他不知道"),
  );

  // ── 认知边进入采访的提示词（mock 回显已知的事）──────────
  await page.click('[data-testid="graph-tab-interview"]');
  const ask = async (question) => {
    const before = await page.locator('[data-testid="interview-turn"]').count();
    await page.fill('[data-testid="interview-input"]', question);
    await page.click('[data-testid="interview-send"]');
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll('[data-testid="interview-turn"]').length >=
        count + 2,
      before,
      { timeout: 20000 },
    );
    return (
      (await page
        .locator('[data-testid="interview-turn"]')
        .last()
        .textContent()) ?? ""
    );
  };
  const echo1 = await ask("列出已知");
  check(
    "采访提示词里：有你指定他知道的（老周传信）和黑衣人名下的事",
    echo1.includes("老周暗中替黑衣人传信") && echo1.includes("黑衣人夜袭质库"),
    echo1.slice(0, 160),
  );
  check(
    "采访提示词里：没有你指定他不知道的（脚印），也没有他不在场的（老周被捕）",
    !echo1.includes("发现了脚印") && !echo1.includes("老周被捕"),
  );
  await page.click('[data-testid="graph-tab-knowledge"]');
  await page.click('[data-testid="know-reset-e2"]');
  check(
    "恢复默认：脚印又回到“他知道”",
    await settled(async () => (await knownIds()).includes("e2")),
  );
  await page.click('[data-testid="graph-tab-interview"]');
  const echo2 = await ask("再次列出已知");
  check("恢复默认后采访提示词里又有脚印", echo2.includes("发现了脚印"));

  // 萧某的采访：带别名称呼
  await page.click('[data-testid="graph-node-萧某"]');
  await page.click('[data-testid="graph-tab-interview"]');
  const echo3 = await ask("列出已知");
  check(
    "采访萧某：提示词告诉他“还有这些称呼：黑衣人”，并带上黑衣人的事",
    echo3.includes("你在故事里还有这些称呼：黑衣人") &&
      echo3.includes("黑衣人夜袭质库"),
    echo3.slice(0, 200),
  );

  // ── 版面 ───────────────────────────────────────────────
  await page.click('[data-testid="graph-node-裴照"]');
  await page.click('[data-testid="graph-tab-knowledge"]');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(906, 760),
  );
  await sleep(500);
  const box = await page.evaluate(() => {
    const rect = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, right: r.right, w: r.width };
    };
    const buttons = [...document.querySelectorAll(".know-actions .btn")].map(
      (el) => {
        const r = el.getBoundingClientRect();
        return { right: r.right, h: r.height };
      },
    );
    return {
      aside: rect('[data-testid="graph-detail"]'),
      buttons,
      vw: innerWidth,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  check(
    "窄窗口：认知页签的按钮都在详情栏内、没有横向溢出、按钮不被压扁",
    !box.overflowX &&
      box.buttons.length > 0 &&
      box.buttons.every((b) => b.right <= box.aside.right + 1 && b.h <= 40),
    JSON.stringify(box),
  );
  await page.screenshot({
    path: path.join(root, "artifacts", "graph-knowledge.png"),
  });
  await page.click('[data-testid="graph-tab-detail"]');
  await page.screenshot({
    path: path.join(root, "artifacts", "graph-alias.png"),
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 940),
  );
  await sleep(300);

  // ── 重启后仍在 ─────────────────────────────────────────
  await closeApp(app);
  await launch();
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [chosen],
    });
  }, folder);
  await page.waitForSelector(
    '[data-testid="link-folder"], [data-testid="project-card"]',
    { timeout: 20000 },
  );
  if ((await page.locator('[data-testid="project-card"]').count()) === 0)
    await page
      .click('[data-testid="link-folder"]', { timeout: 5000 })
      .catch(() => undefined);
  await page.waitForSelector('[data-testid="project-card"]');
  await page.click('[data-testid="rail-graph"]');
  await page.waitForSelector('[data-testid="graph-canvas"]');
  await sleep(500);
  check(
    "重启后别名合并仍在（3 人）",
    (await countText()).includes("3 人 · 3 条关系"),
    await countText(),
  );
  await pick("裴照");
  await page.click('[data-testid="graph-tab-knowledge"]');
  await page.waitForSelector('[data-testid="knowledge"]');
  check(
    "重启后认知边仍在（老周传信仍是他知道的，来源是你指定）",
    (await knownIds()).includes("e1") &&
      (
        (await page
          .locator('[data-testid="knowledge-known"][data-fact="e1"]')
          .textContent()) ?? ""
      ).includes("你指定他知道"),
  );
} catch (error) {
  check("脚本未异常", false, String(error?.stack ?? error).slice(0, 600));
  try {
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    await (await app?.firstWindow())?.screenshot({
      path: path.join(root, "artifacts", "graph-knowledge-failure.png"),
    });
  } catch {
    /* 取证失败忽略 */
  }
} finally {
  await closeApp(app);
  const failed = findings.filter((f) => !f.passed);
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "artifacts", "graph-knowledge-result.json"),
    JSON.stringify({ ok: failed.length === 0, findings }, null, 2),
  );
  console.log(`\n${findings.length - failed.length}/${findings.length} 通过`);
  await fsp
    .rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 })
    .catch(() => undefined);
  if (failed.length) process.exitCode = 1;
}
