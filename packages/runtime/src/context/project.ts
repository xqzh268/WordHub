import { readdir, readFile } from "node:fs/promises";
import { safeProjectTarget, type WordHubStore } from "@wordhub/store";
import { ContextBuilder } from "./builder.js";
import type { AgentDefinition, ContextLayer } from "../types.js";

const BIBLE_FILES = {
  setting: "setting.md",
  characters: "characters.md",
  style: "style.md",
} as const;

const chapterNumber = (text: string): number | undefined => {
  const match = text.match(
    /第\s*([0-9]+|[零〇一二两三四五六七八九十百千万]+)\s*章/u,
  );
  if (!match?.[1]) return undefined;
  if (/^\d+$/u.test(match[1])) return Number(match[1]);
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (match[1] === "十") return 10;
  const ten = match[1].indexOf("十");
  if (ten >= 0) {
    const left = match[1].slice(0, ten);
    const right = match[1].slice(ten + 1);
    return (
      (left ? (digits[left] ?? 0) : 1) * 10 + (right ? (digits[right] ?? 0) : 0)
    );
  }
  return [...match[1]].reduce(
    (total, digit) => total * 10 + (digits[digit] ?? 0),
    0,
  );
};

const chapterNameMatches = (name: string, number: number): boolean =>
  chapterNumber(name) === number;

async function readBibleFile(
  projectPath: string,
  name: string,
): Promise<{ path: string; text: string } | undefined> {
  const relativePath = `.wordhub/bible/${name}`;
  const target = await safeProjectTarget(projectPath, relativePath, true);
  const text = await readFile(target, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  return text === undefined ? undefined : { path: relativePath, text };
}

function outlineForChapter(text: string, number: number | undefined): string {
  if (number === undefined) return text;
  return text
    .split(/\r?\n/u)
    .filter((line) => chapterNameMatches(line, number))
    .join("\n");
}

async function previousChapter(
  input: {
    store: WordHubStore;
    projectId: string;
    projectPath: string;
  },
  number: number | undefined,
): Promise<{ path: string; text: string } | undefined> {
  if (number === undefined || number <= 1) return undefined;
  const targetNumber = number - 1;
  const revision = [...input.store.listAllRevisions(input.projectId)]
    .reverse()
    .find(
      (candidate) =>
        candidate.status === "current" &&
        candidate.artifactId.startsWith("file:chapters/") &&
        chapterNameMatches(candidate.artifactId, targetNumber),
    );
  if (revision)
    return {
      path: revision.artifactId.slice(5),
      text: await readFile(revision.snapshotPath, "utf8"),
    };
  const directory = await safeProjectTarget(input.projectPath, "chapters");
  const names = await readdir(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const name = names
    .filter((candidate) => chapterNameMatches(candidate, targetNumber))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
  if (!name) return undefined;
  const relativePath = `chapters/${name}`;
  const target = await safeProjectTarget(input.projectPath, relativePath);
  return { path: relativePath, text: await readFile(target, "utf8") };
}

export async function collectProjectContextLayers(input: {
  store: WordHubStore;
  projectId: string;
  projectPath: string;
  prompt: string;
  agent: AgentDefinition;
}): Promise<ContextLayer[]> {
  const scopes = new Set(input.agent.memoryScopes.read);
  const layers: ContextLayer[] = [];
  const number = chapterNumber(input.prompt);

  if (scopes.has("outline") || scopes.has("bible")) {
    const outline = await readBibleFile(input.projectPath, "outline.md");
    const text = outline ? outlineForChapter(outline.text, number) : "";
    if (text.trim())
      layers.push({
        id: number === undefined ? "outline" : `chapter-${number}`,
        kind: "outline",
        sourcePath: outline
          ? `${outline.path}${number === undefined ? "" : `#第${number}章`}`
          : undefined,
        text,
        tokenBudget: 1200,
      });
  }

  if (scopes.has("bible")) {
    const setting = await readBibleFile(input.projectPath, BIBLE_FILES.setting);
    if (setting?.text.trim())
      layers.push({
        id: "setting",
        kind: "bible",
        sourcePath: setting.path,
        text: setting.text,
        tokenBudget: 1800,
      });
    const characters = await readBibleFile(
      input.projectPath,
      BIBLE_FILES.characters,
    );
    if (characters?.text.trim())
      layers.push({
        id: "characters",
        kind: "bible",
        sourcePath: characters.path,
        text: characters.text,
        tokenBudget: 1800,
      });
  }

  if (scopes.has("chapters")) {
    const previous = await previousChapter(input, number);
    if (previous?.text.trim())
      layers.push({
        id: `previous-chapter-${number! - 1}`,
        kind: "document",
        sourcePath: previous.path,
        text: previous.text.slice(-1600),
        tokenBudget: 400,
      });
  }

  if (scopes.has("bible")) {
    const style = await readBibleFile(input.projectPath, BIBLE_FILES.style);
    if (style?.text.trim())
      layers.push({
        id: "style",
        kind: "bible",
        sourcePath: style.path,
        text: style.text,
        tokenBudget: 800,
      });
  }
  return layers;
}

export async function projectContext(input: {
  store: WordHubStore;
  projectId: string;
  sessionId: string;
  projectPath: string;
  runId: string;
  prompt: string;
  agent: AgentDefinition;
}) {
  const layers = await collectProjectContextLayers(input);
  return new ContextBuilder().build(layers, input.prompt);
}
