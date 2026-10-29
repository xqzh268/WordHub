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
