import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WordHubStore } from "@wordhub/store";
import type { AgentDefinition } from "../types.js";
import { ContextBuilder } from "./builder.js";
import {
  charactersForChapter,
  collectProjectContextLayers,
  previousChapterTail,
  projectContext,
} from "./project.js";

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
    expect(layers[3]?.text.length).toBeLessThanOrEqual(800);
    expect(layers[3]?.text.length).toBeGreaterThanOrEqual(500);
    expect(layers[3]?.text.endsWith("上一章结尾证据。")).toBe(true);
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

  it("人物档案按本章大纲筛选，同时保留主角段落", () => {
    const text = charactersForChapter(
      "# 人物档案\n\n## 主角：裴照\n- 身份：不良人。\n\n## 主要配角：韩敬\n- 身份：不良帅。\n\n## 主要配角：崔七娘\n- 身份：香料铺掌柜。",
      "第3章：韩敬来到巡铺。",
    );
    expect(text).toContain("主角：裴照");
    expect(text).toContain("主要配角：韩敬");
    expect(text).not.toContain("崔七娘");
  });

  it("按真实草稿的粗体人物段落筛选，保留首位主角及人物字段", () => {
    const source = [
      "**裴照**",
      "身份：不良人，负责坊市巡捕。",
      "**性格**",
      "话少，办事讲章程。",
      "他会追查 **旧案**。",
      "**韦韬**",
      "身份：县尉。",
      "**陈九**（已故，暗线人物）",
      "身份：生前为不良人。",
      "硬设定：右手食指断了一节。",
      "**郭元礼**",
      "身份：内常侍。",
      "**人物关系**",
      "裴照是陈九的徒弟。",
    ].join("\n\n");

    const text = charactersForChapter(source, "第四章：揭开陈九的旧事。");

    expect(text).toContain("**裴照**");
    expect(text).toContain("**性格**\n\n话少，办事讲章程。");
    expect(text).toContain("他会追查 **旧案**。");
    expect(text).toContain("**陈九**（已故，暗线人物）");
    expect(text).toContain("硬设定：右手食指断了一节。");
    expect(text).toContain("**人物关系**\n\n裴照是陈九的徒弟。");
    expect(text).not.toContain("**韦韬**");
    expect(text).not.toContain("**郭元礼**");
  });

  it("显式标记主角时以标记为准，并保留不同格式的相关人物", () => {
    const source = [
      "**韦韬**",
      "身份：县尉。",
      "**裴照**（主角）",
      "- **身份：** 不良人。",
      "## 暗线人物：陈九",
      "身份：裴照的师父。",
    ].join("\n\n");

    const text = charactersForChapter(source, "陈九的往事");

    expect(text).toContain("**裴照**（主角）");
    expect(text).toContain("## 暗线人物：陈九");
    expect(text).not.toContain("**韦韬**");
  });

  it("无可靠人名匹配时保留全文，避免省略未点名的人物", () => {
    const source =
      "**裴照**\r\n\r\n身份：不良人。\r\n\r\n**陈九**\r\n\r\n身份：师父。";

    expect(charactersForChapter(source, "第三章：主角追查旧案。")).toBe(source);
  });

  it("本章提到缺少身份字段的条目时保留全文", () => {
    const source = [
      "**裴照**",
      "身份：不良人。",
      "**韦韬**",
      "身份：县尉。",
      "**张阿满**",
      "在坊外修鼓。",
    ].join("\n\n");

    expect(charactersForChapter(source, "裴照找张阿满询问更鼓。")).toBe(source);
  });

  it("上一章尾部窗口保持500–800字并从完整句子开始", () => {
    const source = Array.from(
      { length: 70 },
      (_, index) => `第${index + 1}句：上一章中的连续叙述与证据推进。`,
    ).join("");
    const tail = previousChapterTail(source);
    expect(tail.length).toBeGreaterThanOrEqual(500);
    expect(tail.length).toBeLessThanOrEqual(800);
    expect(tail).toMatch(/^第\d+句：/u);
    expect(tail.endsWith("推进。")).toBe(true);
  });
});
