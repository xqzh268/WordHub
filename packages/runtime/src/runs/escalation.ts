export type EscalationEvent = {
  type: string;
  runId: string;
  payload?: unknown;
};

function threadId(event: EscalationEvent): string | undefined {
  const payload = event.payload;
  if (!payload || typeof payload !== "object") return undefined;
  const value = (payload as Record<string, unknown>).threadId;
  return typeof value === "string" ? value : undefined;
}

/**
 * 只有创建过升级、且没有对应裁决事件的线程才会阻塞 Agent 收尾。
 * 事件按集合判断而非按顺序判断，因此裁决先落库也能正确解除待决状态。
 */
export function hasPendingEscalation(
  events: readonly EscalationEvent[],
  runIds?: ReadonlySet<string>,
): boolean {
  const relevant = runIds
    ? events.filter((event) => {
        if (runIds.has(event.runId)) return true;
        const payload =
          event.payload && typeof event.payload === "object"
            ? (event.payload as Record<string, unknown>)
            : undefined;
        return (
          typeof payload?.workflowId === "string" &&
          runIds.has(payload.workflowId)
        );
      })
    : events;
  const created = new Set<string>();
  const resolved = new Set<string>();
  for (const event of relevant) {
    const id = threadId(event);
    if (!id) continue;
    if (event.type === "escalation.created") created.add(id);
    if (
      event.type === "escalation.resolved" ||
      event.type === "challenge.resolved"
    )
      resolved.add(id);
  }
  return [...created].some((id) => !resolved.has(id));
}
