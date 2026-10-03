import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AppEvent, CommandPayloads, CommandResults, WorkspaceCommand, WorkspaceSnapshot } from "@wordhub/contracts";
import { PiWorkerHost } from "./pi-worker-host.js";

const root = path.resolve(process.env.WORDHUB_WORKSPACE_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../"));
console.error(`[wordhub-main] loaded ${process.argv.join(" ")}`);
let mainWindow: BrowserWindow | null = null;
let linkedFolder: string | null = null;
let projectName = "未命名项目";
const worker = new PiWorkerHost((event) => mainWindow?.webContents.send("wordhub:event", event));

function snapshot(): WorkspaceSnapshot {
  return { projectName, linkedFolder, worker: worker.status };
}

function registerIpc(): void {
  ipcMain.handle("wordhub:invoke", async (_event, request: { command: WorkspaceCommand; payload: unknown }) => {
    const command = request.command;
    if (command === "workspace.getSnapshot") return snapshot() as CommandResults["workspace.getSnapshot"];
    if (command === "workspace.chooseFolder") {
      const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
      linkedFolder = result.canceled ? null : result.filePaths[0] ?? null;
      if (linkedFolder) projectName = path.basename(linkedFolder);
      return { path: linkedFolder } as CommandResults["workspace.chooseFolder"];
    }
    if (command === "run.start") {
      const payload = request.payload as CommandPayloads["run.start"];
      const runId = `run_${Date.now().toString(36)}`;
      worker.run({ runId, prompt: payload.prompt, mode: process.env.WORDHUB_MOCK === "1" ? "mock" : "live", projectPath: payload.projectPath ?? linkedFolder ?? undefined });
      return { runId } as CommandResults["run.start"];
    }
    if (command === "run.abort") {
      const payload = request.payload as CommandPayloads["run.abort"];
      worker.abort(payload.runId);
      return { runId: payload.runId, aborted: true } as CommandResults["run.abort"];
    }
    worker.restart();
    return { worker: worker.status } as CommandResults["run.restartWorker"];
  });
}

async function runUtilitySpike(): Promise<void> {
  const artifactPath = path.join(root, "artifacts", "pi-utility-result.json");
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  const events: Record<string, unknown>[] = [];
  const host = new PiWorkerHost((event) => events.push(event.payload as Record<string, unknown>));
  const chinesePath = path.join(root, "artifacts", "文枢-M0-中文路径");
  await fs.mkdir(chinesePath, { recursive: true });
  host.start();
  await waitFor(() => host.status === "ready", 5000);
  const abortRunId = "utility-abort";
  host.run({ runId: abortRunId, prompt: "mock", mode: "mock", projectPath: chinesePath });
  await delay(30);
  host.abort(abortRunId);
  await waitFor(() => events.some((item) => item.type === "run.aborted"), 2000);
  host.crash();
  await waitFor(() => host.status === "crashed", 5000);
  const crashed = true;
  host.restart();
  await waitFor(() => host.status === "ready", 5000);
  const live = Boolean(process.env.DEEPSEEK_API_KEY);
  const liveRuns: Record<string, unknown>[] = [];
  if (live) {
    for (const [model, reasoning] of [["deepseek-v4-pro", "high"], ["deepseek-flash", "high"]] as const) {
      const runId = `tool-${model}`;
      host.run({ runId, prompt: "请严格完成两次工具调用后再回答：先调用工具传入‘第一次’，再调用工具传入‘第二次’。", model, reasoning, toolRoundTrip: true, projectPath: chinesePath });
      await waitFor(() => events.some((item) => item.type === "run.finished" && item.runId === runId), 180000);
      liveRuns.push({ model, reasoning, events: events.filter((item) => item.runId === runId) });
    }
  }
  host.stop();
  const liveRunsPassed = liveRuns.every((run) => {
    const runEvents = run.events as Array<{ type?: string }>;
    return runEvents.some((event) => event.type === "run.finished") && runEvents.filter((event) => event.type === "run.tool_execution_end").length >= 2;
  });
  const result = {
    spike: "pi-electron-utility-process",
    ok: events.some((item) => item.type === "run.aborted") && crashed && (!live || liveRunsPassed),
    electronUtilityProcess: true,
    chinesePath,
    abort: events.some((item) => item.type === "run.aborted"),
    crashRestart: crashed && events.some((item) => (item as { state?: string }).state === "crashed") && events.some((item) => (item as { state?: string }).state === "ready"),
    live: live ? "passed" : "not-run",
    liveRuns,
    events
  };
  await fs.writeFile(artifactPath, JSON.stringify(result, null, 2), "utf8");
  if (!result.ok && live) process.exitCode = 1;
  app.quit();
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#e7dfd2",
    webPreferences: { preload: path.join(path.dirname(fileURLToPath(import.meta.url)), "../preload/index.cjs"), contextIsolation: true, sandbox: true }
  });
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) await mainWindow.loadURL(rendererUrl);
  else await mainWindow.loadFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "../renderer/index.html"));
  worker.start();
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for utility process");
    await delay(25);
  }
}

app.whenReady().then(async () => {
  if (process.argv.includes("--wordhub-pi-spike")) return runUtilitySpike();
  registerIpc();
  await createWindow();
}).catch(async (error: unknown) => {
  console.error("[wordhub-main] startup failed", error);
  if (process.argv.includes("--wordhub-pi-spike")) {
    await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, "artifacts", "pi-utility-result.json"), JSON.stringify({ spike: "pi-electron-utility-process", ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  }
  app.exit(1);
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
