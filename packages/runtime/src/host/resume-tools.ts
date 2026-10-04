import {
  runToolCall,
  type Agent,
  type AgentMessage,
} from "@earendil-works/pi-agent-core";
import type { PiAgentHostOptions } from "./pi-agent-host.js";

/** 重放尚未得到结果的原工具调用，经同一套参数校验、权限与审批钩子。 */
export async function resumeTools(
  agent: Agent,
  messages: AgentMessage[],
  options: PiAgentHostOptions,
  signal: AbortSignal,
  logical: (name: string) => string,
): Promise<void> {
  agent.state.messages = messages;
  const assistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  if (!assistant) throw new Error("运行快照缺少模型的工具调用消息");
  const completed = new Set(
    messages
      .filter((message) => message.role === "toolResult")
      .map((message) => message.toolCallId),
  );
  for (const call of assistant.content) {
    if (call.type !== "toolCall" || completed.has(call.id)) continue;
    signal.throwIfAborted();
    await options.emit({
      type: "tool_started",
      toolName: logical(call.name),
      toolCallId: call.id,
      args: call.arguments,
    });
    const outcome = await runToolCall(call, {
      tools: agent.state.tools,
      assistantMessage: assistant,
      context: { messages: agent.state.messages, tools: agent.state.tools },
      beforeToolCall: options.beforeToolCall
        ? (context, innerSignal) =>
            options.beforeToolCall!(
              {
                ...context,
                toolCall: {
                  ...context.toolCall,
                  name: logical(context.toolCall.name),
                },
              },
              innerSignal,
            )
        : undefined,
      afterToolCall: agent.afterToolCall,
      signal,
    });
    signal.throwIfAborted();
    await options.emit({
      type: "tool_finished",
      toolName: logical(call.name),
      toolCallId: call.id,
      ok: !outcome.isError,
    });
    agent.state.messages = [
      ...agent.state.messages,
      {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: outcome.result.content,
        details: outcome.result.details,
        isError: outcome.isError,
        timestamp: Date.now(),
      },
    ];
    await options.onCheckpoint?.(agent.state.messages);
  }
}
