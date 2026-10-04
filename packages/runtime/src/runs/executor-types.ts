import type { Models } from "@earendil-works/pi-ai";
import type { ModelRef } from "../types.js";
import type { RunRequest } from "./run-types.js";

export type RuntimeRequest =
  | { type: "init"; storageRoot?: string; requestId?: string }
  | {
      type: "project.create";
      name: string;
      folderPath: string;
      projectId?: string;
      requestId: string;
    }
  | { type: "project.listRecent"; requestId: string }
  | {
      type: "session.create";
      projectId: string;
      title: string;
      sessionId?: string;
      requestId: string;
    }
  | { type: "session.list"; projectId: string; requestId: string }
  | {
      type: "session.rename";
      sessionId: string;
      title: string;
      projectId?: string;
      requestId: string;
    }
  | {
      type: "chat.list";
      projectId: string;
      sessionId: string;
      requestId: string;
    }
  | {
      type: "file.write";
      projectId: string;
      folderPath: string;
      relativePath: string;
      content: string;
      sessionId?: string;
      artifactId?: string;
      runId?: string;
      taskId?: string;
      expectedHash?: `sha256:${string}` | null;
      conflictPolicy?: "reject" | "keep-both";
      requestId: string;
    }
  | {
      type: "file.undo";
      projectId: string;
      folderPath: string;
      relativePath: string;
      artifactId: string;
      sessionId?: string;
      requestId: string;
    }
  | {
      type: "run.approve";
      runId: string;
      approved: boolean;
      apiKey?: string;
      requestId: string;
    }
  | { type: "settings.models"; projectPath?: string; requestId: string }
  | {
      type: "settings.testConnection";
      provider: string;
      apiKey?: string;
      requestId: string;
    }
  | {
      type: "run.estimate";
      prompt: string;
      rawPrompt?: string;
      agentId?: string;
      projectPath?: string;
      workflow?: RunRequest["workflow"];
      requestId: string;
    }
  | {
      type: "settings.setAgentModel";
      projectPath?: string;
      agentId: string;
      model: ModelRef;
      requestId: string;
    }
  | RunRequest
  | { type: "run.resume"; runId: string; apiKey?: string; requestId: string }
  | {
      type: "challenge.decide";
      workflowId: string;
      threadId: string;
      decision: "accept" | "keep";
      apiKey?: string;
      requestId: string;
    }
  | { type: "abort"; runId: string };

export type ExecutorOptions = {
  storageRoot: string;
  workspaceRoot: string;
  models?: Models;
  mockModels?: Models;
  post: (message: Record<string, unknown>) => void;
};
/** 独立于Electron的运行编排模块；产品与faux测试跨同一个接口。 */
