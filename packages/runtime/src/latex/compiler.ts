import { spawn, type ChildProcess } from "node:child_process";
import { lstat, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type LatexCompileStatus =
  | "succeeded"
  | "failed"
  | "timeout"
  | "aborted"
  | "missing-tool"
  | "offline-cache-miss";

export interface LatexCompileOptions {
  projectRoot: string;
  mainFile: string;
  tectonicPath: string;
  cacheRoot: string;
  timeoutMs?: number;
  onlyCached?: boolean;
  signal?: AbortSignal;
  spawnProcess?: typeof spawn;
}

export interface LatexCompileResult {
  status: LatexCompileStatus;
  /** 仅当 PDF 实际存在于磁盘时才有值。 */
  pdfPath?: string;
  /** 仅当日志文件存在时才有值。 */
  logPath?: string;
  /** 仅当 SyncTeX 文件存在时才有值。 */
  synctexPath?: string;
  /** status 为 missing-tool 时的外部工具名，例如 biber。 */
  missingTool?: string;
  stdout: string;
  stderr: string;
  /** stdout 或 stderr 超过上限被截断（保留尾部）。 */
  truncated: boolean;
  /** 被超时或中止杀死、或进程未能启动时为 null。 */
  exitCode: number | null;
  durationMs: number;
}

/** stdout 与 stderr 各自保留的最大字符数。 */
export const LATEX_OUTPUT_LIMIT = 1024 * 1024;

const inside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};

async function safeFile(root: string, relativePath: string): Promise<string> {
  if (path.isAbsolute(relativePath))
    throw new Error("LaTeX 文件必须使用项目内相对路径");
  const target = path.resolve(root, relativePath);
  const realRoot = await realpath(root);
  const realTarget = await realpath(target);
  if (!inside(realRoot, realTarget))
    throw new Error("LaTeX 文件必须位于项目目录内");
  const info = await lstat(realTarget);
  if (!info.isFile()) throw new Error("LaTeX 主文件必须是普通文件");
  return realTarget;
}

/** 输出目录固定为 <项目>/.wordhub/build/latex，且真实路径必须仍在项目内。 */
async function safeOutputDir(realRoot: string): Promise<string> {
  const wordhub = path.join(realRoot, ".wordhub");
  const build = path.join(wordhub, "build");
  const dir = path.join(build, "latex");
  // 先检查已存在的符号链接，避免 mkdir 穿过链接在项目外创建目录。
  for (const part of [wordhub, build, dir]) {
    const info = await lstat(part).catch(() => undefined);
    if (info?.isSymbolicLink()) throw new Error("编译输出目录不能是符号链接");
  }
  await mkdir(dir, { recursive: true });
  const realDir = await realpath(dir);
  if (!inside(realRoot, realDir) || realDir === realRoot)
    throw new Error("编译输出目录必须位于项目目录内");
  return realDir;
}

/** 只传 Tectonic 需要的环境变量，避免 API Key 等泄漏给子进程。 */
export function buildLatexEnv(cacheRoot: string): NodeJS.ProcessEnv {
  const keys = [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "LANG",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.TECTONIC_CACHE_DIR = cacheRoot;
  return env;
}

const appendTail = (current: string, chunk: string): [string, boolean] => {
  const next = current + chunk;
  return next.length > LATEX_OUTPUT_LIMIT
    ? [next.slice(next.length - LATEX_OUTPUT_LIMIT), true]
    : [next, false];
};

/**
 * 离线缓存缺失的启发式判断（仅在 onlyCached 且退出码非 0 时使用）。
 * 实测 Tectonic 0.17 在 --only-cached 下缺宏包时输出
 * “LaTeX Error: File `tikz-cd.sty' not found”；
 * 而 “note: using only cached resource files” 每次都会打印，不能作为依据。
 * 因此匹配“找不到文件”类错误，以及明确提到缓存缺失的措辞。
 * 排除 .tex 文件（多为用户项目里缺少的 input 文件，不是缓存问题）；其他缺失文件在离线下无法区分，按缓存缺失提示。
 */
const CACHE_MISS =
  /File `(?![^']*.tex')[^']+' not found|I can't find file|not (?:found )?in (?:the )?(?:local )?cache|only[- ]cached.*(?:fail|miss|not available|unavailable)/i;

/** Tectonic 外部工具失败：Running external tool X ... error: program not found。 */
const detectMissingTool = (output: string): string | undefined => {
  if (!/program not found/i.test(output)) return undefined;
  const match = /Running external tool\s+(\S+)/i.exec(output);
  return match?.[1];
};

const isFile = async (file: string): Promise<boolean> =>
  stat(file).then(
    (info) => info.isFile(),
    () => false,
  );

interface RunOutcome {
  stdout: string;
  stderr: string;
  truncated: boolean;
  code: number | null;
  reason: "exit" | "timeout" | "aborted";
}

const runChild = (
  child: ChildProcess,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RunOutcome> =>
  new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;
    let reason: RunOutcome["reason"] = "exit";
    const onAbort = () => stop("aborted");
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    function stop(why: "timeout" | "aborted") {
      if (settled) return;
      if (reason === "exit") reason = why;
      child.kill();
      // 被杀后 close 理应很快到来；万一没来（进程卡死或句柄未释放），宽限 5 秒后照样收尾，不让调用方永远等待。
      setTimeout(
        () =>
          finish(() =>
            resolve({ stdout, stderr, truncated, code: null, reason }),
          ),
        5000,
      ).unref?.();
    }
    child.stdout?.setEncoding("utf8").on("data", (value: string) => {
      const [next, cut] = appendTail(stdout, value);
      stdout = next;
      truncated ||= cut;
    });
    child.stderr?.setEncoding("utf8").on("data", (value: string) => {
      const [next, cut] = appendTail(stderr, value);
      stderr = next;
      truncated ||= cut;
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) =>
      finish(() => resolve({ stdout, stderr, truncated, code, reason })),
    );
  });

export async function compileLatex(
  options: LatexCompileOptions,
): Promise<LatexCompileResult> {
  const started = Date.now();
  const projectRoot = await realpath(options.projectRoot);
  const mainFile = await safeFile(projectRoot, options.mainFile);
  const cacheRoot = path.resolve(options.cacheRoot);
  const outputRoot = await safeOutputDir(projectRoot);
  await mkdir(cacheRoot, { recursive: true });

  if (options.signal?.aborted)
    return {
      status: "aborted",
      stdout: "",
      stderr: "",
      truncated: false,
      exitCode: null,
      durationMs: Date.now() - started,
    };

  const args = [
    "--untrusted",
    "--synctex",
    "--keep-logs",
    "--keep-intermediates",
  ];
  if (options.onlyCached) args.push("--only-cached");
  args.push("-o", outputRoot, mainFile);
  const run = options.spawnProcess ?? spawn;
  const child = run(options.tectonicPath, args, {
    cwd: projectRoot,
    env: buildLatexEnv(cacheRoot),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let outcome: RunOutcome;
  try {
    outcome = await runChild(
      child,
      options.timeoutMs ?? 120_000,
      options.signal,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        status: "missing-tool",
        missingTool: "tectonic",
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        truncated: false,
        exitCode: null,
        durationMs: Date.now() - started,
      };
    throw error;
  }

  const output = `${outcome.stdout}\n${outcome.stderr}`;
  const missingTool = detectMissingTool(output);
  let status: LatexCompileStatus;
  if (outcome.reason === "timeout") status = "timeout";
  else if (outcome.reason === "aborted") status = "aborted";
  else if (missingTool) status = "missing-tool";
  else if (outcome.code === 0) status = "succeeded";
  else if (options.onlyCached && CACHE_MISS.test(output))
    status = "offline-cache-miss";
  else status = "failed";

  const stem = path.basename(mainFile, path.extname(mainFile));
  const pdf = path.join(outputRoot, `${stem}.pdf`);
  const log = path.join(outputRoot, `${stem}.log`);
  const synctex = path.join(outputRoot, `${stem}.synctex.gz`);
  const hasPdf = status === "succeeded" && (await isFile(pdf));
  // 退出码为 0 却没有 PDF，不能算成功（界面会去预览一个不存在的文件）。
  if (status === "succeeded" && !hasPdf) status = "failed";
  return {
    status,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    truncated: outcome.truncated,
    exitCode: outcome.code,
    durationMs: Date.now() - started,
    ...(missingTool ? { missingTool } : {}),
    ...(hasPdf ? { pdfPath: pdf } : {}),
    ...((await isFile(log)) ? { logPath: log } : {}),
    ...(hasPdf && (await isFile(synctex)) ? { synctexPath: synctex } : {}),
  };
}
