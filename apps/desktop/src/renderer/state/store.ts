import { create } from "zustand";
import type {
  AppEvent,
  ResolvedTheme,
  ThemePreference,
  WorkspaceSnapshot,
} from "@wordhub/contracts";
import { routeMessage, toolLabel, taskLabel } from "../lib/agents";
import { DEMO_CHAPTER, DEMO_PROJECT, demoSessions } from "../lib/demo";
import type {
  ChatItem,
  PaperParagraph,
  PaperTab,
  Session,
  View,
  WorkerState,
} from "./types";

export type ReadingFont = "serif" | "literary";
type Prefs = { theme: ThemePreference; reading: ReadingFont };

const PREFS_KEY = "wordhub.prefs";
const isDemo = new URLSearchParams(window.location.search).get("demo") === "1";

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(
      localStorage.getItem(PREFS_KEY) ?? "{}",
    ) as Partial<Prefs>;
    return {
      theme:
        raw.theme === "light" || raw.theme === "dark" || raw.theme === "system"
          ? raw.theme
          : "system",
      reading: raw.reading === "literary" ? "literary" : "serif",
    };
  } catch {
    return { theme: "system", reading: "serif" };
  }
}

const uid = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emptySession = (title: string): Session => ({
  id: uid("s"),
  title,
  items: [],
});

function paperFromText(filePath: string, text: string) {
  const name = filePath.split(/[\\/]/u).at(-1) ?? filePath;
  const title = name.replace(/\.(?:md|markdown|txt)$/iu, "") || "当前章节";
  const paragraphs = text
    .split(/\r?\n\s*\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) => ({
      id: `paper-${index}`,
      text: value.replace(/^#{1,6}\s+/u, ""),
    }));
  const chapter = title.match(/[一二三四五六七八九十百千万\d]+/u)?.[0];
  return {
    no: chapter ? `第${chapter}章` : "当前章节",
    page: 1,
    title,
    paragraphs,
  };
}

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

type State = Prefs & {
  demo: boolean;
  view: View;
  paperTab: PaperTab;
  project: { id?: string; name: string; folder: string | null };
  worker: WorkerState;
  sessions: Session[];
  activeSessionId: string;
  paper: {
    no: string;
    page: number;
    title: string;
    paragraphs: PaperParagraph[];
  } | null;
  activeRunId: string | null;
  composer: string;

  setTheme(theme: ThemePreference): void;
  setReading(reading: ReadingFont): void;
  setView(view: View): void;
  setPaperTab(tab: PaperTab): void;
  setComposer(text: string): void;
  mention(agentName: string): void;
  newSession(): Promise<void>;
  selectSession(id: string): void;
  linkFolder(): Promise<void>;
  restartWorker(): Promise<void>;
  send(text: string): Promise<void>;
  abort(): Promise<void>;
  resumeRun(runId: string): Promise<void>;
  resolveApproval(itemId: string, choice: string): void;
  handleEvent(event: AppEvent): void;
};

const initialSessions = isDemo ? demoSessions() : [emptySession("新会话")];

function restoreItems(raw: unknown): ChatItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (value.kind === "user" && typeof value.text === "string")
      return [
        {
          kind: "user",
          id: String(value.id),
          at: Number(value.at),
          text: value.text,
        } satisfies ChatItem,
      ];
    if (value.kind === "approval" && typeof value.title === "string")
      return [
        {
          kind: "approval",
          id: String(value.id),
          at: Number(value.at),
          title: value.title,
          body: String(value.body ?? ""),
          options: Array.isArray(value.options)
            ? value.options.map(String)
            : ["批准", "拒绝"],
          runId: typeof value.runId === "string" ? value.runId : undefined,
          resolved:
            typeof value.resolved === "string" ? value.resolved : undefined,
          preview:
            typeof value.preview === "string" ? value.preview : undefined,
          path: typeof value.path === "string" ? value.path : undefined,
          contentLength:
            typeof value.contentLength === "number"
              ? value.contentLength
              : undefined,
          diff:
            value.diff && typeof value.diff === "object"
              ? {
                  addedLines: Number(
                    (value.diff as Record<string, unknown>).addedLines ?? 0,
                  ),
                  removedLines: Number(
                    (value.diff as Record<string, unknown>).removedLines ?? 0,
                  ),
                }
              : undefined,
          threadId:
            typeof value.threadId === "string" ? value.threadId : undefined,
          workflowId:
            typeof value.workflowId === "string" ? value.workflowId : undefined,
        } satisfies ChatItem,
      ];
    if (value.kind === "notice" && typeof value.text === "string")
      return [
        {
          kind: "notice",
          id: String(value.id),
          at: Number(value.at),
          text: value.text,
          tone: value.tone === "warn" ? "warn" : undefined,
        } satisfies ChatItem,
      ];
    if (value.kind === "task" && typeof value.taskId === "string")
      return [
        {
          kind: "task",
          id: String(value.id),
          at: Number(value.at),
          taskId: value.taskId,
          label: taskLabel(
            typeof value.agentId === "string" ? value.agentId : undefined,
            typeof value.taskKind === "string" ? value.taskKind : undefined,
          ),
          agentId:
            typeof value.agentId === "string" ? value.agentId : undefined,
          taskKind:
            typeof value.taskKind === "string" ? value.taskKind : undefined,
          status:
            value.status === "running" ||
            value.status === "succeeded" ||
            value.status === "failed" ||
            value.status === "blocked"
              ? value.status
              : "ready",
        } satisfies ChatItem,
      ];
    if (value.kind === "thread" && typeof value.claim === "string")
      return [
        {
          kind: "thread",
          id: String(value.id),
          at: Number(value.at),
          from: String(value.from ?? "reviewer"),
          to: String(value.to ?? "writer"),
          round: Number(value.round ?? 1),
          maxRounds: Number(value.maxRounds ?? 2),
          severity: value.severity === "minor" ? "minor" : "blocking",
          claim: value.claim,
          replies: Array.isArray(value.replies)
            ? value.replies.flatMap((reply) => {
                if (!reply || typeof reply !== "object") return [];
                const item = reply as Record<string, unknown>;
                return typeof item.text === "string"
                  ? [
                      {
                        agentId: String(item.agentId ?? "writer"),
                        text: item.text,
                      },
                    ]
                  : [];
              })
            : [],
        } satisfies ChatItem,
      ];
    if (value.kind !== "agent") return [];
    const tools = Array.isArray(value.tools)
      ? value.tools.flatMap((tool) => {
          if (!tool || typeof tool !== "object") return [];
          const current = tool as Record<string, unknown>;
          return [
            {
              id: String(current.id),
              name: String(current.name),
              label: toolLabel(String(current.name)),
              status: (current.status === "error"
                ? "error"
                : current.status === "running"
                  ? "running"
                  : "done") as "running" | "done" | "error",
            },
          ];
        })
      : [];
    const status =
      value.status === "streaming" ||
      value.status === "done" ||
      value.status === "aborted" ||
      value.status === "interrupted" ||
      value.status === "waiting_approval" ||
      value.status === "error"
        ? value.status
        : "thinking";
    return [
      {
        kind: "agent",
        id: String(value.id),
        at: Number(value.at),
        agentId: String(value.agentId),
        status,
        text: String(value.text ?? ""),
        tools,
        runId: String(value.runId),
        model: typeof value.model === "string" ? value.model : undefined,
        reasoningLevel:
          typeof value.reasoning === "string" ? value.reasoning : undefined,
        usage:
          value.usage && typeof value.usage === "object"
            ? {
                input: Number(
                  (value.usage as Record<string, unknown>).input ?? 0,
                ),
                output: Number(
                  (value.usage as Record<string, unknown>).output ?? 0,
                ),
                total: Number(
                  (value.usage as Record<string, unknown>).total ?? 0,
                ),
                cost:
                  typeof (value.usage as Record<string, unknown>).cost ===
                  "number"
                    ? ((value.usage as Record<string, unknown>).cost as number)
                    : undefined,
              }
            : undefined,
        context: Array.isArray(value.context)
          ? value.context.flatMap((entry) => {
              if (!entry || typeof entry !== "object") return [];
              const context = entry as Record<string, unknown>;
              if (
                typeof context.id !== "string" ||
                typeof context.kind !== "string"
              )
                return [];
              return [
                {
                  id: context.id,
                  kind: context.kind,
                  sourcePath:
                    typeof context.sourcePath === "string"
                      ? context.sourcePath
                      : undefined,
                  estimatedTokens: Number(context.estimatedTokens ?? 0),
                },
              ];
            })
          : undefined,
      } as ChatItem,
    ];
  });
}

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
        });
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
              text: `${estimate.label ?? "本次运行"}预估：约${estimate.inputTokens}输入Token、${estimate.outputTokens}输出Token，${estimate.costUsd.toFixed(4)}美元（运行不设上限）。`,
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
          ]).then(([sessions, chat]) =>
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
          );
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
          set({ worker: next });
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
      const message = event.payload as {
        type?: string;
        runId?: string;
        delta?: string;
        tool?: string;
        error?: string;
        reason?: string;
        text?: string;
        model?: string;
        reasoning?: string;
        usage?: {
          input: number;
          output: number;
          totalTokens: number;
          cost?: { total?: number };
        };
        path?: string;
        contentLength?: number;
        diff?: { addedLines?: number; removedLines?: number };
        threadId?: string;
        workflowId?: string;
        agentId?: string;
        actorId?: string;
        label?: string;
        content?: string;
        estimate?: { costUsd?: number };
        manifest?: Array<{
          id: string;
          kind: string;
          sourcePath?: string;
          estimatedTokens: number;
        }>;
      };
      const runId = message.runId;
      switch (message.type) {
        case "approval.requested":
          if (runId)
            patchItems(get().activeSessionId, (items) => [
              ...items,
              {
                kind: "approval",
                id: `approval_${runId}`,
                at: Date.now(),
                title: "Agent请求写入",
                body: `${message.tool ?? "写入工具"}需要你的确认后才能继续。`,
                preview:
                  typeof (message as { contentPreview?: unknown })
                    .contentPreview === "string"
                    ? (message as { contentPreview: string }).contentPreview
                    : undefined,
                path:
                  typeof (message as { path?: unknown }).path === "string"
                    ? (message as { path: string }).path
                    : undefined,
                contentLength:
                  typeof (message as { contentLength?: unknown })
                    .contentLength === "number"
                    ? (message as { contentLength: number }).contentLength
                    : undefined,
                diff:
                  message.diff && typeof message.diff === "object"
                    ? {
                        addedLines: Number(message.diff.addedLines ?? 0),
                        removedLines: Number(message.diff.removedLines ?? 0),
                      }
                    : undefined,
                options: ["批准", "拒绝"],
                runId,
                threadId:
                  typeof (message as { threadId?: unknown }).threadId ===
                  "string"
                    ? (message as { threadId: string }).threadId
                    : undefined,
                workflowId:
                  typeof (message as { workflowId?: unknown }).workflowId ===
                  "string"
                    ? (message as { workflowId: string }).workflowId
                    : undefined,
              },
            ]);
          break;
        case "escalation.created":
          if (runId)
            patchItems(get().activeSessionId, (items) => [
              ...items,
              {
                kind: "approval",
                id: uid("escalation"),
                at: Date.now(),
                title: "质询需要你的裁决",
                body:
                  message.reason ??
                  "两个Agent仍未达成一致，请选择后继续工作流。",
                options: ["接受修改", "保留原文"],
                runId,
                threadId: message.threadId,
                workflowId: message.workflowId ?? runId,
              },
            ]);
          break;
        case "approval.granted":
        case "approval.rejected":
          if (runId)
            patchItems(get().activeSessionId, (items) =>
              items.map((item) =>
                item.kind === "approval" && item.runId === runId
                  ? {
                      ...item,
                      resolved:
                        message.type === "approval.granted" ? "批准" : "拒绝",
                    }
                  : item,
              ),
            );
          break;
        case "approval.expired":
          if (runId)
            patchItems(get().activeSessionId, (items) =>
              items.map((item) =>
                item.kind === "approval" && item.runId === runId
                  ? { ...item, resolved: "已过期，可重新发起" }
                  : item,
              ),
            );
          break;
        case "escalation.resolved":
          patchItems(get().activeSessionId, (items) =>
            items.map((item) =>
              item.kind === "approval" &&
              item.threadId === message.threadId &&
              (!runId || item.workflowId === runId || item.runId === runId)
                ? {
                    ...item,
                    resolved:
                      (message as { decision?: string }).decision === "accept"
                        ? "接受修改"
                        : "保留原文",
                  }
                : item,
            ),
          );
          break;
        case "challenge.raise":
          if (message.threadId) {
            const threadId = message.threadId;
            patchItems(get().activeSessionId, (items) => {
              const existing = items.find(
                (item): item is Extract<ChatItem, { kind: "thread" }> =>
                  item.kind === "thread" && item.id === threadId,
              );
              if (existing)
                return items.map((item) =>
                  item.kind === "thread" && item.id === threadId
                    ? {
                        ...item,
                        round: Number(
                          (message as { round?: number }).round ?? item.round,
                        ),
                        claim:
                          typeof (message as { claim?: unknown }).claim ===
                          "string"
                            ? (message as { claim: string }).claim
                            : item.claim,
                      }
                    : item,
                );
              return [
                ...items,
                {
                  kind: "thread",
                  id: threadId,
                  at: Date.now(),
                  from: message.actorId ?? "reviewer",
                  to:
                    typeof (message as { target?: unknown }).target === "string"
                      ? (message as { target: string }).target
                      : "writer",
                  round: Number((message as { round?: number }).round ?? 1),
                  maxRounds: 2,
                  severity:
                    (message as { severity?: string }).severity === "minor"
                      ? "minor"
                      : "blocking",
                  claim:
                    typeof (message as { claim?: unknown }).claim === "string"
                      ? (message as { claim: string }).claim
                      : "",
                  replies: [],
                },
              ];
            });
          }
          break;
        case "challenge.reply":
          if (message.threadId)
            patchItems(get().activeSessionId, (items) =>
              items.map((item) =>
                item.kind === "thread" && item.id === message.threadId
                  ? {
                      ...item,
                      round: Number(
                        (message as { round?: number }).round ?? item.round,
                      ),
                      replies: [
                        ...item.replies,
                        {
                          agentId: message.actorId ?? "writer",
                          text:
                            typeof (message as { text?: unknown }).text ===
                            "string"
                              ? (message as { text: string }).text
                              : "",
                        },
                      ],
                    }
                  : item,
              ),
            );
          break;
        case "file.updated":
          if (
            typeof message.path === "string" &&
            typeof message.content === "string" &&
            /^chapters[\\/]/u.test(message.path)
          )
            set({ paper: paperFromText(message.path, message.content) });
          break;
        case "run.started":
          if (runId) {
            const sessionId = get().activeSessionId;
            const exists = get().sessions.some(
              (session) =>
                session.id === sessionId &&
                session.items.some(
                  (item) => item.kind === "agent" && item.runId === runId,
                ),
            );
            if (!exists)
              patchItems(sessionId, (items) => [
                ...items,
                {
                  kind: "agent",
                  id: uid("agent"),
                  at: Date.now(),
                  agentId: message.agentId ?? "writer",
                  status: "thinking",
                  text: "",
                  tools: [],
                  runId,
                },
              ]);
            patchRun(runId, (item) => ({
              ...item,
              status: "thinking",
              model: message.model,
              reasoningLevel: message.reasoning,
            }));
            set({ activeRunId: message.workflowId ?? runId });
          }
          break;
        case "context.injected":
          if (runId && message.manifest)
            patchRun(runId, (item) => ({ ...item, context: message.manifest }));
          break;
        case "run.text":
          if (runId && message.delta)
            patchRun(runId, (item) => ({
              ...item,
              status: "streaming",
              text: item.text + message.delta,
            }));
          break;
        case "run.tool_execution_start":
          if (runId) {
            patchRun(runId, (item) => ({
              ...item,
              tools: [
                ...item.tools,
                {
                  id: uid("t"),
                  name: message.tool ?? "tool",
                  label: toolLabel(message.tool ?? "tool"),
                  status: "running",
                },
              ],
            }));
          }
          break;
        case "run.reasoning_delta":
          if (runId && message.delta)
            patchRun(runId, (item) => ({
              ...item,
              reasoning: `${item.reasoning ?? ""}${message.delta}`,
              reasoningOpen: true,
            }));
          break;
        case "run.usage":
          if (runId && message.usage)
            patchRun(runId, (item) => ({
              ...item,
              usage: {
                input: message.usage!.input,
                output: message.usage!.output,
                total: message.usage!.totalTokens,
                cost: message.usage!.cost?.total,
              },
            }));
          break;
        case "run.tool_execution_end":
          if (runId) {
            patchRun(runId, (item) => {
              const index = item.tools.findLastIndex(
                (tool) =>
                  tool.name === message.tool && tool.status === "running",
              );
              if (index < 0) return item;
              return {
                ...item,
                tools: item.tools.map((tool, i) =>
                  i === index ? { ...tool, status: "done" } : tool,
                ),
              };
            });
          }
          break;
        case "run.finished":
          if (runId) {
            patchRun(runId, (item) => ({
              ...item,
              status: "done",
              text: item.text || message.text || "",
              usage: message.usage
                ? {
                    input: message.usage.input,
                    output: message.usage.output,
                    total: message.usage.totalTokens,
                    cost: message.usage.cost?.total,
                  }
                : item.usage,
            }));
            if (get().activeRunId === runId)
              set({ activeRunId: message.workflowId ?? null });
          }
          break;
        case "run.aborted":
          if (runId) {
            patchRun(runId, (item) => ({ ...item, status: "aborted" }));
            if (get().activeRunId === runId) set({ activeRunId: null });
          }
          break;
        case "run.interrupted":
          if (runId) {
            patchRun(runId, (item) => ({ ...item, status: "interrupted" }));
            if (get().activeRunId === runId) set({ activeRunId: null });
          }
          break;
        case "run.waiting_approval":
          if (runId) {
            patchRun(runId, (item) => ({
              ...item,
              status: "waiting_approval",
            }));
          }
          break;
        case "permission.denied":
          patchItems(get().activeSessionId, (items) => [
            ...items,
            {
              kind: "notice",
              id: uid("permission"),
              at: Date.now(),
              tone: "warn",
              text:
                typeof message.reason === "string"
                  ? `权限被拒：${message.reason}`
                  : "权限被拒：该工具或路径不在Agent授权范围内。",
            },
          ]);
          break;
        case "workflow.started":
          if (runId) set({ activeRunId: runId });
          patchItems(get().activeSessionId, (items) => [
            // 发送时放的“正在构思”占位气泡属于父运行；工作流由各节点任务承担，不再需要它。
            ...items.filter(
              (item) =>
                !(
                  item.kind === "agent" &&
                  item.runId === runId &&
                  item.status === "thinking" &&
                  !item.text &&
                  item.tools.length === 0
                ),
            ),
            {
              kind: "notice",
              id: uid("workflow"),
              at: Date.now(),
              text: `${message.label ?? "工作流"}已启动 · 预估${Number((message.estimate as { costUsd?: number } | undefined)?.costUsd ?? 0).toFixed(4)}美元`,
            },
          ]);
          break;
        case "workflow.finished":
          if (runId && get().activeRunId === runId) set({ activeRunId: null });
          patchItems(get().activeSessionId, (items) => [
            ...items,
            {
              kind: "notice",
              id: uid("workflow-done"),
              at: Date.now(),
              text: "工作流已完成",
            },
          ]);
          break;
        case "workflow.failed":
          if (runId && get().activeRunId === runId) set({ activeRunId: null });
          patchItems(get().activeSessionId, (items) => [
            ...items,
            {
              kind: "notice",
              id: uid("workflow-failed"),
              at: Date.now(),
              text: "工作流未完成，请查看失败节点和质询卡。",
              tone: "warn",
            },
          ]);
          break;
        case "task.created":
        case "task.ready":
        case "task.started":
        case "task.succeeded":
        case "task.failed":
        case "task.blocked": {
          const taskId =
            typeof (message as { taskId?: unknown }).taskId === "string"
              ? (message as { taskId: string }).taskId
              : undefined;
          if (!taskId) break;
          const status =
            message.type === "task.succeeded"
              ? "succeeded"
              : message.type === "task.failed"
                ? "failed"
                : message.type === "task.blocked"
                  ? "blocked"
                  : message.type === "task.started"
                    ? "running"
                    : "ready";
          patchItems(get().activeSessionId, (items) => {
            const existing = items.find(
              (item): item is Extract<ChatItem, { kind: "task" }> =>
                item.kind === "task" && item.taskId === taskId,
            );
            if (!existing)
              return [
                ...items,
                {
                  kind: "task",
                  id: uid("task"),
                  at: Date.now(),
                  taskId,
                  label: taskLabel(
                    typeof (message as { assignedAgent?: unknown })
                      .assignedAgent === "string"
                      ? (message as { assignedAgent: string }).assignedAgent
                      : undefined,
                    typeof (message as { kind?: unknown }).kind === "string"
                      ? (message as { kind: string }).kind
                      : undefined,
                  ),
                  agentId:
                    typeof (message as { assignedAgent?: unknown })
                      .assignedAgent === "string"
                      ? (message as { assignedAgent: string }).assignedAgent
                      : undefined,
                  status,
                },
              ];
            return items.map((item) =>
              item.kind === "task" && item.taskId === taskId
                ? { ...item, status }
                : item,
            );
          });
          break;
        }
        case "error":
          if (runId) {
            patchRun(runId, (item) => ({
              ...item,
              status: "error",
              error: message.error ?? "未知错误",
            }));
            if (get().activeRunId === runId) set({ activeRunId: null });
          }
          break;
        default:
      }
    },
  };
});

/** 解析主题偏好为实际主题，并同步窗口标题栏。 */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system")
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  return preference;
}
