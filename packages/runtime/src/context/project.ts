import { readdir, readFile } from "node:fs/promises";
import {
  FACT_KIND_LABELS,
  projectFacts,
  projectSummaries,
} from "@wordhub/contracts";
import {
  CHAPTER_DIRECTORY,
  CHAPTER_PATH_PREFIX,
  NOVEL_PROJECT_TYPE,
  chapterNumberFromName,
  chapterNumberTokenInText,
  chapterOrdinal,
  chapterPathForName,
  parseChapterNumber,
} from "@wordhub/novel";
import { safeProjectTarget, type WordHubStore } from "@wordhub/store";
import { parseStyleSamples } from "../references/style.js";
import { ContextBuilder } from "./builder.js";
import type { AgentDefinition, ContextLayer } from "../types.js";

const BIBLE_FILES = {
  setting: "setting.md",
  characters: "characters.md",
  style: "style.md",
} as const;

const STYLE_SAMPLES_NAME = "style-samples.md";
const { contextLayers, rolePack } = NOVEL_PROJECT_TYPE;

const chapterNumber = (text: string): number | undefined => {
  const token = chapterNumberTokenInText(text, "章回节", {
    allowTenThousands: true,
  });
  return token ? parseChapterNumber(token) : undefined;
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

const CHARACTER_FIELDS =
  /^(?:姓名|身份|外貌(?:特征)?|性格|说话与行事(?:倾向)?|动机|弱点|人物弧光|惯用小动作|口头禅|硬设定)[:：]?$/u;
const CHARACTER_NOTES = /^(?:人物档案|人物关系)$/u;

type CharacterSection = {
  index: number;
  title: string;
  kind: "heading" | "bold" | "notes" | "ambiguous";
};

function characterSectionAt(
  lines: string[],
  index: number,
): CharacterSection | undefined {
  const line = lines[index] ?? "";
  const heading = line.match(/^#{2,6}\s+(.+?)\s*$/u)?.[1];
  if (heading) {
    const title = stripMarker(heading);
    return {
      index,
      title,
      kind: CHARACTER_NOTES.test(title) ? "notes" : "heading",
    };
  }
  // 纲领草稿常把人名单独写成粗体，后面接身份字段；允许名字后的括注。
  if (index > 0 && lines[index - 1]?.trim()) return undefined;
  const bold = line.match(
    /^ {0,3}\*\*([^*]+?)\*\*(?:[ \t]*([（(][^（）()]+[）)]))?[ \t]*$/u,
  );
  if (!bold?.[1]) return undefined;
  const name = bold[1].trim();
  const title = name + (bold[2] ?? "");
  if (CHARACTER_NOTES.test(name)) return { index, title, kind: "notes" };
  if (CHARACTER_FIELDS.test(name)) return undefined;
  let next = index + 1;
  while (next < lines.length && !lines[next]?.trim()) next += 1;
  const kind = /^身份\s*[:：]/u.test(stripMarker(lines[next] ?? ""))
    ? "bold"
    : "ambiguous";
  return { index, title, kind };
}

/** 保留本章提及的人物、主角及全局关系说明；无法匹配人名时保留全文。 */
export function charactersForChapter(text: string, references: string): string {
  const lines = text.split(/\r?\n/u);
  const candidates = lines
    .map((_, index) => characterSectionAt(lines, index))
    .filter((section): section is CharacterSection => section !== undefined);
  const profiles = candidates.filter((section) => section.kind !== "notes");
  const matches = new Set(
    profiles.filter(({ title }) => {
      const names = title
        .replace(/[（(][^）)]*[）)]/gu, "")
        .replace(/^[^:：]+[:：]/u, "")
        .split(/[、,，/]/u)
        .map((name) => name.trim())
        .filter((name) => name.length >= 2 && name !== "主角");
      return names.some((name) => references.includes(name));
    }),
  );
  // 相关人物或主角的条目边界不明确时，裁剪可能误删正文。
  if (
    !matches.size ||
    profiles.some(
      (section) =>
        section.kind === "ambiguous" &&
        (matches.has(section) || /主角/u.test(section.title)),
    )
  )
    return text;
  const sections = candidates.filter((section) => section.kind !== "ambiguous");
  const hasNamedLead = profiles.some(
    ({ title }) => /主角/u.test(title) && title !== "主角",
  );
  // 草稿未标注主角时，保留通常排在首位的粗体人物条目。
  const firstBold = hasNamedLead
    ? undefined
    : profiles.find(({ kind }) => kind === "bold");
  const selected = sections.flatMap((section, index) =>
    section.kind === "notes" ||
    matches.has(section) ||
    /主角/u.test(section.title) ||
    section === firstBold
      ? [
          {
            from: section.index,
            to: sections[index + 1]?.index ?? lines.length,
          },
        ]
      : [],
  );
  if (selected.length === sections.length) return text;
  return [
    ...lines.slice(0, sections[0]?.index),
    ...selected.flatMap(({ from, to }) => lines.slice(from, to)),
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
        candidate.artifactId.startsWith(`file:${CHAPTER_PATH_PREFIX}`) &&
        chapterNameMatches(candidate.artifactId, targetNumber),
    );
  if (revision)
    return {
      path: revision.artifactId.slice(5),
      text: await readFile(revision.snapshotPath, "utf8"),
    };
  const directory = await safeProjectTarget(
    input.projectPath,
    CHAPTER_DIRECTORY,
  );
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
  const relativePath = chapterPathForName(name);
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
        ...contextLayers.outline,
        id:
          number === undefined ? contextLayers.outline.id : `chapter-${number}`,
        sourcePath: outline
          ? `${outline.path}${number === undefined ? "" : `#${chapterOrdinal(number)}`}`
          : undefined,
        text: chapterOutline,
      });
  }

  if (scopes.has("bible")) {
    const setting = await readBibleFile(input.projectPath, BIBLE_FILES.setting);
    if (setting?.text.trim())
      layers.push({
        ...contextLayers.setting,
        sourcePath: setting.path,
        text: setting.text,
      });
    const characters = await readBibleFile(
      input.projectPath,
      BIBLE_FILES.characters,
    );
    if (characters?.text.trim())
      layers.push({
        ...contextLayers.characters,
        sourcePath: characters.path,
        text: charactersForChapter(
          characters.text,
          `${chapterOutline}\n${input.prompt}`,
        ),
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
        ...contextLayers.summaries,
        sourcePath: "章节摘要",
        text: summaries
          .map((item) => `${item.chapter}：${item.text}`)
          .join("\n"),
      });
    const facts = projectFacts(events)
      .filter((fact) => fact.status === "confirmed" && before(fact.chapter))
      .sort((a, b) => order(a.chapter) - order(b.chapter));
    if (facts.length)
      layers.push({
        ...contextLayers.facts,
        sourcePath: "已确认事实",
        text: facts
          .map(
            (fact) =>
              `- [${fact.chapter}·${FACT_KIND_LABELS[fact.kind]}] ${
                fact.kind === "relation"
                  ? `${fact.subject} →${fact.relation}→ ${fact.object}`
                  : fact.subject
              }：${fact.statement}（原文：“${fact.quote}”）`,
          )
          .join("\n"),
      });
  }

  if (scopes.has("chapters")) {
    const previous = await previousChapter(input, number);
    if (previous?.text.trim())
      layers.push({
        ...contextLayers.previousChapter,
        id: `previous-chapter-${number! - 1}`,
        sourcePath: previous.path,
        text: previousChapterTail(previous.text),
      });
  }

  if (scopes.has("bible")) {
    const style = await readBibleFile(input.projectPath, BIBLE_FILES.style);
    if (style?.text.trim())
      layers.push({
        ...contextLayers.style,
        sourcePath: style.path,
        text: style.text,
      });
    // 文风示范（作者从参考库里挑的片段）：只给会写正文的 Agent 和纲领
    const writes =
      input.agent.name === rolePack.coordinator ||
      input.agent.tools.some(
        (tool) => tool === "doc.write" || tool === "doc.propose",
      );
    if (writes) {
      const samples = await readBibleFile(
        input.projectPath,
        STYLE_SAMPLES_NAME,
      );
      if (samples?.text.trim() && parseStyleSamples(samples.text).length)
        layers.push({
          ...contextLayers.styleSamples,
          sourcePath: samples.path,
          text: samples.text,
        });
    }
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
