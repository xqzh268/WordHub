import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { AppEvent } from "@wordhub/contracts";
import { ChatPane } from "./components/Chat";
import { PaperPane } from "./components/Paper";
import { GraphView, ReferencesView } from "./components/Placeholder";
import { Rail } from "./components/Rail";
import { SessionPanel } from "./components/SessionPanel";
import { SettingsView } from "./components/Settings";
import { TitleBar } from "./components/TitleBar";
import { resolveTheme, useWorkbench } from "./state/store";

function useThemeSync() {
  const theme = useWorkbench((s) => s.theme);
  const reading = useWorkbench((s) => s.reading);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = resolveTheme(theme);
      document.documentElement.dataset.theme = resolved;
      void window.wordhub?.invoke("app.setTheme", { preference: theme, resolved });
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.reading = reading;
  }, [reading]);
}

function useBackend() {
  useEffect(() => {
    const api = window.wordhub;
    if (!api) return;
    const handle = useWorkbench.getState().handleEvent;
    void api.invoke("workspace.getSnapshot", undefined).then((snapshot) => handle({ type: "worker.state", payload: { state: snapshot.worker } } satisfies AppEvent));
    return api.subscribe(handle);
  }, []);
}

function Workspace() {
  return (
    <Group orientation="horizontal" className="workspace">
      <Panel defaultSize={232} minSize={200} maxSize={300} groupResizeBehavior="preserve-pixel-size" className="panel-sessions">
        <SessionPanel />
      </Panel>
      <Separator className="sep" />
      <Panel defaultSize={470} minSize={360} maxSize={640} groupResizeBehavior="preserve-pixel-size" className="panel-chat">
        <ChatPane />
      </Panel>
      <Separator className="sep" />
      <Panel minSize={380} className="panel-paper">
        <PaperPane />
      </Panel>
    </Group>
  );
}

export function App() {
  useThemeSync();
  useBackend();
  const view = useWorkbench((s) => s.view);

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <TitleBar />
        <div className="app-body">
          <Rail />
          <main className="stage">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={view} className="stage-view" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
                {view === "workspace" && <Workspace />}
                {view === "references" && <ReferencesView />}
                {view === "graph" && <GraphView />}
                {view === "settings" && <SettingsView />}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </MotionConfig>
  );
}
