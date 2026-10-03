import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electronBinary = require("electron");

function refreshDeepSeekKey() {
  if (process.env.DEEPSEEK_API_KEY) return true;
  for (const scope of ["User", "Machine"]) {
    try {
      const value = execFileSync("powershell.exe", ["-NoProfile", "-Command", `[Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','${scope}')`], { encoding: "utf8", windowsHide: true }).trim();
      if (value) {
        process.env.DEEPSEEK_API_KEY = value;
        return true;
      }
    } catch {}
  }
  return false;
}

const hasKey = refreshDeepSeekKey();
const build = process.platform === "win32"
  ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run build:desktop"], { cwd: root, stdio: "inherit", env: process.env })
  : spawnSync("npm", ["run", "build:desktop"], { cwd: root, stdio: "inherit", env: process.env });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const env = { ...process.env, WORDHUB_WORKSPACE_ROOT: root };
const child = spawnSync(electronBinary, [path.join(root, "out", "main", "index.js"), "--wordhub-pi-spike"], { cwd: root, env, encoding: "utf8", windowsHide: true });
const artifactPath = path.join(root, "artifacts", "pi-utility-result.json");
let result = null;
if (fs.existsSync(artifactPath)) result = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
if (!result) result = { spike: "pi-electron-utility-process", ok: false, error: "Electron未生成验证报告", stdout: child.stdout, stderr: child.stderr };
result.liveKeyDetected = hasKey;
result.electronExitCode = child.status;
fs.writeFileSync(artifactPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (child.status !== 0 || result.ok !== true) process.exitCode = 1;
