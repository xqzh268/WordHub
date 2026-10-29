// M4.7 真实回归（真实 DeepSeek）：全新空项目 → 一句话 → 纲领问答 → 草稿确认 → 写前三章 → 逐章定稿（史官抽取事实）
// → 确认事实 → 预埋跨章矛盾（第三章里老周死了，第四章里老周活着出场）→ 评审第四章 → 干净对照章评审。
// 记录：各阶段耗时与费用、事实数量、检出与误报。用法：node scripts/m4-regression.mjs
// 说明：写前三章是真实创作，整个流程通常要几十分钟；结果写入 artifacts/m4-regression-result.json。
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
if (!KEY) {
  if (process.env.WORDHUB_REQUIRE_LIVE === "1") {
    console.error("失败：M4.7 真实回归要求 DEEPSEEK_API_KEY。");
    process.exit(2);
  }
  console.log("跳过：未设置 DEEPSEEK_API_KEY");
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron");
const { ELECTRON_RUN_AS_NODE, ...cleanEnv } = process.env;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-regression-"));
const userData = path.join(tmp, "appdata");
const folder = path.join(tmp, "项目", "长安夜");
writeTestModelOverrides(folder);
fs.mkdirSync(folder, { recursive: true });
const chaptersDir = path.join(folder, "chapters");

const report = { phases: {}, checks: [], totals: {} };
const check = (name, passed, detail = "") => {
  report.checks.push({ name, passed, detail });
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  —  ${detail}` : ""}`,
  );
  return passed;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const answers = {
  conflict: "查清一桩牵连宫门的旧案，同时不能让上司察觉自己在追查",
  world: "唐代长安崇仁坊一带，夜禁制度下的坊市",
  mustInclude: "更鼓",
  forbidden: "现代词汇和网络用语",
  chapterCount: "6",
};

let app;
let database;
const db = () => {
  const dir = path.join(userData, "projects");
  const id = fs
    .readdirSync(dir)
    .find((n) => fs.existsSync(path.join(dir, n, "wordhub.sqlite")));
  return new DatabaseSync(path.join(dir, id, "wordhub.sqlite"), {
    readOnly: true,
  });
};
const events = () => {
  database = db();
  const rows = database.prepare("SELECT * FROM events ORDER BY seq").all();
  database.close();
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload_json) }));
};
const costOf = (slice) =>
  slice
    .filter((e) => e.type === "run.usage")
    .reduce(
      (sum, e) =>
        sum + Number(e.payload.usage?.cost?.total ?? e.payload.cost ?? 0),
      0,
    );
const tokensOf = (slice) =>
  slice
    .filter((e) => e.type === "run.usage")
    .reduce((sum, e) => sum + Number(e.payload.usage?.totalTokens ?? 0), 0);

async function phase(name, fn) {
  const t0 = Date.now();
  const before = events().length;
  try {
    return await fn();
  } finally {
    const slice = events().slice(before);
    report.phases[name] = {
      seconds: Math.round((Date.now() - t0) / 1000),
      costUsd: Number(costOf(slice).toFixed(4)),
      tokens: tokensOf(slice),
    };
    console.log(`  [${name}] ${JSON.stringify(report.phases[name])}`);
  }
}

try {
  app = await _electron.launch({
    executablePath: electron,
    args: [path.join(root, "out/main/index.js"), `--user-data-dir=${userData}`],
    cwd: root,
    env: { ...cleanEnv, DEEPSEEK_API_KEY: KEY, WORDHUB_WORKSPACE_ROOT: root },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".app");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="worker-status"]')
        ?.textContent?.includes("待命"),
    null,
    { timeout: 20000 },
  );
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [chosen],
    });
  }, folder);
  await page.click('[data-testid="link-folder"]');
  await page.waitForSelector('[data-testid="project-card"]');

  // 发送一条消息并处理期间出现的审批 / 裁决卡，直到工作流收尾
  async function runWorkflow(text, timeoutMs = 1_500_000) {
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
    await page
      .waitForSelector('[data-testid="stop"]', {
        state: "detached",
        timeout: 120000,
      })
      .catch(() => undefined);
    return {
      finished: Boolean(finished),
      failed: Boolean(failed),
      slice: events().slice(before),
    };
  }

  // ── 1. 一句话 → 纲领问答 → 草稿 → 确认 ─────────────────────────
  await phase("纲领问答与草稿", async () => {
    await page.fill(
      '[data-testid="composer-input"]',
      "写一部唐代悬疑短篇，主角是不良人裴照",
    );
    await page.click('[data-testid="send"]');
    const seen = new Set();
    const started = Date.now();
    while (Date.now() - started < 180000) {
      if ((await page.locator('[data-testid="draft-card"]').count()) > 0) break;
      const card = page.locator(".question-card:not(.resolved)").last();
      if (
        (await card.count()) === 0 ||
        (await card.locator("textarea").count()) === 0
      ) {
        await sleep(300);
        continue;
      }
      const prompt = (await card.locator("p").first().innerText()).trim();
      if (seen.has(prompt)) {
        await sleep(300);
        continue;
      }
      seen.add(prompt);
      const reply = prompt.includes("核心冲突")
        ? answers.conflict
        : prompt.includes("世界或时代")
          ? answers.world
          : prompt.includes("必须出现")
            ? answers.mustInclude
            : prompt.includes("不希望出现")
              ? answers.forbidden
              : prompt.includes("多少章")
                ? answers.chapterCount
                : "";
      if (reply) {
        await card.locator("textarea").fill(reply);
        await card.getByRole("button", { name: "继续" }).click();
      } else {
        const skip = card.getByRole("button", { name: "跳过" });
        if ((await skip.count()) > 0) await skip.click();
        else {
          await card.locator("textarea").fill("请合理决定");
          await card.getByRole("button", { name: "继续" }).click();
        }
      }
      await sleep(400);
    }
    await page
      .waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="draft-doc"]').length >= 4,
        null,
        { timeout: 480000 },
      )
      .catch(() => undefined);
    check(
      "纲领草稿由模型生成四份文档",
      (await page.locator('[data-testid="draft-doc"]').count()) === 4 &&
        (await page.locator('[data-testid="draft-card"]').innerText()).includes(
          "模型生成",
        ),
    );
    await page.getByRole("button", { name: "确认并写入" }).click();
    const ok = await (async () => {
      const end = Date.now() + 20000;
      while (Date.now() < end) {
        if (fs.existsSync(path.join(folder, ".wordhub", "bible", "style.md")))
          return true;
        await sleep(300);
      }
      return false;
    })();
    check("确认后设定文件落盘", ok);
  });

  // ── 2. 写前三章（写手 → 编辑 → 评审），并逐章定稿 ─────────────────
  const names = ["一", "二", "三"];
  for (let i = 0; i < 3; i += 1) {
    const label = `第${names[i]}章`;
    let written;
    await phase(`写${label}`, async () => {
      const r = await runWorkflow(`写${label}`);
      check(
        `${label}：写作工作流正常收尾`,
        r.finished,
        r.failed ? "workflow.failed" : "超时",
      );
      const files = fs.existsSync(chaptersDir)
        ? fs.readdirSync(chaptersDir)
        : [];
      written = files.find((n) => n.includes(label)) ?? files[i];
      const text = written
        ? fs.readFileSync(path.join(chaptersDir, written), "utf8")
        : "";
      check(
        `${label}：章节文件有实质内容`,
        text.length >= 300,
        `${written} · ${text.length} 字符`,
      );
    });
    if (i === 2 && written) {
      // 预埋：第三章末尾让老周死去（跨章矛盾的“前提”）
      fs.appendFileSync(
        path.join(chaptersDir, written),
        "\n\n质库掌柜老周倒在后墙下，胸口一刀，血已经凉了，再没有起来。裴照合上他的眼睛，默然良久。\n",
        "utf8",
      );
      report.planted = { chapter: written };
      await sleep(2500);
    }
    if (written)
      await phase(`定稿${label}`, async () => {
        const r = await runWorkflow(`定稿 chapters/${written}`);
        const finalizedFacts = events().filter(
          (e) =>
            e.type === "fact.proposed" &&
            e.payload.chapter === `chapters/${written}`,
        ).length;
        check(
          `${label}：定稿完成并记录`,
          r.finished && r.slice.some((e) => e.type === "chapter.finalized"),
        );
        check(
          `${label}：史官抽取了待确认事实与摘要`,
          finalizedFacts > 0 &&
            r.slice.some((e) => e.type === "chapter.summary"),
          `${finalizedFacts} 条事实`,
        );
      });
  }

  // ── 3. 确认事实 ─────────────────────────────────────────────
  await phase("确认事实", async () => {
    await page.getByRole("tab", { name: /事实/u }).click();
    await sleep(800);
    let clicks = 0;
    for (;;) {
      const button = page
        .locator('[data-testid="fact"].fact-proposed')
        .first()
        .getByRole("button", { name: "确认" });
      if ((await button.count()) === 0 || clicks > 80) break;
      await button.click();
      clicks += 1;
      await sleep(250);
    }
    const all = events().filter((e) => e.type === "fact.proposed");
    const dead = all.find(
      (e) =>
        /老周/u.test(e.payload.subject) &&
        /死|亡|杀|毙|殒/u.test(e.payload.statement),
    );
    report.facts = {
      proposed: all.length,
      confirmedByScript: clicks,
      byKind: Object.fromEntries(
        ["character_state", "term", "foreshadow", "event"].map((k) => [
          k,
          all.filter((e) => e.payload.kind === k).length,
        ]),
      ),
      plantedDeathExtracted: Boolean(dead),
    };
    check("至少确认了若干事实", clicks > 0, `${clicks} 条`);
    check(
      "史官从定稿章节里抽出了预埋的“老周之死”",
      Boolean(dead),
      dead ? dead.payload.statement : "未抽出",
    );
    await page.getByRole("tab", { name: /纸面/u }).click();
  });

  // ── 4. 预埋矛盾：第四章里老周活着 ──────────────────────────────
  await phase("评审第四章（含跨章矛盾）", async () => {
    fs.writeFileSync(
      path.join(chaptersDir, "第四章.md"),
      "# 第四章\n\n翌日清晨，裴照照例走进崇仁坊。质库掌柜老周正站在柜台后，笑着招呼他：“裴不良，今日来得早。”\n\n老周端出一碗热汤放在柜台上，问起昨夜更鼓的事，神色如常。\n",
      "utf8",
    );
    await sleep(2500);
    const r = await runWorkflow("请评审第四章", 900000);
    const raised = r.slice.filter((e) => e.type === "challenge.raise");
    const cites = raised.flatMap((e) => e.payload.citations ?? []);
    const citesBoth =
      cites.some((c) => /第四章/u.test(c.source)) &&
      cites.some(
        (c) =>
          /第三章|第\d+章|chapters\//u.test(c.source) &&
          !/第四章/u.test(c.source),
      );
    report.crossChapter = {
      finished: r.finished,
      challenges: raised.length,
      categories: [...new Set(raised.map((e) => e.payload.category))],
      citesBothChapters: citesBoth,
      claims: raised.map((e) => String(e.payload.claim ?? "").slice(0, 120)),
    };
    check("评审完成", r.finished);
    check(
      "检出跨章矛盾（第三章已死的老周在第四章活着）",
      raised.length > 0,
      `${raised.length} 条质询`,
    );
    check("质询同时引用了第四章与前文原文", citesBoth);
  });

  // ── 5. 干净对照章 ───────────────────────────────────────────
  await phase("评审第五章（干净对照）", async () => {
    fs.writeFileSync(
      path.join(chaptersDir, "第五章.md"),
      "# 第五章\n\n三更的更鼓响过，裴照独自走过崇仁坊的石桥。他在桥心停了一停，望向坊墙上渐暗的天色，随后继续向前走去。\n\n坊门在他身后一道道落了锁。\n",
      "utf8",
    );
    await sleep(2500);
    const r = await runWorkflow("请评审第五章", 900000);
    const raised = r.slice.filter((e) => e.type === "challenge.raise");
    report.clean = {
      finished: r.finished,
      challenges: raised.length,
      claims: raised.map((e) => String(e.payload.claim ?? "").slice(0, 120)),
    };
    // 对照章是脚本随手写的，并不知道模型生成的大纲与设定（如三更时坊门早已关闭），
    // 所以只记录质询内容供人工核对，不作通过条件；误报率由 test:m3:neutral / test:m4:review 的受控夹具度量。
    check(
      "干净对照章评审完成（质询留作人工核对）",
      r.finished,
      `${raised.length} 条质询`,
    );
  });
} catch (error) {
  check("脚本未异常", false, String(error?.message ?? error).slice(0, 400));
  try {
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "artifacts", "m4-regression-events.json"),
      JSON.stringify(
        events().map((e) => ({
          seq: e.seq,
          type: e.type,
          run: e.run_id,
          payload: JSON.stringify(e.payload ?? {}).slice(0, 300),
        })),
        null,
        1,
      ),
      "utf8",
    );
    await (await app?.firstWindow())?.screenshot({
      path: path.join(root, "artifacts", "m4-regression-failure.png"),
    });
  } catch {
    /* 取证失败忽略 */
  }
} finally {
  try {
    const all = events();
    report.totals = {
      seconds: Object.values(report.phases).reduce((n, p) => n + p.seconds, 0),
      costUsd: Number(costOf(all).toFixed(4)),
      tokens: tokensOf(all),
    };
    // 留下生成的章节与设定，便于人工查看
    const out = path.join(root, "artifacts", "m4-regression-output");
    fs.mkdirSync(out, { recursive: true });
    for (const dir of [chaptersDir, path.join(folder, ".wordhub", "bible")])
      if (fs.existsSync(dir))
        for (const name of fs.readdirSync(dir))
          if (/\.(md|json)$/u.test(name))
            fs.copyFileSync(path.join(dir, name), path.join(out, name));
  } catch {
    /* 汇总失败忽略 */
  }
  if (app)
    spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"], {
      stdio: "ignore",
    });
  const failed = report.checks.filter((c) => !c.passed);
  report.ok = failed.length === 0;
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "artifacts", "m4-regression-result.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log(
    `\n${report.checks.length - failed.length}/${report.checks.length} 通过 · 总耗时 ${report.totals.seconds ?? "?"} 秒 · 费用 $${report.totals.costUsd ?? "?"}`,
  );
  await fsp
    .rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 })
    .catch(() => undefined);
  if (failed.length) process.exitCode = 1;
}
