import { spawn, type ChildProcess } from "node:child_process";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

export interface LatexCompileOptions {
  projectRoot: string;
  mainFile: string;
  tectonicPath: string;
  cacheRoot: string;
  outputRoot: string;
  timeoutMs?: number;
  onlyCached?: boolean;
  spawnProcess?: typeof spawn;
}

export interface LatexCompileResult {
  pdfPath: string;
  logPath: string;
  synctexPath: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

const inside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

async function safeFile(root: string, relativePath: string): Promise<string> {
  if (path.isAbsolute(relativePath)) throw new Error("LaTeX 文件必须使用项目内相对路径");
  const target = path.resolve(root, relativePath);
  const realRoot = await realpath(root);
  const realTarget = await realpath(target);
  if (!inside(realRoot, realTarget)) throw new Error("LaTeX 文件必须位于项目目录内");
  const info = await lstat(realTarget);
  if (!info.isFile()) throw new Error("LaTeX 主文件必须是普通文件");
  return realTarget;
}

const collect = (child: ChildProcess): Promise<{ stdout: string; stderr: string; code: number }> =>
  new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (value) => (stdout += value));
    child.stderr?.setEncoding("utf8").on("data", (value) => (stderr += value));
    child.once("error", reject);
    child.once("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });

export async function compileLatex(options: LatexCompileOptions): Promise<LatexCompileResult> {
  const projectRoot = await realpath(options.projectRoot);
  const mainFile = await safeFile(projectRoot, options.mainFile);
  const cacheRoot = path.resolve(options.cacheRoot);
  const outputRoot = path.resolve(options.outputRoot);
  if (!inside(projectRoot, outputRoot)) throw new Error("编译输出目录必须位于项目目录内");
  await mkdir(cacheRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });

  const args = ["--untrusted", "--synctex", "--keep-logs", "--keep-intermediates"];
  if (options.onlyCached) args.push("--only-cached");
  args.push("-o", outputRoot, mainFile);
  const run = options.spawnProcess ?? spawn;
  const child = run(options.tectonicPath, args, {
    cwd: projectRoot,
    env: { ...process.env, TECTONIC_CACHE_DIR: cacheRoot },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const timeout = setTimeout(() => child.kill(), options.timeoutMs ?? 120_000);
  try {
    const result = await collect(child);
    const stem = path.basename(mainFile, path.extname(mainFile));
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
      pdfPath: path.join(outputRoot, `${stem}.pdf`),
      logPath: path.join(outputRoot, `${stem}.log`),
      synctexPath: path.join(outputRoot, `${stem}.synctex.gz`),
    };
  } finally {
    clearTimeout(timeout);
  }
}
