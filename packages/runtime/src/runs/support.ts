import { createId, timestamp, WordHubStore } from "@wordhub/store";
import type { Actor, Event } from "@wordhub/contracts";
import type { RuntimeRequest } from "./executor-types.js";
import type { ModelSettings } from "../models/settings.js";
import { projectContext } from "../context/project.js";
import { projectTools } from "../tools/project.js";
import type { AgentDefinition } from "../types.js";

type SupportDeps = {
  post: (message: Record<string, unknown>) => void;
  modelSettings: ModelSettings;
  runContexts: Map<string, { taskId?: string }>;
};

export function createRunSupport(deps: SupportDeps) {
  const { post, modelSettings, runContexts } = deps;
  async function resolveAgent(
    request: Extract<RuntimeRequest, { type: "run" }>,
  ) {
    const resolved = await modelSettings.resolve(request);
    return {
      definition: resolved.definition,
      modelRef: resolved.ref,
      fallbackRef: resolved.definition.fallback,
    };
  }
  async function buildRunContext(
    request: Extract<RuntimeRequest, { type: "run" }>,
    store: WordHubStore,
    definition: AgentDefinition,
  ) {
    const context = await projectContext({
      store,
      projectId: request.projectId!,
      sessionId: request.sessionId!,
      projectPath: request.projectPath!,
      runId: request.runId,
      prompt: request.prompt,
      agent: definition,
    });
    appendRunEvent(
      store,
      request,
      "context.injected",
      { type: "system", id: "context" },
      {
        manifest: context.manifest.map(
          ({ id, kind, sourcePath, estimatedTokens }) => ({
            id,
            kind,
            sourcePath,
            estimatedTokens,
          }),
        ),
        estimatedTokens: context.estimatedTokens,
      },
    );
    return context;
  }
  function createAgentTools(
    request: Extract<RuntimeRequest, { type: "run" }>,
    store: WordHubStore,
    definition: AgentDefinition,
  ) {
    return projectTools({
      store,
      projectId: request.projectId!,
      sessionId: request.sessionId!,
      runId: request.runId,
      projectPath: request.projectPath!,
      agent: definition,
      approved: new Map(),
      event: (type, payload) =>
        appendRunEvent(
          store,
          request,
          type,
          { type: "agent", id: definition.name },
          payload,
        ).id,
    }).tools;
  }
  function appendRunEvent(
    store: WordHubStore,
    request: Extract<RuntimeRequest, { type: "run" }>,
    type: string,
    actor: Actor,
    payload: Record<string, unknown>,
    idempotencyKey?: string,
  ): Event {
    const event = store.appendEvent({
      schemaVersion: 1,
      id: createId("evt"),
      projectId: request.projectId!,
      sessionId: request.sessionId!,
      runId: request.runId,
      type,
      taskId: runContexts.get(request.runId)?.taskId,
      actor,
      occurredAt: timestamp(),
      idempotencyKey,
      visibility: "room",
      payload,
    });
    const compatibility: Record<string, string> = {
      "run.text_delta": "run.text",
      "run.tool_started": "run.tool_execution_start",
      "run.tool_finished": "run.tool_execution_end",
      "run.error": "error",
    };
    post({
      type: compatibility[type] ?? type,
      runId: request.runId,
      ...payload,
    });
    return event;
  }

  return { resolveAgent, buildRunContext, createAgentTools, appendRunEvent };
}
