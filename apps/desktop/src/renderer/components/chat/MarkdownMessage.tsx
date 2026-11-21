import type { ElementType, ReactNode } from "react";

function inlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/gu);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={key}>{part.slice(1, -1)}</code>;
    return <span key={key}>{part}</span>;
  });
}

export function MarkdownMessage({
  text,
  className,
  streaming = false,
}: {
  text: string;
  className: string;
  streaming?: boolean;
}) {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(
      <p key={`p-${blocks.length}`}>
        {inlineMarkdown(paragraph.join("\n"), `p-${blocks.length}`)}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const List = list.ordered ? "ol" : "ul";
    blocks.push(
      <List key={`list-${blocks.length}`}>
        {list.items.map((item, index) => (
          <li key={`list-${blocks.length}-${index}`}>
            {inlineMarkdown(item, `list-${blocks.length}-${index}`)}
          </li>
        ))}
      </List>,
    );
    list = null;
  };
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/u.exec(line);
    const unordered = /^\s*[-*+]\s+(.+)$/u.exec(line);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const marks = heading[1] ?? "#";
      const headingText = heading[2] ?? "";
      const Tag = `h${marks.length}` as ElementType;
      blocks.push(
        <Tag key={`h-${blocks.length}`}>
          {inlineMarkdown(headingText, `h-${blocks.length}`)}
        </Tag>,
      );
    } else if (ordered || unordered) {
      flushParagraph();
      const orderedList = Boolean(ordered);
      if (!list || list.ordered !== orderedList) {
        flushList();
        list = { ordered: orderedList, items: [] };
      }
      const listItem = ordered?.[1] ?? unordered?.[1];
      if (listItem) list.items.push(listItem);
    } else {
      if (list) flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return (
    <div className={className}>
      {blocks}
      {streaming && <span className="ink-dot" aria-hidden="true" />}
    </div>
  );
}
