import { GraduationCap } from "lucide-react";
import { useWorkbench } from "../state/store";
import { LatexWorkspace } from "./LatexWorkspace";
import { ProjectControls } from "./ProjectControls";

export function AcademicWorkspace() {
  const projectId = useWorkbench((s) => s.project.id);
  return (
    <div className="page" data-testid="academic-workspace">
      <div className="page-inner academic-workspace-inner">
        <span className="coming-icon">
          <GraduationCap size={26} strokeWidth={1.25} aria-hidden="true" />
        </span>
        <h1>学术写作</h1>
        <p className="lead">打开项目文件，选择主文件并检查编译结果。</p>
        {projectId && <LatexWorkspace key={projectId} projectId={projectId} />}
        <div className="academic-project-controls">
          <ProjectControls />
        </div>
      </div>
    </div>
  );
}
