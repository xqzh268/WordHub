import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ChapterInfo,
  chapterNumberFromName,
  compareChapters,
  listChapters,
  parseChapterNumber,
  readChapter,
  watchChapters,
} from "./service.js";

const roots: string[] = [];
const project = async (files: Record<string, string> = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), "wordhub-chapters-"));
  roots.push(root);
  const folder = path.join(root, "中文项目");
  await mkdir(path.join(folder, "chapters"), { recursive: true });
  for (const [name, text] of Object.entries(files))
    await writeFile(path.join(folder, "chapters", name), text, "utf8");
  return { root, folder };
};
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("章号解析", () => {
  it.each([
    ["三", 3],
    ["十", 10],
    ["十二", 12],
    ["二十", 20],
    ["二十三", 23],
    ["一百", 100],
    ["一百零五", 105],
    ["两", 2],
    ["03", 3],
    ["12", 12],
  ])("%s → %d", (token, expected) => {
    expect(parseChapterNumber(token)).toBe(expected);
  });

  it("非数字返回 undefined", () => {
    expect(parseChapterNumber("序")).toBeUndefined();
    expect(parseChapterNumber("")).toBeUndefined();
  });

  it.each([
    ["第三章.md", 3],
    ["第3章.md", 3],
    ["第03章.md", 3],
    ["第十二章 坊门.md", 12],
    ["第 十 章.md", 10],
    ["第五回.md", 5],
    ["03-坊门.md", 3],
    ["chapter-7.md", 7],
    ["序章.md", undefined],
    ["人物小传.md", undefined],
  ])("文件名 %s → %s", (name, expected) => {
    expect(chapterNumberFromName(name)).toBe(expected);
  });
});

describe("章节排序", () => {
  const make = (name: string): ChapterInfo => ({
    path: `chapters/${name}`,
    name,
    number: chapterNumberFromName(name),
    size: 1,
    mtimeMs: 1,
  });
  it("第十章排在第二章之后，而不是字典序里的前面", () => {
    const names = [
      "第十章.md",
      "第二章.md",
      "第一章.md",
      "第三章.md",
      "第十一章.md",
    ];
    expect(
      names
        .map(make)
        .sort(compareChapters)
        .map((c) => c.name),
    ).toEqual([
      "第一章.md",
      "第二章.md",
      "第三章.md",
      "第十章.md",
      "第十一章.md",
    ]);
  });
  it("有章号的在前，无章号的按名称排在后面", () => {
    const names = ["序章.md", "第二章.md", "后记.md", "第一章.md"];
    const sorted = names
      .map(make)
      .sort(compareChapters)
      .map((c) => c.name);
    expect(sorted.slice(0, 2)).toEqual(["第一章.md", "第二章.md"]);
    expect(new Set(sorted.slice(2))).toEqual(new Set(["序章.md", "后记.md"]));
  });
});

describe("列出与读取章节", () => {
  it("列出章节，忽略隐藏文件、临时文件和其他扩展名", async () => {
    const { folder } = await project({
      "第二章.md": "二",
      "第一章.md": "一",
      "第十章.md": "十",
      ".第三章.md.rev_1.tmp": "临时",
      "备忘.docx": "x",
      "第四章.txt": "四",
    });
    const names = (await listChapters(folder)).map((c) => c.name);
    expect(names).toEqual([
      "第一章.md",
      "第二章.md",
      "第四章.txt",
      "第十章.md",
    ]);
  });

  it("没有 chapters 目录时返回空列表而不是报错", async () => {
    const { root } = await project();
    expect(await listChapters(path.join(root, "不存在"))).toEqual([]);
  });

  it("读取内容并带上哈希与修改时间", async () => {
    const { folder } = await project({ "第一章.md": "暮鼓三百声。" });
    const chapter = await readChapter(folder, "chapters/第一章.md");
    expect(chapter.content).toBe("暮鼓三百声。");
    expect(chapter.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(chapter.mtimeMs).toBeGreaterThan(0);
  });

  it("接受反斜杠路径", async () => {
    const { folder } = await project({ "第一章.md": "一" });
    expect((await readChapter(folder, "chapters\\第一章.md")).path).toBe(
      "chapters/第一章.md",
    );
  });

  it.each([
    "../secret.md",
    "chapters/../secret.md",
    ".wordhub/bible/bible.md",
    "notes/备忘.md",
    "chapters/第一章.exe",
    "/etc/passwd",
    "C:/Windows/win.ini",
  ])("拒绝越界路径 %s", async (bad) => {
    const { folder } = await project({ "第一章.md": "一" });
    await expect(readChapter(folder, bad)).rejects.toThrow();
  });

  it("拒绝通过符号链接读到项目外的文件", async () => {
    const { root, folder } = await project();
    await writeFile(path.join(root, "outside.md"), "项目外", "utf8");
    try {
      await symlink(
        path.join(root, "outside.md"),
        path.join(folder, "chapters", "链接.md"),
        "file",
      );
    } catch {
      return; // 没有创建符号链接的权限（Windows 非开发者模式），跳过
    }
    expect((await listChapters(folder)).map((c) => c.name)).not.toContain(
      "链接.md",
    );
    await expect(readChapter(folder, "chapters/链接.md")).rejects.toThrow();
  });
});

describe("章节监听", () => {
  it("建立基线后，新增、修改、删除都会触发回调", async () => {
    const { folder } = await project({ "第一章.md": "一" });
    const seen: string[][] = [];
    const stop = watchChapters(
      folder,
      (chapters) => seen.push(chapters.map((c) => c.name)),
      30,
    );
    await wait(120);
    expect(seen).toEqual([]); // 基线不触发

    await writeFile(path.join(folder, "chapters", "第二章.md"), "二", "utf8");
    await wait(200);
    expect(seen.at(-1)).toEqual(["第一章.md", "第二章.md"]);

    const file = path.join(folder, "chapters", "第一章.md");
    await writeFile(file, "一（改）", "utf8");
    const later = new Date(Date.now() + 5000);
    await utimes(file, later, later);
    const before = seen.length;
    await wait(200);
    expect(seen.length).toBeGreaterThan(before);

    await rm(path.join(folder, "chapters", "第二章.md"));
    await wait(200);
    expect(seen.at(-1)).toEqual(["第一章.md"]);
    stop();
  });

  it("停止后不再回调", async () => {
    const { folder } = await project({ "第一章.md": "一" });
    let count = 0;
    const stop = watchChapters(folder, () => (count += 1), 30);
    await wait(100);
    stop();
    await writeFile(path.join(folder, "chapters", "第二章.md"), "二", "utf8");
    await wait(200);
    expect(count).toBe(0);
  });

  it("没有变化时不回调", async () => {
    const { folder } = await project({ "第一章.md": "一" });
    let count = 0;
    const stop = watchChapters(folder, () => (count += 1), 30);
    await wait(250);
    stop();
    expect(count).toBe(0);
  });
});
