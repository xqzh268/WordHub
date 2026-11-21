import { CHAPTER_DIRECTORY } from "./chapters.js";
import { NOVEL_REVIEW_CHECKLIST } from "./review.js";

/** 小说项目使用的文档、上下文和写作资源。资源路径相对于工作区根目录。 */
export const NOVEL_PROJECT_TYPE = {
  kind: "novel",
  documentUnit: "chapter",
  documentDirectory: CHAPTER_DIRECTORY,
  sourceFormat: "md",
  readScopes: ["bible", "outline", "chapters", "references"],
  contextLayers: {
    outline: { id: "outline", kind: "outline", tokenBudget: 1200 },
    setting: { id: "setting", kind: "bible", tokenBudget: 1800 },
    characters: { id: "characters", kind: "bible", tokenBudget: 1800 },
    summaries: { id: "summaries", kind: "memory", tokenBudget: 1000 },
    facts: { id: "facts", kind: "memory", tokenBudget: 1200 },
    previousChapter: { kind: "document", tokenBudget: 400 },
    style: { id: "style", kind: "bible", tokenBudget: 800 },
    styleSamples: { id: "style-samples", kind: "bible", tokenBudget: 1400 },
  },
  rolePack: {
    directory: "packages/novel/agents",
    coordinator: "planner",
    collaborators: ["writer", "editor", "reviewer", "observer"],
  },
  workflows: {
    directory: "packages/novel/workflows",
    files: {
      "write-chapter": "write-chapter.json",
      "write-chapter-full": "write-chapter-full.json",
      "review-only": "review-only.json",
      "finalize-chapter": "finalize-chapter.json",
    },
    collaboration: "all",
  },
  reviewChecklist: NOVEL_REVIEW_CHECKLIST,
  exportFormats: ["docx", "txt-utf8", "txt-gb18030"],
} as const;

export type NovelWorkflowId =
  | keyof typeof NOVEL_PROJECT_TYPE.workflows.files
  | typeof NOVEL_PROJECT_TYPE.workflows.collaboration;

export type NovelExportFormat =
  (typeof NOVEL_PROJECT_TYPE.exportFormats)[number];
