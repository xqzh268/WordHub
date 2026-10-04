import { readFile } from "node:fs/promises";
import type { Actor, Hash } from "@wordhub/contracts";
import {
  ControlledFileWriter,
  FileConflictError,
  contentHash,
  safeProjectTarget,
  type WordHubStore,
} from "@wordhub/store";
import { createBuiltinTools, type WriteToolInput } from "./builtin.js";
import type { AgentDefinition } from "../types.js";

export const bibleRelative = (input: string): string =>
  input
    .replaceAll("\\", "/")
    .replace(/^\.wordhub\/bible\//u, "")
    .replace(/^bible\//u, "");
export function projectTools(input: {
  store: WordHubStore;
  projectId: string;
  sessionId: string;
  runId: string;
  projectPath: string;
  agent: AgentDefinition;
  event: (type: string, payload: Record<string, unknown>) => string;
  approved: Map<string, string>;
}) {
  const writer = new ControlledFileWriter(
    input.store,
    input.projectId,
    input.projectPath,
    { allowBible: true },
  );
  const author: Actor = {
    type: "agent",
    id: input.agent.name,
    agentVersion: input.agent.version,
  };
  const read = async (relativePath: string) => {
    const data = await readFile(
      await safeProjectTarget(input.projectPath, relativePath, true),
    );
    return { text: data.toString("utf8"), contentHash: contentHash(data) };
  };
  const proposal = async (value: WriteToolInput, relativePath = value.path) => {
    const revision = await writer.propose({
      relativePath,
      content: value.content,
      expectedHash: value.expectedHash as Hash | null | undefined,
      sessionId: input.sessionId,
      runId: input.runId,
      author,
      approvedByEventId: input.approved.get(relativePath),
    });
    input.event("revision.proposed", {
      revisionId: revision.id,
      path: relativePath,
      contentHash: revision.contentHash,
    });
    return { revisionId: revision.id, contentHash: revision.contentHash };
  };
  const summary = (event: ReturnType<WordHubStore["listEvents"]>[number]) => ({
    type: event.type,
    seq: event.seq,
    text:
      typeof event.payload.text === "string" ? event.payload.text : undefined,
  });
  const tools = createBuiltinTools({
    readDocument: read,
    readBible: (name) => read(`.wordhub/bible/${bibleRelative(name)}`),
    writeDocument: async (value) => {
      try {
        const result = await writer.writeText({
          relativePath: value.path,
          content: value.content,
          expectedHash: value.expectedHash as Hash | null | undefined,
          sessionId: input.sessionId,
          runId: input.runId,
          author,
          approvedByEventId: input.approved.get(value.path),
        });
        input.event("file.updated", {
          path: value.path,
          revisionId: result.revision.id,
        });
        return {
          revisionId: result.revision.id,
          contentHash: result.contentHash,
        };
      } catch (error) {
        if (!(error instanceof FileConflictError)) throw error;
        const result = await proposal(value);
        // 给模型一个真实工具错误，不能把候选当成已写入。
        throw new Error(
          `${error.message}。Agent内容已保存为候选${result.revisionId}，请通知用户处理冲突。`,
        );
      }
    },
    proposeDocument: proposal,
    proposeBible: (value) =>
      proposal(value, `.wordhub/bible/${bibleRelative(value.path)}`),
    searchHistory: async (query) =>
      input.store.searchEvents(input.projectId, query).map(summary),
    getHistory: async (seq) => {
      const event = input.store
        .listEvents(input.projectId)
        .find((event) => event.seq === seq);
      return event ? summary(event) : undefined;
    },
    challengeRaise: async (value) => {
      const threadId =
        value.threadId ?? `thread_${input.runId}_${Date.now().toString(36)}`;
      const round =
        input.store
          .listEvents(input.projectId)
          .filter(
            (event) =>
              event.type === "challenge.raise" &&
              event.payload &&
              typeof event.payload === "object" &&
              (event.payload as Record<string, unknown>).threadId === threadId,
          ).length + 1;
      input.event("challenge.raise", { threadId, ...value, round });
      return { threadId, round };
    },
    challengeReply: async (value) => {
      const round = input.store
        .listEvents(input.projectId)
        .filter(
          (event) =>
            event.type === "challenge.raise" &&
            event.payload &&
            typeof event.payload === "object" &&
            (event.payload as Record<string, unknown>).threadId ===
              value.threadId,
        ).length;
      if (round >= 2 && value.disposition !== "accept") {
        input.event("escalation.created", {
          threadId: value.threadId,
          round,
          reason: "质询已达两轮且仍未解决，请用户裁决。",
        });
        return { threadId: value.threadId, round };
      }
      input.event("challenge.reply", { ...value, round });
      return { threadId: value.threadId, round };
    },
    questionAsk: async (value) => {
      const questionId = `question_${input.runId}_${Date.now().toString(36)}`;
      input.event("question.ask", { questionId, ...value });
      return { questionId };
    },
  });
  return {
    tools: tools.filter((tool) => input.agent.tools.includes(tool.name)),
    writer,
    proposal,
  };
}
