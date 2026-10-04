import type { Actor, Event } from "@wordhub/contracts";
import type { WordHubStore } from "@wordhub/store";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";
import type { ModelRef, AgentDefinition } from "../types.js";
import type { PermissionGuard } from "../tools/permissions.js";

export type RunRequest = {
  type: "run";
  runId: string;
  prompt: string;
  rawPrompt?: string;
  agentId?: string;
  mentions?: string[];
  apiKey?: string;
  model?: string;
  reasoning?: string;
  mode?: "live" | "mock";
  toolRoundTrip?: boolean;
  projectPath?: string;
  projectId?: string;
  sessionId?: string;
  resume?: boolean;
  workflow?: "write-chapter" | "write-chapter-full" | "review-only" | "all";
  workflowId?: string;
  taskId?: string;
  taskKind?: string;
  dependencies?: string[];
  internal?: boolean;
  nodeId?: string;
};

export type RunContext = {
  store: WordHubStore;
  request: RunRequest;
  cancelled: boolean;
  finished: boolean;
  waitingApproval?: boolean;
  taskId?: string;
};

export type PendingApproval = {
  toolCallId: string;
  toolName: string;
  args: unknown;
  resolve: (approved: boolean) => void;
};

export type AppendRunEvent = (
  store: WordHubStore,
  request: RunRequest,
  type: string,
  actor: Actor,
  payload: Record<string, unknown>,
  idempotencyKey?: string,
) => Event;

export type HostState = {
  text: string;
  lastUsage: unknown;
  hasSideEffects: boolean;
  hasCommittedWrite?: boolean;
  activeModelForSnapshot: { provider: string; id: string };
  activeRefForSnapshot: ModelRef;
};

export type RunHostDeps = {
  runtimeModels: Models;
  request: RunRequest;
  definition: AgentDefinition | undefined;
  agentId: string;
  store: WordHubStore;
  guard: PermissionGuard;
  configuredTools: AgentTool[];
  systemPrompt: string;
  echoTool: AgentTool;
  pendingApprovals: Map<string, PendingApproval>;
  restoredApprovals: Map<string, boolean>;
  runContexts: Map<string, RunContext>;
  appendRunEvent: AppendRunEvent;
  post: (message: Record<string, unknown>) => void;
  saveSnapshot: (messages: unknown[], pendingToolCalls?: unknown[]) => void;
};

export type RunLoopDeps = {
  post: (message: Record<string, unknown>) => void;
  models: Models;
  mockModels: Models;
  active: Map<string, { abort(): void }>;
  runContexts: Map<string, RunContext>;
  pendingApprovals: Map<string, PendingApproval>;
  restoredApprovals: Map<string, boolean>;
  ensureRunContext: (request: RunRequest) => Promise<WordHubStore>;
  resolveAgent: (request: RunRequest) => Promise<{
    definition: AgentDefinition;
    modelRef: ModelRef;
    fallbackRef?: ModelRef;
  }>;
  buildRunContext: (
    request: RunRequest,
    store: WordHubStore,
    definition: AgentDefinition,
  ) => Promise<{ messages: AgentMessage[] }>;
  createAgentTools: (
    request: RunRequest,
    store: WordHubStore,
    definition: AgentDefinition,
  ) => AgentTool[];
  appendRunEvent: AppendRunEvent;
};
