import { mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { WordHubStore } from "@wordhub/store";
import { describe, expect, it } from "vitest";
import { createGraphService } from "./service.js";

async function setup(answer: string, captured: string[] = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-graph-svc-"));
  const folder = path.join(root, "长安夜");
  await mkdir(folder, { recursive: true });
  const store = new WordHubStore(path.join(root, "store"));
  const project = store.createProject({ name: "长安夜", folderPath: folder });
  const session = store.createSession({ projectId: project.id, title: "s" });
  store.startRun({
    projectId: project.id,
    sessionId: session.id,
    runId: "r1",
    prompt: "x",
  });
  let n = 0;
  const emit = (type: string, payload: Record<string, unknown>) =>
    store.appendEvent({
      id: `e${++n}`,
      schemaVersion: 1,
      occurredAt: new Date(Date.now() + n * 1000).toISOString(),
      projectId: project.id,
      sessionId: session.id,
      runId: "r1",
      type,
      actor: { type: "agent", id: "observer" },
      payload,
    } as never);
  const confirmed = (
    id: string,
    chapter: string,
    kind: string,
    subject: string,
    extra: Record<string, unknown> = {},
  ) => {
    emit("fact.proposed", {
      factId: id,
      kind,
      subject,
      statement: `${subject}的${kind}`,
      chapter: `chapters/${chapter}.md`,
      quote: `${id}原文`,
      ...extra,
    });
    emit("fact.confirmed", { factId: id });
  };
  confirmed("a", "第一章", "relation", "裴照", {
    object: "老周",
    relation: "旧识",
  });
  confirmed("b", "第三章", "relation", "裴照", {
    object: "苏晚",
    relation: "同伴",
  });
  confirmed("c", "第十章", "relation", "苏晚", {
    object: "裴照",
    relation: "仇敌",
  });

  const faux = fauxProvider({
    provider: "deepseek",
    models: [{ id: "deepseek-flash", reasoning: true }],
  });
  faux.setResponses([
    (context) => {
      const first = context.messages[0] as { content?: unknown };
      captured.push(typeof first.content === "string" ? first.content : "");
      return fauxAssistantMessage(answer, { stopReason: "stop" });
    },
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const service = createGraphService({
    projectService: {
      recent: () => [{ id: project.id, name: "长安夜", folderPath: folder }],
      store: async () => store,
    } as never,
    modelSettings: {
      resolve: async () => ({
        ref: { provider: "deepseek", id: "deepseek-flash", reasoning: "low" },
      }),
    } as never,
    models,
    mockModels: models,
    assertAuth: async () => undefined,
  });
  return { service, project, folder };
}

describe("graph service：采访", () => {
  it("模型只看到截至所选章节的事实；回答带依据与越界提示", async () => {
    const captured: string[] = [];
    const t = await setup("我和苏晚一起走的[F2]，旧识老周[F1]。", captured);
    const result = await t.service.interview({
      projectId: t.project.id,
      node: "裴照",
      chapter: "chapters/第三章.md",
      mode: "character",
      question: "你怎么看老周？",
      history: [],
      runMode: "live",
    });
    expect(captured[0]).toContain("同伴");
    expect(captured[0]).not.toContain("仇敌");
    expect(result.basis.map((b) => b.ref)).toEqual(["F2", "F1"]);
    expect(result.warnings).toEqual([]);
    expect(result.usage.total).toBeGreaterThanOrEqual(0);
  });

  it("早一章采访时，回答里的后来人物被标为越界", async () => {
    const t = await setup("我认得老周[F1]，也认识苏晚。");
    const result = await t.service.interview({
      projectId: t.project.id,
      node: "裴照",
      chapter: "chapters/第一章.md",
      mode: "character",
      question: "你认识谁？",
      history: [],
    });
    expect(result.warnings.join()).toContain("苏晚");
  });

  it("空问题、过长问题、不存在的人物都被明确拒绝", async () => {
    const t = await setup("x");
    const base = {
      projectId: t.project.id,
      node: "裴照",
      chapter: "chapters/第三章.md",
      mode: "character" as const,
      history: [],
    };
    await expect(
      t.service.interview({ ...base, question: "  " }),
    ).rejects.toThrow(/问题/u);
    await expect(
      t.service.interview({ ...base, question: "问".repeat(1001) }),
    ).rejects.toThrow(/太长/u);
    await expect(
      t.service.interview({ ...base, node: "无名氏", question: "你好" }),
    ).rejects.toThrow(/还没有已确认的人物/u);
  });

  it("保存采访为 Markdown，文件名里的路径字符被清掉，落在 .wordhub/graph/interviews 下", async () => {
    const t = await setup("x");
    const saved = await t.service.interviewSave({
      projectId: t.project.id,
      node: "../裴照/..",
      chapter: "chapters/第三章.md",
      mode: "character",
      turns: [
        { role: "user", text: "你好" },
        {
          role: "character",
          text: "你好[F1]",
          basis: ["第一章：裴照认识老周"],
        },
      ],
    });
    expect(saved.path.startsWith(".wordhub/graph/interviews/")).toBe(true);
    const dir = path.join(t.folder, ".wordhub", "graph", "interviews");
    expect(await readdir(dir)).toHaveLength(1);
    const text = await readFile(path.join(t.folder, saved.path), "utf8");
    expect(text).toContain("**作者**：你好");
    expect(text).toContain("依据：第一章：裴照认识老周");
    expect(saved.path).not.toContain("..");
    await expect(
      t.service.interviewSave({
        projectId: t.project.id,
        node: "裴照",
        chapter: "chapters/第三章.md",
        mode: "character",
        turns: [],
      }),
    ).rejects.toThrow(/没有对话/u);
  });
});

describe("graph service：推演", () => {
  const base = (t: Awaited<ReturnType<typeof setup>>) => ({
    projectId: t.project.id,
    chapter: "chapters/第三章.md",
    premise: "苏晚发现了密信",
    participants: ["裴照", "苏晚"],
  });

  it("估算：调用次数与 token；人数不足被拒绝", async () => {
    const t = await setup("x");
    const estimate = await t.service.simulateEstimate({
      ...base(t),
      rounds: 2,
    });
    expect(estimate.calls).toBe(5);
    expect(estimate.inputTokens).toBeGreaterThan(0);
    await expect(
      t.service.simulateEstimate({
        ...base(t),
        participants: ["裴照"],
        rounds: 2,
      }),
    ).rejects.toThrow(/人物/u);
  });

  it("一步：人物只看到公开行动，看不到别人的心思；设定与局面进入提示", async () => {
    const captured: string[] = [];
    const t = await setup("【行动】我拔出刀。\n【心思】我要试探他。", captured);
    const result = await t.service.simulateStep({
      ...base(t),
      node: "裴照",
      round: 2,
      rounds: 3,
      log: [
        { round: 1, name: "苏晚", action: "递出密信", intent: "其实想栽赃" },
      ],
    });
    expect(result.action).toBe("我拔出刀。");
    expect(result.intent).toBe("我要试探他。");
    expect(captured[0]).toContain("苏晚发现了密信");
    expect(captured[0]).toContain("第1轮 · 苏晚：递出密信");
    expect(captured[0]).not.toContain("栽赃");
    expect(captured[0]).not.toContain("仇敌");
  });

  it("一步：行动里提到起点之后才出现的人物会被警告", async () => {
    const t = await setup("【行动】我去找阿福。【心思】无");
    // 阿福不是已确认人物；换成第十章才出现的人物不存在，这里用起点第一章，苏晚还没出现
    const result = await t.service.simulateStep({
      projectId: t.project.id,
      chapter: "chapters/第一章.md",
      participants: ["裴照", "老周"],
      node: "裴照",
      round: 1,
      rounds: 1,
      log: [],
    });
    expect(result.warnings).toEqual([]);
    const t2 = await setup("【行动】我去找苏晚。【心思】无");
    const leaked = await t2.service.simulateStep({
      projectId: t2.project.id,
      chapter: "chapters/第一章.md",
      participants: ["裴照", "老周"],
      node: "裴照",
      round: 1,
      rounds: 1,
      log: [],
    });
    expect(leaked.warnings.join()).toContain("苏晚");
  });

  it("一步：不在名单的人物、越界轮次、过长记录被拒绝", async () => {
    const t = await setup("【行动】x");
    await expect(
      t.service.simulateStep({
        ...base(t),
        node: "老周",
        round: 1,
        rounds: 2,
        log: [],
      }),
    ).rejects.toThrow(/不在参与名单/u);
    await expect(
      t.service.simulateStep({
        ...base(t),
        node: "裴照",
        round: 3,
        rounds: 2,
        log: [],
      }),
    ).rejects.toThrow(/轮次/u);
    await expect(
      t.service.simulateStep({
        ...base(t),
        node: "裴照",
        round: 1,
        rounds: 2,
        log: [{ round: 1, name: "苏晚", action: "长".repeat(2001) }],
      }),
    ).rejects.toThrow(/过长/u);
  });

  it("报告与保存：非正史标记、写在 .wordhub/graph/branches，不动章节", async () => {
    const t = await setup("## 推演小结\n局面升级。");
    const report = await t.service.simulateReport({
      ...base(t),
      log: [
        { round: 1, name: "裴照", action: "拔刀", intent: "试探" },
        { round: 1, name: "苏晚", action: "后退" },
      ],
    });
    expect(report.report).toContain("推演小结");
    const saved = await t.service.simulateSave({
      ...base(t),
      rounds: 1,
      log: [{ round: 1, name: "裴照", action: "拔刀", intent: "试探" }],
      report: report.report,
    });
    expect(saved.path.startsWith(".wordhub/graph/branches/")).toBe(true);
    const text = await readFile(path.join(t.folder, saved.path), "utf8");
    expect(text).toContain("非正史");
    expect(text).toContain("苏晚发现了密信");
    expect(text).toContain("- 心思：试探");
    expect(await readdir(t.folder)).toEqual([".wordhub"]);
    await expect(
      t.service.simulateSave({ ...base(t), rounds: 1, log: [], report: "x" }),
    ).rejects.toThrow(/没有可保存/u);
  });
});
