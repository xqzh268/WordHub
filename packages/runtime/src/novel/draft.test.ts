import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { WordHubStore } from "@wordhub/store";
import { describe, expect, it } from "vitest";
import { createRunExecutor } from "../runs/executor.js";
import { DRAFT_FILES, buildDraftUserPrompt, parseDraft } from "./draft.js";
import { buildBibleArtifacts, templateDocuments } from "./intake.js";

const GOOD = `=====FILE: outline.md=====
# 大纲
一句话：不良人裴照追查宫门旧案。第一章 暮鼓：裴照夜巡崇仁坊，发现一具无名尸体。
=====FILE: characters.md=====
# 人物档案
裴照：不良人，左撇子，惯用横刀，三十岁，沉默寡言，执拗，办案时喜欢先在坊间走一圈再动手。
=====FILE: setting.md=====
# 设定词典
崇仁坊：长安东市旁的里坊。不良人：唐代缉捕盗贼的差役。必须出现：更鼓。
=====FILE: style.md=====
# 文风基准
第三人称有限视角，冷峻克制，短句为主，多用动作与环境暗示心理，对话简短，少用形容词。`;

describe("parseDraft", () => {
  it("按分隔行切出四份文档", () => {
    const docs = parseDraft(GOOD);
    expect(Object.keys(docs)).toEqual(DRAFT_FILES.map((f) => f.file));
    expect(docs["characters.md"]).toContain("左撇子");
    expect(docs["outline.md"]).not.toContain("=====FILE");
  });

  it("忽略分隔行之前的前言", () => {
    expect(parseDraft(`好的，下面是文档：\n${GOOD}`)["style.md"]).toContain(
      "第三人称",
    );
  });

  it("缺少文档时报出缺哪几份", () => {
    expect(() =>
      parseDraft(GOOD.split("=====FILE: style.md")[0] ?? ""),
    ).toThrow(/style\.md/u);
  });

  it("内容过短视为失败", () => {
    expect(() =>
      parseDraft(
        GOOD.replace(/# 文风基准\n.*$/su, "=====FILE: style.md=====\n略"),
      ),
    ).toThrow(/style\.md/u);
  });

  it("没有任何分隔行时失败", () => {
    expect(() => parseDraft("这是一段没有格式的回答。")).toThrow();
  });
});

describe("buildDraftUserPrompt", () => {
  it("带上作者给出的信息，未提供的项提示合理补全", () => {
    const text = buildDraftUserPrompt({
      premise: "唐代悬疑",
      protagonist: "不良人裴照",
      world: "跳过",
    });
    expect(text).toContain("主角：不良人裴照");
    expect(text).toContain("世界与时代：（作者未提供，请合理补全）");
    expect(text).toContain("核心冲突：（作者未提供，请合理补全）");
  });
});

describe("buildBibleArtifacts", () => {
  const base = {
    intakeId: "i",
    runId: "r",
    sourcePrompt: "写一部唐代悬疑",
    answers: { premise: "唐代悬疑", protagonist: "裴照", conflict: "旧案" },
    confirmed: false,
  };
  it("有模型草稿时写草稿内容", () => {
    const files = buildBibleArtifacts({
      ...base,
      draft: { documents: parseDraft(GOOD), source: "model" },
    });
    expect(files[".wordhub/bible/outline.md"]).toContain("第一章 暮鼓");
    expect(files[".wordhub/bible/writing-plan.json"]).toContain("sourcePrompt");
  });
  it("没有草稿时回退到问答模板", () => {
    const files = buildBibleArtifacts(base);
    expect(files[".wordhub/bible/characters.md"]).toContain("裴照");
    expect(templateDocuments(base.answers)["outline.md"]).toContain("旧案");
  });
});

// ── 端到端：回答完最后一题后由模型生成草稿，确认后才写入 ───────────
async function setup(
  responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0],
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-draft-"));
  const projectPath = path.join(root, "长安夜");
  await mkdir(projectPath, { recursive: true });
  const faux = fauxProvider({
    provider: "deepseek",
    models: [{ id: "deepseek-v4-pro", reasoning: true }],
  });
  faux.setResponses(responses);
  const mockModels = createModels();
  mockModels.setProvider(faux.provider);
  const messages: Array<Record<string, unknown>> = [];
  const executor = createRunExecutor({
    storageRoot: path.join(root, "store"),
    workspaceRoot: process.cwd(),
    mockModels,
    post: (message) => messages.push(message),
  });
  await executor.ready;
  const runId = "run_draft";
  await executor.handle({
    type: "run",
    runId,
    prompt: "写一部唐代悬疑短篇，主角是不良人裴照",
    rawPrompt: "写一部唐代悬疑短篇，主角是不良人裴照",
    agentId: "planner",
    projectPath,
    mode: "mock",
  });
  const deadline = Date.now() + 5000;
  while (
    !messages.some((m) => m.type === "run.finished" && m.runId === runId) &&
    Date.now() < deadline
  )
    await new Promise((r) => setTimeout(r, 10));
  const projects = JSON.parse(
    await readFile(path.join(root, "store", "projects.json"), "utf8"),
  ) as Array<{ id: string }>;
  const projectId = projects[0]?.id as string;
  const store = new WordHubStore(
    path.join(root, "store", "projects", projectId),
  );
  const sessionId = store.listSessions(projectId)[0]?.id as string;
  const intakeId = `intake_${runId}`;
  const send = (key: string, value: string) =>
    executor.handle({
      type: "intake.answer",
      projectId,
      sessionId,
      intakeId,
      questionId: `${intakeId}:${key}`,
      value,
      requestId: `a-${key}-${Math.random()}`,
      mode: "mock",
    });
  const answerAll = async () => {
    await send("conflict", "查清一桩牵连宫门的旧案");
    for (const key of [
      "world",
      "viewpointTone",
      "theme",
      "audience",
      "chapterCount",
      "mustInclude",
      "forbidden",
    ])
      await send(key, "跳过");
  };
  const events = () =>
    store.listEvents(projectId, sessionId).map((e) => ({
      type: e.type,
      payload: e.payload as Record<string, unknown>,
    }));
  const settle = async (type: string, count = 1) => {
    const end = Date.now() + 5000;
    while (
      events().filter((e) => e.type === type).length < count &&
      Date.now() < end
    )
      await new Promise((r) => setTimeout(r, 20));
  };
  const confirm = () =>
    executor.handle({
      type: "intake.confirm",
      projectId,
      sessionId,
      intakeId,
      requestId: "confirm",
      mode: "mock",
    });
  return {
    messages,
    projectPath,
    send,
    answerAll,
    events,
    settle,
    confirm,
    executor,
    store,
  };
}

describe("纲领草稿生成（模型）", () => {
  it("最后一题回答后生成草稿并询问确认；确认前不写任何文件，确认后写入模型内容", async () => {
    const t = await setup([fauxAssistantMessage(GOOD, { stopReason: "stop" })]);
    await t.answerAll();
    await t.settle("intake.draft.ready");
    const types = t.events().map((e) => e.type);
    expect(types).toContain("intake.draft.started");
    const ready = t.events().find((e) => e.type === "intake.draft.ready");
    expect(ready?.payload.source).toBe("model");
    expect(
      (ready?.payload.documents as Record<string, string>)["outline.md"],
    ).toContain("暮鼓");
    // 草稿就绪之后才出现确认问题
    expect(types.indexOf("intake.draft.ready")).toBeLessThan(
      types.lastIndexOf("intake.question"),
    );
    await expect(
      readFile(
        path.join(t.projectPath, ".wordhub", "bible", "outline.md"),
        "utf8",
      ),
    ).rejects.toThrow();

    await t.confirm();
    expect(
      await readFile(
        path.join(t.projectPath, ".wordhub", "bible", "outline.md"),
        "utf8",
      ),
    ).toContain("第一章 暮鼓");
    expect(
      await readFile(
        path.join(t.projectPath, ".wordhub", "bible", "characters.md"),
        "utf8",
      ),
    ).toContain("左撇子");
    t.executor.close();
  });

  it("格式错误会重试一次，仍失败则回退到问答模板并记录失败原因", async () => {
    const t = await setup([
      fauxAssistantMessage("我来写一下。", { stopReason: "stop" }),
      fauxAssistantMessage("还是没按格式。", { stopReason: "stop" }),
    ]);
    await t.answerAll();
    await t.settle("intake.draft.ready");
    expect(t.events().some((e) => e.type === "intake.draft.failed")).toBe(true);
    const ready = t.events().find((e) => e.type === "intake.draft.ready");
    expect(ready?.payload.source).toBe("template");
    expect(String(ready?.payload.error)).toContain("缺少");
    await t.confirm();
    expect(
      await readFile(
        path.join(t.projectPath, ".wordhub", "bible", "outline.md"),
        "utf8",
      ),
    ).toContain("旧案");
    t.executor.close();
  });

  it("第一次格式错误、第二次成功：不回退", async () => {
    const t = await setup([
      fauxAssistantMessage("格式不对", { stopReason: "stop" }),
      fauxAssistantMessage(GOOD, { stopReason: "stop" }),
    ]);
    await t.answerAll();
    await t.settle("intake.draft.ready");
    expect(t.events().some((e) => e.type === "intake.draft.failed")).toBe(
      false,
    );
    expect(
      t.events().find((e) => e.type === "intake.draft.ready")?.payload.source,
    ).toBe("model");
    t.executor.close();
  });

  it("选择“重新生成”会再生成一版草稿", async () => {
    const second = GOOD.replace("暮鼓", "残月");
    const t = await setup([
      fauxAssistantMessage(GOOD, { stopReason: "stop" }),
      fauxAssistantMessage(second, { stopReason: "stop" }),
    ]);
    await t.answerAll();
    await t.settle("intake.draft.ready");
    await t.send("confirm", "重新生成");
    await t.settle("intake.draft.ready", 2);
    const readies = t.events().filter((e) => e.type === "intake.draft.ready");
    expect(readies).toHaveLength(2);
    await t.confirm();
    expect(
      await readFile(
        path.join(t.projectPath, ".wordhub", "bible", "outline.md"),
        "utf8",
      ),
    ).toContain("残月");
    t.executor.close();
  });

  it("草稿生成期间不允许确认", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = await setup([
      async () => {
        await gate;
        return fauxAssistantMessage(GOOD, { stopReason: "stop" });
      },
    ]);
    await t.answerAll();
    await t.confirm();
    expect(
      t.messages.some(
        (m) =>
          m.type === "response" &&
          m.ok === false &&
          String(m.error).includes("草稿还在生成"),
      ),
    ).toBe(true);
    release();
    await t.settle("intake.draft.ready");
    t.executor.close();
  });
});
