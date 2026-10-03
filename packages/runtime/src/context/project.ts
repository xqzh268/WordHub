import { readdir, readFile } from "node:fs/promises";
import { safeProjectTarget, type WordHubStore } from "@wordhub/store";
import { ContextBuilder } from "./builder.js";
import type { AgentDefinition, ContextLayer } from "../types.js";

export async function projectContext(input: {
  store: WordHubStore;
  projectId: string;
  sessionId: string;
  projectPath: string;
  runId: string;
  prompt: string;
  agent: AgentDefinition;
}) {
  const layers: ContextLayer[] = [];
  if (input.agent.memoryScopes.read.includes("bible")) {
    const directory = await safeProjectTarget(
      input.projectPath,
      ".wordhub/bible",
      true,
    );
    const names = await readdir(directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const entry of names
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const relativePath = `.wordhub/bible/${entry.name}`;
      const sourcePath = await safeProjectTarget(
        input.projectPath,
        relativePath,
        true,
      );
      layers.push({
        id: `bible:${entry.name}`,
        kind: "bible",
        sourcePath: relativePath,
        text: await readFile(sourcePath, "utf8"),
      });
    }
  }
  const recent = input.store
    .listEvents(input.projectId, input.sessionId)
    .filter(
      (event) =>
        event.runId !== input.runId &&
        ["chat.user_message", "run.finished"].includes(event.type),
    )
    .slice(-8)
    .map(
      (event) =>
        `${event.type === "chat.user_message" ? "用户" : event.actor.id}：${typeof event.payload.text === "string" ? event.payload.text : "（完成）"}`,
    )
    .join("\n");
  if (recent) layers.push({ id: "recent", kind: "recent", text: recent });
  const chapter = [...input.store.listAllRevisions(input.projectId)]
    .reverse()
    .find(
      (revision) =>
        revision.status === "current" &&
        revision.artifactId.startsWith("file:chapters/"),
    );
  if (chapter)
    layers.push({
      id: "current-document",
      kind: "document",
      sourcePath: chapter.artifactId.slice(5),
      text: await readFile(chapter.snapshotPath, "utf8"),
    });
  return new ContextBuilder().build(layers, input.prompt);
}
