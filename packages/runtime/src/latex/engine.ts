import { createHash, randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import JSZip from "jszip";

export const TECTONIC_VERSION = "0.17.0";

export type EnginePlatformKey = "win32-x64" | "darwin-arm64" | "darwin-x64";

export interface EngineAsset {
  url: string;
  /** 压缩包字节数。 */
  size: number;
  /** 压缩包 SHA-256（小写十六进制）。 */
  sha256: string;
  format: "zip" | "tar.gz";
  /** 压缩包内可执行文件的文件名。 */
  executable: string;
}

export interface EngineManifest {
  version: string;
  assets: Partial<Record<EnginePlatformKey, EngineAsset>>;
}

const releaseBase = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}`;

/** 固定版本与摘要；摘要来自官方发布页并经本地复核（见 docs/m7-plan.md）。 */
export const TECTONIC_MANIFEST: EngineManifest = {
  version: TECTONIC_VERSION,
  assets: {
    "win32-x64": {
      url: `${releaseBase}/tectonic-${TECTONIC_VERSION}-x86_64-pc-windows-msvc.zip`,
      size: 21_060_223,
      sha256:
        "f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f",
      format: "zip",
      executable: "tectonic.exe",
    },
    "darwin-arm64": {
      url: `${releaseBase}/tectonic-${TECTONIC_VERSION}-aarch64-apple-darwin.tar.gz`,
      size: 21_704_674,
      sha256:
        "a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667",
      format: "tar.gz",
      executable: "tectonic",
    },
    "darwin-x64": {
      url: `${releaseBase}/tectonic-${TECTONIC_VERSION}-x86_64-apple-darwin.tar.gz`,
      size: 21_790_177,
      sha256:
        "7c90ef5b6ddb1eb1937e4337add5237b79338e4b9676459fa91187d24d6cdf80",
      format: "tar.gz",
      executable: "tectonic",
    },
  },
};

export type EngineState = "missing" | "ready" | "corrupt";

export interface EngineStatus {
  state: EngineState;
  version: string;
  executablePath?: string;
  cacheDir: string;
  cacheBytes: number;
}

export interface EngineProgress {
  receivedBytes: number;
  totalBytes: number;
}

export interface EngineOptions {
  /** 测试可覆盖固定清单。 */
  manifest?: EngineManifest;
  platform?: NodeJS.Platform;
  arch?: string;
}

export interface InstallEngineOptions extends EngineOptions {
  engineRoot: string;
  signal?: AbortSignal;
  onProgress?: (progress: EngineProgress) => void;
  fetchImpl?: typeof fetch;
  /** 最大尝试次数，默认 3。 */
  retries?: number;
  /** 退避基准毫秒数，默认 1000，按 2 的幂递增。 */
  retryDelayMs?: number;
}

interface EngineMarker {
  version: string;
  archiveSha256: string;
  executable: string;
  executableBytes: number;
  installedAt: string;
}

const MARKER_FILE = "installed.json";

export const engineDir = (engineRoot: string, version = TECTONIC_VERSION) =>
  path.join(engineRoot, "tectonic", version);

export const engineCacheDir = (engineRoot: string) =>
  path.join(engineRoot, "tectonic-cache");

/** 当前平台对应的发布包；不支持时抛出中文错误。 */
export function resolveEngineAsset(options: EngineOptions = {}): {
  key: EnginePlatformKey;
  asset: EngineAsset;
} {
  const manifest = options.manifest ?? TECTONIC_MANIFEST;
  const key = `${options.platform ?? process.platform}-${options.arch ?? process.arch}`;
  const asset = (manifest.assets as Record<string, EngineAsset | undefined>)[
    key
  ];
  if (!asset)
    throw new Error(
      `当前平台（${key}）暂不支持内置 LaTeX 引擎，仅支持 Windows x64、macOS arm64 与 macOS x64`,
    );
  return { key: key as EnginePlatformKey, asset };
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirBytes(full);
    else if (entry.isFile()) total += (await stat(full)).size;
  }
  return total;
}

export async function getEngineStatus(
  engineRoot: string,
  options: EngineOptions = {},
): Promise<EngineStatus> {
  const manifest = options.manifest ?? TECTONIC_MANIFEST;
  const version = manifest.version;
  const cacheDir = engineCacheDir(engineRoot);
  const cacheBytes = await dirBytes(cacheDir);
  const dir = engineDir(engineRoot, version);
  const base = { version, cacheDir, cacheBytes };
  const dirStat = await stat(dir).catch(() => null);
  if (!dirStat?.isDirectory()) return { state: "missing", ...base };
  try {
    const marker = JSON.parse(
      await readFile(path.join(dir, MARKER_FILE), "utf8"),
    ) as EngineMarker;
    if (marker.version !== version || typeof marker.executable !== "string")
      return { state: "corrupt", ...base };
    const exe = path.join(dir, path.basename(marker.executable));
    const exeStat = await stat(exe);
    if (!exeStat.isFile() || exeStat.size !== marker.executableBytes)
      return { state: "corrupt", ...base };
    return { state: "ready", executablePath: exe, ...base };
  } catch {
    return { state: "corrupt", ...base };
  }
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const err = new Error("已取消 LaTeX 引擎安装");
  err.name = "AbortError";
  return err;
}

const isAbort = (err: unknown) =>
  err instanceof Error && err.name === "AbortError";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

class RetryableError extends Error {}

async function downloadOnce(
  asset: EngineAsset,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
  onProgress?: (p: EngineProgress) => void,
): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetchImpl(asset.url, { signal });
  } catch (err) {
    if (isAbort(err) || signal?.aborted) throw abortError(signal);
    throw new RetryableError(
      `网络请求失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (response.status === 429 || response.status >= 500) {
    await response.body?.cancel().catch(() => undefined);
    throw new RetryableError(`服务器暂时不可用（HTTP ${response.status}）`);
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`下载 LaTeX 引擎失败（HTTP ${response.status}）`);
  }
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let received = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      if (signal?.aborted) throw abortError(signal);
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      hash.update(chunk);
      chunks.push(chunk);
      received += chunk.length;
      // 超出声明大小即中止，避免无限读取。
      if (received > asset.size) break;
      onProgress?.({ receivedBytes: received, totalBytes: asset.size });
    }
  } catch (err) {
    if (isAbort(err) || signal?.aborted) throw abortError(signal);
    throw new RetryableError(
      `下载中断：${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (received !== asset.size)
    throw new Error(
      `LaTeX 引擎下载大小不符：期望 ${asset.size} 字节，实际 ${received} 字节`,
    );
  const actual = hash.digest("hex");
  if (actual !== asset.sha256)
    throw new Error(
      `LaTeX 引擎校验失败（SHA-256 不一致）：期望 ${asset.sha256}，实际 ${actual}`,
    );
  return Buffer.concat(chunks);
}

/** 最小 tar 读取器：返回首个文件名（去掉目录）匹配的普通文件。 */
export function extractFromTar(tar: Buffer, fileName: string): Buffer | null {
  const text = (start: number, len: number) => {
    const raw = tar.subarray(start, start + len);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? len : end).toString("utf8");
  };
  let offset = 0;
  let longName: string | null = null;
  while (offset + 512 <= tar.length) {
    if (tar.subarray(offset, offset + 512).every((b) => b === 0)) break;
    let name = text(offset, 100);
    const size = Number.parseInt(text(offset + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(tar[offset + 156] || 48);
    const prefix = text(offset + 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    const body = offset + 512;
    if (type === "L") {
      longName = text(body, size);
    } else if (type === "0") {
      const full = longName ?? name;
      longName = null;
      if (path.posix.basename(full) === fileName)
        return tar.subarray(body, body + size);
    } else {
      longName = null;
    }
    offset = body + Math.ceil(size / 512) * 512;
  }
  return null;
}

async function extractExecutable(
  archive: Buffer,
  asset: EngineAsset,
): Promise<Buffer> {
  let data: Buffer | null = null;
  if (asset.format === "zip") {
    const zip = await JSZip.loadAsync(archive);
    const entry = Object.values(zip.files).find(
      (f) => !f.dir && path.posix.basename(f.name) === asset.executable,
    );
    if (entry) data = await entry.async("nodebuffer");
  } else {
    data = extractFromTar(gunzipSync(archive), asset.executable);
  }
  if (!data) throw new Error(`发布包中找不到 ${asset.executable}`);
  return data;
}

export async function installEngine(
  options: InstallEngineOptions,
): Promise<EngineStatus> {
  const { engineRoot, signal, onProgress } = options;
  const { asset } = resolveEngineAsset(options);
  const manifest = options.manifest ?? TECTONIC_MANIFEST;
  const fetchImpl = options.fetchImpl ?? fetch;
  const attempts = Math.max(1, options.retries ?? 3);
  const baseDelay = options.retryDelayMs ?? 1000;

  let archive: Buffer | undefined;
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw abortError(signal);
    try {
      archive = await downloadOnce(asset, fetchImpl, signal, onProgress);
      break;
    } catch (err) {
      if (!(err instanceof RetryableError)) throw err;
      if (attempt >= attempts)
        throw new Error(
          `${err.message}；已重试 ${attempts} 次，请检查网络后重试`,
        );
      await sleep(baseDelay * 2 ** (attempt - 1), signal);
    }
  }

  const exeData = await extractExecutable(archive, asset);
  if (signal?.aborted) throw abortError(signal);

  const versionsRoot = path.join(engineRoot, "tectonic");
  await mkdir(versionsRoot, { recursive: true });
  const staging = path.join(
    versionsRoot,
    `.staging-${randomBytes(6).toString("hex")}`,
  );
  const finalDir = engineDir(engineRoot, manifest.version);
  try {
    await mkdir(staging, { recursive: true });
    const exePath = path.join(staging, asset.executable);
    await writeFile(exePath, exeData);
    if (process.platform !== "win32") await chmod(exePath, 0o755);
    const marker: EngineMarker = {
      version: manifest.version,
      archiveSha256: asset.sha256,
      executable: asset.executable,
      executableBytes: exeData.length,
      installedAt: new Date().toISOString(),
    };
    await writeFile(
      path.join(staging, MARKER_FILE),
      JSON.stringify(marker, null, 2),
    );
    await rm(finalDir, { recursive: true, force: true });
    await rename(staging, finalDir);
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
  await mkdir(engineCacheDir(engineRoot), { recursive: true });
  return getEngineStatus(engineRoot, options);
}

/** 清空编译缓存目录内容，保留目录本身。 */
export async function clearEngineCache(engineRoot: string): Promise<void> {
  const dir = engineCacheDir(engineRoot);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names)
    await rm(path.join(dir, name), { recursive: true, force: true });
}

/** 删除已安装的引擎（所有版本），保留缓存。 */
export async function removeEngine(engineRoot: string): Promise<void> {
  await rm(path.join(engineRoot, "tectonic"), {
    recursive: true,
    force: true,
  });
}
