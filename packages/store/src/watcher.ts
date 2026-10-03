import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type ExternalFileChange = {
  relativePath: string;
  previousHash: string | null;
  currentHash: string | null;
  detectedAt: string;
};
export type StopWatching = () => void;

const digest = (content: Buffer): string =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

/**
 * 受控文件之外的修改只报告为候选冲突，不会静默覆盖；调用方通常会把结果追加为
 * `file.changed_externally` 事件，再由用户决定是否采纳。
 */
export class ExternalFileWatcher {
  constructor(
    private readonly linkedFolder: string,
    private readonly intervalMs = 300,
  ) {}

  watch(
    relativePath: string,
    expectedHash: string | null,
    onChange: (change: ExternalFileChange) => void,
  ): StopWatching {
    const target = path.resolve(this.linkedFolder, relativePath);
    let previousHash = expectedHash;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      const currentHash = await readFile(target)
        .then(digest)
        .catch(() => null);
      if (currentHash !== previousHash) {
        const change = {
          relativePath,
          previousHash,
          currentHash,
          detectedAt: new Date().toISOString(),
        };
        previousHash = currentHash;
        onChange(change);
      }
    };
    const timer = setInterval(() => {
      void poll();
    }, this.intervalMs);
    void poll();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }
}
