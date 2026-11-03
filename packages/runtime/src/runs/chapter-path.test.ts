import { describe, expect, it } from "vitest";
import { assertChapterPath } from "./dispatcher.js";

describe("渲染端章节写入路径", () => {
  it("只接受 chapters/ 下的 Markdown 文件", () => {
    expect(() => assertChapterPath("chapters/第一章.md")).not.toThrow();
    expect(() => assertChapterPath("chapters\\第二章.md")).not.toThrow();
    expect(() => assertChapterPath("chapters/第三章.markdown")).not.toThrow();
  });

  it("拒绝设定、偏好、越界和子目录路径", () => {
    for (const bad of [
      ".wordhub/bible/setting.md",
      ".wordhub/preferences.json",
      "chapters/../.wordhub/bible/outline.md",
      "../outside.md",
      "chapters/sub/第一章.md",
      "chapters/第一章.txt",
      "README.md",
      "",
    ])
      expect(() => assertChapterPath(bad), bad).toThrow();
  });
});
