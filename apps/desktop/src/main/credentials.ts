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

  async set(provider: string, secret: string): Promise<void> {
    if (!this.encryptionAvailable())
      throw new Error("当前系统的安全存储不可用，未保存密钥");
    const values = await this.read();
    values[provider] = safeStorage.encryptString(secret).toString("base64");
    const filePath = this.filePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(values, null, 2), "utf8");
    await rename(temporary, filePath);
  }

  async delete(provider: string): Promise<void> {
    const values = await this.read();
    delete values[provider];
    const filePath = this.filePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(values, null, 2), "utf8");
    await rename(temporary, filePath);
  }

  async configured(provider: string): Promise<boolean> {
    return Boolean(await this.get(provider));
  }
}
