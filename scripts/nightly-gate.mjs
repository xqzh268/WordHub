// 夜间回归的“连续 2 晚失败才通知”闸门。
// GitHub 会对失败的定时任务无条件发邮件，所以首次失败时让任务以“成功 + 警告”收尾，
// 并把结果记录到构件 nightly-status；下一晚若仍失败，才让任务真正失败（触发通知）。
//
// 用法（工作流里在评测步骤之后调用）：
//   EVAL_OUTCOME=${{ steps.eval.outcome }} node scripts/nightly-gate.mjs
// 环境变量：GH_TOKEN、GITHUB_REPOSITORY、GITHUB_RUN_ID、WORKFLOW_FILE、EVAL_OUTCOME、
//          DRY_RUN=1（演练：判定“应当通知”时只打印，不让任务失败）、STATUS_DIR（默认 status）。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 纯判定函数：是否应当通知。 */
export function decide({ evalOutcome, previous }) {
  if (evalOutcome !== "failure")
    return { notify: false, reason: "本次通过，无需通知。" };
  const failedBefore =
    previous?.conclusion === "failure" ||
    previous?.artifactResult === "failure";
  if (failedBefore)
    return { notify: true, reason: "连续第 2 次失败，发送通知。" };
  return {
    notify: false,
    reason: "首次失败，暂不通知；若下一次仍失败将通知。",
  };
}

function gh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** 取“上一次已完成的运行”（排除当前这次）及其记录的评测结果。 */
export function loadPrevious({ repo, runId, workflow, statusDir }) {
  const list = JSON.parse(
    gh([
      "run",
      "list",
      "--repo",
      repo,
      "--workflow",
      workflow,
      "--limit",
      "10",
      "--json",
      "databaseId,status,conclusion",
    ]),
  );
  const previous = list.find(
    (run) =>
      String(run.databaseId) !== String(runId) && run.status === "completed",
  );
  if (!previous) return { found: false };
  const result = {
    found: true,
    id: previous.databaseId,
    conclusion: previous.conclusion,
  };
  const dir = path.join(statusDir, "previous");
  try {
    gh([
      "run",
      "download",
      String(previous.databaseId),
      "--repo",
      repo,
      "-n",
      "nightly-status",
      "-D",
      dir,
    ]);
    result.artifactResult = fs
      .readFileSync(path.join(dir, "result.txt"), "utf8")
      .trim();
  } catch {
    // 上一次没有留下构件（例如更早的版本，或在评测前就失败），仅凭 conclusion 判断。
  }
  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const evalOutcome = process.env.EVAL_OUTCOME ?? "";
  const statusDir = process.env.STATUS_DIR ?? "status";
  const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
  fs.mkdirSync(statusDir, { recursive: true });
  // 记录本次结果，供下一晚读取（由工作流上传为构件 nightly-status）。
  fs.writeFileSync(
    path.join(statusDir, "result.txt"),
    `${evalOutcome}\n`,
    "utf8",
  );

  let previous = { found: false };
  if (evalOutcome === "failure") {
    previous = loadPrevious({
      repo: process.env.GITHUB_REPOSITORY,
      runId: process.env.GITHUB_RUN_ID,
      workflow: process.env.WORKFLOW_FILE,
      statusDir,
    });
  }
  const verdict = decide({ evalOutcome, previous });
  const detail = `评测结果：${evalOutcome || "未知"}；上一次：${
    previous.found
      ? `#${previous.id} ${previous.conclusion}，记录=${previous.artifactResult ?? "无"}`
      : "无"
  }`;
  const summary = `### 夜间回归闸门\n- ${detail}\n- **${verdict.reason}**${dryRun ? "（演练模式，不会真正失败）" : ""}\n`;
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(detail);
  if (evalOutcome === "failure") {
    if (verdict.notify) console.log(`::error::${verdict.reason}`);
    else console.log(`::warning::${verdict.reason}`);
  } else console.log(verdict.reason);
  if (verdict.notify && !dryRun) process.exitCode = 1;
}
