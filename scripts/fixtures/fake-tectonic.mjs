// 仅供 latex-ipc-e2e 使用的假 Tectonic：不下载、不排版，按主文件里的标记模拟结果。
// 只有 WORDHUB_MOCK=1 且设置 WORDHUB_TECTONIC_PATH 指向本脚本时，应用才会用它。
//   %FAKE-FAIL            退出码 1
//   %FAKE-SLOW            挂起 30 秒（用于测试停止与取代）
//   %FAKE-READ <绝对路径>  输出 Tectonic 读取项目外文件时的警告行
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const outIndex = args.indexOf("-o");
const outDir = outIndex >= 0 ? args[outIndex + 1] : process.cwd();
const mainFile = args.at(-1);
const source = readFileSync(mainFile, "utf8");
const stem = path.basename(mainFile, path.extname(mainFile));

const outside = /%FAKE-READ (.+)/u.exec(source)?.[1]?.trim();
if (outside) console.error(`warning: accessing absolute path \`${outside}\``);

const finish = () => {
  if (source.includes("%FAKE-FAIL")) {
    console.error("error: fake engine failure");
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, `${stem}.pdf`), "%PDF-1.4\n%fake\n%%EOF\n");
  writeFileSync(path.join(outDir, `${stem}.log`), "fake log\n");
  console.log("note: fake engine finished");
  process.exit(0);
};

if (source.includes("%FAKE-SLOW")) setTimeout(finish, 30_000);
else finish();
