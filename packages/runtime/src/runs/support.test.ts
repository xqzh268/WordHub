import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../types.js";
import { expectedChapterPathForRequest } from "./support.js";

const writer = {
  name: "writer",
  displayName: "写手",
  description: "测试",
  model: { provider: "deepseek", id: "deepseek-flash", reasoning: "low" },
  tools: ["doc.write"],
  write: "write",
  writeScopes: ["chapters/**"],
  memoryScopes: { read: ["bible"], write: [] },
  maxTurns: 1,
  source: "builtin",
  sourcePath: "writer",
  systemPrompt: "",
  version: "test",
} satisfies AgentDefinition;

describe("章节写入路径约束", () => {
  it("从写作请求确定规范中文路径", () => {
    expect(
      expectedChapterPathForRequest(
        {
          type: "run",
          runId: "r",
          prompt: "写第十二章",
          agentId: "writer",
        },
        writer,
      ),
    ).toBe("chapters/第十二章.md");
  });

  it("提示里出现多个不同章号时无法确定目标，不施加约束", () => {
    expect(
      expectedChapterPathForRequest(
        {
          type: "run",
          runId: "r",
          prompt: "参考第二章的语气写第三章",
          agentId: "writer",
        },
        writer,
      ),
    ).toBeUndefined();
  });

  it("没有明确章号或非写作Agent不施加章节路径约束", () => {
    expect(
      expectedChapterPathForRequest(
        { type: "run", runId: "r", prompt: "写一段简介", agentId: "writer" },
        writer,
      ),
    ).toBeUndefined();
    expect(
      expectedChapterPathForRequest(
        { type: "run", runId: "r", prompt: "写第三章", agentId: "reviewer" },
        writer,
      ),
    ).toBeUndefined();
  });
});
