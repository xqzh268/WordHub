import { ControlledFileWriter, WordHubStore } from "@wordhub/store";
import type { Event } from "@wordhub/contracts";
import type { ProjectService } from "../projects/service.js";
import type { AppendRunEvent, RunRequest } from "../runs/run-types.js";

export type IntakeKey =
  | "premise"
  | "protagonist"
  | "conflict"
  | "world"
  | "viewpointTone"
  | "theme"
  | "audience"
  | "chapterCount"
  | "mustInclude"
  | "forbidden";

export type IntakeAnswer = Partial<Record<IntakeKey, string>>;

export type IntakeQuestion = {
  key: IntakeKey | "confirm";
  level: 1 | 2;
  prompt: string;
  required: boolean;
  options: string[];
};

export const INTAKE_QUESTIONS: readonly IntakeQuestion[] = [
  {
    key: "premise",
    level: 1,
    prompt: "用一句话说说这本书想写什么。",
    required: true,
    options: [],
  },
  {
    key: "protagonist",
    level: 1,
    prompt: "主角是谁？他/她最想得到什么？",
    required: true,
    options: [],
  },
  {
    key: "conflict",
    level: 1,
    prompt: "主角要面对的核心冲突是什么？",
    required: true,
    options: [],
  },
  {
    key: "world",
    level: 2,
    prompt: "故事发生在怎样的世界或时代？（可跳过）",
    required: false,
    options: ["跳过"],
  },
  {
    key: "viewpointTone",
    level: 2,
    prompt: "希望采用什么视角和叙事基调？（可跳过）",
    required: false,
    options: ["跳过"],
  },
  {
    key: "theme",
    level: 2,
    prompt: "你希望读者读完后留下什么主题感受？（可跳过）",
    required: false,
    options: ["跳过"],
  },
  {
    key: "audience",
    level: 2,
    prompt: "目标读者是谁？（可跳过）",
    required: false,
    options: ["跳过"],
  },
  {
    key: "chapterCount",
    level: 2,
    prompt: "预计写多少章？（可跳过）",
    required: false,
    options: ["跳过"],
  },
  {
    key: "mustInclude",
    level: 2,
    prompt: "有哪些必须出现的元素？（可跳过）",
    required: false,
    options: ["跳过"],
  },
  {
    key: "forbidden",
    level: 2,
    prompt: "有哪些不希望出现的内容？（可跳过）",
    required: false,
    options: ["跳过"],
  },
];

export type IntakeState = {
  intakeId: string;
  runId: string;
  sourcePrompt: string;
  answers: IntakeAnswer;
  confirmed: boolean;
};

export function isNovelIntakePrompt(prompt: string): boolean {
  return /写一部|写一本|创作|小说|短篇|长篇|故事/u.test(prompt.trim());
}

export function extractInitialAnswers(prompt: string): IntakeAnswer {
  const text = prompt.trim();
  const match = text.match(/主角(?:是|为|叫|：|:)[\s]*([^，。；;,\n]+)/u);
  return {
    premise: text,
    ...(match?.[1] ? { protagonist: match[1].trim() } : {}),
  };
}

export function questionFor(key: IntakeKey | "confirm"): IntakeQuestion {
  if (key === "confirm")
    return {
      key,
      level: 2,
      prompt: "纲领信息已经整理完成。确认后才会写入项目设定集。",
      required: true,
      options: ["确认并写入", "继续修改"],
    };
  const question = INTAKE_QUESTIONS.find((item) => item.key === key);
  if (!question) throw new Error(`未知纲领问题：${key}`);
  return question;
}

export function nextIntakeKey(
  state: Pick<IntakeState, "answers" | "confirmed">,
): IntakeKey | "confirm" | undefined {
  if (state.confirmed) return undefined;
  for (const question of INTAKE_QUESTIONS) {
    if (question.required && !state.answers[question.key as IntakeKey]?.trim())
      return question.key as IntakeKey;
  }
  for (const question of INTAKE_QUESTIONS) {
    if (
      !question.required &&
      state.answers[question.key as IntakeKey] === undefined
    )
      return question.key as IntakeKey;
  }
  return "confirm";
}

export function applyIntakeAnswer(
  state: IntakeState,
  key: IntakeKey,
  value: string,
): IntakeState {
  const question = questionFor(key);
  const answer = value.trim();
  if (question.required && !answer) throw new Error("必答问题不能留空");
  const answers = { ...state.answers, [key]: answer };
  const index = INTAKE_QUESTIONS.findIndex((item) => item.key === key);
  for (const later of INTAKE_QUESTIONS.slice(index + 1))
    delete answers[later.key as IntakeKey];
  return { ...state, answers };
}

export function replayIntake(
  events: readonly Event[],
  intakeId: string,
): IntakeState | undefined {
  let state: IntakeState | undefined;
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const payload =
      event.payload && typeof event.payload === "object"
        ? (event.payload as Record<string, unknown>)
        : {};
    if (payload.intakeId !== intakeId) continue;
    if (event.type === "intake.started") {
      state = {
        intakeId,
        runId: event.runId,
        sourcePrompt:
          typeof payload.sourcePrompt === "string" ? payload.sourcePrompt : "",
        answers: {},
        confirmed: false,
      };
    } else if (state && event.type === "intake.answer") {
      const key = payload.key;
      if (
        typeof key === "string" &&
        key !== "confirm" &&
        INTAKE_QUESTIONS.some((item) => item.key === key)
      )
        state = applyIntakeAnswer(
          state,
          key as IntakeKey,
          typeof payload.value === "string" ? payload.value : "",
        );
    } else if (state && event.type === "intake.reset") {
      const from = payload.fromKey;
      const index =
        typeof from === "string"
          ? INTAKE_QUESTIONS.findIndex((item) => item.key === from)
          : -1;
      if (index >= 0) {
        const answers = { ...state.answers };
        for (const question of INTAKE_QUESTIONS.slice(index))
          delete answers[question.key as IntakeKey];
        state = { ...state, answers };
      }
    } else if (state && event.type === "intake.confirmed")
      state = { ...state, confirmed: true };
  }
  return state;
}

function requestFor(
  state: IntakeState,
  projectId: string,
  projectPath: string,
  sessionId: string,
): RunRequest {
  return {
    type: "run",
    runId: state.runId,
    prompt: state.sourcePrompt,
    projectId,
    projectPath,
    sessionId,
    agentId: "planner",
  };
}

function appendIntake(
  append: AppendRunEvent,
  store: WordHubStore,
  request: RunRequest,
  type: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string,
) {
  return append(
    store,
    request,
    type,
    { type: "system", id: "planner-intake" },
    payload,
    idempotencyKey,
  );
}

export function buildBibleArtifacts(
  state: IntakeState,
): Record<string, string> {
  const a = state.answers;
  const value = (key: IntakeKey) => a[key]?.trim() || "未设定";
  return {
    ".wordhub/bible/outline.md": `# 故事纲领\n\n## 一句话 premise\n${value("premise")}\n\n## 核心冲突\n${value("conflict")}\n`,
    ".wordhub/bible/characters.md": `# 人物档案\n\n## 主角\n${value("protagonist")}\n`,
    ".wordhub/bible/setting.md": `# 设定词典\n\n## 世界与时代\n${value("world")}\n\n## 必须出现\n${value("mustInclude")}\n\n## 禁止出现\n${value("forbidden")}\n`,
    ".wordhub/bible/style.md": `# 文风基准\n\n## 视角与基调\n${value("viewpointTone")}\n\n## 主题\n${value("theme")}\n\n## 读者\n${value("audience")}\n`,
    ".wordhub/bible/writing-plan.json": JSON.stringify(
      {
        schemaVersion: 1,
        chapterCount: value("chapterCount"),
        sourcePrompt: state.sourcePrompt,
        answers: state.answers,
      },
      null,
      2,
    ),
  };
}

export function createNovelIntakeService(deps: {
  projects: ProjectService;
  append: AppendRunEvent;
}) {
  const appendQuestion = (
    store: WordHubStore,
    request: RunRequest,
    intakeId: string,
    key: IntakeKey | "confirm",
  ) => {
    const question = questionFor(key);
    deps.append(
      store,
      request,
      "intake.question",
      { type: "system", id: "planner-intake" },
      {
        intakeId,
        questionId: `${intakeId}:${key}`,
        ...question,
      },
    );
  };

  async function start(request: RunRequest): Promise<void> {
    const linked = await deps.projects.ensure(request);
    Object.assign(request, {
      projectId: linked.projectId,
      projectPath: linked.projectPath,
      sessionId: linked.sessionId,
    });
    const store = linked.store;
    const intakeId = `intake_${request.runId}`;
    const state: IntakeState = {
      intakeId,
      runId: request.runId,
      sourcePrompt: request.rawPrompt ?? request.prompt,
      answers: {},
      confirmed: false,
    };
    store.startRun({
      projectId: linked.projectId,
      sessionId: linked.sessionId,
      runId: request.runId,
      prompt: request.prompt,
    });
    appendIntake(
      deps.append,
      store,
      request,
      "chat.user_message",
      { text: request.rawPrompt ?? request.prompt },
      `prompt:${request.runId}`,
    );
    appendIntake(deps.append, store, request, "run.started", {
      agentId: "planner",
      mode: request.mode ?? "live",
    });
    appendIntake(deps.append, store, request, "intake.started", {
      intakeId,
      sourcePrompt: state.sourcePrompt,
      phase: "L1",
    });
    const extracted = extractInitialAnswers(state.sourcePrompt);
    for (const question of INTAKE_QUESTIONS) {
      if (extracted[question.key as IntakeKey] === undefined) continue;
      appendQuestion(store, request, intakeId, question.key);
      appendIntake(deps.append, store, request, "intake.answer", {
        intakeId,
        questionId: `${intakeId}:${question.key}`,
        key: question.key,
        value: extracted[question.key as IntakeKey],
      });
    }
    const next = nextIntakeKey({ answers: extracted, confirmed: false });
    if (!next) throw new Error("纲领问答没有下一个问题");
    appendQuestion(store, request, intakeId, next);
    store.finishRun(request.runId, "succeeded");
    appendIntake(deps.append, store, request, "run.finished", {
      agentId: "planner",
      text: "已提取首句，请完成纲领问答。",
    });
  }

  async function locate(request: {
    projectId: string;
    sessionId: string;
    intakeId: string;
  }) {
    const store = await deps.projects.store(request.projectId);
    const project = store.getProject(request.projectId);
    if (!project) throw new Error("项目不存在");
    const events = store.listEvents(request.projectId, request.sessionId);
    const state = replayIntake(events, request.intakeId);
    if (!state) throw new Error("纲领问答不存在");
    return {
      store,
      project,
      events,
      state,
      request: requestFor(
        state,
        request.projectId,
        project.folderPath,
        request.sessionId,
      ),
    };
  }

  async function answer(request: {
    projectId: string;
    sessionId: string;
    intakeId: string;
    questionId: string;
    value: string;
  }) {
    const located = await locate(request);
    const key = request.questionId.slice(`${request.intakeId}:`.length) as
      | IntakeKey
      | "confirm";
    if (request.questionId !== `${request.intakeId}:${key}`)
      throw new Error("问题ID无效");
    if (key === "confirm") {
      if (request.value === "确认并写入") return confirm(request);
      const next = nextIntakeKey(located.state);
      if (next && next !== "confirm")
        appendQuestion(located.store, located.request, request.intakeId, next);
      return;
    }
    if (!INTAKE_QUESTIONS.some((question) => question.key === key))
      throw new Error("未知纲领问题");
    const current = nextIntakeKey(located.state);
    if (current !== key)
      appendIntake(
        deps.append,
        located.store,
        located.request,
        "intake.reset",
        { intakeId: request.intakeId, fromKey: key },
      );
    const nextState = applyIntakeAnswer(located.state, key, request.value);
    appendIntake(deps.append, located.store, located.request, "intake.answer", {
      intakeId: request.intakeId,
      questionId: request.questionId,
      key,
      value: nextState.answers[key] ?? "",
    });
    const next = nextIntakeKey(nextState);
    if (next)
      appendQuestion(located.store, located.request, request.intakeId, next);
  }

  async function confirm(request: {
    projectId: string;
    sessionId: string;
    intakeId: string;
  }) {
    const located = await locate(request);
    const next = nextIntakeKey(located.state);
    if (next !== "confirm") throw new Error("纲领问答尚未完成");
    const writer = new ControlledFileWriter(
      located.store,
      request.projectId,
      located.project.folderPath,
      { allowBible: true },
    );
    for (const [relativePath, content] of Object.entries(
      buildBibleArtifacts(located.state),
    )) {
      const result = await writer.writeText({
        relativePath,
        content,
        sessionId: request.sessionId,
        runId: located.state.runId,
        artifactId: `bible:${relativePath}`,
        author: { type: "system", id: "planner-intake" },
        conflictPolicy: "keep-both",
      });
      appendIntake(
        deps.append,
        located.store,
        located.request,
        "file.updated",
        { path: relativePath, text: content, revisionId: result.revision.id },
      );
    }
    appendIntake(deps.append, located.store, located.request, "intake.answer", {
      intakeId: request.intakeId,
      questionId: `${request.intakeId}:confirm`,
      key: "confirm",
      value: "确认并写入",
    });
    appendIntake(
      deps.append,
      located.store,
      located.request,
      "intake.confirmed",
      { intakeId: request.intakeId },
    );
    appendIntake(
      deps.append,
      located.store,
      located.request,
      "intake.artifacts.created",
      {
        intakeId: request.intakeId,
        paths: Object.keys(buildBibleArtifacts(located.state)),
      },
    );
  }

  return { start, answer, confirm };
}
