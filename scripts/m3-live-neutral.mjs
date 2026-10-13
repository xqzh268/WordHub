// 评审质量评测（真实 DeepSeek）：设定集只写事实、提示词只说“请评审第N章”，不暗示要找什么，也不规定调用哪个工具。
// 度量两件事：有预埋矛盾的章节能否被指出（检出率），无矛盾的章节是否被误报（误报率）。
// 用法：node scripts/m3-live-neutral.mjs [重复次数，默认 3]
// 通过线：检出率 ≥ 2/3 且 误报率 ≤ 1/3；结果写入 artifacts/m3-neutral-result.json。
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
    console.error("失败：M3中立评测要求DEEPSEEK_API_KEY。");
    process.exit(2);
  }
  console.log("跳过：未设置 DEEPSEEK_API_KEY");
  process.exit(0);
}
const RUNS = Number(process.argv[2] ?? 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron");
const cleanEnv = () => {
  const { ELECTRON_RUN_AS_NODE, ...rest } = process.env;
  return rest;
};

async function oneRun(index) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-neutral-"));
  const userData = path.join(tmp, "appdata");
  const folder = path.join(tmp, "项目");
  fs.mkdirSync(path.join(folder, ".wordhub", "bible"), { recursive: true });
  fs.mkdirSync(path.join(folder, "chapters"), { recursive: true });
  // 设定集只陈述事实，不提示评审该找什么。
  fs.writeFileSync(
    path.join(folder, ".wordhub", "bible", "bible.md"),
    "# 设定\n裴照是不良人，左撇子，惯用横刀。故事发生在唐代长安崇仁坊。\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(folder, "chapters", "第三章.md"),
    "裴照走进崇仁坊，右手按住刀柄，听见更鼓从坊门后传来。\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(folder, "chapters", "第四章.md"),
    // 与第三章内容刻意不同：评审流程可能把第三章改对，若两章逐字相同，指出“重复”是正确观察而非误报。
    "裴照左手按住刀柄，缓步走过崇仁坊的石桥，桥下水声很轻。\n",
    "utf8",
  );
  let app;
  try {
    app = await _electron.launch({
      executablePath: electron,
      args: [
        path.join(root, "out/main/index.js"),
        `--user-data-dir=${userData}`,
      ],
      cwd: root,
      env: {
        ...cleanEnv(),
        DEEPSEEK_API_KEY: KEY,
        WORDHUB_WORKSPACE_ROOT: root,
      },
    });
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
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
  const tasks = (runId) => {
    const dir = path.join(userData, "projects");
    const id = fs
      .readdirSync(dir)
      .find((n) => fs.existsSync(path.join(dir, n, "wordhub.sqlite")));
    const db = new DatabaseSync(path.join(dir, id, "wordhub.sqlite"), {
      readOnly: true,
    });
    const rows = db
      .prepare("SELECT id, status FROM tasks WHERE run_id=? ORDER BY id")
      .all(runId);
    db.close();
    return rows;
  };
  const outcome = { run: index };
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
    for (const [label, chapter] of [
      ["contradiction", "第三章"],
      ["clean", "第四章"],
    ]) {
      const before = events().length;
      await page.fill('[data-testid="composer-input"]', `请评审${chapter}`);
      await page.click('[data-testid="send"]');
      const deadline = Date.now() + 420000;
      let terminal;
      while (Date.now() < deadline && !terminal) {
        terminal = events().find(
          (e) =>
            e.seq > before &&
            [
              "workflow.finished",
              "workflow.failed",
              "escalation.created",
            ].includes(e.type),
        );
        if (!terminal) await new Promise((r) => setTimeout(r, 500));
      }
      const paperText = await page
        .locator('[data-testid="paper-sheet"]')
        .innerText();
      if (!paperText.includes("裴照"))
        throw new Error(`${chapter}纸面没有显示章节正文`);
      const slice = events().filter((e) => e.seq > before);
      const raised = slice.filter((e) => e.type === "challenge.raise");
      const workflowId = terminal?.run_id;
      if (terminal?.type === "escalation.created" && workflowId) {
        await page
          .locator(".approval:not(.resolved) .btn-primary")
          .last()
          .click();
        const end = Date.now() + 420000;
        while (Date.now() < end) {
          if (
            events().some(
              (e) => e.run_id === workflowId && e.type === "workflow.finished",
            )
          )
            break;
          await new Promise((r) => setTimeout(r, 500));
        }
        terminal =
          events().find(
            (e) => e.run_id === workflowId && e.type === "workflow.finished",
          ) ?? terminal;
      }
      const waiting = workflowId
        ? tasks(workflowId).filter((task) => task.status === "waiting_approval")
        : [];
      outcome[label] = {
        finished: Boolean(terminal),
        terminal: terminal?.type,
        challenges: raised.length,
        blocking: raised.filter((e) => e.payload.severity === "blocking")
          .length,
        mentionsHand: raised.some((e) =>
          /左|右/u.test(String(e.payload.claim ?? "")),
        ),
        claim: String(raised[0]?.payload.claim ?? "").slice(0, 90),
        paperContainsChapter: paperText.includes("裴照"),
        waitingApprovals: waiting.length,
      };
      if (terminal?.type !== "workflow.finished")
        throw new Error(`${chapter}工作流没有正常收尾`);
      if (waiting.length) throw new Error(`${chapter}工作流有遗留待审批任务`);
      // 两个场景之间等工作流彻底结束，避免互相干扰。
      await page
        .waitForSelector('[data-testid="stop"]', {
          state: "detached",
          timeout: 120000,
        })
        .catch(() => {});
    }
  } catch (error) {
    outcome.error = String(error?.message ?? error).slice(0, 160);
  } finally {
    if (app)
      spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"], {
        stdio: "ignore",
      });
    try {
      fs.rmSync(tmp, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 400,
      });
    } catch {
      /* Windows 句柄尚未释放 */
    }
  }
  return outcome;
}

const results = [];
for (let i = 1; i <= RUNS; i += 1) {
  const result = await oneRun(i);
  results.push(result);
  console.log(JSON.stringify(result));
}
const valid = results.filter(
  (r) =>
    !r.error &&
    r.contradiction?.terminal === "workflow.finished" &&
    r.clean?.terminal === "workflow.finished",
);
const detected = valid.filter(
  (r) => r.contradiction.challenges > 0 && r.contradiction.mentionsHand,
).length;
const falsePositives = valid.filter((r) => r.clean.challenges > 0).length;
const summary = {
  runs: RUNS,
  valid: valid.length,
  detected,
  falsePositives,
  detectionRate: valid.length ? detected / valid.length : 0,
  falsePositiveRate: valid.length ? falsePositives / valid.length : 0,
  results,
};
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
fs.writeFileSync(
  path.join(root, "artifacts", "m3-neutral-result.json"),
  JSON.stringify(summary, null, 2),
  "utf8",
);
console.log(
  `\n检出 ${detected}/${valid.length}（${(summary.detectionRate * 100).toFixed(0)}%）｜误报 ${falsePositives}/${valid.length}（${(summary.falsePositiveRate * 100).toFixed(0)}%）`,
);
const pass =
  summary.detectionRate >= 2 / 3 && summary.falsePositiveRate <= 1 / 3;
console.log(pass ? "通过" : "未通过");
if (!pass) process.exitCode = 1;
