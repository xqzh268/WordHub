// “AI 味”盲评素材生成（真实 DeepSeek）。三个版本写同一套章节，打乱编号后交给人盲评：
//   A 现状：旧写手 / 旧编辑提示词，旧纲领生成的文风基准（短句为主、按刀数鼓）；
//   B 改提示词：新写手提示词 + 用新纲领提示词重新生成的文风基准；
//   C B + 编辑改写：再加上新编辑提示词，并把静态“机器味”检查标出的句子交给编辑改写。
// 用法：node scripts/style-blind-eval.mjs [重复次数，默认 2] [章数，默认 2]
// 前置：npm run build:desktop；artifacts/m4-regression-output/ 里有一次真实回归生成的设定（outline/characters/setting/style.md）。
// 产出：artifacts/style-eval/blind.md（打乱后的匿名样稿，给人打分）、key.json（编号对应的版本）、metrics.json（静态指标）。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { _electron } from "playwright";
import { flashOnly, writeTestModelOverrides } from "./lib/test-models.mjs";

const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) {
  console.log("跳过：未设置 DEEPSEEK_API_KEY");
  process.exit(0);
}
const REPEATS = Number(process.argv[2] ?? 2);
const CHAPTERS = Number(process.argv[3] ?? 2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron");
const { ELECTRON_RUN_AS_NODE, ...cleanEnv } = process.env;
const baseBible = path.join(root, "artifacts", "m4-regression-output");
const outDir = path.join(root, "artifacts", "style-eval");
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (spec) =>
  spawnSync("git", ["show", spec], { cwd: root, encoding: "utf8" }).stdout;
const { analyzeStyle } = await import(
  new URL("../packages/runtime/dist/editor/style-metrics.js", import.meta.url)
    .href
);

// ── 用当前纲领提示词重新生成整套设定（变体 D 用）──────────────────────
async function newBible() {
  const { createModels } = await import("@earendil-works/pi-ai");
  const { deepseekProvider } = await import(
    "@earendil-works/pi-ai/providers/deepseek"
  );
  const { generateDraft } = await import(
    new URL("../packages/runtime/dist/novel/draft.js", import.meta.url).href
  );
  const models = createModels();
  models.setProvider(deepseekProvider());
  const plan = JSON.parse(
    fs.readFileSync(path.join(baseBible, "writing-plan.json"), "utf8"),
  );
  const { documents } = await generateDraft({
    models,
    model: models.getModel(
      "deepseek",
      flashOnly() ? "deepseek-flash" : "deepseek-v4-pro",
    ),
    reasoning: "high",
    apiKey: KEY,
    answers: plan.answers,
  });
  return documents;
}

const read = (file) => fs.readFileSync(file, "utf8");
const work = (name) =>
  read(path.join(root, "packages/novel/agents", name, "AGENT.md"));
// 历史版本：3553193 = 本轮文风改动之前；2dd1a89 = 第一轮文风改动（提示词去“短句为主”、编辑静态清单）
const OLD = "3553193";
const R1 = "2dd1a89";
const wanted = new Set((process.argv[4] ?? "B,D").split(","));
const styleB = path.join(outDir, "style-new.md"); // 第一轮盲评时 B/C 用的文风基准（保留，勿覆盖）

const variants = [
  {
    id: "A",
    label: "最初版本",
    writer: git(`${OLD}:packages/novel/agents/writer/AGENT.md`),
    editor: git(`${OLD}:packages/novel/agents/editor/AGENT.md`),
    style: () => read(path.join(baseBible, "style.md")),
    hint: false,
  },
  {
    id: "B",
    label: "第一轮改动（对照）",
    writer: git(`${R1}:packages/novel/agents/writer/AGENT.md`),
    editor: git(`${OLD}:packages/novel/agents/editor/AGENT.md`),
    style: () => read(styleB),
    hint: false,
  },
  {
    id: "D",
    label: "去篇章层套路（小动作限用、开结尾、章节功能多样）",
    writer: work("writer"),
    editor: git(`${OLD}:packages/novel/agents/editor/AGENT.md`),
    docs: async () => {
      console.log("用当前纲领提示词重新生成整套设定……");
      const docs = await newBible();
      for (const [name, text] of Object.entries(docs))
        fs.writeFileSync(path.join(outDir, `docs-D-${name}`), text, "utf8");
      return docs;
    },
    hint: false,
  },
].filter((variant) => wanted.has(variant.id));

/** 变体工作区：复制 packages/novel，替换写手/编辑提示词，工作流去掉评审（评测只看文字）。 */
function variantRoot(tmp, variant) {
  const base = path.join(tmp, `root-${variant.id}`);
  fs.cpSync(
    path.join(root, "packages", "novel"),
    path.join(base, "packages", "novel"),
    {
      recursive: true,
    },
  );
  fs.writeFileSync(
    path.join(base, "packages/novel/agents/writer/AGENT.md"),
    variant.writer,
    "utf8",
  );
  fs.writeFileSync(
    path.join(base, "packages/novel/agents/editor/AGENT.md"),
    variant.editor,
    "utf8",
  );
  fs.writeFileSync(
    path.join(base, "packages/novel/workflows/write-chapter.json"),
    JSON.stringify(
      {
        id: "write-chapter",
        label: "写一章",
        nodes: [
          {
            id: "writer",
            kind: "write",
            agent: "writer",
            dependencies: [],
            status: "pending",
            maxAttempts: 2,
          },
          {
            id: "editor",
            kind: "edit",
            agent: "editor",
            dependencies: ["writer"],
            status: "pending",
            maxAttempts: 2,
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  return base;
}

async function oneSession(variant, repeat) {
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), `wordhub-style-${variant.id}-`),
  );
  const userData = path.join(tmp, "appdata");
  const folder = path.join(tmp, "项目", "长安夜");
  writeTestModelOverrides(folder);
  const bible = path.join(folder, ".wordhub", "bible");
  fs.mkdirSync(bible, { recursive: true });
  fs.mkdirSync(path.join(folder, "chapters"), { recursive: true });
  fs.copyFileSync(
    path.join(baseBible, "writing-plan.json"),
    path.join(bible, "writing-plan.json"),
  );
  if (variant.docs && !variant.cachedDocs)
    variant.cachedDocs = await variant.docs();
  const docs = variant.cachedDocs;
  for (const name of ["outline.md", "characters.md", "setting.md", "style.md"])
    fs.writeFileSync(
      path.join(bible, name),
      docs?.[name] ??
        (name === "style.md"
          ? variant.style()
          : read(path.join(baseBible, name))),
      "utf8",
    );
  const workspace = variantRoot(tmp, variant);
  const app = await _electron.launch({
    executablePath: electron,
    args: [path.join(root, "out/main/index.js"), `--user-data-dir=${userData}`],
    cwd: root,
    env: {
      ...cleanEnv,
      DEEPSEEK_API_KEY: KEY,
      WORDHUB_WORKSPACE_ROOT: workspace,
      ...(variant.hint ? {} : { WORDHUB_DISABLE_STYLE_HINT: "1" }),
    },
  });
  const events = () => {
    const dir = path.join(userData, "projects");
    const id = fs
      .readdirSync(dir)
      .find((n) => fs.existsSync(path.join(dir, n, "wordhub.sqlite")));
    const db = new DatabaseSync(path.join(dir, id, "wordhub.sqlite"), {
      readOnly: true,
    });
    const rows = db.prepare("SELECT * FROM events ORDER BY seq").all();
    db.close();
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload_json) }));
  };
  const samples = [];
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
    const names = ["一", "二", "三", "四"];
    for (let n = 1; n <= CHAPTERS; n += 1) {
      const before = events().length;
      await page.fill(
        '[data-testid="composer-input"]',
        `写第${names[n - 1]}章`,
      );
      await page.click('[data-testid="send"]');
      const deadline = Date.now() + 900000;
      let done;
      while (Date.now() < deadline && !done) {
        done = events()
          .slice(before)
          .find(
            (e) =>
              e.type === "workflow.finished" || e.type === "workflow.failed",
          );
        const pending = page.locator(".approval:not(.resolved) .btn-primary");
        if (!done && (await pending.count()) > 0)
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
      const files = fs.readdirSync(path.join(folder, "chapters")).sort();
      const file = files[n - 1];
      if (done?.type === "workflow.finished" && file)
        samples.push({
          variant: variant.id,
          repeat,
          chapter: n,
          text: fs.readFileSync(path.join(folder, "chapters", file), "utf8"),
        });
      else
        console.log(
          `  ${variant.id}#${repeat} 第${n}章 失败：${done?.type ?? "超时"}`,
        );
    }
  } finally {
    spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"], {
      stdio: "ignore",
    });
    await fsp
      .rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 })
      .catch(() => undefined);
  }
  return samples;
}

const all = [];
for (let repeat = 1; repeat <= REPEATS; repeat += 1)
  for (const variant of variants) {
    console.log(`运行 ${variant.id}（${variant.label}）第 ${repeat} 轮……`);
    const samples = await oneSession(variant, repeat);
    all.push(...samples);
    console.log(`  得到 ${samples.length} 份样稿`);
  }

// 静态指标（按版本汇总）
const metrics = all.map((s) => {
  const report = analyzeStyle(s.text);
  return {
    variant: s.variant,
    repeat: s.repeat,
    chapter: s.chapter,
    index: report.index,
    ...report.metrics,
    flags: report.flags.map((f) => `${f.code}×${f.count}`),
  };
});
fs.writeFileSync(
  path.join(outDir, "metrics.json"),
  JSON.stringify(metrics, null, 2),
  "utf8",
);
for (const v of variants) {
  const rows = metrics.filter((m) => m.variant === v.id);
  const avg = (key) =>
    (rows.reduce((n, r) => n + r[key], 0) / (rows.length || 1)).toFixed(2);
  console.log(
    `${v.id} ${v.label}：样稿 ${rows.length}，指数均值 ${avg("index")}，句长均值 ${avg("avgSentenceLength")}，碎句段 ${avg("shortRuns")}，清单并列 ${avg("listRuns")}，数字/千字 ${avg("numbersPerThousand")}`,
  );
}

// 盲评稿：打乱后匿名编号
const shuffled = [...all].sort(() => Math.random() - 0.5);
const key = {};
const blind = shuffled
  .map((s, i) => {
    const label = `样稿${String(i + 1).padStart(2, "0")}`;
    key[label] = { variant: s.variant, repeat: s.repeat, chapter: s.chapter };
    return `# ${label}\n\n${s.text.trim()}\n`;
  })
  .join("\n---\n\n");
fs.writeFileSync(
  path.join(outDir, "blind.md"),
  `# 文风盲评稿\n\n请对每份样稿打分（1–5）：1=一眼就是 AI 腔，5=读起来像人写的小说。可附一句理由。编号与版本的对应在 key.json，评完再看。\n\n---\n\n${blind}`,
  "utf8",
);
fs.writeFileSync(
  path.join(outDir, "key.json"),
  JSON.stringify(key, null, 2),
  "utf8",
);
console.log(
  `\n盲评稿：${path.join(outDir, "blind.md")}（${shuffled.length} 份）`,
);
