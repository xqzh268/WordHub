import type { Event } from "./domain.js";

/**
 * 别名合并：作者说明“黑衣人 其实就是 萧某”，并指明读者在哪一章得知。
 * 合并是带揭示时刻的：揭晓那一章之前两个名字仍是两个人物，之后合成一个。
 * 没有指明章节表示一直是同一个人。只由作者（用户）建立，不让模型自行合并——认错人比不合并更糟。
 */
export type AliasLink = {
  id: string;
  /** 被合并的名字（别名） */
  alias: string;
  /** 合并到的名字（规范名） */
  canonical: string;
  /** 揭晓于哪一章（相对路径）；缺省 = 一直是同一人 */
  chapter?: string;
  at: string;
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** 由事件日志投影出别名链接：alias.linked 建立，alias.unlinked 取消；同一别名后建立的取代先前的。 */
export function projectAliases(events: readonly Event[]): AliasLink[] {
  const links = new Map<string, AliasLink>();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (event.type === "alias.linked") {
      const id = asString(payload.aliasId);
      const alias = asString(payload.alias);
      const canonical = asString(payload.canonical);
      if (!id || !alias || !canonical || alias === canonical) continue;
      for (const [key, link] of links) if (link.alias === alias) links.delete(key);
      const chapter = asString(payload.chapter);
      links.set(id, {
        id,
        alias,
        canonical,
        ...(chapter ? { chapter } : {}),
        at: event.occurredAt,
      });
    } else if (event.type === "alias.unlinked") {
      const id = asString(payload.aliasId);
      if (id) links.delete(id);
    }
  }
  return [...links.values()];
}

/** 到第 upTo 章（0 起）为止，这个名字指的是谁。顺着别名链走，遇到环就停。 */
export function resolveName(
  name: string,
  aliases: readonly AliasLink[],
  position: ReadonlyMap<string, number>,
  upTo: number,
): string {
  const seen = new Set<string>([name]);
  let current = name;
  for (let step = 0; step < 10; step += 1) {
    const link = aliases.find((item) => {
      if (item.alias !== current) return false;
      if (!item.chapter) return true;
      const at = position.get(item.chapter);
      return at !== undefined && at <= upTo;
    });
    if (!link || seen.has(link.canonical)) break;
    seen.add(link.canonical);
    current = link.canonical;
  }
  return current;
}

/** 假如把 alias 并到 canonical，会不会绕成圈（不看章节，只看链接本身）。 */
export function wouldCycle(
  alias: string,
  canonical: string,
  aliases: readonly AliasLink[],
): boolean {
  let current = canonical;
  for (let step = 0; step < 20; step += 1) {
    if (current === alias) return true;
    const next = aliases.find((item) => item.alias === current);
    if (!next) return false;
    current = next.canonical;
  }
  return true;
}
