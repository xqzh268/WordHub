import { app, safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

type StoredSecrets = Record<string, string>;

/** 只在主进程使用；渲染器与持久事件永远拿不到明文密钥。 */
export class ElectronCredentialStore {
  private readonly filePath = (): string =>
    path.join(app.getPath("userData"), "credentials.json");

  encryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  private async read(): Promise<StoredSecrets> {
    return readFile(this.filePath(), "utf8")
      .then((value) => JSON.parse(value) as StoredSecrets)
      .catch(() => ({}));
  }

  async get(provider: string): Promise<string | undefined> {
    if (!this.encryptionAvailable()) return undefined;
    const encrypted = (await this.read())[provider];
    if (!encrypted) return undefined;
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  private async write(values: StoredSecrets): Promise<void> {
    const filePath = this.filePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(values, null, 2), "utf8");
    await rename(temporary, filePath);
    this.decrypted = undefined;
  }

  async set(provider: string, secret: string): Promise<void> {
    if (!this.encryptionAvailable())
      throw new Error("当前系统的安全存储不可用，未保存密钥");
    const values = await this.read();
    values[provider] = safeStorage.encryptString(secret).toString("base64");
    await this.write(values);
  }

  async delete(provider: string): Promise<void> {
    const values = await this.read();
    delete values[provider];
    await this.write(values);
  }

  async configured(provider: string): Promise<boolean> {
    return Boolean(await this.get(provider));
  }

  /** 解密结果缓存在主进程内存里，保存或删除密钥时失效。 */
  private decrypted: Record<string, string> | undefined;

  /** 全部已保存的明文密钥，只用于同步给后台进程，不进入渲染器或事件。 */
  async all(): Promise<Record<string, string>> {
    if (!this.encryptionAvailable()) return {};
    if (this.decrypted) return this.decrypted;
    const keys: Record<string, string> = {};
    for (const [provider, encrypted] of Object.entries(await this.read()))
      try {
        keys[provider] = safeStorage.decryptString(
          Buffer.from(encrypted, "base64"),
        );
      } catch {
        // 无法解密的旧条目视为未保存。
      }
    this.decrypted = keys;
    return keys;
  }

  async savedProviders(): Promise<string[]> {
    return Object.keys(await this.read());
  }
}
