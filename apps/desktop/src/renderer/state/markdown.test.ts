import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import { htmlToMarkdown, isLosslessMarkdown, markdownToHtml } from "./markdown";

beforeAll(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, { DOMParser: dom.window.DOMParser });
});

const roundTrip = (source: string) => htmlToMarkdown(markdownToHtml(source));

describe("纸面 Markdown 子集", () => {
  it("往返保留中文标点、强调、引用、分隔线、空行和尾部换行", () => {
    const source =
      "# 第一章·月下\n\n甲说：“别走。”\n\n**乙** *回头*\n\n> 风从城门来\n\n---\n";
    expect(roundTrip(source)).toBe(source);
  });

  it("段内换行、标题级别和半角符号保持不变", () => {
    const source = '## 二\n\n第一行\n第二行 & <尖括号> "引号"\n';
    expect(roundTrip(source)).toBe(source);
  });

  it("字面星号和下划线被转义，重开后不会变成强调", () => {
    const source = "价格是 5\\*3\\*2，文件名 a\\_b\\_c，路径 C:\\\\temp\n";
    expect(roundTrip(source)).toBe(source);
    // 作者在编辑器里直接键入星号：序列化后再解析仍是同一段文字
    const typed = "<p>5*3*2 与 a_b_c</p>";
    const markdown = htmlToMarkdown(typed);
    expect(markdown).toBe("5\\*3\\*2 与 a\\_b\\_c\n");
    expect(markdownToHtml(markdown)).toBe(typed);
  });

  it("编辑器里回车产生的空段落不写进文件", () => {
    expect(htmlToMarkdown("<h1>标题</h1><p></p><p>正文</p><p> </p>")).toBe(
      "# 标题\n\n正文\n",
    );
  });

  it("可无损编辑：子集内的章节、多余空行、缺结尾换行", () => {
    expect(isLosslessMarkdown("# 第一章\n\n正文。\n")).toBe(true);
    expect(isLosslessMarkdown("# 第一章\n\n\n\n正文。")).toBe(true);
    expect(isLosslessMarkdown("")).toBe(true);
  });

  it("列表、表格、链接、代码块按原样当作普通文字保留，不被改写", () => {
    for (const source of [
      "- 一\n- 二\n",
      "1. 一\n2. 二\n",
      "见[链接](https://example.com)\n",
      "```\ncode\n```\n",
      "| a | b |\n|---|---|\n| 1 | 2 |\n",
      "#### 四级标题\n",
    ]) {
      expect(roundTrip(source), source).toBe(source);
      expect(isLosslessMarkdown(source), source).toBe(true);
    }
  });

  it("会被改写的写法判为不可无损编辑，避免静默改动原文", () => {
    for (const source of ["__粗体__\n", "> 引用第一行\n> 引用第二行\n"])
      expect(isLosslessMarkdown(source), source).toBe(false);
  });
});
