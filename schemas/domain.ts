/** P0持久化边界的TypeScript镜像；JSON Schema才是运行时校验源。 */
export type Id = string;
export type IsoDateTime = string;
export type Hash = `sha256:${string}`;
export type Actor = { type: 'user' | 'agent' | 'system'; id: string; agentVersion?: string };
export type Ref = { kind: string; id: Id; versionId?: Id };
export type Anchor = { sourceId: Id; sourceHash: Hash; exact?: string; prefix?: string; suffix?: string; chapter?: number; scene?: number; paragraph?: number; page?: number; start?: number; end?: number; cfi?: string };

export interface Event<T = Record<string, unknown>> {
  schemaVersion: 1; id: Id; projectId: Id; sessionId: Id; runId: Id; taskId?: Id; seq: number;
  type: string; actor: Actor; occurredAt: IsoDateTime; causationId?: Id; correlationId?: Id;
  idempotencyKey?: string; visibility?: 'room' | 'thread' | 'internal' | 'audit'; refs?: Ref[]; payload: T;
}
export type TaskStatus = 'pending' | 'ready' | 'running' | 'waiting_approval' | 'blocked' | 'succeeded' | 'failed' | 'cancelled';
export interface Task { schemaVersion: 1; id: Id; projectId: Id; sessionId: Id; runId: Id; kind: string; status: TaskStatus; assignedAgent?: string; dependencies: Id[]; inputRefs?: Ref[]; outputRefs?: Ref[]; contextSnapshotId: Id; attempt?: number; maxAttempts?: number; budget?: { inputTokens?: number; outputTokens?: number; usd?: number; deadlineMs?: number }; checkpoint?: { eventId?: Id; cursor?: string; stateHash?: Hash }; createdAt: IsoDateTime; updatedAt: IsoDateTime; }
export interface Revision { schemaVersion: 1; id: Id; artifactId: Id; projectId: Id; revisionNo: number; parentRevisionId?: Id; status: 'candidate' | 'current' | 'rejected' | 'reverted' | 'superseded'; contentHash: Hash; contentType?: string; storagePath?: string; patch?: Record<string, unknown>; author: Actor; sourceTaskId?: Id; sourceEventId?: Id; approvedByEventId?: Id; createdAt: IsoDateTime; }
export interface Fact { schemaVersion: 1; id: Id; projectId: Id; statement: { subject: string; predicate: string; object: unknown }; status: 'proposed' | 'accepted' | 'rejected' | 'invalidated' | 'reverted'; confidence?: number; assertedBy: Actor; sourceRefs: Anchor[]; validFrom?: Anchor; validTo?: Anchor; revealedAt?: Anchor; supersedes?: Id; scope?: string; canon: boolean; branchId?: string; createdAt: IsoDateTime; }
export interface GraphNode { id: Id; type: string; label: string; aliases?: { name: string; revealedAt?: Anchor }[]; props?: Record<string, unknown>; status: Fact['status']; sourceRefs: Anchor[]; confidence?: number; assertedBy?: Actor; canon: boolean; branchId?: string; }
export interface GraphEdge { id: Id; src: Id; dst: Id; rel: string; factId?: Id; status: Fact['status']; sourceRefs: Anchor[]; confidence?: number; assertedBy?: Actor; validFrom?: Anchor; validTo?: Anchor; revealedAt?: Anchor; canon: boolean; branchId?: string; }
export interface Graph { schemaVersion: 1; id: Id; projectId: Id; nodes: GraphNode[]; edges: GraphEdge[]; canon: boolean; branchId?: string; createdAt: IsoDateTime; }
