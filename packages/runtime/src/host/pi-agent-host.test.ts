import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { PiAgentHost } from "./pi-agent-host.js";

function fixture() {
  const faux = fauxProvider({ tokensPerSecond: 100000 });
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

it("provider只收到合法工具别名，执行和事件仍使用逻辑名", async () => {
  const { faux, models } = fixture();
  const names: string[] = [];
  let executed = false;
  faux.setResponses([
    (context) => {
      expect(
        (
          context.messages[0] as { toolsAdded?: Array<{ name: string }> }
        ).toolsAdded?.every((tool) => /^[a-zA-Z0-9_-]{1,64}$/u.test(tool.name)),
      ).toBe(true);
      return fauxAssistantMessage(fauxToolCall("doc_write", {}), {
        stopReason: "toolUse",
      });
    },
    fauxAssistantMessage("完成"),
  ]);
  const host = new PiAgentHost({
    models,
    model: faux.getModel(),
    reasoning: "off",
    systemPrompt: "测试",
    tools: [
      {
        name: "doc.write",
        label: "写入",
        description: "写入",
        parameters: Type.Object({}),
        execute: async () => {
          executed = true;
          return { content: [{ type: "text", text: "完成" }], details: {} };
        },
      },
    ],
    emit: (event) => {
      if (event.type === "tool_started") names.push(event.toolName);
    },
  });
  await host.prompt("写正文");
  expect(executed).toBe(true);
  expect(names).toEqual(["doc.write"]);
});

it("provider的错误终态必须抛出而不能算成功", async () => {
  const { faux, models } = fixture();
  faux.setResponses([
    fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "400 invalid tool name",
    }),
  ]);
  const host = new PiAgentHost({
    models,
    model: faux.getModel(),
    reasoning: "off",
    systemPrompt: "测试",
    emit: () => {},
  });
  await expect(host.prompt("写正文")).rejects.toThrow("400 invalid tool name");
});
