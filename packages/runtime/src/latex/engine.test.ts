import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearEngineCache,
  type EngineManifest,
  engineCacheDir,
  engineDir,
  extractFromTar,
  getEngineStatus,
  installEngine,
  removeEngine,
  resolveEngineAsset,
  TECTONIC_MANIFEST,
} from "./engine.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const exeContent = Buffer.from("fake tectonic binary ".repeat(500));

async function makeZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("tectonic.exe", exeContent);
  return zip.generateAsync({ type: "nodebuffer" });
}

function makeTar(files: Record<string, Buffer>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, data] of Object.entries(files)) {
    const header = Buffer.alloc(512);
    header.write(name, 0, "utf8");
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("0", 156);
    parts.push(header, data);
    const pad = (512 - (data.length % 512)) % 512;
    parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function manifestFor(archive: Buffer, format: "zip" | "tar.gz" = "zip") {
  const manifest: EngineManifest = {
    version: "0.17.0",
    assets: {
      "win32-x64": {
        url: "https://example.invalid/tectonic.zip",
        size: archive.length,
        sha256: sha(archive),
        format,
        executable: format === "zip" ? "tectonic.exe" : "tectonic",
      },
    },
  };
  return manifest;
}

const opts = { platform: "win32" as const, arch: "x64", retryDelayMs: 1 };

function respond(archive: Buffer, chunkSize = 1000): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= archive.length) return controller.close();
      controller.enqueue(archive.subarray(i, i + chunkSize));
      i += chunkSize;
    },
  });
  return new Response(body, { status: 200 });
}

let tmp: string;
let root: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "wh-引擎-"));
  root = path.join(tmp, "应用数据", "engine");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("Tectonic 引擎管理", () => {
  it("清单固定 0.17.0 且三个平台齐全", () => {
    expect(TECTONIC_MANIFEST.version).toBe("0.17.0");
    expect(Object.keys(TECTONIC_MANIFEST.assets).sort()).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "win32-x64",
    ]);
    for (const a of Object.values(TECTONIC_MANIFEST.assets))
      expect(a.url).toContain("tectonic%400.17.0");
  });

  it("不支持的平台给出中文错误", () => {
    expect(() =>
      resolveEngineAsset({ platform: "linux", arch: "x64" }),
    ).toThrow(/暂不支持/);
  });

  it("missing → install → ready，并写入路径与缓存目录", async () => {
    const archive = await makeZip();
    const manifest = manifestFor(archive);
    const before = await getEngineStatus(root, { manifest });
    expect(before.state).toBe("missing");
    expect(before.cacheDir).toBe(engineCacheDir(root));

    const status = await installEngine({
      engineRoot: root,
      manifest,
      ...opts,
      fetchImpl: async () => respond(archive),
    });
    expect(status.state).toBe("ready");
    expect(status.executablePath).toBe(
      path.join(engineDir(root), "tectonic.exe"),
    );
    expect((await stat(status.executablePath as string)).size).toBe(
      exeContent.length,
    );
    expect((await getEngineStatus(root, { manifest })).state).toBe("ready");
    // 版本目录里没有残留的暂存目录。
    expect(await readdir(path.join(root, "tectonic"))).toEqual(["0.17.0"]);
  });

  it("进度单调递增并到达总量", async () => {
    const archive = await makeZip();
    const seen: number[] = [];
    let total = 0;
    await installEngine({
      engineRoot: root,
      manifest: manifestFor(archive),
      ...opts,
      fetchImpl: async () => respond(archive, 300),
      onProgress: (p) => {
        seen.push(p.receivedBytes);
        total = p.totalBytes;
      },
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(total).toBe(archive.length);
    expect(seen.at(-1)).toBe(archive.length);
  });

  it("SHA-256 不一致被拒绝且不安装", async () => {
    const archive = await makeZip();
    const manifest = manifestFor(archive);
    const tampered = Buffer.from(archive);
    tampered[10] = (tampered[10] ?? 0) ^ 0xff;
    await expect(
      installEngine({
        engineRoot: root,
        manifest,
        ...opts,
        fetchImpl: async () => respond(tampered),
      }),
    ).rejects.toThrow(/校验失败.*期望.*实际/);
    expect((await getEngineStatus(root, { manifest })).state).toBe("missing");
    await expect(stat(engineDir(root))).rejects.toThrow();
  });

  it("429 后重试成功", async () => {
    const archive = await makeZip();
    let calls = 0;
    const status = await installEngine({
      engineRoot: root,
      manifest: manifestFor(archive),
      ...opts,
      fetchImpl: async () => {
        calls++;
        return calls === 1
          ? new Response("slow down", { status: 429 })
          : respond(archive);
      },
    });
    expect(calls).toBe(2);
    expect(status.state).toBe("ready");
  });

  it("重试耗尽后报错", async () => {
    const archive = await makeZip();
    let calls = 0;
    await expect(
      installEngine({
        engineRoot: root,
        manifest: manifestFor(archive),
        ...opts,
        retries: 2,
        fetchImpl: async () => {
          calls++;
          throw new TypeError("fetch failed");
        },
      }),
    ).rejects.toThrow(/已重试 2 次/);
    expect(calls).toBe(2);
  });

  it("下载中途中止：无残留目录，抛 AbortError", async () => {
    const archive = await makeZip();
    const ctrl = new AbortController();
    await expect(
      installEngine({
        engineRoot: root,
        manifest: manifestFor(archive),
        ...opts,
        signal: ctrl.signal,
        fetchImpl: async () => respond(archive, 200),
        onProgress: (p) => {
          if (p.receivedBytes >= 400) ctrl.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(stat(engineDir(root))).rejects.toThrow();
    const versions = await readdir(path.join(root, "tectonic")).catch(() => []);
    expect(versions).toEqual([]);
  });

  it("标记缺失或可执行文件缺失判为 corrupt", async () => {
    const archive = await makeZip();
    const manifest = manifestFor(archive);
    await installEngine({
      engineRoot: root,
      manifest,
      ...opts,
      fetchImpl: async () => respond(archive),
    });
    await rm(path.join(engineDir(root), "tectonic.exe"));
    expect((await getEngineStatus(root, { manifest })).state).toBe("corrupt");

    await installEngine({
      engineRoot: root,
      manifest,
      ...opts,
      fetchImpl: async () => respond(archive),
    });
    expect((await getEngineStatus(root, { manifest })).state).toBe("ready");
    await writeFile(path.join(engineDir(root), "installed.json"), "{坏的");
    expect((await getEngineStatus(root, { manifest })).state).toBe("corrupt");

    await rm(path.join(engineDir(root), "installed.json"));
    expect((await getEngineStatus(root, { manifest })).state).toBe("corrupt");
  });

  it("清空缓存与卸载引擎", async () => {
    const archive = await makeZip();
    const manifest = manifestFor(archive);
    await installEngine({
      engineRoot: root,
      manifest,
      ...opts,
      fetchImpl: async () => respond(archive),
    });
    const cache = engineCacheDir(root);
    await mkdir(path.join(cache, "sub"), { recursive: true });
    await writeFile(path.join(cache, "sub", "a.bin"), Buffer.alloc(100));
    await writeFile(path.join(cache, "b.bin"), Buffer.alloc(50));
    expect((await getEngineStatus(root, { manifest })).cacheBytes).toBe(150);

    await clearEngineCache(root);
    const after = await getEngineStatus(root, { manifest });
    expect(after.cacheBytes).toBe(0);
    expect(await readdir(cache)).toEqual([]);
    expect(after.state).toBe("ready");

    await removeEngine(root);
    expect((await getEngineStatus(root, { manifest })).state).toBe("missing");
    // 目录不存在时不报错。
    await clearEngineCache(path.join(tmp, "不存在"));
  });

  it("tar.gz 包（macOS 格式）可解包并设为可执行", async () => {
    const tarball = gzipSync(
      makeTar({
        "README.md": Buffer.from("hi"),
        "./tectonic": exeContent,
      }),
    );
    const manifest = manifestFor(tarball, "tar.gz");
    const status = await installEngine({
      engineRoot: root,
      manifest,
      ...opts,
      fetchImpl: async () => respond(tarball),
    });
    expect(status.state).toBe("ready");
    expect(status.executablePath).toBe(path.join(engineDir(root), "tectonic"));
    if (process.platform !== "win32")
      expect(
        (await stat(status.executablePath as string)).mode & 0o111,
      ).not.toBe(0);
  });

  it("extractFromTar 找不到文件返回 null", () => {
    expect(extractFromTar(makeTar({ a: Buffer.from("x") }), "tectonic")).toBe(
      null,
    );
  });
});
