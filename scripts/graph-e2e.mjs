// 关系图谱端到端（真实 Electron，mock 后台，不调用模型）：
// 把已确认/待确认/已驳回的人物状态与关系事实写进事件日志，再用界面检查：
// 只画已确认的、待确认可选虚线显示、已驳回的不出现；时间滑块回到更早章节时后来才揭示的人物与关系消失；
// 点节点/关系看详情与原文出处并能跳到章节；平移缩放；窄窗口与重启后版面和内容仍然正确。
// 用法：npm run build:desktop && node scripts/graph-e2e.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-graph-e2e-"));
const storageRoot = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
const chapterText = {
  第一章: "裴照认出了老周。老周的兄长刘伯在城南开着铺子。裴照是长安不良人。",
  第二章: "质库是当铺一类的放款铺。",
  第三章: "裴照与苏晚结伴同行。老周倒在质库后墙下。刘伯收了高敏为徒。",
  第十章: "苏晚拔刀指向裴照。裴照身后站着阿福。路人匆匆走过。",
};
fs.mkdirSync(path.join(folder, "chapters"), { recursive: true });
for (const [name, text] of Object.entries(chapterText))
  fs.writeFileSync(
    path.join(folder, "chapters", `${name}.md`),
    `# ${name}\n\n${text}\n`,
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
const openGraph = async () => {
  await page.click('[data-testid="rail-graph"]');
  await page.waitForSelector('[data-testid="graph"]');
};

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

  await openGraph();
  check(
    "还没有人物与关系时给出引导，不显示空画布",
    (await page.locator('[data-testid="graph-empty"]').count()) === 1 &&
      (await page.locator('[data-testid="graph-canvas"]').count()) === 0,
  );

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
  const fact = (id, chapter, kind, subject, extra, quote, decision) => {
    seed("fact.proposed", {
      factId: id,
      kind,
      subject,
      statement: extra.statement ?? `${subject}的${kind}`,
      chapter: `chapters/${chapter}.md`,
      quote,
      ...(extra.object
        ? { object: extra.object, relation: extra.relation }
        : {}),
    });
    if (decision)
      seed(`fact.${decision}`, { factId: id }, { type: "user", id: "user" });
  };
  fact(
    "r1",
    "第一章",
    "relation",
    "裴照",
    { object: "老周", relation: "旧识", statement: "裴照认识老周" },
    "裴照认出了老周",
    "confirmed",
  );
  fact(
    "r6",
    "第一章",
    "relation",
    "老周",
    { object: "刘伯", relation: "兄弟", statement: "刘伯是老周的兄长" },
    "老周的兄长刘伯",
    "confirmed",
  );
  fact(
    "s1",
    "第一章",
    "character_state",
    "裴照",
    { statement: "裴照是长安不良人" },
    "裴照是长安不良人",
    "confirmed",
  );
  fact(
    "t1",
    "第二章",
    "term",
    "质库",
    { statement: "质库是放款铺" },
    "质库是当铺一类的放款铺",
    "confirmed",
  );
  fact(
    "r2",
    "第三章",
    "relation",
    "裴照",
    { object: "苏晚", relation: "同伴", statement: "裴照与苏晚结伴" },
    "裴照与苏晚结伴同行",
    "confirmed",
  );
  fact(
    "s2",
    "第三章",
    "character_state",
    "老周",
    { statement: "老周在质库后墙死亡" },
    "老周倒在质库后墙下",
    "confirmed",
  );
  fact(
    "r7",
    "第三章",
    "relation",
    "刘伯",
    { object: "高敏", relation: "师徒", statement: "刘伯收高敏为徒" },
    "刘伯收了高敏为徒",
    "confirmed",
  );
  fact(
    "r3",
    "第十章",
    "relation",
    "苏晚",
    { object: "裴照", relation: "仇敌", statement: "苏晚与裴照反目" },
    "苏晚拔刀指向裴照",
    "confirmed",
  );
  fact(
    "r4",
    "第十章",
    "relation",
    "裴照",
    { object: "阿福", relation: "主仆", statement: "阿福是裴照的仆人" },
    "裴照身后站着阿福",
  );
  fact(
    "r5",
    "第十章",
    "relation",
    "裴照",
    { object: "路人", relation: "路过", statement: "路人经过" },
    "路人匆匆走过",
    "rejected",
  );
  store.close();

  await page.click('[data-testid="rail-workspace"]');
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
  await openGraph();
  await page.waitForSelector('[data-testid="graph-canvas"]');
  await sleep(500);

  // ── 只画已确认的 ───────────────────────────────────────
  check(
    "只画已确认的人物：待确认的阿福与已驳回的路人都不出现",
    JSON.stringify(await nodeNames()) ===
      JSON.stringify(["刘伯", "裴照", "苏晚", "老周", "高敏"].sort()),
    (await nodeNames()).join("、"),
  );
  check(
    "同一对人物的关系取最新的：苏晚↔裴照 现在是“仇敌”",
    (await edgeLabels()).some((label) => label.includes("苏晚与裴照：仇敌")),
    (await edgeLabels()).join(" | "),
  );
  check(
    "统计显示 5 人 · 4 条关系",
    (
      (await page.locator('[data-testid="graph-count"]').textContent()) ?? ""
    ).includes("5 人 · 4 条关系"),
  );
  await page.check('[data-testid="graph-pending"]');
  await sleep(200);
  check(
    "勾选“显示待确认”后阿福出现，且以虚线淡色标出",
    (await nodeNames()).includes("阿福") &&
      (await page
        .locator('[data-testid="graph-node-阿福"].pending')
        .count()) === 1 &&
      !(await nodeNames()).includes("路人"),
  );
  await page.uncheck('[data-testid="graph-pending"]');

  // ── 时间滑块 ───────────────────────────────────────────
  const slider = page.locator('[data-testid="graph-time"]');
  check(
    "滑块默认在最新章节（第十章）",
    ((await page.locator('[data-testid="graph-time-label"]').textContent()) ??
      "") === "第十章",
  );
  await slider.fill("0");
  await sleep(200);
  check(
    "拖到第一章：后来才出现的苏晚、高敏不见了",
    JSON.stringify(await nodeNames()) ===
      JSON.stringify(["刘伯", "裴照", "老周"].sort()) &&
      (await edgeLabels()).length === 2,
    (await nodeNames()).join("、"),
  );
  await slider.fill("2");
  await sleep(200);
  check(
    "拖到第三章：苏晚是“同伴”（还没反目）",
    (await edgeLabels()).some(
      (label) =>
        label.includes("裴照与苏晚：同伴") ||
        label.includes("苏晚与裴照：同伴"),
    ),
    (await edgeLabels()).join(" | "),
  );
  await page.click('[data-testid="graph-node-老周"]');
  check(
    "节点详情：第三章时老周的状态是“死亡”，并带原文出处",
    (
      (await page.locator('[data-testid="node-state"]').textContent()) ?? ""
    ).includes("死亡") &&
      (await page.locator('[data-testid="graph-fact"]').count()) >= 3,
  );
  await slider.fill("0");
  await sleep(200);
  check(
    "回到第一章：老周还没有“死亡”状态（不剧透）",
    (await page.locator('[data-testid="node-state"]').count()) === 0 &&
      !(
        (await page.locator('[data-testid="node-detail"]').textContent()) ?? ""
      ).includes("死亡"),
  );
  await slider.fill("3");
  await sleep(200);

  // ── 详情 ───────────────────────────────────────────────
  await page.click('[data-testid="graph-node-裴照"]');
  const detail =
    (await page.locator('[data-testid="node-detail"]').textContent()) ?? "";
  check(
    "裴照的详情：首次出现、状态、关系与原文出处",
    detail.includes("首次出现：第一章") &&
      detail.includes("裴照是长安不良人") &&
      detail.includes("苏晚") &&
      detail.includes("裴照认出了老周"),
  );
  await page
    .locator('[data-testid="node-detail"] .graph-links button', {
      hasText: "苏晚",
    })
    .click();
  check(
    "点关系里的人名切到那个人",
    ((await page.locator('[data-testid="node-detail"] h2').textContent()) ??
      "") === "苏晚",
  );
  await page.click('[data-testid="graph-edge-苏晚-裴照"]');
  const edgeFacts = await page
    .locator('[data-testid="edge-detail"] [data-testid="graph-fact"]')
    .allTextContents();
  check(
    "关系详情：变化过程按章节先后列出（同伴 → 仇敌）与原文",
    edgeFacts.length === 2 &&
      edgeFacts[0].includes("同伴") &&
      edgeFacts[1].includes("仇敌") &&
      edgeFacts[1].includes("苏晚拔刀指向裴照"),
    edgeFacts.join(" | ").slice(0, 200),
  );

  await page.click('[data-testid="graph-node-裴照"]');
  await sleep(300);
  await page.screenshot({
    path: path.join(root, "artifacts", "graph-view.png"),
  });

  // ── 平移与缩放 ─────────────────────────────────────────
  const worldTransform = () =>
    page.$eval(".graph-world", (el) => getComputedStyle(el).transform);
  const before = await worldTransform();
  const box = await page.locator('[data-testid="graph-canvas"]').boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height - 30);
  await page.mouse.wheel(0, -300);
  await sleep(200);
  const zoomed = await worldTransform();
  check("滚轮缩放改变画布变换", zoomed !== before, `${before} → ${zoomed}`);
  await page.mouse.move(box.x + 20, box.y + box.height - 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + box.height - 60, { steps: 4 });
  await page.mouse.up();
  await sleep(150);
  check("拖动空白处平移画布", (await worldTransform()) !== zoomed);
  await page.click('[data-testid="graph-fit"]');
  await sleep(250);
  check(
    "“适应窗口”回到初始视图",
    (await worldTransform()) === before,
    await worldTransform(),
  );

  // ── 版面 ───────────────────────────────────────────────
  const rects = await page.$$eval('[data-testid^="graph-node-"]', (items) =>
    items.map((item) => {
      const r = item.getBoundingClientRect();
      return {
        name: item.textContent,
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
      };
    }),
  );
  let overlap = false;
  for (let i = 0; i < rects.length; i += 1)
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      if (
        a.x < b.x + b.w &&
        b.x < a.x + a.w &&
        a.y < b.y + b.h &&
        b.y < a.y + a.h
      )
        overlap = true;
    }
  check(
    "节点之间没有重叠",
    !overlap,
    JSON.stringify(
      rects.map((r) => [r.name, Math.round(r.x), Math.round(r.y)]),
    ),
  );
  const canvasBox = await page
    .locator('[data-testid="graph-canvas"]')
    .boundingBox();
  check(
    "适应窗口后所有节点都在画布内",
    rects.every(
      (r) =>
        r.x >= canvasBox.x - 1 &&
        r.y >= canvasBox.y - 1 &&
        r.x + r.w <= canvasBox.x + canvasBox.width + 1 &&
        r.y + r.h <= canvasBox.y + canvasBox.height + 1,
    ),
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(906, 760),
  );
  await sleep(600);
  const narrow = await page.evaluate(() => {
    const box = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      vw: innerWidth,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
      detail: box('[data-testid="graph-detail"]'),
      canvas: box('[data-testid="graph-canvas"]'),
      bar: box(".graph-bar"),
    };
  });
  check(
    "窄窗口：没有横向溢出，详情栏与画布都在窗口内",
    !narrow.overflowX &&
      narrow.detail.x + narrow.detail.w <= narrow.vw + 1 &&
      narrow.canvas.w > 300,
    JSON.stringify(narrow),
  );
  const rectsNarrow = await page.$$eval(
    '[data-testid^="graph-node-"]',
    (items) =>
      items.map((item) => {
        const r = item.getBoundingClientRect();
        return { x: r.x, w: r.width };
      }),
  );
  const cbox = await page.locator('[data-testid="graph-canvas"]').boundingBox();
  check(
    "窄窗口：缩放后节点仍都在画布内",
    rectsNarrow.every(
      (r) => r.x >= cbox.x - 1 && r.x + r.w <= cbox.x + cbox.width + 1,
    ),
  );

  // ── 跳到章节 ───────────────────────────────────────────
  await page.click('[data-testid="graph-node-裴照"]');
  await page
    .locator('[data-testid="node-detail"] [data-testid="graph-jump"]', {
      hasText: "第一章",
    })
    .first()
    .click();
  await page.waitForSelector('[data-testid="rail-workspace"].active');
  check(
    "详情里的出处能跳回工作区并打开对应章节",
    await until(async () =>
      (await page.locator("body").innerText()).includes("裴照认出了老周"),
    ),
  );

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
  await openGraph();
  await page.waitForSelector('[data-testid="graph-canvas"]');
  await sleep(400);
  check(
    "重启后图谱内容不变（5 人 · 4 条关系）",
    (
      (await page.locator('[data-testid="graph-count"]').textContent()) ?? ""
    ).includes("5 人 · 4 条关系"),
  );
} catch (error) {
  check("脚本未异常", false, String(error?.stack ?? error).slice(0, 500));
  try {
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    await (await app?.firstWindow())?.screenshot({
      path: path.join(root, "artifacts", "graph-e2e-failure.png"),
    });
  } catch {
    /* 取证失败忽略 */
  }
} finally {
  try {
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    await page?.screenshot({
      path: path.join(root, "artifacts", "graph-e2e-last.png"),
    });
  } catch {
    /* ignore */
  }
  await closeApp(app);
  const failed = findings.filter((f) => !f.passed);
  fs.writeFileSync(
    path.join(root, "artifacts", "graph-e2e-result.json"),
    JSON.stringify({ ok: failed.length === 0, findings }, null, 2),
  );
  console.log(`\n${findings.length - failed.length}/${findings.length} 通过`);
  await fsp
    .rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 })
    .catch(() => undefined);
  if (failed.length) process.exitCode = 1;
}
