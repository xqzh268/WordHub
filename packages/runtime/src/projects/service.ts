import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ControlledFileWriter,
  WordHubStore,
  createId,
  type ProjectRecord,
} from "@wordhub/store";

/** 注册表仅用来发现项目；数据库与链接文件夹描述符保留项目身份。 */
export class ProjectService {
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly stores = new Map<string, WordHubStore>();
  private readonly recovery = new Map<string, Promise<WordHubStore>>();
  constructor(readonly storageRoot: string) {}
  async init(): Promise<void> {
    await mkdir(path.join(this.storageRoot, "projects"), { recursive: true });
    const records = await readFile(
      path.join(this.storageRoot, "projects.json"),
      "utf8",
    )
      .then((text) => JSON.parse(text) as ProjectRecord[])
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
    for (const record of records) this.projects.set(record.id, record);
    // 启动时完成运行与写盘恢复，普通读取不重复清扫正在进行的写入。
    for (const project of this.projects.values()) await this.store(project.id);
  }
  private open(id: string): WordHubStore {
    if (!/^[a-zA-Z0-9_-]+$/u.test(id)) throw new Error("项目ID无效");
    let store = this.stores.get(id);
    if (!store) {
      store = new WordHubStore(path.join(this.storageRoot, "projects", id));
      store.recoverInterruptedRuns();
      this.stores.set(id, store);
    }
    return store;
  }
  async store(id: string): Promise<WordHubStore> {
    let recovering = this.recovery.get(id);
    if (!recovering) {
      const store = this.open(id);
      recovering = (async () => {
        const project = store.getProject(id);
        if (project)
          await new ControlledFileWriter(store, id, project.folderPath, {
            allowBible: true,
          }).recover();
        return store;
      })();
      this.recovery.set(id, recovering);
    }
    return recovering;
  }
  recent(): ProjectRecord[] {
    return [...this.projects.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }
  async create(input: {
    name: string;
    folderPath: string;
    projectId?: string;
  }): Promise<ProjectRecord & { sessionId: string }> {
    await mkdir(input.folderPath, { recursive: true });
    const normalize = (folder: string) =>
      process.platform === "win32"
        ? path.resolve(folder).toLowerCase()
        : path.resolve(folder);
    const descriptor: { projectId?: string } = await readFile(
      path.join(input.folderPath, ".wordhub/project.json"),
      "utf8",
    )
      .then((text) => JSON.parse(text) as { projectId?: string })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return {};
        throw error;
      });
    const indexed = this.recent().find(
      (record) => normalize(record.folderPath) === normalize(input.folderPath),
    );
    const id =
      indexed?.id ??
      descriptor.projectId ??
      input.projectId ??
      createId("project");
    const store = await this.store(id);
    const persisted = store.getProject(id);
    if (
      persisted &&
      normalize(persisted.folderPath) !== normalize(input.folderPath)
    )
      throw new Error("项目描述符指向另一文件夹，不能复用");
    const project =
      persisted ??
      store.createProject({
        id,
        name: input.name,
        folderPath: input.folderPath,
      });
    const session =
      store.listSessions(id)[0] ??
      store.createSession({ projectId: id, title: "新会话" });
    this.projects.set(id, project);
    await mkdir(path.join(project.folderPath, ".wordhub"), { recursive: true });
    await this.saveJson(
      path.join(project.folderPath, ".wordhub/project.json"),
      {
        schemaVersion: 1,
        projectId: id,
        linkedFolder: project.folderPath,
        storage: "appData/WordHub/projects",
      },
    );
    await this.saveJson(
      path.join(this.storageRoot, "projects.json"),
      this.recent(),
    );
    return { ...project, sessionId: session.id };
  }
  async ensure(input: {
    projectId?: string;
    projectPath?: string;
    sessionId?: string;
  }): Promise<{
    store: WordHubStore;
    projectId: string;
    projectPath: string;
    sessionId: string;
  }> {
    let id = input.projectId;
    if (!id)
      id = (
        await this.create({
          name: input.projectPath
            ? path.basename(input.projectPath)
            : "未命名项目",
          folderPath:
            input.projectPath ??
            path.join(this.storageRoot, "ephemeral-folder"),
          projectId: input.projectPath ? undefined : "ephemeral",
        })
      ).id;
    const store = await this.store(id);
    const project = store.getProject(id);
    if (!project) throw new Error("项目不存在");
    const sessionId =
      input.sessionId &&
      store.listSessions(id).some((session) => session.id === input.sessionId)
        ? input.sessionId
        : (store.listSessions(id)[0]?.id ??
          store.createSession({ projectId: id, title: "新会话" }).id);
    return { store, projectId: id, projectPath: project.folderPath, sessionId };
  }
  async saveJson(file: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
    await rename(temporary, file);
  }
  close(): void {
    for (const store of this.stores.values()) store.close();
    this.stores.clear();
  }
}
