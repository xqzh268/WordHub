import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import type {
  CommandPayloads,
  LatexCompileResultPayload,
  LatexEngineStatusPayload,
  LatexInstallProgress,
  LatexTrustPayload,
} from "@wordhub/contracts";
import type { WordHubStore } from "@wordhub/store";
import { compileLatex, type LatexCompileResult } from "./compiler.js";
import { parseLatexDiagnostics } from "./diagnostics.js";
import {
  clearEngineCache,
  getEngineStatus,
  installEngine,
  type EngineStatus,
} from "./engine.js";
import {
  listLatexFiles,
  isLatexSourceFile,
  normalizeLatexPath,
  readLatexFile,
  setLatexMainFile,
  writeLatexFile,
} from "./files.js";
import { createLatexPdfPreviewStore } from "./pdf-preview.js";
import { findOutsidePaths } from "./sanitize.js";
import {
  mapPdfToSource,
  mapSourceToPdf,
  resolveSyncTeXPath,
} from "./synctex.js";
import { LatexTrustStore, isFreshFolder } from "./trust.js";

/** 返回给界面的日志尾部上限（字符）。 */
export const LATEX_UI_LOG_LIMIT = 20_000;
/** 冷启动会下载宏包 bundle，实测首次编译约 4 分钟，超时放宽到 10 分钟。 */
export const LATEX_COMPILE_TIMEOUT_MS = 600_000;

export interface LatexServiceDeps {
  storageRoot: string;
  /** 取项目登记的链接文件夹；项目不存在时抛错。 */
  projectFolder: (projectId: string) => string;
  projectStore: (projectId: string) => Promise<WordHubStore>;
  post: (message: Record<string, unknown>) => void;
  /** 以下仅供测试注入。 */
  compile?: typeof compileLatex;
  install?: typeof installEngine;
  engineStatus?: typeof getEngineStatus;
  clearCache?: typeof clearEngineCache;
}

export interface LatexCompileRequest {
  projectId: string;
  mainFile: string;
  /** 主进程在测试模式下传入的假引擎路径；正式运行永远不会设置。 */
  tectonicOverride?: string;
}

const tail = (text: string, limit: number): string =>
  text.length > limit ? text.slice(text.length - limit) : text;

export function createLatexService(deps: LatexServiceDeps) {
  const engineRoot = path.join(deps.storageRoot, "engines");
  const trust = new LatexTrustStore(deps.storageRoot);
  const pdfPreviews = createLatexPdfPreviewStore(deps.storageRoot);
  const compile = deps.compile ?? compileLatex;
  const install = deps.install ?? installEngine;
  const statusOf = deps.engineStatus ?? getEngineStatus;
  const clearCache = deps.clearCache ?? clearEngineCache;
  let installing: AbortController | undefined;
  /**
   * 每个项目同一时间只允许一个编译：新请求会中止进行中的旧请求（旧请求返回 aborted），
   * 等旧进程完全退出后再开始，避免两个进程同时写同一个输出目录。
   */
  const inflight = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  const mainFileWrites = new Map<string, Promise<unknown>>();

  const toPayload = (status: EngineStatus): LatexEngineStatusPayload => ({
    state: status.state,
    version: status.version,
    cacheDir: status.cacheDir,
    cacheBytes: status.cacheBytes,
    installing: installing !== undefined,
  });

  const emptyResult = (
    status: LatexCompileResultPayload["status"],
    message: string,
    extra: Partial<LatexCompileResultPayload> = {},
  ): LatexCompileResultPayload => ({
    status,
    message,
    exitCode: null,
    durationMs: 0,
    truncated: false,
    log: "",
    diagnostics: [],
    readOutsideProject: false,
    outsidePaths: [],
    ...extra,
  });

  const toCompilePayload = async (
    result: LatexCompileResult,
    projectRoot: string,
  ): Promise<LatexCompileResultPayload> => {
    const streams = [result.stdout, result.stderr].filter(Boolean);
    const combined = streams.join("\n");
    const outsidePaths = findOutsidePaths(combined, projectRoot);
    return {
      status: result.status,
      ...(result.missingTool ? { missingTool: result.missingTool } : {}),
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      truncated: result.truncated,
      log: tail(combined, LATEX_UI_LOG_LIMIT),
      diagnostics: await parseLatexDiagnostics(streams, projectRoot),
      readOutsideProject: outsidePaths.length > 0,
      outsidePaths,
    };
  };

  return {
    engineRoot,
    trust,
    async engineStatus(): Promise<LatexEngineStatusPayload> {
      return toPayload(await statusOf(engineRoot));
    },
    async installEngine(): Promise<{
      canceled: boolean;
      status: LatexEngineStatusPayload;
    }> {
      if (installing) throw new Error("LaTeX 引擎正在安装，请等待完成或先取消");
      const controller = new AbortController();
      installing = controller;
      let lastPost = 0;
      try {
        const status = await install({
          engineRoot,
          signal: controller.signal,
          onProgress: (progress) => {
            // 下载分块很碎，限制到约每 100ms 一条；最后一块总是发送。
            const now = Date.now();
            const last = progress.receivedBytes >= progress.totalBytes;
            if (!last && now - lastPost < 100) return;
            lastPost = now;
            deps.post({
              type: "latex.installProgress",
              receivedBytes: progress.receivedBytes,
              totalBytes: progress.totalBytes,
            } satisfies LatexInstallProgress);
          },
        });
        installing = undefined;
        return { canceled: false, status: toPayload(status) };
      } catch (error) {
        const canceled =
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError");
        installing = undefined;
        if (!canceled) throw error;
        return {
          canceled: true,
          status: toPayload(await statusOf(engineRoot)),
        };
      }
    },
    cancelInstall(): { canceled: boolean } {
      if (!installing) return { canceled: false };
      installing.abort();
      return { canceled: true };
    },
    async clearCache(): Promise<LatexEngineStatusPayload> {
      if (inflight.size > 0)
        throw new Error("有编译正在进行，请稍后再清理缓存");
      await clearCache(engineRoot);
      return toPayload(await statusOf(engineRoot));
    },
    async files(projectId: string) {
      return listLatexFiles(deps.projectFolder(projectId));
    },
    async readPdf(projectId: string) {
      return pdfPreviews.read(projectId, deps.projectFolder(projectId));
    },
    /** 将项目内源码行定位到最近的 PDF 锚点。 */
    async syncSourceToPdf(request: CommandPayloads["latex.syncSourceToPdf"]) {
      const folder = deps.projectFolder(request.projectId);
      const synctexPath = await resolveSyncTeXPath(folder, request.mainFile);
      const relativePath = normalizeLatexPath(request.relativePath);
      if (!isLatexSourceFile(relativePath))
        throw new Error("SyncTeX 源码路径无效");
      if (!Number.isInteger(request.line) || request.line <= 0)
        throw new Error("SyncTeX 源码行号无效");
      return mapSourceToPdf(folder, synctexPath, {
        relativePath,
        line: request.line,
        column: request.column,
      });
    },
    /** 将 PDF 页面的坐标定位到项目内源码行。 */
    async syncPdfToSource(request: CommandPayloads["latex.syncPdfToSource"]) {
      const folder = deps.projectFolder(request.projectId);
      const synctexPath = await resolveSyncTeXPath(folder, request.mainFile);
      if (!Number.isInteger(request.page) || request.page <= 0)
        throw new Error("SyncTeX PDF 页码无效");
      if (!Number.isFinite(request.x) || !Number.isFinite(request.y))
        throw new Error("SyncTeX PDF 坐标无效");
      return mapPdfToSource(folder, synctexPath, {
        page: request.page,
        x: request.x,
        y: request.y,
      });
    },
    async readFile(projectId: string, relativePath: string) {
      return readLatexFile(deps.projectFolder(projectId), relativePath);
    },
    async writeFile(request: CommandPayloads["latex.writeFile"]) {
      const folder = deps.projectFolder(request.projectId);
      return writeLatexFile(
        folder,
        await deps.projectStore(request.projectId),
        request,
      );
    },
    async setMainFile(projectId: string, mainFile: string) {
      const folder = deps.projectFolder(projectId);
      const resolved = path.resolve(folder);
      const key =
        process.platform === "win32" ? resolved.toLowerCase() : resolved;
      const previous = mainFileWrites.get(key) ?? Promise.resolve();
      const saving = previous
        .catch(() => undefined)
        .then(() => setLatexMainFile(folder, mainFile));
      mainFileWrites.set(key, saving);
      try {
        return await saving;
      } finally {
        if (mainFileWrites.get(key) === saving) mainFileWrites.delete(key);
      }
    },
    async trustStatus(projectId: string): Promise<LatexTrustPayload> {
      return trust.status(projectId, deps.projectFolder(projectId));
    },
    async setTrust(
      projectId: string,
      trusted: boolean,
    ): Promise<LatexTrustPayload> {
      // 撤销信任时，进行中的编译立即中止。
      if (!trusted) inflight.get(projectId)?.controller.abort();
      return trust.set(
        projectId,
        deps.projectFolder(projectId),
        trusted,
        "user",
      );
    },
    /** 项目刚被链接：只有在 WordHub 内新建的学术项目（空文件夹）才默认信任。 */
    async noteProjectLinked(
      project: { id: string; kind: string; folderPath: string },
      fresh: boolean,
    ): Promise<void> {
      if (fresh && project.kind === "academic")
        await trust.set(project.id, project.folderPath, true, "created");
    },
    isFreshFolder,
    async compile(
      request: LatexCompileRequest,
    ): Promise<LatexCompileResultPayload> {
      const folder = deps.projectFolder(request.projectId);
      const state = await trust.status(request.projectId, folder);
      if (!state.trusted) {
        await pdfPreviews.markStale(request.projectId, folder, "untrusted");
        return emptyResult(
          "untrusted",
          "此项目尚未被信任。LaTeX 编译可读写项目外的文件，请确认来源可靠后再信任。",
        );
      }
      let tectonicPath = request.tectonicOverride;
      if (!tectonicPath) {
        const engine = await statusOf(engineRoot);
        if (engine.state !== "ready" || !engine.executablePath) {
          await pdfPreviews.markStale(
            request.projectId,
            folder,
            "missing-tool",
          );
          return emptyResult(
            "missing-tool",
            engine.state === "corrupt"
              ? "LaTeX 引擎已损坏，请在设置中重新安装。"
              : "尚未安装 LaTeX 引擎，请在设置中安装。",
            { missingTool: "tectonic" },
          );
        }
        tectonicPath = engine.executablePath;
      }
      const projectRoot = await realpath(folder);

      const previous = inflight.get(request.projectId);
      previous?.controller.abort();
      const controller = new AbortController();
      let release: () => void = () => undefined;
      const entry = {
        controller,
        done: new Promise<void>((resolve) => {
          release = resolve;
        }),
      };
      inflight.set(request.projectId, entry);
      try {
        await previous?.done;
        if (controller.signal.aborted)
          return emptyResult("aborted", "已被新的编译请求取代");
        // 测试用假引擎是 JS 脚本：借当前可执行文件以 Node 模式运行。
        const script = /\.(?:mjs|cjs|js)$/iu.test(tectonicPath);
        const spawnProcess = script
          ? (((command: string, args: readonly string[], options: object) =>
              spawn(process.execPath, [command, ...args], {
                ...options,
                env: {
                  ...(options as { env?: NodeJS.ProcessEnv }).env,
                  ELECTRON_RUN_AS_NODE: "1",
                },
              })) as unknown as typeof spawn)
          : undefined;
        const result = await compile({
          projectRoot,
          mainFile: request.mainFile,
          tectonicPath,
          cacheRoot: path.join(engineRoot, "tectonic-cache"),
          timeoutMs: LATEX_COMPILE_TIMEOUT_MS,
          signal: controller.signal,
          ...(spawnProcess ? { spawnProcess } : {}),
        });
        const payload = await toCompilePayload(result, projectRoot);
        if (
          result.status === "succeeded" &&
          result.pdfPath &&
          (await pdfPreviews.recordSuccess(
            request.projectId,
            folder,
            request.mainFile,
            result.pdfPath,
          ))
        )
          return payload;
        await pdfPreviews.markStale(
          request.projectId,
          folder,
          result.status === "succeeded" ? "failed" : result.status,
        );
        return payload;
      } catch (error) {
        await pdfPreviews.markStale(
          request.projectId,
          folder,
          controller.signal.aborted ? "aborted" : "failed",
        );
        throw error;
      } finally {
        release();
        if (inflight.get(request.projectId) === entry)
          inflight.delete(request.projectId);
      }
    },
    abort(projectId: string): { aborted: boolean } {
      const entry = inflight.get(projectId);
      if (!entry) return { aborted: false };
      entry.controller.abort();
      return { aborted: true };
    },
  };
}

export type LatexService = ReturnType<typeof createLatexService>;
