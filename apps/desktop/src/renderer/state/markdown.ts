/** 纸面编辑器支持的 Markdown 子集。转换只覆盖能够无损往返的结构。 */
const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

// 反斜杠转义（\* \_ \\）先换成私有占位符，强调语法处理完再还原，
// 保证作者键入的字面星号、下划线不会在下次打开时变成强调。
const MASKS: Array<[string, string]> = [
  ["\\\\", ""],
  ["\\*", ""],
  ["\\_", ""],
];
const UNMASK: Record<string, string> = {
  "": "\\",
  "": "*",
  "": "_",
};

const inlineToHtml = (value: string): string => {
  let masked = value;
  for (const [from, to] of MASKS) masked = masked.replaceAll(from, to);
  let html = escapeHtml(masked);
  html = html.replace(/\*\*([^*\n]+)\*\*/gu, "<strong>$1</strong>");
  html = html.replace(/__([^_\n]+)__/gu, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu, "<em>$1</em>");
  html = html.replace(/(?<!_)_([^_\n]+)_(?!_)/gu, "<em>$1</em>");
  return html.replace(/[-]/gu, (mark) => UNMASK[mark] ?? mark);
};

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const nodes: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      nodes.push(
        `<p>${inlineToHtml(paragraph.join("\n")).replaceAll("\n", "<br>")}</p>`,
      );
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
      const level = heading[1]?.length ?? 1;
      nodes.push(`<h${level}>${inlineToHtml(heading[2] ?? "")}</h${level}>`);
      continue;
    }
    if (/^ {0,3}(?:\*{3,}|-{3,}|_{3,})[ \t]*$/u.test(line)) {
      flush();
      nodes.push("<hr>");
      continue;
    }
    const quote = line.match(/^>[ \t]?(.*)$/u);
    if (quote) {
      flush();
      nodes.push(
        `<blockquote><p>${inlineToHtml(quote[1] ?? "")}</p></blockquote>`,
      );
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return nodes.join("");
}

const escapeText = (text: string): string => text.replace(/[\\*_]/gu, "\\$&");

const inlineFromHtml = (element: Element): string => {
  let result = "";
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3) result += escapeText(node.textContent ?? "");
    else if (node.nodeType === 1) {
      const child = node as Element;
      const value = inlineFromHtml(child);
      if (child.tagName === "STRONG" || child.tagName === "B")
        result += `**${value}**`;
      else if (child.tagName === "EM" || child.tagName === "I")
        result += `*${value}*`;
      else if (child.tagName === "BR") result += "\n";
      else result += value;
    }
  }
  return result;
};

export function htmlToMarkdown(html: string): string {
  if (typeof DOMParser === "undefined")
    throw new Error("纸面编辑器需要浏览器 DOM");
  const body = new DOMParser().parseFromString(
    `<body>${html}</body>`,
    "text/html",
  ).body;
  const blocks: string[] = [];
  for (const node of Array.from(body.children)) {
    const content = inlineFromHtml(node);
    if (/^H[1-3]$/u.test(node.tagName))
      blocks.push(`${"#".repeat(Number(node.tagName[1]))} ${content}`);
    else if (node.tagName === "BLOCKQUOTE")
      blocks.push(
        content
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
      );
    else if (node.tagName === "HR") blocks.push("---");
    // 回车产生的空段落不写进文件：Markdown 里空行本来就是段落分隔，写出来只会堆出多余空行。
    else if (content.trim()) blocks.push(content);
  }
  return `${blocks.join("\n\n")}\n`;
}

const normalizeForCompare = (value: string): string =>
  value
    .replaceAll("\r\n", "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trimEnd();

/**
 * 章节能否在编辑器里无损编辑：转换一次再转回来，与原文一致（忽略多余空行和结尾空白）才算。
 * 含列表、表格、链接、代码块、`__粗体__` 等编辑器不支持的写法时返回 false，宁可不让编辑也不静默改写。
 */
export function isLosslessMarkdown(source: string): boolean {
  try {
    return (
      normalizeForCompare(htmlToMarkdown(markdownToHtml(source))) ===
      normalizeForCompare(source)
    );
  } catch {
    return false;
  }
}
