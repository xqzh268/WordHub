import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRunExecutor } from "../runs/executor.js";
import { WordHubStore } from "@wordhub/store";

async function waitFor(
  messages: Array<Record<string, unknown>>,
  predicate: (message: Record<string, unknown>) => boolean,
) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (messages.some(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("等待纲领问答事件超时");
}

describe("M4.1纲领问答集成", () => {
  it("首句进入分层问答，确认后恢复写入五个圣经文件", async () => {
    const root = await fsTemp("wordhub-intake-");
    const projectPath = path.join(root, "长安夜");
    await mkdir(projectPath, { recursive: true });
    const messages: Array<Record<string, unknown>> = [];
    const executor = createRunExecutor({
      storageRoot: path.join(root, "store"),
      workspaceRoot: process.cwd(),
      post: (message) => messages.push(message),
    });
    await executor.ready;
    const runId = "run_intake_integration";
    await executor.handle({
      type: "run",
      runId,
      prompt: "写一部唐代悬疑短篇，主角是不良人",
      rawPrompt: "写一部唐代悬疑短篇，主角是不良人",
      agentId: "planner",
      projectPath,
      mode: "mock",
    });
    await waitFor(
      messages,
      (message) => message.type === "run.finished" && message.runId === runId,
    );
    const projects = JSON.parse(
      await readFile(path.join(root, "store", "projects.json"), "utf8"),
    ) as Array<{ id: string }>;
    const projectId = projects[0]!.id;
    const store = new WordHubStore(
      path.join(root, "store", "projects", projectId),
    );
    const sessionId = store.listSessions(projectId)[0]!.id;
    const intakeId = `intake_${runId}`;
    const answer = async (key: string, value: string) => {
      await executor.handle({
        type: "intake.answer",
        projectId,
        sessionId,
        intakeId,
        questionId: `${intakeId}:${key}`,
        value,
        requestId: `answer-${key}`,
      });
    };
    await answer("conflict", "查清一桩牵连宫门的旧案");
    executor.close();
    const restarted = createRunExecutor({
      storageRoot: path.join(root, "store"),
      workspaceRoot: process.cwd(),
      post: (message) => messages.push(message),
    });
    await restarted.ready;
    store.close();
    const resumedStore = new WordHubStore(
      path.join(root, "store", "projects", projectId),
    );
    for (const key of [
      "world",
      "viewpointTone",
      "theme",
      "audience",
      "chapterCount",
      "mustInclude",
      "forbidden",
    ])
      await restarted.handle({
        type: "intake.answer",
        projectId,
        sessionId,
        intakeId,
        questionId: `${intakeId}:${key}`,
        value: "",
        requestId: `answer-${key}`,
      });
    await restarted.handle({
      type: "intake.confirm",
      projectId,
      sessionId,
      intakeId,
      requestId: "confirm-intake",
    });
    expect(
      resumedStore.listEvents(projectId, sessionId).map((event) => event.type),
    ).toEqual(
      expect.arrayContaining(["intake.confirmed", "intake.artifacts.created"]),
    );
    for (const file of [
      "outline.md",
      "characters.md",
      "setting.md",
      "style.md",
      "writing-plan.json",
    ])
      await expect(
        readFile(path.join(projectPath, ".wordhub", "bible", file), "utf8"),
      ).resolves.toBeTruthy();
    resumedStore.close();
    restarted.close();
  });
});

async function fsTemp(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
