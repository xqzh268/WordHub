import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentOptions,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import type { Api, Model, Models } from "@earendil-works/pi-ai";
import type { ReasoningLevel, RuntimeStreamEvent } from "../types.js";
import { resumeTools } from "./resume-tools.js";

export type PiAgentHostOptions = {
  models: Models;
  model: Model<Api>;
  reasoning: ReasoningLevel;
  systemPrompt: string;
  tools?: AgentTool[];
  getApiKey?: AgentOptions["getApiKey"];
  beforeToolCall?: AgentOptions["beforeToolCall"];
  maxTurns?: number;
  onCheckpoint?: (messages: AgentMessage[]) => void | Promise<void>;
  transformContext?: AgentOptions["transformContext"];
  emit: (event: RuntimeStreamEvent) => void | Promise<void>;
};

export class PiRunError extends Error {
  constructor(
    message: string,
    readonly aborted = false,
  ) {
    super(message);
    this.name = "PiRunError";
  }
}

/** provider使用安全别名；权限和产品事件只使用AGENT.md里的逻辑名。 */
export class PiAgentHost {
  private readonly agent: Agent;
  private readonly logicalNames = new Map<string, string>();
  private aborted = false;
  private readonly replayController = new AbortController();

  constructor(private readonly options: PiAgentHostOptions) {
    const tools = (options.tools ?? []).map((tool) => {
      const alias = tool.name.replaceAll(".", "_");
      if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(alias))
        throw new Error(`工具别名无效：${tool.name}`);
      if (this.logicalNames.has(alias))
        throw new Error(
          `工具别名冲突：${tool.name} / ${this.logicalNames.get(alias)}`,
        );
      this.logicalNames.set(alias, tool.name);
      return { ...tool, name: alias };
    });
    let turns = 0;
    this.agent = new Agent({
      initialState: {
        model: options.model,
        thinkingLevel: options.reasoning,
        systemPrompt: options.systemPrompt,
        tools,
      },
      streamFn: options.models.streamSimple.bind(options.models),
      getApiKey: options.getApiKey,
      transformContext: options.transformContext,
      toolExecution: "sequential",
      beforeToolCall: async (context, signal) =>
        options.beforeToolCall?.(
          {
            ...context,
            toolCall: {
              ...context.toolCall,
              name: this.logical(context.toolCall.name),
            },
          },
          signal,
        ),
      finishTurn: async (turn) => {
        await options.onCheckpoint?.(this.agent.state.messages);
        if (
          ++turns >= (options.maxTurns ?? 20) &&
          turn.message.content.some((block) => block.type === "toolCall")
        )
          throw new PiRunError("已达到Agent的最大工具轮数，请缩小任务后重试");
      },
    });
    this.agent.subscribe((event) => this.forward(event, options.emit));
  }

  async prompt(prompt: string | AgentMessage[]): Promise<void> {
    if (typeof prompt === "string") await this.agent.prompt(prompt);
    else await this.agent.prompt(prompt);
    this.checkTerminal();
  }
  async continue(): Promise<void> {
    await this.agent.continue();
    this.checkTerminal();
  }
  async resume(messages: AgentMessage[]): Promise<void> {
    await resumeTools(
      this.agent,
      messages,
      this.options,
      this.replayController.signal,
      (name) => this.logical(name),
    );
    this.replayController.signal.throwIfAborted();
    await this.continue();
  }
  abort(): void {
    this.aborted = true;
    this.replayController.abort();
    this.agent.abort();
  }
  waitForIdle(): Promise<void> {
    return this.agent.waitForIdle();
  }

  /** 用于跨重启恢复的普通JSON消息快照，不写入事件日志。 */
  messages(): AgentMessage[] {
    return this.agent.state.messages.map((message) => ({
      ...message,
    })) as AgentMessage[];
  }

  private checkTerminal(): void {
    const last = [...this.agent.state.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (this.aborted || last?.stopReason === "aborted")
      throw new PiRunError("运行已取消", true);
    if (last?.stopReason === "error" || this.agent.state.errorMessage)
      throw new PiRunError(
        last?.errorMessage || this.agent.state.errorMessage || "模型请求失败",
      );
    if (!last || (!last.content.length && !last.usage.totalTokens))
      throw new PiRunError("模型返回空响应且用量为零");
  }

  private logical(name: string): string {
    return this.logicalNames.get(name) ?? name;
  }
  private async forward(
    event: AgentEvent,
    emit: PiAgentHostOptions["emit"],
  ): Promise<void> {
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta")
        await emit({ type: "text_delta", delta: update.delta });
      if (update.type === "thinking_delta")
        await emit({ type: "reasoning_delta", delta: update.delta });
    }
    if (event.type === "tool_execution_start")
      await emit({
        type: "tool_started",
        toolName: this.logical(event.toolName),
        toolCallId: event.toolCallId,
        args: event.args,
      });
    if (event.type === "tool_execution_end")
      await emit({
        type: "tool_finished",
        toolName: this.logical(event.toolName),
        toolCallId: event.toolCallId,
        ok: !event.isError,
      });
    if (event.type === "message_end" && event.message.role === "assistant")
      await emit({ type: "usage", usage: event.message.usage });
  }
}
