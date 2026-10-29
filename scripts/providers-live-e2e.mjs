// 多服务商真实验收（真实模型，OpenAI 兼容协议）：
// 不提供任何内置 DeepSeek 密钥，只通过设置页添加一个自定义服务商（指向 DeepSeek 的 OpenAI 兼容接口，
// 模型 deepseek-flash），然后：保存密钥 → 测试连接 → 全部角色改用它 → 写一章 → 定稿 → 审批中强杀重开并批准。
// 用法：DEEPSEEK_API_KEY=... node scripts/providers-live-e2e.mjs（密钥只用于在界面里填写，不会传给应用进程）
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { _electron } from "playwright";

const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) {
  if (process.env.WORDHUB_REQUIRE_LIVE === "1") {
    console.error("失败：多服务商真实验收要求 DEEPSEEK_API_KEY。");
    process.exit(2);
  }
  console.log("跳过：未设置 DEEPSEEK_API_KEY");
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-providers-live-"));
const userData = path.join(tmp, "appdata");
const folder = path.join(tmp, "项目", "长安夜");
const chapters = path.join(folder, "chapters");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { checks: [] };
const check = (name, passed, detail = "") => {
  report.checks.push({ name, passed, detail });
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  —  ${detail}` : ""}`,
  );
  return passed;
};

// 预置一份很小的设定集，省掉纲领问答
const bible = path.join(folder, ".wordhub", "bible");
fs.mkdirSync(bible, { recursive: true });
fs.writeFileSync(
  path.join(bible, "outline.md"),
  "## 第一章\n- 目标：裴照夜巡崇仁坊，发现质库后门的血迹\n- 悬念：血迹通向坊墙外\n",
);
fs.writeFileSync(
  path.join(bible, "characters.md"),
  "# 人物\n- 裴照：长安不良人，三十岁，沉默谨慎，惯用左手。\n",
);
fs.writeFileSync(
  path.join(bible, "setting.md"),
  "# 设定\n- 唐代长安，夜禁，三更鼓后坊门关闭。\n",
);
fs.writeFileSync(
  path.join(bible, "style.md"),
  "# 文风\n- 长短句交错，克制，少用比喻。\n",
);

// 应用进程环境里不能有任何 DeepSeek 密钥
const env = { ...process.env, WORDHUB_WORKSPACE_ROOT: root };
delete env.ELECTRON_RUN_AS_NODE;
delete env.DEEPSEEK_API_KEY;
delete env.WORDHUB_DEEPSEEK_API_KEY;
delete env.DS_PROXY_API_KEY;
delete env.WORDHUB_MOCK;

async function launch() {
  const app = await _electron.launch({
    executablePath: electron,
    args: [path.join(root, "out/main/index.js"), `--user-data-dir=${userData}`],
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
  return { app, page };
}
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
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload_json) }));
};

async function runWorkflow(page, text, timeoutMs = 900000) {
  const before = events().length;
  await page.fill('[data-testid="composer-input"]', text);
  await page.click('[data-testid="send"]');
  const deadline = Date.now() + timeoutMs;
  let finished;
  let failed;
  while (Date.now() < deadline && !finished && !failed) {
    const slice = events().slice(before);
    finished = slice.find((e) => e.type === "workflow.finished");
    failed = slice.find((e) => e.type === "workflow.failed");
    const pending = page.locator(".approval:not(.resolved) .btn-primary");
    if (!finished && !failed && (await pending.count()) > 0)
      await pending
        .last()
        .click()
        .catch(() => undefined);
    await sleep(1500);
  }
  return {
    finished: Boolean(finished),
    failed: failed?.payload,
    slice: events().slice(before),
  };
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

  // ── 1. 设置页：默认服务商没密钥；添加自定义服务商 ─────────────────
  await page.click('[data-testid="rail-settings"]');
  await page.waitForSelector('[data-testid="provider-deepseek"]');
  check(
    "没有内置密钥时 DeepSeek 显示未配置",
    (await page.textContent('[data-testid="provider-deepseek"]')).includes(
      "尚未配置密钥",
    ),
  );
  await page.click('button:has-text("自定义…")');
  await page.fill('input[aria-label="Provider ID"]', "ds-proxy");
  await page.fill('input[aria-label="Provider 名称"]', "DeepSeek（自定义）");
  await page.fill('input[aria-label="Base URL"]', "https://api.deepseek.com");
  await page.fill('input[aria-label="模型ID-0"]', "deepseek-flash");
  await page.check('input[aria-label="支持思考-0"]');
  await page.click('button:has-text("添加自定义服务商")');
  await page.waitForSelector('[data-testid="provider-ds-proxy"]');
  const card = page.locator('[data-testid="provider-ds-proxy"]');
  check(
    "同名模型自动参考 Pi 目录价格（不提示价格未知）",
    (await page.locator('[data-testid="unpriced-ds-proxy"]').count()) === 0,
  );
  check(
    "密钥保存前显示未配置",
    (await card.textContent()).includes("尚未配置密钥"),
  );

  // ── 2. 在界面里填密钥，测试连接 ────────────────────────────────
  await page.fill('input[aria-label="DeepSeek（自定义） API key"]', KEY);
  await card.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForSelector(
    '[data-testid="provider-ds-proxy"] :text("密钥已加密保存")',
  );
  await card.getByRole("button", { name: "测试连接" }).click();
  await page
    .waitForFunction(
      () => {
        const text = document.querySelector(
          '[data-testid="provider-ds-proxy"]',
        )?.textContent;
        return Boolean(text) && !text.includes("测试中");
      },
      null,
      { timeout: 60000 },
    )
    .catch(() => undefined);
  const testText = await card.textContent();
  check(
    "自定义服务商测试连接成功",
    /成功|连接/u.test(testText) && !/失败|错误|未配置|不可用/u.test(testText),
    testText.slice(-80),
  );

  // ── 3. 全部角色改用自定义服务商（含史官） ─────────────────────
  await page
    .locator('select[aria-label="全部角色使用同一模型"]')
    .selectOption("ds-proxy/deepseek-flash");
  await sleep(1500);
  const roles = await page.$$eval(".model-table li", (items) =>
    items.map((li) => ({
      name: li.querySelector(".mt-name")?.textContent,
      model: li.querySelector("select")?.value,
    })),
  );
  check(
    "模型分配包含史官，且全部角色都切到自定义服务商",
    roles.some((r) => r.name === "史官") &&
      roles.length >= 5 &&
      roles.every((r) => r.model === "ds-proxy/deepseek-flash"),
    JSON.stringify(roles),
  );
  await page.click('[data-testid="rail-workspace"]');

  // ── 4. 写一章（写手 → 编辑 → 评审），全程用自定义服务商 ──────────
  const write = await runWorkflow(page, "写第一章");
  check(
    "写第一章：工作流正常收尾",
    write.finished,
    write.failed ? JSON.stringify(write.failed).slice(0, 200) : "",
  );
  const files = fs.existsSync(chapters) ? fs.readdirSync(chapters) : [];
  const chapter = files[0];
  const text = chapter
    ? fs.readFileSync(path.join(chapters, chapter), "utf8")
    : "";
  check(
    "章节文件有实质内容",
    text.length >= 300,
    `${chapter} · ${text.length} 字符`,
  );
  const usedModels = new Set(
    write.slice
      .filter((e) => e.type === "run.started" || e.type === "run.usage")
      .map((e) => `${e.payload.provider ?? ""}/${e.payload.model ?? ""}`),
  );
  const providers = new Set(
    write.slice
      .map((e) => e.payload?.provider ?? e.payload?.modelRef?.provider)
      .filter(Boolean),
  );
  check(
    "写作过程未依赖内置 deepseek 密钥（应用进程无该密钥，运行成功即证明走的是自定义服务商）",
    !providers.has("deepseek"),
    [...providers].join(",") || [...usedModels].join(","),
  );
  const usage = write.slice.filter((e) => e.type === "run.usage");
  const cost = usage.reduce(
    (s, e) => s + Number(e.payload.usage?.cost?.total ?? 0),
    0,
  );
  check(
    "记录了用量，且按目录价格计费（费用大于 0）",
    usage.length > 0 && cost > 0,
    `${usage.length} 条，$${cost.toFixed(5)}`,
  );

  const tip = await page
    .locator('[data-testid="agent-model-writer"]')
    .getAttribute("title");
  check(
    "侧栏的模型标签显示最近一次实际使用的模型",
    Boolean(tip?.includes("最近一次实际使用 deepseek-flash")),
    tip ?? "",
  );

  // ── 5. 定稿（史官） ────────────────────────────────────────
  if (chapter) {
    const fin = await runWorkflow(page, `定稿 chapters/${chapter}`, 600000);
    check(
      "定稿完成并记录",
      fin.finished && fin.slice.some((e) => e.type === "chapter.finalized"),
      fin.failed ? JSON.stringify(fin.failed).slice(0, 200) : "",
    );
    check(
      "史官抽取了待确认事实与摘要",
      fin.slice.some((e) => e.type === "fact.proposed") &&
        fin.slice.some((e) => e.type === "chapter.summary"),
      `${fin.slice.filter((e) => e.type === "fact.proposed").length} 条事实`,
    );
  }

  // ── 6. 审批中强杀 → 重开（无环境密钥）→ 批准 → 恢复运行 ─────────
  const before = events().length;
  await page.fill(
    '[data-testid="composer-input"]',
    "@纲领 请把一条补充设定“长安夜禁以三更鼓为界”追加写入 .wordhub/bible/setting.md",
  );
  await page.click('[data-testid="send"]');
  const gotApproval = await page
    .waitForSelector(".approval:not(.resolved)", { timeout: 150000 })
    .then(() => true)
    .catch(() => false);
  check("触发了需要审批的写入", gotApproval);
  if (gotApproval) {
    const runId = events()
      .slice(before)
      .find((e) => e.type === "approval.requested")?.run_id;
    spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"], {
      stdio: "ignore",
    });
    await sleep(1500);
    ({ app, page } = await launch());
    await page.waitForSelector(".approval:not(.resolved)", { timeout: 20000 });
    check("强杀重开后审批卡仍在", true);
    await page.click(".approval:not(.resolved) .btn-primary");
    const end = Date.now() + 240000;
    let done = false;
    while (Date.now() < end && !done) {
      done = events().some(
        (e) =>
          e.run_id === runId &&
          (e.type === "run.finished" || e.type === "run.error"),
      );
      if (!done) await sleep(1500);
    }
    const last = events().find(
      (e) =>
        e.run_id === runId &&
        (e.type === "run.finished" || e.type === "run.error"),
    );
    check(
      "重开后批准，用已保存的密钥恢复并正常收尾",
      last?.type === "run.finished",
      last?.type === "run.error" ? JSON.stringify(last.payload) : last?.type,
    );
  }
} catch (error) {
  check("脚本异常", false, String(error?.stack ?? error));
}
await app?.close().catch(() => undefined);
const failed = report.checks.filter((c) => !c.passed);
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
fs.writeFileSync(
  path.join(root, "artifacts", "providers-live-result.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  `\n${report.checks.length - failed.length}/${report.checks.length} 项通过`,
);
await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
process.exit(failed.length ? 1 : 0);
