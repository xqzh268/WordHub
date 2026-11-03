// 自建 Agent 的真实模型验证（deepseek-flash）：
// 1) 表单创建只读“校对”：提示词生效（回答以【校对员】开头）、读到章节并指出错别字、绝不改文件；
// 2) 表单创建可写“润色”（写范围仅章节、写前确认）：改章节要经审批、写入后文件更新，
//    让它写设定集（范围外）会被权限拒绝、文件不被创建；
// 3) 重启后两个 Agent 仍在。
// 用法：DEEPSEEK_API_KEY=... node scripts/agent-form-live-e2e.mjs
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { _electron } from "playwright";
import { writeTestModelOverrides } from "./lib/test-models.mjs";
import { closeApp } from "./lib/close-app.mjs";

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-agent-live-"));
const userData = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
const chapterFile = path.join(folder, "chapters", "第一章.md");
const settingFile = path.join(folder, ".wordhub", "bible", "setting.md");
fs.mkdirSync(path.dirname(chapterFile), { recursive: true });
fs.mkdirSync(path.dirname(settingFile), { recursive: true });
writeTestModelOverrides(folder);
fs.writeFileSync(settingFile, "# 设定\n- 唐代长安，夜禁。\n");
const ORIGINAL =
  "# 第一章 夜巡\n\n三更鼓响过，裴照提着灯笼走进崇仁坊，长案城里静得出奇。\n";
fs.writeFileSync(chapterFile, ORIGINAL, "utf8");

const report = { checks: [] };
const check = (name, passed, detail = "") => {
  report.checks.push({ name, passed, detail });
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  —  ${detail}` : ""}`,
  );
  return passed;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const events = () => {
  const dir = path.join(userData, "projects");
  const id = fs
    .readdirSync(dir)
    .find((n) => fs.existsSync(path.join(dir, n, "wordhub.sqlite")));
  if (!id) return [];
  const database = new DatabaseSync(path.join(dir, id, "wordhub.sqlite"), {
    readOnly: true,
  });
  const rows = database.prepare("SELECT * FROM events ORDER BY seq").all();
  database.close();
  return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));
};
const textOf = (slice) =>
  slice
    .filter((e) => e.type === "run.text_delta")
    .map((e) => String(e.payload.delta ?? e.payload.text ?? ""))
    .join("");

async function launch() {
  const app = await _electron.launch({
    executablePath: electronBinary,
    args: [path.join(root, "out/main/index.js"), `--user-data-dir=${userData}`],
    cwd: root,
    env: { ...baseEnv, WORDHUB_WORKSPACE_ROOT: root },
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
  return { app, page };
}

/** 发一条消息并处理审批，等到运行结束；approve 为 false 时点“拒绝”。 */
async function ask(page, message, { approve = true, timeout = 240000 } = {}) {
  const before = events().length;
  await page.fill('[data-testid="composer-input"]', message);
  await page.click('[data-testid="send"]');
  const deadline = Date.now() + timeout;
  let sawApproval = false;
  while (Date.now() < deadline) {
    const slice = events().slice(before);
    if (slice.some((e) => e.type === "run.finished" || e.type === "run.error"))
      break;
    const card = page.locator(".approval:not(.resolved)");
    if ((await card.count()) > 0) {
      sawApproval = true;
      const button = approve
        ? card.last().locator(".btn-primary")
        : card.last().locator(".btn:not(.btn-primary)");
      await button
        .first()
        .click()
        .catch(() => undefined);
    }
    await sleep(1500);
  }
  await sleep(800);
  return { slice: events().slice(before), sawApproval };
}

async function createAgent(page, fields) {
  await page.click('[data-testid="agent-new"]');
  await page.waitForSelector('[data-testid="agent-form"]');
  await page.fill('input[aria-label="显示名"]', fields.displayName);
  await page.fill('input[aria-label="标识"]', fields.name);
  await page.fill('input[aria-label="描述"]', fields.description);
  await page.fill('textarea[aria-label="系统提示词"]', fields.prompt);
  await page.selectOption(
    'select[aria-label="模型"]',
    "deepseek/deepseek-flash",
  );
  if (fields.write) {
    await page.check(`input[aria-label="写权限：${fields.write}"]`);
    await page.check('input[aria-label="写入范围：章节（chapters/）"]');
  }
  await page.click('[data-testid="agent-save"]');
  await page.waitForSelector('[data-testid="agent-form"]', {
    state: "detached",
    timeout: 10000,
  });
  await page.waitForSelector(`[data-testid="agent-${fields.name}"]`, {
    timeout: 10000,
  });
}

let app;
let page;
try {
  ({ app, page } = await launch());
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [chosen],
    });
  }, folder);
  await page.click('[data-testid="link-folder"]');
  await page.waitForSelector('[data-testid="project-card"]');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="agent-new"]')?.disabled,
  );

  // ── 1. 只读“校对” ──────────────────────────────────────────
  await createAgent(page, {
    displayName: "校对",
    name: "proofreader",
    description: "只读章节并指出错别字",
    prompt:
      "你是校对员。每次回答都必须以【校对员】三个字开头。你只读取章节并指出错别字和不通顺处，绝不修改任何文件。",
  });
  const proof = await ask(
    page,
    "@校对 请读取 chapters/第一章.md，指出里面的错别字。",
  );
  const proofText = textOf(proof.slice);
  check(
    "校对：运行正常结束",
    proof.slice.some((e) => e.type === "run.finished"),
    proof.slice.find((e) => e.type === "run.error")?.payload?.error ?? "",
  );
  check(
    "校对：自己的提示词生效（以【校对员】开头）",
    proofText.trimStart().startsWith("【校对员】"),
    proofText.slice(0, 80),
  );
  check(
    "校对：读到了章节并指出“长案”",
    proofText.includes("长案"),
    proofText.slice(0, 160),
  );
  check(
    "校对：没有改动章节文件",
    fs.readFileSync(chapterFile, "utf8") === ORIGINAL,
  );
  const proofTools = proof.slice
    .filter(
      (e) =>
        e.type === "tool.started" ||
        e.type === "tool.finished" ||
        e.type === "tool.called",
    )
    .map((e) => String(e.payload.tool ?? e.payload.name ?? ""));
  check(
    "校对：没有调用任何写入工具",
    !proofTools.some(
      (name) => name.includes("write") || name.includes("propose"),
    ),
    proofTools.join(","),
  );

  // 只读 Agent 被要求改文件：无写工具，文件保持不变
  const proofWrite = await ask(
    page,
    "@校对 请把第一章里的“长案”改成“长安”，直接改文件。",
  );
  check(
    "校对：被要求改文件时，文件仍未被改动",
    fs.readFileSync(chapterFile, "utf8") === ORIGINAL,
    textOf(proofWrite.slice).slice(0, 100),
  );

  // ── 2. 可写“润色”（仅章节、写前确认） ───────────────────────
  await createAgent(page, {
    displayName: "润色",
    name: "polisher",
    description: "按要求修改章节措辞",
    prompt:
      "你是润色员。按用户的要求，用 doc.write 修改 chapters/ 下的章节文件：先用 doc.read 读取最新正文，再写回完整正文，只改要求的地方。写完后用一句话说明。",
    write: "直接写入",
  });
  const edit = await ask(
    page,
    "@润色 请把 chapters/第一章.md 里的“长案”改成“长安”，其余不动。",
  );
  check("润色：改章节前出现了审批卡", edit.sawApproval);
  const after = fs.readFileSync(chapterFile, "utf8");
  check(
    "润色：批准后章节被修改（长案→长安），其余内容保留",
    after.includes("长安城") &&
      !after.includes("长案") &&
      after.includes("三更鼓响过"),
    JSON.stringify(after.slice(0, 80)),
  );
  const committed = events().filter((e) => e.type === "revision.committed");
  check(
    "润色：写入记为该 Agent 的修订",
    committed.some(
      (e) =>
        JSON.stringify(e.payload).includes("polisher") ||
        JSON.stringify(e.actor ?? e.payload.author ?? "").includes(
          "polisher",
        ) ||
        e.actor_id === "polisher",
    ),
    committed.map((e) => `${e.actor_type ?? ""}/${e.actor_id ?? ""}`).join(","),
  );

  // 范围外：设定集
  const settingBefore = fs.readFileSync(settingFile, "utf8");
  const outside = await ask(
    page,
    // 这是权限测试：要求模型务必真的发起一次工具调用，让拦截发生在权限层而不是靠模型自觉
    "@润色 这是权限测试。请务必实际调用一次 doc.write，把 path 设为 .wordhub/bible/setting.md、content 设为“测试内容”，不要事先判断能不能写，我要看工具返回的结果，并把返回内容原样告诉我。",
  );
  check(
    "润色：写设定集（范围外）被拒绝，文件不变",
    fs.readFileSync(settingFile, "utf8") === settingBefore,
    textOf(outside.slice).slice(0, 120),
  );
  const denied = outside.slice.some(
    (e) =>
      JSON.stringify(e.payload).includes("权限拒绝") ||
      JSON.stringify(e.payload).includes("不在Agent的写入范围"),
  );
  check("润色：事件里记录了权限拒绝", denied);

  // ── 3. 重启后仍在 ──────────────────────────────────────────
  await closeApp(app);
  ({ app, page } = await launch());
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
  await page.waitForSelector('[data-testid="agent-proofreader"]', {
    timeout: 15000,
  });
  check(
    "重启后两个自建 Agent 仍在侧栏",
    (await page.locator('[data-testid="agent-proofreader"]').count()) === 1 &&
      (await page.locator('[data-testid="agent-polisher"]').count()) === 1,
  );
} catch (error) {
  check("脚本异常", false, String(error?.stack ?? error).slice(0, 700));
}
await closeApp(app);
const failed = report.checks.filter((c) => !c.passed);
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
fs.writeFileSync(
  path.join(root, "artifacts", "agent-form-live-result.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  `\n${report.checks.length - failed.length}/${report.checks.length} 项通过`,
);
await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
process.exit(failed.length ? 1 : 0);
