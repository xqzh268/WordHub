import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

/** faux/回归运行使用的多轮工具，确保思考模式仍会完成真实工具往返。 */
export const echoTool: AgentTool = {
  name: "wordhub_echo",
  label: "文枢回声工具",
  description: "回传一个短句，用于验证思考模式下的多轮工具调用。",
  parameters: Type.Object({
    text: Type.String({ minLength: 1, maxLength: 200 }),
  }),
  execute: async (_toolCallId: string, params: unknown) => {
    const text = (params as { text: string }).text;
    return {
      content: [{ type: "text" as const, text: `工具已执行：${text}` }],
      details: { roundTrip: true },
    };
  },
};
