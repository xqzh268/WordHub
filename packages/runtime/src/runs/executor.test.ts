import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRunExecutor } from "./executor.js";
import { WordHubStore } from "@wordhub/store";
import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";

describe("runtime运行编排", () => {
  it("faux运行经过任务事件、快照和终态", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-runtime-"));
    const project = path.join(root, "中文项目");
    await mkdir(project, { recursive: true });
    const messages: Array<Record<string, unknown>> = [];
    const executor = createRunExecutor({
      storageRoot: path.join(root, "store"),
      workspaceRoot: process.cwd(),
      post: (message) => messages.push(message),
    });
    await executor.ready;
    const runId = "run_faux_executor";
    await executor.handle({
      type: "run",
      runId,
      prompt: "请读取设定并写一章。",
      projectPath: project,
      mode: "mock",
      agentId: "writer",
    });
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (
          messages.some(
            (message) =>
              message.type === "run.finished" && message.runId === runId,
          )
        ) {
          clearInterval(timer);
          resolve();
        }
      }, 10);
    });
    const [found] = JSON.parse(
      await readFile(path.join(root, "store", "projects.json"), "utf8"),
    ) as Array<{ id: string; folderPath: string }>;
    expect(found).toBeDefined();
    const store = new WordHubStore(
      path.join(root, "store", "projects", found!.id),
    );
    expect(found?.folderPath).toBe(path.resolve(project));
    expect(store.listEvents(found!.id).map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "task.created",
        "task.started",
        "task.succeeded",
      ]),
    );
    expect(store.latestRunSnapshot(runId)?.messages.length).toBeGreaterThan(0);
    expect(store.getTask(`task_${runId}`)?.status).toBe("succeeded");
    store.close();
    executor.close();
  });

  it("主模型失败时记录fallback并由备用模型完成", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-fallback-"));
    const project = path.join(root, "project");
    await mkdir(project, { recursive: true });
    const provider = fauxProvider({
      provider: "deepseek",
      models: [
        { id: "deepseek-v4-pro", reasoning: true },
        { id: "deepseek-flash", reasoning: true },
      ],
    });
    provider.setResponses([
      () => {
        throw new Error("注入主模型故障");
      },
      fauxAssistantMessage("备用模型已完成。", { stopReason: "stop" }),
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
      runId: "run_fallback",
      prompt: "请评审",
      projectPath: project,
      mode: "mock",
      agentId: "reviewer",
    });
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (
          messages.some(
            (message) =>
              message.type === "run.finished" &&
              message.runId === "run_fallback",
          )
        ) {
          clearInterval(timer);
          resolve();
        }
      }, 10);
    });
    expect(messages.some((message) => message.type === "run.fallback")).toBe(
      true,
    );
    expect(
      messages.find((message) => message.type === "run.finished")?.text,
    ).toContain("备用模型");
    executor.close();
  });

  it("审批快照在重启后仍可批准并继续写入", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "wordhub-approval-recovery-"),
    );
    const project = path.join(root, "project");
    await mkdir(path.join(project, ".wordhub", "agents", "writer-copy"), {
      recursive: true,
    });
    await writeFile(
      path.join(project, ".wordhub", "agents", "writer-copy", "AGENT.md"),
      `---
name: writer-copy
displayName: 写手副本
description: 测试写手
model: { provider: deepseek, id: deepseek-flash, reasoning: low }
tools: [bible.read, doc.write]
write: write
writeScopes: [chapters/**]
confirmBeforeWrite: true
memoryScopes: { read: [bible], write: [] }
maxTurns: 8
---
请使用工具完成写作。
`,
      "utf8",
    );
    await mkdir(path.join(project, ".wordhub", "bible"), { recursive: true });
    await writeFile(
      path.join(project, ".wordhub", "bible", "bible.md"),
      "设定",
      "utf8",
    );
    const firstMessages: Array<Record<string, unknown>> = [];
    const first = createRunExecutor({
      storageRoot: path.join(root, "store"),
      workspaceRoot: process.cwd(),
      post: (message) => firstMessages.push(message),
    });
    await first.ready;
    await first.handle({
      type: "run",
      runId: "run_approval_recovery",
      prompt: "写第一章",
      projectPath: project,
      mode: "mock",
      agentId: "writer-copy",
    });
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (
          firstMessages.some((message) => message.type === "approval.requested")
        ) {
          clearInterval(timer);
          resolve();
        }
      }, 10);
    });
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const secondMessages: Array<Record<string, unknown>> = [];
    const second = createRunExecutor({
      storageRoot: path.join(root, "store"),
      workspaceRoot: process.cwd(),
      post: (message) => secondMessages.push(message),
    });
    await second.ready;
    await second.handle({
      type: "run.approve",
      runId: "run_approval_recovery",
      approved: true,
      apiKey: "saved-only-test-key",
      requestId: "approval-recovery-response",
    });
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (
          secondMessages.some(
            (message) =>
              message.type === "run.finished" &&
              message.runId === "run_approval_recovery",
          )
        ) {
          clearInterval(timer);
          resolve();
        }
      }, 10);
    });
    expect(
      secondMessages.some(
        (message) =>
          message.type === "approval.granted" && message.restored === true,
      ),
    ).toBe(true);
    expect(
      secondMessages.some((message) => message.type === "run.finished"),
    ).toBe(true);
    second.close();
  });
});
