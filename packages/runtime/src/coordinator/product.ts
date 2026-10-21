import { readFile } from "node:fs/promises";
import { createId, type WordHubStore } from "@wordhub/store";
import type { RunRequest, AppendRunEvent } from "../runs/run-types.js";
import type { ProjectService } from "../projects/service.js";
import type { ModelSettings } from "../models/settings.js";
import { estimateRun } from "../budget/estimate.js";
import { decideNext } from "./graph.js";
import { definitionFor, workflowRoute } from "./routing.js";
import type { WorkflowDefinition } from "./workflow.js";
import { hasPendingEscalation } from "../runs/escalation.js";
import { isNovelIntakePrompt } from "../novel/intake.js";
import { checkEditorText, DEFAULT_EDITOR_RULES } from "../editor/checks.js";
import { listChapters, readChapter } from "../chapters/service.js";
import { parseChapterNumber } from "@wordhub/contracts";
import { loadProjectPrefs } from "../projects/prefs.js";

export function createWorkflowService(deps: {
  workspaceRoot: string;
  projects: ProjectService;
  settings: ModelSettings;
  run: (request: RunRequest) => Promise<void>;
  append: AppendRunEvent;
  intake?: { start(request: RunRequest): Promise<void> };
}) {
  const driving = new Set<string>();
  const stopped = new Set<string>();
  const challengeEvents = (store: WordHubStore, request: RunRequest) =>
    store.listEvents(request.projectId!, request.sessionId).filter((event) => {
      const payload =
        event.payload && typeof event.payload === "object"
          ? (event.payload as Record<string, unknown>)
          : {};
      return (
        payload.workflowId === request.runId || event.runId === request.runId
      );
    });
  const hasUnresolvedBlockingChallenge = (
    store: WordHubStore,
    request: RunRequest,
  ) => {
    const events = challengeEvents(store, request);
    const resolved = new Set(
      events.flatMap((event) => {
        if (
          event.type !== "challenge.resolved" &&
          event.type !== "escalation.resolved"
        )
          return [];
        const payload = event.payload as Record<string, unknown>;
        return typeof payload.threadId === "string" ? [payload.threadId] : [];
      }),
    );
    return events.some((event) => {
      if (event.type !== "challenge.raise") return false;
      const payload = event.payload as Record<string, unknown>;
      return (
        payload.severity === "blocking" &&
        typeof payload.threadId === "string" &&
        !resolved.has(payload.threadId)
      );
    });
  };
  const addTask = (
    store: WordHubStore,
    request: RunRequest,
    definition: WorkflowDefinition,
    node: WorkflowDefinition["nodes"][number],
  ) => {
    if (definition.nodes.some((candidate) => candidate.id === node.id)) return;
    definition.nodes.push(node);
    const id = `${request.runId}:${node.id}`;
    store.createTask({
      id,
      projectId: request.projectId!,
      sessionId: request.sessionId!,
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
      store,
      request,
      "task.created",
      { type: "system", id: "coordinator" },
      { taskId: id, kind: node.kind, assignedAgent: node.agent },
    );
  };
  const appendTaskSucceeded = (
    store: WordHubStore,
    request: RunRequest,
    taskId: string,
  ) =>
    deps.append(
      store,
      request,
      "task.succeeded",
      { type: "system", id: "coordinator" },
      { taskId },
    );
  const checkEditorRevision = async (
    store: WordHubStore,
    request: RunRequest,
    taskId: string,
  ) => {
    const task = store.getTask(taskId);
    const childRunId =
      task?.checkpoint && typeof task.checkpoint.runId === "string"
        ? task.checkpoint.runId
        : undefined;
    const updatedPath = childRunId
      ? store
          .listEvents(request.projectId!, request.sessionId)
          .reverse()
          .find((event) => {
            if (event.runId !== childRunId || event.type !== "file.updated")
              return false;
            const path = (event.payload as Record<string, unknown>).path;
            return typeof path === "string" && path.startsWith("chapters/");
          })
      : undefined;
    const pathFromEvent = updatedPath
      ? (updatedPath.payload as Record<string, unknown>).path
      : undefined;
    const candidates = store
      .listAllRevisions(request.projectId!)
      .filter(
        (candidate) =>
          candidate.status === "current" &&
          candidate.artifactId.startsWith("file:chapters/") &&
          (typeof pathFromEvent !== "string" ||
            candidate.artifactId === `file:${pathFromEvent}`),
      )
      .sort((left, right) => right.revisionNo - left.revisionNo);
    const revision = candidates[0];
    if (!revision) return;
    const text = await readFile(revision.snapshotPath, "utf8");
    const result = checkEditorText(text, DEFAULT_EDITOR_RULES);
    deps.append(
      store,
      request,
      "editor.check",
      { type: "system", id: "editor-check" },
      {
        workflowId: request.runId,
        taskId,
        path: revision.artifactId.slice("file:".length),
        revisionId: revision.id,
        ok: result.ok,
        metrics: result.metrics,
        violations: result.violations,
      },
      `editor-check:${taskId}:${revision.id}`,
    );
  };
  /** 从“定稿 chapters/第三章.md”或“定稿第三章”里找出要定稿的章节文件。 */
  const finalizeTarget = async (request: RunRequest) => {
    const direct = request.prompt.match(
      /chapters\/[^\s"“”'，。；;]+?\.(?:md|markdown|txt)/iu,
    )?.[0];
    const chapters = await listChapters(request.projectPath!);
    if (direct) return chapters.find((chapter) => chapter.path === direct);
    const token = request.prompt.match(
      /第\s*([零〇一二两三四五六七八九十百千\d]+)\s*[章回]/u,
    )?.[1];
    const number = token ? parseChapterNumber(token) : undefined;
    return number === undefined
      ? undefined
      : chapters.find((chapter) => chapter.number === number);
  };
  /** 观察者成功后记下“定稿”：路径与当时的内容哈希，之后可判断定稿后是否又改过。 */
  const recordFinalization = async (
    store: WordHubStore,
    request: RunRequest,
  ) => {
    const target = await finalizeTarget(request);
    if (!target) return;
    const { contentHash } = await readChapter(
      request.projectPath!,
      target.path,
    );
    deps.append(
      store,
      request,
      "chapter.finalized",
      { type: "user", id: "user" },
      {
        chapter: target.path,
        contentHash,
        workflowId: request.runId,
      },
    );
  };
  const expandChallenge = (
    store: WordHubStore,
    request: RunRequest,
    definition: WorkflowDefinition,
  ) => {
    const events = challengeEvents(store, request);
    const raised = events.some(
      (event) =>
        event.type === "challenge.raise" &&
        (event.payload as Record<string, unknown>).severity === "blocking",
    );
    const escalated = events.some(
      (event) => event.type === "escalation.created",
    );
    if (
      !raised ||
      escalated ||
      definition.nodes.some((node) => node.id === "challenge-reply-1")
    )
      return;
    const reviewer = definition.nodes.find((node) => node.kind === "review");
    if (!reviewer) return;
    addTask(store, request, definition, {
      id: "challenge-reply-1",
      agent: "writer",
      kind: "challenge.reply",
      dependencies: [reviewer.id],
      status: "pending",
      maxAttempts: 1,
    });
    addTask(store, request, definition, {
      id: "challenge-review-2",
      agent: "reviewer",
      kind: "review",
      dependencies: ["challenge-reply-1"],
      status: "pending",
      maxAttempts: 1,
    });
    addTask(store, request, definition, {
      id: "challenge-reply-2",
      agent: "writer",
      kind: "challenge.reply",
      dependencies: ["challenge-review-2"],
      status: "pending",
      maxAttempts: 1,
    });
    addTask(store, request, definition, {
      id: "challenge-final-review",
      agent: "reviewer",
      kind: "review",
      dependencies: ["challenge-reply-2"],
      status: "pending",
      maxAttempts: 1,
    });
    addTask(store, request, definition, {
      id: "rework",
      agent: "writer",
      kind: "rework",
      dependencies: ["challenge-final-review"],
      status: "pending",
      maxAttempts: 1,
    });
  };
  const ensureEscalations = (
    store: WordHubStore,
    request: RunRequest,
    nodeId: string,
  ) => {
    if (nodeId !== "challenge-final-review") return;
    const events = challengeEvents(store, request);
    const resolved = new Set(
      events.flatMap((event) => {
        if (
          event.type !== "challenge.resolved" &&
          event.type !== "escalation.resolved"
        )
          return [];
        const threadId = (event.payload as Record<string, unknown>).threadId;
        return typeof threadId === "string" ? [threadId] : [];
      }),
    );
    const escalated = new Set(
      events.flatMap((event) => {
        if (event.type !== "escalation.created") return [];
        const threadId = (event.payload as Record<string, unknown>).threadId;
        return typeof threadId === "string" ? [threadId] : [];
      }),
    );
    const blocking = new Map<string, number>();
    for (const event of events) {
      if (event.type !== "challenge.raise") continue;
      const payload = event.payload as Record<string, unknown>;
      if (
        payload.severity !== "blocking" ||
        typeof payload.threadId !== "string"
      )
        continue;
      blocking.set(
        payload.threadId,
        Math.max(
          Number(payload.round ?? 1),
          blocking.get(payload.threadId) ?? 0,
        ),
      );
    }
    for (const [threadId, round] of blocking) {
      if (resolved.has(threadId) || escalated.has(threadId)) continue;
      deps.append(
        store,
        request,
        "escalation.created",
        { type: "system", id: "coordinator" },
        {
          threadId,
          round: Math.max(2, round),
          reason: "质询经过两轮仍未解决，请用户裁决。",
        },
      );
    }
  };
  const locate = async (id: string) => {
    for (const project of deps.projects.recent()) {
      const store = await deps.projects.store(project.id);
      const event = store
        .listEvents(project.id)
        .find((e) => e.type === "workflow.started" && e.runId === id);
      if (event) {
        const definition = event.payload.definition as WorkflowDefinition;
        const known = new Set(definition.nodes.map((node) => node.id));
        for (const task of store.listTasks(id)) {
          const nodeId = task.id.startsWith(`${id}:`)
            ? task.id.slice(id.length + 1)
            : task.id;
          if (known.has(nodeId)) continue;
          definition.nodes.push({
            id: nodeId,
            agent: task.assignedAgent ?? "writer",
            kind: task.kind,
            dependencies: task.dependencies.map((dependency) =>
              dependency.startsWith(`${id}:`)
                ? dependency.slice(id.length + 1)
                : dependency,
            ),
            status: "pending",
            maxAttempts: task.maxAttempts ?? 1,
          });
          known.add(nodeId);
        }
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
          definition,
        };
      }
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
        const unresolved = hasUnresolvedBlockingChallenge(store, request);
        const ready = next.ready.filter((task) => {
          const node = definition.nodes.find(
            (candidate) => `${request.runId}:${candidate.id}` === task.id,
          );
          return !(unresolved && node?.kind === "rework");
        });
        for (const blockedId of next.blocked) {
          const blocked = tasks.find((task) => task.id === blockedId);
          if (!blocked || blocked.status === "blocked") continue;
          store.updateTask(blockedId, { status: "blocked" });
          deps.append(
            store,
            request,
            "task.blocked",
            { type: "system", id: "coordinator" },
            { taskId: blockedId, reason: "上游任务未成功完成" },
          );
        }
        const workflowEvents = store.listEvents(
          request.projectId!,
          request.sessionId,
        );
        const pendingEscalation = hasPendingEscalation(
          workflowEvents,
          new Set([request.runId]),
        );
        const hasRunningTask = tasks.some(
          (task) =>
            task.status === "running" || task.status === "waiting_approval",
        );
        const finish = (current: typeof tasks) => {
          const success = current.every((task) => task.status === "succeeded");
          store.finishRun(request.runId, success ? "succeeded" : "failed");
          deps.append(
            store,
            request,
            success ? "workflow.finished" : "workflow.failed",
            { type: "system", id: "coordinator" },
            {
              tasks: current.map((task) => ({
                id: task.id,
                status: task.status,
              })),
            },
          );
        };
        if (!ready.length) {
          if (next.blocked.length) continue;
          if (next.terminal) {
            finish(tasks);
          } else if (!hasRunningTask && !pendingEscalation) {
            // 兜底收口：没有任何执行中的任务，也没有待决裁决时，不能让父运行永久 running。
            // 若仍有悬空节点，将其标记为 blocked，并以失败终态结束，保持任务与运行状态一致。
            for (const task of tasks) {
              if (task.status !== "pending" && task.status !== "ready")
                continue;
              store.updateTask(task.id, { status: "blocked" });
              deps.append(
                store,
                request,
                "task.blocked",
                { type: "system", id: "coordinator" },
                { taskId: task.id, reason: "没有可执行任务且没有待决裁决" },
              );
            }
            finish(store.listTasks(request.runId));
          }
          return;
        }
        await Promise.all(
          ready.map(async (task) => {
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
            const threads = challengeEvents(store, request)
              .filter(
                (event) =>
                  event.type.startsWith("challenge.") ||
                  event.type.startsWith("escalation."),
              )
              .map((event) => ({
                type: event.type,
                agent: event.actor.id,
                ...event.payload,
              }));
            const finalizeChapterPath =
              node.kind === "observe"
                ? (await finalizeTarget(request))?.path
                : undefined;
            const prompt = `${request.prompt}\n任务节点：${node.id}。任务角色：${node.kind}。只执行本节点职责。${node.kind === "edit" ? "读取写手已写入的章节，在同一文件润色；先读取最新正文及哈希。" : ""}${node.kind === "challenge.reply" ? "下方已提供完整质询线程，不要搜索线程ID。必须用其中的threadId调用challenge.reply回应；接受时先用doc.write把修订落盘，反驳时说明证据。成功回应后立即总结。" : ""}${node.id.startsWith("challenge-") && node.kind === "review" ? "复核下方质询与写手回复。已解决则调用challenge.reply，使用原threadId和disposition=accept；仍有矛盾则用原threadId再次调用challenge.raise。不得创建新线程代替复核。" : ""}${node.kind === "observe" ? `定稿章节：${finalizeChapterPath ?? "见任务描述中的章号"}。按观察者职责：用fact.propose提出带逐字原文锚点的待确认事实，最后用chapter.summarize写本章摘要，然后停止。` : ""}${node.kind === "rework" ? "依据已裁决的质询修改章节，先读取最新正文和设定，再用doc.write写回同一路径。" : ""}\n质询与裁决上下文：${JSON.stringify(threads)}\n上游产物：${JSON.stringify(outputs)}\n章节路径以doc.read读取chapters目录清单为准，沿用实际文件名；成功写入一次后简要报告并停止调用工具。`;
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
            if (
              node.kind === "edit" &&
              store.getTask(task.id)?.status === "succeeded"
            )
              await checkEditorRevision(store, request, task.id);
            if (
              node.kind === "observe" &&
              store.getTask(task.id)?.status === "succeeded"
            )
              await recordFinalization(store, request);
            ensureEscalations(store, request, node.id);
            expandChallenge(store, request, definition);
            const allEvents = challengeEvents(store, request);
            const resolved = allEvents.some(
              (event) =>
                event.type === "challenge.resolved" &&
                (event.payload as Record<string, unknown>).threadId,
            );
            if (resolved)
              for (const pending of store.listTasks(request.runId)) {
                if (
                  pending.status === "pending" &&
                  pending.id.includes(":challenge-")
                ) {
                  store.updateTask(pending.id, { status: "succeeded" });
                  appendTaskSucceeded(store, request, pending.id);
                }
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
    if (!route) {
      if (
        deps.intake &&
        request.agentId === "planner" &&
        isNovelIntakePrompt(request.prompt)
      )
        return deps.intake.start(request);
      return deps.run(request);
    }
    const linked = await deps.projects.ensure(request);
    Object.assign(request, {
      projectId: linked.projectId,
      projectPath: linked.projectPath,
      sessionId: linked.sessionId,
      workflow: route,
    });
    const definition = await definitionFor(deps.workspaceRoot, route);
    if (
      route === "finalize-chapter" &&
      (await loadProjectPrefs(linked.projectPath)).autoReviewOnFinalize
    )
      definition.nodes.push({
        id: "reviewer",
        kind: "review",
        agent: "reviewer",
        dependencies: ["observer"],
        status: "pending",
        maxAttempts: 1,
      });
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
    const resolution = located.store
      .listEvents(located.request.projectId!, located.request.sessionId)
      .reverse()
      .find((event) => event.type === "escalation.resolved");
    const decision =
      resolution?.payload && typeof resolution.payload === "object"
        ? (resolution.payload as Record<string, unknown>).decision
        : undefined;
    for (const task of located.store.listTasks(id))
      if (task.status === "waiting_approval") {
        located.store.updateTask(task.id, { status: "succeeded" });
        appendTaskSucceeded(
          located.store,
          { ...located.request, apiKey },
          task.id,
        );
      }
    if (decision === "keep")
      for (const task of located.store.listTasks(id))
        if (task.status === "pending" && task.kind === "rework") {
          located.store.updateTask(task.id, { status: "succeeded" });
          appendTaskSucceeded(
            located.store,
            { ...located.request, apiKey },
            task.id,
          );
        }
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
