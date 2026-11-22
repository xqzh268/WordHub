import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type {
  LatexCompileStatusPayload,
  LatexPdfPreviewPayload,
} from "@wordhub/contracts";

const PDF_LIMIT = 32 * 1024 * 1024;
const TOTAL_LIMIT = 128 * 1024 * 1024;
const ARTIFACT_LIMIT = 8;
const FAILURE_STATUSES = new Set<LatexCompileStatusPayload>([
  "failed",
  "timeout",
  "aborted",
  "missing-tool",
  "offline-cache-miss",
  "untrusted",
]);

interface PreviewMetadata {
  version: 1;
  projectRoot: string;
  mainFile: string;
  revision: string;
  compiledAt: string;
  stale: boolean;
  lastFailure?: LatexCompileStatusPayload;
}

export function normalizeWindowsPathForComparison(value: string): string {
  const resolved = path.win32.resolve(value);
  const extendedUncPrefix = "\\\\?\\UNC\\";
  let normalized = resolved;
  if (resolved.toLowerCase().startsWith(extendedUncPrefix.toLowerCase())) {
    normalized = `\\\\${resolved.slice(extendedUncPrefix.length)}`;
  } else if (/^\\\\\?\\[a-z]:\\/iu.test(resolved)) {
    normalized = resolved.slice("\\\\?\\".length);
  }
  return path.win32.normalize(normalized).toLowerCase();
}

const samePath = (left: string, right: string): boolean => {
  if (process.platform === "win32")
    return (
      normalizeWindowsPathForComparison(left) ===
      normalizeWindowsPathForComparison(right)
    );
  return path.resolve(left) === path.resolve(right);
};

function isMetadata(value: unknown): value is PreviewMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Partial<PreviewMetadata>;
  return (
    metadata.version === 1 &&
    typeof metadata.projectRoot === "string" &&
    typeof metadata.mainFile === "string" &&
    typeof metadata.revision === "string" &&
    /^[0-9a-f-]{36}$/u.test(metadata.revision) &&
    typeof metadata.compiledAt === "string" &&
    typeof metadata.stale === "boolean" &&
    (metadata.lastFailure === undefined ||
      FAILURE_STATUSES.has(metadata.lastFailure))
  );
}

export function createLatexPdfPreviewStore(storageRoot: string) {
  const previewRoot = path.join(storageRoot, "latex-previews");
  let writes = Promise.resolve();

  const directoryFor = (projectId: string) =>
    path.join(
      previewRoot,
      createHash("sha256").update(projectId).digest("hex"),
    );
  const metadataPathFor = (directory: string) =>
    path.join(directory, "preview.json");
  const artifactPathFor = (directory: string, revision: string) =>
    path.join(directory, `${revision}.pdf`);

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = writes.then(operation, operation);
    writes = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  async function readMetadata(
    directory: string,
  ): Promise<PreviewMetadata | undefined> {
    try {
      const value: unknown = JSON.parse(
        await readFile(metadataPathFor(directory), "utf8"),
      );
      return isMetadata(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async function writeMetadata(
    directory: string,
    metadata: PreviewMetadata,
  ): Promise<void> {
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(metadata), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, metadataPathFor(directory));
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async function trimStorage(currentDirectory: string): Promise<void> {
    const directories = await readdir(previewRoot, { withFileTypes: true });
    const entries: Array<{
      directory: string;
      metadata: PreviewMetadata;
      size: number;
    }> = [];
    for (const entry of directories) {
      if (!entry.isDirectory() || !/^[0-9a-f]{64}$/u.test(entry.name)) continue;
      const directory = path.join(previewRoot, entry.name);
      const metadata = await readMetadata(directory);
      if (!metadata) {
        if (directory !== currentDirectory)
          await rm(directory, { recursive: true, force: true });
        continue;
      }
      const info = await stat(
        artifactPathFor(directory, metadata.revision),
      ).catch(() => undefined);
      if (!info?.isFile()) {
        if (directory !== currentDirectory)
          await rm(directory, { recursive: true, force: true });
        continue;
      }
      entries.push({ directory, metadata, size: info.size });
    }
    entries.sort((left, right) =>
      right.metadata.compiledAt.localeCompare(left.metadata.compiledAt),
    );
    let bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    let count = entries.length;
    for (const entry of entries.reverse()) {
      if (count <= ARTIFACT_LIMIT && bytes <= TOTAL_LIMIT) break;
      if (entry.directory === currentDirectory) continue;
      await rm(entry.directory, { recursive: true, force: true });
      count -= 1;
      bytes -= entry.size;
    }
  }

  async function readPdfBytes(filePath: string): Promise<Uint8Array> {
    const fileInfo = await lstat(filePath);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink())
      throw new Error("PDF 文件无效");
    const handle = await open(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size <= 0 || info.size > PDF_LIMIT)
        throw new Error("PDF 大小无效");
      const chunks: Buffer[] = [];
      let total = 0;
      while (total <= PDF_LIMIT) {
        const chunk = Buffer.allocUnsafe(
          Math.min(64 * 1024, PDF_LIMIT + 1 - total),
        );
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (bytesRead === 0) break;
        chunks.push(chunk.subarray(0, bytesRead));
        total += bytesRead;
      }
      if (total > PDF_LIMIT) throw new Error("PDF 大小无效");
      const data = Buffer.concat(chunks, total);
      const header = data.subarray(0, Math.min(data.length, 1024));
      if (!header.includes(Buffer.from("%PDF-", "ascii")))
        throw new Error("PDF 文件无效");
      return data;
    } finally {
      await handle.close();
    }
  }

  return {
    recordSuccess(
      projectId: string,
      projectFolder: string,
      mainFile: string,
      candidatePath: string,
    ): Promise<boolean> {
      return serialize(async () => {
        let createdArtifact: string | undefined;
        try {
          const projectRoot = await realpath(projectFolder);
          if (path.isAbsolute(mainFile)) return false;
          const mainPath = path.resolve(projectRoot, mainFile);
          const sourceRelative = path.relative(projectRoot, mainPath);
          if (
            sourceRelative === ".." ||
            sourceRelative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(sourceRelative)
          )
            return false;
          const outputPath = path.join(
            projectRoot,
            ".wordhub",
            "build",
            "latex",
          );
          const realOutput = await realpath(outputPath);
          if (!samePath(realOutput, outputPath)) return false;
          const expectedPath = path.join(
            realOutput,
            `${path.basename(mainPath, path.extname(mainPath))}.pdf`,
          );
          if (!samePath(await realpath(candidatePath), expectedPath))
            return false;
          const fileInfo = await lstat(expectedPath);
          if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) return false;
          const data = await readPdfBytes(expectedPath);
          const directory = directoryFor(projectId);
          await mkdir(directory, { recursive: true, mode: 0o700 });
          const revision = randomUUID();
          createdArtifact = artifactPathFor(directory, revision);
          await writeFile(createdArtifact, data, { flag: "wx", mode: 0o600 });
          const previous = await readMetadata(directory);
          const metadata: PreviewMetadata = {
            version: 1,
            projectRoot,
            mainFile: mainFile.replaceAll("\\", "/"),
            revision,
            compiledAt: new Date().toISOString(),
            stale: false,
          };
          await writeMetadata(directory, metadata);
          createdArtifact = undefined;
          try {
            if (previous && previous.revision !== revision)
              await rm(artifactPathFor(directory, previous.revision), {
                force: true,
              });
            await trimStorage(directory);
          } catch {
            // Cleanup is best-effort after the new metadata atomically commits.
          }
          return true;
        } catch {
          if (createdArtifact) await rm(createdArtifact, { force: true });
          return false;
        }
      });
    },

    markStale(
      projectId: string,
      projectFolder: string,
      failure: LatexCompileStatusPayload,
    ): Promise<void> {
      return serialize(async () => {
        if (!FAILURE_STATUSES.has(failure)) return;
        const directory = directoryFor(projectId);
        const metadata = await readMetadata(directory);
        if (!metadata) return;
        try {
          if (!samePath(metadata.projectRoot, await realpath(projectFolder)))
            return;
          await writeMetadata(directory, {
            ...metadata,
            stale: true,
            lastFailure: failure,
          });
        } catch {
          // Keep the last artifact readable if status metadata cannot be updated.
        }
      });
    },

    async read(
      projectId: string,
      projectFolder: string,
    ): Promise<LatexPdfPreviewPayload> {
      const directory = directoryFor(projectId);
      const metadata = await readMetadata(directory);
      if (!metadata) return { status: "empty" };
      try {
        const projectRoot = await realpath(projectFolder);
        if (!samePath(metadata.projectRoot, projectRoot))
          return {
            status: "unavailable",
            message: "此项目的 PDF 预览不可用，请重新编译。",
          };
        const data = await readPdfBytes(
          artifactPathFor(directory, metadata.revision),
        );
        return {
          status: "ready",
          mainFile: metadata.mainFile,
          revision: metadata.revision,
          compiledAt: metadata.compiledAt,
          stale: metadata.stale,
          ...(metadata.lastFailure
            ? { lastFailure: metadata.lastFailure }
            : {}),
          data,
        };
      } catch {
        return {
          status: "unavailable",
          message: "此项目的 PDF 预览不可用，请重新编译。",
        };
      }
    },
  };
}
