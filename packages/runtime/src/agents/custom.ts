import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { ModelResolver } from "../models/resolver.js";
import type {
  AgentDefinition,
  AgentFrontmatter,
  ModelConfig,
  ModelRef,
  WriteLevel,
} from "../types.js";
import { AgentRegistry, parseAgentMarkdown } from "./registry.js";

/** 表单里可勾选的工具：只含单独对话时有意义的；质询、事实、摘要类工具属于工作流内部。 */
export const FORM_TOOLS = [
  "doc.read",
  "bible.read",
  "history.search",
  "history.get",
  "doc.write",
  "doc.propose",
  "bible.propose",
  "question.ask",
  "reference.list",
  "reference.search",
  "reference.read",
] as const;
const WRITE_TOOLS = new Set(["doc.write", "doc.propose", "bible.propose"]);

/** 可写范围只提供这两个，不允许自定义路径（例如 .wordhub/agents 或项目外）。 */
export const WRITE_SCOPE_CHOICES = [
  "chapters/**",
  ".wordhub/bible/**",
] as const;
export const READ_SCOPE_CHOICES = [
  "bible",
  "outline",
  "chapters",
  "references",
] as const;

const RESERVED_NAMES = new Set([
  "planner",
  "writer",
  "editor",
  "reviewer",
  "observer",
  "all",
]);
const NAME_PATTERN = /^[a-z][a-z0-9-]{1,63}$/u;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/u;

export type AgentFormInput = {
  /** 英文标识，用作目录名与内部 id */
  name: string;
  /** 显示名，也是 @ 提及的名字：不含空白，不与其他 Agent 重名 */
  displayName: string;
  description: string;
  /** 系统提示词（AGENT.md 正文） */
  prompt: string;
  model: ModelRef;
  tools: string[];
  write: WriteLevel;
  writeScopes: string[];
  readScopes: string[];
  confirmBeforeWrite: boolean;
  maxTurns: number;
  avatar?: { glyph?: string; color?: string };
};

export class AgentFormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentFormError";
  }
}

const fail = (message: string): never => {
  throw new AgentFormError(message);
};

const hasControl = (value: string): boolean =>
  Array.from(value).some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 32 && code !== 10 && code !== 13 && code !== 9;
  });

export type AgentFormContext = {
  config: ModelConfig;
  /** 已存在的其他 Agent（内置+项目）的 name 与 displayName，用于查重 */
  others: Array<{ name: string; displayName: string }>;
};

/** 校验表单；通过则返回规整后的 frontmatter 与提示词。 */
export function validateAgentForm(
  input: AgentFormInput,
  context: AgentFormContext,
): { frontmatter: AgentFrontmatter; prompt: string } {
  const name = input.name.trim();
  if (!NAME_PATTERN.test(name))
    fail("标识只能用小写英文字母、数字和连字符，以字母开头，至少 2 个字符");
  if (RESERVED_NAMES.has(name)) fail(`标识 ${name} 是内置 Agent，请换一个`);
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 12) fail("显示名需要 1–12 个字");
  if (
    /\s/u.test(displayName) ||
    displayName.includes("@") ||
    hasControl(displayName)
  )
    fail("显示名不能含空白或 @（它同时是 @ 提及时用的名字）");
  for (const other of context.others) {
    if (other.name === name) fail(`标识 ${name} 已被占用`);
    if (other.displayName === displayName)
      fail(`显示名“${displayName}”已被其他 Agent 使用`);
  }
  const description = input.description.trim();
  if (
    !description ||
    description.length > 200 ||
    /[\r\n]/u.test(description) ||
    hasControl(description)
  )
    fail("描述需要 1–200 个字，且为单行");
  const prompt = input.prompt.trim();
  if (!prompt) fail("系统提示词不能为空");
  if (prompt.length > 8000) fail("系统提示词不能超过 8000 个字");
  if (hasControl(prompt)) fail("系统提示词含有不允许的控制字符");

  const tools = [...new Set(input.tools)];
  const unknown = tools.filter(
    (tool) => !(FORM_TOOLS as readonly string[]).includes(tool),
  );
  if (unknown.length) fail(`不支持的工具：${unknown.join("、")}`);
  if (!tools.length) fail("至少选择一个工具");
  const writeTools = tools.filter((tool) => WRITE_TOOLS.has(tool));
  const writeScopes = [...new Set(input.writeScopes)];
  const badScopes = writeScopes.filter(
    (scope) => !(WRITE_SCOPE_CHOICES as readonly string[]).includes(scope),
  );
  if (badScopes.length) fail(`不支持的写入范围：${badScopes.join("、")}`);
  if (input.write === "none") {
    if (writeTools.length) fail("写权限为“不写入”时不能勾选写入类工具");
    if (writeScopes.length) fail("写权限为“不写入”时不应设置写入范围");
  } else {
    if (!writeTools.length) fail("选择了写权限，需要勾选至少一个写入类工具");
    if (!writeScopes.length) fail("选择了写权限，需要至少选择一个写入范围");
    if (input.write === "propose" && tools.includes("doc.write"))
      fail(
        "“只提出修改”不能使用 doc.write（直接写入）；请改用 doc.propose，或把写权限设为“直接写入”",
      );
    if (
      tools.includes("bible.propose") &&
      !writeScopes.includes(".wordhub/bible/**")
    )
      fail("使用 bible.propose 需要选择写入范围“设定集”");
    if (
      (tools.includes("doc.write") || tools.includes("doc.propose")) &&
      !writeScopes.includes("chapters/**")
    )
      fail("使用 doc.write / doc.propose 需要选择写入范围“章节”");
  }
  const readScopes = [...new Set(input.readScopes)];
  const badRead = readScopes.filter(
    (scope) => !(READ_SCOPE_CHOICES as readonly string[]).includes(scope),
  );
  if (badRead.length) fail(`不支持的读取范围：${badRead.join("、")}`);
  if (
    tools.some((tool) => tool.startsWith("reference.")) &&
    !readScopes.includes("references")
  )
    fail("使用参考库工具需要把读取范围选上“参考库”");
  if (
    !Number.isInteger(input.maxTurns) ||
    input.maxTurns < 1 ||
    input.maxTurns > 30
  )
    fail("最大回合数需要是 1–30 的整数");
  const glyph = input.avatar?.glyph?.trim();
  if (
    glyph !== undefined &&
    glyph !== "" &&
    (Array.from(glyph).length > 2 || /\s/u.test(glyph) || hasControl(glyph))
  )
    fail("头像字最多 2 个字符，不含空白");
  const color = input.avatar?.color?.trim();
  if (color !== undefined && color !== "" && !COLOR_PATTERN.test(color))
    fail("头像颜色需要是 #RRGGBB 格式");
  try {
    new ModelResolver(context.config).assertSupported(input.model);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const frontmatter: AgentFrontmatter = {
    name,
    displayName,
    description,
    ...(glyph || color
      ? {
          avatar: {
            ...(glyph ? { glyph } : {}),
            ...(color ? { color } : {}),
          },
        }
      : {}),
    model: {
      provider: input.model.provider,
      id: input.model.id,
      reasoning: input.model.reasoning,
    },
    tools,
    write: input.write,
    writeScopes,
    confirmBeforeWrite:
      input.write === "none" ? false : input.confirmBeforeWrite,
    memoryScopes: { read: readScopes, write: [] },
    canChallenge: [],
    maxTurns: input.maxTurns,
  };
  return { frontmatter, prompt };
}

/** 序列化为 AGENT.md。frontmatter 由 YAML 库输出（自动加引号转义），正文原样放在其后。 */
export function renderAgentMarkdown(
  frontmatter: AgentFrontmatter,
  prompt: string,
): string {
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${prompt.trim()}\n`;
}

const agentFile = (projectPath: string, name: string): string =>
  path.join(projectPath, ".wordhub", "agents", name, "AGENT.md");

/** 目录链上不允许有符号链接，避免通过链接把文件写到项目外。 */
async function assertNoSymlinks(
  projectPath: string,
  relative: string[],
): Promise<void> {
  let current = projectPath;
  for (const part of relative) {
    current = path.join(current, part);
    const info = await lstat(current).catch(() => undefined);
    if (info?.isSymbolicLink())
      throw new AgentFormError("项目的 .wordhub/agents 路径含符号链接，已拒绝");
  }
}

async function othersFor(
  registry: AgentRegistry,
  projectPath: string,
  excludeName?: string,
): Promise<AgentFormContext["others"]> {
  const loaded = await registry.load(projectPath);
  return [...loaded.values()]
    .filter((agent) => agent.name !== excludeName)
    .map((agent) => ({ name: agent.name, displayName: agent.displayName }));
}

export type SaveAgentOptions = {
  projectPath: string;
  builtinRoot: string;
  config: ModelConfig;
  input: AgentFormInput;
  mode: "create" | "update";
};

/** 创建或更新项目级 Agent；写入前先按真实解析器校验，保证保存出去的文件一定能被加载。 */
export async function saveProjectAgent(
  options: SaveAgentOptions,
): Promise<{ name: string; path: string }> {
  const { projectPath, input, mode } = options;
  const registry = new AgentRegistry(options.builtinRoot);
  const name = input.name.trim();
  const others = await othersFor(
    registry,
    projectPath,
    mode === "update" ? name : undefined,
  );
  const existing = registry.get(name);
  if (mode === "create" && existing)
    fail(
      existing.source === "builtin"
        ? `标识 ${name} 是内置 Agent，请换一个`
        : `标识 ${name} 已被占用`,
    );
  if (mode === "update" && existing?.source !== "project")
    fail(
      existing ? "内置 Agent 不能在这里修改" : `找不到要修改的 Agent：${name}`,
    );
  const { frontmatter, prompt } = validateAgentForm(input, {
    config: options.config,
    others,
  });
  const markdown = renderAgentMarkdown(frontmatter, prompt);
  // 与加载时同一个解析器：能解析、字段完全一致才写盘
  const parsed = parseAgentMarkdown(markdown, "表单", "project");
  if (parsed.name !== frontmatter.name || parsed.systemPrompt !== prompt.trim())
    fail("生成的 AGENT.md 无法被正确解析，未保存");
  await assertNoSymlinks(projectPath, [".wordhub", "agents", name]);
  const target = agentFile(projectPath, name);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, markdown, "utf8");
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return { name, path: target };
}

export async function deleteProjectAgent(
  projectPath: string,
  builtinRoot: string,
  name: string,
): Promise<void> {
  const registry = new AgentRegistry(builtinRoot);
  await registry.load(projectPath);
  const existing = registry.get(name);
  if (!existing) fail(`找不到 Agent：${name}`);
  if (existing?.source !== "project") fail("内置 Agent 不能删除");
  if (!NAME_PATTERN.test(name)) fail("标识无效");
  await assertNoSymlinks(projectPath, [".wordhub", "agents", name]);
  await rm(path.dirname(agentFile(projectPath, name)), {
    recursive: true,
    force: true,
  });
}

/** 把已保存的项目 Agent 还原成表单，供编辑。 */
export async function readProjectAgentForm(
  projectPath: string,
  builtinRoot: string,
  name: string,
): Promise<AgentFormInput> {
  const registry = new AgentRegistry(builtinRoot);
  await registry.load(projectPath);
  const definition: AgentDefinition | undefined = registry.get(name);
  if (definition?.source !== "project")
    return fail(`找不到项目 Agent：${name}`);
  return {
    name: definition.name,
    displayName: definition.displayName,
    description: definition.description,
    prompt: definition.systemPrompt,
    model: definition.model,
    tools: definition.tools,
    write: definition.write,
    writeScopes: definition.writeScopes ?? [],
    readScopes: definition.memoryScopes.read,
    confirmBeforeWrite: definition.confirmBeforeWrite ?? true,
    maxTurns: definition.maxTurns,
    avatar: definition.avatar,
  };
}
