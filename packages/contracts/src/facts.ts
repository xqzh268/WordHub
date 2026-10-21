import type { Event } from "./domain.js";

/** 观察者抽取的事实类别（M4.5）。 */
export const FACT_KINDS = [
  "character_state",
  "term",
  "foreshadow",
  "event",
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const FACT_KIND_LABELS: Record<FactKind, string> = {
  character_state: "人物状态",
  term: "新名词",
  foreshadow: "伏笔",
  event: "关键事件",
};

export type NovelFactStatus = "proposed" | "confirmed" | "rejected";

/** 带正文锚点的事实：quote 是逐字出现在 chapter 里的原文。 */
export type NovelFact = {
  id: string;
  kind: FactKind;
  subject: string;
  statement: string;
  /** 相对路径，如 chapters/第五章.md */
  chapter: string;
  quote: string;
  status: NovelFactStatus;
  proposedAt: string;
  decidedAt?: string;
  runId?: string;
  /** 观察者对不确定之处的备注 */
  note?: string;
};

export type ChapterSummary = {
  chapter: string;
  text: string;
  at: string;
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

/**
 * 由事件日志投影出事实列表：fact.proposed 建立，fact.confirmed / fact.rejected 决定状态，
 * 以最后一次决定为准（用户可以改主意）。按章节与提出顺序稳定排序。
 */
export function projectFacts(events: readonly Event[]): NovelFact[] {
  const facts = new Map<string, NovelFact>();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (event.type === "fact.proposed") {
      const id = asString(payload.factId);
      const kind = payload.kind;
      const subject = asString(payload.subject);
      const statement = asString(payload.statement);
      const chapter = asString(payload.chapter);
      const quote = asString(payload.quote);
      if (
        !id ||
        !subject ||
        !statement ||
        !chapter ||
        !quote ||
        !FACT_KINDS.includes(kind as FactKind)
      )
        continue;
      facts.set(id, {
        id,
        kind: kind as FactKind,
        subject,
        statement,
        chapter,
        quote,
        status: "proposed",
        proposedAt: event.occurredAt,
        runId: event.runId,
        note: asString(payload.note),
      });
    } else if (
      event.type === "fact.confirmed" ||
      event.type === "fact.rejected"
    ) {
      const fact = facts.get(asString(payload.factId) ?? "");
      if (!fact) continue;
      fact.status = event.type === "fact.confirmed" ? "confirmed" : "rejected";
      fact.decidedAt = event.occurredAt;
    }
  }
  return [...facts.values()];
}

/** 最近一次为每章写下的摘要（后写的覆盖先写的）。 */
export function projectSummaries(events: readonly Event[]): ChapterSummary[] {
  const byChapter = new Map<string, ChapterSummary>();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.type !== "chapter.summary") continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const chapter = asString(payload.chapter);
    const text = asString(payload.text);
    if (chapter && text)
      byChapter.set(chapter, { chapter, text, at: event.occurredAt });
  }
  return [...byChapter.values()];
}

/** 用户已确认定稿的章节路径集合：最后一次 chapter.finalized 生效。 */
export function projectFinalized(events: readonly Event[]): Set<string> {
  const result = new Set<string>();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.type !== "chapter.finalized") continue;
    const chapter = asString(
      (event.payload as Record<string, unknown> | undefined)?.chapter,
    );
    if (chapter) result.add(chapter);
  }
  return result;
}
