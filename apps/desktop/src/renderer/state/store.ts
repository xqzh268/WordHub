import { create } from "zustand";
import type {
  AppEvent,
  ChapterInfo,
  ChapterSummary,
  NovelFact,
  ThemePreference,
  WorkspaceSnapshot,
} from "@wordhub/contracts";
import { routeMessage } from "../lib/agents";
import { DEMO_CHAPTER, DEMO_PROJECT, demoSessions } from "../lib/demo";
import { handleApproval } from "./approvalHandlers";
import { handleIntake } from "./intakeHandlers";
import { PREFS_KEY, type Prefs, type ReadingFont, loadPrefs } from "./prefs";
import { restoreItems } from "./restore";
import { handleRun } from "./runHandlers";
import { uid } from "./util";
import { handleWorkflow } from "./workflowHandlers";
import type { RunMessage } from "./messages";
import {
  type PaperDoc,
  chapterFromPrompt,
  needsReload,
  paperFromText,
  pickActiveChapter,
} from "./chapters";
export { resolveTheme, type ReadingFont } from "./prefs";
import type { ChatItem, PaperTab, Session, View, WorkerState } from "./types";

const emptySession = (title: string): Session => ({
  id: uid("s"),
  title,
  items: [],
});

function latestPaperFromEvents(events: unknown[]) {
  for (const event of [...events].reverse()) {
    if (!event || typeof event !== "object") continue;
    const value = event as Record<string, unknown>;
    if (value.type !== "file.updated") continue;
    const payload = value.payload;
    if (!payload || typeof payload !== "object") continue;
    const data = payload as Record<string, unknown>;
    if (
      typeof data.path === "string" &&
      typeof data.text === "string" &&
      /^chapters[\\/]/u.test(data.path)
    )
      return paperFromText(data.path, data.text);
  }
  return undefined;
}

export type State = Prefs & {
  demo: boolean;
  view: View;
  paperTab: PaperTab;
  project: { id?: string; name: string; folder: string | null };
  worker: WorkerState;
  sessions: Session[];
  activeSessionId: string;
  paper: PaperDoc | null;
  /** 项目 chapters/ 目录下的章节（磁盘为准），按章号排序 */
  chapters: ChapterInfo[];
  activeChapter: string | null;
  /** 史官抽取的事实（待确认 / 已确认 / 已驳回），来自事件日志投影 */
  facts: NovelFact[];
  summaries: ChapterSummary[];
  finalized: string[];
  activeRunId: string | null;
  composer: string;

  setTheme(theme: ThemePreference): void;
  setReading(reading: ReadingFont): void;
  setView(view: View): void;
  setPaperTab(tab: PaperTab): void;
  refreshFacts(): Promise<void>;
  decideFact(factId: string, decision: "confirm" | "reject"): Promise<void>;
  selectChapter(path: string): Promise<void>;
  syncChapters(preferred?: string): Promise<void>;
  watchChapters(): Promise<void>;
  setComposer(text: string): void;
  mention(agentName: string): void;
  /** 模型配置有变化（设置页或侧栏切换）后递增，侧栏据此重新读取 */
  modelsVersion: number;
  bumpModels(): void;
  newSession(): Promise<void>;
  selectSession(id: string): void;
  linkFolder(): Promise<void>;
  restartWorker(): Promise<void>;
  send(text: string): Promise<void>;
  abort(): Promise<void>;
  resumeRun(runId: string): Promise<void>;
  resolveApproval(itemId: string, choice: string): void;
  answerQuestion(
    item: Extract<ChatItem, { kind: "question" }>,
    value: string,
  ): Promise<void>;
  confirmIntake(item: Extract<ChatItem, { kind: "question" }>): Promise<void>;
  handleEvent(event: AppEvent): void;
};

const isDemo = new URLSearchParams(window.location.search).get("demo") === "1";

const initialSessions = isDemo ? demoSessions() : [emptySession("新会话")];

export const useWorkbench = create<State>((set, get) => {
  const patchItems = (
    sessionId: string,
    update: (items: ChatItem[]) => ChatItem[],
  ) =>
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? { ...session, items: update(session.items) }
          : session,
      ),
    }));

  const patchRun = (
    runId: string,
    update: (
      item: Extract<ChatItem, { kind: "agent" }>,
    ) => Extract<ChatItem, { kind: "agent" }>,
  ) =>
    set((state) => ({
      sessions: state.sessions.map((session) => ({
        ...session,
        items: session.items.map((item) =>
          item.kind === "agent" && item.runId === runId ? update(item) : item,
        ),
      })),
    }));

  return {
    ...loadPrefs(),
    demo: isDemo,
    view: "workspace",
    paperTab: "paper",
    project: isDemo ? DEMO_PROJECT : { name: "未命名项目", folder: null },
    worker: "offline",
    sessions: initialSessions,
    activeSessionId: initialSessions[0]!.id,
    paper: isDemo ? DEMO_CHAPTER : null,
    chapters: [],
    activeChapter: null,
    modelsVersion: 0,
    bumpModels() {
      set((state) => ({ modelsVersion: state.modelsVersion + 1 }));
    },
    facts: [],
    summaries: [],
    finalized: [],
    activeRunId: null,
    composer: "",

    setTheme(theme) {
      set({ theme });
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ theme, reading: get().reading }),
      );
    },
    setReading(reading) {
      set({ reading });
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ theme: get().theme, reading }),
      );
    },
    setView: (view) => set({ view }),
    setPaperTab: (paperTab) => set({ paperTab }),

    async refreshFacts() {
      const projectId = get().project.id;
      if (!projectId || !window.wordhub || get().demo) return;
      try {
        const result = await window.wordhub.invoke("fact.list", { projectId });
        if (get().project.id !== projectId) return;
        set({
          facts: result.facts,
          summaries: result.summaries,
          finalized: result.finalized,
        });
      } catch {
        // 下一次事件会再刷新
      }
    },

    async decideFact(factId, decision) {
      const projectId = get().project.id;
      if (!projectId || !window.wordhub) return;
      // 先乐观更新，失败再以磁盘（事件日志）为准刷新回来
      set((state) => ({
        facts: state.facts.map((fact) =>
          fact.id === factId
            ? {
                ...fact,
                status: decision === "confirm" ? "confirmed" : "rejected",
              }
            : fact,
        ),
      }));
      try {
        await window.wordhub.invoke("fact.decide", {
          projectId,
          factId,
          decision,
        });
      } catch {
        await get().refreshFacts();
      }
    },

    async selectChapter(path) {
      await get().syncChapters(path);
    },

    // 以磁盘为准：刷新章节列表，决定显示哪一章，必要时重读正文。
    async syncChapters(preferred) {
      const projectId = get().project.id;
      if (!projectId || !window.wordhub || get().demo) return;
      try {
        const { chapters } = await window.wordhub.invoke("chapter.list", {
          projectId,
        });
        if (get().project.id !== projectId) return;
        const target = pickActiveChapter(
          chapters,
          preferred,
          get().activeChapter,
        );
        set({ chapters, activeChapter: target });
        if (!target) {
          // 没有任何章节文件：不再保留来自磁盘的旧纸面
          if (get().paper?.path) set({ paper: null });
          return;
        }
        const info = chapters.find((chapter) => chapter.path === target);
        if (!needsReload(info, get().paper)) return;
        const file = await window.wordhub.invoke("chapter.read", {
          projectId,
          path: target,
        });
        // 读取期间用户可能又切换了章节
        if (get().activeChapter !== target || get().project.id !== projectId)
          return;
        set({
          paper: paperFromText(file.path, file.content, {
            mtimeMs: file.mtimeMs,
          }),
        });
      } catch {
        // 读取失败（文件正在被替换等）时保持当前纸面，下一次变化会再同步
      }
    },

    async watchChapters() {
      const projectId = get().project.id;
      if (!projectId || !window.wordhub || get().demo) return;
      await window.wordhub
        .invoke("chapter.watch", { projectId })
        .catch(() => undefined);
      void get().refreshFacts();
      await get().syncChapters();
    },
    setComposer: (composer) => set({ composer }),

    mention(agentName) {
      const text = get().composer.replace(/^@\S*\s*/, "");
      set({ composer: `@${agentName} ${text}`, view: "workspace" });
    },

    async newSession() {
      const count = get().sessions.length + 1;
      const session = emptySession(`新会话 ${count}`);
      const projectId = get().project.id;
      if (projectId) {
        const created = await window.wordhub?.invoke("session.create", {
          projectId,
          title: session.title,
        });
        if (created?.session) session.id = created.session.id;
      }
      set((state) => ({
        sessions: [...state.sessions, session],
        activeSessionId: session.id,
        view: "workspace",
      }));
    },
    selectSession: (id) => set({ activeSessionId: id, view: "workspace" }),

    async linkFolder() {
      const result = await window.wordhub?.invoke(
        "workspace.chooseFolder",
        undefined,
      );
      const folder = result?.path;
      if (folder && result.projectId && result.sessionId) {
        const sessions = await window.wordhub?.invoke("session.list", {
          projectId: result.projectId,
        });
        const chat = await window.wordhub?.invoke("chat.list", {
          projectId: result.projectId,
          sessionId: result.sessionId,
        });
        set({
          project: {
            id: result.projectId,
            name: folder.split(/[\\/]/).pop() || folder,
            folder,
          },
          sessions: (sessions?.sessions ?? []).map((session) => ({
            id: session.id,
            title: session.title,
            items:
              session.id === result.sessionId ? restoreItems(chat?.items) : [],
          })),
          activeSessionId: result.sessionId,
          paper: latestPaperFromEvents(chat?.events ?? []) ?? null,
          chapters: [],
          activeChapter: null,
        });
        void get().watchChapters();
        void get().refreshFacts();
      } else if (folder)
        set({
          project: { name: folder.split(/[\\/]/).pop() || folder, folder },
        });
    },

    async restartWorker() {
      await window.wordhub?.invoke("run.restartWorker", undefined);
    },

    async send(text) {
      const trimmed = text.trim();
      const state = get();
      if (!trimmed || state.activeRunId) return;
      const { agent, body } = routeMessage(trimmed);
      const runId = uid("run");
      const now = Date.now();
      patchItems(state.activeSessionId, (items) => [
        ...items,
        { kind: "user", id: uid("u"), at: now, text: trimmed },
        {
          kind: "agent",
          id: uid("a"),
          at: now,
          agentId: agent.id,
          status: "thinking",
          text: "",
          tools: [],
          runId,
        },
      ]);
      set({ composer: "", activeRunId: runId });
      // 提到“第三章”就把纸面切到那一章
      const mentioned = chapterFromPrompt(trimmed, state.chapters);
      if (mentioned && mentioned !== state.activeChapter)
        void get().selectChapter(mentioned);
      if (!window.wordhub) return;
      try {
        const estimate = await window.wordhub
          .invoke("run.estimate", {
            prompt: body || trimmed,
            rawPrompt: trimmed,
            agentId: agent.id,
            projectPath: state.project.folder ?? undefined,
          })
          .catch(() => undefined);
        if (estimate)
          patchItems(get().activeSessionId, (items) => [
            ...items,
            {
              kind: "notice",
              id: uid("estimate"),
              at: Date.now(),
              text: `${estimate.label ?? "本次运行"}预估：约${estimate.inputTokens}输入Token、${estimate.outputTokens}输出Token，${estimate.costUsd.toFixed(4)}美元（运行不设上限）。${estimate.unpricedModels?.length ? `注意：${estimate.unpricedModels.join("、")}的价格未知，这部分费用未计入，可在设置里为它填写价格。` : ""}`,
            },
          ]);
        await window.wordhub.invoke("run.start", {
          runId,
          prompt: body || trimmed,
          rawPrompt: trimmed,
          agentId: agent.id,
          mentions: trimmed.startsWith("@") ? [agent.id] : [],
          projectPath: state.project.folder ?? undefined,
          projectId: state.project.id,
          sessionId: state.activeSessionId,
        });
      } catch (error) {
        patchRun(runId, (item) => ({
          ...item,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }));
        set({ activeRunId: null });
      }
    },

    async abort() {
      const runId = get().activeRunId;
      if (runId) await window.wordhub?.invoke("run.abort", { runId });
    },
    async resumeRun(runId) {
      try {
        await window.wordhub?.invoke("run.resume", { runId });
        set({ activeRunId: runId });
      } catch (error) {
        patchItems(get().activeSessionId, (items) => [
          ...items,
          {
            kind: "notice",
            id: uid("resume-error"),
            at: Date.now(),
            text: error instanceof Error ? error.message : String(error),
            tone: "warn",
          },
        ]);
      }
    },

    async resolveApproval(itemId, choice) {
      const item = get()
        .sessions.flatMap((session) => session.items)
        .find(
          (candidate) =>
            candidate.kind === "approval" && candidate.id === itemId,
        );
      if (item?.kind === "approval" && item.runId) {
        if (item.threadId && item.workflowId) {
          await window.wordhub?.invoke("challenge.decide", {
            workflowId: item.workflowId,
            threadId: item.threadId,
            decision: choice === "接受修改" ? "accept" : "keep",
          });
          return;
        }
        if (choice === "重新发起") {
          const session = get().sessions.find((candidate) =>
            candidate.items.some(
              (candidateItem) => candidateItem.id === item.id,
            ),
          );
          const index =
            session?.items.findIndex((candidate) => candidate.id === item.id) ??
            -1;
          const previous = index > 0 ? session?.items[index - 1] : undefined;
          if (previous?.kind === "user") await get().send(previous.text);
          return;
        }
        try {
          await window.wordhub?.invoke("run.approve", {
            runId: item.runId,
            approved: choice === "批准",
          });
        } catch (error) {
          patchItems(get().activeSessionId, (items) => [
            ...items,
            {
              kind: "notice",
              id: uid("notice"),
              at: Date.now(),
              text: error instanceof Error ? error.message : String(error),
              tone: "warn",
            },
          ]);
        }
      }
    },

    async answerQuestion(item, value) {
      const projectId = get().project.id;
      if (!projectId) return;
      try {
        await window.wordhub?.invoke("intake.answer", {
          projectId,
          sessionId: get().activeSessionId,
          intakeId: item.intakeId,
          questionId: item.questionId,
          value,
        });
      } catch (error) {
        patchItems(get().activeSessionId, (items) => [
          ...items,
          {
            kind: "notice",
            id: uid("intake-error"),
            at: Date.now(),
            text: error instanceof Error ? error.message : String(error),
            tone: "warn",
          },
        ]);
      }
    },

    async confirmIntake(item) {
      const projectId = get().project.id;
      if (!projectId) return;
      try {
        await window.wordhub?.invoke("intake.confirm", {
          projectId,
          sessionId: get().activeSessionId,
          intakeId: item.intakeId,
        });
      } catch (error) {
        patchItems(get().activeSessionId, (items) => [
          ...items,
          {
            kind: "notice",
            id: uid("intake-error"),
            at: Date.now(),
            text: error instanceof Error ? error.message : String(error),
            tone: "warn",
          },
        ]);
      }
    },

    handleEvent(event) {
      if (event.type === "workspace.snapshot") {
        const snapshot = event.payload as WorkspaceSnapshot;
        set((state) => ({
          project: {
            id: snapshot.projectId,
            name: snapshot.projectName,
            folder: snapshot.linkedFolder,
          },
          activeSessionId: snapshot.activeSessionId ?? state.activeSessionId,
        }));
        if (snapshot.projectId && snapshot.activeSessionId && window.wordhub) {
          void Promise.all([
            window.wordhub.invoke("session.list", {
              projectId: snapshot.projectId,
            }),
            window.wordhub.invoke("chat.list", {
              projectId: snapshot.projectId,
              sessionId: snapshot.activeSessionId,
            }),
          ])
            .then(([sessions, chat]) =>
              set((state) => ({
                sessions: sessions.sessions.map((session) => ({
                  id: session.id,
                  title: session.title,
                  items:
                    session.id === snapshot.activeSessionId
                      ? restoreItems(chat.items)
                      : [],
                })),
                paper: latestPaperFromEvents(chat.events) ?? state.paper,
              })),
            )
            .then(() => get().watchChapters());
        }
        return;
      }
      if (event.type === "worker.state") {
        const next = (event.payload as { state?: string }).state;
        if (
          next === "offline" ||
          next === "starting" ||
          next === "ready" ||
          next === "busy" ||
          next === "stopped" ||
          next === "crashed"
        ) {
          const previous = get().worker;
          set({ worker: next });
          // 后台进程重启后监听会丢失，回到就绪状态时重新建立
          if (next === "ready" && previous !== "ready" && previous !== "busy")
            void get().watchChapters();
          if (next === "crashed") {
            const runId = get().activeRunId;
            if (runId)
              patchRun(runId, (item) => ({
                ...item,
                status: "error",
                error: "后台进程意外退出，已准备重启。",
              }));
            set({ activeRunId: null });
          }
        }
        return;
      }
      if (event.type !== "run.event") return;
      const message = event.payload as RunMessage;
      const runId = message.runId;
      const ctx = { set, get, patchItems, patchRun };
      if (
        handleIntake(ctx, message) ||
        handleApproval(ctx, message) ||
        handleRun(ctx, message) ||
        handleWorkflow(ctx, message)
      )
        return;
      switch (message.type) {
        case "file.updated":
          if (
            typeof message.path === "string" &&
            typeof message.content === "string" &&
            /^chapters[\\/]/u.test(message.path)
          ) {
            // Agent 刚写完的章节：先用事件内容即时显示，再以磁盘为准对齐
            const path = message.path.replaceAll("\\", "/");
            set({
              paper: paperFromText(path, message.content),
              activeChapter: path,
            });
            void get().syncChapters(path);
          }
          break;
        case "fact.proposed":
        case "fact.confirmed":
        case "fact.rejected":
        case "chapter.summary":
        case "chapter.finalized":
          void get().refreshFacts();
          break;
        case "chapters.changed":
          if (message.projectId === get().project.id) void get().syncChapters();
          break;
        default:
      }
    },
  };
});
