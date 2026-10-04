import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { createModels } from "@earendil-works/pi-ai";
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { createRunExecutor } from "../runs/executor.js";

export async function fixture(
  response: Parameters<
    ReturnType<typeof fauxProvider>["setResponses"]
  >[0][number],
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-m3-"));
  const project = path.join(root, "长安夜");
  await mkdir(path.join(project, ".wordhub/bible"), { recursive: true });
  await mkdir(path.join(project, "chapters"), { recursive: true });
  await writeFile(
    path.join(project, ".wordhub/bible/bible.md"),
    "裴照是左撇子。",
    "utf8",
  );
  const faux = fauxProvider({
    provider: "deepseek",
    models: [
      { id: "deepseek-flash", reasoning: true },
      { id: "deepseek-v4-pro", reasoning: true },
    ],
  });
  faux.setResponses(Array.from({ length: 100 }, () => response));
  const models = createModels();
  models.setProvider(faux.provider);
  const messages: Record<string, unknown>[] = [];
  const executor = createRunExecutor({
    storageRoot: path.join(root, "store"),
    workspaceRoot: process.cwd(),
    mockModels: models,
    post: (message) => messages.push(message),
  });
  await executor.ready;
  return { root, project, messages, executor };
}
export async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("M3运行超时");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
describe("产品工作流入口", () => {
  it("协调器驱动固执写手两轮回应，阻塞待裁决并在裁决后返工", async () => {
    const f = await fixture((context) => {
      const prompt = JSON.stringify(context.messages);
      const calls = context.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.content)
        .filter((block) => block.type === "toolCall");
      if (calls.length)
        return fauxAssistantMessage("本节点完成。", { stopReason: "stop" });
      if (prompt.includes("任务角色：rework"))
        return fauxAssistantMessage(
          fauxToolCall("doc_write", {
            path: "chapters/第三章.md",
            content: "裴照用左手按刀。",
          }),
          { stopReason: "toolUse" },
        );
      if (prompt.includes("任务角色：challenge.reply")) {
        expect(prompt).toContain("left-hand");
        expect(prompt).toContain("右手与左撇子设定冲突");
        return fauxAssistantMessage(
          fauxToolCall("challenge_reply", {
            threadId: "left-hand",
            disposition: "refute",
            text: "坚持原文，需要用户裁决。",
          }),
          { stopReason: "toolUse" },
        );
      }
      return fauxAssistantMessage(
        fauxToolCall("challenge_raise", {
          threadId: "left-hand",
          target: "writer",
          claim: "右手与左撇子设定冲突",
          path: "chapters/第三章.md",
          severity: "blocking",
        }),
        { stopReason: "toolUse" },
      );
    });
    try {
      await f.executor.handle({
        type: "run",
        runId: "stubborn-flow",
        prompt: "请评审第三章",
        projectPath: f.project,
        mode: "mock",
      });
      await waitFor(() =>
        f.messages.some((message) => message.type === "escalation.created"),
      );
      expect(
        f.messages.some((message) => message.type === "workflow.finished"),
      ).toBe(false);
      expect(
        f.messages.filter((message) => message.type === "challenge.raise"),
      ).toHaveLength(2);
      const starts = f.messages.filter(
        (message) => message.type === "run.started" && message.nodeId,
      );
      expect(starts.map((message) => message.nodeId)).toEqual([
        "reviewer",
        "challenge-reply-1",
        "challenge-review-2",
        "challenge-reply-2",
      ]);
      await f.executor.handle({
        type: "challenge.decide",
        workflowId: "stubborn-flow",
        threadId: "left-hand",
        decision: "accept",
        requestId: "decide-stubborn",
      });
      await waitFor(() =>
        f.messages.some((message) => message.type === "workflow.finished"),
      );
      expect(
        await readFile(path.join(f.project, "chapters/第三章.md"), "utf8"),
      ).toBe("裴照用左手按刀。");
    } finally {
      f.executor.close();
    }
  });
  it("写手与编辑各运行一次，传递产物且用户消息仅记一次", async () => {
    const f = await fixture((context) => {
      const edit = JSON.stringify(context.messages).includes("任务角色：edit");
      if (
        context.messages.some(
          (m) => m.role === "toolResult" && m.toolName === "doc_write",
        )
      )
        return fauxAssistantMessage("完成。", { stopReason: "stop" });
      return fauxAssistantMessage(
        fauxToolCall("doc_write", {
          path: "chapters/第三章.md",
          content: edit ? "写手稿。编辑润色。" : "写手稿。",
        }),
        { stopReason: "toolUse" },
      );
    });
    try {
      await f.executor.handle({
        type: "run",
        runId: "flow",
        prompt: "写第三章",
        projectPath: f.project,
        mode: "mock",
      });
      await waitFor(() =>
        f.messages.some((m) => m.type === "workflow.finished"),
      );
      const starts = f.messages.filter(
        (m) => m.type === "run.started" && m.agentId,
      );
      expect(starts.map((m) => m.agentId)).toEqual(["writer", "editor"]);
      expect(
        await readFile(path.join(f.project, "chapters/第三章.md"), "utf8"),
      ).toBe("写手稿。编辑润色。");
      const projectMessage = f.messages.find(
        (m) => m.type === "workflow.started",
      )!;
      await f.executor.handle({
        type: "chat.list",
        requestId: "chat",
        projectId: String(projectMessage.projectId),
        sessionId: String(projectMessage.sessionId),
      });
      const result = f.messages.find((m) => m.requestId === "chat")!.result as {
        events: { type: string }[];
        items: { kind: string }[];
      };
      expect(
        result.events.filter((e) => e.type === "chat.user_message"),
      ).toHaveLength(1);
      expect(result.items.filter((i) => i.kind === "task")).toHaveLength(2);
      expect(
        result.events.filter((e) => e.type === "run.usage").length,
      ).toBeGreaterThanOrEqual(4);
    } finally {
      f.executor.close();
    }
  });

  it("质询两轮未解决时升级，裁决后工作流继续", async () => {
    const f = await fixture((context) => {
      const calls = context.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.content)
        .filter((block) => block.type === "toolCall");
      if (calls.length === 0)
        return fauxAssistantMessage(
          fauxToolCall("challenge_raise", {
            threadId: "left-hand",
            target: "writer",
            claim: "设定与正文冲突",
            severity: "blocking",
          }),
          { stopReason: "toolUse" },
        );
      if (calls.length === 1)
        return fauxAssistantMessage(
          fauxToolCall("challenge_raise", {
            threadId: "left-hand",
            target: "writer",
            claim: "仍有冲突",
            severity: "blocking",
          }),
          { stopReason: "toolUse" },
        );
      if (calls.length === 2)
        return fauxAssistantMessage(
          fauxToolCall("challenge_reply", {
            threadId: "left-hand",
            disposition: "refute",
            text: "保留原文",
          }),
          { stopReason: "toolUse" },
        );
      return fauxAssistantMessage("等待裁决。", { stopReason: "stop" });
    });
    await mkdir(path.join(f.project, ".wordhub/agents/reviewer"), {
      recursive: true,
    });
    await writeFile(
      path.join(f.project, ".wordhub/agents/reviewer/AGENT.md"),
      `---
name: reviewer
displayName: 评审
description: 测试质询
model: { provider: deepseek, id: deepseek-flash, reasoning: low }
tools: [doc.read, bible.read, challenge.raise, challenge.reply]
write: none
writeScopes: []
confirmBeforeWrite: false
memoryScopes: { read: [bible, chapters], write: [] }
maxTurns: 8
---
提出两轮质询后等待裁决。
`,
      "utf8",
    );
    try {
      await f.executor.handle({
        type: "run",
        runId: "challenge-flow",
        prompt: "请评审第三章",
        projectPath: f.project,
        mode: "mock",
      });
      await waitFor(() =>
        f.messages.some((message) => message.type === "escalation.created"),
      );
      expect(
        f.messages.some((message) => message.type === "run.waiting_approval"),
      ).toBe(true);
      const escalation = f.messages.find(
        (message) => message.type === "escalation.created",
      )!;
      await f.executor.handle({
        type: "challenge.decide",
        workflowId: "challenge-flow",
        threadId: String(escalation.threadId),
        decision: "accept",
        requestId: "decision",
      });
      await waitFor(() =>
        f.messages.some((message) => message.type === "workflow.finished"),
      );
      expect(
        f.messages.some((message) => message.type === "escalation.resolved"),
      ).toBe(true);
    } finally {
      f.executor.close();
    }
  });
});
