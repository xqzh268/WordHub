// M4.4 评审清单评测（真实 DeepSeek）：设定集与文风基准只陈述事实，提示词只说“请评审第三章”。
// 五类预埋矛盾（时间线 / 人物塑造 / 基本事实 / 常识 / 风格）各一章，外加一章无矛盾的干净章节，
// 度量：检出率、分类准确率、误报率。用法：node scripts/m4-review-eval.mjs [重复次数，默认 2]
// 通过线：预埋矛盾检出率 ≥ 70%，干净章节误报率 ≤ 1/3，出错的运行计为失败（分母是全部次数）。
// 结果：artifacts/m4-review-eval-result.json；出错时留下事件摘要与截图（artifacts/m4-review-failures/）。
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
    console.error("失败：M4.4 评审评测要求 DEEPSEEK_API_KEY。");
    process.exit(2);
  }
  console.log("跳过：未设置 DEEPSEEK_API_KEY");
  process.exit(0);
}
const RUNS = Number(process.argv[2] ?? 2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron");
const { ELECTRON_RUN_AS_NODE, ...cleanEnv } = process.env;

const BIBLE = {
  "characters.md":
    "# 人物档案\n\n## 裴照\n不良人，三十岁，左撇子，惯用横刀。沉默寡言，办案时从不饮酒。\n\n## 周怀仁\n不良帅，四十三岁，裴照的上司。\n",
  "setting.md":
    "# 设定词典\n\n## 世界与时代\n唐代长安崇仁坊一带。\n\n## 词条\n- 更鼓：日暮鼓后夜禁开始，坊门关闭，夜行须有官府文书。\n- 金吾卫：负责夜禁巡逻。\n\n## 时间线\n故事发生在腊月初八至腊月十二，共五天。\n",
  "style.md":
    "# 文风基准\n\n第三人称有限视角，只随裴照一人，不进入其他角色内心。冷峻克制，短句为主。不使用现代词汇和网络用语。\n",
  "outline.md":
    "# 大纲\n\n### 第3章 违夜\n- 目标：裴照腊月初九夜里去质库后墙查看。\n",
};

const SCENARIOS = [
  {
    label: "timeline",
    expected: "timeline",
    text: "腊月初九的夜里，裴照来到质库后墙，伏在阴影里听着坊内的动静。\n\n他等了许久，墙内始终没有响动。转眼已是来年正月十五，他仍在坊间一户一户地查访，却没有任何新的线索。\n",
  },
  {
    label: "character",
    expected: "character",
    text: "腊月初九的夜里，裴照来到质库后墙，伏在阴影里听着坊内的动静。\n\n他从怀里摸出一壶烧酒，仰头灌了几大口，抹了抹嘴，才继续盯着墙头。更鼓声远远传来。\n",
  },
  {
    label: "fact",
    expected: "fact",
    text: "腊月初九，日暮鼓刚刚落下，崇仁坊的坊门依旧大敞，行人如织。裴照随着人流自由进出坊门，没有任何人查问文书。\n\n他在质库后墙停下，左手按住刀柄，听着墙内的动静。\n",
  },
  {
    label: "commonsense",
    expected: "commonsense",
    text: "腊月初九的夜里，裴照来到质库后墙，左手按住刀柄。\n\n他掏出怀表看了一眼时辰，已是三更，墙内仍然没有响动，更鼓声远远传来。\n",
  },
  {
    label: "style",
    expected: "style",
    text: "腊月初九的夜里，裴照来到质库后墙，左手按住刀柄，伏在阴影里听着动静。\n\n裴照心想，这案子真是绝绝子。而此时的周怀仁正在衙署里暗自盘算，如何把这口锅甩给手下的小吏。\n",
  },
  {
    label: "clean",
    expected: null,
    text: "腊月初九的夜里，裴照来到质库后墙，左手按住刀柄，伏在阴影里听着坊内的动静。\n\n他等了许久，墙内始终没有响动。更鼓声远远传来，他数着鼓点，一声一声，直到三更。\n",
  },
];

async function oneRun(index) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-review-eval-"));
  const userData = path.join(tmp, "appdata");
  const folder = path.join(tmp, "项目");
  writeTestModelOverrides(folder);
  const bibleDir = path.join(folder, ".wordhub", "bible");
  fs.mkdirSync(bibleDir, { recursive: true });
  fs.mkdirSync(path.join(folder, "chapters"), { recursive: true });
  for (const [name, text] of Object.entries(BIBLE))
    fs.writeFileSync(path.join(bibleDir, name), text, "utf8");

  const app = await _electron.launch({
    executablePath: electron,
    args: [path.join(root, "out/main/index.js"), `--user-data-dir=${userData}`],
    cwd: root,
    env: {
      ...cleanEnv,
      DEEPSEEK_API_KEY: KEY,
      WORDHUB_WORKSPACE_ROOT: root,
    },
  });
  const database = () => {
    const dir = path.join(userData, "projects");
    const id = fs
      .readdirSync(dir)
      .find((n) => fs.existsSync(path.join(dir, n, "wordhub.sqlite")));
    return new DatabaseSync(path.join(dir, id, "wordhub.sqlite"), {
      readOnly: true,
    });
  };
  const events = () => {
    const db = database();
    const rows = db.prepare("SELECT * FROM events ORDER BY seq").all();
    db.close();
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload_json) }));
  };
  const outcome = { run: index, scenarios: {} };
  try {
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

    for (const scenario of SCENARIOS) {
      fs.writeFileSync(
        path.join(folder, "chapters", "第三章.md"),
        scenario.text,
        "utf8",
      );
      const before = events().length;
      await page.fill('[data-testid="composer-input"]', "请评审第三章");
      await page.click('[data-testid="send"]');
      // 逐个处理升级裁决，直到工作流收尾（或超时）
      const deadline = Date.now() + 600000;
      let finished;
      let failed;
      let workflowId;
      while (Date.now() < deadline && !finished && !failed) {
        const slice = events().filter((e) => e.seq > before);
        workflowId ??= slice.find((e) => e.type === "workflow.started")?.run_id;
        finished = slice.find((e) => e.type === "workflow.finished");
        failed = slice.find((e) => e.type === "workflow.failed");
        const pending = page.locator(".approval:not(.resolved) .btn-primary");
        if (!finished && !failed && (await pending.count()) > 0)
          await pending
            .last()
            .click()
            .catch(() => undefined);
        await new Promise((r) => setTimeout(r, 1500));
      }
      const slice = events().filter((e) => e.seq > before);
      const raised = slice.filter((e) => e.type === "challenge.raise");
      const categories = [...new Set(raised.map((e) => e.payload.category))];
      outcome.scenarios[scenario.label] = {
        finished: Boolean(finished),
        failed: failed
          ? JSON.stringify(failed.payload).slice(0, 300)
          : undefined,
        challenges: raised.length,
        categories,
        categoryHit: scenario.expected
          ? categories.includes(scenario.expected)
          : undefined,
        claims: raised.map((e) => String(e.payload.claim ?? "").slice(0, 80)),
      };
      if (!finished)
        throw new Error(
          `${scenario.label}：工作流没有正常收尾 ${failed ? "workflow.failed" : "超时"}`,
        );
      await page
        .waitForSelector('[data-testid="stop"]', {
          state: "detached",
          timeout: 120000,
        })
        .catch(() => undefined);
    }
  } catch (error) {
    outcome.error = String(error?.message ?? error).slice(0, 400);
    try {
      const dir = path.join(root, "artifacts", "m4-review-failures");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, `run-${index}-events.json`),
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
      await app
        .windows()[0]
        ?.screenshot({ path: path.join(dir, `run-${index}.png`) })
        .catch(() => undefined);
    } catch {
      /* 取证失败不影响主流程 */
    }
  } finally {
    spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"], {
      stdio: "ignore",
    });
    await fsp
      .rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 })
      .catch(() => undefined);
  }
  return outcome;
}

const results = [];
for (let i = 1; i <= RUNS; i += 1) {
  const result = await oneRun(i);
  results.push(result);
  console.log(JSON.stringify(result));
}

const planted = SCENARIOS.filter((s) => s.expected);
const per = Object.fromEntries(
  planted.map((s) => {
    const rows = results.map((r) => r.scenarios[s.label]);
    return [
      s.label,
      {
        detected: rows.filter((x) => x?.finished && x.challenges > 0).length,
        categoryHit: rows.filter((x) => x?.categoryHit).length,
        runs: RUNS,
      },
    ];
  }),
);
const cleanRows = results.map((r) => r.scenarios.clean);
const falsePositives = cleanRows.filter(
  (x) => x?.finished && x.challenges > 0,
).length;
const detectedTotal = Object.values(per).reduce((n, x) => n + x.detected, 0);
const categoryTotal = Object.values(per).reduce((n, x) => n + x.categoryHit, 0);
const totalPlanted = planted.length * RUNS;
const summary = {
  runs: RUNS,
  errored: results.filter((r) => r.error).length,
  detectionRate: detectedTotal / totalPlanted,
  categoryAccuracy: categoryTotal / totalPlanted,
  falsePositiveRate: falsePositives / RUNS,
  perCategory: per,
  results,
};
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
fs.writeFileSync(
  path.join(root, "artifacts", "m4-review-eval-result.json"),
  JSON.stringify(summary, null, 2),
  "utf8",
);
console.log(
  `\n检出 ${detectedTotal}/${totalPlanted}｜分类命中 ${categoryTotal}/${totalPlanted}｜干净章节误报 ${falsePositives}/${RUNS}｜出错 ${summary.errored}/${RUNS}`,
);
for (const [label, x] of Object.entries(per))
  console.log(
    `  ${label}: 检出 ${x.detected}/${RUNS}，分类命中 ${x.categoryHit}/${RUNS}`,
  );
const pass = summary.detectionRate >= 0.7 && summary.falsePositiveRate <= 1 / 3;
console.log(pass ? "通过" : "未通过");
if (!pass) process.exitCode = 1;
