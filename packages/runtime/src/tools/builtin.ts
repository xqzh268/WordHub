import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";

export type WriteToolInput = {
  path: string;
  content: string;
  expectedHash?: string | null;
};
export type BuiltinToolRuntime = {
  readDocument(
    path: string,
  ): Promise<{ text: string; contentHash: string | null }>;
  readBible(
    path: string,
  ): Promise<{ text: string; contentHash: string | null }>;
  writeDocument(input: {
    path: string;
    content: string;
    expectedHash?: string | null;
  }): Promise<{ revisionId: string; contentHash: string }>;
  proposeDocument(input: {
    path: string;
    content: string;
    expectedHash?: string | null;
  }): Promise<{ revisionId: string; contentHash: string }>;
  proposeBible?(input: {
    path: string;
    content: string;
    expectedHash?: string | null;
  }): Promise<{ revisionId: string; contentHash: string }>;
  searchHistory(
    query: string,
  ): Promise<Array<{ type: string; seq: number; text?: string }>>;
  getHistory?(
    seq: number,
  ): Promise<{ type: string; seq: number; text?: string } | undefined>;
  challengeRaise?(input: {
    threadId?: string;
    target: string;
    claim: string;
    path?: string;
    range?: string;
    evidence?: string[];
    severity: "blocking" | "minor";
  }): Promise<{ threadId: string; round: number }>;
  challengeReply?(input: {
    threadId: string;
    disposition: "accept" | "refute" | "partial";
    text: string;
    patchRef?: string;
  }): Promise<{ threadId: string; round: number }>;
  questionAsk?(input: {
    target: string;
    question: string;
    blocking?: boolean;
  }): Promise<{ questionId: string }>;
};

const pathParameters = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 500 }),
});
const writeParameters = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 500 }),
  content: Type.String({ maxLength: 2_000_000 }),
  expectedHash: Type.Optional(
    Type.String({ pattern: "^sha256:[a-f0-9]{64}$" }),
  ),
});
const searchParameters = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 200 }),
});
const challengeParameters = Type.Object({
  threadId: Type.Optional(Type.String({ maxLength: 100 })),
  target: Type.String({ minLength: 1, maxLength: 64 }),
  claim: Type.String({ minLength: 1, maxLength: 2000 }),
  path: Type.Optional(Type.String({ maxLength: 500 })),
  range: Type.Optional(Type.String({ maxLength: 200 })),
  evidence: Type.Optional(
    Type.Array(Type.String({ maxLength: 500 }), { maxItems: 8 }),
  ),
  severity: Type.Union([Type.Literal("blocking"), Type.Literal("minor")]),
});
const replyParameters = Type.Object({
  threadId: Type.String({ minLength: 1, maxLength: 100 }),
  disposition: Type.Union([
    Type.Literal("accept"),
    Type.Literal("refute"),
    Type.Literal("partial"),
  ]),
  text: Type.String({ minLength: 1, maxLength: 2000 }),
  patchRef: Type.Optional(Type.String({ maxLength: 200 })),
});
const questionParameters = Type.Object({
  target: Type.String({ minLength: 1, maxLength: 64 }),
  question: Type.String({ minLength: 1, maxLength: 2000 }),
  blocking: Type.Optional(Type.Boolean()),
});

const textResult = (text: string, details: Record<string, unknown> = {}) => ({
  content: [{ type: "text" as const, text }],
  details,
});

export function createBuiltinTools(runtime: BuiltinToolRuntime): AgentTool[] {
  const docRead: AgentTool<typeof pathParameters> = {
    name: "doc.read",
    label: "读取文档",
    description: "读取项目文件夹内的一个文档。路径必须是相对路径。",
    parameters: pathParameters,
    execute: async (_id: string, params: Static<typeof pathParameters>) => {
      const result = await runtime.readDocument(params.path);
      return textResult(result.text, {
        path: params.path,
        contentHash: result.contentHash,
      });
    },
  };
  const bibleRead: AgentTool<typeof pathParameters> = {
    name: "bible.read",
    label: "读取项目圣经",
    description: "读取.wordhub/bible目录内的设定文件。",
    parameters: pathParameters,
    execute: async (_id: string, params: Static<typeof pathParameters>) => {
      const result = await runtime.readBible(params.path);
      return textResult(result.text, {
        path: params.path,
        contentHash: result.contentHash,
      });
    },
  };
  const docWrite: AgentTool<typeof writeParameters> = {
    name: "doc.write",
    label: "写入文档",
    description: "以受控修订方式写入章节文档，写入前会检查磁盘版本。",
    parameters: writeParameters,
    execute: async (_id: string, params: Static<typeof writeParameters>) => {
      const result = await runtime.writeDocument(params);
      return textResult(
        `已写入${params.path}，修订${result.revisionId}`,
        result,
      );
    },
  };
  const docPropose: AgentTool<typeof writeParameters> = {
    name: "doc.propose",
    label: "提出文档修改",
    description: "保存一个待审阅的章节修订，不直接替换当前文件。",
    parameters: writeParameters,
    execute: async (_id: string, params: Static<typeof writeParameters>) => {
      const result = await runtime.proposeDocument(params);
      return textResult(
        `已提出${params.path}的修订${result.revisionId}`,
        result,
      );
    },
  };
  const historySearch: AgentTool<typeof searchParameters> = {
    name: "history.search",
    label: "检索历史",
    description: "按短语检索项目事件中可检索的用户消息和结果。",
    parameters: searchParameters,
    execute: async (_id: string, params: Static<typeof searchParameters>) => {
      const results = await runtime.searchHistory(params.query);
      return textResult(JSON.stringify(results, null, 2), {
        query: params.query,
        count: results.length,
      });
    },
  };
  const biblePropose: AgentTool<typeof writeParameters> = {
    name: "bible.propose",
    label: "提出设定修改",
    description: "保存.wordhub/bible中的设定候选，不直接替换当前文件。",
    parameters: writeParameters,
    execute: async (_id: string, params: Static<typeof writeParameters>) => {
      if (!runtime.proposeBible)
        return textResult("当前运行时未提供设定候选写入能力", {
          isError: true,
        });
      const result = await runtime.proposeBible(params);
      return textResult(
        `已提出设定${params.path}的修订${result.revisionId}`,
        result,
      );
    },
  };
  const historyGet: AgentTool<typeof pathParameters> = {
    name: "history.get",
    label: "读取历史事件",
    description: "读取指定序号的历史事件摘要。",
    parameters: Type.Object({ path: Type.String({ pattern: "^[0-9]+$" }) }),
    execute: async (_id: string, params: Static<typeof pathParameters>) => {
      const result = runtime.getHistory
        ? await runtime.getHistory(Number(params.path))
        : undefined;
      return textResult(result ? JSON.stringify(result) : "未找到该历史事件", {
        seq: Number(params.path),
      });
    },
  };
  const challengeRaise: AgentTool<typeof challengeParameters> = {
    name: "challenge.raise",
    label: "发起质询",
    description: "针对正文或设定提出带证据的质询。",
    parameters: challengeParameters,
    execute: async (_id, params) =>
      runtime.challengeRaise
        ? textResult(JSON.stringify(await runtime.challengeRaise(params)))
        : textResult("当前运行时未提供质询能力", { isError: true }),
  };
  const challengeReply: AgentTool<typeof replyParameters> = {
    name: "challenge.reply",
    label: "回应质询",
    description: "回应已有质询并说明接受、反驳或部分接受。",
    parameters: replyParameters,
    execute: async (_id, params) =>
      runtime.challengeReply
        ? textResult(JSON.stringify(await runtime.challengeReply(params)))
        : textResult("当前运行时未提供质询能力", { isError: true }),
  };
  const questionAsk: AgentTool<typeof questionParameters> = {
    name: "question.ask",
    label: "向Agent提问",
    description: "向另一个Agent提出一个可追踪的问题。",
    parameters: questionParameters,
    execute: async (_id, params) =>
      runtime.questionAsk
        ? textResult(JSON.stringify(await runtime.questionAsk(params)))
        : textResult("当前运行时未提供提问能力", { isError: true }),
  };
  return [
    docRead,
    docWrite,
    docPropose,
    bibleRead,
    biblePropose,
    historySearch,
    historyGet,
    ...(runtime.challengeRaise ? [challengeRaise] : []),
    ...(runtime.challengeReply ? [challengeReply] : []),
    ...(runtime.questionAsk ? [questionAsk] : []),
  ];
}
