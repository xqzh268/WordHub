import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NOVEL_PROJECT_TYPE } from "@wordhub/novel";
import { describe, expect, it } from "vitest";
import { definitionFor } from "./routing.js";

describe("小说工作流资源", () => {
  it("从调用方工作区读取声明中的工作流，每次使用独立定义", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wordhub-workflows-"));
    try {
      const directory = path.join(root, NOVEL_PROJECT_TYPE.workflows.directory);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(
          directory,
          NOVEL_PROJECT_TYPE.workflows.files["write-chapter"],
        ),
        JSON.stringify({ id: "write-chapter", label: "自定义写作", nodes: [] }),
        "utf8",
      );

      const first = await definitionFor(root, "write-chapter");
      expect(first.label).toBe("自定义写作");
      first.nodes.push({
        id: "review",
        agent: "reviewer",
        kind: "review",
        status: "pending",
        dependencies: [],
      });
      const second = await definitionFor(root, "write-chapter");
      expect(second.nodes).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("全体协作按已有角色顺序咨询，最后由纲领汇总", async () => {
    const definition = await definitionFor(process.cwd(), "all");
    expect(definition.nodes.map(({ agent }) => agent)).toEqual([
      "writer",
      "editor",
      "reviewer",
      "observer",
      "planner",
    ]);
    expect(definition.nodes.at(-1)?.dependencies).toEqual([
      "writer",
      "editor",
      "reviewer",
      "observer",
    ]);
  });
});
