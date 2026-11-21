import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_PROJECT_KIND,
  isProjectKind,
  type ProjectKind,
} from "@wordhub/contracts";
import {
  ControlledFileWriter,
  WordHubStore,
  createId,
  type ProjectRecord,
} from "@wordhub/store";

type ProjectInput = {
  name: string;
  folderPath: string;
  projectId?: string;
  kind?: ProjectKind;
};
type ProjectDescriptor = { projectId?: string; kind?: unknown };
type IndexedProject = Omit<ProjectRecord, "kind"> & { kind?: unknown };

/** 注册表仅用来发现项目；数据库与链接文件夹描述符保留项目身份。 */
export class ProjectService {
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly stores = new Map<string, WordHubStore>();
  private readonly recovery = new Map<string, Promise<WordHubStore>>();
  private createQueue: Promise<void> = Promise.resolve();
  constructor(readonly storageRoot: string) {}
  async init(): Promise<void> {
    await mkdir(path.join(this.storageRoot, "projects"), { recursive: true });
    const records = await readFile(
      path.join(this.storageRoot, "projects.json"),
      "utf8",
    )
      .then((text) => JSON.parse(text) as IndexedProject[])
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
    // 启动时完成运行与写盘恢复，普通读取不重复清扫正在进行的写入。
    for (const record of records) {
      const store = await this.store(record.id);
      const project = store.getProject(record.id);
      this.projects.set(record.id, {
        ...record,
        ...project,
        kind:
          project?.kind ??
          (isProjectKind(record.kind) ? record.kind : DEFAULT_PROJECT_KIND),
        updatedAt: record.updatedAt,
      });
    }
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
  create(input: ProjectInput): Promise<ProjectRecord & { sessionId: string }> {
    // 同一文件夹的并发链接共享身份，并按顺序写回最近项目列表。
    const result = this.createQueue.then(() => this.link(input));
    this.createQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async link(
    input: ProjectInput,
  ): Promise<ProjectRecord & { sessionId: string }> {
    if (input.kind !== undefined && !isProjectKind(input.kind))
      throw new Error("无效的项目类型");
    await mkdir(input.folderPath, { recursive: true });
    const normalize = (folder: string) =>
      process.platform === "win32"
        ? path.resolve(folder).toLowerCase()
        : path.resolve(folder);
    const descriptor: ProjectDescriptor = await readFile(
      path.join(input.folderPath, ".wordhub/project.json"),
      "utf8",
    )
      .then((text) => JSON.parse(text) as ProjectDescriptor)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return {};
        throw error;
      });
    if (descriptor.kind !== undefined && !isProjectKind(descriptor.kind))
      throw new Error("项目文件中包含不支持的项目类型");
    const indexed = this.recent().find(
      (record) => normalize(record.folderPath) === normalize(input.folderPath),
    );
    const persistedId = indexed?.id ?? descriptor.projectId ?? input.projectId;
    const id = persistedId ?? createId("project");
    const existingStore =
      persistedId === undefined ? undefined : await this.store(id);
    const persisted = existingStore?.getProject(id);
    if (
      persisted &&
      normalize(persisted.folderPath) !== normalize(input.folderPath)
    )
      throw new Error("项目描述符指向另一文件夹，不能复用");
    const folderPath = persisted?.folderPath ?? path.resolve(input.folderPath);
    const kind =
      persisted?.kind ??
      descriptor.kind ??
      indexed?.kind ??
      (descriptor.projectId ? DEFAULT_PROJECT_KIND : input.kind) ??
      DEFAULT_PROJECT_KIND;
    // 先保存项目身份，后续任一步骤重试时仍能沿用原 ID 和类型。
    await this.saveJson(path.join(folderPath, ".wordhub/project.json"), {
      schemaVersion: 1,
      projectId: id,
      kind,
      linkedFolder: folderPath,
      storage: "appData/WordHub/projects",
    });
    const store = existingStore ?? (await this.store(id));
    const project =
      persisted ??
      store.createProject({ id, name: input.name, folderPath, kind });
    const session =
      store.listSessions(id)[0] ??
      store.createSession({ projectId: id, title: "新会话" });
    const recent = this.recent();
    // 即使连续打开项目落在同一毫秒，重新打开的项目也应排在最前。
    const latestTimestamp = Date.parse(recent[0]?.updatedAt ?? "") || 0;
    const updatedAt = new Date(
      Math.max(Date.now(), latestTimestamp + 1),
    ).toISOString();
    const opened = { ...project, updatedAt };
    await this.saveJson(path.join(this.storageRoot, "projects.json"), [
      opened,
      ...recent.filter((record) => record.id !== id),
    ]);
    this.projects.set(id, opened);
    return { ...opened, sessionId: session.id };
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
    if (project.kind !== "novel")
      throw new Error("学术项目目前尚未开放写作功能");
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
