import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseLatexDiagnostics } from "./diagnostics.js";

let directory: string;
let project: string;

beforeEach(async () => {
  directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "wh-latex-diag-")),
  );
  project = path.join(directory, "项目 甲");
  const parts = path.join(project, "章节");
  await mkdir(parts, { recursive: true });
  await writeFile(path.join(parts, "引言.tex"), "first\nsecond\nthird\n");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("Tectonic 编译诊断", () => {
  it("从绝对路径及省略扩展名的引用定位项目内源码", async () => {
    const absolute = path.join(project, "章节", "引言.tex");
    const output = [
      "note: Running TeX ...",
      "warning: 章节/引言:2: Overfull \\hbox detected at line 2",
      "warning: .\\章节\\引言.tex:2: Overfull \\hbox detected at line 2",
      "warning: 章节/引言.tex:3: ",
      "Invalid UTF-8 byte or sequence at line 3 replaced by U+FFFD.",
      "error: something bad happened inside XeTeX; its output follows:",
      "",
      "=".repeat(79),
      "error: This is part of the transcript.",
      "l.3 \\undefined",
      "=".repeat(79),
      "error: the XeTeX engine had an unrecoverable error",
    ].join("\r\n");

    expect(
      await parseLatexDiagnostics(
        [output, "error: " + absolute + ":3: Undefined control sequence"],
        project,
      ),
    ).toEqual([
      {
        severity: "error",
        message: "Undefined control sequence",
        location: { relativePath: "章节/引言.tex", line: 3 },
      },
      {
        severity: "warning",
        message: "Overfull \\hbox detected at line 2",
        location: { relativePath: "章节/引言.tex", line: 2 },
      },
      {
        severity: "warning",
        message: "Invalid UTF-8 byte or sequence at line 3 replaced by U+FFFD.",
        location: { relativePath: "章节/引言.tex", line: 3 },
      },
    ]);
  });

  it("外部文件、链接、内部目录、宏包和无效行仅显示消息", async () => {
    const outside = path.join(directory, "outside.tex");
    await writeFile(outside, "outside");
    await mkdir(path.join(project, ".wordhub"));
    await writeFile(path.join(project, ".wordhub", "internal.tex"), "internal");
    await symlink(directory, path.join(project, "linked"), "junction");
    const output = [
      'warning: accessing absolute path "' + outside + '"',
      "warning: ../outside.tex:1: Traversal",
      "warning: " + outside + ":1: Outside project",
      "warning: linked/outside.tex:1: Junction",
      "warning: .wordhub/internal.tex:1: Internal",
      "warning: article.cls:3: Bundle class",
      "warning: 章节/引言.tex:0: Invalid line",
      "error: failed to open input file",
    ].join("\n");

    expect(await parseLatexDiagnostics([output], project)).toEqual([
      { severity: "error", message: "failed to open input file" },
      { severity: "warning", message: "Traversal" },
      { severity: "warning", message: "Outside project" },
      { severity: "warning", message: "Junction" },
      { severity: "warning", message: "Internal" },
      { severity: "warning", message: "Bundle class" },
      { severity: "warning", message: "Invalid line" },
    ]);
  });

  it("警告过多时优先保留错误", async () => {
    const warnings = Array.from(
      { length: 110 },
      (_, index) => "warning: Warning " + index,
    );
    const result = await parseLatexDiagnostics(
      [[...warnings, "error: Fatal"].join("\n")],
      project,
    );
    expect(result).toHaveLength(100);
    expect(result[0]).toEqual({ severity: "error", message: "Fatal" });
  });
});
