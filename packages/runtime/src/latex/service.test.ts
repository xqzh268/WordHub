import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WordHubStore, contentHash } from "@wordhub/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LatexCompileOptions, LatexCompileResult } from "./compiler.js";
import type { EngineStatus } from "./engine.js";
import { LATEX_FILE_READ_LIMIT } from "./files.js";
import { createLatexService } from "./service.js";

let base: string;
let storage: string;
let project: string;
let writeStore: WordHubStore | undefined;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "wh-latex-svc-"));
  storage = path.join(base, "appdata");
  project = path.join(base, "论文");
  await mkdir(project);
  await writeFile(path.join(project, "main.tex"), "\\documentclass{article}");
});
afterEach(async () => {
  writeStore?.close();
  writeStore = undefined;
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
  projectStore = vi.fn<() => Promise<WordHubStore>>(),
) =>
  createLatexService({
    storageRoot: storage,
    projectFolder: (id) => {
      if (id !== "p1" && id !== "p2") throw new Error("项目不存在");
      return project;
    },
    projectStore,
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
    expect(result.diagnostics).toEqual([]);
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
      projectStore: vi.fn(),
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

  it("诊断从完整编译输出解析，原始日志仍仅保留尾部", async () => {
    const service = make(async () =>
      done({
        status: "failed",
        stderr: [
          "error: main.tex:1: Undefined control sequence",
          "a".repeat(21_000),
        ].join("\n"),
      }),
    );
    await service.setTrust("p1", true);
    const result = await service.compile(request);
    expect(result.log).not.toContain("Undefined control sequence");
    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        message: "Undefined control sequence",
        location: { relativePath: "main.tex", line: 1 },
      },
    ]);
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
      projectStore: vi.fn(),
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

describe("latex.files / latex.readFile / latex.setMainFile", () => {
  it("递归列出受支持的源码和图片，排除内部目录与符号链接", async () => {
    await mkdir(path.join(project, "parts"));
    await mkdir(path.join(project, "node_modules", "pkg"), { recursive: true });
    await mkdir(path.join(project, ".wordhub"));
    await writeFile(path.join(project, "parts", "chapter.tex"), "chapter");
    await writeFile(path.join(project, "parts", "refs.bib"), "refs");
    await writeFile(path.join(project, "figure.png"), Buffer.from([1, 2, 3]));
    await writeFile(path.join(project, "notes.txt"), "ignored");
    await writeFile(path.join(project, ".wordhub", "hidden.tex"), "ignored");
    await writeFile(
      path.join(project, "node_modules", "pkg", "hidden.tex"),
      "ignored",
    );
    let linked = false;
    try {
      await symlink(
        path.join(project, "parts", "chapter.tex"),
        path.join(project, "linked.tex"),
      );
      linked = true;
    } catch {
      // Windows without symlink privileges still exercises the other boundaries.
    }
    const service = make(async () => done());
    const result = await service.files("p1");
    expect(result.mainFile).toBe("main.tex");
    expect(result.files.map((file) => file.path)).toEqual([
      "figure.png",
      "main.tex",
      "parts/chapter.tex",
      "parts/refs.bib",
    ]);
    if (linked)
      expect(result.files.some((file) => file.path === "linked.tex")).toBe(
        false,
      );
  });

  it("安全读取源码并拒绝越界、图片和超大文件", async () => {
    await writeFile(path.join(project, "parts.tex"), "\\section{Hi}");
    const service = make(async () => done());
    const result = await service.readFile("p1", "parts.tex");
    expect(result).toMatchObject({
      path: "parts.tex",
      content: "\\section{Hi}",
    });
    expect(result.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    await expect(service.readFile("p1", "../outside.tex")).rejects.toThrow();
    await writeFile(path.join(project, "picture.png"), Buffer.from([1]));
    await expect(service.readFile("p1", "picture.png")).rejects.toThrow("源码");
    await writeFile(
      path.join(project, "large.tex"),
      Buffer.alloc(5 * 1024 * 1024 + 1),
    );
    await expect(service.readFile("p1", "large.tex")).rejects.toThrow("过大");
  });

  it("设置主文件后持久化到 .wordhub/latex.json，并可被文件列表读回", async () => {
    await mkdir(path.join(project, "parts"));
    await writeFile(path.join(project, "parts", "main.tex"), "main");
    const service = make(async () => done());
    await expect(service.setMainFile("p1", "parts/main.tex")).resolves.toEqual({
      mainFile: "parts/main.tex",
    });
    expect(
      JSON.parse(
        await readFile(path.join(project, ".wordhub", "latex.json"), "utf8"),
      ),
    ).toMatchObject({ schemaVersion: 1, mainFile: "parts/main.tex" });
    expect((await service.files("p1")).mainFile).toBe("parts/main.tex");
    await expect(service.setMainFile("p1", "missing.tex")).rejects.toThrow();
    await expect(service.setMainFile("p1", "parts/main.bib")).rejects.toThrow(
      ".tex",
    );
  });
});

describe("latex.writeFile", () => {
  function makeWriter() {
    const store = new WordHubStore(storage);
    writeStore = store;
    store.createProject({
      id: "p1",
      name: "论文",
      folderPath: project,
      kind: "academic",
    });
    const service = make(
      async () => done(),
      vi.fn(async () => store),
    );
    return { service, store };
  }

  it("保留中文路径、UTF-8 和 CRLF，保存读入版本及用户修订", async () => {
    const { service, store } = makeWriter();
    const directory = path.join(project, "章节");
    const target = path.join(directory, "引言.tex");
    const before = "\uFEFF\\section{引言}\r\n原文\r\n";
    const content = "\uFEFF\\section{引言}\r\n中文改稿\r\n";
    await mkdir(directory);
    await writeFile(target, before, "utf8");
    const baseline = await service.readFile("p1", "章节/引言.tex");
    const result = await service.writeFile({
      projectId: "p1",
      path: "章节\\引言.tex",
      content,
      expectedHash: baseline.contentHash,
    });
    expect(result).toEqual({
      status: "saved",
      file: await service.readFile("p1", baseline.path),
    });
    expect(await readFile(target)).toEqual(Buffer.from(content, "utf8"));
    const [original, revision] = store.listRevisions(
      "p1",
      "file:章节/引言.tex",
    );
    expect(original).toMatchObject({ contentHash: contentHash(before) });
    expect(revision).toMatchObject({
      parentRevisionId: original?.id,
      author: { type: "user", id: "user" },
      status: "current",
      contentHash: contentHash(content),
    });
  });

  it("外部修改或删除导致冲突，保留磁盘状态", async () => {
    const { service, store } = makeWriter();
    const target = path.join(project, "main.tex");
    const baseline = await service.readFile("p1", "main.tex");
    const change = {
      projectId: "p1",
      path: baseline.path,
      content: "编辑器内容",
      expectedHash: baseline.contentHash,
    };
    const external = "外部修改\r\n";
    await writeFile(target, external, "utf8");
    await expect(service.writeFile(change)).resolves.toEqual({
      status: "conflict",
    });
    expect(await readFile(target, "utf8")).toBe(external);
    expect(store.listRevisions("p1", "file:main.tex")).toEqual([
      expect.objectContaining({
        contentHash: contentHash(external),
        author: { type: "system", id: "external" },
      }),
    ]);
    await rm(target);
    await expect(service.writeFile(change)).resolves.toEqual({
      status: "conflict",
    });
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      store.listRevisions("p1", "file:main.tex").at(-1)?.patch,
    ).toMatchObject({ deleted: true });
  });

  it("并发保存同一个基线只提交一份，不创建旁路副本", async () => {
    const { service } = makeWriter();
    const { contentHash: expectedHash } = await service.readFile(
      "p1",
      "main.tex",
    );
    const results = await Promise.all(
      ["甲", "乙"].map((content) =>
        service.writeFile({
          projectId: "p1",
          path: "main.tex",
          content,
          expectedHash,
        }),
      ),
    );
    const saved = results.find((result) => result.status === "saved");
    expect(saved?.file.content).toBe(
      await readFile(path.join(project, "main.tex"), "utf8"),
    );
    expect(
      results.filter((result) => result.status === "conflict"),
    ).toHaveLength(1);
    expect(await readdir(project)).toEqual(["main.tex"]);
  });

  it("拒绝来源不明、非源码、内部目录、越界及超过字节上限的写入", async () => {
    const { service } = makeWriter();
    const { contentHash: expectedHash } = await service.readFile(
      "p1",
      "main.tex",
    );
    const change = {
      projectId: "p1",
      path: "main.tex",
      content: "改稿",
      expectedHash,
    };
    const outside = path.join(base, "outside.tex");
    await writeFile(outside, "外部", "utf8");
    await symlink(base, path.join(project, "link"), "junction");
    for (const target of [
      "../outside.tex",
      "link/outside.tex",
      "figure.png",
      ".wordhub/hidden.tex",
      "node_modules/pkg/hidden.tex",
    ]) {
      await expect(
        service.writeFile({ ...change, path: target }),
      ).rejects.toThrow();
    }
    await expect(
      service.writeFile({ ...change, projectId: "unknown" }),
    ).rejects.toThrow("项目不存在");
    await expect(
      service.writeFile({ ...change, expectedHash: "" }),
    ).rejects.toThrow("基线哈希");
    await expect(
      service.writeFile({
        ...change,
        content: "字".repeat(Math.floor(LATEX_FILE_READ_LIMIT / 3) + 1),
      }),
    ).rejects.toThrow("过大");
    const invalidUtf8 = Buffer.from([0xff]);
    await writeFile(path.join(project, "legacy.tex"), invalidUtf8);
    await expect(
      service.writeFile({
        ...change,
        path: "legacy.tex",
        expectedHash: contentHash(invalidUtf8),
      }),
    ).rejects.toThrow("UTF-8");
    expect(await readFile(path.join(project, "legacy.tex"))).toEqual(
      invalidUtf8,
    );
    expect(await readFile(outside, "utf8")).toBe("外部");
    expect(await service.readFile("p1", "main.tex")).toMatchObject({
      contentHash: expectedHash,
    });
  });
});
