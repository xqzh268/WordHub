import fs from "node:fs/promises";
import path from "node:path";
import { projectFacts, projectSummaries } from "@wordhub/contracts";
import type { Models } from "@earendil-works/pi-ai";
import type { ModelSettings } from "../models/settings.js";
import type { ProjectService } from "../projects/service.js";
import {
  SIM_LIMITS,
  type SimEntry,
  SimulationError,
  checkSimulationInput,
  estimateSimulation,
  parseStep,
  publicLogLines,
  reportPrompt,
  reportSystem,
  stepPrompt,
} from "./simulate.js";
import {
  type InterviewAnswer,
  type InterviewMode,
  type InterviewTurn,
  InterviewError,
  buildInterviewContext,
  interviewPrompt,
  readAnswer,
} from "./interview.js";

export type Usage = {
  input: number;
  output: number;
  total: number;
  cost?: number;
};

export type InterviewRequest = {
  projectId: string;
  node: string;
  /** 所选章节的相对路径，如 chapters/第三章.md */
  chapter: string;
  mode: InterviewMode;
  question: string;
  history: InterviewTurn[];
  runMode?: "live" | "mock";
};

export type InterviewResult = InterviewAnswer & {
  usage: Usage;
  model: string;
};

export type InterviewSaveRequest = {
  projectId: string;
  node: string;
  chapter: string;
  mode: InterviewMode;
  turns: Array<InterviewTurn & { basis?: string[] }>;
};

export type SimulationBase = {
  projectId: string;
  /** 起点章节的相对路径 */
  chapter: string;
  premise?: string;
  participants: string[];
};
export type SimulationEstimateRequest = SimulationBase & { rounds: number };
export type SimulationStepRequest = SimulationBase & {
  node: string;
  round: number;
  rounds: number;
  log: SimEntry[];
  runMode?: "live" | "mock";
};
export type SimulationReportRequest = SimulationBase & {
  log: SimEntry[];
  runMode?: "live" | "mock";
};
export type SimulationSaveRequest = SimulationBase & {
  rounds: number;
  log: SimEntry[];
  report: string;
};

type Deps = {
  projectService: ProjectService;
  modelSettings: ModelSettings;
  models: Models;
  mockModels: Models;
  assertAuth: (provider: string) => Promise<void>;
};

const readOptional = async (file: string): Promise<string | undefined> => {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
};

const safeName = (text: string): string =>
  text.replace(/[\\/:*?"<>|\s.]+/gu, "_").slice(0, 40) || "未命名";

export function createGraphService(deps: Deps) {
  const project = (projectId: string) => {
    const found = deps.projectService
      .recent()
      .find((item) => item.id === projectId);
    if (!found) throw new Error("项目不存在");
    return found;
  };

  /** 以“写手”的模型设置做一次单轮生成（创作类任务，与用户给写手配的模型一致）。 */
  async function generate(input: {
    folder: string;
    mode: "live" | "mock";
    system: string;
    prompt: string;
    signal?: AbortSignal;
  }): Promise<{ text: string; usage: Usage; model: string }> {
    const resolved = await deps.modelSettings.resolve({
      agentId: "writer",
      projectPath: input.folder,
    });
    const runtimeModels = input.mode === "mock" ? deps.mockModels : deps.models;
    const model = runtimeModels.getModel(
      resolved.ref.provider,
      resolved.ref.id,
    );
    if (!model)
      throw new Error(
        `model not found: ${resolved.ref.provider}/${resolved.ref.id}`,
      );
    if (input.mode !== "mock") await deps.assertAuth(resolved.ref.provider);
    const reply = await runtimeModels.completeSimple(
      model,
      {
        systemPrompt: input.system,
        messages: [
          { role: "user", content: input.prompt, timestamp: Date.now() },
        ],
      },
      {
        reasoning:
          resolved.ref.reasoning === "off" ? undefined : resolved.ref.reasoning,
        signal: input.signal,
      },
    );
    if (reply.stopReason === "error" || reply.stopReason === "aborted")
      throw new Error(reply.errorMessage || "模型请求失败");
    const text = reply.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    if (!text.trim()) throw new Error("模型返回了空回答，请重试");
    return {
      text,
      model: model.id,
      usage: {
        input: reply.usage.input,
        output: reply.usage.output,
        total: reply.usage.totalTokens,
        ...(reply.usage.cost?.total !== undefined
          ? { cost: reply.usage.cost.total }
          : {}),
      },
    };
  }

  async function interview(
    request: InterviewRequest,
  ): Promise<InterviewResult> {
    const question = request.question.trim();
    if (!question) throw new Error("请先输入要问的问题");
    if (question.length > 1000) throw new Error("问题太长（最多 1000 字）");
    if (request.history.length > 60)
      throw new Error("对话太长，请新开一次采访");
    const found = project(request.projectId);
    const store = await deps.projectService.store(request.projectId);
    const events = store.listEvents(request.projectId);
    const bible = path.join(found.folderPath, ".wordhub", "bible");
    let context: ReturnType<typeof buildInterviewContext>;
    try {
      context = buildInterviewContext({
        projectName: found.name,
        facts: projectFacts(events),
        summaries: projectSummaries(events),
        node: request.node,
        chapter: request.chapter,
        mode: request.mode,
        characters: await readOptional(path.join(bible, "characters.md")),
        setting: await readOptional(path.join(bible, "setting.md")),
      });
    } catch (error) {
      if (error instanceof InterviewError) throw new Error(error.message);
      throw error;
    }
    const reply = await generate({
      folder: found.folderPath,
      mode: request.runMode ?? "live",
      system: context.system,
      prompt: interviewPrompt(request.history, question, request.node),
    });
    return {
      ...readAnswer(reply.text, context),
      usage: reply.usage,
      model: reply.model,
    };
  }

  /** 把一次采访存成 Markdown（.wordhub/graph/interviews/），不进正史，只是作者的素材。 */
  async function interviewSave(
    request: InterviewSaveRequest,
  ): Promise<{ path: string }> {
    if (request.turns.length === 0) throw new Error("还没有对话可以保存");
    const found = project(request.projectId);
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/gu, "")
      .replace(/\.\d+Z$/u, "")
      .replace("T", "-");
    const chapter = path.basename(request.chapter).replace(/\.[^.]+$/u, "");
    const relative = path.posix.join(
      ".wordhub",
      "graph",
      "interviews",
      `${stamp}-${safeName(request.node)}-${safeName(chapter)}.md`,
    );
    const target = path.join(found.folderPath, ...relative.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const body = [
      `# 采访：${request.node}（截至${chapter}）`,
      "",
      `> 模式：${request.mode === "character" ? "采访（以人物口吻）" : "作者（分析）"}。这是模型根据已确认事实生成的对话，不是正文，也不会改变设定。`,
      "",
      ...request.turns.flatMap((turn) => [
        `**${turn.role === "user" ? "作者" : request.node}**：${turn.text.trim()}`,
        ...(turn.basis?.length ? ["", `> 依据：${turn.basis.join("；")}`] : []),
        "",
      ]),
    ].join("\n");
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, body, "utf8");
    await fs.rename(temp, target);
    return { path: relative };
  }

  /** 为一个参与者建推演上下文；知识边界的错误转成普通 Error，让界面能显示。 */
  async function simulationContext(
    base: SimulationBase,
    node: string,
    log: readonly SimEntry[],
  ) {
    const found = project(base.projectId);
    const store = await deps.projectService.store(base.projectId);
    const events = store.listEvents(base.projectId);
    const bible = path.join(found.folderPath, ".wordhub", "bible");
    try {
      return {
        found,
        context: buildInterviewContext({
          projectName: found.name,
          facts: projectFacts(events),
          summaries: projectSummaries(events),
          node,
          chapter: base.chapter,
          mode: "character",
          purpose: "simulate",
          premise: base.premise,
          publicLog: publicLogLines(log),
          characters: await readOptional(path.join(bible, "characters.md")),
          setting: await readOptional(path.join(bible, "setting.md")),
        }),
      };
    } catch (error) {
      if (error instanceof InterviewError) throw new Error(error.message);
      throw error;
    }
  }
  const checkLog = (log: readonly SimEntry[]) => {
    if (log.length > SIM_LIMITS.maxParticipants * SIM_LIMITS.maxRounds)
      throw new Error("推演记录太长");
    for (const entry of log)
      if (entry.action.length > 2000 || (entry.intent?.length ?? 0) > 2000)
        throw new Error("推演记录里有过长的条目");
  };
  const checkBase = (base: SimulationBase, rounds: number) => {
    try {
      checkSimulationInput({
        participants: base.participants,
        rounds,
        premise: base.premise,
      });
    } catch (error) {
      if (error instanceof SimulationError) throw new Error(error.message);
      throw error;
    }
  };
  const stampNow = () =>
    new Date()
      .toISOString()
      .replace(/[-:]/gu, "")
      .replace(/\.\d+Z$/u, "")
      .replace("T", "-");

  /** 开始前的估算：调用次数与 token 量级，让作者先知道要花多少。 */
  async function simulateEstimate(request: SimulationEstimateRequest) {
    checkBase(request, request.rounds);
    const contexts = await Promise.all(
      request.participants.map((name) => simulationContext(request, name, [])),
    );
    return estimateSimulation({
      contextChars: contexts.map((item) => item.context.system.length),
      rounds: request.rounds,
    });
  }

  /** 推演的一步：轮到某个人物，他只看得到公开的行动，看不到别人的心思。 */
  async function simulateStep(request: SimulationStepRequest) {
    checkBase(request, request.rounds);
    if (!request.participants.includes(request.node))
      throw new Error("这个人物不在参与名单里");
    if (request.round < 1 || request.round > request.rounds)
      throw new Error("轮次超出范围");
    checkLog(request.log);
    const { found, context } = await simulationContext(
      request,
      request.node,
      request.log,
    );
    const reply = await generate({
      folder: found.folderPath,
      mode: request.runMode ?? "live",
      system: context.system,
      prompt: stepPrompt(request.round, request.rounds, request.node),
    });
    const step = parseStep(reply.text);
    if (!step.action) throw new Error("模型没有给出这一轮的行动，请重试");
    const written = `${step.action}${step.intent ?? ""}`;
    const warnings = context.hiddenNames
      .filter((hidden) => written.includes(hidden.name))
      .map(
        (hidden) =>
          `提到了「${hidden.name}」，这个人物要到「${hidden.chapterLabel}」才出现，超出了起点「${context.chapterLabel}」。`,
      );
    return { ...step, warnings, usage: reply.usage, model: reply.model };
  }

  async function simulateReport(request: SimulationReportRequest) {
    checkBase(request, Math.max(1, ...request.log.map((entry) => entry.round)));
    checkLog(request.log);
    if (request.log.length === 0) throw new Error("还没有推演记录");
    const contexts = await Promise.all(
      request.participants.map((name) => simulationContext(request, name, [])),
    );
    const first = contexts[0];
    if (!first) throw new Error("没有参与人物");
    const seen = new Map<string, string>();
    for (const item of contexts)
      for (const fact of item.context.facts.values())
        if (!seen.has(fact.id))
          seen.set(
            fact.id,
            `- （${path.basename(fact.chapter).replace(/\.[^.]+$/u, "")}）${
              fact.kind === "relation"
                ? `${fact.subject} →${fact.relation}→ ${fact.object}：`
                : ""
            }${fact.statement}`,
          );
    const reply = await generate({
      folder: first.found.folderPath,
      mode: request.runMode ?? "live",
      system: reportSystem(first.found.name),
      prompt: reportPrompt({
        chapterLabel: first.context.chapterLabel,
        premise: request.premise,
        participants: request.participants,
        log: request.log,
        knownFacts: [...seen.values()],
      }),
    });
    return {
      report: reply.text.trim(),
      usage: reply.usage,
      model: reply.model,
    };
  }

  /** 推演存成非正史的 Markdown（.wordhub/graph/branches/）；不碰章节、设定和事实。 */
  async function simulateSave(
    request: SimulationSaveRequest,
  ): Promise<{ path: string }> {
    checkBase(request, request.rounds);
    checkLog(request.log);
    if (request.log.length === 0 || !request.report.trim())
      throw new Error("还没有可保存的推演结果");
    const found = project(request.projectId);
    const chapter = path.basename(request.chapter).replace(/\.[^.]+$/u, "");
    const relative = path.posix.join(
      ".wordhub",
      "graph",
      "branches",
      `${stampNow()}-${safeName(request.premise?.trim().slice(0, 16) || "自然发展")}-${safeName(chapter)}.md`,
    );
    const target = path.join(found.folderPath, ...relative.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const body = [
      `# 推演：${request.premise?.trim() || "自然发展"}`,
      "",
      `> **非正史**。这是模型根据已确认事实做的推演，起点是「${chapter}」，参与人物：${request.participants.join("、")}，共 ${request.rounds} 轮。它不会改变章节、设定或事实，仅供作者参考。`,
      "",
      "## 推演报告",
      "",
      request.report.trim(),
      "",
      "## 推演记录",
      "",
      ...request.log.flatMap((entry) => [
        `### 第${entry.round}轮 · ${entry.name}`,
        `- 行动：${entry.action}`,
        ...(entry.intent ? [`- 心思：${entry.intent}`] : []),
        "",
      ]),
    ].join("\n");
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, body, "utf8");
    await fs.rename(temp, target);
    return { path: relative };
  }

  return {
    interview,
    interviewSave,
    simulateEstimate,
    simulateStep,
    simulateReport,
    simulateSave,
    generate,
  };
}
