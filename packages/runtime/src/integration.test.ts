import { createModels } from "@earendil-works/pi-ai";
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { PiAgentHost } from "./host/pi-agent-host.js";
import { PermissionDeniedError, PermissionGuard } from "./tools/permissions.js";
import type { AgentDefinition } from "./types.js";

const agent = (overrides: Partial<AgentDefinition> = {}): AgentDefinition => ({
  name: "writer",
  displayName: "写手",
  description: "测试",
  model: { provider: "faux", id: "faux-1", reasoning: "off" },
  tools: ["doc.write"],
  write: "write",
  writeScopes: ["chapters/**"],
  memoryScopes: { read: [], write: [] },
  maxTurns: 4,
  source: "project",
  sourcePath: "test",
  systemPrompt: "测试",
  version: "test-version",
  confirmBeforeWrite: false,
  ...overrides,
});

function hostWith(
  responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0],
  beforeToolCall?: AgentOptions["beforeToolCall"],
) {
  const faux = fauxProvider({ models: [{ id: "faux-1", reasoning: false }] });
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(responses);
  const events: string[] = [];
  let executed = 0;
  const host = new PiAgentHost({
    models,
    model: faux.getModel(),
    reasoning: "off",
    systemPrompt: "测试",
    beforeToolCall,
    tools: [
      {
        name: "doc.write",
        label: "写入",
        description: "写入",
        parameters: Type.Object({
          path: Type.String(),
          content: Type.String(),
        }),
        execute: async () => {
          executed += 1;
          return {
            content: [{ type: "text" as const, text: "写入成功" }],
            details: {},
          };
        },
      },
    ],
    emit: (event) => {
      if (event.type === "tool_started") events.push(event.toolName);
    },
  });
  return {
    host,
    events,
    get executed() {
      return executed;
    },
  };
}

describe("M2 deterministic Agent chain", () => {
  it("权限拒绝作为工具错误继续给模型解释", async () => {
    const definition = agent();
    const guard = new PermissionGuard();
    const { host } = hostWith(
      [
        fauxAssistantMessage(
          fauxToolCall("doc_write", { path: "notes/a.md", content: "越权" }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("权限不足，未写入。"),
      ],
      async ({ toolCall, args }) => {
        try {
          guard.assert(
            definition,
            toolCall.name,
            (args as { path: string }).path,
          );
          return undefined;
        } catch (error) {
          return {
            block: true,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
    await expect(host.prompt("写入notes/a.md")).resolves.toBeUndefined();
    expect(() => guard.assert(definition, "doc.write", "notes/a.md")).toThrow(
      PermissionDeniedError,
    );
  });

  it("空写入范围即使write级别也拒绝", () => {
    expect(() =>
      new PermissionGuard().assert(
        agent({ writeScopes: [] }),
        "doc.write",
        "chapters/a.md",
      ),
    ).toThrow("未声明写入范围");
  });

  it("批准前不执行工具，批准后由同一Agent继续", async () => {
    let resolveApproval!: () => void;
    const approval = new Promise<void>((resolve) => {
      resolveApproval = resolve;
    });
    const prepared = hostWith(
      [
        fauxAssistantMessage(
          fauxToolCall("doc_write", { path: "chapters/a.md", content: "内容" }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("已完成"),
      ],
      async () => {
        await approval;
        return undefined;
      },
    );
    const run = prepared.host.prompt("写入章节");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prepared.executed).toBe(0);
    resolveApproval();
    await run;
    expect(prepared.events).toEqual(["doc.write"]);
    expect(prepared.executed).toBe(1);
  });
});
