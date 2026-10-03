import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import YAML from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaDir = path.join(root, 'packages', 'contracts', 'src', 'schema');
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const schemaFiles = ['common.schema.json', 'event.schema.json', 'task.schema.json', 'revision.schema.json', 'fact.schema.json', 'graph.schema.json', 'model-config.schema.json', 'agent-config.schema.json'];
const schemas = new Map();
for (const name of schemaFiles) { const schema = JSON.parse(await fs.readFile(path.join(schemaDir, name), 'utf8')); ajv.addSchema(schema); schemas.set(name, schema); }

const cases = [
  ['event.json', 'event.schema.json'], ['fact.json', 'fact.schema.json'], ['graph.json', 'graph.schema.json'],
  ['models.json', 'model-config.schema.json'],
];
const errors = [];
for (const [file, schema] of cases) {
  const validate = ajv.getSchema(schemas.get(schema).$id);
  const ok = validate(JSON.parse(await fs.readFile(path.join(root, 'examples', file), 'utf8')));
  if (!ok) errors.push(`${file}: ${validate.errors?.map(e => `${e.instancePath} ${e.message}`).join('; ')}`);
  else console.log(`PASS ${file} -> ${schema}`);
}
const agentText = await fs.readFile(path.join(root, 'examples', 'agent-methods-reviewer.AGENT.md'), 'utf8');
const match = agentText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!match) errors.push('agent-methods-reviewer.AGENT.md: missing frontmatter');
else {
  const data = YAML.parse(match[1]);
  const validate = ajv.getSchema(schemas.get('agent-config.schema.json').$id);
  if (!validate(data)) errors.push(`agent-methods-reviewer.AGENT.md: ${validate.errors?.map(e => `${e.instancePath} ${e.message}`).join('; ')}`);
  else console.log('PASS agent-methods-reviewer.AGENT.md -> agent-config.schema.json');
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
