const asTime = (event) =>
  Date.parse(event.occurred_at ?? event.occurredAt ?? "");

/** 从一段工作流事件中汇总每个Agent节点的耗时、工具轮数和上下文大小。 */
export function summarizeRunEvents(events) {
  const runIds = [
    ...new Set(
      events
        .map((event) => event.run_id ?? event.runId)
        .filter((runId) => typeof runId === "string"),
    ),
  ];
  return runIds.map((runId) => {
    const slice = events.filter(
      (event) => (event.run_id ?? event.runId) === runId,
    );
    const started = slice.find((event) => event.type === "run.started");
    const finished = slice.find((event) =>
      ["run.finished", "run.error", "run.aborted"].includes(event.type),
    );
    const usages = slice.filter((event) => event.type === "run.usage");
    const context = slice.find((event) => event.type === "context.injected");
    const toolCalls = slice.filter(
      (event) => event.type === "run.tool_started",
    );
    const start = started ? asTime(started) : NaN;
    const end = finished ? asTime(finished) : NaN;
    const payload = started?.payload ?? {};
    return {
      runId,
      nodeId: typeof payload.nodeId === "string" ? payload.nodeId : undefined,
      agentId:
        typeof payload.agentId === "string" ? payload.agentId : undefined,
      seconds:
        Number.isFinite(start) && Number.isFinite(end)
          ? Number(((end - start) / 1000).toFixed(1))
          : undefined,
      status: finished?.type,
      toolCalls: toolCalls.length,
      tools: toolCalls.map((event) => event.payload?.tool),
      contextTokens: context?.payload?.estimatedTokens,
      contextLayers: Array.isArray(context?.payload?.manifest)
        ? context.payload.manifest.map((layer) => ({
            id: layer.id,
            estimatedTokens: layer.estimatedTokens,
          }))
        : [],
      inputTokens: usages.reduce(
        (sum, event) => sum + Number(event.payload?.inputTokens ?? 0),
        0,
      ),
      outputTokens: usages.reduce(
        (sum, event) => sum + Number(event.payload?.outputTokens ?? 0),
        0,
      ),
      usageEvents: usages.length,
    };
  });
}

/** 单条质询须指向预埋的人物矛盾；不同质询的出处不能合并成一条证据。 */
export function assessPlantedContradiction(events, previousPath, currentPath) {
  const challenges = events
    .filter((event) => event.type === "challenge.raise")
    .map(({ payload }) => ({
      claim: String(payload.claim ?? ""),
      category: payload.category,
      citations: payload.citations ?? [],
    }));
  const relevant = challenges.filter(({ claim, citations }) => {
    const evidence = [claim, ...citations.map((item) => item.quote)].join(" ");
    return (
      /老周/u.test(evidence) &&
      /死|亡|毙|殒|命绝|断气|遇害|尸|血已经凉了|再没有起来/u.test(evidence)
    );
  });
  const pathOf = (source) => source.replaceAll("\\", "/").split("#")[0];
  return {
    challenges,
    detected: relevant.length > 0,
    citesBoth: relevant.some(({ citations }) => {
      const paths = citations.map(({ source }) => pathOf(source));
      return paths.includes(previousPath) && paths.includes(currentPath);
    }),
  };
}

/** 纲领草稿独立生成，usage 记录在草稿事件，其他模型调用使用 run.usage。 */
export function reportedModelUsage(events) {
  let tokens = 0;
  let costUsd = 0;
  for (const { type, payload } of events) {
    if (type === "run.usage") {
      tokens += payload.usage?.totalTokens ?? 0;
      costUsd +=
        payload.usage?.cost?.total ?? payload.costUsd ?? payload.cost ?? 0;
    } else if (type === "intake.draft.ready" && payload.source === "model") {
      tokens += payload.usage?.total ?? 0;
      costUsd += payload.usage?.cost ?? 0;
    }
  }
  return { tokens, costUsd: Number(costUsd.toFixed(4)) };
}
