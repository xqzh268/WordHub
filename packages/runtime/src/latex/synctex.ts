import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { lstatSync, realpathSync } from "node:fs";
import { gunzip, gunzipSync } from "node:zlib";
import { promisify } from "node:util";
import path from "node:path";
import { isLatexSourceFile, normalizeLatexPath } from "./files.js";

/** 压缩 SyncTeX 文件的最大大小，避免把任意大文件读进 worker。 */
export const SYNCTEX_COMPRESSED_LIMIT = 8 * 1024 * 1024;
/** 解压后的 SyncTeX 文本最大大小，防止 gzip 炸弹。 */
export const SYNCTEX_UNCOMPRESSED_LIMIT = 32 * 1024 * 1024;
/** 单个文件中允许的最大定位记录数。 */
export const SYNCTEX_RECORD_LIMIT = 500_000;

const gunzipAsync = promisify(gunzip);

/** 解压并限制结果大小，供 PDF 快照存储和运行时读取共用。 */
export function decodeSyncTex(compressed: Uint8Array): Buffer {
  if (
    compressed.byteLength <= 0 ||
    compressed.byteLength > SYNCTEX_COMPRESSED_LIMIT
  )
    throw new Error("SyncTeX 文件过大");
  try {
    return gunzipSync(compressed, {
      maxOutputLength: SYNCTEX_UNCOMPRESSED_LIMIT,
    });
  } catch {
    throw new Error("SyncTeX 压缩数据无效");
  }
}

export interface SyncTeXRecord {
  type: string;
  relativePath: string;
  line: number;
  page: number;
  /** PDF 点坐标，原点在左上角。 */
  x: number;
  y: number;
  width: number;
}

export interface SyncTeXDocument {
  records: SyncTeXRecord[];
  unit: number;
  magnification: number;
  xOffset: number;
  yOffset: number;
}

export interface SyncTeXSourceQuery {
  relativePath: string;
  line: number;
  column?: number;
}

export interface SyncTeXPdfQuery {
  page: number;
  x: number;
  y: number;
}

export interface SyncTeXPdfLocation {
  page: number;
  x: number;
  y: number;
  width: number;
}

export interface SyncTeXSourceLocation {
  relativePath: string;
  line: number;
  /** SyncTeX 只记录行号，列号使用该行的起点。 */
  column: number;
  page: number;
  x: number;
  y: number;
  width: number;
}

const inside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};

async function readBoundedFile(filePath: string): Promise<Buffer> {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("SyncTeX 文件无效");
  if (info.size <= 0 || info.size > SYNCTEX_COMPRESSED_LIMIT)
    throw new Error("SyncTeX 文件过大");
  const handle = await open(
    filePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.size <= 0)
      throw new Error("SyncTeX 文件无效");
    if (current.size > SYNCTEX_COMPRESSED_LIMIT)
      throw new Error("SyncTeX 文件过大");
    const chunks: Buffer[] = [];
    let total = 0;
    while (total < SYNCTEX_COMPRESSED_LIMIT) {
      const chunk = Buffer.allocUnsafe(
        Math.min(64 * 1024, SYNCTEX_COMPRESSED_LIMIT - total),
      );
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    if (total >= SYNCTEX_COMPRESSED_LIMIT) {
      const extra = Buffer.alloc(1);
      const { bytesRead } = await handle.read(extra, 0, 1, null);
      if (bytesRead > 0) throw new Error("SyncTeX 文件过大");
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

function projectSourcePathSync(
  projectRoot: string,
  inputPath: string,
): string | undefined {
  const target = path.resolve(projectRoot, inputPath.replaceAll("/", path.sep));
  const candidate = (() => {
    try {
      return realpathSync(target);
    } catch {
      return undefined;
    }
  })();
  if (!candidate || !inside(projectRoot, candidate)) return undefined;
  let info: ReturnType<typeof lstatSync>;
  try {
    info = lstatSync(candidate);
  } catch {
    return undefined;
  }
  if (!info.isFile() || info.isSymbolicLink()) return undefined;
  const relative = path
    .relative(projectRoot, candidate)
    .split(path.sep)
    .join("/");
  if (!relative || !isLatexSourceFile(relative)) return undefined;
  try {
    return normalizeLatexPath(relative);
  } catch {
    return undefined;
  }
}

const SIGNED_INTEGER = "(-?\\d+)";
const LOCATION_RECORD = new RegExp(
  `^([hxgkr$\\(])(\\d+),(\\d+)(?:,-?\\d+)?:${SIGNED_INTEGER},${SIGNED_INTEGER}(?::${SIGNED_INTEGER}(?:,-?\\d+,-?\\d+)?)?$`,
);

function numberIn(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`SyncTeX ${label} 无效`);
  return parsed;
}

/** 解析 SyncTeX v1 的 PDF 输出格式。 */
export function parseSyncTex(
  decoded: Uint8Array,
  projectFolder: string,
): SyncTeXDocument {
  const projectRoot = realpathSync(projectFolder);
  if (decoded[0] === 0x1f && decoded[1] === 0x8b)
    decoded = decodeSyncTex(decoded);
  if (decoded.byteLength > SYNCTEX_UNCOMPRESSED_LIMIT)
    throw new Error("SyncTeX 解压内容过大");
  const contents = Buffer.from(decoded).toString("utf8");
  const separator = /(?:^|\n)Content:\r?\n/.exec(contents);
  if (!separator || separator.index === undefined)
    throw new Error("SyncTeX 内容头无效");
  const preamble = contents.slice(0, separator.index);
  const body = contents.slice(separator.index + separator[0].length);
  if (!/^SyncTeX Version:1\r?$/m.test(preamble))
    throw new Error("不支持的 SyncTeX 版本");
  if (!/^Output:pdf\r?$/m.test(preamble))
    throw new Error("SyncTeX 输出格式不是 PDF");
  if (!/^Postamble:\r?$/m.test(body)) throw new Error("SyncTeX 缺少结束标记");
  const unit = numberIn(preamble.match(/^Unit:(\d+)\r?$/m)?.[1], "单位");
  const magnification = numberIn(
    preamble.match(/^Magnification:(\d+)\r?$/m)?.[1],
    "放大倍率",
  );
  const xOffset = numberIn(
    preamble.match(/^X Offset:(-?\d+)\r?$/m)?.[1],
    "X 偏移",
  );
  const yOffset = numberIn(
    preamble.match(/^Y Offset:(-?\d+)\r?$/m)?.[1],
    "Y 偏移",
  );
  if (unit <= 0 || magnification <= 0)
    throw new Error("SyncTeX 单位或放大倍率无效");

  // Tectonic/PDF SyncTeX uses TeX scaled points. This conversion follows
  // the reference SyncTeX reader and keeps coordinates in PDF points.
  const scaledPointsPerPdfPoint = (65536 * 72.27) / 72;
  const offsetScale = unit / scaledPointsPerPdfPoint;
  const scale = (offsetScale * magnification) / 1000;
  const sources = new Map<number, string>();
  const records: SyncTeXRecord[] = [];
  let page = 0;
  for (const row of contents.split(/\r?\n/)) {
    const input = /^Input:(\d+):(.+)$/.exec(row);
    if (input) {
      const source = projectSourcePathSync(projectRoot, input[2]!);
      if (source) sources.set(Number(input[1]), source);
      continue;
    }
    const sheet = /^\{(\d+)$/.exec(row);
    if (sheet) {
      page = Number(sheet[1]);
      continue;
    }
    if (row.startsWith("}")) {
      page = 0;
      continue;
    }
    if (page <= 0) continue;
    const match = LOCATION_RECORD.exec(row);
    if (!match) continue;
    if (records.length >= SYNCTEX_RECORD_LIMIT)
      throw new Error("SyncTeX 定位记录过多");
    const relativePath = sources.get(Number(match[2]));
    const line = Number(match[3]);
    if (!relativePath || !Number.isSafeInteger(line) || line <= 0) continue;
    const x = Number(match[4]) * scale + xOffset * offsetScale;
    const y = Number(match[5]) * scale + yOffset * offsetScale;
    const width = Number(match[6] ?? 0) * scale;
    if (![x, y, width].every(Number.isFinite)) continue;
    records.push({
      type: match[1]!,
      relativePath,
      line,
      page,
      x,
      y,
      width,
    });
  }
  if (records.length === 0) throw new Error("SyncTeX 中没有当前项目定位记录");
  return { records, unit, magnification, xOffset, yOffset };
}

/** 异步 API 接受 gzip 数据，保持运行时服务调用简单。 */
export async function parseSyncTeX(
  compressed: Uint8Array,
  projectFolder: string,
): Promise<SyncTeXDocument> {
  const projectRoot = await realpath(projectFolder);
  // Use the asynchronous gzip implementation here so large files do not
  // block the worker when a client calls the mapping endpoint directly.
  let decoded: Buffer;
  if (
    compressed.byteLength <= 0 ||
    compressed.byteLength > SYNCTEX_COMPRESSED_LIMIT
  )
    throw new Error("SyncTeX 文件过大");
  try {
    decoded = await gunzipAsync(compressed, {
      maxOutputLength: SYNCTEX_UNCOMPRESSED_LIMIT,
    });
  } catch {
    throw new Error("SyncTeX 压缩数据无效");
  }
  return parseSyncTex(decoded, projectRoot);
}

async function readSyncTeXFile(
  projectFolder: string,
  synctexPath: string,
): Promise<SyncTeXDocument> {
  const projectRoot = await realpath(projectFolder);
  const target = await realpath(synctexPath).catch(() => undefined);
  if (!target || !inside(projectRoot, target))
    throw new Error("SyncTeX 文件必须位于项目目录内");
  return parseSyncTeX(await readBoundedFile(target), projectRoot);
}

export async function readSyncTeX(
  projectFolder: string,
  synctexPath: string,
): Promise<SyncTeXDocument> {
  return readSyncTeXFile(projectFolder, synctexPath);
}

/** 根据编译器的固定输出规则取得主文件对应的 SyncTeX。 */
export async function resolveSyncTeXPath(
  projectFolder: string,
  mainFile: string,
): Promise<string> {
  const projectRoot = await realpath(projectFolder);
  const relative = normalizeLatexPath(mainFile);
  const mainPath = await realpath(path.resolve(projectRoot, relative));
  if (!inside(projectRoot, mainPath))
    throw new Error("LaTeX 主文件必须位于项目目录内");
  const mainInfo = await lstat(mainPath);
  if (!mainInfo.isFile() || mainInfo.isSymbolicLink())
    throw new Error("LaTeX 主文件必须是普通文件");
  if (
    !isLatexSourceFile(relative) ||
    path.extname(relative).toLowerCase() !== ".tex"
  )
    throw new Error("LaTeX 主文件必须是 .tex 文件");
  const output = path.join(projectRoot, ".wordhub", "build", "latex");
  for (const part of [
    path.join(projectRoot, ".wordhub"),
    path.join(projectRoot, ".wordhub", "build"),
    output,
  ]) {
    const partInfo = await lstat(part).catch(() => undefined);
    if (partInfo?.isSymbolicLink())
      throw new Error("SyncTeX 输出目录不能是符号链接");
  }
  const outputRoot = await realpath(output).catch(() => undefined);
  if (!outputRoot || !inside(projectRoot, outputRoot))
    throw new Error("SyncTeX 输出目录必须位于项目目录内");
  const target = path.join(
    outputRoot,
    `${path.basename(mainPath, path.extname(mainPath))}.synctex.gz`,
  );
  const resolved = await realpath(target).catch(() => undefined);
  if (!resolved || !inside(outputRoot, resolved))
    throw new Error("SyncTeX 文件不存在");
  const info = await lstat(resolved);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("SyncTeX 文件无效");
  return resolved;
}

const anchorPriority = (record: SyncTeXRecord): number => {
  if (record.type === "g") return 0;
  if (record.type === "h") return 1;
  if (record.type === "x") return 2;
  if (record.type === "(" && record.width > 0) return 3;
  return 4;
};

export function sourceToPdf(
  document: SyncTeXDocument,
  query: SyncTeXSourceQuery,
): SyncTeXPdfLocation | null {
  const candidates = document.records.filter(
    (record) =>
      record.relativePath === query.relativePath && record.line === query.line,
  );
  candidates.sort(
    (left, right) => anchorPriority(left) - anchorPriority(right),
  );
  const record = candidates[0];
  return record
    ? { page: record.page, x: record.x, y: record.y, width: record.width }
    : null;
}

const distanceFromSpan = (value: number, left: number, right: number): number =>
  Math.max(left - value, 0, value - right);

export function pdfToSource(
  document: SyncTeXDocument,
  query: SyncTeXPdfQuery,
): SyncTeXSourceLocation | null {
  if (!Number.isInteger(query.page) || query.page <= 0) return null;
  const pageRecords = document.records.filter(
    (record) => record.page === query.page,
  );
  const glyphRecords = pageRecords.filter((record) =>
    ["g", "h", "x"].includes(record.type),
  );
  const candidates = glyphRecords.length ? glyphRecords : pageRecords;
  candidates.sort((left, right) => {
    const rank = (record: SyncTeXRecord) =>
      Math.abs(query.y - record.y) * 5 +
      distanceFromSpan(
        query.x,
        Math.min(record.x, record.x + record.width),
        Math.max(record.x, record.x + record.width),
      ) +
      anchorPriority(record);
    return rank(left) - rank(right);
  });
  const record = candidates[0];
  return record
    ? {
        relativePath: record.relativePath,
        line: record.line,
        column: 1,
        page: record.page,
        x: record.x,
        y: record.y,
        width: record.width,
      }
    : null;
}

export async function mapSourceToPdf(
  projectFolder: string,
  synctexPath: string,
  query: SyncTeXSourceQuery,
): Promise<SyncTeXPdfLocation | null> {
  return sourceToPdf(await readSyncTeXFile(projectFolder, synctexPath), query);
}

export async function mapPdfToSource(
  projectFolder: string,
  synctexPath: string,
  query: SyncTeXPdfQuery,
): Promise<SyncTeXSourceLocation | null> {
  return pdfToSource(await readSyncTeXFile(projectFolder, synctexPath), query);
}
