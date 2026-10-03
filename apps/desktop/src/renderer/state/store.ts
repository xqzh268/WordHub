import { create } from "zustand";
import type {
  AppEvent,
  ResolvedTheme,
  ThemePreference,
  WorkspaceSnapshot,
} from "@wordhub/contracts";
import { routeMessage, toolLabel } from "../lib/agents";
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
              label: String(current.name),
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

    async resolveApproval(itemId, choice) {
      const item = get()
        .sessions.flatMap((session) => session.items)
        .find(
          (candidate) =>
            candidate.kind === "approval" && candidate.id === itemId,
        );
      if (item?.kind === "approval" && item.runId) {
        try {
          await window.wordhub?.invoke("run.approve", {
            runId: item.runId,
            approved: choice === "批准",
          });
          patchItems(get().activeSessionId, (items) =>
            items.map((candidate) =>
              candidate.kind === "approval" && candidate.id === itemId
                ? { ...candidate, resolved: choice }
                : candidate,
            ),
          );
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
            set({
              sessions: sessions.sessions.map((session) => ({
                id: session.id,
                title: session.title,
                items:
                  session.id === snapshot.activeSessionId
                    ? restoreItems(chat.items)
                    : [],
              })),
            }),
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
        text?: string;
        model?: string;
        reasoning?: string;
        usage?: {
          input: number;
          output: number;
          totalTokens: number;
          cost?: { total?: number };
        };
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
                options: ["批准", "拒绝"],
                runId,
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
        case "run.started":
          if (runId)
            patchRun(runId, (item) => ({
              ...item,
              model: message.model,
              reasoningLevel: message.reasoning,
            }));
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
            if (get().activeRunId === runId) set({ activeRunId: null });
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
