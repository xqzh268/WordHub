import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyCitations } from "./citations.js";

async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-cite-"));
  const folder = path.join(root, "长安夜");
  await mkdir(path.join(folder, ".wordhub", "bible"), { recursive: true });
  await mkdir(path.join(folder, "chapters"), { recursive: true });
  await writeFile(
    path.join(folder, ".wordhub", "bible", "characters.md"),
    "# 人物\n裴照：不良人，左撇子，惯用横刀。\n",
    "utf8",
  );
  await writeFile(
    path.join(folder, "chapters", "第三章.md"),
    "裴照走进崇仁坊，\n右手按住刀柄，听见更鼓。\n",
    "utf8",
  );
  return folder;
}
const both = [
  { source: "chapters/第三章.md", quote: "右手按住刀柄" },
  { source: ".wordhub/bible/characters.md", quote: "左撇子，惯用横刀" },
];

describe("verifyCitations", () => {
  it("两端引文都逐字存在时通过", async () => {
    await expect(
      verifyCitations(await project(), "character", both),
    ).resolves.toBeUndefined();
  });

  it("忽略换行、空白与引号差异", async () => {
    await expect(
      verifyCitations(await project(), "fact", [
        { source: "chapters/第三章.md", quote: "崇仁坊， 右手按住 “刀柄”" },
        both[1] as (typeof both)[number],
      ]),
    ).resolves.toBeUndefined();
  });

  it("省略号连接的两段分别核验", async () => {
    const folder = await project();
    await expect(
      verifyCitations(folder, "character", [
        { source: "chapters/第三章.md", quote: "裴照走进崇仁坊……听见更鼓" },
        both[1] as (typeof both)[number],
      ]),
    ).resolves.toBeUndefined();
    await expect(
      verifyCitations(folder, "character", [
        { source: "chapters/第三章.md", quote: "裴照走进崇仁坊……他抽刀而出" },
        both[1] as (typeof both)[number],
      ]),
    ).rejects.toThrow(/逐字/u);
  });

  it("编造的引文被拒绝，并指出是哪一段", async () => {
    await expect(
      verifyCitations(await project(), "character", [
        { source: "chapters/第三章.md", quote: "裴照用左手按住刀柄" },
        both[1] as (typeof both)[number],
      ]),
    ).rejects.toThrow(/左手按住刀柄/u);
  });

  it("时间线 / 人物 / 基本事实需要两处引文，常识与风格一处即可", async () => {
    const folder = await project();
    const one = [both[0] as (typeof both)[number]];
    for (const category of ["timeline", "character", "fact"] as const)
      await expect(verifyCitations(folder, category, one)).rejects.toThrow(
        /至少要引用2处/u,
      );
    for (const category of ["commonsense", "style"] as const)
      await expect(
        verifyCitations(folder, category, one),
      ).resolves.toBeUndefined();
  });

  it("没有引文、重复引文都被拒绝", async () => {
    const folder = await project();
    await expect(verifyCitations(folder, "style", undefined)).rejects.toThrow();
    await expect(
      verifyCitations(folder, "character", [both[0], both[0]] as never),
    ).rejects.toThrow(/重复/u);
  });

  it("出处必须是章节或设定文件，不能越界", async () => {
    const folder = await project();
    for (const source of ["../secret.md", "notes/备忘.md", "/etc/passwd"])
      await expect(
        verifyCitations(folder, "style", [{ source, quote: "任意引文内容" }]),
      ).rejects.toThrow(/无效/u);
  });

  it("出处文件不存在、引文过短", async () => {
    const folder = await project();
    await expect(
      verifyCitations(folder, "style", [
        { source: "chapters/第九章.md", quote: "不存在的章节" },
      ]),
    ).rejects.toThrow(/读取失败/u);
    await expect(
      verifyCitations(folder, "style", [
        { source: "chapters/第三章.md", quote: "刀" },
      ]),
    ).rejects.toThrow(/太短/u);
  });
});
