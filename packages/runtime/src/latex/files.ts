import { isUtf8 } from "node:buffer";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  CommandPayloads,
  Hash,
  LatexFileContentPayload,
  LatexFileInfo,
  LatexFilesPayload,
  LatexMainFilePayload,
  LatexWriteFilePayload,
} from "@wordhub/contracts";
import {
  ControlledFileWriter,
  FileConflictError,
  type WordHubStore,
  contentHash,
  safeProjectTarget,
} from "@wordhub/store";

/** 单个源码文件的读写上限，避免在进程间传递任意大文件。 */
export const LATEX_FILE_READ_LIMIT = 5 * 1024 * 1024;
export const LATEX_MAIN_FILE_CONFIG = path.join(".wordhub", "latex.json");

const SOURCE_EXTENSIONS = new Set([
  ".tex",
  ".ltx",
  ".bib",
  ".sty",
  ".cls",
  ".bst",
  ".def",
  ".bbx",
  ".cbx",
  ".dtx",
  ".ins",
  ".gls",
  ".acn",
  ".ist",
]);
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".webp",
  ".svg",
  ".eps",
  ".pdf",
]);
const LISTED_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, ...IMAGE_EXTENSIONS]);
const CONFIG_VERSION = 1;

const extensionOf = (file: string): string =>
  path.posix.extname(file).toLocaleLowerCase("en-US");

const isListedFile = (file: string): boolean =>
  LISTED_EXTENSIONS.has(extensionOf(file));

export const isLatexSourceFile = (file: string): boolean =>
  SOURCE_EXTENSIONS.has(extensionOf(file));

/** 将 IPC 传来的相对路径规范化，同时拒绝绝对路径和路径穿越。 */
export function normalizeLatexPath(relativePath: string): string {
  if (typeof relativePath !== "string") throw new Error("LaTeX 文件路径无效");
  const normalized = relativePath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.includes(":") ||
        part.includes(String.fromCharCode(0)) ||
        /[. ]$/u.test(part),
    )
  )
    throw new Error("LaTeX 文件路径必须是项目内相对路径");
  return normalized;
}

async function projectRoot(folder: string): Promise<string> {
  return realpath(folder);
}

async function listDirectory(
  root: string,
  directory: string,
  files: LatexFileInfo[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [] as import("node:fs").Dirent[],
  );
  for (const entry of entries) {
    // 项目内部数据和依赖目录不能出现在 LaTeX 文件树中。
    if (entry.name === ".wordhub" || entry.name === "node_modules") continue;
    const target = path.join(directory, entry.name);
    const info = await lstat(target).catch(() => undefined);
    if (!info || info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      await listDirectory(root, target, files);
      continue;
    }
    if (!info.isFile()) continue;
    const relative = path.relative(root, target).split(path.sep).join("/");
    if (!isListedFile(relative)) continue;
    files.push({
      path: relative,
      name: entry.name,
      size: info.size,
      mtimeMs: info.mtimeMs,
    });
  }
}

export async function readLatexMainFile(folder: string): Promise<string> {
  const root = await projectRoot(folder);
  const config = path.join(root, LATEX_MAIN_FILE_CONFIG);
  const configInfo = await lstat(config).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (configInfo?.isSymbolicLink())
    throw new Error("不允许通过符号链接读取 LaTeX 配置");
  const text = await readFile(config, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (text === undefined) return "main.tex";
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("LaTeX 主文件配置格式无效");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as { mainFile?: unknown }).mainFile !== "string"
  )
    throw new Error("LaTeX 主文件配置格式无效");
  return normalizeLatexPath((value as { mainFile: string }).mainFile);
}

export async function listLatexFiles(
  folder: string,
): Promise<LatexFilesPayload> {
  const root = await projectRoot(folder);
  const files: LatexFileInfo[] = [];
  await listDirectory(root, root, files);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, mainFile: await readLatexMainFile(root) };
}

export async function readLatexFile(
  folder: string,
  relativePath: string,
): Promise<LatexFileContentPayload> {
  const normalized = normalizeLatexPath(relativePath);
  if (!isLatexSourceFile(normalized))
    throw new Error("只能读取 LaTeX 源码文件");
  const target = await safeProjectTarget(folder, normalized);
  const { data, mtimeMs } = await readLatexSource(target);
  return {
    path: normalized,
    content: data.toString("utf8"),
    contentHash: contentHash(data),
    mtimeMs,
  };
}

async function readLatexSource(target: string) {
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("LaTeX 文件不是普通文件");
  if (info.size > LATEX_FILE_READ_LIMIT)
    throw new Error("LaTeX 文件过大，暂不支持显示");
  return { data: await readFile(target), mtimeMs: info.mtimeMs };
}

export async function writeLatexFile(
  folder: string,
  store: WordHubStore,
  request: CommandPayloads["latex.writeFile"],
): Promise<LatexWriteFilePayload> {
  const normalized = normalizeLatexPath(request.path);
  if (!isLatexSourceFile(normalized))
    throw new Error("只能保存 LaTeX 源码文件");
  if (normalized.toLowerCase().split("/").includes("node_modules"))
    throw new Error("不允许修改项目依赖目录");
  if (typeof request.content !== "string")
    throw new Error("LaTeX 文件内容无效");
  if (Buffer.byteLength(request.content, "utf8") > LATEX_FILE_READ_LIMIT)
    throw new Error("LaTeX 文件过大，暂不支持保存");
  if (
    typeof request.expectedHash !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(request.expectedHash)
  )
    throw new Error("保存 LaTeX 文件需要有效的基线哈希");

  const target = await safeProjectTarget(folder, normalized);
  const existing = await readLatexSource(target).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (existing && !isUtf8(existing.data))
    throw new Error("仅支持保存 UTF-8 编码的 LaTeX 文件");
  const writer = new ControlledFileWriter(store, request.projectId, folder);
  try {
    const saved = await writer.writeText({
      relativePath: normalized,
      content: request.content,
      expectedHash: request.expectedHash as Hash,
      conflictPolicy: "reject",
      contentType: "text/plain",
      author: { type: "user", id: "user" },
    });
    const info = await lstat(target).catch(() => undefined);
    return {
      status: "saved",
      file: {
        path: saved.relativePath,
        content: request.content,
        contentHash: saved.contentHash,
        mtimeMs: info?.mtimeMs ?? Date.parse(saved.revision.createdAt),
      },
    };
  } catch (error) {
    if (error instanceof FileConflictError) return { status: "conflict" };
    throw error;
  }
}

export async function setLatexMainFile(
  folder: string,
  mainFile: string,
): Promise<LatexMainFilePayload> {
  const normalized = normalizeLatexPath(mainFile);
  if (extensionOf(normalized) !== ".tex")
    throw new Error("LaTeX 主文件必须是项目内的 .tex 文件");
  const target = await safeProjectTarget(folder, normalized);
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("LaTeX 主文件不是普通文件");

  const root = await projectRoot(folder);
  const config = path.join(root, LATEX_MAIN_FILE_CONFIG);
  const configDirectory = path.dirname(config);
  const configDirectoryInfo = await lstat(configDirectory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (configDirectoryInfo?.isSymbolicLink())
    throw new Error("不允许通过符号链接写入 LaTeX 配置");
  if (configDirectoryInfo && !configDirectoryInfo.isDirectory())
    throw new Error("LaTeX 配置目录无效");
  await mkdir(configDirectory, { recursive: true });
  const temporary = `${config}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporary,
      JSON.stringify(
        { schemaVersion: CONFIG_VERSION, mainFile: normalized },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await rename(temporary, config);
  } finally {
    await rm(temporary, { force: true });
  }
  return { mainFile: normalized };
}
