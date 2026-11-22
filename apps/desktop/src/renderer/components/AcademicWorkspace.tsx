import { GraduationCap } from "lucide-react";
import { useWorkbench } from "../state/store";
import { LatexCompilePanel } from "./LatexCompilePanel";
import { ProjectControls } from "./ProjectControls";

export function AcademicWorkspace() {
  const projectId = useWorkbench((s) => s.project.id);
  return (
    <div className="page" data-testid="academic-workspace">
      <div className="page-inner narrow coming">
        <span className="coming-icon">
          <GraduationCap size={26} strokeWidth={1.25} aria-hidden="true" />
        </span>
        <h1>学术写作</h1>
        <p className="lead">LaTeX 工作台将在后续版本开放。</p>
        {projectId && <LatexCompilePanel projectId={projectId} />}
        <div className="academic-project-controls">
          <ProjectControls />
        </div>
      </div>
    </div>
  );
}
