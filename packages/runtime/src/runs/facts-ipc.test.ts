import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WordHubStore } from "@wordhub/store";
import { describe, expect, it } from "vitest";
import { createRunExecutor } from "./executor.js";

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-facts-ipc-"));
  const projectPath = path.join(root, "长安夜");
  await mkdir(projectPath, { recursive: true });
  const messages: Array<Record<string, unknown>> = [];
  const executor = createRunExecutor({
    storageRoot: path.join(root, "store"),
    workspaceRoot: process.cwd(),
    post: (message) => messages.push(message),
  });
  await executor.ready;
  await executor.handle({
    type: "run",
    runId: "run_seed",
    prompt: "你好",
    projectPath,
    mode: "mock",
  });
  const deadline = Date.now() + 5000;
  while (
    !messages.some(
      (m) => m.type === "run.finished" && m.runId === "run_seed",
    ) &&
    Date.now() < deadline
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  const projects = JSON.parse(
    await readFile(path.join(root, "store", "projects.json"), "utf8"),
  ) as Array<{ id: string }>;
  const projectId = projects[0]?.id as string;
  const store = new WordHubStore(
    path.join(root, "store", "projects", projectId),
  );
  const sessionId = store.listSessions(projectId)[0]?.id as string;
  let n = 0;
  const propose = (factId: string, subject: string) =>
    store.appendEvent({
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      projectId,
      sessionId,
      runId: "run_seed",
      type: "fact.proposed",
      actor: { type: "agent", id: "observer" },
      payload: {
        factId,
        kind: "character_state",
        subject,
        statement: `${subject}死亡`,
        chapter: "chapters/第五章.md",
        quote: `${subject}倒下了`,
      },
      idempotencyKey: `p${++n}`,
    } as never);
  const call = async (request: Record<string, unknown>) => {
    const requestId = `req_${++n}`;
    await executor.handle({ ...request, requestId } as never);
    return messages.find((m) => m.requestId === requestId) as {
      ok: boolean;
      result?: Record<string, unknown>;
      error?: string;
    };
  };
  return { projectId, sessionId, store, propose, call, executor, messages };
}

describe("fact.list / fact.decide", () => {
  it("列出待确认事实，确认后状态变化并推送给界面，可以改判", async () => {
    const t = await setup();
    t.propose("f1", "老周");
    t.propose("f2", "刘伯");
    const first = await t.call({ type: "fact.list", projectId: t.projectId });
    expect(first.ok).toBe(true);
    const facts = first.result?.facts as Array<{ id: string; status: string }>;
    expect(facts.map((f) => [f.id, f.status])).toEqual([
      ["f1", "proposed"],
      ["f2", "proposed"],
    ]);

    const decided = await t.call({
      type: "fact.decide",
      projectId: t.projectId,
      factId: "f1",
      decision: "confirm",
    });
    expect(decided.result).toMatchObject({ factId: "f1", status: "confirmed" });
    expect(
      t.messages.some(
        (m) => m.type === "fact.confirmed" && m.runId === "run_seed",
      ),
    ).toBe(true);

    await t.call({
      type: "fact.decide",
      projectId: t.projectId,
      factId: "f2",
      decision: "reject",
    });
    await t.call({
      type: "fact.decide",
      projectId: t.projectId,
      factId: "f1",
      decision: "reject",
    });
    const after = await t.call({ type: "fact.list", projectId: t.projectId });
    expect(
      (
        (after.result?.facts ?? []) as Array<{ id: string; status: string }>
      ).map((f) => [f.id, f.status]),
    ).toEqual([
      ["f1", "rejected"],
      ["f2", "rejected"],
    ]);
    t.executor.close();
  });

  it("不存在的事实返回错误", async () => {
    const t = await setup();
    const result = await t.call({
      type: "fact.decide",
      projectId: t.projectId,
      factId: "ghost",
      decision: "confirm",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("事实不存在");
    t.executor.close();
  });
});
