import path from "node:path";
import type { AgentDefinition, WriteLevel } from "../types.js";

export type ToolDescriptor = {
  name: string;
  kind: "read" | "write" | "system";
};
export const BUILTIN_TOOLS: ToolDescriptor[] = [
  { name: "doc.read", kind: "read" },
  { name: "doc.write", kind: "write" },
  { name: "doc.propose", kind: "write" },
  { name: "bible.read", kind: "read" },
  { name: "bible.propose", kind: "write" },
  { name: "history.search", kind: "read" },
  { name: "history.get", kind: "read" },
  { name: "challenge.raise", kind: "system" },
  { name: "challenge.reply", kind: "system" },
  { name: "question.ask", kind: "system" },
];

export class PermissionDeniedError extends Error {
  constructor(
    readonly tool: string,
    message: string,
  ) {
    super(`权限拒绝：${tool}：${message}`);
    this.name = "PermissionDeniedError";
  }
}

export class PermissionGuard {
  constructor(
    private readonly tools: readonly ToolDescriptor[] = BUILTIN_TOOLS,
  ) {}

  assert(
    agent: AgentDefinition,
    toolName: string,
    relativePath?: string,
  ): void {
    const tool = this.tools.find((item) => item.name === toolName);
    if (!tool || !agent.tools.includes(toolName))
      throw new PermissionDeniedError(toolName, "Agent未声明此工具");
    if (tool.kind !== "write") return;
    const level: WriteLevel = agent.write;
    if (level === "none")
      throw new PermissionDeniedError(toolName, "Agent的写权限为none");
    if (toolName.endsWith(".write") && level !== "write")
      throw new PermissionDeniedError(toolName, "当前只允许提出修改方案");
    if (!agent.writeScopes?.length)
      throw new PermissionDeniedError(toolName, "未声明写入范围，禁止写入");
    if (
      !relativePath ||
      !agent.writeScopes.some((scope) => this.matches(scope, relativePath))
    )
      throw new PermissionDeniedError(toolName, "路径不在Agent的写入范围内");
  }

  requiresApproval(agent: AgentDefinition, toolName: string): boolean {
    return (
      (toolName.endsWith(".write") || toolName.endsWith(".propose")) &&
      agent.confirmBeforeWrite === true
    );
  }

  private matches(scope: string, relativePath: string): boolean {
    const normalizedScope = scope.replaceAll("\\", "/");
    const normalizedPath = path.posix.normalize(
      relativePath.replaceAll("\\", "/"),
    );
    if (
      normalizedPath.startsWith("../") ||
      normalizedPath === ".." ||
      path.posix.isAbsolute(normalizedPath) ||
      /^[a-z]:/iu.test(normalizedPath)
    )
      return false;
    if (normalizedScope.endsWith("/**"))
      return normalizedPath.startsWith(normalizedScope.slice(0, -2));
    return normalizedScope === normalizedPath;
  }
}
