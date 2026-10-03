import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { Type } from "typebox";

type WorkerRequest =
  | { type: "run"; runId: string; prompt: string; model?: string; reasoning?: string; mode?: "live" | "mock"; toolRoundTrip?: boolean; projectPath?: string }
  | { type: "abort"; runId: string };

type ParentPort = { on(event: "message", listener: (event: { data: WorkerRequest }) => void): void; postMessage(message: unknown): void };
const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;

if (!parentPort) throw new Error("WordHub Pi worker requires Electron utilityProcess.parentPort");
console.error(`[wordhub-worker] ready to receive pid=${process.pid}`);

const models = createModels();
models.setProvider(deepseekProvider());
const active = new Map<string, Agent>();
const activeMocks = new Map<string, AbortController>();

const post = (message: Record<string, unknown>) => parentPort.postMessage(message);

const echoTool = {
  name: "wordhub_echo",
  label: "文枢回声工具",
  description: "回传一个短句，用于验证思考模式下的多轮工具调用。",
  parameters: Type.Object({ text: Type.String({ minLength: 1, maxLength: 200 }) }),
  execute: async (_toolCallId: string, params: unknown) => {
    const text = (params as { text: string }).text;
    return { content: [{ type: "text" as const, text: `工具已执行：${text}` }], details: { roundTrip: true } };
  }
};

async function runLive(request: Extract<WorkerRequest, { type: "run" }>): Promise<void> {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is not set");
  const model = models.getModel("deepseek", request.model ?? "deepseek-flash");
  if (!model) throw new Error(`model not found: ${request.model}`);
  const events: string[] = [];
  let text = "";
  const agent = new Agent({
    initialState: {
      model,
      thinkingLevel: (request.reasoning ?? "high") as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
      systemPrompt: request.toolRoundTrip
        ? "你是文枢工具调用验证助手。必须先调用wordhub_echo两次，每次传入不同中文短句；收到两次工具结果后，只用一句中文总结。"
        : "你是文枢P1后台写作助手。只用一句中文回答。",
      tools: request.toolRoundTrip ? [echoTool] : []
    },
    streamFn: models.streamSimple.bind(models),
    toolExecution: "sequential"
  });
  active.set(request.runId, agent);
  agent.subscribe((event) => {
    events.push(event.type);
    if (event.type === "tool_execution_start" || event.type === "tool_execution_end") post({ type: `run.${event.type}`, runId: request.runId, tool: event.toolName });
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      text += event.assistantMessageEvent.delta;
      post({ type: "run.text", runId: request.runId, delta: event.assistantMessageEvent.delta });
    }
  });
  await agent.prompt(request.prompt);
  active.delete(request.runId);
  post({ type: "run.finished", runId: request.runId, ok: true, model: model.id, text, events, projectPath: request.projectPath });
}

async function runMock(request: Extract<WorkerRequest, { type: "run" }>): Promise<void> {
  post({ type: "run.started", runId: request.runId, mode: "mock", projectPath: request.projectPath });
  const controller = new AbortController();
  activeMocks.set(request.runId, controller);
  const timer = setInterval(() => {
    if (controller.signal.aborted) return;
    post({ type: "run.text", runId: request.runId, delta: "文枢后台进程正在流式写作。" });
  }, 15);
  const abortListener = () => clearInterval(timer);
  controller.signal.addEventListener("abort", abortListener, { once: true });
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  clearInterval(timer);
  controller.signal.removeEventListener("abort", abortListener);
  activeMocks.delete(request.runId);
  if (controller.signal.aborted) post({ type: "run.aborted", runId: request.runId, ok: true });
  else post({ type: "run.finished", runId: request.runId, ok: true, mode: "mock" });
}

parentPort.on("message", ({ data }) => {
  if (data.type === "abort") {
    active.get(data.runId)?.abort();
    activeMocks.get(data.runId)?.abort();
    activeMocks.delete(data.runId);
    post({ type: "run.aborted", runId: data.runId, ok: true });
    return;
  }
  if (data.type !== "run") return;
  post({ type: "run.started", runId: data.runId, mode: data.mode ?? "live", projectPath: data.projectPath });
  void (data.mode === "mock" ? runMock(data) : runLive(data)).catch((error: unknown) => {
    active.delete(data.runId);
    post({ type: "error", runId: data.runId, ok: false, error: error instanceof Error ? error.message : String(error) });
  });
});

post({ type: "ready", pid: process.pid, cwd: process.cwd() });
