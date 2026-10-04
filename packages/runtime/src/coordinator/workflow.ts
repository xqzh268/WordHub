import { readFile } from "node:fs/promises";
import type { TaskNode } from "./graph.js";

export type WorkflowNode = TaskNode & {
  kind: string;
  agent: string;
  input?: string[];
};
export type WorkflowDefinition = {
  id: string;
  label: string;
  nodes: WorkflowNode[];
};

export async function loadWorkflow(
  filePath: string,
): Promise<WorkflowDefinition> {
  const parsed = JSON.parse(
    await readFile(filePath, "utf8"),
  ) as WorkflowDefinition;
  if (!parsed || typeof parsed.id !== "string" || !Array.isArray(parsed.nodes))
    throw new Error("工作流定义必须包含id和nodes");
  const ids = new Set<string>();
  for (const node of parsed.nodes) {
    if (!node.id || ids.has(node.id))
      throw new Error(`工作流节点重复：${node.id}`);
    ids.add(node.id);
    if (!node.agent || !node.kind || !Array.isArray(node.dependencies))
      throw new Error(`工作流节点字段不完整：${node.id}`);
    if (node.dependencies.includes(node.id))
      throw new Error(`工作流节点不能依赖自身：${node.id}`);
  }
  if (
    parsed.nodes.some((node) =>
      node.dependencies.some((dependency) => !ids.has(dependency)),
    )
  )
    throw new Error("工作流包含不存在的依赖");
  return parsed;
}
