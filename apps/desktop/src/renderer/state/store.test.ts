import type { AppEvent, ChapterInfo } from "@wordhub/contracts";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatItem } from "./types";

// store 在加载时读取 window / localStorage，所以先安装桩再动态导入。
type Invoke = (command: string, payload?: unknown) => Promise<unknown>;
let invoke: ReturnType<typeof vi.fn<Invoke>>;
let useWorkbench: typeof import("./store").useWorkbench;
let initial: ReturnType<typeof useWorkbench.getState>;

beforeAll(async () => {
  invoke = vi.fn<Invoke>();
  vi.stubGlobal("window", {
    location: { search: "" },
    matchMedia: () => ({ matches: false }),
    wordhub: { invoke: (c: string, p?: unknown) => invoke(c, p) },
  });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
  });
  ({ useWorkbench } = await import("./store"));
  initial = useWorkbench.getState();
});

const state = () => useWorkbench.getState();
const items = (): ChatItem[] => state().sessions[0]?.items ?? [];
const emit = (message: Record<string, unknown>) =>
  state().handleEvent({
    type: "run.event",
    payload: message,
  } as AppEvent);
const ofKind = <K extends ChatItem["kind"]>(kind: K) =>
  items().filter(
    (item): item is Extract<ChatItem, { kind: K }> => item.kind === kind,
  );

beforeEach(() => {
  invoke.mockReset();
  useWorkbench.setState(
    {
      ...initial,
      sessions: [{ id: "s1", title: "会话", items: [] }],
      activeSessionId: "s1",
      project: { id: "p1", name: "长安夜", folder: "D:/写作/长安夜" },
      paper: null,
      chapters: [],
      activeChapter: null,
      activeRunId: null,
    },
    true,
  );
});

describe("运行生命周期", () => {
  it("run.started 新建气泡并记为当前运行", () => {
    emit({ type: "run.started", runId: "r1", agentId: "writer", model: "m" });
    expect(ofKind("agent")).toHaveLength(1);
    expect(ofKind("agent")[0]).toMatchObject({
      runId: "r1",
      status: "thinking",
      model: "m",
    });
    expect(state().activeRunId).toBe("r1");
  });

  it("发送时已建好的气泡不会因为 run.started 重复出现", () => {
    emit({ type: "run.started", runId: "r1", agentId: "writer" });
    emit({ type: "run.started", runId: "r1", agentId: "writer" });
    expect(ofKind("agent")).toHaveLength(1);
  });

  it("run.text 逐段追加并进入 streaming", () => {
    emit({ type: "run.started", runId: "r1" });
    emit({ type: "run.text", runId: "r1", delta: "暮鼓" });
    emit({ type: "run.text", runId: "r1", delta: "三百声。" });
    expect(ofKind("agent")[0]).toMatchObject({
      status: "streaming",
      text: "暮鼓三百声。",
    });
  });

  it("工具开始与结束：同名工具并行时按最后一个运行中的收尾", () => {
    emit({ type: "run.started", runId: "r1" });
    emit({ type: "run.tool_execution_start", runId: "r1", tool: "bible.read" });
    emit({ type: "run.tool_execution_start", runId: "r1", tool: "bible.read" });
    emit({ type: "run.tool_execution_end", runId: "r1", tool: "bible.read" });
    expect(ofKind("agent")[0]?.tools.map((t) => t.status)).toEqual([
      "running",
      "done",
    ]);
  });

  it("run.finished 收尾并清除当前运行，空正文用事件里的文本补上", () => {
    emit({ type: "run.started", runId: "r1" });
    emit({
      type: "run.finished",
      runId: "r1",
      text: "完成",
      usage: { input: 1, output: 2, totalTokens: 3, cost: { total: 0.5 } },
    });
    expect(ofKind("agent")[0]).toMatchObject({
      status: "done",
      text: "完成",
      usage: { input: 1, output: 2, total: 3, cost: 0.5 },
    });
    expect(state().activeRunId).toBeNull();
  });

  it("已有正文时 run.finished 不覆盖", () => {
    emit({ type: "run.started", runId: "r1" });
    emit({ type: "run.text", runId: "r1", delta: "已有" });
    emit({ type: "run.finished", runId: "r1", text: "别的" });
    expect(ofKind("agent")[0]?.text).toBe("已有");
  });

  it("中止与中断都会清除当前运行", () => {
    emit({ type: "run.started", runId: "r1" });
    emit({ type: "run.aborted", runId: "r1" });
    expect(ofKind("agent")[0]?.status).toBe("aborted");
    expect(state().activeRunId).toBeNull();
    emit({ type: "run.started", runId: "r2" });
    emit({ type: "run.interrupted", runId: "r2" });
    expect(ofKind("agent")[1]?.status).toBe("interrupted");
    expect(state().activeRunId).toBeNull();
  });

  it("error 事件把气泡标为出错并释放发送按钮", () => {
    emit({ type: "run.started", runId: "r1" });
    emit({ type: "error", runId: "r1", error: "401" });
    expect(ofKind("agent")[0]).toMatchObject({ status: "error", error: "401" });
    expect(state().activeRunId).toBeNull();
  });

  it("后台进程崩溃：进行中的运行被标为出错", () => {
    emit({ type: "run.started", runId: "r1" });
    state().handleEvent({
      type: "worker.state",
      payload: { state: "crashed" },
    } as never);
    expect(state().worker).toBe("crashed");
    expect(ofKind("agent")[0]?.status).toBe("error");
    expect(state().activeRunId).toBeNull();
  });

  it("权限被拒给出带原因的警告提示", () => {
    emit({ type: "permission.denied", reason: "路径不在授权范围" });
    expect(ofKind("notice")[0]).toMatchObject({ tone: "warn" });
    expect(ofKind("notice")[0]?.text).toContain("路径不在授权范围");
  });
});

describe("审批与质询", () => {
  it("approval.requested 生成带预览与差异的审批卡", () => {
    emit({
      type: "approval.requested",
      runId: "r1",
      tool: "doc.write",
      path: "chapters/第一章.md",
      contentLength: 800,
      contentPreview: "暮鼓三百声",
      diff: { addedLines: 4, removedLines: 1 },
    });
    expect(ofKind("approval")[0]).toMatchObject({
      path: "chapters/第一章.md",
      preview: "暮鼓三百声",
      contentLength: 800,
      diff: { addedLines: 4, removedLines: 1 },
      options: ["批准", "拒绝"],
    });
  });

  it("批准 / 拒绝 / 过期分别标记同一运行的审批卡", () => {
    for (const [type, text] of [
      ["approval.granted", "批准"],
      ["approval.rejected", "拒绝"],
      ["approval.expired", "已过期，可重新发起"],
    ] as const) {
      useWorkbench.setState({ sessions: [{ id: "s1", title: "", items: [] }] });
      emit({ type: "approval.requested", runId: "r1", tool: "doc.write" });
      emit({ type, runId: "r1" });
      expect(ofKind("approval")[0]?.resolved).toBe(text);
    }
  });

  it("两条升级卡互不影响：裁决一条不会把另一条标为已处理", () => {
    emit({
      type: "escalation.created",
      runId: "w1",
      workflowId: "w1",
      threadId: "th1",
    });
    emit({
      type: "escalation.created",
      runId: "w1",
      workflowId: "w1",
      threadId: "th2",
    });
    emit({
      type: "escalation.resolved",
      runId: "w1",
      threadId: "th1",
      decision: "accept",
    });
    const cards = ofKind("approval");
    expect(cards.map((c) => c.resolved)).toEqual(["接受修改", undefined]);
  });

  it("escalation.resolved 的“保留原文”决定", () => {
    emit({ type: "escalation.created", runId: "w1", threadId: "th1" });
    emit({
      type: "escalation.resolved",
      runId: "w1",
      threadId: "th1",
      decision: "keep",
    });
    expect(ofKind("approval")[0]?.resolved).toBe("保留原文");
  });

  it("challenge.raise 创建质询线程，再次提出只更新轮次与主张", () => {
    emit({
      type: "challenge.raise",
      threadId: "th1",
      actorId: "reviewer",
      claim: "右手持刀",
      round: 1,
    });
    emit({
      type: "challenge.raise",
      threadId: "th1",
      claim: "仍是右手",
      round: 2,
    });
    expect(ofKind("thread")).toHaveLength(1);
    expect(ofKind("thread")[0]).toMatchObject({
      round: 2,
      claim: "仍是右手",
      from: "reviewer",
    });
  });

  it("challenge.reply 追加回复", () => {
    emit({ type: "challenge.raise", threadId: "th1", claim: "x" });
    emit({
      type: "challenge.reply",
      threadId: "th1",
      actorId: "writer",
      text: "改为左手",
    });
    expect(ofKind("thread")[0]?.replies).toEqual([
      { agentId: "writer", text: "改为左手" },
    ]);
  });
});

describe("工作流与任务", () => {
  it("workflow.started 去掉父运行的空“构思中”占位，并加一条启动提示", () => {
    emit({ type: "run.started", runId: "w1" });
    emit({
      type: "workflow.started",
      runId: "w1",
      label: "全流程写作",
      estimate: { costUsd: 0.12 },
    });
    expect(ofKind("agent")).toHaveLength(0);
    expect(ofKind("notice")[0]?.text).toContain("全流程写作");
    expect(state().activeRunId).toBe("w1");
  });

  it("workflow.finished / failed 释放当前运行并给出提示", () => {
    emit({ type: "workflow.started", runId: "w1" });
    emit({ type: "workflow.finished", runId: "w1" });
    expect(state().activeRunId).toBeNull();
    emit({ type: "workflow.started", runId: "w2" });
    emit({ type: "workflow.failed", runId: "w2" });
    expect(state().activeRunId).toBeNull();
    expect(ofKind("notice").at(-1)).toMatchObject({ tone: "warn" });
  });

  it("task.* 事件按 taskId 合并成一张卡并更新状态", () => {
    emit({
      type: "task.created",
      taskId: "t1",
      assignedAgent: "writer",
      kind: "write",
    });
    emit({ type: "task.started", taskId: "t1" });
    expect(ofKind("task")).toHaveLength(1);
    expect(ofKind("task")[0]?.status).toBe("running");
    emit({ type: "task.succeeded", taskId: "t1" });
    expect(ofKind("task")[0]?.status).toBe("succeeded");
    emit({ type: "task.failed", taskId: "t2" });
    emit({ type: "task.blocked", taskId: "t3" });
    expect(ofKind("task").map((t) => t.status)).toEqual([
      "succeeded",
      "failed",
      "blocked",
    ]);
  });

  it("没有 taskId 的任务事件被忽略", () => {
    emit({ type: "task.started" });
    expect(ofKind("task")).toHaveLength(0);
  });
});

describe("纲领问询", () => {
  const question = (extra: Record<string, unknown> = {}) => ({
    type: "intake.question",
    intakeId: "i1",
    questionId: "q1",
    key: "protagonist",
    prompt: "主角是谁？",
    ...extra,
  });

  it("同一问题重复出现时更新而不是重复添加，并保留已填答案", () => {
    emit(question());
    emit({ type: "intake.answer", questionId: "q1", value: "裴照" });
    emit(question({ prompt: "主角是谁？（改）" }));
    expect(ofKind("question")).toHaveLength(1);
    expect(ofKind("question")[0]).toMatchObject({
      prompt: "主角是谁？（改）",
      value: "裴照",
      resolved: true,
    });
  });

  it("intake.answer 标记问题已回答", () => {
    emit(question());
    emit({ type: "intake.answer", questionId: "q1", value: "裴照" });
    expect(ofKind("question")[0]).toMatchObject({
      value: "裴照",
      resolved: true,
    });
  });
});

describe("纲领草稿", () => {
  it("开始→就绪：同一张草稿卡先显示生成中，再填入文档", () => {
    emit({ type: "intake.draft.started", intakeId: "i1" });
    expect(ofKind("draft")[0]).toMatchObject({ status: "generating" });
    emit({
      type: "intake.draft.ready",
      intakeId: "i1",
      source: "model",
      model: "deepseek-v4-pro",
      documents: { "outline.md": "第一章", "setting.md": "崇仁坊" },
    });
    expect(ofKind("draft")).toHaveLength(1);
    expect(ofKind("draft")[0]).toMatchObject({
      status: "ready",
      source: "model",
      documents: [
        { file: "outline.md", title: "大纲", content: "第一章" },
        { file: "setting.md", title: "设定词典", content: "崇仁坊" },
      ],
    });
  });

  it("失败后回退为模板：保留失败原因并标记来源", () => {
    emit({ type: "intake.draft.started", intakeId: "i1" });
    emit({ type: "intake.draft.failed", intakeId: "i1", error: "超时" });
    emit({
      type: "intake.draft.ready",
      intakeId: "i1",
      source: "template",
      documents: { "outline.md": "x" },
    });
    expect(ofKind("draft")[0]).toMatchObject({
      source: "template",
      error: "超时",
    });
  });

  it("重新生成：旧文档被清空并回到生成中", () => {
    emit({
      type: "intake.draft.ready",
      intakeId: "i1",
      source: "model",
      documents: { "outline.md": "旧" },
    });
    emit({ type: "intake.draft.started", intakeId: "i1" });
    expect(ofKind("draft")[0]).toMatchObject({
      status: "generating",
      documents: [],
    });
  });
});

describe("质询分类", () => {
  it("challenge.raise 把分类与引文带到质询卡，再次提出时保留", () => {
    emit({
      type: "challenge.raise",
      threadId: "t1",
      actorId: "reviewer",
      claim: "右手与左撇子冲突",
      category: "character",
      citations: [{ source: "chapters/第三章.md", quote: "右手按住刀柄" }],
      round: 1,
    });
    emit({
      type: "challenge.raise",
      threadId: "t1",
      claim: "仍冲突",
      round: 2,
    });
    expect(ofKind("thread")[0]).toMatchObject({
      category: "character",
      citations: [{ source: "chapters/第三章.md", quote: "右手按住刀柄" }],
      round: 2,
    });
  });
});

describe("事实", () => {
  const fact = (id: string, status: string) => ({
    id,
    kind: "character_state",
    subject: "老周",
    statement: "老周死亡",
    chapter: "chapters/第五章.md",
    quote: "老周倒在质库后墙下",
    status,
    proposedAt: "2026-10-22T00:00:00.000Z",
  });

  it("refreshFacts 载入事实、摘要与定稿章节", async () => {
    invoke.mockResolvedValue({
      facts: [fact("f1", "proposed")],
      summaries: [{ chapter: "chapters/第五章.md", text: "老周死了", at: "x" }],
      finalized: ["chapters/第五章.md"],
    });
    await state().refreshFacts();
    expect(state().facts).toHaveLength(1);
    expect(state().summaries[0]?.text).toBe("老周死了");
    expect(state().finalized).toEqual(["chapters/第五章.md"]);
  });

  it("decideFact 先乐观更新，再通知后台", async () => {
    useWorkbench.setState({ facts: [fact("f1", "proposed")] as never });
    invoke.mockResolvedValue({ factId: "f1", status: "confirmed" });
    const pending = state().decideFact("f1", "confirm");
    expect(state().facts[0]?.status).toBe("confirmed");
    await pending;
    expect(invoke).toHaveBeenCalledWith("fact.decide", {
      projectId: "p1",
      factId: "f1",
      decision: "confirm",
    });
  });

  it("决定失败时以事件日志为准刷新回来", async () => {
    useWorkbench.setState({ facts: [fact("f1", "proposed")] as never });
    invoke.mockImplementation(async (command) => {
      if (command === "fact.decide") throw new Error("busy");
      return { facts: [fact("f1", "proposed")], summaries: [], finalized: [] };
    });
    await state().decideFact("f1", "reject");
    expect(state().facts[0]?.status).toBe("proposed");
  });

  it("事实 / 摘要 / 定稿事件触发刷新", async () => {
    invoke.mockResolvedValue({ facts: [], summaries: [], finalized: [] });
    for (const type of [
      "fact.proposed",
      "fact.confirmed",
      "fact.rejected",
      "chapter.summary",
      "chapter.finalized",
    ]) {
      invoke.mockClear();
      emit({ type });
      await vi.waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("fact.list", { projectId: "p1" }),
      );
    }
  });

  it("没有项目时不请求", async () => {
    useWorkbench.setState({ project: { name: "未命名项目", folder: null } });
    await state().refreshFacts();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("纸面与章节", () => {
  const info = (
    name: string,
    number: number,
    mtimeMs: number,
  ): ChapterInfo => ({
    path: `chapters/${name}`,
    name,
    number,
    size: 10,
    mtimeMs,
  });
  const freshDisk = () => ({
    chapters: [info("第一章.md", 1, 1000), info("第二章.md", 2, 3000)],
    files: {
      "chapters/第一章.md": "# 第一章 暮鼓\n\n暮鼓三百声。",
      "chapters/第二章.md": "# 第二章 残月\n\n残月悬在天边。",
    } as Record<string, string>,
  });
  let disk = freshDisk();
  beforeEach(() => {
    disk = freshDisk(); // 每个用例都从干净的磁盘开始，避免互相污染
  });
  const mountDisk = () =>
    invoke.mockImplementation(async (command, payload) => {
      if (command === "chapter.list") return { chapters: disk.chapters };
      if (command === "chapter.read") {
        const path = (payload as { path: string }).path;
        const mtimeMs =
          disk.chapters.find((c) => c.path === path)?.mtimeMs ?? 0;
        return {
          path,
          content: disk.files[path] ?? "",
          contentHash: "h",
          mtimeMs,
        };
      }
      return { watching: true };
    });

  it("Agent 写章节：纸面立即显示并切到该章", () => {
    emit({
      type: "file.updated",
      path: "chapters/第一章.md",
      content: "# 第一章 暮鼓\n\n暮鼓三百声。",
    });
    expect(state().activeChapter).toBe("chapters/第一章.md");
    expect(state().paper?.paragraphs[0]?.text).toBe("暮鼓三百声。");
  });

  it("写到 chapters/ 之外的文件不改变纸面", () => {
    emit({ type: "file.updated", path: "notes/备忘.md", content: "杂记" });
    expect(state().paper).toBeNull();
  });

  it("首次同步：显示最近修改的章节，并记录磁盘修改时间", async () => {
    mountDisk();
    await state().syncChapters();
    expect(state().activeChapter).toBe("chapters/第二章.md");
    expect(state().paper).toMatchObject({
      no: "第二章",
      title: "残月",
      mtimeMs: 3000,
    });
  });

  it("selectChapter 切换并读取所选章节", async () => {
    mountDisk();
    await state().syncChapters();
    await state().selectChapter("chapters/第一章.md");
    expect(state().paper?.title).toBe("暮鼓");
  });

  it("磁盘内容被外部改动（修改时间变化）后重读", async () => {
    mountDisk();
    await state().syncChapters();
    disk.files["chapters/第二章.md"] = "# 第二章 残月\n\n我在别处改了这一段。";
    disk.chapters = [info("第一章.md", 1, 1000), info("第二章.md", 2, 4000)];
    await state().syncChapters();
    expect(state().paper?.paragraphs[0]?.text).toBe("我在别处改了这一段。");
  });

  it("修改时间没变时不重复读取", async () => {
    mountDisk();
    await state().syncChapters();
    const reads = () =>
      invoke.mock.calls.filter(([c]) => c === "chapter.read").length;
    const before = reads();
    await state().syncChapters();
    expect(reads()).toBe(before);
  });

  it("chapters.changed 只处理当前项目的通知", async () => {
    mountDisk();
    emit({ type: "chapters.changed", projectId: "other" });
    expect(invoke).not.toHaveBeenCalled();
    emit({ type: "chapters.changed", projectId: "p1" });
    await vi.waitFor(() => expect(state().paper).not.toBeNull());
  });

  it("所有章节文件被删除后，来自磁盘的纸面被清空", async () => {
    mountDisk();
    await state().syncChapters();
    disk.chapters = [];
    await state().syncChapters();
    expect(state().paper).toBeNull();
    expect(state().activeChapter).toBeNull();
  });

  it("读取期间又切换了章节：先发出的慢请求不会覆盖后选的章节", async () => {
    let releaseFirst: () => void = () => undefined;
    invoke.mockImplementation(async (command, payload) => {
      if (command === "chapter.list") return { chapters: disk.chapters };
      const path = (payload as { path: string }).path;
      if (path.endsWith("第一章.md"))
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      return {
        path,
        content: disk.files[path],
        contentHash: "h",
        mtimeMs: disk.chapters.find((c) => c.path === path)?.mtimeMs,
      };
    });
    const slow = state().selectChapter("chapters/第一章.md");
    await vi.waitFor(() =>
      expect(state().activeChapter).toBe("chapters/第一章.md"),
    );
    await state().selectChapter("chapters/第二章.md");
    releaseFirst();
    await slow;
    expect(state().activeChapter).toBe("chapters/第二章.md");
    expect(state().paper?.title).toBe("残月");
  });

  it("读取失败时保留当前纸面", async () => {
    mountDisk();
    await state().syncChapters();
    invoke.mockRejectedValue(new Error("busy"));
    await state().syncChapters();
    expect(state().paper?.title).toBe("残月");
  });

  it("没有项目 ID 时不请求磁盘", async () => {
    useWorkbench.setState({ project: { name: "未命名项目", folder: null } });
    await state().syncChapters();
    expect(invoke).not.toHaveBeenCalled();
  });
});
