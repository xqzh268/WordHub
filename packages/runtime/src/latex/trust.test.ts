import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LatexTrustStore, TRUST_FILE, isFreshFolder } from "./trust.js";

let base: string;
let storage: string;
let project: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "wh-trust-"));
  storage = path.join(base, "appdata");
  project = path.join(base, "论文");
  await mkdir(project);
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("LatexTrustStore", () => {
  it("默认未信任", async () => {
    const store = new LatexTrustStore(storage);
    expect(await store.status("p1", project)).toEqual({
      trusted: false,
      reason: "untrusted",
    });
  });

  it("信任后持久化在应用数据目录，而不是项目文件夹", async () => {
    const store = new LatexTrustStore(storage);
    const state = await store.set("p1", project, true, "user");
    expect(state).toMatchObject({ trusted: true, reason: "user" });
    // 新实例也能读到
    expect(
      (await new LatexTrustStore(storage).status("p1", project)).trusted,
    ).toBe(true);
    const saved = JSON.parse(
      await readFile(path.join(storage, TRUST_FILE), "utf8"),
    );
    expect(saved.projects.p1.trusted).toBe(true);
    await expect(
      readFile(path.join(project, ".wordhub", "latex-trust.json")),
    ).rejects.toThrow();
  });

  it("项目文件夹内自带的信任字段不起作用", async () => {
    await mkdir(path.join(project, ".wordhub"));
    await writeFile(
      path.join(project, ".wordhub", "project.json"),
      JSON.stringify({ projectId: "p1", trusted: true, latexTrusted: true }),
    );
    const store = new LatexTrustStore(storage);
    expect((await store.status("p1", project)).trusted).toBe(false);
  });

  it("同一项目 ID 换了文件夹不继承信任", async () => {
    const store = new LatexTrustStore(storage);
    await store.set("p1", project, true, "created");
    const other = path.join(base, "别处");
    await mkdir(other);
    expect((await store.status("p1", other)).trusted).toBe(false);
    expect((await store.status("p2", project)).trusted).toBe(false);
  });

  it("可撤销信任", async () => {
    const store = new LatexTrustStore(storage);
    await store.set("p1", project, true, "user");
    await store.set("p1", project, false, "user");
    expect((await store.status("p1", project)).trusted).toBe(false);
  });

  it("文件损坏时按未信任处理", async () => {
    await mkdir(storage, { recursive: true });
    await writeFile(path.join(storage, TRUST_FILE), "{not json");
    const store = new LatexTrustStore(storage);
    expect((await store.status("p1", project)).trusted).toBe(false);
  });

  it("并发写入不互相覆盖", async () => {
    const store = new LatexTrustStore(storage);
    await Promise.all(
      ["a", "b", "c", "d"].map((id) => store.set(id, project, true, "user")),
    );
    for (const id of ["a", "b", "c", "d"])
      expect((await store.status(id, project)).trusted).toBe(true);
  });

  it("特殊键名 __proto__ 不会命中", async () => {
    const store = new LatexTrustStore(storage);
    expect((await store.status("__proto__", project)).trusted).toBe(false);
  });
});

describe("isFreshFolder", () => {
  it("不存在或为空算新建，有内容不算", async () => {
    expect(await isFreshFolder(path.join(base, "nope"))).toBe(true);
    expect(await isFreshFolder(project)).toBe(true);
    await writeFile(path.join(project, "main.tex"), "x");
    expect(await isFreshFolder(project)).toBe(false);
  });
});
