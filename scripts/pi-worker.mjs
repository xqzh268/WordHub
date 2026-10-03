import process from 'node:process';
import readline from 'node:readline';
import { Agent } from '@earendil-works/pi-agent-core';
import { createModels } from '@earendil-works/pi-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';

const write = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const models = createModels();
models.setProvider(deepseekProvider());

async function run(input) {
  if (process.env.PI_SPIKE_MOCK === '1') {
    write({ type: 'agent_start', worker: process.pid, runtime: 'pi-worker-contract-smoke' });
    const text = 'Pi独立工作进程已运行（mock transport，仅验证worker IPC）。';
    write({ type: 'text_delta', delta: text });
    return { type: 'result', ok: true, model: input.model ?? 'deepseek-flash', elapsedMs: 1, text, events: ['agent_start', 'message_update', 'agent_end'], mock: true };
  }
  const model = models.getModel(input.provider ?? 'deepseek', input.model ?? 'deepseek-flash');
  if (!model) throw new Error(`model not found: ${input.model}`);
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is not set; refusing to claim a live DeepSeek run');
  const events = [];
  let text = '';
  const agent = new Agent({
    initialState: { systemPrompt: input.systemPrompt ?? '你是文枢P0技术验证助手。只用一句中文回答。', model, thinkingLevel: input.reasoning ?? 'low' },
    streamFn: models.streamSimple.bind(models),
    toolExecution: 'sequential'
  });
  agent.subscribe(event => {
    events.push(event.type);
    if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      text += event.assistantMessageEvent.delta;
      write({ type: 'text_delta', delta: event.assistantMessageEvent.delta });
    }
  });
  const started = Date.now();
  await agent.prompt(input.prompt ?? '请回复：Pi工作进程已运行。');
  return { type: 'result', ok: true, model: model.id, elapsedMs: Date.now() - started, text, events };
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  try { write(await run(JSON.parse(line))); }
  catch (error) { write({ type: 'error', ok: false, error: error instanceof Error ? error.message : String(error) }); }
}
