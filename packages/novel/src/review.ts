/** 小说一致性清单；跨原文的矛盾需要同时提供两端的引文。 */
export const NOVEL_REVIEW_CHECKLIST = [
  { id: "timeline", label: "时间线", requiredCitations: 2 },
  { id: "character", label: "人物塑造", requiredCitations: 2 },
  { id: "fact", label: "基本事实", requiredCitations: 2 },
  { id: "commonsense", label: "常识", requiredCitations: 1 },
  { id: "style", label: "风格", requiredCitations: 1 },
] as const;

export type NovelReviewCategory = (typeof NOVEL_REVIEW_CHECKLIST)[number]["id"];
