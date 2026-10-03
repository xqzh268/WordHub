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
  ControlledFileWriter,
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

  it("重放投影和在线顺序一致", async () => {
    const { project, session } = await makeProject();
    const deltas = fc.sample(
      fc.string({ unit: "grapheme", minLength: 1, maxLength: 8 }),
      12,
    );
    const events = [
      event(project.id, session.id, 1, "chat.user_message", { text: "开始" }),
      ...deltas.map((delta, index) =>
        event(project.id, session.id, index + 2, "run.text_delta", { delta }),
      ),
    ];
    const online = projectChat(events);
    const replayed = projectChat([...events].reverse());
    expect(replayed).toEqual(online);
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

  // ── 已知缺陷（见 docs/m1-acceptance.md）。修复后把 it.fails 改回 it。 ──
  it.fails("外部修改后，受控写入不得静默覆盖用户的改动", async () => {
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
  });

  it.fails("运行中途被终止后，重开时不应一直显示为streaming", async () => {
    const { project, session } = await makeProject();
    const interrupted = [
      event(project.id, session.id, 1, "chat.user_message", {
        text: "写第三章",
      }),
      event(project.id, session.id, 2, "run.started", {}),
      event(project.id, session.id, 3, "run.text_delta", {
        delta: "暮鼓三百声，",
      }),
    ];
    const agent = projectChat(interrupted).find(
      (item) => item.kind === "agent",
    );
    expect(agent?.status).not.toBe("streaming");
  });
});
