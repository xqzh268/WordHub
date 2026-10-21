import type { Api, Model, Models } from "@earendil-works/pi-ai";
import type { ReasoningLevel } from "../types.js";
import type { IntakeAnswer } from "./intake.js";

/** 纲领问答完成后由模型生成的四份设定文档（写入 .wordhub/bible/）。 */
export const DRAFT_FILES = [
  { file: "outline.md", title: "大纲" },
  { file: "characters.md", title: "人物档案" },
  { file: "setting.md", title: "设定词典" },
  { file: "style.md", title: "文风基准" },
] as const;

export type DraftDocuments = Record<string, string>;
export type DraftUsage = {
  input: number;
  output: number;
  total: number;
  cost?: number;
};

const SYSTEM_PROMPT = `你是文枢的「纲领」Agent，替一位中文小说作者把零散的创作想法整理成一套可直接指导写作的设定文档。

一共输出四份 Markdown 文档，严格按下面的分隔行输出，分隔行单独成行，不要输出任何其他说明、前言或总结：

=====FILE: outline.md=====
（大纲）
=====FILE: characters.md=====
（人物档案）
=====FILE: setting.md=====
（设定词典）
=====FILE: style.md=====
（文风基准）

各文档要求：
1. outline.md「大纲」：一句话 premise；核心冲突；全书结构（起承转合或三幕）；逐章大纲（每章一小节：章号与标题、本章目标、关键事件、章末悬念或伏笔）；贯穿全书的悬念线与伏笔回收计划；结局方向。章数以作者给出的为准，没给就按体量合理设定（短篇 6–10 章）。
2. characters.md「人物档案」：主角与主要配角、对手各一小节，包含姓名、身份、外貌特征、性格、说话与行事习惯（含惯用手等会在正文里反复出现的细节）、动机、弱点、人物弧光；末尾列人物关系。
3. setting.md「设定词典」：世界 / 时代背景；主要地点；制度、称谓、器物、行话等词条（词条名：释义，供正文统一用词）；时间线；「必须出现」与「禁止出现」两节，逐条照抄作者的要求。
4. style.md「文风基准」：叙事视角、基调、节奏、句式与用词偏好、对话风格、描写侧重；给出一小段（150 字以内）示范文字；列出应避免的写法。

规则：
- 作者明确给出的信息一律忠实采用，不得改写或与之冲突。
- 作者没给的部分，请合理补全，并在该条目末尾加「（建议）」标记，方便作者区分哪些是你补的。
- 尊重题材与时代的真实感，不要编造会误导读者的史实；虚构处保持内部自洽。
- 篇幅克制：每份文档控制在 1500 字以内，宁可简练也不要空泛堆砌。
- 全文使用简体中文。`;

const LABELS: Record<string, string> = {
  premise: "一句话设想",
  protagonist: "主角",
  conflict: "核心冲突",
  world: "世界与时代",
  viewpointTone: "视角与基调",
  theme: "主题",
  audience: "目标读者",
  chapterCount: "预计章数",
  mustInclude: "必须出现的元素",
  forbidden: "不希望出现的内容",
};

export function buildDraftUserPrompt(answers: IntakeAnswer): string {
  const lines = Object.entries(LABELS).map(([key, label]) => {
    const value = answers[key as keyof IntakeAnswer]?.trim();
    return `- ${label}：${value && value !== "跳过" ? value : "（作者未提供，请合理补全）"}`;
  });
  return `作者的创作信息如下：\n\n${lines.join("\n")}\n\n请输出四份文档。`;
}

const FILE_LINE = /^=====FILE:\s*([A-Za-z0-9_.-]+)\s*=====\s*$/gmu;

/** 把模型输出按分隔行切成四份文档；缺任何一份或内容过短都视为失败。 */
export function parseDraft(text: string): DraftDocuments {
  const marks = [...text.matchAll(FILE_LINE)];
  const documents: DraftDocuments = {};
  marks.forEach((mark, index) => {
    const name = mark[1];
    if (!name) return;
    const start = (mark.index ?? 0) + mark[0].length;
    const end = marks[index + 1]?.index ?? text.length;
    documents[name] = text.slice(start, end).trim();
  });
  const missing = DRAFT_FILES.filter(
    ({ file }) => (documents[file]?.length ?? 0) < 40,
  ).map(({ file }) => file);
  if (missing.length)
    throw new Error(`模型输出缺少或过短的文档：${missing.join("、")}`);
  return Object.fromEntries(
    DRAFT_FILES.map(({ file }) => [file, documents[file] as string]),
  );
}

export type GenerateDraftOptions = {
  models: Models;
  model: Model<Api>;
  reasoning: ReasoningLevel;
  apiKey?: string;
  answers: IntakeAnswer;
  signal?: AbortSignal;
  /** 解析失败时的重试次数，默认 1 */
  retries?: number;
};

export async function generateDraft(
  options: GenerateDraftOptions,
): Promise<{ documents: DraftDocuments; usage: DraftUsage }> {
  const usage: DraftUsage = { input: 0, output: 0, total: 0 };
  let lastError: Error = new Error("纲领草稿生成失败");
  for (let attempt = 0; attempt <= (options.retries ?? 1); attempt += 1) {
    const reply = await options.models.completeSimple(
      options.model,
      {
        systemPrompt: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildDraftUserPrompt(options.answers),
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: options.apiKey,
        reasoning: options.reasoning === "off" ? undefined : options.reasoning,
        signal: options.signal,
      },
    );
    usage.input += reply.usage.input;
    usage.output += reply.usage.output;
    usage.total += reply.usage.totalTokens;
    if (reply.usage.cost?.total !== undefined)
      usage.cost = (usage.cost ?? 0) + reply.usage.cost.total;
    if (reply.stopReason === "error" || reply.stopReason === "aborted")
      throw new Error(reply.errorMessage || "模型请求失败");
    const text = reply.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    try {
      return { documents: parseDraft(text), usage };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError;
}
