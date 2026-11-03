// 关闭 Electron 应用：Playwright 的 app.close() 没有超时，应用不退出时脚本会一直挂着
// （CI 上曾有一个端到端步骤卡了半小时以上）。这里限时等待，超时就强制结束进程树。
import { spawnSync } from "node:child_process";

export async function closeApp(app, timeoutMs = 20000) {
  if (!app) return;
  let pid;
  try {
    pid = app.process().pid;
  } catch {
    pid = undefined;
  }
  const closed = app.close().then(
    () => true,
    () => true,
  );
  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve(false), timeoutMs),
  );
  if (await Promise.race([closed, timeout])) return;
  console.error(
    `应用在 ${timeoutMs / 1000} 秒内没有退出，强制结束进程树（pid ${pid}）`,
  );
  if (!pid) return;
  if (process.platform === "win32")
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
  else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 已经退出
    }
  }
}
