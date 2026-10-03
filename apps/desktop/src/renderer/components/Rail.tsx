import {
  LibraryBig,
  PenLine,
  Settings2,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useWorkbench } from "../state/store";
import type { View } from "../state/types";

const TOP: { view: View; label: string; Icon: LucideIcon }[] = [
  { view: "workspace", label: "工作区", Icon: PenLine },
  { view: "references", label: "参考库", Icon: LibraryBig },
  { view: "graph", label: "关系图谱", Icon: Waypoints },
];

export function Rail() {
  const view = useWorkbench((s) => s.view);
  const setView = useWorkbench((s) => s.setView);

  const item = ({
    view: target,
    label,
    Icon,
  }: {
    view: View;
    label: string;
    Icon: LucideIcon;
  }) => (
    <button
      key={target}
      className={`rail-btn tip ${view === target ? "active" : ""}`}
      data-tip={label}
      aria-label={label}
      aria-current={view === target ? "page" : undefined}
      data-testid={`rail-${target}`}
      onClick={() => setView(target)}
    >
      {view === target && (
        <motion.span
          layoutId="rail-indicator"
          className="rail-indicator"
          transition={{ type: "spring", stiffness: 420, damping: 36 }}
        />
      )}
      <Icon size={20} strokeWidth={1.5} />
    </button>
  );

  return (
    <nav className="rail" aria-label="主导航">
      <div className="rail-group">{TOP.map(item)}</div>
      <div className="rail-group">
        {item({ view: "settings", label: "设置", Icon: Settings2 })}
      </div>
    </nav>
  );
}
