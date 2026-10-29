import { describe, expect, it } from "vitest";
import { outlineForChapter } from "./project.js";

const GENERATED = `# 大纲

## 全书结构
- 第一幕（1–3）：起。

## 逐章大纲

### 第1章 更鼓初响
- 目标：建立裴照身份。
- 关键事件：发现一具尸首。
- 章末悬念：纸角写“宫门不是门”。

### 第2章 坊门落锁后
- 目标：确认旧案未结。
- 章末悬念：拓下鱼符。

### 第3章 违夜
- 目标：拿到物证。

## 贯穿悬念线与伏笔回收计划
- 伏笔回收：第1章“宫门不是门”指向门籍被改。
`;

describe("outlineForChapter", () => {
  it("模型生成的分级大纲：取出该章标题下的整段，而不是只取标题行", () => {
    const text = outlineForChapter(GENERATED, 2);
    expect(text).toContain("第2章 坊门落锁后");
    expect(text).toContain("确认旧案未结");
    expect(text).toContain("拓下鱼符");
    expect(text).not.toContain("拿到物证");
    expect(text).not.toContain("更鼓初响");
  });

  it("最后一章在下一个更高级标题处结束，不吞并后面的伏笔计划", () => {
    const text = outlineForChapter(GENERATED, 3);
    expect(text).toContain("拿到物证");
    expect(text).not.toContain("伏笔回收");
  });

  it("正文里提到第1章的伏笔行不会混进第1章的段落之外", () => {
    const text = outlineForChapter(GENERATED, 1);
    expect(text).toContain("发现一具尸首");
    expect(text).not.toContain("指向门籍被改");
  });

  it("中文章号标题", () => {
    expect(
      outlineForChapter(
        "### 第三章 违夜\n- 目标：A\n### 第四章 X\n- 目标：B",
        3,
      ),
    ).toBe("### 第三章 违夜\n- 目标：A");
  });

  it("单行式大纲（每章一行）仍然只取该行", () => {
    expect(outlineForChapter("# 大纲\n第2章：旧案\n第3章：宫门\n", 2)).toBe(
      "第2章：旧案",
    );
  });

  it("兼容有序列表、加粗标题和复杂中文章号", () => {
    const text = outlineForChapter(
      "## 逐章大纲\n1. **第十二章 旧案回响**\n   - 目标：取回账册。\n   - 事件：坊正改口。\n2. **第一百零五章 尾声**\n   - 目标：收束。\n## 伏笔计划\n- 第十二章留下的账册在此回收。",
      12,
    );
    expect(text).toContain("第十二章 旧案回响");
    expect(text).toContain("坊正改口");
    expect(text).not.toContain("第一百零五章");
    expect(text).not.toContain("伏笔计划");
    expect(
      outlineForChapter("### 第一百零五章 尾声\n- 目标：收束。", 105),
    ).toContain("目标：收束");
    expect(
      outlineForChapter(
        "## 逐章大纲\n1. **第一章 开端**\n   - 目标：起笔。\n## 伏笔计划\n- 第一章留下线索。",
        1,
      ),
    ).not.toContain("伏笔计划");
  });

  it("没有章节标题时退回逐行匹配，没提章号时返回全文", () => {
    expect(outlineForChapter("故事线：见第5章的转折\n其他", 5)).toBe(
      "故事线：见第5章的转折",
    );
    expect(outlineForChapter("全文", undefined)).toBe("全文");
  });
});
