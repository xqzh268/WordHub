import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Actor, Event, Hash, Revision } from "@wordhub/contracts";
import { normalizeSearchText, searchPhrase } from "./fts.js";
import type {
  FileWriteResult,
  NewEvent,
  ProjectRecord,
  RevisionRecord,
  RunRecord,
  SessionRecord,
  UsageRecord,
  WriteAuthor,
} from "./types.js";

type SqlRow = Record<string, unknown>;
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;
const asString = (value: unknown): string => String(value ?? "");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, folder_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), session_id TEXT NOT NULL REFERENCES sessions(id),
  status TEXT NOT NULL, prompt TEXT NOT NULL, model TEXT, started_at TEXT NOT NULL, ended_at TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), session_id TEXT NOT NULL,
  run_id TEXT NOT NULL, task_id TEXT, seq INTEGER NOT NULL, type TEXT NOT NULL,
  actor_type TEXT NOT NULL, actor_id TEXT NOT NULL, occurred_at TEXT NOT NULL, causation_id TEXT,
  correlation_id TEXT, idempotency_key TEXT, visibility TEXT, refs_json TEXT, payload_json TEXT NOT NULL,
  UNIQUE(project_id, seq), UNIQUE(project_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS events_project_seq ON events(project_id, seq);
CREATE TABLE IF NOT EXISTS usage (
  run_id TEXT PRIMARY KEY, model TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id), session_id TEXT,
  revision_no INTEGER NOT NULL, parent_revision_id TEXT, status TEXT NOT NULL, content_hash TEXT NOT NULL,
  content_type TEXT, storage_path TEXT NOT NULL, patch_json TEXT, author_json TEXT NOT NULL,
  source_task_id TEXT, source_event_id TEXT, approved_by_event_id TEXT, created_at TEXT NOT NULL,
  UNIQUE(project_id, artifact_id, revision_no)
);
CREATE INDEX IF NOT EXISTS revisions_current ON revisions(project_id, artifact_id, status);
CREATE VIRTUAL TABLE IF NOT EXISTS event_fts USING fts5(event_id UNINDEXED, project_id UNINDEXED, body, tokenize='unicode61');
`;

function projectRow(row: SqlRow): ProjectRecord {
  return {
    id: asString(row.id),
    name: asString(row.name),
    folderPath: asString(row.folder_path),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}
function sessionRow(row: SqlRow): SessionRecord {
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    title: asString(row.title),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}
function eventRow(row: SqlRow): Event {
  return {
    schemaVersion: 1,
    id: asString(row.id),
    projectId: asString(row.project_id),
    sessionId: asString(row.session_id),
    runId: asString(row.run_id),
    taskId: row.task_id ? asString(row.task_id) : undefined,
    seq: Number(row.seq),
    type: asString(row.type),
    actor: {
      type: asString(row.actor_type) as Actor["type"],
      id: asString(row.actor_id),
    },
    occurredAt: asString(row.occurred_at),
    causationId: row.causation_id ? asString(row.causation_id) : undefined,
    correlationId: row.correlation_id
      ? asString(row.correlation_id)
      : undefined,
    idempotencyKey: row.idempotency_key
      ? asString(row.idempotency_key)
      : undefined,
    visibility: row.visibility
      ? (asString(row.visibility) as Event["visibility"])
      : undefined,
    refs: row.refs_json ? JSON.parse(asString(row.refs_json)) : undefined,
    payload: JSON.parse(asString(row.payload_json)),
  };
}

export class WordHubStore {
  readonly dbPath: string;
  private readonly db: DatabaseSync;

  constructor(readonly storageDir: string) {
    mkdirSync(storageDir, { recursive: true });
    this.dbPath = path.join(storageDir, "wordhub.sqlite");
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    const version = Number(
      (this.db.prepare("PRAGMA user_version").get() as SqlRow).user_version ??
        0,
    );
    if (version < 1) {
      this.db.exec(SCHEMA);
      this.db.exec("PRAGMA user_version = 1;");
    } else this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  createProject(input: {
    id?: string;
    name: string;
    folderPath: string;
  }): ProjectRecord {
    const timestamp = now();
    const project = {
      id: input.id ?? id("project"),
      name: input.name,
      folderPath: path.resolve(input.folderPath),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db
      .prepare(
        "INSERT INTO projects(id,name,folder_path,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(folder_path) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at",
      )
      .run(
        project.id,
        project.name,
        project.folderPath,
        project.createdAt,
        project.updatedAt,
      );
    const row = this.db
      .prepare("SELECT * FROM projects WHERE folder_path=?")
      .get(project.folderPath) as SqlRow;
    return projectRow(row);
  }
  getProject(projectId: string): ProjectRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM projects WHERE id=?")
      .get(projectId) as SqlRow | undefined;
    return row ? projectRow(row) : undefined;
  }
  listProjects(): ProjectRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
        .all() as SqlRow[]
    ).map(projectRow);
  }

  createSession(input: {
    projectId: string;
    id?: string;
    title: string;
  }): SessionRecord {
    const timestamp = now();
    const session = {
      id: input.id ?? id("session"),
      projectId: input.projectId,
      title: input.title,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db
      .prepare(
        "INSERT INTO sessions(id,project_id,title,created_at,updated_at) VALUES(?,?,?,?,?)",
      )
      .run(
        session.id,
        session.projectId,
        session.title,
        session.createdAt,
        session.updatedAt,
      );
    return session;
  }
  listSessions(projectId: string): SessionRecord[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM sessions WHERE project_id=? ORDER BY updated_at DESC",
        )
        .all(projectId) as SqlRow[]
    ).map(sessionRow);
  }
  renameSession(sessionId: string, title: string): void {
    this.db
      .prepare("UPDATE sessions SET title=?,updated_at=? WHERE id=?")
      .run(title, now(), sessionId);
  }

  startRun(input: {
    projectId: string;
    sessionId: string;
    runId?: string;
    prompt: string;
    model?: string;
  }): RunRecord {
    const run: RunRecord = {
      id: input.runId ?? id("run"),
      projectId: input.projectId,
      sessionId: input.sessionId,
      status: "running",
      prompt: input.prompt,
      model: input.model,
      startedAt: now(),
    };
    this.db
      .prepare(
        "INSERT INTO runs(id,project_id,session_id,status,prompt,model,started_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        run.id,
        run.projectId,
        run.sessionId,
        run.status,
        run.prompt,
        run.model ?? null,
        run.startedAt,
      );
    return run;
  }
  finishRun(runId: string, status: RunRecord["status"], error?: string): void {
    this.db
      .prepare("UPDATE runs SET status=?,ended_at=?,error=? WHERE id=?")
      .run(status, now(), error ?? null, runId);
  }

  appendEvent(input: NewEvent): Event {
    if (input.idempotencyKey) {
      const existing = this.db
        .prepare(
          "SELECT * FROM events WHERE project_id=? AND idempotency_key=?",
        )
        .get(input.projectId, input.idempotencyKey) as SqlRow | undefined;
      if (existing) return eventRow(existing);
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const nextSeq = Number(
        (
          this.db
            .prepare(
              "SELECT COALESCE(MAX(seq),0)+1 AS next_seq FROM events WHERE project_id=?",
            )
            .get(input.projectId) as SqlRow
        ).next_seq,
      );
      const event: Event = {
        ...input,
        id: input.id ?? id("evt"),
        seq: input.seq ?? nextSeq,
      };
      this.db
        .prepare(
          "INSERT INTO events(id,project_id,session_id,run_id,task_id,seq,type,actor_type,actor_id,occurred_at,causation_id,correlation_id,idempotency_key,visibility,refs_json,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          event.id,
          event.projectId,
          event.sessionId,
          event.runId,
          event.taskId ?? null,
          event.seq,
          event.type,
          event.actor.type,
          event.actor.id,
          event.occurredAt,
          event.causationId ?? null,
          event.correlationId ?? null,
          event.idempotencyKey ?? null,
          event.visibility ?? null,
          event.refs ? JSON.stringify(event.refs) : null,
          JSON.stringify(event.payload),
        );
      this.db
        .prepare(
          "INSERT INTO event_fts(event_id,project_id,body) VALUES(?,?,?)",
        )
        .run(
          event.id,
          event.projectId,
          normalizeSearchText(JSON.stringify(event.payload)),
        );
      this.db.exec("COMMIT");
      return event;
    } catch (error) {
      this.db.exec("ROLLBACK");
      if (input.idempotencyKey) {
        const existing = this.db
          .prepare(
            "SELECT * FROM events WHERE project_id=? AND idempotency_key=?",
          )
          .get(input.projectId, input.idempotencyKey) as SqlRow | undefined;
        if (existing) return eventRow(existing);
      }
      throw error;
    }
  }
  listEvents(projectId: string, sessionId?: string): Event[] {
    const rows = (
      sessionId
        ? this.db
            .prepare(
              "SELECT * FROM events WHERE project_id=? AND session_id=? ORDER BY seq",
            )
            .all(projectId, sessionId)
        : this.db
            .prepare("SELECT * FROM events WHERE project_id=? ORDER BY seq")
            .all(projectId)
    ) as SqlRow[];
    return rows.map(eventRow);
  }
  searchEvents(projectId: string, query: string): Event[] {
    const phrase = searchPhrase(query);
    if (!phrase) return [];
    return (
      this.db
        .prepare(
          "SELECT e.* FROM events e JOIN event_fts f ON f.event_id=e.id WHERE f.project_id=? AND f.body MATCH ? ORDER BY e.seq",
        )
        .all(projectId, phrase) as SqlRow[]
    ).map(eventRow);
  }
  recordUsage(usage: UsageRecord): void {
    this.db
      .prepare(
        "INSERT INTO usage(run_id,model,input_tokens,output_tokens,cost_usd,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET model=excluded.model,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,cost_usd=excluded.cost_usd",
      )
      .run(
        usage.runId,
        usage.model ?? null,
        usage.inputTokens ?? null,
        usage.outputTokens ?? null,
        usage.costUsd ?? null,
        usage.createdAt,
      );
  }

  private nextRevision(projectId: string, artifactId: string): number {
    return Number(
      (
        this.db
          .prepare(
            "SELECT COALESCE(MAX(revision_no),0)+1 AS next_no FROM revisions WHERE project_id=? AND artifact_id=?",
          )
          .get(projectId, artifactId) as SqlRow
      ).next_no,
    );
  }
  listRevisions(projectId: string, artifactId: string): RevisionRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM revisions WHERE project_id=? AND artifact_id=? ORDER BY revision_no",
      )
      .all(projectId, artifactId) as SqlRow[];
    return rows.map((row) => ({
      schemaVersion: 1,
      id: asString(row.id),
      artifactId: asString(row.artifact_id),
      projectId: asString(row.project_id),
      sessionId: row.session_id ? asString(row.session_id) : undefined,
      revisionNo: Number(row.revision_no),
      parentRevisionId: row.parent_revision_id
        ? asString(row.parent_revision_id)
        : undefined,
      status: asString(row.status) as Revision["status"],
      contentHash: asString(row.content_hash) as Hash,
      contentType: row.content_type ? asString(row.content_type) : undefined,
      storagePath: asString(row.storage_path),
      patch: row.patch_json ? JSON.parse(asString(row.patch_json)) : undefined,
      author: JSON.parse(asString(row.author_json)),
      sourceEventId: row.source_event_id
        ? asString(row.source_event_id)
        : undefined,
      createdAt: asString(row.created_at),
      snapshotPath: asString(row.storage_path),
    }));
  }
  addRevision(input: {
    id: string;
    artifactId: string;
    projectId: string;
    sessionId?: string;
    parentRevisionId?: string;
    status: Revision["status"];
    contentHash: Hash;
    contentType?: string;
    snapshotPath: string;
    patch?: Record<string, unknown>;
    author: Actor;
    sourceTaskId?: string;
    sourceEventId?: string;
    approvedByEventId?: string;
  }): RevisionRecord {
    const revision: RevisionRecord = {
      schemaVersion: 1,
      ...input,
      revisionNo: this.nextRevision(input.projectId, input.artifactId),
      storagePath: input.snapshotPath,
      createdAt: now(),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "UPDATE revisions SET status='superseded' WHERE project_id=? AND artifact_id=? AND status='current'",
        )
        .run(input.projectId, input.artifactId);
      const revisionValues = [
        revision.id,
        revision.artifactId,
        revision.projectId,
        revision.sessionId ?? null,
        revision.revisionNo,
        revision.parentRevisionId ?? null,
        revision.status,
        revision.contentHash,
        revision.contentType ?? null,
        revision.storagePath,
        revision.patch ? JSON.stringify(revision.patch) : null,
        JSON.stringify(revision.author),
        revision.sourceTaskId ?? null,
        revision.sourceEventId ?? null,
        revision.approvedByEventId ?? null,
        revision.createdAt,
      ] as Array<string | number | null>;
      this.db
        .prepare(
          "INSERT INTO revisions(id,artifact_id,project_id,session_id,revision_no,parent_revision_id,status,content_hash,content_type,storage_path,patch_json,author_json,source_task_id,source_event_id,approved_by_event_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(...revisionValues);
      this.db.exec("COMMIT");
      return revision;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

export class ControlledFileWriter {
  constructor(
    private readonly store: WordHubStore,
    private readonly projectId: string,
    private readonly linkedFolder: string,
  ) {}

  private async safeTarget(
    relativePath: string,
  ): Promise<{ root: string; target: string }> {
    const root = await realpath(this.linkedFolder);
    const normalized = relativePath.replaceAll("\\", "/");
    const parts = normalized.split("/");
    if (
      !normalized ||
      path.posix.isAbsolute(normalized) ||
      parts.some((part) => part === ".." || part === ".wordhub")
    )
      throw new Error("文件路径不在项目受控范围内");
    const target = path.resolve(root, normalized);
    if (target !== root && !target.startsWith(`${root}${path.sep}`))
      throw new Error("文件路径越过项目根目录");
    for (let index = 1; index < parts.length; index += 1) {
      const candidate = path.join(root, ...parts.slice(0, index));
      const info = await lstat(candidate).catch(() => undefined);
      if (info?.isSymbolicLink())
        throw new Error("不允许通过符号链接写入项目文件");
    }
    return { root, target };
  }

  async writeText(input: {
    relativePath: string;
    content: string;
    sessionId?: string;
    artifactId?: string;
    author?: WriteAuthor;
    contentType?: string;
  }): Promise<FileWriteResult> {
    const { target } = await this.safeTarget(input.relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    const artifactId =
      input.artifactId ?? `file:${input.relativePath.replaceAll("\\", "/")}`;
    const revisions = this.store.listRevisions(this.projectId, artifactId);
    const parent = revisions.at(-1);
    const revisionId = id("rev");
    const contentHash =
      `sha256:${createHash("sha256").update(input.content, "utf8").digest("hex")}` as Hash;
    const snapshotDir = path.join(
      this.store.storageDir,
      "snapshots",
      artifactId.replace(/[^a-zA-Z0-9._-]/gu, "_"),
    );
    const snapshotPath = path.join(snapshotDir, `${revisionId}.snapshot`);
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(snapshotPath, input.content, "utf8");
    const temporary = path.join(
      path.dirname(target),
      `.${path.basename(target)}.${revisionId}.tmp`,
    );
    const handle = await open(temporary, "w");
    try {
      await handle.writeFile(input.content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
    const revision = this.store.addRevision({
      id: revisionId,
      artifactId,
      projectId: this.projectId,
      sessionId: input.sessionId,
      parentRevisionId: parent?.id,
      status: "current",
      contentHash,
      contentType: input.contentType ?? "text/markdown",
      snapshotPath,
      author: input.author ?? { type: "user", id: "user" },
    });
    return {
      relativePath: input.relativePath,
      revision,
      contentHash,
      bytes: Buffer.byteLength(input.content, "utf8"),
    };
  }

  async undo(input: {
    artifactId: string;
    relativePath: string;
    sessionId?: string;
    author?: WriteAuthor;
  }): Promise<FileWriteResult> {
    const revisions = this.store.listRevisions(
      this.projectId,
      input.artifactId,
    );
    const current =
      [...revisions]
        .reverse()
        .find((revision) => revision.status === "current") ?? revisions.at(-1);
    if (!current?.parentRevisionId) throw new Error("没有可撤销的修订");
    const parent = revisions.find(
      (revision) => revision.id === current.parentRevisionId,
    );
    if (!parent) throw new Error("撤销目标修订不存在");
    return this.writeText({
      relativePath: input.relativePath,
      content: await readFile(parent.snapshotPath, "utf8"),
      sessionId: input.sessionId,
      artifactId: input.artifactId,
      author: input.author,
      contentType: parent.contentType,
    });
  }
}

export { id as createId, now as timestamp };
