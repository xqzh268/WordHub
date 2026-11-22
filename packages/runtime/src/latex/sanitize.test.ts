import path from "node:path";
import { describe, expect, it } from "vitest";
import { findOutsidePaths, sanitizeCompileOutputForAgent } from "./sanitize.js";

const root = path.resolve("/work/论文");
const outsideFile = path.resolve("/home/user/.ssh/id_rsa");
const base = {
  status: "failed" as const,
  truncated: false,
  exitCode: 1,
  durationMs: 10,
};

describe("sanitizeCompileOutputForAgent", () => {
  it("干净的输出原样保留，并把项目根替换为 <project>", () => {
    const result = sanitizeCompileOutputForAgent(
      {
        ...base,
        stdout: "note: ok",
        stderr: `error: ${path.join(root, "main.tex")}:3: Undefined control sequence`,
      },
      root,
    );
    expect(result.readOutsideProject).toBe(false);
    expect(result.outsidePaths).toEqual([]);
    expect(result.output).toContain("note: ok");
    expect(result.output).toContain("<project>");
    expect(result.output).not.toContain(root);
  });

  it("删除 accessing absolute path 行，并整体屏蔽其余输出", () => {
    const secret = "-----BEGIN OPENSSH PRIVATE KEY----- AAAA";
    const result = sanitizeCompileOutputForAgent(
      {
        ...base,
        stdout: `warning: accessing absolute path \`${outsideFile}\`\n${secret}`,
        stderr: "error: something",
      },
      root,
    );
    expect(result.readOutsideProject).toBe(true);
    expect(result.outsidePaths).toEqual([outsideFile]);
    expect(result.output).not.toContain(secret);
    expect(result.output).not.toContain("accessing absolute path");
    expect(result.output).not.toContain("something");
  });

  it("项目内的绝对路径读取不算越界，但该行仍被删除", () => {
    const inner = path.join(root, "parts", "a.tex");
    const result = sanitizeCompileOutputForAgent(
      {
        ...base,
        stdout: `warning: accessing absolute path \`${inner}\`\nkeep me`,
        stderr: "",
      },
      root,
    );
    expect(result.readOutsideProject).toBe(false);
    expect(result.output).toBe("keep me");
  });

  it("同一路径只报一次；无法解析的路径保守地按越界处理", () => {
    const text = [
      `warning: accessing absolute path \`${outsideFile}\``,
      `warning: accessing absolute path \`${outsideFile}\``,
      "warning: accessing absolute path",
    ].join("\n");
    expect(findOutsidePaths(text, root)).toEqual([
      outsideFile,
      "（无法解析的绝对路径）",
    ]);
  });

  it("结果不含日志、PDF 等文件路径字段", () => {
    const result = sanitizeCompileOutputForAgent(
      {
        ...base,
        stdout: "",
        stderr: "",
        pdfPath: "x.pdf",
        logPath: "x.log",
      } as never,
      root,
    );
    expect(Object.keys(result)).not.toContain("pdfPath");
    expect(Object.keys(result)).not.toContain("logPath");
  });
});
