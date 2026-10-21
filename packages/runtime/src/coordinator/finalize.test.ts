import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  projectFacts,
  projectFinalized,
  projectSummaries,
} from "@wordhub/contracts";
import { WordHubStore } from "@wordhub/store";
import { describe, expect, it } from "vitest";
import { fixture, waitFor } from "./test-helpers.js";

const CHAPTER = "老周倒在质库后墙下，再没有起来。\n";

/** 观察者：先提一条事实，再写摘要，最后收尾；评审：说明无矛盾。 */
const script = (context: {
  messages: Array<{ role: string; content: unknown }>;
}) => {
  const text = JSON.stringify(context.messages);
  if (text.includes("任务角色：review"))
    return fauxAssistantMessage("五类核验均无矛盾。", { stopReason: "stop" });
  const calls = context.messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.content as Array<{ type: string }>)
    .filter((block) => block.type === "toolCall").length;
  if (calls === 0)
    return fauxAssistantMessage(
      fauxToolCall("fact_propose", {
        kind: "character_state",
        subject: "老周",
        statement: "老周在质库后墙死亡",
        chapter: "chapters/第五章.md",
        quote: "老周倒在质库后墙下",
      }),
      { stopReason: "toolUse" },
    );
  if (calls === 1)
    return fauxAssistantMessage(
      fauxToolCall("chapter_summarize", {
        chapter: "chapters/第五章.md",
        summary: "老周死于质库后墙。",
      }),
      { stopReason: "toolUse" },
    );
  return fauxAssistantMessage("已抽取事实并写好摘要。", {
    stopReason: "stop",
  });
};

async function projectEvents(root: string) {
  const projects = JSON.parse(
    await (await import("node:fs/promises")).readFile(
      path.join(root, "store", "projects.json"),
      "utf8",
    ),
  ) as Array<{ id: string }>;
  const projectId = projects[0]?.id as string;
  const store = new WordHubStore(
    path.join(root, "store", "projects", projectId),
  );
  return store.listEvents(projectId);
}

describe("定稿动作", () => {
  it("定稿：观察者抽取待确认事实并写摘要，记录定稿，链路可回放", async () => {
    const f = await fixture(script as never);
    try {
      await mkdir(path.join(f.project, "chapters"), { recursive: true });
      await writeFile(
        path.join(f.project, "chapters/第五章.md"),
        CHAPTER,
        "utf8",
      );
      await f.executor.handle({
        type: "run",
        runId: "fin1",
        prompt: "定稿 chapters/第五章.md",
        projectPath: f.project,
        mode: "mock",
      });
      await waitFor(() =>
        f.messages.some((m) => m.type === "workflow.finished"),
      );
      const events = await projectEvents(f.root);
      const facts = projectFacts(events);
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({
        status: "proposed",
        subject: "老周",
        chapter: "chapters/第五章.md",
      });
      expect(projectSummaries(events)[0]?.text).toBe("老周死于质库后墙。");
      expect([...projectFinalized(events)]).toEqual(["chapters/第五章.md"]);
      const types = events.map((e) => e.type);
      expect(types.indexOf("fact.proposed")).toBeLessThan(
        types.indexOf("chapter.finalized"),
      );
      // 默认不自动评审
      expect(
        f.messages
          .filter((m) => m.type === "run.started" && m.agentId)
          .map((m) => m.agentId),
      ).toEqual(["observer"]);
    } finally {
      f.executor.close();
    }
  });

  it("“定稿第五章”也能找到章节文件", async () => {
    const f = await fixture(script as never);
    try {
      await mkdir(path.join(f.project, "chapters"), { recursive: true });
      await writeFile(
        path.join(f.project, "chapters/第五章.md"),
        CHAPTER,
        "utf8",
      );
      await f.executor.handle({
        type: "run",
        runId: "fin2",
        prompt: "定稿第五章",
        projectPath: f.project,
        mode: "mock",
      });
      await waitFor(() =>
        f.messages.some((m) => m.type === "workflow.finished"),
      );
      expect([...projectFinalized(await projectEvents(f.root))]).toEqual([
        "chapters/第五章.md",
      ]);
    } finally {
      f.executor.close();
    }
  });

  it("打开“定稿后自动评审”后，观察者之后接着评审", async () => {
    const f = await fixture(script as never);
    try {
      await mkdir(path.join(f.project, "chapters"), { recursive: true });
      await writeFile(
        path.join(f.project, "chapters/第五章.md"),
        CHAPTER,
        "utf8",
      );
      await writeFile(
        path.join(f.project, ".wordhub/preferences.json"),
        JSON.stringify({ autoReviewOnFinalize: true }),
        "utf8",
      );
      await f.executor.handle({
        type: "run",
        runId: "fin3",
        prompt: "定稿 chapters/第五章.md",
        projectPath: f.project,
        mode: "mock",
      });
      await waitFor(() =>
        f.messages.some((m) => m.type === "workflow.finished"),
      );
      expect(
        f.messages
          .filter((m) => m.type === "run.started" && m.agentId)
          .map((m) => m.agentId),
      ).toEqual(["observer", "reviewer"]);
    } finally {
      f.executor.close();
    }
  });

  it("找不到章节文件时不记录定稿", async () => {
    const f = await fixture(script as never);
    try {
      await f.executor.handle({
        type: "run",
        runId: "fin4",
        prompt: "定稿第九章",
        projectPath: f.project,
        mode: "mock",
      });
      await waitFor(() =>
        f.messages.some(
          (m) => m.type === "workflow.finished" || m.type === "workflow.failed",
        ),
      );
      expect([...projectFinalized(await projectEvents(f.root))]).toEqual([]);
    } finally {
      f.executor.close();
    }
  });
});
