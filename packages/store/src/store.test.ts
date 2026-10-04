import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Event } from "@wordhub/contracts";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyChatEvent,
  ControlledFileWriter,
  createChatProjectionState,
  ExternalFileWatcher,
  projectChat,
  WordHubStore,
} from "./index.js";

const roots: string[] = [];
const openStores: WordHubStore[] = [];
const makeProject = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wordhub-m1-"));
  roots.push(root);
  const folder = path.join(root, "中文项目");
  await mkdir(folder);
  const storageDir = path.join(root, "appdata", "projects", "p1");
  const store = new WordHubStore(storageDir);
  openStores.push(store);
  const project = store.createProject({
    id: "p1",
    name: "测试项目",
    folderPath: folder,
  });
  const session = store.createSession({
    projectId: project.id,
    title: "新会话",
  });
  return { root, folder, storageDir, store, project, session };
};

afterEach(async () => {
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function event(
  projectId: string,
  sessionId: string,
  seq: number,
  type: string,
  payload: Record<string, unknown>,
  runId = "run_1",
): Event {
  return {
    schemaVersion: 1,
    id: `event_${seq}`,
    projectId,
    sessionId,
    runId,
    seq,
    type,
    actor: { type: type.startsWith("chat") ? "user" : "agent", id: "test" },
    occurredAt: new Date(1700000000000 + seq).toISOString(),
    payload,
  };
}

describe("WordHub M1 store", () => {
  it("写盘三个故障点恢复后只保留旧版或新版", async () => {
    for (const phase of [
      "before_replace",
      "after_replace",
      "before_commit",
    ] as const) {
      const { store, project, session, folder } = await makeProject();
      const stable = new ControlledFileWriter(store, project.id, folder);
      await stable.writeText({
        relativePath: "章节.md",
        content: "旧版",
        sessionId: session.id,
      });
      const faulting = new ControlledFileWriter(store, project.id, folder, {
        fault: (current) => {
          if (current === phase) throw new Error(`fault:${phase}`);
        },
      });
      await expect(
        faulting.writeText({
          relativePath: "章节.md",
          content: "新版",
          sessionId: session.id,
        }),
      ).rejects.toThrow(`fault:${phase}`);
      const beforeRecovery = await readFile(
        path.join(folder, "章节.md"),
        "utf8",
      );
      expect(beforeRecovery === "旧版" || beforeRecovery === "新版").toBe(true);
      await faulting.recover();
      const afterRecovery = await readFile(
        path.join(folder, "章节.md"),
        "utf8",
      );
      expect(afterRecovery).toBe(phase === "before_replace" ? "旧版" : "新版");
      const revisions = store.listRevisions(project.id, "file:章节.md");
      expect(
        revisions.some(
          (revision) =>
            revision.status === "current" &&
            revision.contentHash ===
              (phase === "before_replace"
                ? revisions[0]?.contentHash
                : revisions.at(-1)?.contentHash),
        ),
      ).toBe(true);
    }
  });

  it("重开存储时清扫遗留running并追加中断事件", async () => {
    const { store, project, session, storageDir } = await makeProject();
    store.startRun({
      projectId: project.id,
      sessionId: session.id,
      runId: "crashed_run",
      prompt: "中途被杀",
    });
    store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const reopened = new WordHubStore(storageDir);
    openStores.push(reopened);
    const recovered = reopened.recoverInterruptedRuns();
    expect(recovered).toHaveLength(1);
    expect(reopened.getRun("crashed_run")?.status).toBe("interrupted");
    expect(
      reopened
        .listEvents(project.id, session.id)
        .some((item) => item.type === "run.interrupted"),
    ).toBe(true);
  });

  it("重开存储时让遗留waiting_approval审批过期并中断运行", async () => {
    const { store, project, session, storageDir } = await makeProject();
    store.startRun({
      projectId: project.id,
      sessionId: session.id,
      runId: "approval_crashed",
      prompt: "等待批准",
    });
    store.finishRun("approval_crashed", "waiting_approval");
    store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const reopened = new WordHubStore(storageDir);
    openStores.push(reopened);
    const recovered = reopened.recoverInterruptedRuns();
    expect(recovered.map((event) => event.type)).toEqual([
      "approval.expired",
      "run.interrupted",
    ]);
    expect(reopened.getRun("approval_crashed")?.status).toBe("interrupted");
    expect(
      reopened.listEvents(project.id, session.id).map((event) => event.type),
    ).toContain("run.interrupted");
  });

  it("将审批过期和运行中断投影为可见恢复消息", () => {
    const events = [
      {
        id: "a",
        seq: 1,
        schemaVersion: 1 as const,
        projectId: "p",
        sessionId: "s",
        runId: "r",
        type: "approval.requested",
        actor: { type: "agent" as const, id: "writer" },
        occurredAt: new Date().toISOString(),
        visibility: "room" as const,
        payload: { tool: "doc.write", contentPreview: "正文" },
      },
      {
        id: "b",
        seq: 2,
        schemaVersion: 1 as const,
        projectId: "p",
        sessionId: "s",
        runId: "r",
        type: "approval.expired",
        actor: { type: "system" as const, id: "store" },
        occurredAt: new Date().toISOString(),
        visibility: "room" as const,
        payload: {},
      },
      {
        id: "c",
        seq: 3,
        schemaVersion: 1 as const,
        projectId: "p",
        sessionId: "s",
        runId: "r",
        type: "run.interrupted",
        actor: { type: "system" as const, id: "store" },
        occurredAt: new Date().toISOString(),
        visibility: "audit" as const,
        payload: {},
      },
    ];
    const items = projectChat(events);
    expect(
      items.some(
        (item) => item.kind === "approval" && item.resolved?.includes("过期"),
      ),
    ).toBe(true);
    expect(
      items.some(
        (item) => item.kind === "agent" && item.status === "interrupted",
      ),
    ).toBe(true);
  });

  it("按项目递增seq并按幂等键去重", async () => {
    const { store, project, session } = await makeProject();
    const base = {
      schemaVersion: 1 as const,
      projectId: project.id,
      sessionId: session.id,
      runId: "run_1",
      actor: { type: "user" as const, id: "user" },
      occurredAt: new Date().toISOString(),
      type: "chat.user_message",
      payload: { text: "门槛" },
    };
    const first = store.appendEvent({
      ...base,
      idempotencyKey: "same-message",
    });
    const duplicate = store.appendEvent({
      ...base,
      id: "different",
      idempotencyKey: "same-message",
    });
    const second = store.appendEvent({
      ...base,
      id: "second",
      payload: { text: "第二条" },
    });
    expect(first.id).toBe(duplicate.id);
    expect([first.seq, second.seq]).toEqual([1, 2]);
  });

  it("关闭后重开仍能从SQLite重放事件", async () => {
    const { store, project, session, storageDir } = await makeProject();
    store.appendEvent({
      schemaVersion: 1,
      projectId: project.id,
      sessionId: session.id,
      runId: "run_1",
      type: "chat.user_message",
      actor: { type: "user", id: "user" },
      occurredAt: new Date().toISOString(),
      payload: { text: "重启后仍在" },
    });
    store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const reopened = new WordHubStore(storageDir);
    openStores.push(reopened);
    expect(reopened.listEvents(project.id, session.id)).toHaveLength(1);
  });

  it("用逐字空格化短语支持二字中文全文检索，并保持顺序", async () => {
    const { store, project, session } = await makeProject();
    const base = {
      schemaVersion: 1 as const,
      projectId: project.id,
      sessionId: session.id,
      runId: "run_1",
      actor: { type: "user" as const, id: "user" },
      occurredAt: new Date().toISOString(),
      type: "chat.user_message",
    };
    store.appendEvent({ ...base, id: "e1", payload: { text: "门槛在这里" } });
    store.appendEvent({ ...base, id: "e2", payload: { text: "槛门倒序" } });
    expect(
      store.searchEvents(project.id, "门槛").map((item) => item.id),
    ).toEqual(["e1"]);
  });

  it("增量投影、全量重放与乱序落库一致", async () => {
    const { project, session } = await makeProject();
    fc.assert(
      fc.property(
        fc.array(fc.string({ unit: "grapheme", minLength: 1, maxLength: 8 }), {
          minLength: 1,
          maxLength: 30,
        }),
        (deltas) => {
          const events = [
            event(project.id, session.id, 1, "chat.user_message", {
              text: "开始",
            }),
            ...deltas.map((delta, index) =>
              event(project.id, session.id, index + 2, "run.text_delta", {
                delta,
              }),
            ),
            event(project.id, session.id, deltas.length + 2, "run.finished", {
              text: deltas.join(""),
            }),
          ];
          const incremental = createChatProjectionState();
          for (const current of events) applyChatEvent(incremental, current);
          expect(projectChat([...events].reverse())).toEqual(incremental.items);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("受控写盘使用原子替换，撤销会产生新的修订", async () => {
    const { store, project, session, folder } = await makeProject();
    const writer = new ControlledFileWriter(store, project.id, folder);
    await writer.writeText({
      relativePath: "chapters/第一章.md",
      content: "第一版",
      sessionId: session.id,
    });
    await writer.writeText({
      relativePath: "chapters/第一章.md",
      content: "第二版",
      sessionId: session.id,
    });
    const undone = await writer.undo({
      artifactId: "file:chapters/第一章.md",
      relativePath: "chapters/第一章.md",
      sessionId: session.id,
    });
    expect(
      await readFile(path.join(folder, "chapters", "第一章.md"), "utf8"),
    ).toBe("第一版");
    expect(undone.revision.revisionNo).toBe(3);
    expect(
      store.listRevisions(project.id, "file:chapters/第一章.md"),
    ).toHaveLength(3);
    await expect(
      writer.writeText({ relativePath: "../outside.md", content: "拒绝" }),
    ).rejects.toThrow();
  });

  it("两个Agent并发写同一章时保留双方内容", async () => {
    const { store, project, session, folder } = await makeProject();
    const writer = new ControlledFileWriter(store, project.id, folder);
    const results = await Promise.all([
      writer.writeText({
        relativePath: "chapters/并发.md",
        content: "写手版本",
        sessionId: session.id,
      }),
      writer.writeText({
        relativePath: "chapters/并发.md",
        content: "编辑版本",
        sessionId: session.id,
      }),
    ]);
    const paths = results.map((result) =>
      path.join(folder, result.relativePath),
    );
    const contents = await Promise.all(
      paths.map((file) => readFile(file, "utf8")),
    );
    expect(contents).toContain("写手版本");
    expect(contents).toContain("编辑版本");
  });

  it("拒绝通过符号链接写入项目外部", async () => {
    const { store, project, folder, root } = await makeProject();
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(folder, "link"), "junction");
    const writer = new ControlledFileWriter(store, project.id, folder);
    await expect(
      writer.writeText({ relativePath: "link/escape.md", content: "拒绝" }),
    ).rejects.toThrow();
  });

  it("报告链接文件夹里的外部修改", async () => {
    const { folder } = await makeProject();
    const file = path.join(folder, "章节.md");
    await writeFile(file, "应用写入", "utf8");
    const changes: string[] = [];
    const watcher = new ExternalFileWatcher(folder, 10);
    const stop = watcher.watch("章节.md", null, (change) =>
      changes.push(change.relativePath),
    );
    await writeFile(file, "用户外部修改", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 40));
    stop();
    expect(changes).toContain("章节.md");
  });

  it("外部修改后，受控写入不得静默覆盖用户的改动", async () => {
    const { store, project, session, folder } = await makeProject();
    const writer = new ControlledFileWriter(store, project.id, folder);
    await writer.writeText({
      relativePath: "第一章.md",
      content: "应用写入",
      sessionId: session.id,
    });
    await writeFile(path.join(folder, "第一章.md"), "用户手改", "utf8");
    const outcome = await writer
      .writeText({
        relativePath: "第一章.md",
        content: "Agent写入",
        sessionId: session.id,
      })
      .then(
        () => "written",
        () => "rejected",
      );
    const kept = await Promise.all(
      store
        .listRevisions(project.id, "file:第一章.md")
        .map((revision) => readFile(revision.snapshotPath, "utf8")),
    );
    // 期望：要么拒绝写入，要么先把用户的版本保留下来，二者必居其一。
    expect(outcome === "rejected" || kept.includes("用户手改")).toBe(true);
    expect(
      store
        .listEvents(project.id, session.id)
        .some((item) => item.type === "file.changed_externally"),
    ).toBe(true);
  });

  it("运行中途被终止后，重开时不应一直显示为streaming", async () => {
    const { project, session } = await makeProject();
    const interrupted = [
      event(project.id, session.id, 1, "chat.user_message", {
        text: "写第三章",
      }),
      event(project.id, session.id, 2, "run.started", {}),
      event(project.id, session.id, 3, "run.text_delta", {
        delta: "暮鼓三百声，",
      }),
      event(project.id, session.id, 4, "run.interrupted", {
        reason: "worker_exit",
      }),
    ];
    const agent = projectChat(interrupted).find(
      (item) => item.kind === "agent",
    );
    expect(agent?.status).not.toBe("streaming");
  });
});
