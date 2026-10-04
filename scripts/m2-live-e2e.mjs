// M2 验收：真实 Electron + 真实 DeepSeek 的端到端检查（需要环境变量 DEEPSEEK_API_KEY，会产生少量费用）。
// 提示词只描述意图、不出现工具名，避免测试依赖工具的具体写法。
// 覆盖：读设定集并写章节、越权写入被拦、需确认的写入（批准 / 拒绝）、审批中强杀后重开、密钥泄露扫描。
// 用法：npm run build:desktop && node scripts/m2-live-e2e.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { _electron } from "playwright";

const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) {
  if (process.env.WORDHUB_REQUIRE_LIVE === "1") {
    console.error(
      "失败：夜间真实模型回归要求 DEEPSEEK_API_KEY，但仓库未提供。",
    );
    process.exit(2);
  }
  console.log("跳过：未设置 DEEPSEEK_API_KEY（本地可选）");
  process.exit(0);
}
const cleanEnv = () => {
  const { ELECTRON_RUN_AS_NODE, ...rest } = process.env;
  return rest;
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = createRequire(import.meta.url)("electron");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-m2-live-"));
const userData = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
fs.mkdirSync(path.join(folder, "chapters"), { recursive: true });
fs.mkdirSync(path.join(folder, ".wordhub", "bible"), { recursive: true });
fs.writeFileSync(
  path.join(folder, ".wordhub", "bible", "bible.md"),
  "# 设定\n主角裴照是不良人，左撇子，惯用横刀。故事发生在唐代长安崇仁坊。\n",
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
const note = (text) => console.log(`      ${text}`);

const launch = () =>
  _electron.launch({
    executablePath: electronBinary,
    args: [
      path.join(root, "out", "main", "index.js"),
      `--user-data-dir=${userData}`,
    ],
    cwd: root,
    env: { ...cleanEnv(), WORDHUB_WORKSPACE_ROOT: root, DEEPSEEK_API_KEY: KEY },
  });
const db = () => {
  const dir = path.join(userData, "projects");
  const id = fs
    .readdirSync(dir)
    .find((name) => fs.existsSync(path.join(dir, name, "wordhub.sqlite")));
  return new DatabaseSync(path.join(dir, id, "wordhub.sqlite"), {
    readOnly: true,
  });
};
const events = () => {
  const d = db();
  const rows = d
    .prepare(
      "SELECT seq,run_id,type,actor_id,payload_json FROM events ORDER BY seq",
    )
    .all();
  d.close();
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload_json) }));
};
const ofType = (list, type) => list.filter((e) => e.type === type);

async function ready(page) {
  await page.waitForSelector(".app");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="worker-status"]')
        ?.textContent?.includes("待命"),
    null,
    { timeout: 20000 },
  );
}
async function link(app, page) {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [chosen],
    });
  }, folder);
  const hasLink = await page.locator('[data-testid="link-folder"]').count();
  await page.click(
    hasLink ? '[data-testid="link-folder"]' : '[data-testid="project-card"]',
  );
  await page.waitForSelector('[data-testid="project-card"]', {
    timeout: 10000,
  });
}
async function say(page, text, { wait = "idle" } = {}) {
  const usageBefore = await page.locator(".usage-line").count();
  await page.fill('[data-testid="composer-input"]', text);
  await page.click('[data-testid="send"]');
  await page.waitForSelector('[data-testid="stop"]', { timeout: 10000 });
  if (wait === "idle")
    await page.waitForSelector('[data-testid="stop"]', {
      state: "detached",
      timeout: 240000,
    });
  if (wait === "idle")
    await page.waitForFunction(
      (before) => document.querySelectorAll(".usage-line").length > before,
      usageBefore,
      { timeout: 10000 },
    );
  if (wait === "approval")
    await page.waitForSelector(".approval:not(.resolved)", { timeout: 90000 });
}
const exists = (rel) => fs.existsSync(path.join(folder, rel));
const read = (rel) => fs.readFileSync(path.join(folder, rel), "utf8");
const killTree = (app) =>
  spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"], {
    stdio: "ignore",
  });

let app;
try {
  app = await launch();
  let page = await app.firstWindow();
  await ready(page);
  await link(app, page);

  // ── A. 读设定集并写章节 ─────────────────────────────────
  console.log("\n[A] 写手读设定集并写入章节");
  await say(
    page,
    "@写手 请先读一下设定集（文件名 bible.md），再把约六十字的第一章开头写进文件 chapters/第一章.md。完成后只回复“已写入”。",
  );
  let ev = events();
  check(
    "A1 章节文件被写入且有中文内容",
    exists("chapters/第一章.md") &&
      (read("chapters/第一章.md").match(/[一-鿿]/g) ?? []).length >= 20,
    exists("chapters/第一章.md")
      ? read("chapters/第一章.md").slice(0, 40)
      : "文件不存在",
  );
  const tools = ofType(ev, "run.tool_started").map((e) =>
    String(e.payload.tool).replace("_", "."),
  );
  check(
    "A2 事件里有 bible.read 与 doc.write 的工具调用",
    tools.includes("bible.read") && tools.includes("doc.write"),
    tools.join(","),
  );
  const injected = ofType(ev, "context.injected")[0];
  check(
    "A3 记录了上下文注入清单且包含设定集",
    Boolean(injected) &&
      JSON.stringify(injected.payload.manifest).includes("bible"),
    JSON.stringify(injected?.payload.manifest),
  );
  const usage = ofType(ev, "run.usage");
  check(
    "A4 记录了用量与费用",
    usage.length > 0 && usage.every((u) => u.payload.costUsd > 0),
    usage
      .map(
        (u) =>
          `${u.payload.inputTokens}/${u.payload.outputTokens} $${u.payload.costUsd?.toFixed?.(6)}`,
      )
      .join(" "),
  );
  const started = ofType(ev, "run.started")[0];
  check(
    "A5 run.started 记录 agentId/model/reasoning",
    started?.payload.agentId === "writer" &&
      Boolean(started.payload.model) &&
      Boolean(started.payload.reasoning),
    JSON.stringify(started?.payload),
  );
  {
    const d = db();
    const revs = d.prepare("SELECT author_json,status FROM revisions").all();
    d.close();
    check(
      "A6 修订由 agent:writer 署名",
      revs.some((r) => JSON.parse(r.author_json).id === "writer"),
      JSON.stringify(revs.map((r) => [JSON.parse(r.author_json).id, r.status])),
    );
  }
  const chat = await page.locator(".chat-scroll").innerText();
  const usageLines = await page.locator(".usage-line").allTextContents();
  check(
    "A7 界面显示了用量",
    usageLines.length > 0 &&
      usageLines.some((line) => /\$|token|输入|输出/i.test(line)),
    `用量行：${JSON.stringify(usageLines)}；聊天末尾：${JSON.stringify(chat.slice(-240))}`,
  );

  // ── B. 越权写入 ─────────────────────────────────────────
  console.log("\n[B] 写手越权写入应被拦下");
  await say(
    page,
    "@写手 请把“备忘”这两个字写进文件 notes/备忘.md。必须真的写入文件，不要只回复文字。",
  );
  ev = events();
  const denied = ofType(ev, "permission.denied");
  const bRun = ev.filter((e) => e.seq > ofType(ev, "run.finished")[0].seq);
  note(
    `B 轮事件：${bRun.map((e) => e.type + (e.payload.tool ? `(${e.payload.tool}${e.payload.path ? " " + e.payload.path : ""})` : "")).join(" → ")}`,
  );
  check("B1 越权文件没有被创建", !exists("notes/备忘.md"));
  check(
    "B2 越权调用留下了 permission.denied 事件",
    denied.length > 0,
    `${denied.length} 条${denied[0] ? `：${denied[0].payload.reason}` : ""}`,
  );
  const bReply = (await page.locator(".entry-notice").allTextContents())
    .join(" ")
    .replace(/\s+/g, " ");
  check(
    "B3 被拦截后用户在聊天里能看到明确说明",
    /权限|范围|拒绝|不允许|无法/.test(bReply),
    `最后一条回复：${JSON.stringify(bReply.slice(0, 80))}`,
  );

  // ── C. 需确认的写入：批准 ───────────────────────────────
  console.log("\n[C] 需要确认的写入：批准");
  const override = path.join(folder, ".wordhub", "agents", "writer");
  fs.mkdirSync(override, { recursive: true });
  fs.writeFileSync(
    path.join(override, "AGENT.md"),
    `---
name: writer
displayName: 写手
description: 项目级覆盖：写入前需要确认。
model: { provider: deepseek, id: deepseek-flash, reasoning: low }
tools: [doc.read, doc.write, bible.read, history.search]
write: write
writeScopes: [chapters/**]
confirmBeforeWrite: true
memoryScopes: { read: [bible, outline, chapters], write: [] }
maxTurns: 8
---
你是写手。需要写文件时必须使用写文件工具，不要只在回复里贴正文。
`,
    "utf8",
  );
  await say(
    page,
    "@写手 请把“第二章开头：雨夜”写进文件 chapters/第二章.md，写完后只回复“已写入”。",
    { wait: "approval" },
  );
  check("C1 批准前文件未落盘", !exists("chapters/第二章.md"));
  const cardText = await page.locator(".approval").first().innerText();
  check(
    "C2 审批卡显示了要写入的路径",
    (await page.locator(".approval-path").first().innerText()).includes(
      "chapters/第二章.md",
    ),
    `卡片内容：${JSON.stringify(cardText.replace(/\n/g, " "))}`,
  );
  check(
    "C3 审批卡显示了要写入的内容或差异",
    cardText.includes("雨夜"),
    "用户看不到将要写入什么",
  );
  await page.click(".approval:not(.resolved) .btn-primary");
  await page.waitForSelector('[data-testid="stop"]', {
    state: "detached",
    timeout: 240000,
  });
  check(
    "C4 批准后文件落盘",
    exists("chapters/第二章.md"),
    exists("chapters/第二章.md") ? read("chapters/第二章.md").slice(0, 30) : "",
  );
  for (let i = 0; i < 40 && ofType(events(), "run.finished").length < 3; i += 1)
    await new Promise((r) => setTimeout(r, 500));
  ev = events();
  const counts = Object.fromEntries(
    [
      "approval.requested",
      "approval.granted",
      "run.waiting_approval",
      "run.finished",
      "run.error",
    ].map((t) => [t, ofType(ev, t).length]),
  );
  check(
    "C5 事件里有 approval.requested、approval.granted，且批准后该运行以 run.finished 收尾",
    counts["approval.requested"] >= 1 &&
      counts["approval.granted"] >= 1 &&
      counts["run.finished"] >= 3,
    JSON.stringify(counts),
  );

  // ── D. 需确认的写入：拒绝 ───────────────────────────────
  console.log("\n[D] 需要确认的写入：拒绝");
  await say(page, "@写手 请把“第三章开头：晨雾”写进文件 chapters/第三章.md。", {
    wait: "approval",
  });
  await page.click('.approval:not(.resolved) button:has-text("拒绝")');
  await page.waitForSelector('[data-testid="stop"]', {
    state: "detached",
    timeout: 60000,
  });
  check("D1 拒绝后文件未落盘", !exists("chapters/第三章.md"));
  const afterReject = await page.locator(".chat-scroll").innerText();
  check(
    "D2 拒绝不应显示为红色“运行失败”",
    !(await page.locator(".msg-error").count()),
    `msg-error 数量 ${await page.locator(".msg-error").count()}；文本含“拒绝”：${afterReject.includes("拒绝")}`,
  );

  // ── E. 审批等待中强杀 ───────────────────────────────────
  console.log("\n[E] 审批等待中强杀应用，重开后");
  await say(page, "@写手 请把“第四章开头：残月”写进文件 chapters/第四章.md。", {
    wait: "approval",
  });
  const fourthApprovalRunId = ofType(events(), "approval.requested").at(
    -1,
  )?.run_id;
  killTree(app);
  await new Promise((r) => setTimeout(r, 1500));
  {
    const d = db();
    const runs = d
      .prepare("SELECT id,status FROM runs ORDER BY started_at")
      .all();
    d.close();
    note(`强杀后各运行状态：${runs.map((r) => r.status).join(", ")}`);
    check(
      "E1 强杀后没有遗留 running 状态的运行（等待审批除外）",
      !runs.some((r) => r.status === "running"),
      JSON.stringify(runs.map((r) => r.status)),
    );
  }
  app = await launch();
  page = await app.firstWindow();
  await ready(page);
  await page.waitForTimeout(1500);
  const recoveredEvents = events();
  note(
    `重开后恢复事件：${recoveredEvents
      .filter(
        (event) =>
          event.run_id === undefined ||
          event.type.includes("approval") ||
          event.type.includes("interrupted"),
      )
      .slice(-8)
      .map((event) => event.type)
      .join(" → ")}`,
  );
  const restoredHasCard = await page
    .locator(".approval:not(.resolved)")
    .count();
  note(`重开后未处理的审批卡数量：${restoredHasCard}`);
  if (restoredHasCard) {
    await page.click(".approval:not(.resolved) .btn-primary");
    await page.waitForSelector('[data-testid="stop"]', {
      state: "detached",
      timeout: 240000,
    });
    const feedback = (
      await page.locator(".msg-error, .notice").allInnerTexts()
    ).join(" | ");
    const tail = (await page.locator(".chat-scroll").innerText())
      .split("\n")
      .filter(Boolean)
      .slice(-6)
      .join(" / ");
    note(
      `点击批准后：第四章存在=${exists("chapters/第四章.md")}；未处理卡片=${await page.locator(".approval:not(.resolved)").count()}；错误/提示=${JSON.stringify(feedback)}；聊天末尾=${tail}`,
    );
    check(
      "E2 重开后批准旧审批：界面给出明确说明（不能无声地“已批准”却什么都没发生）",
      Boolean(fourthApprovalRunId) &&
        exists("chapters/第四章.md") &&
        ofType(events(), "run.finished").some(
          (event) => event.run_id === fourthApprovalRunId,
        ),
      `点击后无任何错误或提示；卡片${(await page.locator(".approval:not(.resolved)").count()) === 0 ? "显示为已裁决" : "仍待处理"}，文件${exists("chapters/第四章.md") ? "已写入" : "未写入"}`,
    );
  } else {
    const recoveredChat = await page.locator(".chat-scroll").innerText();
    check(
      "E2 重开后审批卡可见",
      recoveredChat.includes("Agent请求写入") &&
        !recoveredChat.includes("已过期"),
      `既无审批卡也无恢复提示；聊天末尾：${JSON.stringify(recoveredChat.slice(-320))}`,
    );
  }

  // ── F. 密钥泄露扫描 ─────────────────────────────────────
  console.log("\n[F] 密钥泄露扫描");
  await app.close().catch(() => {});
  const hits = [];
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (
          !/Cache|GPU|Dawn|Shader|DIPS|blob|Network|Session Storage|Local Storage|Shared/i.test(
            e.name,
          )
        )
          scan(p);
      } else if (
        fs.statSync(p).size < 50_000_000 &&
        fs.readFileSync(p).includes(KEY)
      )
        hits.push(path.relative(tmp, p));
    }
  };
  scan(tmp);
  check(
    "F1 用户数据目录与项目文件夹中不含明文密钥",
    hits.length === 0,
    hits.join(" | "),
  );
} catch (error) {
  check(
    "脚本未中途异常",
    false,
    String(error?.stack ?? error)
      .split("\n")
      .slice(0, 4)
      .join(" / "),
  );
} finally {
  await app?.close().catch(() => killTree(app)); // 异常路径也要关闭窗口，否则进程会一直挂着
  const failed = findings.filter((f) => !f.passed);
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "artifacts", "m2-live-e2e-result.json"),
    JSON.stringify({ ok: failed.length === 0, findings }, null, 2),
  );
  console.log(`\n${findings.length - failed.length}/${findings.length} 通过`);
  try {
    fs.rmSync(tmp, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 400,
    });
  } catch {
    /* Windows 句柄尚未释放，留给系统清理 */
  }
  if (failed.length) process.exitCode = 1;
}
