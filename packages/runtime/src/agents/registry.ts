import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  AgentDefinition,
  AgentFrontmatter,
  AgentSource,
} from "../types.js";

export class AgentConfigError extends Error {
  constructor(
    message: string,
    readonly sourcePath: string,
  ) {
    super(`${sourcePath}: ${message}`);
    this.name = "AgentConfigError";
  }
}

function validateFrontmatter(
  value: unknown,
  sourcePath: string,
): AgentFrontmatter {
  if (!value || typeof value !== "object")
    throw new AgentConfigError("frontmatter必须是对象", sourcePath);
  const data = value as Record<string, unknown>;
  const required = [
    "name",
    "displayName",
    "description",
    "model",
    "tools",
    "write",
    "memoryScopes",
    "maxTurns",
  ];
  for (const key of required)
    if (!(key in data))
      throw new AgentConfigError(`缺少字段${key}`, sourcePath);
  if (
    typeof data.name !== "string" ||
    !/^[a-z][a-z0-9-]{1,63}$/u.test(data.name)
  )
    throw new AgentConfigError("name格式无效", sourcePath);
  if (typeof data.displayName !== "string" || !data.displayName.trim())
    throw new AgentConfigError("displayName不能为空", sourcePath);
  if (typeof data.description !== "string" || !data.description.trim())
    throw new AgentConfigError("description不能为空", sourcePath);
  if (!data.model || typeof data.model !== "object")
    throw new AgentConfigError("model必须是模型引用", sourcePath);
  const model = data.model as Record<string, unknown>;
  if (
    typeof model.provider !== "string" ||
    typeof model.id !== "string" ||
    typeof model.reasoning !== "string"
  )
    throw new AgentConfigError("model缺少provider/id/reasoning", sourcePath);
  if (
    !Array.isArray(data.tools) ||
    data.tools.some((tool) => typeof tool !== "string")
  )
    throw new AgentConfigError("tools必须是字符串数组", sourcePath);
  if (
    data.write !== "none" &&
    data.write !== "propose" &&
    data.write !== "write"
  )
    throw new AgentConfigError("write必须是none、propose或write", sourcePath);
  const scopes = data.memoryScopes as Record<string, unknown>;
  if (!scopes || !Array.isArray(scopes.read) || !Array.isArray(scopes.write))
    throw new AgentConfigError(
      "memoryScopes必须包含read和write数组",
      sourcePath,
    );
  if (
    !Number.isInteger(data.maxTurns) ||
    Number(data.maxTurns) < 1 ||
    Number(data.maxTurns) > 100
  )
    throw new AgentConfigError("maxTurns必须在1到100之间", sourcePath);
  return data as unknown as AgentFrontmatter;
}

export function parseAgentMarkdown(
  markdown: string,
  sourcePath: string,
  source: AgentSource,
): AgentDefinition {
  if (!markdown.startsWith("---"))
    throw new AgentConfigError("缺少YAML frontmatter", sourcePath);
  const end = markdown.indexOf("\n---", 3);
  if (end < 0)
    throw new AgentConfigError("frontmatter没有结束标记", sourcePath);
  const frontmatter = validateFrontmatter(
    parseYaml(markdown.slice(3, end)),
    sourcePath,
  );
  const systemPrompt = markdown
    .slice(end + 4)
    .replace(/^\r?\n/u, "")
    .trim();
  const version = createHash("sha256")
    .update(markdown, "utf8")
    .digest("hex")
    .slice(0, 16);
  return {
    ...frontmatter,
    source,
    sourcePath,
    systemPrompt,
    version,
    confirmBeforeWrite: frontmatter.confirmBeforeWrite ?? source === "project",
  };
}

async function findAgentFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name === "AGENT.md") results.push(full);
    }
  };
  await walk(root);
  return results;
}

export class AgentRegistry {
  private readonly definitions = new Map<string, AgentDefinition>();
  private readonly errors = new Map<string, string>();

  constructor(private readonly builtinRoot?: string) {}

  async load(
    projectRoot?: string,
  ): Promise<ReadonlyMap<string, AgentDefinition>> {
    this.definitions.clear();
    this.errors.clear();
    const sources: Array<{ root?: string; source: AgentSource }> = [
      { root: this.builtinRoot, source: "builtin" },
      {
        root: projectRoot
          ? path.join(projectRoot, ".wordhub", "agents")
          : undefined,
        source: "project",
      },
    ];
    for (const { root, source } of sources) {
      if (!root) continue;
      for (const file of await findAgentFiles(root)) {
        try {
          const definition = parseAgentMarkdown(
            await readFile(file, "utf8"),
            file,
            source,
          );
          this.definitions.set(definition.name, definition);
        } catch (error) {
          this.errors.set(
            file,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }
    return this.definitions;
  }

  get(name: string): AgentDefinition | undefined {
    return this.definitions.get(name);
  }
  list(): AgentDefinition[] {
    return [...this.definitions.values()];
  }
  getErrors(): ReadonlyMap<string, string> {
    return this.errors;
  }
}
