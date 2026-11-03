const fs = require("fs");
const f = "packages/runtime/src/references/parse/pdf.ts";
let t = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const rep = (a, b) => { if (!t.includes(a)) throw new Error("未找到: " + a.slice(0, 60)); t = t.replace(a, b); };
rep("type TextItem = { str: string; hasEOL?: boolean };", `type TextItem = { str: string; hasEOL?: boolean };

/** PDF 元数据里的标题常常是垃圾：网页地址、“Microsoft Word - x.docx”、“Untitled”。这些不当书名，用文件名。 */
export function usablePdfTitle(title: string | undefined): string | undefined {
  const value = title?.trim();
  if (!value || value.length > 200) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value) || value.includes("://")) return undefined;
  if (/^(untitled|无标题|未命名)/iu.test(value)) return undefined;
  if (/^microsoft (word|powerpoint|excel)\s*-/iu.test(value)) return undefined;
  if (/\.(docx?|pptx?|xlsx?|tex|indd|pdf)$/iu.test(value)) return undefined;
  return value;
}`);
rep("      title: info?.Title?.trim() || fileName.replace(/\.[^.]+$/u, \"\"),", "      title: usablePdfTitle(info?.Title) ?? fileName.replace(/\.[^.]+$/u, \"\"),");
fs.writeFileSync(f, t);
const tf = "packages/runtime/src/references/references.test.ts";
let u = fs.readFileSync(tf, "utf8").replace(/\r\n/g, "\n");
u = u.replace('import { parseReferenceFile } from "./parse/index.js";', 'import { parseReferenceFile } from "./parse/index.js";\nimport { usablePdfTitle } from "./parse/pdf.js";');
u = u.replace('  it("没有文本层（扫描件）明确报错，不做 OCR"', `  it("元数据里的垃圾标题（网页地址、Word 文件名、Untitled）不当书名", () => {
    for (const junk of [
      "data:text/html;charset=utf-8,<html>",
      "https://example.com/a.html",
      "Microsoft Word - 论文终稿.docx",
      "Untitled",
      "无标题",
      "report.docx",
      "  ",
      undefined,
    ])
      expect(usablePdfTitle(junk), String(junk)).toBeUndefined();
    expect(usablePdfTitle("  长安夜研究  ")).toBe("长安夜研究");
  });

  it("没有文本层（扫描件）明确报错，不做 OCR"`);
fs.writeFileSync(tf, u);
