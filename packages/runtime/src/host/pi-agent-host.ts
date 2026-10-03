import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import type { Api, Model, Models } from "@earendil-works/pi-ai";
import type { ReasoningLevel, RuntimeStreamEvent } from "../types.js";

export type PiAgentHostOptions = {
  models: Models;
  model: Model<Api>;
  reasoning: ReasoningLevel;
  systemPrompt: string;
  tools?: AgentTool[];
  transformContext?: (messages: AgentMessage[]) => Promise<AgentMessage[]>;
  emit: (event: RuntimeStreamEvent) => void;
};

/** Pi唯一的适配边界：运行时向上只暴露流事件，思考流不进入持久事件日志。 */
export class PiAgentHost {
  private readonly agent: Agent;

  constructor(options: PiAgentHostOptions) {
    const streamFn = options.models.streamSimple.bind(
      options.models,
    ) as StreamFn;
    this.agent = new Agent({
      initialState: {
        model: options.model,
        thinkingLevel: options.reasoning,
        systemPrompt: options.systemPrompt,
        tools: options.tools ?? [],
      },
      streamFn,
      transformContext: options.transformContext,
      toolExecution: "sequential",
    });
    this.agent.subscribe((event) => this.forward(event, options.emit));
  }

  prompt(prompt: string): Promise<void> {
    return this.agent.prompt(prompt);
  }
  abort(): void {
    this.agent.abort();
  }
  waitForIdle(): Promise<void> {
    return this.agent.waitForIdle();
  }

  private forward(
    event: AgentEvent,
    emit: (event: RuntimeStreamEvent) => void,
  ): void {
    emit({ type: "agent_event", event });
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update?.type === "text_delta")
        emit({ type: "text_delta", delta: update.delta });
      if (update?.type === "thinking_delta")
        emit({ type: "reasoning_delta", delta: update.delta });
    }
    if (event.type === "tool_execution_start")
      emit({
        type: "tool_started",
        toolName: event.toolName,
        toolCallId: event.toolCallId,
      });
    if (event.type === "tool_execution_end")
      emit({
        type: "tool_finished",
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        ok: !event.isError,
      });
    if (
      event.type === "message_end" &&
      event.message.role === "assistant" &&
      event.message.usage
    )
      emit({ type: "usage", usage: event.message.usage });
  }
}
