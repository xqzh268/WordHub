import { describe, expect, it } from "vitest";
import {
  canonicalChapterPath,
  chapterFileStem,
  chapterNumberFromName,
  chapterNumberTokenInText,
  chapterNumbersInText,
  chapterPathInText,
  chapterPathLabel,
  isChapterFileName,
  isChapterPath,
  isEditableChapterPath,
  normalizeChapterPath,
} from "./chapters.js";

describe("小说章节规则", () => {
  it("保留规范章节路径和旧文件名识别", () => {
    expect(canonicalChapterPath(105)).toBe("chapters/第一百零五章.md");
    expect(chapterNumberFromName("chapters\\03-旧稿.MARKDOWN")).toBe(3);
    expect(chapterNumberFromName("file:chapters/chapter-12.txt")).toBe(12);
    expect(chapterFileStem("chapters\\草稿\\第三章.备份.TXT")).toBe(
      "第三章.备份",
    );
    expect(chapterPathLabel("chapters/草稿/第三章.备份")).toBe("草稿/第三章");
  });

  it("按使用场景识别章号，保留首次出现或枚举所有引用的差异", () => {
    const prompt = "参考第三节和第02回，再写第三章";
    expect(chapterNumberTokenInText(prompt)).toBe("三");
    expect(chapterNumberTokenInText(prompt, "章回")).toBe("02");
    expect(chapterNumbersInText(prompt, "章回")).toEqual([2, 3]);
    expect(chapterNumbersInText("先看第三3章，再写第三章", "章回")).toEqual([
      undefined,
      3,
    ]);
    expect(chapterNumberTokenInText("第一万章")).toBeUndefined();
    expect(
      chapterNumberTokenInText("第一万章", "章回节", {
        allowTenThousands: true,
      }),
    ).toBe("一万");
    expect(chapterPathInText("定稿 chapters/第三章.markdown。随后检查")).toBe(
      "chapters/第三章.markdown",
    );
  });

  it("分别保留章节引用、读入文件和纸面编辑的历史路径边界", () => {
    const nested = "chapters\\草稿\\第三章.txt";
    expect(normalizeChapterPath(nested)).toBe("chapters/草稿/第三章.txt");
    expect(isChapterPath(nested)).toBe(true);
    expect(isChapterPath("stories/chapters/第一章.md")).toBe(false);
    expect(isChapterFileName("第三章.txt")).toBe(true);
    expect(isChapterFileName(".第三章.md")).toBe(false);
    expect(isChapterFileName("第三章.md.tmp")).toBe(false);
    expect(isEditableChapterPath(nested)).toBe(false);
    expect(isEditableChapterPath("chapters/第三章.txt")).toBe(false);
    expect(isEditableChapterPath("chapters/../第三章.md")).toBe(false);
    expect(isEditableChapterPath("chapters/第三..章.md")).toBe(false);
    expect(isEditableChapterPath("CHAPTERS\\第三章.MARKDOWN")).toBe(true);
  });
});
