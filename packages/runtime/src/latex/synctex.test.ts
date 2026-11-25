import { gzipSync } from "node:zlib";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SYNCTEX_COMPRESSED_LIMIT,
  decodeSyncTex,
  mapPdfToSource,
  mapSourceToPdf,
  parseSyncTex,
  readSyncTeX,
  resolveSyncTeXPath,
} from "./synctex.js";
import { createLatexService } from "./service.js";

let base: string;
let project: string;
let synctexPath: string;

const content = [
  "SyncTeX Version:1",
  "Input:1:main.tex",
  "Input:2:parts/chapter.tex",
  "Unit:254000",
  "Magnification:1000",
  "X Offset:0",
  "Y Offset:0",
  "Output:pdf",
  "Content:",
  "{1",
  "g1,2:1000,2000:300",
  "h2,4:1500,2100:500",
  "}",
  "{2",
  "g2,2:2000,2200:400",
  "}",
  "Postamble:",
  "",
].join("\n");

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "wh-synctex-"));
  project = path.join(base, "project");
  await mkdir(path.join(project, ".wordhub", "build", "latex"), {
    recursive: true,
  });
  await mkdir(path.join(project, "parts"));
  await writeFile(path.join(project, "main.tex"), "main");
  await writeFile(path.join(project, "parts", "chapter.tex"), "chapter");
  synctexPath = path.join(
    project,
    ".wordhub",
    "build",
    "latex",
    "main.synctex.gz",
  );
  await writeFile(synctexPath, gzipSync(content));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("SyncTeX 读取与解析", () => {
  it("只保留当前项目源码并提供双向定位", async () => {
    const document = await readSyncTeX(project, synctexPath);
    expect(document.records).toHaveLength(3);
    const forward = mapSourceToPdf(project, synctexPath, {
      relativePath: "parts/chapter.tex",
      line: 2,
    });
    await expect(forward).resolves.toMatchObject({
      page: 2,
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
    });
    await expect(
      mapPdfToSource(project, synctexPath, { page: 1, x: 1, y: 1 }),
    ).resolves.toMatchObject({
      relativePath: "main.tex",
      line: 2,
      column: 1,
    });
  });

  it("主文件路径固定到项目内编译输出", async () => {
    await expect(resolveSyncTeXPath(project, "main.tex")).resolves.toBe(
      synctexPath,
    );
    await expect(
      resolveSyncTeXPath(project, "../project/main.tex"),
    ).rejects.toThrow();
  });

  it("拒绝项目外文件和符号链接", async () => {
    const outside = path.join(base, "outside.synctex.gz");
    await writeFile(outside, gzipSync(content));
    await expect(readSyncTeX(project, outside)).rejects.toThrow("项目目录内");
    try {
      await symlink(outside, path.join(project, "link.synctex.gz"), "file");
    } catch {
      return;
    }
    await expect(
      readSyncTeX(project, path.join(project, "link.synctex.gz")),
    ).rejects.toThrow();
  });

  it("限制压缩输入大小和解压输出大小", async () => {
    const oversized = Buffer.alloc(SYNCTEX_COMPRESSED_LIMIT + 1);
    expect(() => decodeSyncTex(oversized)).toThrow("过大");
    expect(
      parseSyncTex(decodeSyncTex(gzipSync(content)), project),
    ).toMatchObject({ records: expect.any(Array) });
  });

  it("通过 LaTeX service 暴露双向映射，且不接受越界项目文件", async () => {
    const service = createLatexService({
      storageRoot: path.join(base, "appdata"),
      projectFolder: (projectId) => {
        if (projectId !== "p1") throw new Error("项目不存在");
        return project;
      },
      projectStore: async () => {
        throw new Error("未使用项目存储");
      },
      post: () => undefined,
    });
    await expect(
      service.syncSourceToPdf({
        projectId: "p1",
        mainFile: "main.tex",
        relativePath: "parts/chapter.tex",
        line: 2,
      }),
    ).resolves.toMatchObject({ page: 2 });
    await expect(
      service.syncSourceToPdf({
        projectId: "p1",
        mainFile: "main.tex",
        relativePath: "../outside.tex",
        line: 1,
      }),
    ).rejects.toThrow();
    await expect(
      service.syncPdfToSource({
        projectId: "p1",
        mainFile: "main.tex",
        page: 1,
        x: 1,
        y: 1,
      }),
    ).resolves.toMatchObject({ relativePath: "main.tex", line: 2 });
  });
});
