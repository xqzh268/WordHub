import type { Actor, Event, Hash, Revision } from "@wordhub/contracts";

export type ProjectRecord = {
  id: string;
  name: string;
  folderPath: string;
  createdAt: string;
  updatedAt: string;
};
export type SessionRecord = {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};
export type RunRecord = {
  id: string;
  projectId: string;
  sessionId: string;
  status:
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "interrupted"
    | "waiting_approval";
  prompt: string;
  model?: string;
  startedAt: string;
  endedAt?: string;
  error?: string;
};
export type NewEvent = Omit<Event, "seq" | "id"> & {
  id?: string;
};
export type UsageRecord = {
  runId: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  createdAt: string;
};
export type TaskRecord = {
  id: string;
  projectId: string;
  sessionId: string;
  runId: string;
  kind: string;
  status: import("@wordhub/contracts").TaskStatus;
  assignedAgent?: string;
  dependencies: string[];
  inputRefs?: unknown[];
  outputRefs?: unknown[];
  contextSnapshotId: string;
  attempt: number;
  maxAttempts: number;
  budget?: Record<string, unknown>;
  checkpoint?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
export type RunSnapshotRecord = {
  id: string;
  projectId: string;
  sessionId: string;
  runId: string;
  sequence: number;
  messages: unknown[];
  systemPrompt?: string;
  model?: Record<string, unknown>;
  pendingToolCalls?: unknown[];
  createdAt: string;
};
export type RevisionRecord = Revision & {
  snapshotPath: string;
  sessionId?: string;
};
export type FileWriteResult = {
  relativePath: string;
  revision: RevisionRecord;
  contentHash: Hash;
  bytes: number;
};
export type WriteAuthor = Actor;
export type ConflictPolicy = "reject" | "keep-both";
