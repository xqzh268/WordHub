import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileLatex, LATEX_OUTPUT_LIMIT } from "./compiler.js";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill = vi.fn(() => {
    this.killed = true;
    // 模拟被杀后进程关闭。
    setImmediate(() => this.emit("close", null));
    return true;
  });
  finish(code: number, out = "", err = "") {
    if (out) this.stdout.write(out);
    if (err) this.stderr.write(err);
    setImmediate(() => this.emit("close", code));
  }
}

interface Call {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  child: FakeChild;
}

const makeSpawn = (onSpawn?: (child: FakeChild) => void) => {
  const calls: Call[] = [];
  const fake = ((
    command: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv },
  ) => {
    const child = new FakeChild();
    calls.push({ command, args, env: options.env, child });
    setImmediate(() => onSpawn?.(child));
    return child;
  }) as unknown as typeof spawn;
  return { fake, calls };
};

let root: string;
let cache: string;
let outside: string;

beforeEach(async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "wh-latex-"));
  root = path.join(base, "项目");
  cache = path.join(base, "cache");
  outside = path.join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(path.join(root, "main.tex"), "\\documentclass{article}");
  await writeFile(path.join(outside, "evil.tex"), "x");
});

afterEach(async () => {
  await rm(path.dirname(root), { recursive: true, force: true });
});

const base = () => ({
  projectRoot: root,
  mainFile: "main.tex",
  tectonicPath: "tectonic",
  cacheRoot: cache,
});

describe("compileLatex 路径检查", () => {
  it("拒绝绝对路径主文件", async () => {
    const { fake } = makeSpawn();
    await expect(
      compileLatex({
        ...base(),
        mainFile: path.join(root, "main.tex"),
        spawnProcess: fake,
      }),
    ).rejects.toThrow("相对路径");
  });

  it("拒绝 .. 逃逸", async () => {
    const { fake } = makeSpawn();
    await expect(
      compileLatex({
        ...base(),
        mainFile: "../outside/evil.tex",
        spawnProcess: fake,
      }),
    ).rejects.toThrow("项目目录内");
  });

  it("拒绝指向项目外的符号链接主文件", async () => {
    try {
      await symlink(
        path.join(outside, "evil.tex"),
        path.join(root, "link.tex"),
        "file",
      );
    } catch {
      return; // Windows 无符号链接权限时跳过
    }
    const { fake } = makeSpawn();
    await expect(
      compileLatex({ ...base(), mainFile: "link.tex", spawnProcess: fake }),
    ).rejects.toThrow("项目目录内");
  });

  it("拒绝非普通文件", async () => {
    await mkdir(path.join(root, "dir.tex"));
    const { fake } = makeSpawn();
    await expect(
      compileLatex({ ...base(), mainFile: "dir.tex", spawnProcess: fake }),
    ).rejects.toThrow("普通文件");
  });

  it("拒绝指向项目外的 .wordhub 符号链接", async () => {
    try {
      await symlink(outside, path.join(root, ".wordhub"), "junction");
    } catch {
      return;
    }
    const { fake, calls } = makeSpawn();
    await expect(
      compileLatex({ ...base(), spawnProcess: fake }),
    ).rejects.toThrow("符号链接");
    expect(calls).toHaveLength(0);
  });

  it("输出目录固定在 .wordhub/build/latex", async () => {
    const { fake, calls } = makeSpawn((c) => c.finish(0));
    await compileLatex({ ...base(), spawnProcess: fake });
    const args = calls[0]!.args;
    const out = args[args.indexOf("-o") + 1] ?? "";
    expect(out.endsWith(path.join(".wordhub", "build", "latex"))).toBe(true);
  });
});

describe("compileLatex 状态", () => {
  it("成功并返回存在的 pdf", async () => {
    const { fake } = makeSpawn(async (c) => {
      const out = path.join(root, ".wordhub", "build", "latex");
      await writeFile(path.join(out, "main.pdf"), "pdf");
      await writeFile(path.join(out, "main.log"), "log");
      c.finish(0, "ok");
    });
    const result = await compileLatex({ ...base(), spawnProcess: fake });
    expect(result.status).toBe("succeeded");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(result.pdfPath?.endsWith("main.pdf")).toBe(true);
    expect(result.logPath?.endsWith("main.log")).toBe(true);
    expect(result.synctexPath).toBeUndefined();
    expect(result.truncated).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("失败", async () => {
    const { fake } = makeSpawn((c) => c.finish(1, "", "error: boom"));
    const result = await compileLatex({ ...base(), spawnProcess: fake });
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.pdfPath).toBeUndefined();
  });

  it("超时会杀死子进程", async () => {
    const { fake, calls } = makeSpawn();
    const result = await compileLatex({
      ...base(),
      timeoutMs: 20,
      spawnProcess: fake,
    });
    expect(result.status).toBe("timeout");
    expect(calls[0]!.child.kill).toHaveBeenCalledTimes(1);
  });

  it("启动前已中止则不启动进程", async () => {
    const { fake, calls } = makeSpawn();
    const controller = new AbortController();
    controller.abort();
    const result = await compileLatex({
      ...base(),
      signal: controller.signal,
      spawnProcess: fake,
    });
    expect(result.status).toBe("aborted");
    expect(calls).toHaveLength(0);
  });

  it("运行中中止会杀死子进程", async () => {
    const { fake, calls } = makeSpawn();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const result = await compileLatex({
      ...base(),
      signal: controller.signal,
      spawnProcess: fake,
    });
    expect(result.status).toBe("aborted");
    expect(calls[0]!.child.kill).toHaveBeenCalledTimes(1);
  });

  it("缺少 biber", async () => {
    const { fake } = makeSpawn((c) =>
      c.finish(
        1,
        "note: Running external tool biber\n",
        "error: program not found\n",
      ),
    );
    const result = await compileLatex({ ...base(), spawnProcess: fake });
    expect(result.status).toBe("missing-tool");
    expect(result.missingTool).toBe("biber");
  });

  it("离线缓存缺失", async () => {
    const fixture =
      "note: using only cached resource files\n" +
      "error: main.tex:3: ! LaTeX Error: File `tikz-cd.sty' not found.\n";
    const { fake } = makeSpawn((c) => c.finish(1, "", fixture));
    const result = await compileLatex({
      ...base(),
      onlyCached: true,
      spawnProcess: fake,
    });
    expect(result.status).toBe("offline-cache-miss");
  });

  it("未启用 onlyCached 时同样输出只算失败", async () => {
    const { fake } = makeSpawn((c) =>
      c.finish(1, "", "! LaTeX Error: File `a.sty' not found."),
    );
    const result = await compileLatex({ ...base(), spawnProcess: fake });
    expect(result.status).toBe("failed");
  });

  it("onlyCached 下普通错误仍是失败", async () => {
    const { fake } = makeSpawn((c) =>
      c.finish(
        1,
        "",
        "note: using only cached resource files\nerror: Undefined control sequence",
      ),
    );
    const result = await compileLatex({
      ...base(),
      onlyCached: true,
      spawnProcess: fake,
    });
    expect(result.status).toBe("failed");
  });
});

describe("compileLatex 进程参数", () => {
  it("环境变量最小化且带缓存目录", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-secret");
    try {
      const { fake, calls } = makeSpawn((c) => c.finish(0));
      await compileLatex({ ...base(), spawnProcess: fake });
      const env = calls[0]!.env;
      expect(env.DEEPSEEK_API_KEY).toBeUndefined();
      expect(JSON.stringify(env)).not.toContain("sk-secret");
      expect(env.TECTONIC_CACHE_DIR).toBe(path.resolve(cache));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("参数包含 --untrusted --synctex，按需 --only-cached", async () => {
    const first = makeSpawn((c) => c.finish(0));
    await compileLatex({ ...base(), spawnProcess: first.fake });
    expect(first.calls[0]!.args).toContain("--untrusted");
    expect(first.calls[0]!.args).toContain("--synctex");
    expect(first.calls[0]!.args).not.toContain("--only-cached");

    const second = makeSpawn((c) => c.finish(0));
    await compileLatex({
      ...base(),
      onlyCached: true,
      spawnProcess: second.fake,
    });
    expect(second.calls[0]!.args).toContain("--only-cached");
  });

  it("输出超过上限时保留尾部并标记截断", async () => {
    const big = `${"a".repeat(LATEX_OUTPUT_LIMIT)}${"b".repeat(100)}`;
    const { fake } = makeSpawn((c) => c.finish(1, big, "short"));
    const result = await compileLatex({ ...base(), spawnProcess: fake });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBe(LATEX_OUTPUT_LIMIT);
    expect(result.stdout.endsWith("b".repeat(100))).toBe(true);
    expect(result.stderr).toBe("short");
  });
});

describe("compileLatex 缓存缺失误判", () => {
  it("onlyCached 下缺少用户的 .tex 文件算普通失败", async () => {
    const { fake } = makeSpawn((c) =>
      c.finish(
        1,
        "",
        "error: main.tex:6: ! LaTeX Error: File `parts/chapter.tex' not found.",
      ),
    );
    const result = await compileLatex({
      ...base(),
      onlyCached: true,
      spawnProcess: fake,
    });
    expect(result.status).toBe("failed");
  });
});
