import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";

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
  searchHistory(
    query: string,
  ): Promise<Array<{ type: string; seq: number; text?: string }>>;
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
  return [docRead, docWrite, docPropose, bibleRead, historySearch];
}
