import { describe, expect, it } from "vitest";
import { analyzeStyle, splitSentences, styleBrief } from "./style-metrics.js";

// 用户指出的两段“AI味儿”样例
const AI_SAMPLE =
  "“面白，无须，个子不高，穿青。走路没声，像踩棉花。”掌柜压低声，“腰里挂个香囊，靛青底，香得怪，龙脑味，宫里才用得起的。”\n\n他默数昨夜那通更鼓，五下；数到第五下，日头正过坊墙。";

const HUMAN_LIKE =
  "裴照在桥头站了很久，直到卖胡饼的摊子收了棚，才想起自己一天没吃东西。他摸了摸怀里那张折过两次的纸，转身往坊里走，脚步比来时慢了许多，因为他已经隐约明白，这一趟查下去，谁也保不住。";

describe("splitSentences", () => {
  it("按句末标点与分号切句，忽略标题与空行", () => {
    expect(splitSentences("# 第一章\n\n他来了。你好吗？走吧；好")).toEqual([
      "他来了。",
      "你好吗？",
      "走吧",
      "好",
    ]);
  });
});

describe("analyzeStyle", () => {
  it("空文本不报错", () => {
    const report = analyzeStyle("");
    expect(report.metrics.characters).toBe(0);
    expect(report.flags).toEqual([]);
    expect(report.index).toBe(0);
  });

  it("识别清单式并列：面白，无须，个子不高，穿青", () => {
    const report = analyzeStyle(AI_SAMPLE);
    expect(report.metrics.listRuns).toBeGreaterThanOrEqual(1);
    expect(
      report.flags.find((f) => f.code === "list-run")?.examples[0],
    ).toContain("面白");
  });

  it("碎句连串：连续四句以上的短句", () => {
    const report = analyzeStyle(
      "他停下。看了看。没人。门开着。风很冷。他进去了，门在身后合上，屋里一点声响也没有。",
    );
    expect(report.metrics.shortRuns).toBe(1);
    expect(report.flags.some((f) => f.code === "short-run")).toBe(true);
  });

  it("对话来回不算碎句", () => {
    const report = analyzeStyle(
      "“有人吗？”他问。“没有。”她答。“真没有？”他又问。“没有。”她说。",
    );
    expect(report.metrics.shortRuns).toBe(0);
  });

  it("“不是……而是……”两次以上才标出", () => {
    expect(
      analyzeStyle("他不是怕死，而是怕无人知晓。").flags.some(
        (f) => f.code === "not-but",
      ),
    ).toBe(false);
    const two = analyzeStyle(
      "他不是怕死，而是怕无人知晓。那不是风声，而是更鼓。",
    );
    expect(two.metrics.notButCount).toBe(2);
    expect(two.flags.some((f) => f.code === "not-but")).toBe(true);
  });

  it("数字过密：精确计数多的文字被标出", () => {
    const text =
      "他数了五下，三步，两声，七盏灯，九扇门，四根柱，六道坎，八个人。";
    const report = analyzeStyle(text.repeat(14));
    expect(report.metrics.numbersPerThousand).toBeGreaterThan(8);
    expect(report.flags.some((f) => f.code === "number-density")).toBe(true);
  });

  it("比喻词过密", () => {
    const report = analyzeStyle(
      "像风，像雨，仿佛雾，如同夜，宛如梦，好似烟。".repeat(24),
    );
    expect(report.flags.some((f) => f.code === "simile-density")).toBe(true);
  });

  it("较平实的长句文字指标更低", () => {
    const ai = analyzeStyle(AI_SAMPLE);
    const human = analyzeStyle(HUMAN_LIKE);
    expect(human.index).toBeLessThan(ai.index);
    expect(human.metrics.avgSentenceLength).toBeGreaterThan(
      ai.metrics.avgSentenceLength,
    );
    expect(human.flags).toEqual([]);
  });

  it("句长统计", () => {
    const report = analyzeStyle("一二三。一二三四五六。");
    expect(report.metrics.sentences).toBe(2);
    expect(report.metrics.avgSentenceLength).toBe(4.5);
  });
});

describe("解释心理", () => {
  const NARRATED =
    "他知道这个人怕事。裴照心里清楚，坊正不会说实话。她害怕被人看出来。他明白这一步走错就回不了头。";
  it("叙述者点明心理的句子被计数并标出", () => {
    const report = analyzeStyle(NARRATED);
    expect(report.metrics.explainMind).toBe(4);
    expect(report.flags.some((f) => f.code === "explain-mind")).toBe(true);
  });

  it("引号里的对白不算", () => {
    const report = analyzeStyle(
      "“我知道你怕。”他说。“我明白，我心里清楚。”她答。“你觉得呢？”",
    );
    expect(report.metrics.explainMind).toBe(0);
  });

  it("用动作和对白露出心理的写法不被标出", () => {
    const report = analyzeStyle(
      "坊正把茶盏推远了半寸，没有看他。裴照问了第二遍，他才开口：“那晚我睡得早。”",
    );
    expect(report.metrics.explainMind).toBe(0);
    expect(report.flags.some((f) => f.code === "explain-mind")).toBe(false);
  });

  it("只有两处时不标出（偶尔点明是正常的）", () => {
    const report = analyzeStyle(
      "他知道这个人怕事。后来天黑了，他走了。她明白了。",
    );
    expect(report.flags.some((f) => f.code === "explain-mind")).toBe(false);
  });
});

describe("styleBrief", () => {
  it("没有标记时返回空字符串", () => {
    expect(styleBrief(analyzeStyle(HUMAN_LIKE))).toBe("");
  });
  it("列出被标出的原文，并要求保留情节", () => {
    const brief = styleBrief(analyzeStyle(AI_SAMPLE));
    expect(brief).toContain("面白");
    expect(brief).toContain("不改变情节");
  });
});
