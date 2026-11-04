import type { Models } from "@earendil-works/pi-ai";
import type { ModelRef } from "../types.js";
import type { AgentFormInput } from "../agents/custom.js";
import type { ExportRequest } from "../export/run.js";
import type { MetaPatch } from "../references/shelf.js";
import type { CustomProviderInput } from "../models/providers.js";
import type {
  InterviewRequest,
  InterviewSaveRequest,
  SimulationEstimateRequest,
  SimulationReportRequest,
  SimulationSaveRequest,
  SimulationStepRequest,
} from "../graph/service.js";
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
  | { type: "chapter.list"; projectId: string; requestId: string }
  | {
      type: "chapter.read";
      projectId: string;
      path: string;
      requestId: string;
    }
  | {
      type: "chapter.write";
      projectId: string;
      folderPath: string;
      path: string;
      content: string;
      expectedHash?: `sha256:${string}` | null;
      sessionId?: string;
      requestId: string;
    }
  | {
      type: "chapter.undo";
      projectId: string;
      folderPath: string;
      path: string;
      sessionId?: string;
      requestId: string;
    }
  | {
      type: "chapter.revisions";
      projectId: string;
      path: string;
      requestId: string;
    }
  | { type: "chapter.watch"; projectId: string; requestId: string }
  | { type: "export.fonts"; requestId: string }
  | { type: "reference.list"; folder: string; requestId: string }
  | {
      type: "reference.import";
      folder: string;
      files: string[];
      requestId: string;
    }
  | {
      type: "reference.read";
      folder: string;
      referenceId: string;
      chapterId: string;
      requestId: string;
    }
  | {
      type: "reference.search";
      folder: string;
      query: string;
      referenceId?: string;
      requestId: string;
    }
  | {
      type: "reference.delete";
      folder: string;
      referenceId: string;
      requestId: string;
    }
  | { type: "reference.styleSamples"; folder: string; requestId: string }
  | {
      type: "reference.update";
      folder: string;
      referenceId: string;
      patch: MetaPatch;
      requestId: string;
    }
  | {
      type: "reference.collectionCreate";
      folder: string;
      name: string;
      requestId: string;
    }
  | {
      type: "reference.collectionRename";
      folder: string;
      id: string;
      name: string;
      requestId: string;
    }
  | {
      type: "reference.collectionDelete";
      folder: string;
      id: string;
      requestId: string;
    }
  | {
      type: "reference.opened";
      folder: string;
      referenceId: string;
      chapterId: string;
      requestId: string;
    }
  | {
      type: "reference.annotations";
      folder: string;
      referenceId: string;
      requestId: string;
    }
  | {
      type: "reference.annotationAdd";
      folder: string;
      referenceId: string;
      chapterId: string;
      start: number;
      end: number;
      color?: "yellow" | "green" | "blue" | "pink";
      note?: string;
      requestId: string;
    }
  | {
      type: "reference.annotationUpdate";
      folder: string;
      referenceId: string;
      annotationId: string;
      note?: string | null;
      color?: "yellow" | "green" | "blue" | "pink";
      requestId: string;
    }
  | {
      type: "reference.annotationDelete";
      folder: string;
      referenceId: string;
      annotationId: string;
      requestId: string;
    }
  | {
      type: "reference.coverFile";
      folder: string;
      referenceId: string;
      requestId: string;
    }
  | {
      type: "reference.addStyleSample";
      folder: string;
      projectId: string;
      sessionId?: string;
      referenceId: string;
      chapterId: string;
      start: number;
      end: number;
      requestId: string;
    }
  | {
      type: "reference.removeStyleSample";
      folder: string;
      projectId: string;
      sessionId?: string;
      index: number;
      requestId: string;
    }
  | { type: "agent.catalog"; requestId: string }
  | { type: "agent.get"; projectPath: string; name: string; requestId: string }
  | {
      type: "agent.save";
      projectPath: string;
      mode: "create" | "update";
      agent: AgentFormInput;
      requestId: string;
    }
  | {
      type: "agent.delete";
      projectPath: string;
      name: string;
      requestId: string;
    }
  | ({ type: "export.run"; requestId: string } & ExportRequest)
  | { type: "fact.list"; projectId: string; requestId: string }
  | ({ type: "graph.interview"; requestId: string } & InterviewRequest)
  | ({ type: "graph.interviewSave"; requestId: string } & InterviewSaveRequest)
  | ({
      type: "graph.simulateEstimate";
      requestId: string;
    } & SimulationEstimateRequest)
  | ({ type: "graph.simulateStep"; requestId: string } & SimulationStepRequest)
  | ({
      type: "graph.simulateReport";
      requestId: string;
    } & SimulationReportRequest)
  | ({ type: "graph.simulateSave"; requestId: string } & SimulationSaveRequest)
  | { type: "project.prefs.get"; projectId: string; requestId: string }
  | {
      type: "project.prefs.set";
      projectId: string;
      autoReviewOnFinalize?: boolean;
      requestId: string;
    }
  | {
      type: "fact.decide";
      projectId: string;
      factId: string;
      decision: "confirm" | "reject";
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
      requestId: string;
    }
  | { type: "settings.models"; projectPath?: string; requestId: string }
  | {
      type: "settings.testConnection";
      provider: string;
      model?: string;
      projectPath?: string;
      requestId: string;
    }
  | { type: "settings.providers"; projectPath?: string; requestId: string }
  | {
      type: "settings.addProvider";
      preset?: string;
      custom?: CustomProviderInput;
      replace?: boolean;
      requestId: string;
    }
  | {
      type: "settings.removeProvider";
      id: string;
      projectPath?: string;
      requestId: string;
    }
  | { type: "credentials.sync"; keys: Record<string, string> }
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
  | { type: "run.resume"; runId: string; requestId: string }
  | {
      type: "challenge.decide";
      workflowId: string;
      threadId: string;
      decision: "accept" | "keep";
      requestId: string;
    }
  | {
      type: "intake.answer";
      projectId: string;
      sessionId: string;
      intakeId: string;
      questionId: string;
      value: string;
      requestId: string;
      mode?: "live" | "mock";
    }
  | {
      type: "intake.confirm";
      projectId: string;
      sessionId: string;
      intakeId: string;
      requestId: string;
      mode?: "live" | "mock";
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
