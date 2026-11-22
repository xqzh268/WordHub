import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

/**
 * LaTeX 项目信任状态。保存在应用数据目录（不在项目文件夹内），
 * 恶意项目无法自己预先标记为已信任。以“项目 ID + 真实路径”为键：
 * 同一 ID 换了文件夹（拷贝、改名后重新链接）不继承信任。
 */
export type LatexTrustReason = "created" | "user";

export interface LatexTrustState {
  trusted: boolean;
  reason: LatexTrustReason | "untrusted";
  updatedAt?: string;
}

interface TrustRecord {
  realPath: string;
  trusted: boolean;
  reason: LatexTrustReason;
  updatedAt: string;
}
interface TrustFile {
  schemaVersion: 1;
  projects: Record<string, TrustRecord>;
}

export const TRUST_FILE = "latex-trust.json";

const normalize = (target: string): string =>
  process.platform === "win32" ? target.toLowerCase() : target;

/** 文件夹不存在或完全为空时，视为在 WordHub 内新建（链接后会写入 .wordhub，再次打开不再算新建）。 */
export async function isFreshFolder(folder: string): Promise<boolean> {
  try {
    const names = await readdir(folder);
    return names.length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

export class LatexTrustStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly storageRoot: string) {}

  private get file(): string {
    return path.join(this.storageRoot, TRUST_FILE);
  }

  private async load(): Promise<TrustFile> {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as TrustFile;
      if (raw && typeof raw === "object" && raw.projects) return raw;
    } catch (error) {
      // 文件损坏时按“全部未信任”处理，比误信任安全。
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(
          "[wordhub-worker] latex-trust.json 无法读取，按未信任处理",
        );
      }
    }
    return { schemaVersion: 1, projects: {} };
  }

  private async save(data: TrustFile): Promise<void> {
    await mkdir(this.storageRoot, { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
    await rename(temporary, this.file);
  }

  /** 串行执行读改写，避免并发请求互相覆盖。 */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async status(projectId: string, folder: string): Promise<LatexTrustState> {
    const data = await this.load();
    const record = Object.hasOwn(data.projects, projectId)
      ? data.projects[projectId]
      : undefined;
    const real = normalize(await realpath(folder));
    if (!record?.trusted || normalize(record.realPath) !== real)
      return { trusted: false, reason: "untrusted" };
    return {
      trusted: true,
      reason: record.reason,
      updatedAt: record.updatedAt,
    };
  }

  set(
    projectId: string,
    folder: string,
    trusted: boolean,
    reason: LatexTrustReason,
  ): Promise<LatexTrustState> {
    return this.serial(async () => {
      const data = await this.load();
      const realPath = await realpath(folder);
      const updatedAt = new Date().toISOString();
      if (trusted)
        data.projects[projectId] = { realPath, trusted, reason, updatedAt };
      else delete data.projects[projectId];
      await this.save(data);
      return trusted
        ? { trusted, reason, updatedAt }
        : { trusted: false, reason: "untrusted" };
    });
  }
}
