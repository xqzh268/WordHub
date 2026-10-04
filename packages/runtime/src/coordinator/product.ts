import { createId, type WordHubStore } from "@wordhub/store";
import type { RunRequest, AppendRunEvent } from "../runs/run-types.js";
import type { ProjectService } from "../projects/service.js";
import type { ModelSettings } from "../models/settings.js";
import { estimateRun } from "../budget/estimate.js";
import { decideNext } from "./graph.js";
import { definitionFor, workflowRoute } from "./routing.js";
import type { WorkflowDefinition } from "./workflow.js";

export function createWorkflowService(deps: {
  workspaceRoot: string;
  projects: ProjectService;
  settings: ModelSettings;
  run: (request: RunRequest) => Promise<void>;
  append: AppendRunEvent;
}) {
  const driving = new Set<string>();
  const stopped = new Set<string>();
  const locate = async (id: string) => {
    for (const project of deps.projects.recent()) {
      const store = await deps.projects.store(project.id);
      const event = store
        .listEvents(project.id)
        .find((e) => e.type === "workflow.started" && e.runId === id);
      if (event)
        return {
          store,
          request: {
            type: "run",
            runId: id,
            projectId: project.id,
            projectPath: project.folderPath,
            sessionId: event.sessionId,
            prompt: String(event.payload.prompt),
            mode: event.payload.mode as RunRequest["mode"],
            workflow: event.payload.workflow as RunRequest["workflow"],
          } as RunRequest,
          definition: event.payload.definition as WorkflowDefinition,
        };
    }
    throw new Error("工作流不存在");
  };
  async function estimate(
    input: Pick<
      RunRequest,
      "prompt" | "agentId" | "projectPath" | "workflow" | "rawPrompt"
    >,
  ) {
    const route = workflowRoute(input);
    const definition = route
      ? await definitionFor(deps.workspaceRoot, route)
      : undefined;
    const nodes = definition?.nodes ?? [
      { id: input.agentId ?? "planner", agent: input.agentId ?? "planner" },
    ];
    const config = await deps.settings.config(input.projectPath);
    const tasks = await Promise.all(
      nodes.map(async (node) => ({
        id: node.id,
        model: (
          await deps.settings.resolve({
            agentId: node.agent,
            projectPath: input.projectPath,
          })
        ).ref,
        contextTokens: Math.max(1, Math.ceil(input.prompt.length / 2)) + 2500,
      })),
    );
    return {
      ...estimateRun(tasks, config),
      workflow: route,
      label: definition?.label ?? "Agent运行",
    };
  }
  async function drive(
    store: WordHubStore,
    request: RunRequest,
    definition: WorkflowDefinition,
  ) {
    if (driving.has(request.runId)) return;
    driving.add(request.runId);
    try {
      while (!stopped.has(request.runId)) {
        const tasks = store.listTasks(request.runId);
        const next = decideNext({
          tasks,
          running: tasks
            .filter(
              (t) => t.status === "running" || t.status === "waiting_approval",
            )
            .map((t) => t.id),
          concurrency: 2,
        });
        if (!next.ready.length) {
          if (next.terminal) {
            const success = tasks.every((t) => t.status === "succeeded");
            store.finishRun(request.runId, success ? "succeeded" : "failed");
            deps.append(
              store,
              request,
              success ? "workflow.finished" : "workflow.failed",
              { type: "system", id: "coordinator" },
              { tasks: tasks.map((t) => ({ id: t.id, status: t.status })) },
            );
          }
          return;
        }
        await Promise.all(
          next.ready.map(async (task) => {
            const node = definition.nodes.find(
              (n) => `${request.runId}:${n.id}` === task.id,
            )!;
            const runId = createId("run");
            store.updateTask(task.id, {
              status: "running",
              attempt: (task.attempt ?? 0) + 1,
              checkpoint: { runId },
            });
            const outputs = store
              .listEvents(request.projectId!, request.sessionId)
              .filter(
                (e) =>
                  tasks.some(
                    (t) =>
                      node.dependencies.includes(t.id.split(":").at(-1)!) &&
                      e.runId === t.checkpoint?.runId,
                  ) && ["file.updated", "run.finished"].includes(e.type),
              )
              .map((e) => e.payload);
            const prompt = `${request.prompt}\n任务角色：${node.kind}。只执行本节点职责。${node.kind === "edit" ? "读取写手已写入的章节，在同一文件润色；先读取最新正文及哈希。" : ""}\n上游产物：${JSON.stringify(outputs)}\n章节文件使用chapters/第N章.md（N按用户指定）；工具写入后简要报告。`;
            try {
              await deps.run({
                ...request,
                runId,
                workflow: undefined,
                workflowId: request.runId,
                nodeId: node.id,
                taskId: task.id,
                taskKind: node.kind,
                agentId: node.agent,
                prompt,
                rawPrompt: undefined,
                internal: true,
              });
            } catch {
              /* Agent运行已持久化错误与任务失败。 */
            }
          }),
        );
      }
    } finally {
      driving.delete(request.runId);
    }
  }
  async function start(request: RunRequest) {
    const route = workflowRoute(request);
    if (!route) return deps.run(request);
    const linked = await deps.projects.ensure(request);
    Object.assign(request, {
      projectId: linked.projectId,
      projectPath: linked.projectPath,
      sessionId: linked.sessionId,
      workflow: route,
    });
    const definition = await definitionFor(deps.workspaceRoot, route);
    const preview = await estimate(request);
    linked.store.startRun({
      projectId: linked.projectId,
      sessionId: linked.sessionId,
      runId: request.runId,
      prompt: request.prompt,
    });
    deps.append(
      linked.store,
      request,
      "chat.user_message",
      { type: "user", id: "user" },
      { text: request.rawPrompt ?? request.prompt },
      `prompt:${request.runId}`,
    );
    deps.append(
      linked.store,
      request,
      "workflow.started",
      { type: "system", id: "coordinator" },
      {
        workflow: route,
        definition,
        prompt: request.prompt,
        mode: request.mode ?? "live",
        estimate: preview,
        projectId: linked.projectId,
        sessionId: linked.sessionId,
        label: definition.label,
      },
    );
    for (const node of definition.nodes) {
      const id = `${request.runId}:${node.id}`;
      linked.store.createTask({
        id,
        projectId: linked.projectId,
        sessionId: linked.sessionId,
        runId: request.runId,
        kind: node.kind,
        status: "pending",
        assignedAgent: node.agent,
        dependencies: node.dependencies.map((dep) => `${request.runId}:${dep}`),
        contextSnapshotId: `snap_${id}`,
        attempt: 0,
        maxAttempts: node.maxAttempts ?? 1,
      });
      deps.append(
        linked.store,
        request,
        "task.created",
        { type: "system", id: "coordinator" },
        { taskId: id, kind: node.kind, assignedAgent: node.agent },
      );
    }
    await drive(linked.store, request, definition);
  }
  async function continueWorkflow(id: string, apiKey?: string) {
    const located = await locate(id);
    for (const task of located.store.listTasks(id))
      if (task.status === "waiting_approval")
        located.store.updateTask(task.id, { status: "succeeded" });
    stopped.delete(id);
    await drive(
      located.store,
      { ...located.request, apiKey },
      located.definition,
    );
  }
  function stop(id: string) {
    stopped.add(id);
  }
  return { start, estimate, continueWorkflow, locate, stop };
}
