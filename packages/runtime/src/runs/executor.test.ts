import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRunExecutor } from "./executor.js";
import { WordHubStore } from "@wordhub/store";
import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxToolCall,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";

function approvalModels(seenKeys: Array<string | undefined>) {
  const faux = fauxProvider({
    provider: "deepseek",
    models: [{ id: "deepseek-flash", reasoning: true }],
  });
  faux.setResponses([
    (_context, options) => {
      seenKeys.push(options?.apiKey);
      return fauxAssistantMessage(
        fauxToolCall("bible_read", { path: "bible.md" }),
        { stopReason: "toolUse" },
      );
    },
    (_context, options) => {
      seenKeys.push(options?.apiKey);
      return fauxAssistantMessage(
        fauxToolCall("doc_write", {
          path: "chapters/第一章.md",
          content: "恢复后的正文。",
        }),
        { stopReason: "toolUse" },
      );
    },
    (_context, options) => {
      seenKeys.push(options?.apiKey);
      return fauxAssistantMessage("恢复成功。", { stopReason: "stop" });
    },
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  return models;
}

const approvalAgent = `---
name: writer-copy
displayName: 写手副本
description: 测试审批恢复
model: { provider: deepseek, id: deepseek-flash, reasoning: low }
tools: [bible.read, doc.write]
write: write
writeScopes: [chapters/**]
confirmBeforeWrite: true
memoryScopes: { read: [bible], write: [] }
maxTurns: 8
---
请使用工具完成写作。
`;

async function waitForMessage(
  messages: Array<Record<string, unknown>>,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const timer = setInterval(() => {
      if (messages.some(predicate)) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error("等待运行事件超时"));
      }
    }, 10);
  });
}

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

  it("审批恢复把注入的密钥交给同一Agent并继续写入", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "wordhub-approval-recovery-"),
    );
    const project = path.join(root, "project");
    await mkdir(path.join(project, ".wordhub", "agents", "writer-copy"), {
      recursive: true,
    });
    await writeFile(
      path.join(project, ".wordhub", "agents", "writer-copy", "AGENT.md"),
      approvalAgent,
      "utf8",
    );
    await mkdir(path.join(project, ".wordhub", "bible"), { recursive: true });
    await writeFile(
      path.join(project, ".wordhub", "bible", "bible.md"),
      "设定",
      "utf8",
    );
    const seenKeys: Array<string | undefined> = [];
    const models = approvalModels(seenKeys);
    const firstMessages: Array<Record<string, unknown>> = [];
    const first = createRunExecutor({
      storageRoot: path.join(root, "store"),
      workspaceRoot: process.cwd(),
      models,
      post: (message) => firstMessages.push(message),
    });
    await first.ready;
    await first.handle({
      type: "run",
      runId: "run_approval_recovery",
      prompt: "写第一章",
      projectPath: project,
      mode: "live",
      agentId: "writer-copy",
      apiKey: "initial-test-key",
    });
    await waitForMessage(
      firstMessages,
      (message) => message.type === "approval.requested",
    );
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const secondMessages: Array<Record<string, unknown>> = [];
    const second = createRunExecutor({
      storageRoot: path.join(root, "store"),
      workspaceRoot: process.cwd(),
      models,
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
    expect(seenKeys).toContain("initial-test-key");
    expect(seenKeys).toContain("saved-only-test-key");
    expect(
      secondMessages.some((message) => message.type === "run.finished"),
    ).toBe(true);
    expect(
      await readFile(path.join(project, "chapters", "第一章.md"), "utf8"),
    ).toContain("恢复后的正文");
    second.close();
  });

  it("审批恢复缺少密钥时失败且不把审批标为已裁决", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-approval-key-"));
    const project = path.join(root, "project");
    await mkdir(path.join(project, ".wordhub", "agents", "writer-copy"), {
      recursive: true,
    });
    await writeFile(
      path.join(project, ".wordhub", "agents", "writer-copy", "AGENT.md"),
      approvalAgent,
      "utf8",
    );
    await mkdir(path.join(project, ".wordhub", "bible"), { recursive: true });
    await writeFile(
      path.join(project, ".wordhub", "bible", "bible.md"),
      "设定",
      "utf8",
    );
    const models = approvalModels([]);
    const firstMessages: Array<Record<string, unknown>> = [];
    const first = createRunExecutor({
      storageRoot: path.join(root, "store"),
      workspaceRoot: process.cwd(),
      models,
      post: (message) => firstMessages.push(message),
    });
    await first.ready;
    await first.handle({
      type: "run",
      runId: "run_approval_missing_key",
      prompt: "写第一章",
      projectPath: project,
      mode: "live",
      agentId: "writer-copy",
      apiKey: "initial-test-key",
    });
    await waitForMessage(
      firstMessages,
      (message) => message.type === "approval.requested",
    );
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const previousKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const secondMessages: Array<Record<string, unknown>> = [];
      const second = createRunExecutor({
        storageRoot: path.join(root, "store"),
        workspaceRoot: process.cwd(),
        models,
        post: (message) => secondMessages.push(message),
      });
      await second.ready;
      await second.handle({
        type: "run.approve",
        runId: "run_approval_missing_key",
        approved: true,
        requestId: "approval-missing-key-response",
      });
      await waitForMessage(
        secondMessages,
        (message) => message.type === "error",
      );
      expect(
        secondMessages.some((message) => message.type === "approval.granted"),
      ).toBe(false);
      expect(
        secondMessages.some((message) => message.type === "approval.rejected"),
      ).toBe(false);
      expect(
        secondMessages.find((message) => message.type === "error")?.error,
      ).toContain("DeepSeek密钥未配置");
      const [projectRecord] = JSON.parse(
        await readFile(path.join(root, "store", "projects.json"), "utf8"),
      ) as Array<{ id: string }>;
      const store = new WordHubStore(
        path.join(root, "store", "projects", projectRecord!.id),
      );
      expect(store.getRun("run_approval_missing_key")?.status).toBe("failed");
      expect(
        store
          .listEvents(projectRecord!.id)
          .some(
            (event) =>
              event.runId === "run_approval_missing_key" &&
              event.type === "run.error",
          ),
      ).toBe(true);
      store.close();
      second.close();
    } finally {
      if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousKey;
    }
  });
});
