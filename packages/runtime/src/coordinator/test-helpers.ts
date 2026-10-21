import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRunExecutor } from "../runs/executor.js";

export async function fixture(
  response: Parameters<
    ReturnType<typeof fauxProvider>["setResponses"]
  >[0][number],
  options: { tokensPerSecond?: number } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordhub-m3-"));
  const project = path.join(root, "长安夜");
  await mkdir(path.join(project, ".wordhub/bible"), { recursive: true });
  await mkdir(path.join(project, "chapters"), { recursive: true });
  await writeFile(
    path.join(project, ".wordhub/bible/bible.md"),
    "裴照是左撇子。他惯用横刀。",
    "utf8",
  );

  const faux = fauxProvider({
    provider: "deepseek",
    models: [
      { id: "deepseek-flash", reasoning: true },
      { id: "deepseek-v4-pro", reasoning: true },
    ],
    ...options,
  });
  faux.setResponses(Array.from({ length: 100 }, () => response));
  const models = createModels();
  models.setProvider(faux.provider);
  const messages: Record<string, unknown>[] = [];
  const executor = createRunExecutor({
    storageRoot: path.join(root, "store"),
    workspaceRoot: process.cwd(),
    mockModels: models,
    post: (message) => messages.push(message),
  });
  await executor.ready;
  return { root, project, messages, executor };
}

export async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("M3运行超时");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
