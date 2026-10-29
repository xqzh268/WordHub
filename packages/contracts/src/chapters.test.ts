import { describe, expect, it } from "vitest";
import {
  canonicalChapterName,
  chapterNumberFromName,
  formatChapterNumber,
} from "./chapters.js";

describe("章节文件名", () => {
  it("把常见章号格式化为稳定的中文文件名", () => {
    expect(formatChapterNumber(3)).toBe("三");
    expect(formatChapterNumber(10)).toBe("十");
    expect(formatChapterNumber(12)).toBe("十二");
    expect(formatChapterNumber(105)).toBe("一百零五");
    expect(canonicalChapterName(3)).toBe("第三章.md");
  });

  it("仍能识别旧的英文/数字文件名用于迁移与读取", () => {
    expect(chapterNumberFromName("chapter-03.md")).toBe(3);
    expect(chapterNumberFromName("03-旧稿.md")).toBe(3);
    expect(chapterNumberFromName("file:chapters/chapter-03.md")).toBe(3);
    expect(chapterNumberFromName(canonicalChapterName(105))).toBe(105);
  });
});
