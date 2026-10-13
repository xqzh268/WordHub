import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WordHubStore } from "@wordhub/store";
import type { AgentDefinition } from "../types.js";
import { ContextBuilder } from "./builder.js";
import { collectProjectContextLayers, projectContext } from "./project.js";

const agent = {
  name: "writer",
  displayName: "写手",
  description: "测试",
  model: { provider: "deepseek", id: "deepseek-flash", reasoning: "low" },
  tools: [],
  write: "write",
  memoryScopes: { read: ["bible", "outline", "chapters"], write: [] },
  maxTurns: 1,
  source: "builtin",
  sourcePath: "writer",
  systemPrompt: "",
  version: "test",
} satisfies AgentDefinition;

describe("M4.2固定上下文", () => {
  it("按五层固定顺序注入本章纲领、设定、人物、上一章结尾和文风", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-context-"));
    const projectPath = path.join(root, "project");
    await mkdir(path.join(projectPath, ".wordhub", "bible"), {
      recursive: true,
    });
    await mkdir(path.join(projectPath, "chapters"), { recursive: true });
    await writeFile(
      path.join(projectPath, ".wordhub", "bible", "outline.md"),
      "# 大纲\n第2章：旧案留下的血字\n第3章：不良人夜入宫门\n",
    );
    await writeFile(
      path.join(projectPath, ".wordhub", "bible", "setting.md"),
      "唐代长安，夜禁森严。",
    );
    await writeFile(
      path.join(projectPath, ".wordhub", "bible", "characters.md"),
      "裴照：不良人，左手有旧伤。",
    );
    await writeFile(
      path.join(projectPath, ".wordhub", "bible", "style.md"),
      "冷峻克制，少用解释性旁白。",
    );
    await writeFile(
      path.join(projectPath, "chapters", "第二章.md"),
      `上一章开头。${"上一章结尾证据。".repeat(100)}`,
    );
    const store = new WordHubStore(path.join(root, "store"));
    const project = store.createProject({
      id: "project_context",
      name: "测试",
      folderPath: projectPath,
    });
    const layers = await collectProjectContextLayers({
      store,
      projectId: project.id,
      projectPath,
      prompt: "请写第三章",
      agent,
    });
    expect(layers.map((layer) => layer.id)).toEqual([
      "chapter-3",
      "setting",
      "characters",
      "previous-chapter-2",
      "style",
    ]);
    expect(layers[0]?.text).toBe("第3章：不良人夜入宫门");
    expect(
      layers[3]?.text.endsWith("上一章结尾证据。".repeat(100).slice(-1600)),
    ).toBe(true);
    const built = await projectContext({
      store,
      projectId: project.id,
      sessionId: "session_context",
      projectPath,
      runId: "run_context",
      prompt: "请写第三章",
      agent,
    });
    const contextMessage = built.messages[0];
    expect(contextMessage?.role).toBe("user");
    if (contextMessage?.role === "user") {
      const content = JSON.stringify(contextMessage.content);
      expect(content.indexOf("【outline:chapter-3")).toBeLessThan(
        content.indexOf("【bible:setting"),
      );
      expect(content.indexOf("【bible:characters")).toBeLessThan(
        content.indexOf("【document:previous"),
      );
      expect(content.indexOf("【document:previous")).toBeLessThan(
        content.indexOf("【bible:style"),
      );
    }
    store.close();
  });

  it("总预算不足时按层预算裁剪，后续层和实际消息保持一致", () => {
    const result = new ContextBuilder(12).build(
      [
        {
          id: "outline",
          kind: "outline",
          text: "甲".repeat(100),
          tokenBudget: 3,
        },
        { id: "style", kind: "bible", text: "乙".repeat(100), tokenBudget: 3 },
      ],
      "丙".repeat(100),
    );
    expect(result.manifest[0]?.estimatedTokens).toBe(3);
    expect(result.manifest[1]?.estimatedTokens).toBe(3);
    expect(result.messages[0]?.role).toBe("user");
    if (result.messages[0]?.role === "user") {
      expect(result.messages[0].content).toContain("甲".repeat(6));
      expect(result.messages[0].content).toContain("乙".repeat(6));
    }
  });
});
