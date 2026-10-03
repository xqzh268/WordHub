import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = path.join(root, 'scripts', 'pi-worker.mjs');
const real = Boolean(process.env.DEEPSEEK_API_KEY);
const mock = process.env.PI_SPIKE_MOCK === '1';
const result = { spike: 'pi-deepseek-worker', node: process.version, worker: 'child_process', model: 'deepseek-flash', mode: real ? 'live' : mock ? 'worker-only-mock' : 'not-run', events: [], ok: false };

if (!real && !mock) {
  result.reason = '本机未发现DEEPSEEK_API_KEY；已保留真实调用路径，未伪造DeepSeek验收。设置环境变量后重跑 npm run spike:pi。';
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(root, 'artifacts', 'pi-worker-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const child = spawn(process.execPath, [workerPath], { cwd: root, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
const lines = [];
child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
child.stdout.on('data', chunk => { for (const line of chunk.split(/\r?\n/).filter(Boolean)) { const item = JSON.parse(line); lines.push(item); if (item.type === 'text_delta') process.stdout.write(item.delta); } });
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.stdin.end(JSON.stringify({ prompt: '请回复：Pi独立工作进程已运行。', model: 'deepseek-flash', reasoning: 'low' }) + '\n');
const code = await new Promise(resolve => child.on('close', resolve));
const final = lines.find(item => item.type === 'result' || item.type === 'error');
result.ok = code === 0 && final?.ok === true;
result.exitCode = code; result.events = final?.events ?? lines.map(item => item.type); result.text = final?.text; result.error = final?.error;
await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
await fs.writeFile(path.join(root, 'artifacts', mock ? 'pi-worker-smoke-result.json' : 'pi-worker-result.json'), JSON.stringify(result, null, 2));
console.log(`\n${JSON.stringify(result, null, 2)}`);
if (!result.ok) process.exitCode = 1;
