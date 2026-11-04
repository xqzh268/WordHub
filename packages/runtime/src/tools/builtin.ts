import { FACT_KINDS, type FactKind } from "@wordhub/contracts";
import {
  CHALLENGE_CATEGORIES,
  type ChallengeCategory,
  type Citation,
} from "./citations.js";
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
    category: ChallengeCategory;
    citations: Citation[];
    severity: "blocking" | "minor";
  }): Promise<{ threadId: string; round: number }>;
  challengeReply?(input: {
    threadId: string;
    disposition: "accept" | "refute" | "partial";
    text: string;
    patchRef?: string;
  }): Promise<{ threadId: string; round: number }>;
  factPropose?(input: {
    kind: FactKind;
    subject: string;
    object?: string;
    relation?: string;
    statement: string;
    chapter: string;
    quote: string;
    note?: string;
  }): Promise<{ factId: string; duplicate?: boolean }>;
  chapterSummarize?(input: {
    chapter: string;
    summary: string;
  }): Promise<{ chapter: string }>;
  /** 参考库：不带 referenceId 时列出所有资料；带 referenceId 时列出该资料的章节 */
  referenceList?(referenceId?: string): Promise<unknown>;
  referenceSearch?(input: {
    query: string;
    referenceId?: string;
  }): Promise<unknown>;
  referenceRead?(input: {
    referenceId: string;
    chapterId: string;
    start?: number;
    end?: number;
  }): Promise<unknown>;
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
  category: Type.Union(
    CHALLENGE_CATEGORIES.map((item) => Type.Literal(item)),
    {
      description:
        "一致性分类：timeline时间线 / character人物塑造 / fact基本事实 / commonsense常识 / style风格",
    },
  ),
  citations: Type.Array(
    Type.Object({
      source: Type.String({
        minLength: 1,
        maxLength: 300,
        description:
          "出处文件的相对路径，如 chapters/第三章.md 或 .wordhub/bible/characters.md",
      }),
      quote: Type.String({
        minLength: 1,
        maxLength: 400,
        description: "逐字复制的原文片段（可用……连接两段）",
      }),
    }),
    { minItems: 1, maxItems: 6 },
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
const factParameters = Type.Object({
  kind: Type.Union(
    FACT_KINDS.map((item) => Type.Literal(item)),
    {
      description:
        "character_state人物状态（死亡/受伤/身份变化/位置等） / term新名词 / foreshadow伏笔 / event关键事件 / relation人物关系（两个人物之间，需同时给 object 与 relation）",
    },
  ),
  subject: Type.String({
    minLength: 1,
    maxLength: 80,
    description: "事实的主体：人物名、名词本身、伏笔的称呼",
  }),
  object: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 80,
      description: "仅 relation：关系的另一端人物名（subject → object）",
    }),
  ),
  relation: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 20,
      description:
        "仅 relation：关系名，用 2–6 个字，如师徒、夫妻、仇敌、同伴、主仆",
    }),
  ),
  statement: Type.String({
    minLength: 1,
    maxLength: 300,
    description: "一句话陈述事实，只写正文里确实发生或说明的内容",
  }),
  chapter: Type.String({
    minLength: 1,
    maxLength: 300,
    description: "出处章节的相对路径，如 chapters/第五章.md",
  }),
  quote: Type.String({
    minLength: 1,
    maxLength: 400,
    description: "逐字复制的正文原文，作为这条事实的锚点",
  }),
  note: Type.Optional(
    Type.String({ maxLength: 200, description: "不确定之处的备注" }),
  ),
});
const summaryParameters = Type.Object({
  chapter: Type.String({ minLength: 1, maxLength: 300 }),
  summary: Type.String({
    minLength: 1,
    maxLength: 800,
    description: "本章摘要：发生了什么、人物状态变化、留下的悬念，300字以内",
  }),
});
const referenceListParameters = Type.Object({
  referenceId: Type.Optional(
    Type.String({
      pattern: "^ref-[0-9a-f]{12}$",
      description:
        "资料标识；不填则列出参考库里的所有资料，填了则列出这份资料的章节",
    }),
  ),
});
const referenceSearchParameters = Type.Object({
  query: Type.String({
    minLength: 1,
    maxLength: 100,
    description: "要找的字词（子串匹配，不区分大小写）",
  }),
  referenceId: Type.Optional(
    Type.String({
      pattern: "^ref-[0-9a-f]{12}$",
      description: "只在这份资料里找；不填则全部资料",
    }),
  ),
});
const referenceReadParameters = Type.Object({
  referenceId: Type.String({ pattern: "^ref-[0-9a-f]{12}$" }),
  chapterId: Type.String({
    pattern: "^[0-9]{4}$",
    description: "章节标识，如 0003，来自 reference.list / reference.search",
  }),
  start: Type.Optional(
    Type.Integer({ minimum: 0, description: "起始字符偏移，默认 0" }),
  ),
  end: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "结束字符偏移；单次最多返回 2 万字，超出的用 start 续读",
    }),
  ),
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
    description:
      "读取项目文件夹内的文档；传入目录时返回目录清单。路径必须是相对路径。",
    parameters: pathParameters,
    execute: async (_id: string, params: Static<typeof pathParameters>) => {
      const result = await runtime.readDocument(params.path);
      return textResult(
        `内容哈希：${result.contentHash ?? "无（目录）"}\n${result.text}`,
        {
          path: params.path,
          contentHash: result.contentHash,
        },
      );
    },
  };
  const bibleRead: AgentTool<typeof pathParameters> = {
    name: "bible.read",
    label: "读取项目圣经",
    description: "读取.wordhub/bible目录内的设定文件。",
    parameters: pathParameters,
    execute: async (_id: string, params: Static<typeof pathParameters>) => {
      const result = await runtime.readBible(params.path);
      return textResult(
        `内容哈希：${result.contentHash ?? "无（目录）"}\n${result.text}`,
        {
          path: params.path,
          contentHash: result.contentHash,
        },
      );
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
    description:
      "针对正文或设定提出质询。必须选择分类，并用 citations 逐字引用出处原文（时间线/人物/基本事实类要引用矛盾的两端）；引文不是逐字原文时会被拒绝。",
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
  const factPropose: AgentTool<typeof factParameters> = {
    name: "fact.propose",
    label: "提出待确认事实",
    description:
      "把正文中的一条事实记为“待确认”，等用户确认后才会成为硬校验依据。必须逐字引用正文原文作为锚点，引文不是逐字原文会被拒绝。",
    parameters: factParameters,
    execute: async (_id, params) =>
      runtime.factPropose
        ? textResult(JSON.stringify(await runtime.factPropose(params)))
        : textResult("当前运行时未提供事实能力", { isError: true }),
  };
  const chapterSummarize: AgentTool<typeof summaryParameters> = {
    name: "chapter.summarize",
    label: "记录章节摘要",
    description: "为定稿章节写一段摘要，供后续章节的上下文使用。",
    parameters: summaryParameters,
    execute: async (_id, params) =>
      runtime.chapterSummarize
        ? textResult(JSON.stringify(await runtime.chapterSummarize(params)))
        : textResult("当前运行时未提供摘要能力", { isError: true }),
  };
  const referenceList: AgentTool<typeof referenceListParameters> = {
    name: "reference.list",
    label: "列出参考库",
    description:
      "列出参考库里的资料（书名、作者、章数）；传 referenceId 则列出该资料的章节。参考库是作者放进来的参考小说/资料，只读。",
    parameters: referenceListParameters,
    execute: async (_id, params) =>
      runtime.referenceList
        ? textResult(
            JSON.stringify(await runtime.referenceList(params.referenceId)),
          )
        : textResult("当前运行时未提供参考库", { isError: true }),
  };
  const referenceSearch: AgentTool<typeof referenceSearchParameters> = {
    name: "reference.search",
    label: "检索参考库",
    description:
      "在参考库里按字词全文检索，返回出处（资料、章节、偏移）和前后文片段，最多 30 条。找到后用 reference.read 读原文。",
    parameters: referenceSearchParameters,
    execute: async (_id, params) =>
      runtime.referenceSearch
        ? textResult(JSON.stringify(await runtime.referenceSearch(params)))
        : textResult("当前运行时未提供参考库", { isError: true }),
  };
  const referenceRead: AgentTool<typeof referenceReadParameters> = {
    name: "reference.read",
    label: "阅读参考库章节",
    description:
      "读取参考库里某章（或其中一段）的原文。引用时请注明资料名与章节，并且只借鉴笔法、节奏与结构，不得照抄原句或情节。",
    parameters: referenceReadParameters,
    execute: async (_id, params) =>
      runtime.referenceRead
        ? textResult(JSON.stringify(await runtime.referenceRead(params)))
        : textResult("当前运行时未提供参考库", { isError: true }),
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
    ...(runtime.referenceList ? [referenceList] : []),
    ...(runtime.referenceSearch ? [referenceSearch] : []),
    ...(runtime.referenceRead ? [referenceRead] : []),
    ...(runtime.questionAsk ? [questionAsk] : []),
    ...(runtime.factPropose ? [factPropose] : []),
    ...(runtime.chapterSummarize ? [chapterSummarize] : []),
  ];
}
