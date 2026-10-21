import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { projectFacts, projectSummaries } from "@wordhub/contracts";
import { WordHubStore } from "@wordhub/store";
import { describe, expect, it } from "vitest";
import { collectProjectContextLayers } from "../context/project.js";
import type { AgentDefinition } from "../types.js";
import { projectTools } from "./project.js";

const agent = {
  name: "observer",
  displayName: "观察者",
  description: "测试",
  model: { provider: "deepseek", id: "deepseek-flash", reasoning: "low" },
  tools: ["fact.propose", "chapter.summarize", "doc.read"],
  write: "none",
  writeScopes: [],
  memoryScopes: { read: ["bible", "outline", "chapters"], write: [] },
  maxTurns: 8,
  source: "builtin",
  sourcePath: "observer",
  systemPrompt: "",
  version: "t",
} satisfies AgentDefinition;

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-facts-"));
  const projectPath = path.join(root, "长安夜");
  await mkdir(path.join(projectPath, "chapters"), { recursive: true });
  await mkdir(path.join(projectPath, ".wordhub", "bible"), { recursive: true });
  await writeFile(
    path.join(projectPath, "chapters", "第五章.md"),
    "老周倒在质库后墙下，再没有起来。\n",
    "utf8",
  );
  const store = new WordHubStore(path.join(root, "store"));
  const project = store.createProject({
    name: "长安夜",
    folderPath: projectPath,
  });
  const session = store.createSession({ projectId: project.id, title: "s" });
  store.startRun({
    projectId: project.id,
    sessionId: session.id,
    runId: "run1",
    prompt: "定稿",
  });
  const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const event = (type: string, payload: Record<string, unknown>) => {
    emitted.push({ type, payload });
    const id = `ev_${emitted.length}`;
    store.appendEvent({
      id,
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      projectId: project.id,
      sessionId: session.id,
      runId: "run1",
      type,
      actor: { type: "agent", id: "observer" },
      payload,
    } as never);
    return id;
  };
  const tools = projectTools({
    store,
    projectId: project.id,
    sessionId: session.id,
    runId: "run1",
    projectPath,
    agent,
    event,
    approved: new Map(),
  });
  return { projectPath, store, project, tools, emitted };
}

describe("fact.propose / chapter.summarize", () => {
  it("引文逐字出现在章节里才会记为待确认事实", async () => {
    const t = await setup();
    const runtime = t.tools as unknown as {
      tools: Array<{
        name: string;
        execute: (
          id: string,
          p: unknown,
        ) => Promise<{ content: { text: string }[] }>;
      }>;
    };
    const propose = runtime.tools.find((x) => x.name === "fact.propose");
    expect(propose).toBeTruthy();
    const ok = await propose?.execute("1", {
      kind: "character_state",
      subject: "老周",
      statement: "老周在质库后墙死亡",
      chapter: "chapters/第五章.md",
      quote: "老周倒在质库后墙下",
    });
    expect(ok?.content[0]?.text).toContain("factId");
    expect(t.emitted.filter((e) => e.type === "fact.proposed")).toHaveLength(1);

    await expect(
      propose?.execute("2", {
        kind: "character_state",
        subject: "老周",
        statement: "老周逃走了",
        chapter: "chapters/第五章.md",
        quote: "老周翻墙逃走了",
      }),
    ).rejects.toThrow(/逐字/u);
    expect(t.emitted.filter((e) => e.type === "fact.proposed")).toHaveLength(1);
  });

  it("相同事实重复提出只记一次", async () => {
    const t = await setup();
    const runtime = t.tools as unknown as {
      tools: Array<{
        name: string;
        execute: (id: string, p: unknown) => Promise<unknown>;
      }>;
    };
    const propose = runtime.tools.find((x) => x.name === "fact.propose");
    const input = {
      kind: "event",
      subject: "老周",
      statement: "老周死于质库后墙",
      chapter: "chapters/第五章.md",
      quote: "老周倒在质库后墙下",
    };
    await propose?.execute("1", input);
    await propose?.execute("2", input);
    expect(t.emitted.filter((e) => e.type === "fact.proposed")).toHaveLength(1);
    expect(projectFacts(t.store.listEvents(t.project.id))).toHaveLength(1);
  });

  it("出处必须是 chapters/ 下的章节", async () => {
    const t = await setup();
    const runtime = t.tools as unknown as {
      tools: Array<{
        name: string;
        execute: (id: string, p: unknown) => Promise<unknown>;
      }>;
    };
    await expect(
      runtime.tools
        .find((x) => x.name === "fact.propose")
        ?.execute("1", {
          kind: "term",
          subject: "鱼符",
          statement: "x",
          chapter: ".wordhub/bible/setting.md",
          quote: "任意的引文内容",
        }),
    ).rejects.toThrow(/chapters/u);
  });

  it("章节摘要记录为事件，同一章后写的覆盖先写的", async () => {
    const t = await setup();
    const runtime = t.tools as unknown as {
      tools: Array<{
        name: string;
        execute: (id: string, p: unknown) => Promise<unknown>;
      }>;
    };
    const summarize = runtime.tools.find((x) => x.name === "chapter.summarize");
    await summarize?.execute("1", {
      chapter: "chapters/第五章.md",
      summary: "初稿摘要",
    });
    await summarize?.execute("2", {
      chapter: "chapters/第五章.md",
      summary: "老周死了",
    });
    const list = projectSummaries(t.store.listEvents(t.project.id));
    expect(list).toHaveLength(1);
    expect(list[0]?.text).toBe("老周死了");
  });
});

describe("上下文：已确认事实与章节摘要", () => {
  it("只注入已确认、且在当前章之前的事实与摘要", async () => {
    const t = await setup();
    const emit = (type: string, payload: Record<string, unknown>) => {
      t.store.appendEvent({
        id: `x_${type}_${Math.random()}`,
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        projectId: t.project.id,
        sessionId: t.store.listSessions(t.project.id)[0]?.id,
        runId: "run1",
        type,
        actor: { type: "agent", id: "observer" },
        payload,
      } as never);
    };
    const fact = (id: string, chapter: string, subject: string) =>
      emit("fact.proposed", {
        factId: id,
        kind: "character_state",
        subject,
        statement: `${subject}死亡`,
        chapter,
        quote: `${subject}倒下了`,
      });
    fact("f5", "chapters/第五章.md", "老周");
    fact("f6", "chapters/第六章.md", "刘伯");
    fact("f7", "chapters/第七章.md", "段小乙");
    fact("f8", "chapters/第九章.md", "高敏");
    emit("fact.confirmed", { factId: "f5" });
    emit("fact.confirmed", { factId: "f6" });
    emit("fact.rejected", { factId: "f7" });
    emit("fact.confirmed", { factId: "f8" });
    emit("chapter.summary", {
      chapter: "chapters/第五章.md",
      text: "老周死于质库后墙。",
    });
    emit("chapter.summary", {
      chapter: "chapters/第九章.md",
      text: "不该出现的后文。",
    });

    const layers = await collectProjectContextLayers({
      store: t.store,
      projectId: t.project.id,
      projectPath: t.projectPath,
      prompt: "请评审第八章",
      agent,
    });
    const facts = layers.find((l) => l.id === "facts");
    expect(facts?.text).toContain("老周");
    expect(facts?.text).toContain("刘伯");
    expect(facts?.text).not.toContain("段小乙"); // 已驳回
    expect(facts?.text).not.toContain("高敏"); // 第 9 章在当前章之后
    expect(facts?.text).toContain("老周倒下了");
    const summaries = layers.find((l) => l.id === "summaries");
    expect(summaries?.text).toContain("老周死于质库后墙");
    expect(summaries?.text).not.toContain("不该出现的后文");
  });

  it("没有已确认事实时不增加任何层", async () => {
    const t = await setup();
    const layers = await collectProjectContextLayers({
      store: t.store,
      projectId: t.project.id,
      projectPath: t.projectPath,
      prompt: "请评审第八章",
      agent,
    });
    expect(layers.find((l) => l.id === "facts")).toBeUndefined();
    expect(layers.find((l) => l.id === "summaries")).toBeUndefined();
  });
});
