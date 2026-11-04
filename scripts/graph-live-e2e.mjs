// 关系图谱真实模型验证（deepseek-flash）：史官读一章，抽取人物关系，用户确认后出现在图谱里。
// 用法：DEEPSEEK_API_KEY=... node scripts/graph-live-e2e.mjs
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
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
const electronBinary = createRequire(import.meta.url)("electron");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-graph-live-"));
const userData = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
fs.mkdirSync(path.join(folder, ".wordhub", "bible"), { recursive: true });
fs.mkdirSync(path.join(folder, "chapters"), { recursive: true });
writeTestModelOverrides(folder);
fs.writeFileSync(
  path.join(folder, ".wordhub", "bible", "style.md"),
  "# 文风\n- 克制。\n",
);
fs.writeFileSync(
  path.join(folder, ".wordhub", "bible", "setting.md"),
  "# 设定\n- 唐代，剑门山。\n",
);
fs.writeFileSync(
  path.join(folder, "chapters", "第一章.md"),
  [
    "# 第一章 山门",
    "",
    "沈砚把徒弟林小满叫到廊下。他教了她三年剑，今日要她独自下山。林小满的丈夫周远在山门外等她，两人成亲才半年。",
    "",
    "山门外，沈砚的死对头赵无咎已经等了一个时辰。赵无咎恨沈砚入骨，当年正是沈砚废了他的右手。",
    "",
    "街角茶摊上坐着货郎老王和绣娘阿桂，两人只顾低头喝茶，互不相识。",
    "",
  ].join("\n"),
  "utf8",
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
const events = () => {
  const dir = path.join(userData, "projects");
  const id = fs
    .readdirSync(dir)
    .find((n) => fs.existsSync(path.join(dir, n, "wordhub.sqlite")));
  if (!id) return [];
  const db = new DatabaseSync(path.join(dir, id, "wordhub.sqlite"), {
    readOnly: true,
  });
  const rows = db.prepare("SELECT * FROM events ORDER BY seq").all();
  db.close();
  return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));
};

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

  const before = events().length;
  await page.fill(
    '[data-testid="composer-input"]',
    "@史官 请读取 chapters/第一章.md，按史官职责提出带逐字原文锚点的待确认事实（人物状态、人物关系等），最后写本章摘要。",
  );
  await page.click('[data-testid="send"]');
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const slice = events().slice(before);
    if (slice.some((e) => e.type === "run.finished" || e.type === "run.error"))
      break;
    await sleep(1500);
  }
  await sleep(1000);
  const slice = events().slice(before);
  check(
    "史官运行正常结束",
    slice.some((e) => e.type === "run.finished"),
  );
  const proposed = slice
    .filter((e) => e.type === "fact.proposed")
    .map((e) => e.payload);
  const relations = proposed.filter((p) => p.kind === "relation");
  console.log(
    "史官提出的关系：",
    relations.map((r) => `${r.subject}→${r.relation}→${r.object}`).join("；"),
  );
  console.log(
    "其他事实：",
    proposed
      .filter((p) => p.kind !== "relation")
      .map((p) => `${p.kind}:${p.subject}`)
      .join("；"),
  );
  check(
    "提出了人物关系事实（至少 2 条）",
    relations.length >= 2,
    `${relations.length} 条`,
  );
  check(
    "每条关系都带 object 与 relation，且是逐字原文锚点",
    relations.every((r) => r.object && r.relation && r.quote),
  );
  const has = (a, b, re) =>
    relations.some(
      (r) =>
        ((r.subject === a && r.object === b) ||
          (r.subject === b && r.object === a)) &&
        re.test(r.relation),
    );
  check("沈砚—林小满：师徒", has("沈砚", "林小满", /师|徒/u));
  check("林小满—周远：夫妻", has("林小满", "周远", /夫|妻|婚|配偶/u));
  check("沈砚—赵无咎：仇敌", has("沈砚", "赵无咎", /仇|敌|对头|恨/u));
  check(
    "没有给“互不相识”的老王与阿桂编造关系",
    !relations.some(
      (r) =>
        [r.subject, r.object].includes("老王") &&
        [r.subject, r.object].includes("阿桂"),
    ),
  );

  // 用户确认后出现在图谱里
  await page.getByRole("tab", { name: /事实/u }).click();
  await page.waitForSelector('[data-testid="fact"]');
  const cards = page.locator('[data-testid="fact"]', { hasText: "人物关系" });
  const total = await cards.count();
  for (let i = 0; i < total; i += 1) {
    await page
      .locator('[data-testid="fact"]', { hasText: "人物关系" })
      .filter({ has: page.getByRole("button", { name: "确认" }) })
      .first()
      .getByRole("button", { name: "确认" })
      .click();
    await sleep(400);
  }
  await page.click('[data-testid="rail-graph"]');
  await page.waitForSelector('[data-testid="graph-canvas"]', {
    timeout: 15000,
  });
  await sleep(500);
  const names = await page.$$eval('[data-testid^="graph-node-"]', (items) =>
    items.map((i) => i.textContent),
  );
  console.log("图上的人物：", names.join("、"));
  check(
    "确认后图谱里出现关系涉及的人物",
    ["沈砚", "林小满"].every((n) => names.includes(n)),
    names.join("、"),
  );
  // 采访：以沈砚的身份回答（真实模型）
  await page.click('[data-testid="graph-node-沈砚"]');
  await page.click('[data-testid="graph-tab-interview"]');
  const interview = async (question) => {
    const count = await page.locator('[data-testid="interview-turn"]').count();
    await page.fill('[data-testid="interview-input"]', question);
    await page.click('[data-testid="interview-send"]');
    await page.waitForFunction(
      (n) =>
        document.querySelectorAll('[data-testid="interview-turn"]').length >=
        n + 2,
      count,
      { timeout: 120000 },
    );
    return (
      (await page
        .locator('[data-testid="interview-turn"]')
        .last()
        .textContent()) ?? ""
    );
  };
  const squash = (text) => text.replace(/\s+/gu, " ");
  const a1 = await interview("你为什么要让林小满独自下山？");
  console.log("采访回答 1：", squash(a1).slice(0, 300));
  check(
    "采访得到回答，并附带依据（引用已确认的事实）",
    a1.length > 10 &&
      (await page.locator('[data-testid="interview-basis"] li').count()) >= 1,
  );
  check(
    "回答没有越界警告",
    (await page.locator('[data-testid="interview-warning"]').count()) === 0,
  );
  const a2 = await interview(
    "你知道赵无咎后来怎么样了吗？第二章里发生了什么？",
  );
  console.log("采访回答 2（问后文，应当不知道）：", squash(a2).slice(0, 300));
  check(
    "问到还没写的后文时，人物说不知道/不确定，而不是编造",
    /不知|不清楚|不确定|没听说|说不准|无从|不晓得|不得而知/u.test(a2),
    squash(a2).slice(0, 120),
  );
  // 推演：沈砚、林小满、赵无咎，假如赵无咎提前动手（真实模型）
  await page.click('[data-testid="sim-open"]');
  await page.waitForSelector('[data-testid="sim-panel"]');
  const picked = await page.$$eval(
    '[data-testid^="sim-participant-"]',
    (items) =>
      items
        .filter((item) => item.checked)
        .map((item) =>
          item.getAttribute("data-testid").replace("sim-participant-", ""),
        ),
  );
  console.log("推演参与：", picked.join("、"));
  check(
    "推演默认选中沈砚和与他有关系的人",
    picked.includes("沈砚") && picked.length >= 2,
  );
  await page.fill(
    '[data-testid="sim-premise"]',
    "赵无咎等不及了，提前动手，在林小满下山前拦住了她。",
  );
  await page.selectOption('[data-testid="sim-rounds"]', "2");
  await page.click('[data-testid="sim-start"]');
  await page.waitForSelector('[data-testid="sim-report"]', {
    timeout: 480000,
  });
  const simEntries = await page
    .locator('[data-testid="sim-entry"]')
    .allTextContents();
  for (const entry of simEntries)
    console.log("推演：", squash(entry).slice(0, 160));
  check(
    "推演每一步都有行动记录（轮数 × 人数）",
    simEntries.length === 2 * picked.length &&
      simEntries.every((text) => text.length > 20),
    `${simEntries.length} 条`,
  );
  const reportText =
    (await page.locator('[data-testid="sim-report"]').textContent()) ?? "";
  console.log("推演报告：", squash(reportText).slice(0, 500));
  check(
    "推演报告含小结与可能的走向，并标明非正史",
    reportText.includes("非正史") &&
      /推演小结|小结/u.test(reportText) &&
      /走向/u.test(reportText),
  );
  check(
    "推演没有越界警告（没有提到后文才出现的人物）",
    (await page.locator('[data-testid="sim-warning"]').count()) === 0,
  );
  await page.click('[data-testid="sim-save"]');
  await page.waitForSelector('[data-testid="sim-saved"]');
  check("推演可保存为非正史的参考文件", true);
  await page.screenshot({
    path: path.join(root, "artifacts", "graph-live.png"),
  });
} catch (error) {
  check("脚本未异常", false, String(error?.stack ?? error).slice(0, 500));
} finally {
  await closeApp(app);
  const failed = report.checks.filter((c) => !c.passed);
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "artifacts", "graph-live-result.json"),
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
