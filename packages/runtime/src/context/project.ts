import { readdir, readFile } from "node:fs/promises";
import {
  FACT_KIND_LABELS,
  chapterNumberFromName,
  parseChapterNumber,
  projectFacts,
  projectSummaries,
} from "@wordhub/contracts";
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
    /第\s*([0-9零〇一二两三四五六七八九十百千万]+)\s*[章回节]/u,
  );
  return match?.[1] ? parseChapterNumber(match[1]) : undefined;
};

const chapterNameMatches = (name: string, number: number): boolean =>
  (chapterNumber(name) ?? chapterNumberFromName(name)) === number;

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

const headingLevel = (line: string): number =>
  line.match(/^(#{1,6})\s/u)?.[1]?.length ?? 0;

const stripMarker = (line: string): string =>
  line
    .replace(/^\s*>+\s*/u, "")
    .replace(/^(?:#{1,6}\s+|[-*+]\s+|\d+[.)、]\s*)/u, "")
    // 模型常用 `**第3章**` 或 `3. **第3章**`，强调符号不改变章节语义。
    .replace(/[*_~]/gu, "")
    .trim();

const outlineChapterNumber = (line: string): number | undefined => {
  const normalized = stripMarker(line);
  return /^第\s*/u.test(normalized) ? chapterNumber(normalized) : undefined;
};

/** 在人物档案的二级标题中保留本章相关人物，始终保留主角段落。 */
export function charactersForChapter(text: string, references: string): string {
  const lines = text.split(/\r?\n/u);
  const headings = lines
    .map((line, index) => {
      const match = line.match(/^(#{2,6})\s+(.+?)\s*$/u);
      if (!match?.[1]) return undefined;
      return { index, level: match[1].length, title: match[2] ?? "" };
    })
    .filter((item): item is { index: number; level: number; title: string } =>
      Boolean(item),
    );
  if (!headings.length) return text;
  const sections = headings.map((heading, index) => ({
    ...heading,
    end: headings[index + 1]?.index ?? lines.length,
  }));
  const selected = sections.filter((section) => {
    const title = stripMarker(section.title);
    if (/主角/u.test(title)) return true;
    const names = title
      .replace(/^[^:：]+[:：]/u, "")
      .replace(/[（(][^）)]*[）)]/gu, "")
      .split(/[、,，/]/u)
      .map((name) => name.trim())
      .filter((name) => name.length >= 2);
    return names.some((name) => references.includes(name));
  });
  if (!selected.length || selected.length === sections.length) return text;
  const prefix = lines.slice(0, sections[0]?.index ?? 0);
  return [
    ...prefix,
    ...selected.flatMap((section) => lines.slice(section.index, section.end)),
  ]
    .join("\n")
    .trim();
}

/** 取上一章末尾的完整句子，目标窗口为500–800字，避免从句中间截断。 */
export function previousChapterTail(
  text: string,
  minChars = 500,
  maxChars = 800,
): string {
  const normalized = text.replace(/\r\n/gu, "\n").trim();
  if (normalized.length <= maxChars) return normalized;
  const minStart = Math.max(0, normalized.length - maxChars);
  const maxStart = Math.max(minStart, normalized.length - minChars);
  for (let start = minStart; start <= maxStart; start += 1) {
    if (start === 0 || /[。！？!?；;\n]/u.test(normalized[start - 1] ?? ""))
      return normalized.slice(start).trimStart();
  }
  return normalized.slice(minStart).trimStart();
}

/**
 * 取出大纲里属于第 N 章的段落：从该章标题行开始，到下一个同级或更高级标题、
 * 或另一章的标题行为止（模型生成的大纲把目标、事件、悬念写在标题下面的列表里）。
 * 找不到标题式的章节段落时，退回到逐行匹配含“第N章”的行。
 */
export function outlineForChapter(
  text: string,
  number: number | undefined,
): string {
  if (number === undefined) return text;
  const lines = text.split(/\r?\n/u);
  const isChapterLine = (line: string) =>
    outlineChapterNumber(line) !== undefined;
  const start = lines.findIndex(
    (line) => isChapterLine(line) && outlineChapterNumber(line) === number,
  );
  if (start < 0)
    return lines.filter((line) => chapterNumber(line) === number).join("\n");
  const level = headingLevel(lines[start] ?? "");
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const otherLevel = headingLevel(line);
    const otherChapter = outlineChapterNumber(line);
    if (
      (otherChapter !== undefined && otherChapter !== number) ||
      (otherLevel > 0 && (level === 0 || otherLevel <= level))
    ) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
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
  let chapterOutline = "";

  if (scopes.has("outline") || scopes.has("bible")) {
    const outline = await readBibleFile(input.projectPath, "outline.md");
    chapterOutline = outline ? outlineForChapter(outline.text, number) : "";
    if (chapterOutline.trim())
      layers.push({
        id: number === undefined ? "outline" : `chapter-${number}`,
        kind: "outline",
        sourcePath: outline
          ? `${outline.path}${number === undefined ? "" : `#第${number}章`}`
          : undefined,
        text: chapterOutline,
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
        text: charactersForChapter(
          characters.text,
          `${chapterOutline}\n${input.prompt}`,
        ),
        tokenBudget: 1800,
      });
  }

  if (scopes.has("bible") || scopes.has("chapters")) {
    const events = input.store.listEvents(input.projectId);
    // 只给“当前章之前”的章节：写第 3 章不该看到第 5 章的事实。
    const before = (chapter: string) => {
      const chapterNo = chapterNumberFromName(
        chapter.split("/").at(-1) ?? chapter,
      );
      return number === undefined || chapterNo === undefined
        ? true
        : chapterNo < number;
    };
    const order = (chapter: string) =>
      chapterNumberFromName(chapter.split("/").at(-1) ?? chapter) ?? 0;
    const summaries = projectSummaries(events)
      .filter((item) => before(item.chapter))
      .sort((a, b) => order(a.chapter) - order(b.chapter));
    if (summaries.length)
      layers.push({
        id: "summaries",
        kind: "memory",
        sourcePath: "章节摘要",
        text: summaries
          .map((item) => `${item.chapter}：${item.text}`)
          .join("\n"),
        tokenBudget: 1000,
      });
    const facts = projectFacts(events)
      .filter((fact) => fact.status === "confirmed" && before(fact.chapter))
      .sort((a, b) => order(a.chapter) - order(b.chapter));
    if (facts.length)
      layers.push({
        id: "facts",
        kind: "memory",
        sourcePath: "已确认事实",
        text: facts
          .map(
            (fact) =>
              `- [${fact.chapter}·${FACT_KIND_LABELS[fact.kind]}] ${fact.subject}：${fact.statement}（原文：“${fact.quote}”）`,
          )
          .join("\n"),
        tokenBudget: 1200,
      });
  }

  if (scopes.has("chapters")) {
    const previous = await previousChapter(input, number);
    if (previous?.text.trim())
      layers.push({
        id: `previous-chapter-${number! - 1}`,
        kind: "document",
        sourcePath: previous.path,
        text: previousChapterTail(previous.text),
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
