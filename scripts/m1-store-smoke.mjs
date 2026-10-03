import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ControlledFileWriter, ExternalFileWatcher, WordHubStore } from "../packages/store/dist/index.js";

const root = await mkdtemp(path.join(tmpdir(), "wordhub-m1-smoke-"));
const folder = path.join(root, "中文路径", "长安夜");
const storage = path.join(root, "appdata", "WordHub", "projects", "project_smoke");
await mkdir(folder, { recursive: true });
const store = new WordHubStore(storage);
const project = store.createProject({ id: "project_smoke", name: "长安夜", folderPath: folder });
const session = store.createSession({ projectId: project.id, title: "新会话" });
const eventBase = { schemaVersion: 1, projectId: project.id, sessionId: session.id, runId: "run_smoke", actor: { type: "user", id: "user" }, occurredAt: new Date().toISOString(), type: "chat.user_message" };
store.appendEvent({ ...eventBase, payload: { text: "门槛记录" }, idempotencyKey: "prompt-1" });
store.appendEvent({ ...eventBase, payload: { text: "第二条消息" }, idempotencyKey: "prompt-2" });
const searchHits = store.searchEvents(project.id, "门槛").map((event) => event.id);
const writer = new ControlledFileWriter(store, project.id, folder);
await writer.writeText({ relativePath: "chapters/第一章.md", content: "第一版", sessionId: session.id });
await writer.writeText({ relativePath: "chapters/第一章.md", content: "第二版", sessionId: session.id });
await writer.undo({ artifactId: "file:chapters/第一章.md", relativePath: "chapters/第一章.md", sessionId: session.id });
const afterUndo = await readFile(path.join(folder, "chapters", "第一章.md"), "utf8");
let traversalRejected = false;
try { await writer.writeText({ relativePath: "../outside.md", content: "拒绝" }); } catch { traversalRejected = true; }
const externalFile = path.join(folder, "chapters", "外部.md");
await writeFile(externalFile, "初始", "utf8");
const changes = [];
const stop = new ExternalFileWatcher(folder, 15).watch("chapters/外部.md", null, (change) => changes.push(change));
await writeFile(externalFile, "外部修改", "utf8");
await new Promise((resolve) => setTimeout(resolve, 60));
stop();
store.close();
const reopened = new WordHubStore(storage);
const result = { smoke: "m1-store", ok: searchHits.length === 1 && afterUndo === "第一版" && traversalRejected && reopened.listEvents(project.id, session.id).length === 2 && changes.length > 0, chinesePath: folder, searchHits, afterUndo, revisionCount: reopened.listRevisions(project.id, "file:chapters/第一章.md").length, traversalRejected, externalChanges: changes.length };
reopened.close();
await mkdir(path.join(process.cwd(), "artifacts"), { recursive: true });
await writeFile(path.join(process.cwd(), "artifacts", "m1-store-result.json"), JSON.stringify(result, null, 2), "utf8");
await rm(root, { recursive: true, force: true });
if (!result.ok) { console.error(JSON.stringify(result, null, 2)); process.exitCode = 1; }
else console.log(JSON.stringify(result));
