// 纲领草稿真实验收（真实 DeepSeek）：回答完问题后由模型生成大纲/人物档案/设定词典/文风基准，
// 用户确认前不写文件，确认后写入。用法：node scripts/m4-draft-live.mjs
// 需要 DEEPSEEK_API_KEY；存储与项目目录都在临时目录。
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";
import { writeTestModelOverrides } from "./lib/test-models.mjs";

const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) {
  if (process.env.WORDHUB_REQUIRE_LIVE === "1") {
    console.error("失败：纲领草稿验收要求 DEEPSEEK_API_KEY。");
    process.exit(2);
  }
  console.log("跳过：未设置 DEEPSEEK_API_KEY");
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-draft-live-"));
const folder = path.join(tmp, "项目", "长安夜");
writeTestModelOverrides(folder);
fs.mkdirSync(folder, { recursive: true });
const bibleDir = path.join(folder, ".wordhub", "bible");

const findings = [];
const check = (name, passed, detail = "") => {
  findings.push({ name, passed, detail });
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  —  ${detail}` : ""}`,
  );
  return passed;
};
const read = (name) => {
  try {
    return fs.readFileSync(path.join(bibleDir, name), "utf8");
  } catch {
    return "";
  }
};

const answers = {
  conflict: "查清一桩牵连宫门的旧案，同时不能让上司察觉自己在追查",
  world: "唐代长安崇仁坊一带，夜禁制度下的坊市",
  mustInclude: "更鼓",
  forbidden: "现代词汇和网络用语",
};

let app;
const { ELECTRON_RUN_AS_NODE, ...cleanEnv } = process.env;
try {
  app = await _electron.launch({
    executablePath: electron,
    args: [
      path.join(root, "out/main/index.js"),
      `--user-data-dir=${path.join(tmp, "appdata")}`,
    ],
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

  await page.fill(
    '[data-testid="composer-input"]',
    "写一部唐代悬疑短篇，主角是不良人裴照",
  );
  await page.click('[data-testid="send"]');

  // 依次回答问题，直到出现草稿卡
  const started = Date.now();
  const seen = new Set();
  while (Date.now() - started < 120000) {
    if ((await page.locator('[data-testid="draft-card"]').count()) > 0) break;
    const card = page.locator(".question-card:not(.resolved)").last();
    if ((await card.count()) === 0) {
      await page.waitForTimeout(300);
      continue;
    }
    const prompt = (await card.locator("p").first().innerText()).trim();
    if (seen.has(prompt)) {
      await page.waitForTimeout(300);
      continue;
    }
    const area = card.locator("textarea");
    if ((await area.count()) === 0) {
      await page.waitForTimeout(300);
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
            : "";
    if (reply) {
      await area.fill(reply);
      await card.getByRole("button", { name: "继续" }).click();
    } else {
      const skip = card.getByRole("button", { name: "跳过" });
      if ((await skip.count()) > 0) await skip.click();
      else {
        await area.fill("请合理决定");
        await card.getByRole("button", { name: "继续" }).click();
      }
    }
    await page.waitForTimeout(400);
  }
  check(
    "回答完问题后出现纲领草稿卡",
    (await page.locator('[data-testid="draft-card"]').count()) > 0,
  );
  check(
    "草稿阶段不写入任何设定文件",
    !fs.existsSync(path.join(bibleDir, "outline.md")),
  );

  const t0 = Date.now();
  await page
    .waitForFunction(
      () => document.querySelectorAll('[data-testid="draft-doc"]').length >= 4,
      null,
      { timeout: 420000 },
    )
    .catch(() => undefined);
  const docCount = await page.locator('[data-testid="draft-doc"]').count();
  check(
    "模型生成四份文档",
    docCount === 4,
    `${docCount} 份，用时 ${Math.round((Date.now() - t0) / 1000)} 秒`,
  );
  const cardText = await page.locator('[data-testid="draft-card"]').innerText();
  check(
    "草稿来源为模型而不是回退模板",
    cardText.includes("模型生成"),
    cardText.slice(0, 80),
  );
  check(
    "确认前文件仍未写入",
    !fs.existsSync(path.join(bibleDir, "outline.md")),
  );

  // 展开所有文档读取内容
  const docs = {};
  for (const element of await page.locator('[data-testid="draft-doc"]').all()) {
    await element.evaluate((node) => {
      node.open = true;
    });
    const title = (await element.locator("summary").innerText()).trim();
    docs[title] = await element.locator("pre").innerText();
  }
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "artifacts", "m4-draft-live-docs.md"),
    Object.entries(docs)
      .map(([title, text]) => `# ===== ${title} =====\n\n${text}`)
      .join("\n\n"),
    "utf8",
  );
  check(
    "大纲含逐章内容且提到主角",
    (docs["大纲"] ?? "").includes("裴照") &&
      /第[一二三四五六七八九十\d]+章/u.test(docs["大纲"] ?? ""),
    `${(docs["大纲"] ?? "").length} 字`,
  );
  check("人物档案写到主角", (docs["人物档案"] ?? "").includes("裴照"));
  check(
    "设定词典包含作者要求的“更鼓”，并有禁止项",
    (docs["设定词典"] ?? "").includes("更鼓") &&
      /禁止/u.test(docs["设定词典"] ?? ""),
  );
  check("文风基准给出视角与示范", /视角/u.test(docs["文风基准"] ?? ""));
  check(
    "补全内容带“（建议）”标记",
    Object.values(docs).some((text) => text.includes("（建议）")),
  );
  check(
    "没有残留分隔标记",
    Object.values(docs).every((text) => !text.includes("=====FILE")),
  );

  await page.getByRole("button", { name: "确认并写入" }).click();
  const deadline = Date.now() + 15000;
  while (
    Date.now() < deadline &&
    !fs.existsSync(path.join(bibleDir, "style.md"))
  )
    await page.waitForTimeout(200);
  check(
    "确认后写入四份设定文件和写作计划",
    [
      "outline.md",
      "characters.md",
      "setting.md",
      "style.md",
      "writing-plan.json",
    ].every((name) => read(name).length > 0),
  );
  check(
    "写入的内容与草稿一致",
    read("outline.md").trim() === (docs["大纲"] ?? "").trim(),
  );
} catch (error) {
  check("验收脚本未异常", false, String(error?.message ?? error).slice(0, 300));
  try {
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    await (await app?.firstWindow())?.screenshot({
      path: path.join(root, "artifacts", "m4-draft-live-failure.png"),
    });
  } catch {
    /* 取证失败忽略 */
  }
} finally {
  await app?.close().catch(() => undefined);
  const failed = findings.filter((f) => !f.passed);
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "artifacts", "m4-draft-live-result.json"),
    JSON.stringify({ ok: failed.length === 0, findings }, null, 2),
  );
  console.log(`\n${findings.length - failed.length}/${findings.length} 通过`);
  await fsp
    .rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 })
    .catch(() => undefined);
  if (failed.length) process.exitCode = 1;
}
