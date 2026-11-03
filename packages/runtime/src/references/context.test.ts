import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WordHubStore } from "@wordhub/store";
import { describe, expect, it } from "vitest";
import { collectProjectContextLayers } from "../context/project.js";
import {
  PermissionDeniedError,
  PermissionGuard,
} from "../tools/permissions.js";
import type { AgentDefinition } from "../types.js";
import { addStyleSample } from "./style.js";

const agent = (patch: Partial<AgentDefinition>): AgentDefinition => ({
  name: "writer",
  displayName: "写手",
  description: "测试",
  model: { provider: "deepseek", id: "deepseek-flash", reasoning: "low" },
  tools: ["doc.read", "doc.write"],
  write: "write",
  writeScopes: ["chapters/**"],
  memoryScopes: { read: ["bible", "outline", "chapters"], write: [] },
  maxTurns: 1,
  source: "builtin",
  sourcePath: "t",
  systemPrompt: "",
  version: "t",
  ...patch,
});

async function project(withSamples: boolean) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-style-"));
  const projectPath = path.join(root, "project");
  await mkdir(path.join(projectPath, ".wordhub", "bible"), { recursive: true });
  await writeFile(
    path.join(projectPath, ".wordhub", "bible", "style.md"),
    "冷峻克制。",
  );
  if (withSamples)
    await writeFile(
      path.join(projectPath, ".wordhub", "bible", "style-samples.md"),
      addStyleSample(undefined, {
        source: "《某书》第三章",
        text: "他没有回头。门在身后合上，风从城门来，灯火一盏一盏地灭下去。",
      }),
    );
  const store = new WordHubStore(path.join(root, "store"));
  const created = store.createProject({
    id: "project_style",
    name: "测试",
    folderPath: projectPath,
  });
  return { store, projectPath, projectId: created.id };
}

const layerIds = async (
  setup: Awaited<ReturnType<typeof project>>,
  who: AgentDefinition,
) =>
  (
    await collectProjectContextLayers({
      store: setup.store,
      projectId: setup.projectId,
      projectPath: setup.projectPath,
      prompt: "请写第三章",
      agent: who,
    })
  ).map((layer) => layer.id);

describe("文风示范上下文层", () => {
  it("会写正文的 Agent 在文风基准之后收到示范层，且带“不得照抄”的说明", async () => {
    const setup = await project(true);
    expect(await layerIds(setup, agent({}))).toEqual([
      "style",
      "style-samples",
    ]);
    const layers = await collectProjectContextLayers({
      store: setup.store,
      projectId: setup.projectId,
      projectPath: setup.projectPath,
      prompt: "请写第三章",
      agent: agent({}),
    });
    const text =
      layers.find((layer) => layer.id === "style-samples")?.text ?? "";
    expect(text).toContain("不得照抄");
    expect(text).toContain("门在身后合上");
    setup.store.close();
  });

  it("纲领也收到；只读的评审类 Agent 不收到", async () => {
    const setup = await project(true);
    expect(
      await layerIds(
        setup,
        agent({ name: "planner", tools: ["bible.read"], write: "propose" }),
      ),
    ).toContain("style-samples");
    expect(
      await layerIds(
        setup,
        agent({ name: "reviewer", tools: ["doc.read"], write: "none" }),
      ),
    ).toEqual(["style"]);
    setup.store.close();
  });

  it("没有示范文件、或文件里没有可解析的示范时不注入", async () => {
    const none = await project(false);
    expect(await layerIds(none, agent({}))).toEqual(["style"]);
    none.store.close();
    const junk = await project(false);
    await writeFile(
      path.join(junk.projectPath, ".wordhub", "bible", "style-samples.md"),
      "# 文风示范\n\n随便写了点别的，没有示例条目。",
    );
    expect(await layerIds(junk, agent({}))).toEqual(["style"]);
    junk.store.close();
  });

  it("没有 bible 读取范围的 Agent 不收到（读取范围先于一切）", async () => {
    const setup = await project(true);
    expect(
      await layerIds(
        setup,
        agent({ memoryScopes: { read: ["chapters"], write: [] } }),
      ),
    ).toEqual([]);
    setup.store.close();
  });
});

describe("参考库工具的权限", () => {
  const guard = new PermissionGuard();
  const reader = (
    scopes: string[],
    tools = ["reference.search", "reference.read", "reference.list"],
  ) =>
    agent({
      tools,
      write: "none",
      writeScopes: [],
      memoryScopes: { read: scopes, write: [] },
    });

  it("声明了工具且有 references 读取范围才能用", () => {
    for (const tool of ["reference.search", "reference.read", "reference.list"])
      expect(() => guard.assert(reader(["references"]), tool)).not.toThrow();
  });

  it("缺读取范围、或没声明工具都被拒绝", () => {
    expect(() =>
      guard.assert(reader(["bible", "chapters"]), "reference.search"),
    ).toThrow("没有参考库的读取范围");
    expect(() =>
      guard.assert(reader(["references"], ["doc.read"]), "reference.read"),
    ).toThrow(PermissionDeniedError);
  });

  it("参考库工具是只读的：不受写权限与写入范围影响，也不需要审批", () => {
    const who = reader(["references"]);
    expect(
      guard.requiresApproval(
        { ...who, confirmBeforeWrite: true },
        "reference.read",
      ),
    ).toBe(false);
  });
});
