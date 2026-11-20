// 用大写盘符的工作目录启动 vitest。
// Windows 上从小写盘符目录（如 VS Code 以 d:\… 打开工作区）启动时，vitest 5 会把同一模块按 d:/ 与 D:/
// 各加载一份，所有测试文件都报 “Cannot read properties of undefined (reading 'config')”、一条用例都不跑。
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const cwd = process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const entry = join(cwd, "node_modules", "vitest", "vitest.mjs");
const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
  cwd,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
