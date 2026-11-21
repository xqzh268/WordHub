import path from "node:path";
import { NOVEL_PROJECT_TYPE, isChapterWritingRequest } from "@wordhub/novel";
import { loadWorkflow, type WorkflowDefinition } from "./workflow.js";
import type { RunRequest } from "../runs/run-types.js";

const { rolePack, workflows } = NOVEL_PROJECT_TYPE;

export function workflowRoute(
  input: Pick<RunRequest, "prompt" | "rawPrompt" | "agentId" | "workflow">,
) {
  if (input.workflow) return input.workflow;
  if (/^@(all|全部)\b/iu.test(input.rawPrompt ?? input.prompt))
    return workflows.collaboration;
  if (
    (input.rawPrompt ?? "").trimStart().startsWith("@") ||
    (input.agentId && input.agentId !== rolePack.coordinator)
  )
    return undefined;
  if (/^定稿/u.test(input.prompt.trim())) return "finalize-chapter";
  if (/全流程/u.test(input.prompt)) return "write-chapter-full";
  if (isChapterWritingRequest(input.prompt)) return "write-chapter";
  if (/^(请)?评审|检查.{0,12}一致性/u.test(input.prompt)) return "review-only";
  return undefined;
}
export async function definitionFor(
  root: string,
  workflow: NonNullable<RunRequest["workflow"]>,
): Promise<WorkflowDefinition> {
  if (workflow !== workflows.collaboration) {
    if (!Object.hasOwn(workflows.files, workflow))
      throw new Error(`工作流不存在：${workflow}`);
    return loadWorkflow(
      path.join(root, workflows.directory, workflows.files[workflow]),
    );
  }
  const agents = [...rolePack.collaborators];
  return {
    id: workflows.collaboration,
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
        agent: rolePack.coordinator,
        kind: "summary",
        status: "pending",
        dependencies: agents,
        maxAttempts: 1,
      },
    ],
  };
}
