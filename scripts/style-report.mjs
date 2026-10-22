// 打印章节文本的“AI味”可数指标。用法：node scripts/style-report.mjs 文件1.md 文件2.md …
// 这些是相对指标（用来比较不同提示词 / 流程的产出），不是“是否 AI 写的”检测器。
import fs from "node:fs";
import path from "node:path";

const { analyzeStyle } = await import(
  new URL("../packages/runtime/dist/editor/style-metrics.js", import.meta.url)
    .href
);
const files = process.argv.slice(2);
if (!files.length) {
  console.error("用法：node scripts/style-report.mjs 文件1.md 文件2.md …");
  process.exit(2);
}
for (const file of files) {
  const report = analyzeStyle(fs.readFileSync(file, "utf8"));
  const m = report.metrics;
  console.log(
    `${path.basename(file)}  ${m.characters}字  指数 ${report.index}  句长均值 ${m.avgSentenceLength}(σ${m.sentenceLengthStdDev})  短句 ${(m.shortSentenceRatio * 100).toFixed(0)}%  碎句段 ${m.shortRuns}  不是而是 ${m.notButCount}  清单并列 ${m.listRuns}  数字/千字 ${m.numbersPerThousand}  比喻/千字 ${m.similesPerThousand}`,
  );
  for (const flag of report.flags)
    console.log(
      `    · ${flag.label} ×${flag.count}${flag.examples[0] ? `  例：${flag.examples[0].slice(0, 40)}` : ""}`,
    );
}
