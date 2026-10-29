import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { fixture, waitFor } from "./test-helpers.js";

/** 通过引文核验的质询公共字段（章节文件由写手工作流产生，这里引设定里的两处原文）。 */
const RAISE = {
  category: "character" as const,
  citations: [
    { source: ".wordhub/bible/bible.md", quote: "裴照是左撇子" },
    { source: ".wordhub/bible/bible.md", quote: "他惯用横刀" },
  ],
};
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
          ...RAISE,
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
  it("写手、编辑、评审各运行一次，传递产物且用户消息仅记一次", async () => {
    const f = await fixture((context) => {
      const edit = JSON.stringify(context.messages).includes("任务角色：edit");
      if (JSON.stringify(context.messages).includes("任务角色：review"))
        return fauxAssistantMessage("五类核验均无矛盾。", {
          stopReason: "stop",
        });
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
      expect(starts.map((m) => m.agentId)).toEqual([
        "writer",
        "editor",
        "reviewer",
      ]);
      expect(
        await readFile(path.join(f.project, "chapters/第三章.md"), "utf8"),
      ).toBe("写手稿。编辑润色。");
      const editorCheck = f.messages.find(
        (message) => message.type === "editor.check",
      ) as { ok?: boolean; metrics?: { wordCount?: number } } | undefined;
      expect(editorCheck?.ok).toBe(true);
      expect(editorCheck?.metrics?.wordCount).toBe(7);
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
      expect(result.items.filter((i) => i.kind === "task")).toHaveLength(3);
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
            ...RAISE,
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
            ...RAISE,
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

  it("裁决先于节点暂停时不遗留waiting_approval任务", async () => {
    const f = await fixture(
      (context) => {
        const prompt = JSON.stringify(context.messages);
        const calls = context.messages
          .filter((message) => message.role === "assistant")
          .flatMap((message) => message.content)
          .filter((block) => block.type === "toolCall");
        if (prompt.includes("任务角色：challenge.reply")) {
          if (calls.length === 0)
            return fauxAssistantMessage(
              fauxToolCall("challenge_reply", {
                threadId: "early-decision",
                disposition: "refute",
                text: "仍有分歧。",
              }),
              { stopReason: "toolUse" },
            );
          return fauxAssistantMessage("裁决已在本回合到达。".repeat(12), {
            stopReason: "stop",
          });
        }
        if (prompt.includes("任务角色：review") && calls.length === 0)
          return fauxAssistantMessage(
            fauxToolCall("challenge_raise", {
              threadId: "early-decision",
              target: "writer",
              ...RAISE,
              claim: "仍有冲突",
              severity: "blocking",
            }),
            { stopReason: "toolUse" },
          );
        if (prompt.includes("任务角色：rework") && calls.length === 0)
          return fauxAssistantMessage(
            fauxToolCall("doc_write", {
              path: "chapters/第三章.md",
              content: "裁决后的修订。",
            }),
            { stopReason: "toolUse" },
          );
        return fauxAssistantMessage("本节点完成。", { stopReason: "stop" });
      },
      { tokensPerSecond: 20 },
    );
    try {
      const running = f.executor.handle({
        type: "run",
        runId: "early-decision-flow",
        prompt: "请评审第三章",
        projectPath: f.project,
        mode: "mock",
      });
      // 质询带逐字引文后参数变长，20 token/s 的慢速流式让升级出现得很晚（本地约 10 秒）。
      await waitFor(
        () =>
          f.messages.some((message) => message.type === "escalation.created"),
        25000,
      );
      await f.executor.handle({
        type: "challenge.decide",
        workflowId: "early-decision-flow",
        threadId: "early-decision",
        decision: "accept",
        requestId: "early-decision-request",
      });
      // 慢速流式输出（20 token/s）让本用例本地约 12 秒，CI 机器更慢，放宽等待上限。
      await waitFor(
        () =>
          f.messages.some((message) => message.type === "workflow.finished"),
        25000,
      );
      await running;
      const workflow = f.messages.find(
        (message) => message.type === "workflow.finished",
      );
      expect(workflow).toBeTruthy();
      expect(
        f.messages.filter((message) => message.type === "run.waiting_approval"),
      ).toHaveLength(0);
    } finally {
      f.executor.close();
    }
  }, 30000);
});
