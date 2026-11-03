/** 导出用的章节结构：把编辑器支持的 Markdown 子集解析成块，DOCX 与 TXT 共用。 */
export type Run = { text: string; bold?: boolean; italic?: boolean };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; runs: Run[] }
  | { kind: "paragraph"; runs: Run[] }
  | { kind: "quote"; runs: Run[] }
  | { kind: "rule" };

export type ParsedChapter = {
  /** 第一个一级标题，作为章标题；没有则为 undefined */
  title?: string;
  blocks: Block[];
};

/** 行内：`**粗**`、`__粗__`、`*斜*`、`_斜_`，以及 `\*` `\_` `\\` 转义；与纸面编辑器保持一致。 */
export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  let bold = false;
  let italic = false;
  let buffer = "";
  const flush = () => {
    if (buffer) runs.push({ text: buffer, bold, italic });
    buffer = "";
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const next = text[index + 1];
    if (char === "\\" && next !== undefined && "\\*_".includes(next)) {
      buffer += next;
      index += 1;
    } else if ((char === "*" || char === "_") && next === char) {
      flush();
      bold = !bold;
      index += 1;
    } else if (char === "*" || char === "_") {
      flush();
      italic = !italic;
    } else buffer += char;
  }
  flush();
  return runs.map(({ text: value, bold: b, italic: i }) => ({
    text: value,
    ...(b ? { bold: true } : {}),
    ...(i ? { italic: true } : {}),
  }));
}

export const plainText = (runs: Run[]): string =>
  runs.map((run) => run.text).join("");

export function parseChapter(markdown: string): ParsedChapter {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push({
        kind: "paragraph",
        runs: parseInline(paragraph.join("\n")),
      });
      paragraph = [];
    }
  };
  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(/^(#{1,3})[ \t]+(.+)$/u);
    if (heading) {
      flush();
      blocks.push({
        kind: "heading",
        level: (heading[1]?.length ?? 1) as 1 | 2 | 3,
        runs: parseInline(heading[2] ?? ""),
      });
      continue;
    }
    if (/^ {0,3}(?:\*{3,}|-{3,}|_{3,})[ \t]*$/u.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    const quote = line.match(/^>[ \t]?(.*)$/u);
    if (quote) {
      flush();
      blocks.push({ kind: "quote", runs: parseInline(quote[1] ?? "") });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  const first = blocks.find(
    (block) => block.kind === "heading" && block.level === 1,
  );
  if (first?.kind !== "heading") return { blocks };
  // 章标题单独处理，正文里不再重复
  return {
    title: plainText(first.runs).trim(),
    blocks: blocks.filter((block) => block !== first),
  };
}
