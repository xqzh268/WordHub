import type { PaperParagraph, Session } from "../state/types";

/** 设计预览数据：仅在 `?demo=1`（或 WORDHUB_DEMO=1）时载入，用于检视各种群聊与纸面状态。 */

const t = (hh: number, mm: number): number =>
  new Date(2026, 9, 3, hh, mm).getTime();

export const DEMO_PROJECT = { name: "长安夜", folder: "D:\\写作\\长安夜" };

export const demoSessions = (): Session[] => [
  {
    id: "s-ch3",
    title: "第三章 · 坊门",
    items: [
      {
        kind: "user",
        id: "d1",
        at: t(9, 41),
        text: "@纲领 帮我规划一部唐代悬疑短篇《长安夜》，主角是个不良人，大约五章。",
      },
      {
        kind: "agent",
        id: "d2",
        at: t(9, 41),
        agentId: "planner",
        status: "done",
        tools: [
          {
            id: "d2t",
            name: "bible.read",
            label: "读取项目圣经",
            status: "done",
            durationMs: 320,
            detail: "项目圣经为空，将从零建立。",
          },
        ],
        text: "收到。动笔搭大纲之前，先确认三件事：\n\n1. 主角的核心驱动力——是复仇、赎罪，还是单纯的好奇？\n2. 基调偏冷硬写实，还是带一点志怪的朦胧？\n3. 结局倾向：真相大白，还是留一点余味？",
      },
      {
        kind: "user",
        id: "d3",
        at: t(9, 44),
        text: "冷硬写实。他在追查一桩旧案，结局要留一点余味。",
      },
      {
        kind: "agent",
        id: "d4",
        at: t(9, 45),
        agentId: "planner",
        status: "done",
        tools: [
          {
            id: "d4a",
            name: "doc.write",
            label: "写入大纲",
            status: "done",
            durationMs: 810,
            detail: "bible/outline.md · 五章",
          },
          {
            id: "d4b",
            name: "doc.write",
            label: "建立人物档案",
            status: "done",
            durationMs: 1240,
            detail: "bible/characters.md · 4 位人物",
          },
        ],
        text: "好。大纲已写入项目圣经（共五章），人物档案与设定词典同步建立。第三章《坊门》交给写手。",
      },
      {
        kind: "agent",
        id: "d5",
        at: t(9, 52),
        agentId: "writer",
        status: "done",
        tools: [
          {
            id: "d5a",
            name: "bible.read",
            label: "读取设定词典",
            status: "done",
            durationMs: 210,
          },
          {
            id: "d5b",
            name: "doc.read",
            label: "读取第二章结尾",
            status: "done",
            durationMs: 140,
          },
        ],
        text: "第三章开篇已落到纸面。结尾留了一处门槛上的划痕，供下一章接续。",
      },
      {
        kind: "agent",
        id: "d6",
        at: t(9, 55),
        agentId: "editor",
        status: "done",
        tools: [
          {
            id: "d6a",
            name: "doc.write",
            label: "改写第 2 段",
            status: "done",
            durationMs: 960,
          },
        ],
        text: "调整了第 2 段的断句，并把“守卫”统一为“武侯”。",
        edit: { label: "第 2 段 · 2 处改动" },
      },
      {
        kind: "thread",
        id: "d7",
        at: t(9, 58),
        from: "reviewer",
        to: "writer",
        round: 2,
        maxRounds: 2,
        severity: "blocking",
        claim:
          "第 3 章第 5 段写裴照“右手按住刀柄”，与设定集 char.peizhao.handedness（左撇子）冲突。",
        replies: [
          {
            agentId: "writer",
            text: "这是他受伤之后的状态——第二章结尾提到左臂被划伤，所以改用右手。",
          },
          {
            agentId: "reviewer",
            text: "第二章只写了“衣袖染血”，没有说明伤在左臂。证据不足，维持质询。",
          },
        ],
      },
      {
        kind: "approval",
        id: "d8",
        at: t(9, 59),
        title: "评审与写手未能达成一致",
        body: "已用尽 2 轮质询。请裁决第 5 段的写法，你的决定会写入事件日志，并作为之后的依据。",
        options: ["采纳评审意见", "采纳写手意见", "稍后处理"],
      },
      {
        kind: "approval",
        id: "d8b",
        at: t(9, 59),
        title: "Agent请求写入",
        body: "doc.write需要你的确认后才能继续。",
        path: "chapters/第四章.md",
        contentLength: 85,
        diff: { addedLines: 8, removedLines: 0 },
        // 故意包含一整行不含空格的长句和长路径，用来检验卡片内的自动折行。
        preview:
          "# 第四章 · 残月\n\n残月悬在天边，像被人咬去了一角的银盘。\n\n风从长街尽头卷来，掠过石阶上尚未干透的水痕，也掠过往事里那些再也回不去的人，吹得檐下的灯笼一盏接一盏地摇晃起来，光影在青砖上碎成一地。\n\n他站在窗前，久久未动。参见 .wordhub/bible/characters/裴照-完整人物档案-含童年经历与旧案线索.md",
        options: ["批准", "拒绝"],
      },
      {
        kind: "agent",
        id: "d9",
        at: t(10, 0),
        agentId: "observer",
        status: "thinking",
        text: "",
        tools: [
          {
            id: "d9a",
            name: "doc.read",
            label: "抽取第三章候选事实",
            status: "running",
          },
        ],
      },
    ],
  },
  { id: "s-char", title: "人物小传", items: [] },
  { id: "s-note", title: "读书札记", items: [] },
];

export const DEMO_CHAPTER: {
  no: string;
  page: number;
  title: string;
  paragraphs: PaperParagraph[];
} = {
  no: "第三章",
  page: 3,
  title: "坊门",
  paragraphs: [
    {
      id: "p1",
      text: "暮鼓三百声，坊门次第而闭。长安的夜便从这一刻起，分作了两半——一半在灯下，一半在灯影够不着的地方。",
    },
    {
      id: "p2",
      text: "裴照立在崇仁坊的坊门前，手里那枚铜鱼符被攥得发烫。守门的武侯认得他腰间的横刀，却不敢认他这个人：不良人的差事，向来是见不得光的。",
      author: "editor",
    },
    {
      id: "p3",
      text: "“里头死了人。”武侯压低了声音，“是个胡商，脖子上一道口子，血都没来得及流干。”",
    },
    {
      id: "p4",
      text: "裴照没有应声。他蹲下身，指腹抹过门槛上那道极浅的划痕——新的，木茬还泛着白。有人在坊门落锁之后，从里面出来过。",
      author: "writer",
    },
    {
      id: "p5",
      text: "他右手按住刀柄，缓缓起身。巷子深处传来一声瓦响，轻得像是猫，又不像。",
      flag: "reviewer",
    },
  ],
};
