import { describe, expect, it } from "vitest";
import { parseAgentMarkdown } from "./registry.js";

const SOURCE = [
  "---",
  "name: custom-agent",
  "displayName: 自建Agent",
  "description: 测试Agent",
  "model: { provider: deepseek, id: flash, reasoning: low }",
  "tools: [doc.read]",
  "write: none",
  "writeScopes: []",
  "memoryScopes: { read: [bible], write: [] }",
  "maxTurns: 12",
  "---",
  "你是测试Agent。",
  "第二行。",
].join("\n");

describe("parseAgentMarkdown", () => {
  it("LF 文件正常解析", () => {
    const agent = parseAgentMarkdown(SOURCE, "a/AGENT.md", "project");
    expect(agent.maxTurns).toBe(12);
    expect(agent.systemPrompt).toBe("你是测试Agent。\n第二行。");
  });

  it("Windows 编辑器保存的 CRLF 文件与 LF 文件解析结果一致（最后一个数字不能变成字符串）", () => {
    const crlf = parseAgentMarkdown(
      SOURCE.replaceAll("\n", "\r\n"),
      "a/AGENT.md",
      "project",
    );
    expect(crlf.maxTurns).toBe(12);
    expect(crlf.systemPrompt).toBe("你是测试Agent。\n第二行。");
  });

  it("缺少 frontmatter 或结束标记时报错", () => {
    expect(() => parseAgentMarkdown("没有头", "a", "project")).toThrow();
    expect(() => parseAgentMarkdown("---\nname: x", "a", "project")).toThrow();
  });
});
