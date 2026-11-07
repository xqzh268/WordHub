import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { projectAliases, projectKnowledge } from "@wordhub/contracts";
import { WordHubStore } from "@wordhub/store";
import { describe, expect, it } from "vitest";
import { createLinkService } from "./links.js";

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-links-"));
  const store = new WordHubStore(path.join(root, "store"));
  const project = store.createProject({
    name: "长安夜",
    folderPath: path.join(root, "长安夜"),
  });
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
  const fact = (
    id: string,
    chapter: string,
    kind: string,
    subject: string,
    extra: Record<string, unknown> = {},
    decide: "fact.confirmed" | "fact.rejected" | null = "fact.confirmed",
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
    if (decide) emit(decide, { factId: id });
  };
  fact("a", "第一章", "character_state", "黑衣人");
  fact("b", "第三章", "relation", "萧某", { object: "裴照", relation: "师徒" });
  fact("c", "第三章", "event", "质库", {}, "fact.confirmed");
  fact("d", "第三章", "event", "质库", {}, null);
  const appended: string[] = [];
  const service = createLinkService({
    projectService: { store: async () => store } as never,
    append: (target, projectId, anchor, type, payload) => {
      appended.push(type);
      target.appendEvent({
        id: `u${appended.length}`,
        schemaVersion: 1,
        occurredAt: new Date(
          Date.now() + 100000 + appended.length,
        ).toISOString(),
        projectId,
        sessionId: anchor.sessionId,
        runId: anchor.runId,
        type,
        actor: { type: "user", id: "user" },
        payload,
      } as never);
    },
  });
  return {
    service,
    store,
    projectId: project.id,
    appended,
    events: () => store.listEvents(project.id),
  };
}
const ch3 = "chapters/第三章.md";

describe("别名合并", () => {
  it("建立、投影出来；同一别名不能重复建立，取消后可以重设", async () => {
    const t = await setup();
    const { aliasId } = await t.service.aliasLink({
      projectId: t.projectId,
      alias: "黑衣人",
      canonical: "萧某",
      chapter: ch3,
    });
    const links = projectAliases(t.events());
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      id: aliasId,
      alias: "黑衣人",
      canonical: "萧某",
      chapter: ch3,
    });
    await expect(
      t.service.aliasLink({
        projectId: t.projectId,
        alias: "黑衣人",
        canonical: "裴照",
      }),
    ).rejects.toThrow(/先取消/u);
    await t.service.aliasUnlink({ projectId: t.projectId, aliasId });
    expect(projectAliases(t.events())).toHaveLength(0);
    await t.service.aliasLink({
      projectId: t.projectId,
      alias: "黑衣人",
      canonical: "裴照",
    });
    expect(projectAliases(t.events())).toHaveLength(1);
  });

  it("校验：人物必须在图上、不能合并到自己、不能绕成圈、章节必须在时间轴上", async () => {
    const t = await setup();
    const base = { projectId: t.projectId };
    await expect(
      t.service.aliasLink({ ...base, alias: "无名氏", canonical: "萧某" }),
    ).rejects.toThrow(/没有人物/u);
    await expect(
      t.service.aliasLink({ ...base, alias: "黑衣人", canonical: "无名氏" }),
    ).rejects.toThrow(/没有人物/u);
    await expect(
      t.service.aliasLink({ ...base, alias: "萧某", canonical: "萧某" }),
    ).rejects.toThrow(/自己/u);
    await expect(
      t.service.aliasLink({
        ...base,
        alias: "黑衣人",
        canonical: "萧某",
        chapter: "chapters/没有.md",
      }),
    ).rejects.toThrow(/时间轴/u);
    await t.service.aliasLink({ ...base, alias: "黑衣人", canonical: "萧某" });
    await expect(
      t.service.aliasLink({ ...base, alias: "萧某", canonical: "黑衣人" }),
    ).rejects.toThrow(/反过来/u);
    await expect(
      t.service.aliasUnlink({ ...base, aliasId: "不存在" }),
    ).rejects.toThrow(/不存在/u);
    expect(t.appended).toEqual(["alias.linked"]);
  });
});

describe("认知边", () => {
  it("设定为知道（带章节）或不知道，可以恢复默认", async () => {
    const t = await setup();
    const base = { projectId: t.projectId, factId: "c", character: "裴照" };
    await t.service.knowledgeSet({ ...base, mode: "knows", chapter: ch3 });
    expect(projectKnowledge(t.events())[0]).toMatchObject({
      mode: "knows",
      chapter: ch3,
    });
    await t.service.knowledgeSet({ ...base, mode: "unaware", chapter: ch3 });
    const [entry] = projectKnowledge(t.events());
    expect(entry?.mode).toBe("unaware");
    expect(entry?.chapter).toBeUndefined();
    await t.service.knowledgeClear(base);
    expect(projectKnowledge(t.events())).toHaveLength(0);
    await expect(t.service.knowledgeClear(base)).rejects.toThrow(/没有可恢复/u);
  });

  it("校验：事实必须已确认、人物必须在图上、模式与章节合法", async () => {
    const t = await setup();
    const base = {
      projectId: t.projectId,
      character: "裴照",
      mode: "knows" as const,
    };
    await expect(
      t.service.knowledgeSet({ ...base, factId: "d" }),
    ).rejects.toThrow(/已确认/u);
    await expect(
      t.service.knowledgeSet({ ...base, factId: "不存在" }),
    ).rejects.toThrow(/已确认/u);
    await expect(
      t.service.knowledgeSet({ ...base, factId: "c", character: "无名氏" }),
    ).rejects.toThrow(/没有人物/u);
    await expect(
      t.service.knowledgeSet({
        ...base,
        factId: "c",
        chapter: "chapters/没有.md",
      }),
    ).rejects.toThrow(/时间轴/u);
    await expect(
      t.service.knowledgeSet({ ...base, factId: "c", mode: "乱写" as never }),
    ).rejects.toThrow(/知道/u);
    expect(t.appended).toEqual([]);
  });
});
