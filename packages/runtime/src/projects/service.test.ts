import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectService } from "./service.js";

let root: string;
const services = new Set<ProjectService>();

async function openService(storage = "appdata") {
  const service = new ProjectService(path.join(root, storage));
  services.add(service);
  await service.init();
  return service;
}

const descriptorPath = (folder: string) =>
  path.join(folder, ".wordhub", "project.json");

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "wordhub-projects-"));
});

afterEach(async () => {
  for (const service of services) service.close();
  services.clear();
  await rm(root, { recursive: true, force: true });
});

describe("项目类型", () => {
  it("写入项目类型，重开或从目录重新链接时保留学术类型", async () => {
    const service = await openService();
    const folderPath = path.join(root, "论文");
    const academic = await service.create({
      name: "论文",
      folderPath,
      kind: "academic",
    });
    expect(academic.kind).toBe("academic");
    expect(
      JSON.parse(await readFile(descriptorPath(folderPath), "utf8")),
    ).toMatchObject({ projectId: academic.id, kind: "academic" });
    expect(
      (await service.store(academic.id)).getProject(academic.id)?.kind,
    ).toBe("academic");

    await expect(service.ensure({ projectId: academic.id })).rejects.toThrow(
      "学术项目目前尚未开放写作功能",
    );
    await expect(service.ensure({ projectPath: folderPath })).rejects.toThrow(
      "学术项目目前尚未开放写作功能",
    );
    await expect(
      access(path.join(folderPath, "chapters")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    service.close();
    services.delete(service);
    const reopened = await openService();
    expect(reopened.recent()).toMatchObject([
      { id: academic.id, kind: "academic" },
    ]);
    const relinked = await reopened.create({
      name: "论文",
      folderPath,
      kind: "novel",
    });
    expect(relinked).toMatchObject({
      id: academic.id,
      sessionId: academic.sessionId,
      kind: "academic",
    });

    const otherProfile = await openService("另一个应用目录");
    expect(
      await otherProfile.create({ name: "论文", folderPath }),
    ).toMatchObject({
      id: academic.id,
      kind: "academic",
    });
  });

  it("迁移无 kind 的旧数据库，元数据和文件夹重连均默认小说", async () => {
    const service = await openService();
    const folderPath = path.join(root, "小说");
    const novel = await service.create({ name: "小说", folderPath });
    const databasePath = (await service.store(novel.id)).dbPath;
    service.close();
    services.delete(service);

    const legacy = new DatabaseSync(databasePath);
    try {
      legacy.exec(
        "ALTER TABLE projects DROP COLUMN kind; PRAGMA user_version = 3;",
      );
    } finally {
      legacy.close();
    }
    await writeFile(
      path.join(root, "appdata", "projects.json"),
      JSON.stringify([
        {
          id: novel.id,
          name: novel.name,
          folderPath,
          createdAt: novel.createdAt,
          updatedAt: novel.updatedAt,
        },
      ]),
    );
    await writeFile(
      descriptorPath(folderPath),
      JSON.stringify({
        schemaVersion: 1,
        projectId: novel.id,
        linkedFolder: folderPath,
      }),
    );

    const reopened = await openService();
    expect(reopened.recent()).toMatchObject([{ id: novel.id, kind: "novel" }]);
    await expect(
      reopened.ensure({ projectId: novel.id }),
    ).resolves.toMatchObject({
      projectId: novel.id,
      sessionId: novel.sessionId,
    });

    const otherProfile = await openService("另一个应用目录");
    const imported = await otherProfile.create({
      name: "小说",
      folderPath,
      kind: "academic",
    });
    expect(imported).toMatchObject({ id: novel.id, kind: "novel" });
    expect(
      JSON.parse(await readFile(descriptorPath(folderPath), "utf8")),
    ).toMatchObject({ projectId: novel.id, kind: "novel" });
  });

  it("串行链接同一文件夹并在重启后恢复最后一次打开的项目", async () => {
    const service = await openService();
    const first = { name: "甲", folderPath: path.join(root, "甲") };
    const [academic, sameFolder] = await Promise.all([
      service.create({ ...first, kind: "academic" }),
      service.create({ ...first, kind: "novel" }),
    ]);
    expect(sameFolder).toMatchObject({ id: academic.id, kind: "academic" });
    expect(service.recent()).toHaveLength(1);

    const novel = await service.create({
      name: "乙",
      folderPath: path.join(root, "乙"),
    });
    expect(service.recent()[0]?.id).toBe(novel.id);
    await service.create(first);
    expect(service.recent()[0]?.id).toBe(academic.id);

    service.close();
    services.delete(service);
    const reopened = await openService();
    expect(reopened.recent().map(({ id }) => id)).toEqual([
      academic.id,
      novel.id,
    ]);
  });

  it("保存失败的项目不进入最近列表，重试复用已写入的身份", async () => {
    const service = await openService();
    const input = { name: "论文", folderPath: path.join(root, "论文") };
    const save = service.saveJson.bind(service);
    const saving = vi.spyOn(service, "saveJson");
    saving.mockRejectedValueOnce(new Error("项目文件写入失败"));
    await expect(
      service.create({ ...input, kind: "academic" }),
    ).rejects.toThrow("项目文件写入失败");
    expect(service.recent()).toEqual([]);

    saving.mockImplementation((file, value) =>
      file.endsWith("projects.json")
        ? Promise.reject(new Error("最近列表写入失败"))
        : save(file, value),
    );
    await expect(
      service.create({ ...input, kind: "academic" }),
    ).rejects.toThrow("最近列表写入失败");
    expect(service.recent()).toEqual([]);
    const descriptor = JSON.parse(
      await readFile(descriptorPath(input.folderPath), "utf8"),
    );
    saving.mockRestore();

    expect(await service.create(input)).toMatchObject({
      id: descriptor.projectId,
      kind: "academic",
    });
  });
});
