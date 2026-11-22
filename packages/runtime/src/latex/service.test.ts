import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LatexCompileOptions, LatexCompileResult } from "./compiler.js";
import type { EngineStatus } from "./engine.js";
import { createLatexService } from "./service.js";

let base: string;
let storage: string;
let project: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "wh-latex-svc-"));
  storage = path.join(base, "appdata");
  project = path.join(base, "论文");
  await mkdir(project);
  await writeFile(path.join(project, "main.tex"), "\\documentclass{article}");
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const ready: EngineStatus = {
  state: "ready",
  version: "0.17.0",
  executablePath: "tectonic",
  cacheDir: "c",
  cacheBytes: 0,
};
const done = (patch: Partial<LatexCompileResult> = {}): LatexCompileResult => ({
  status: "succeeded",
  stdout: "",
  stderr: "",
  truncated: false,
  exitCode: 0,
  durationMs: 1,
  ...patch,
});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const request = { projectId: "p1", mainFile: "main.tex" };

const make = (
  compile: (options: LatexCompileOptions) => Promise<LatexCompileResult>,
) =>
  createLatexService({
    storageRoot: storage,
    projectFolder: (id) => {
      if (id !== "p1" && id !== "p2") throw new Error("项目不存在");
      return project;
    },
    post: vi.fn(),
    compile,
    engineStatus: async () => ready,
  });

describe("latex.compile 信任门", () => {
  it("未信任项目被拒绝，不会启动编译", async () => {
    const compile = vi.fn(async () => done());
    const service = make(compile);
    const result = await service.compile(request);
    expect(result.status).toBe("untrusted");
    expect(result.message).toContain("信任");
    expect(compile).not.toHaveBeenCalled();
  });

  it("信任后可编译，撤销后再次被拒绝", async () => {
    const compile = vi.fn(async () => done());
    const service = make(compile);
    await service.setTrust("p1", true);
    expect((await service.compile(request)).status).toBe("succeeded");
    await service.setTrust("p1", false);
    expect((await service.compile(request)).status).toBe("untrusted");
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it("只有空文件夹新建的学术项目默认信任", async () => {
    const service = make(async () => done());
    const link = (kind: string, fresh: boolean) =>
      service.noteProjectLinked({ id: "p1", kind, folderPath: project }, fresh);
    await link("novel", true);
    expect((await service.trustStatus("p1")).trusted).toBe(false);
    await link("academic", false);
    expect((await service.trustStatus("p1")).trusted).toBe(false);
    await link("academic", true);
    expect(await service.trustStatus("p1")).toMatchObject({
      trusted: true,
      reason: "created",
    });
  });

  it("引擎未安装时给出 missing-tool", async () => {
    const service = createLatexService({
      storageRoot: storage,
      projectFolder: () => project,
      post: vi.fn(),
      compile: vi.fn(),
      engineStatus: async () => ({
        ...ready,
        state: "missing",
        executablePath: undefined,
      }),
    });
    await service.setTrust("p1", true);
    const result = await service.compile(request);
    expect(result).toMatchObject({
      status: "missing-tool",
      missingTool: "tectonic",
    });
  });

  it("读取项目外文件时上报路径并设置 readOutsideProject", async () => {
    const outside = path.resolve("/etc/passwd");
    const service = make(async () =>
      done({ stdout: `warning: accessing absolute path \`${outside}\`` }),
    );
    await service.setTrust("p1", true);
    const result = await service.compile(request);
    expect(result.readOutsideProject).toBe(true);
    expect(result.outsidePaths).toEqual([outside]);
  });
});

describe("latex.compile 并发", () => {
  it("同一项目的新编译中止旧编译，并等它退出后才开始", async () => {
    const events: string[] = [];
    let n = 0;
    const service = make(
      (options) =>
        new Promise<LatexCompileResult>((resolve) => {
          const id = ++n;
          events.push(`start${id}`);
          const finish = (status: LatexCompileResult["status"]) => {
            events.push(`end${id}`);
            resolve(done({ status }));
          };
          if (id === 2) return finish("succeeded");
          options.signal?.addEventListener("abort", () =>
            setTimeout(() => finish("aborted"), 20),
          );
        }),
    );
    await service.setTrust("p1", true);
    const first = service.compile(request);
    await wait(10);
    const second = service.compile(request);
    expect((await first).status).toBe("aborted");
    expect((await second).status).toBe("succeeded");
    expect(events).toEqual(["start1", "end1", "start2", "end2"]);
  });

  it("latex.abort 中止进行中的编译；没有进行中的返回 false", async () => {
    const service = make(
      (options) =>
        new Promise<LatexCompileResult>((resolve) =>
          options.signal?.addEventListener("abort", () =>
            resolve(done({ status: "aborted" })),
          ),
        ),
    );
    await service.setTrust("p1", true);
    expect(service.abort("p1")).toEqual({ aborted: false });
    const running = service.compile(request);
    await wait(10);
    expect(service.abort("p1")).toEqual({ aborted: true });
    expect((await running).status).toBe("aborted");
    expect(service.abort("p1")).toEqual({ aborted: false });
  });

  it("连续三个请求：每个新请求取代上一个，最后一个真正完成", async () => {
    let started = 0;
    const service = make(
      (options) =>
        new Promise<LatexCompileResult>((resolve) => {
          if (++started === 3) return resolve(done());
          options.signal?.addEventListener("abort", () =>
            resolve(done({ status: "aborted" })),
          );
        }),
    );
    await service.setTrust("p1", true);
    const a = service.compile(request);
    await wait(30);
    const b = service.compile(request);
    await wait(30);
    const c = service.compile(request);
    const statuses = (await Promise.all([a, b, c])).map((r) => r.status);
    expect(statuses).toEqual(["aborted", "aborted", "succeeded"]);
    expect(started).toBe(3);
  });

  it("撤销信任会中止该项目进行中的编译", async () => {
    const service = make(
      (options) =>
        new Promise<LatexCompileResult>((resolve) =>
          options.signal?.addEventListener("abort", () =>
            resolve(done({ status: "aborted" })),
          ),
        ),
    );
    await service.setTrust("p1", true);
    const running = service.compile(request);
    await wait(30);
    await service.setTrust("p1", false);
    expect((await running).status).toBe("aborted");
  });
});

describe("安装引擎", () => {
  it("转发进度，取消后返回 canceled 且可再次安装", async () => {
    const posted: Array<Record<string, unknown>> = [];
    let calls = 0;
    const service = createLatexService({
      storageRoot: storage,
      projectFolder: () => project,
      post: (message) => posted.push(message),
      engineStatus: async () => ({ ...ready, state: "missing" }),
      install: async (options) => {
        calls++;
        options.onProgress?.({ receivedBytes: 5, totalBytes: 10 });
        if (calls === 1)
          await new Promise((_resolve, reject) =>
            options.signal?.addEventListener("abort", () => {
              const error = new Error("取消");
              error.name = "AbortError";
              reject(error);
            }),
          );
        return ready;
      },
    });
    const first = service.installEngine();
    await wait(10);
    await expect(service.installEngine()).rejects.toThrow("正在安装");
    expect(service.cancelInstall()).toEqual({ canceled: true });
    expect(await first).toMatchObject({
      canceled: true,
      status: { state: "missing", installing: false },
    });
    expect(posted[0]).toMatchObject({
      type: "latex.installProgress",
      receivedBytes: 5,
    });
    expect((await service.installEngine()).canceled).toBe(false);
    expect(service.cancelInstall()).toEqual({ canceled: false });
  });
});
