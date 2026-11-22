import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LatexCompileOptions, LatexCompileResult } from "./compiler.js";
import type { EngineStatus } from "./engine.js";
import { createLatexPdfPreviewStore } from "./pdf-preview.js";
import { createLatexService } from "./service.js";

let base: string;
let storage: string;
let project: string;
let output: string;
const firstPdf = Buffer.from("%PDF-1.7\nfirst artifact\n%%EOF", "ascii");
const secondPdf = Buffer.from("%PDF-1.7\nsecond artifact\n%%EOF", "ascii");

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "wh-pdf-preview-"));
  storage = path.join(base, "appdata");
  project = path.join(base, "project");
  output = path.join(project, ".wordhub", "build", "latex");
  await mkdir(output, { recursive: true });
  await writeFile(path.join(project, "main.tex"), "main");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("LaTeX PDF preview store", () => {
  it("按项目记录成功 PDF，返回字节和稳定版本，标记后保留旧产物", async () => {
    const store = createLatexPdfPreviewStore(storage);
    const pdfPath = path.join(output, "main.pdf");
    await writeFile(pdfPath, firstPdf);

    expect(await store.recordSuccess("p1", project, "main.tex", pdfPath)).toBe(
      true,
    );
    const first = await store.read("p1", project);
    expect(first).toMatchObject({
      status: "ready",
      mainFile: "main.tex",
      stale: false,
    });
    if (first.status !== "ready") throw new Error("预览快照未返回");
    expect(Buffer.from(first.data)).toEqual(firstPdf);

    await writeFile(pdfPath, Buffer.from("failed partial output"));
    await store.markStale("p1", project, "failed");
    const stale = await store.read("p1", project);
    expect(stale).toMatchObject({
      status: "ready",
      revision: first.revision,
      stale: true,
      lastFailure: "failed",
    });
    if (stale.status !== "ready") throw new Error("预览快照未返回");
    expect(Buffer.from(stale.data)).toEqual(firstPdf);
  });

  it("拒绝任意路径、非 PDF、符号链接和过大的源文件", async () => {
    const store = createLatexPdfPreviewStore(storage);
    const outsidePdf = path.join(base, "outside.pdf");
    await writeFile(outsidePdf, firstPdf);
    expect(
      await store.recordSuccess("p1", project, "main.tex", outsidePdf),
    ).toBe(false);
    expect(await store.read("p1", project)).toEqual({ status: "empty" });

    const pdfPath = path.join(output, "main.pdf");
    await writeFile(pdfPath, "not a PDF");
    expect(await store.recordSuccess("p1", project, "main.tex", pdfPath)).toBe(
      false,
    );
    await writeFile(
      pdfPath,
      Buffer.concat([firstPdf, Buffer.alloc(32 * 1024 * 1024)]),
    );
    expect(await store.recordSuccess("p1", project, "main.tex", pdfPath)).toBe(
      false,
    );
    expect(await store.read("p1", project)).toEqual({ status: "empty" });
  });

  it("项目 ID 对应项目目录校验，避免复用另一项目快照", async () => {
    const store = createLatexPdfPreviewStore(storage);
    const pdfPath = path.join(output, "main.pdf");
    await writeFile(pdfPath, firstPdf);
    await store.recordSuccess("p1", project, "main.tex", pdfPath);
    const otherProject = path.join(base, "other-project");
    await mkdir(otherProject);
    expect(await store.read("p1", otherProject)).toMatchObject({
      status: "unavailable",
    });
    expect(await store.read("p2", project)).toEqual({ status: "empty" });
  });
});

describe("latex.compile PDF 快照生命周期", () => {
  const ready: EngineStatus = {
    state: "ready",
    version: "0.17.0",
    executablePath: "tectonic",
    cacheDir: "cache",
    cacheBytes: 0,
  };
  const result = (
    status: LatexCompileResult["status"],
    pdfPath?: string,
  ): LatexCompileResult => ({
    status,
    ...(pdfPath ? { pdfPath } : {}),
    stdout: "",
    stderr: "",
    truncated: false,
    exitCode: status === "succeeded" ? 0 : 1,
    durationMs: 1,
  });

  it("成功建立快照，后续失败显示旧快照且状态过期", async () => {
    let compileNumber = 0;
    const compile = vi.fn(
      async (_options: LatexCompileOptions): Promise<LatexCompileResult> => {
        const pdfPath = path.join(output, "main.pdf");
        if (++compileNumber === 1) {
          await writeFile(pdfPath, firstPdf);
          return result("succeeded", pdfPath);
        }
        await writeFile(pdfPath, "partial output from failed compile");
        return result("failed");
      },
    );
    const service = createLatexService({
      storageRoot: storage,
      projectFolder: () => project,
      projectStore: vi.fn(),
      post: vi.fn(),
      compile,
      engineStatus: async () => ready,
    });
    await service.setTrust("p1", true);

    expect(
      (await service.compile({ projectId: "p1", mainFile: "main.tex" })).status,
    ).toBe("succeeded");
    const first = await service.readPdf("p1");
    expect(first.status).toBe("ready");

    expect(
      (await service.compile({ projectId: "p1", mainFile: "main.tex" })).status,
    ).toBe("failed");
    const afterFailure = await service.readPdf("p1");
    expect(afterFailure).toMatchObject({
      status: "ready",
      stale: true,
      lastFailure: "failed",
    });
    if (afterFailure.status !== "ready") throw new Error("预览快照未返回");
    expect(Buffer.from(afterFailure.data)).toEqual(firstPdf);
  });
});
