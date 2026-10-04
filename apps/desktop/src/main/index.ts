import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
  AppEvent,
  CommandPayloads,
  CommandResults,
  ResolvedTheme,
  ThemePreference,
  WorkspaceCommand,
  WorkspaceSnapshot,
} from "@wordhub/contracts";
import { PiWorkerHost } from "./pi-worker-host.js";
import { ElectronCredentialStore } from "./credentials.js";

const root = path.resolve(
  process.env.WORDHUB_WORKSPACE_ROOT ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../"),
);
app.setName("WordHub");
console.error(`[wordhub-main] loaded ${process.argv.join(" ")}`);
let mainWindow: BrowserWindow | null = null;
let linkedFolder: string | null = null;
let projectName = "未命名项目";
let projectId: string | undefined;
let activeSessionId: string | undefined;
const worker = new PiWorkerHost((event) =>
  mainWindow?.webContents.send("wordhub:event", event),
);
const credentials = new ElectronCredentialStore();

// 自绘标题栏：窗口控制按钮由系统叠加绘制，颜色需与渲染进程的主题 token 保持一致。
const TITLEBAR_HEIGHT = 44;
const OVERLAY: Record<
  ResolvedTheme,
  { color: string; symbolColor: string; background: string }
> = {
  light: { color: "#F1EDE3", symbolColor: "#4A453D", background: "#F7F4EC" },
  dark: { color: "#1C1B18", symbolColor: "#BEB7AA", background: "#171614" },
};

function applyTheme(
  preference: ThemePreference,
  resolved: ResolvedTheme,
): void {
  nativeTheme.themeSource = preference;
  const tokens = OVERLAY[resolved];
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBackgroundColor(tokens.background);
  if (process.platform !== "darwin")
    mainWindow.setTitleBarOverlay({
      color: tokens.color,
      symbolColor: tokens.symbolColor,
      height: TITLEBAR_HEIGHT,
    });
}

function snapshot(): WorkspaceSnapshot {
  return {
    projectId,
    projectName,
    linkedFolder,
    activeSessionId,
    worker: worker.status,
  };
}

function registerIpc(): void {
  ipcMain.handle(
    "wordhub:invoke",
    async (
      _event,
      request: { command: WorkspaceCommand; payload: unknown },
    ) => {
      const command = request.command;
      if (command === "workspace.getSnapshot")
        return snapshot() as CommandResults["workspace.getSnapshot"];
      if (command === "workspace.chooseFolder") {
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
        });
        linkedFolder = result.canceled ? null : (result.filePaths[0] ?? null);
        if (linkedFolder) {
          projectName = path.basename(linkedFolder);
          const created = await worker.request<{
            id: string;
            name: string;
            folderPath: string;
            sessionId: string;
          }>({
            type: "project.create",
            name: projectName,
            folderPath: linkedFolder,
          });
          projectId = created.id;
          activeSessionId = created.sessionId;
        }
        return {
          path: linkedFolder,
          projectId,
          sessionId: activeSessionId,
        } as CommandResults["workspace.chooseFolder"];
      }
      if (command === "project.listRecent")
        return await worker.request<CommandResults["project.listRecent"]>({
          type: "project.listRecent",
        });
      if (command === "session.list") {
        const payload = request.payload as CommandPayloads["session.list"];
        return await worker.request<CommandResults["session.list"]>({
          type: "session.list",
          projectId: payload.projectId,
        });
      }
      if (command === "session.create") {
        const payload = request.payload as CommandPayloads["session.create"];
        const result = await worker.request<CommandResults["session.create"]>({
          type: "session.create",
          projectId: payload.projectId,
          title: payload.title,
          sessionId: payload.sessionId,
        });
        activeSessionId = result.session.id;
        return result;
      }
      if (command === "session.rename") {
        const payload = request.payload as CommandPayloads["session.rename"];
        return await worker.request<CommandResults["session.rename"]>({
          type: "session.rename",
          projectId: payload.projectId,
          sessionId: payload.sessionId,
          title: payload.title,
        });
      }
      if (command === "chat.list") {
        const payload = request.payload as CommandPayloads["chat.list"];
        return await worker.request<CommandResults["chat.list"]>({
          type: "chat.list",
          projectId: payload.projectId,
          sessionId: payload.sessionId,
        });
      }
      if (command === "run.start") {
        const payload = request.payload as CommandPayloads["run.start"];
        const runId = payload.runId ?? `run_${Date.now().toString(36)}`;
        if (!projectId && (payload.projectPath ?? linkedFolder)) {
          const folder = payload.projectPath ?? linkedFolder!;
          const created = await worker.request<{
            id: string;
            sessionId: string;
            name: string;
            folderPath: string;
          }>({
            type: "project.create",
            name: path.basename(folder),
            folderPath: folder,
          });
          projectId = created.id;
          linkedFolder = created.folderPath;
          projectName = created.name;
          activeSessionId = created.sessionId;
        }
        const sessionId = payload.sessionId ?? activeSessionId;
        worker.run({
          runId,
          prompt: payload.prompt,
          rawPrompt: payload.rawPrompt,
          agentId: payload.agentId,
          mentions: payload.mentions,
          apiKey: await credentials.resolve("deepseek"),
          mode: process.env.WORDHUB_MOCK === "1" ? "mock" : "live",
          projectPath: payload.projectPath ?? linkedFolder ?? undefined,
          projectId: payload.projectId ?? projectId,
          sessionId,
        });
        return { runId, projectId, sessionId } as CommandResults["run.start"];
      }
      if (command === "run.estimate") {
        const payload = request.payload as CommandPayloads["run.estimate"];
        return await worker.request<CommandResults["run.estimate"]>({
          type: "run.estimate",
          prompt: payload.prompt,
          agentId: payload.agentId,
          projectPath: payload.projectPath ?? linkedFolder ?? undefined,
        });
      }
      if (command === "run.abort") {
        const payload = request.payload as CommandPayloads["run.abort"];
        worker.abort(payload.runId);
        return {
          runId: payload.runId,
          aborted: true,
        } as CommandResults["run.abort"];
      }
      if (command === "run.approve") {
        const payload = request.payload as CommandPayloads["run.approve"];
        return await worker.request<CommandResults["run.approve"]>({
          type: "run.approve",
          runId: payload.runId,
          approved: payload.approved,
          apiKey: await credentials.resolve("deepseek"),
        });
      }
      if (command === "settings.credentialStatus") {
        return {
          provider: "deepseek",
          configured: (await credentials.source("deepseek")) !== "none",
          source: await credentials.source("deepseek"),
          encryptionAvailable: credentials.encryptionAvailable(),
        } as CommandResults["settings.credentialStatus"];
      }
      if (command === "settings.setCredential") {
        const payload =
          request.payload as CommandPayloads["settings.setCredential"];
        if (!payload.secret.trim()) throw new Error("密钥不能为空");
        await credentials.set(payload.provider, payload.secret.trim());
        return { saved: true } as CommandResults["settings.setCredential"];
      }
      if (command === "settings.models") {
        return await worker.request<CommandResults["settings.models"]>({
          type: "settings.models",
          projectPath: linkedFolder ?? undefined,
        });
      }
      if (command === "settings.setAgentModel") {
        const payload =
          request.payload as CommandPayloads["settings.setAgentModel"];
        return await worker.request<CommandResults["settings.setAgentModel"]>({
          type: "settings.setAgentModel",
          projectPath: linkedFolder ?? undefined,
          agentId: payload.agentId,
          model: payload.model as {
            provider: string;
            id: string;
            reasoning:
              | "off"
              | "minimal"
              | "low"
              | "medium"
              | "high"
              | "xhigh"
              | "max";
          },
        });
      }
      if (command === "settings.testConnection") {
        const payload =
          request.payload as CommandPayloads["settings.testConnection"];
        return await worker.request<CommandResults["settings.testConnection"]>({
          type: "settings.testConnection",
          provider: payload.provider,
          apiKey: await credentials.resolve(payload.provider),
        });
      }
      if (command === "app.setTheme") {
        const payload = request.payload as CommandPayloads["app.setTheme"];
        applyTheme(payload.preference, payload.resolved);
        return { applied: true } as CommandResults["app.setTheme"];
      }
      worker.restart();
      return { worker: worker.status } as CommandResults["run.restartWorker"];
    },
  );
}

async function runUtilitySpike(): Promise<void> {
  const artifactPath = path.join(root, "artifacts", "pi-utility-result.json");
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  const events: Record<string, unknown>[] = [];
  const host = new PiWorkerHost((event) =>
    events.push(event.payload as Record<string, unknown>),
  );
  const chinesePath = path.join(root, "artifacts", "文枢-M0-中文路径");
  await fs.mkdir(chinesePath, { recursive: true });
  host.start();
  await waitFor(() => host.status === "ready", 5000);
  const abortRunId = "utility-abort";
  host.run({
    runId: abortRunId,
    prompt: "mock",
    mode: "mock",
    projectPath: chinesePath,
  });
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
    for (const [model, reasoning] of [
      ["deepseek-v4-pro", "high"],
      ["deepseek-flash", "high"],
    ] as const) {
      const runId = `tool-${model}`;
      host.run({
        runId,
        prompt:
          "请严格完成两次工具调用后再回答：先调用工具传入‘第一次’，再调用工具传入‘第二次’。",
        model,
        reasoning,
        toolRoundTrip: true,
        projectPath: chinesePath,
      });
      await waitFor(
        () =>
          events.some(
            (item) => item.type === "run.finished" && item.runId === runId,
          ),
        180000,
      );
      liveRuns.push({
        model,
        reasoning,
        events: events.filter((item) => item.runId === runId),
      });
    }
  }
  host.stop();
  const liveRunsPassed = liveRuns.every((run) => {
    const runEvents = run.events as Array<{ type?: string }>;
    return (
      runEvents.some((event) => event.type === "run.finished") &&
      runEvents.filter((event) => event.type === "run.tool_execution_end")
        .length >= 2
    );
  });
  const result = {
    spike: "pi-electron-utility-process",
    ok:
      events.some((item) => item.type === "run.aborted") &&
      crashed &&
      (!live || liveRunsPassed),
    electronUtilityProcess: true,
    chinesePath,
    abort: events.some((item) => item.type === "run.aborted"),
    crashRestart:
      crashed &&
      events.some((item) => (item as { state?: string }).state === "crashed") &&
      events.some((item) => (item as { state?: string }).state === "ready"),
    live: live ? "passed" : "not-run",
    liveRuns,
    events,
  };
  await fs.writeFile(artifactPath, JSON.stringify(result, null, 2), "utf8");
  if (!result.ok && live) process.exitCode = 1;
  app.quit();
}

async function createWindow(): Promise<void> {
  const initial = OVERLAY[nativeTheme.shouldUseDarkColors ? "dark" : "light"];
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: initial.background,
    title: "文枢 · WordHub",
    titleBarStyle: "hidden",
    titleBarOverlay:
      process.platform === "darwin"
        ? undefined
        : {
            color: initial.color,
            symbolColor: initial.symbolColor,
            height: TITLEBAR_HEIGHT,
          },
    webPreferences: {
      preload: path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../preload/index.cjs",
      ),
      contextIsolation: true,
      sandbox: true,
    },
  });
  // 渲染进程只加载应用自身页面；外链一律拒绝，避免被注入内容带走窗口。
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? "file://"))
      event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const query = process.env.WORDHUB_DEMO === "1" ? { demo: "1" } : undefined;
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl)
    await mainWindow.loadURL(query ? `${rendererUrl}?demo=1` : rendererUrl);
  else
    await mainWindow.loadFile(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../renderer/index.html",
      ),
      { query },
    );
  worker.setStorageRoot(app.getPath("userData"));
  worker.start();
  void restoreRecentProject();
}

async function restoreRecentProject(): Promise<void> {
  try {
    await waitFor(() => worker.status === "ready", 5000);
    const recent = await worker.request<CommandResults["project.listRecent"]>({
      type: "project.listRecent",
    });
    const project = recent.projects[0];
    if (!project) return;
    projectId = project.id;
    projectName = project.name;
    linkedFolder = project.folderPath;
    const sessions = await worker.request<CommandResults["session.list"]>({
      type: "session.list",
      projectId: project.id,
    });
    activeSessionId = sessions.sessions[0]?.id;
    mainWindow?.webContents.send("wordhub:event", {
      type: "workspace.snapshot",
      payload: snapshot(),
    } satisfies AppEvent);
  } catch (error) {
    console.error("[wordhub-main] restore recent project failed", error);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error("timed out waiting for utility process");
    await delay(25);
  }
}

app
  .whenReady()
  .then(async () => {
    if (process.argv.includes("--wordhub-pi-spike")) return runUtilitySpike();
    registerIpc();
    await createWindow();
  })
  .catch(async (error: unknown) => {
    console.error("[wordhub-main] startup failed", error);
    if (process.argv.includes("--wordhub-pi-spike")) {
      await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
      await fs.writeFile(
        path.join(root, "artifacts", "pi-utility-result.json"),
        JSON.stringify(
          {
            spike: "pi-electron-utility-process",
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
          null,
          2,
        ),
      );
    }
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
