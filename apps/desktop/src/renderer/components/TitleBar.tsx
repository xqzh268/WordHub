import { ChevronRight, Moon, Sun } from "lucide-react";
import { resolveTheme, useWorkbench } from "../state/store";
import { Seal } from "./Seal";

export function TitleBar() {
  const theme = useWorkbench((s) => s.theme);
  const setTheme = useWorkbench((s) => s.setTheme);
  const projectName = useWorkbench((s) => s.project.name);
  const sessionTitle = useWorkbench((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.title ?? "");
  const resolved = resolveTheme(theme);

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <Seal glyph="文" color="var(--accent)" size={22} />
        <span className="titlebar-name">文枢</span>
      </div>
      <nav className="titlebar-crumb" aria-label="当前位置">
        <span>{projectName}</span>
        <ChevronRight size={13} strokeWidth={1.5} aria-hidden="true" />
        <strong>{sessionTitle}</strong>
      </nav>
      <div className="titlebar-actions">
        <button
          className="icon-btn tip tip-below"
          data-tip={resolved === "dark" ? "切换为宣纸" : "切换为墨色"}
          aria-label="切换明暗主题"
          onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
        >
          {resolved === "dark" ? <Sun size={17} strokeWidth={1.5} /> : <Moon size={17} strokeWidth={1.5} />}
        </button>
      </div>
    </header>
  );
}
