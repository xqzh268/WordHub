import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { createRunExecutor } from "../runs/executor.js";

const agentMarkdown = `---
name: context-writer
displayName: 上下文测试写手
description: 验证完整上下文注入
model: { provider: deepseek, id: deepseek-flash, reasoning: low }
tools: []
write: none
memoryScopes: { read: [bible, outline, chapters], write: [] }
maxTurns: 1
---
只需回复完成。
`;

async function waitForRun(
  messages: Array<Record<string, unknown>>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const timer = setInterval(() => {
      if (messages.some((message) => message.type === "run.finished")) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error("等待上下文注入运行结束超时"));
      }
    }, 10);
  });
}

describe("M4.2真实请求上下文注入", () => {
  it("faux模型实际收到筛选人物、完整大纲和完整句尾窗口", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "wordhub-context-injection-"),
    );
    const project = path.join(root, "项目");
    await mkdir(path.join(project, ".wordhub", "agents", "context-writer"), {
      recursive: true,
    });
    await mkdir(path.join(project, ".wordhub", "bible"), { recursive: true });
    await mkdir(path.join(project, "chapters"), { recursive: true });
    await writeFile(
      path.join(project, ".wordhub", "agents", "context-writer", "AGENT.md"),
      agentMarkdown,
      "utf8",
    );
    await writeFile(
      path.join(project, ".wordhub", "bible", "outline.md"),
      "## 逐章大纲\n1. **第3章 宫门影子**\n   - 目标：找出内侍线索。\n   - 事件：韩敬突然现身。\n2. **第4章 旧案回响**\n   - 目标：取回账册。\n## 伏笔计划\n- 第3章留下的香囊在第5章回收。",
      "utf8",
    );
    await writeFile(
      path.join(project, ".wordhub", "bible", "setting.md"),
      "唐代长安，夜禁森严。",
      "utf8",
    );
    await writeFile(
      path.join(project, ".wordhub", "bible", "characters.md"),
      "# 人物档案\n\n## 主角：裴照\n- 身份：不良人。\n\n## 主要配角：韩敬\n- 身份：不良帅。\n\n## 主要配角：崔七娘\n- 身份：香料铺掌柜。",
      "utf8",
    );
    await writeFile(
      path.join(project, ".wordhub", "bible", "style.md"),
      "冷峻克制，少用解释性旁白。",
      "utf8",
    );
    await writeFile(
      path.join(project, "chapters", "第二章.md"),
      Array.from(
        { length: 70 },
        (_, index) => `第${index + 1}句：上一章线索继续向前推进。`,
      ).join(""),
      "utf8",
    );

    let seen: Array<{ role?: string; content?: unknown }> = [];
    const provider = fauxProvider({
      provider: "deepseek",
      models: [{ id: "deepseek-flash", reasoning: true }],
    });
    provider.setResponses([
      (context) => {
        seen = context.messages as Array<{
          role?: string;
          content?: unknown;
        }>;
        return fauxAssistantMessage("完成", { stopReason: "stop" });
      },
    ]);
    const models = createModels();
    models.setProvider(provider.provider);
    const messages: Array<Record<string, unknown>> = [];
    const executor = createRunExecutor({
      storageRoot: path.join(root, "store"),
      workspaceRoot: process.cwd(),
      mockModels: models,
      post: (message) => messages.push(message),
    });
    await executor.ready;
    await executor.handle({
      type: "run",
      runId: "run_context_injection",
      prompt: "请写第三章",
      projectPath: project,
      mode: "mock",
      agentId: "context-writer",
    });
    await waitForRun(messages);
    const content = seen
      .filter((message) => message.role === "user")
      .map((message) => String(message.content ?? ""))
      .join("\n");
    expect(content).toContain("第3章 宫门影子");
    expect(content).toContain("韩敬突然现身");
    expect(content).toContain("主角：裴照");
    expect(content).toContain("主要配角：韩敬");
    expect(content).not.toContain("崔七娘");
    expect(content).toContain("第70句：上一章线索继续向前推进。");
    expect(content).toContain("冷峻克制");
    expect(content).not.toContain("伏笔计划");
    executor.close();
  });
});
