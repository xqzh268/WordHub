// 用于 synctex-e2e 的确定性 Tectonic 替身。
//
// 模板 PDF 和 SyncTeX 来自 scripts/fixtures/synctex-e2e，前者有文字层，后者
// 是标准 SyncTeX Version 1。每次运行只把 Input 改写成当前临时项目中的文件，
// 因而不会把开发机的绝对路径写进测试夹具。
//   %FAKE-SYNCTEX-FAIL  模拟失败，保留上一次成功输出供旧预览断言

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "synctex-e2e",
);
const args = process.argv.slice(2);
const outputIndex = args.indexOf("-o");
const outputRoot = path.resolve(
  outputIndex >= 0 ? args[outputIndex + 1] : process.cwd(),
);
const mainFile = path.resolve(args.at(-1) ?? "");
const source = readFileSync(mainFile, "utf8");

if (source.includes("%FAKE-SYNCTEX-FAIL")) {
  console.error("error: fake SyncTeX engine failure");
  process.exit(1);
}

mkdirSync(outputRoot, { recursive: true });
const stem = path.basename(mainFile, path.extname(mainFile));
const projectRoot = path.dirname(mainFile);
const projectPath = (relativePath) =>
  path.join(projectRoot, relativePath).replaceAll("\\", "/");

// The template was produced by Tectonic and contains the exact source lines
// used by the fixture. Replace only Input records. Positions, page numbers and
// glyph records remain those from the real engine.
const sync = gunzipSync(readFileSync(path.join(root, "template.synctex.gz")))
  .toString("utf8")
  .replace(/^Input:1:.*$/mu, `Input:1:${projectPath("main.tex")}`)
  .replace(/^Input:7:.*$/mu, `Input:7:${projectPath("parts/chapter.tex")}`);

writeFileSync(
  path.join(outputRoot, `${stem}.pdf`),
  readFileSync(path.join(root, "template.pdf")),
);
writeFileSync(path.join(outputRoot, `${stem}.synctex.gz`), gzipSync(sync));
writeFileSync(
  path.join(outputRoot, `${stem}.log`),
  "fake SyncTeX engine finished\n",
);
console.log("note: fake SyncTeX engine finished");
