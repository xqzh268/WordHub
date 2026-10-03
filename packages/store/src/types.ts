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
  status: "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  prompt: string;
  model?: string;
  startedAt: string;
  endedAt?: string;
  error?: string;
};
export type NewEvent = Omit<Event, "seq" | "id"> & {
  id?: string;
  seq?: number;
};
export type UsageRecord = {
  runId: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
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
