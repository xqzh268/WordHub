import { describe, expect, it } from "vitest";
import { restoreItems } from "./restore";

describe("restoreItems", () => {
  it("不是数组时返回空列表", () => {
    expect(restoreItems(undefined)).toEqual([]);
    expect(restoreItems("x")).toEqual([]);
    expect(restoreItems({})).toEqual([]);
  });

  it("丢弃空值、非对象和不认识的条目", () => {
    expect(
      restoreItems([null, 3, "a", { kind: "mystery" }, { kind: "user" }]),
    ).toEqual([]);
  });

  it("恢复用户消息", () => {
    expect(
      restoreItems([{ kind: "user", id: "u1", at: 5, text: "请评审第三章" }]),
    ).toEqual([{ kind: "user", id: "u1", at: 5, text: "请评审第三章" }]);
  });

  it("审批卡：缺省选项为批准/拒绝，差异行数转为数字", () => {
    const [item] = restoreItems([
      {
        kind: "approval",
        id: "a1",
        at: 1,
        title: "Agent请求写入",
        diff: { addedLines: "3" },
        path: "chapters/第一章.md",
        contentLength: 120,
        resolved: "批准",
      },
    ]);
    expect(item).toMatchObject({
      kind: "approval",
      options: ["批准", "拒绝"],
      body: "",
      diff: { addedLines: 3, removedLines: 0 },
      path: "chapters/第一章.md",
      contentLength: 120,
      resolved: "批准",
    });
  });

  it("审批卡：选项被保留，类型错误的可选字段被忽略", () => {
    const [item] = restoreItems([
      {
        kind: "approval",
        id: "a1",
        at: 1,
        title: "质询需要你的裁决",
        options: ["接受修改", "保留原文"],
        path: 42,
        runId: 7,
      },
    ]);
    expect(item).toMatchObject({
      options: ["接受修改", "保留原文"],
      path: undefined,
      runId: undefined,
    });
  });

  it("提示条：只有 warn 色调被保留", () => {
    const items = restoreItems([
      { kind: "notice", id: "n1", at: 1, text: "a", tone: "warn" },
      { kind: "notice", id: "n2", at: 2, text: "b", tone: "other" },
    ]);
    expect(items.map((i) => (i.kind === "notice" ? i.tone : "x"))).toEqual([
      "warn",
      undefined,
    ]);
  });

  it("问询卡：层级归一为 1 或 2，必答默认为 true", () => {
    const [a, b] = restoreItems([
      {
        kind: "question",
        id: "q1",
        at: 1,
        intakeId: "i",
        questionId: "q1",
        key: "premise",
        level: 1,
        prompt: "题材？",
      },
      {
        kind: "question",
        id: "q2",
        at: 1,
        intakeId: "i",
        questionId: "q2",
        key: "theme",
        level: 9,
        prompt: "主题？",
        required: false,
        value: "家国",
        resolved: true,
      },
    ]);
    expect(a).toMatchObject({ level: 1, required: true, resolved: false });
    expect(b).toMatchObject({
      level: 2,
      required: false,
      value: "家国",
      resolved: true,
      options: [],
    });
  });

  it("任务卡：未知状态回退为 ready，标签由 Agent 与任务类型推出", () => {
    const [task] = restoreItems([
      {
        kind: "task",
        id: "t1",
        at: 1,
        taskId: "task-1",
        agentId: "reviewer",
        taskKind: "review",
        status: "weird",
      },
    ]);
    expect(task).toMatchObject({
      kind: "task",
      taskId: "task-1",
      status: "ready",
      agentId: "reviewer",
    });
    expect(task?.kind === "task" && task.label.length).toBeGreaterThan(0);
  });

  it("质询线程：有效回复保留，无效回复被丢弃，轮次与严重度有默认值", () => {
    const [thread] = restoreItems([
      {
        kind: "thread",
        id: "th1",
        at: 1,
        claim: "第三章写成了右手持刀",
        replies: [{ agentId: "writer", text: "改为左手" }, { text: 5 }, null],
      },
    ]);
    expect(thread).toMatchObject({
      kind: "thread",
      from: "reviewer",
      to: "writer",
      round: 1,
      maxRounds: 2,
      severity: "blocking",
      replies: [{ agentId: "writer", text: "改为左手" }],
    });
  });

  it("Agent 条目：未知状态回退为 thinking，工具状态与用量被规整", () => {
    const [agent] = restoreItems([
      {
        kind: "agent",
        id: "g1",
        at: 1,
        agentId: "writer",
        runId: "run1",
        status: "???",
        text: "正文",
        tools: [
          { id: "1", name: "doc.write", status: "running" },
          { id: "2", name: "bible.read", status: "error" },
          { id: "3", name: "x", status: "whatever" },
          null,
        ],
        usage: { input: 10, output: 5, total: 15, cost: 0.01 },
      },
    ]);
    expect(agent).toMatchObject({
      kind: "agent",
      status: "thinking",
      text: "正文",
      usage: { input: 10, output: 5, total: 15, cost: 0.01 },
    });
    expect(agent?.kind === "agent" && agent.tools.map((t) => t.status)).toEqual(
      ["running", "error", "done"],
    );
  });

  it("Agent 条目：所有终态都被识别", () => {
    for (const status of [
      "streaming",
      "done",
      "aborted",
      "interrupted",
      "waiting_approval",
      "error",
    ]) {
      const [agent] = restoreItems([
        { kind: "agent", id: "g", at: 1, agentId: "w", runId: "r", status },
      ]);
      expect(agent?.kind === "agent" && agent.status).toBe(status);
    }
  });

  it("Agent 条目：上下文清单只保留结构完整的条目", () => {
    const [agent] = restoreItems([
      {
        kind: "agent",
        id: "g",
        at: 1,
        agentId: "w",
        runId: "r",
        context: [
          { id: "c1", kind: "bible", estimatedTokens: 120 },
          { id: "c2" },
          "bad",
        ],
      },
    ]);
    expect(agent?.kind === "agent" && agent.context).toEqual([
      {
        id: "c1",
        kind: "bible",
        sourcePath: undefined,
        estimatedTokens: 120,
        tokenBudget: undefined,
      },
    ]);
  });
});
