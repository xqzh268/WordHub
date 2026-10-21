import type { ChapterInfo } from "@wordhub/contracts";
import { describe, expect, it } from "vitest";
import {
  chapterFromPrompt,
  formatUpdated,
  needsReload,
  neighborChapter,
  paperFromText,
  pickActiveChapter,
} from "./chapters";

const chapter = (
  name: string,
  number: number | undefined,
  mtimeMs: number,
): ChapterInfo => ({
  path: `chapters/${name}`,
  name,
  number,
  size: 10,
  mtimeMs,
});
const list = [
  chapter("第一章.md", 1, 1000),
  chapter("第二章.md", 2, 3000),
  chapter("第三章.md", 3, 2000),
];

describe("paperFromText", () => {
  it("首个 # 标题作为章名，重复的“第N章”被去掉", () => {
    const paper = paperFromText(
      "chapters/第四章.md",
      "# 第四章 残月\n\n残月悬在天边。\n\n他站在窗前。",
    );
    expect(paper.no).toBe("第四章");
    expect(paper.title).toBe("残月");
    expect(paper.paragraphs.map((p) => p.text)).toEqual([
      "残月悬在天边。",
      "他站在窗前。",
    ]);
  });

  it("标题只有章号时不重复显示", () => {
    const paper = paperFromText("chapters/第一章.md", "# 第一章\n\n正文。");
    expect(paper.no).toBe("第一章");
    expect(paper.title).toBe("第一章");
    expect(paper.paragraphs).toHaveLength(1);
  });

  it("没有标题时整篇都是正文，章名取自文件名", () => {
    const paper = paperFromText(
      "chapters/第三章.md",
      "裴照走进崇仁坊。\n\n听见更鼓。",
    );
    expect(paper.no).toBe("第三章");
    expect(paper.title).toBe("第三章");
    expect(paper.paragraphs).toHaveLength(2);
  });

  it("文件名没有章号：章名为“当前章节”，标题取文件名", () => {
    const paper = paperFromText("chapters/序章.md", "很久以前。");
    expect(paper.no).toBe("当前章节");
    expect(paper.title).toBe("序章");
  });

  it("阿拉伯数字章号", () => {
    expect(paperFromText("chapters/第3章.md", "x").no).toBe("第3章");
    expect(paperFromText("chapters/03-坊门.md", "x").no).toBe("第3章");
  });

  it("带 CRLF 换行也能正确分段", () => {
    const paper = paperFromText("chapters/第一章.md", "甲\r\n\r\n乙\r\n\r\n丙");
    expect(paper.paragraphs.map((p) => p.text)).toEqual(["甲", "乙", "丙"]);
  });

  it("记录路径（统一为正斜杠）与修改时间", () => {
    const paper = paperFromText("chapters\\第一章.md", "x", { mtimeMs: 123 });
    expect(paper.path).toBe("chapters/第一章.md");
    expect(paper.mtimeMs).toBe(123);
  });

  it("多行的首块即使以 # 开头也不当作标题吞掉", () => {
    const paper = paperFromText(
      "chapters/第一章.md",
      "# 标题\n紧接着的正文\n\n第二段",
    );
    expect(paper.paragraphs[0]?.text).toContain("紧接着的正文");
  });

  it("空文件得到空段落", () => {
    expect(paperFromText("chapters/第一章.md", "").paragraphs).toEqual([]);
  });
});

describe("pickActiveChapter", () => {
  it("没有章节返回 null", () => {
    expect(pickActiveChapter([], "chapters/第一章.md", null)).toBeNull();
  });
  it("显式指定且存在时优先", () => {
    expect(
      pickActiveChapter(list, "chapters/第三章.md", "chapters/第一章.md"),
    ).toBe("chapters/第三章.md");
  });
  it("指定的不存在时沿用当前正在看的", () => {
    expect(
      pickActiveChapter(list, "chapters/第九章.md", "chapters/第一章.md"),
    ).toBe("chapters/第一章.md");
  });
  it("当前的也被删除时，回到最近修改的章节", () => {
    expect(pickActiveChapter(list, null, "chapters/第九章.md")).toBe(
      "chapters/第二章.md",
    );
  });
  it("首次打开：最近修改的章节", () => {
    expect(pickActiveChapter(list)).toBe("chapters/第二章.md");
  });
});

describe("needsReload", () => {
  const loaded = { path: "chapters/第一章.md", mtimeMs: 1000 };
  it("同一文件、修改时间没变：不重读", () => {
    expect(needsReload(list[0], loaded)).toBe(false);
  });
  it("修改时间变了：重读", () => {
    expect(needsReload({ ...list[0]!, mtimeMs: 1500 }, loaded)).toBe(true);
  });
  it("换了文件或从未加载：重读", () => {
    expect(needsReload(list[1], loaded)).toBe(true);
    expect(needsReload(list[0], null)).toBe(true);
  });
  it("已加载但没有修改时间（来自事件）：重读以对齐磁盘", () => {
    expect(needsReload(list[0], { path: "chapters/第一章.md" })).toBe(true);
  });
  it("文件已不在列表中：不重读", () => {
    expect(needsReload(undefined, loaded)).toBe(false);
  });
  it("毫秒以下的浮点差异不触发重读", () => {
    expect(needsReload({ ...list[0]!, mtimeMs: 1000.4 }, loaded)).toBe(false);
  });
});

describe("neighborChapter", () => {
  it("上一章 / 下一章", () => {
    expect(neighborChapter(list, "chapters/第二章.md", -1)).toBe(
      "chapters/第一章.md",
    );
    expect(neighborChapter(list, "chapters/第二章.md", 1)).toBe(
      "chapters/第三章.md",
    );
  });
  it("越界与未知路径返回 undefined", () => {
    expect(neighborChapter(list, "chapters/第一章.md", -1)).toBeUndefined();
    expect(neighborChapter(list, "chapters/第三章.md", 1)).toBeUndefined();
    expect(neighborChapter(list, "chapters/未知.md", 1)).toBeUndefined();
    expect(neighborChapter(list, null, 1)).toBeUndefined();
  });
});

describe("chapterFromPrompt", () => {
  it.each([
    ["请评审第三章的一致性", "chapters/第三章.md"],
    ["全流程写第2章", "chapters/第二章.md"],
    ["把第 一 章润色一下", "chapters/第一章.md"],
  ])("%s", (prompt, expected) => {
    expect(chapterFromPrompt(prompt, list)).toBe(expected);
  });
  it("提到的章节不存在，或没提章节：undefined", () => {
    expect(chapterFromPrompt("写第九章", list)).toBeUndefined();
    expect(chapterFromPrompt("帮我想想结局", list)).toBeUndefined();
  });
});

describe("formatUpdated", () => {
  const now = new Date(2026, 9, 21, 15, 30).getTime();
  it("今天显示时间", () => {
    expect(formatUpdated(new Date(2026, 9, 21, 9, 5).getTime(), now)).toBe(
      "09:05 更新",
    );
  });
  it("更早显示日期", () => {
    expect(formatUpdated(new Date(2026, 9, 3, 9, 5).getTime(), now)).toBe(
      "10月3日更新",
    );
  });
});
