import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import type { Actor, Hash, Revision } from "@wordhub/contracts";
import { createId, timestamp, type WordHubStore } from "./database.js";
import type {
  ConflictPolicy,
  FileWriteResult,
  RevisionRecord,
} from "./types.js";

export const contentHash = (text: string | Buffer): Hash =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;
export type WritePhase = "before_replace" | "after_replace" | "before_commit";
export type WriteInput = {
  relativePath: string;
  content: string;
  sessionId?: string;
  artifactId?: string;
  author?: Actor;
  contentType?: string;
  runId?: string;
  taskId?: string;
  expectedHash?: Hash | null;
  conflictPolicy?: ConflictPolicy;
  approvedByEventId?: string;
};
export class FileConflictError extends Error {
  constructor(
    readonly relativePath: string,
    readonly revisionId?: string,
  ) {
    super(`文件发生外部修改，已保留用户版本：${relativePath}`);
    this.name = "FileConflictError";
  }
}
/** 所有读写共用路径检查；只对圣经目录显式开放.wordhub/bible。 */
export async function safeProjectTarget(
  folder: string,
  relativePath: string,
  allowBible = false,
): Promise<string> {
  const root = await realpath(folder);
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
        /[. ]$/u.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
    )
  )
    throw new Error("文件路径不在项目受控范围内");
  if (
    parts.some(
      (part, index) =>
        part.toLowerCase() === ".wordhub" &&
        !(allowBible && index === 0 && parts[1] === "bible"),
    )
  )
    throw new Error("不允许访问项目内部数据");
  const target = path.resolve(root, ...parts);
  if (!target.startsWith(`${root}${path.sep}`))
    throw new Error("文件路径越过项目根目录");
  for (let index = 1; index <= parts.length; index++) {
    const candidate = path.join(root, ...parts.slice(0, index));
    const info = await lstat(candidate).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (info?.isSymbolicLink())
      throw new Error("不允许通过符号链接或junction访问项目文件");
  }
  return target;
}
const queues = new Map<string, Promise<unknown>>();
const missingFile = async (target: string): Promise<Buffer | null> =>
  readFile(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
async function durableWrite(target: string, content: string): Promise<void> {
  const handle = await open(target, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export class ControlledFileWriter {
  constructor(
    private readonly store: WordHubStore,
    private readonly projectId: string,
    private readonly linkedFolder: string,
    private readonly options: {
      allowBible?: boolean;
      fault?: (phase: WritePhase) => Promise<void> | void;
    } = {},
  ) {}
  private async target(relativePath: string): Promise<string> {
    return safeProjectTarget(
      this.linkedFolder,
      relativePath,
      this.options.allowBible,
    );
  }
  private snapshotDir(artifactId: string): string {
    return path.join(
      this.store.storageDir,
      "snapshots",
      createHash("sha256").update(artifactId).digest("hex"),
    );
  }
  private current(artifactId: string): RevisionRecord | undefined {
    return [...this.store.listRevisions(this.projectId, artifactId)]
      .reverse()
      .find((revision) => revision.status === "current");
  }
  private event(
    type: string,
    input: Partial<WriteInput> & { relativePath: string },
    payload: Record<string, unknown>,
    key?: string,
  ) {
    return this.store.appendEvent({
      schemaVersion: 1,
      projectId: this.projectId,
      sessionId: input.sessionId ?? "system",
      runId: input.runId ?? "system",
      type,
      taskId: input.taskId,
      actor: input.author ?? { type: "system", id: "files" },
      occurredAt: timestamp(),
      idempotencyKey: key,
      visibility: "room",
      payload,
    });
  }
  private async snapshot(
    input: WriteInput,
    status: Revision["status"],
    parent?: RevisionRecord,
    patch?: Record<string, unknown>,
  ): Promise<RevisionRecord> {
    const artifactId = input.artifactId;
    if (!artifactId) throw new Error("修订缺少artifactId");
    const revisionId = createId("rev");
    const dir = this.snapshotDir(artifactId);
    await mkdir(dir, { recursive: true });
    const snapshotPath = path.join(dir, `${revisionId}.snapshot`);
    await durableWrite(snapshotPath, input.content);
    return this.store.addRevision({
      id: revisionId,
      projectId: this.projectId,
      artifactId,
      sessionId: input.sessionId,
      parentRevisionId: parent?.id,
      status,
      contentHash: contentHash(input.content),
      contentType: input.contentType ?? "text/markdown",
      snapshotPath,
      patch,
      author: input.author ?? { type: "user", id: "user" },
      sourceTaskId: input.taskId,
      approvedByEventId: input.approvedByEventId,
    });
  }
  /** 写前检查与轮询检测同走这里，用户版本先持久保存，再发冲突事件。 */
  async captureExternal(
    relativePath: string,
    sessionId?: string,
  ): Promise<RevisionRecord | undefined> {
    const artifactId = `file:${relativePath.replaceAll("\\", "/")}`;
    return this.serialize(relativePath, async () =>
      this.capture(
        { relativePath, artifactId, content: "", sessionId },
        this.current(artifactId),
      ),
    );
  }
  private async capture(
    input: WriteInput,
    parent?: RevisionRecord,
  ): Promise<RevisionRecord | undefined> {
    const target = await this.target(input.relativePath);
    const disk = await missingFile(target);
    const diskHash = disk ? contentHash(disk) : null;
    const expected =
      parent?.patch?.deleted === true ? null : (parent?.contentHash ?? null);
    if (diskHash === expected) return undefined;
    const revision = await this.snapshot(
      {
        ...input,
        content: disk?.toString("utf8") ?? "",
        author: { type: "system", id: "external" },
      },
      "current",
      parent,
      { relativePath: input.relativePath, deleted: disk === null },
    );
    this.event(
      "file.changed_externally",
      input,
      {
        relativePath: input.relativePath,
        previousHash: expected,
        currentHash: diskHash,
        revisionId: revision.id,
        deleted: disk === null,
        text: disk?.toString("utf8") ?? "",
      },
      `external:${revision.id}`,
    );
    return revision;
  }
  private async serialize<T>(
    relativePath: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = `${this.store.dbPath}:${relativePath.toLowerCase()}`;
    const previous = queues.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    queues.set(key, result);
    try {
      return await result;
    } finally {
      if (queues.get(key) === result) queues.delete(key);
    }
  }
  async recover(): Promise<void> {
    const pending = this.store
      .listAllRevisions(this.projectId)
      .filter(
        (revision) =>
          revision.status === "candidate" &&
          revision.patch?.phase === "pending",
      );
    for (const revision of pending) {
      const relativePath = String(revision.patch?.relativePath ?? "");
      const target = await this.target(relativePath);
      const disk = await missingFile(target);
      const temporary = path.join(
        path.dirname(target),
        `.${path.basename(target)}.${revision.id}.tmp`,
      );
      if (disk && contentHash(disk) === revision.contentHash) {
        this.store.promoteRevision(revision.id);
        this.event(
          "revision.committed",
          { relativePath, sessionId: revision.sessionId },
          {
            revisionId: revision.id,
            artifactId: revision.artifactId,
            relativePath,
            text: disk.toString("utf8"),
            recovered: true,
          },
          `revision:${revision.id}`,
        );
      } else this.store.markRevision(revision.id, "rejected");
      await rm(temporary, { force: true });
    }
    // 替换后已提交但事件尚未落库时，通过幂等键补齐。
    for (const revision of this.store
      .listAllRevisions(this.projectId)
      .filter(
        (revision) =>
          revision.status === "current" &&
          revision.patch?.phase === "committed",
      )) {
      const relativePath = String(revision.patch?.relativePath ?? "");
      this.event(
        "revision.committed",
        { relativePath, sessionId: revision.sessionId },
        {
          revisionId: revision.id,
          artifactId: revision.artifactId,
          relativePath,
          text: await readFile(revision.snapshotPath, "utf8"),
          recovered: true,
        },
        `revision:${revision.id}`,
      );
    }
  }
  async propose(input: WriteInput): Promise<RevisionRecord> {
    await this.target(input.relativePath);
    const artifactId =
      input.artifactId ?? `file:${input.relativePath.replaceAll("\\", "/")}`;
    return this.snapshot(
      { ...input, artifactId },
      "candidate",
      this.current(artifactId),
      {
        relativePath: input.relativePath,
        phase: "proposal",
        expectedHash: input.expectedHash ?? null,
      },
    );
  }
  async writeText(input: WriteInput): Promise<FileWriteResult> {
    return this.serialize(input.relativePath, () => this.write(input));
  }
  private async write(input: WriteInput): Promise<FileWriteResult> {
    const target = await this.target(input.relativePath);
    const artifactId =
      input.artifactId ?? `file:${input.relativePath.replaceAll("\\", "/")}`;
    input = { ...input, artifactId };
    const parent = this.current(artifactId);
    const external = await this.capture(input, parent);
    const current = external ?? parent;
    const disk = await missingFile(target);
    const diskHash = disk ? contentHash(disk) : null;
    const stale =
      input.expectedHash !== undefined && input.expectedHash !== diskHash;
    if (external || stale) {
      if (input.conflictPolicy === "keep-both") {
        const extension = path.extname(input.relativePath);
        const sibling = `${input.relativePath.slice(0, input.relativePath.length - extension.length)}.agent-${createId("copy")}${extension}`;
        return this.write({
          ...input,
          relativePath: sibling,
          artifactId: undefined,
          expectedHash: null,
          conflictPolicy: "reject",
        });
      }
      throw new FileConflictError(input.relativePath, external?.id);
    }
    await mkdir(path.dirname(target), { recursive: true });
    const pending = await this.snapshot(input, "candidate", current, {
      phase: "pending",
      relativePath: input.relativePath,
      expectedHash: diskHash,
    });
    const temporary = path.join(
      path.dirname(target),
      `.${path.basename(target)}.${pending.id}.tmp`,
    );
    await durableWrite(temporary, input.content);
    await this.options.fault?.("before_replace");
    // 生成快照和临时文件期间发生的手改，也必须先保存再拒绝。
    const latest = await missingFile(target);
    if ((latest ? contentHash(latest) : null) !== diskHash) {
      await this.capture(input, current);
      this.store.markRevision(pending.id, "rejected");
      await rm(temporary, { force: true });
      throw new FileConflictError(input.relativePath);
    }
    await this.target(input.relativePath);
    await rename(temporary, target);
    await this.options.fault?.("after_replace");
    await this.options.fault?.("before_commit");
    const revision = this.store.promoteRevision(pending.id);
    this.event(
      "revision.committed",
      input,
      {
        revisionId: revision.id,
        artifactId,
        relativePath: input.relativePath,
        text: input.content,
      },
      `revision:${revision.id}`,
    );
    return {
      relativePath: input.relativePath,
      revision,
      contentHash: revision.contentHash,
      bytes: Buffer.byteLength(input.content, "utf8"),
    };
  }
  async undo(input: {
    artifactId: string;
    relativePath: string;
    sessionId?: string;
    author?: Actor;
  }): Promise<FileWriteResult> {
    const revisions = this.store.listRevisions(
      this.projectId,
      input.artifactId,
    );
    const current = this.current(input.artifactId);
    const parent = revisions.find(
      (revision) => revision.id === current?.parentRevisionId,
    );
    if (!current || !parent) throw new Error("没有可撤销的修订");
    return this.writeText({
      ...input,
      content: await readFile(parent.snapshotPath, "utf8"),
      expectedHash: current.contentHash,
    });
  }
}
