import path from "node:path";
import { createRequire } from "node:module";

// 端到端测试启动哪个应用：默认是开发版 Electron + out/main/index.js；
// 设置 WORDHUB_SMOKE_EXE 为打包后的可执行文件（如 release/win-unpacked/WordHub.exe）时，直接验证安装包。
const packagedExe = process.env.WORDHUB_SMOKE_EXE;
export const electronBinary = packagedExe
  ? path.resolve(packagedExe)
  : createRequire(import.meta.url)("electron");
export const mainArgs = (root) =>
  packagedExe ? [] : [path.join(root, "out", "main", "index.js")];
