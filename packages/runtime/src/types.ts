import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
} from "@earendil-works/pi-agent-core";
import type {
  Model,
  Models,
  ModelThinkingLevel,
  Usage,
} from "@earendil-works/pi-ai";

export type ReasoningLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
export type WriteLevel = "none" | "propose" | "write";
export type AgentSource = "builtin" | "project" | "global";

export type AgentFrontmatter = {
  name: string;
  displayName: string;
  description: string;
  avatar?: { glyph?: string; color?: string };
  model: ModelRef;
  fallback?: ModelRef;
  tools: string[];
  write: WriteLevel;
  writeScopes?: string[];
  confirmBeforeWrite?: boolean;
  memoryScopes: { read: string[]; write: string[] };
  canChallenge?: string[];
  maxTurns: number;
  skills?: string[];
};

export type AgentDefinition = AgentFrontmatter & {
  source: AgentSource;
  sourcePath: string;
  systemPrompt: string;
  version: string;
};

export type ModelRef = {
  provider: string;
  id: string;
  reasoning: ReasoningLevel;
};

export type ModelCatalogEntry = {
  id: string;
  label: string;
  contextWindow: number;
  maxOutputTokens?: number;
  supportsReasoning: boolean;
  supportedReasoning?: ReasoningLevel[];
  pricing: {
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
    cacheReadUsdPerMillion: number;
  };
};

export type ProviderConfig = {
  id: string;
  label: string;
  kind: "builtin" | "openai-compatible" | "custom";
  enabled: boolean;
  baseUrl?: string;
  credentialRef?: string;
  models: ModelCatalogEntry[];
};

export type ModelConfig = {
  schemaVersion: 1;
  defaults: ModelRef;
  providers: ProviderConfig[];
};

export type CredentialStore = {
  get(provider: string, reference?: string): Promise<string | undefined>;
  set(provider: string, secret: string, reference?: string): Promise<void>;
  delete(provider: string, reference?: string): Promise<void>;
};

export type ContextLayer = {
  id: string;
  kind: "bible" | "outline" | "recent" | "document" | "memory" | "custom";
  text: string;
  sourcePath?: string;
};

export type ContextManifestItem = ContextLayer & { estimatedTokens: number };
export type BuiltContext = {
  messages: AgentMessage[];
  manifest: ContextManifestItem[];
  estimatedTokens: number;
};

export type RuntimeStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | {
      type: "tool_started";
      toolName: string;
      toolCallId: string;
      args?: unknown;
    }
  | { type: "tool_finished"; toolName: string; toolCallId: string; ok: boolean }
  | { type: "usage"; usage: Usage }
  | { type: "agent_event"; event: AgentEvent };

export type PiRuntimeModel = Model<
  "deepseek" | "openai-completions" | "openai-responses" | string
>;
export type PiRuntimeModels = Models;
export type PiRuntimeTool = AgentTool;
export type PiRuntimeThinking = ModelThinkingLevel;
