import path from "node:path";
import { loadWorkflow, type WorkflowDefinition } from "./workflow.js";
import type { RunRequest } from "../runs/run-types.js";

export function workflowRoute(
  input: Pick<RunRequest, "prompt" | "rawPrompt" | "agentId" | "workflow">,
) {
  if (input.workflow) return input.workflow;
  if (/^@(all|全部)\b/iu.test(input.rawPrompt ?? input.prompt)) return "all";
  if (
    (input.rawPrompt ?? "").trimStart().startsWith("@") ||
    (input.agentId && input.agentId !== "planner")
  )
    return undefined;
  if (/全流程/u.test(input.prompt)) return "write-chapter-full";
  if (/(写|撰写|生成).{0,8}第?[一二三四五六七八九十\d]+章/u.test(input.prompt))
    return "write-chapter";
  if (/^(请)?评审|检查.{0,12}一致性/u.test(input.prompt)) return "review-only";
  return undefined;
}
export async function definitionFor(
  root: string,
  workflow: NonNullable<RunRequest["workflow"]>,
): Promise<WorkflowDefinition> {
  if (workflow !== "all")
    return loadWorkflow(
      path.join(root, "packages/novel/workflows", `${workflow}.json`),
    );
  const agents = ["writer", "editor", "reviewer", "observer"];
  return {
    id: "all",
    label: "全体协作",
    nodes: [
      ...agents.map((agent) => ({
        id: agent,
        agent,
        kind: "consult",
        status: "pending" as const,
        dependencies: [],
        maxAttempts: 1,
      })),
      {
        id: "summary",
        agent: "planner",
        kind: "summary",
        status: "pending",
        dependencies: agents,
        maxAttempts: 1,
      },
    ],
  };
}
