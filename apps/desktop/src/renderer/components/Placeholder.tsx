import { LibraryBig, Waypoints, type LucideIcon } from "lucide-react";

type Upcoming = { title: string; text: string };

function Coming({
  Icon,
  title,
  lead,
  items,
  milestone,
}: {
  Icon: LucideIcon;
  title: string;
  lead: string;
  items: Upcoming[];
  milestone: string;
}) {
  return (
    <div className="page selectable">
      <div className="page-inner narrow coming">
        <span className="coming-icon">
          <Icon size={26} strokeWidth={1.25} aria-hidden="true" />
        </span>
        <h1>{title}</h1>
        <p className="lead">{lead}</p>
        <ul className="coming-list" role="list">
          {items.map((item) => (
            <li key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
        <span className="tag">{milestone}</span>
      </div>
    </div>
  );
}

export function ReferencesView() {
  return (
    <Coming
      Icon={LibraryBig}
      title="参考库"
      lead="把参考小说与资料放进来，让 Agent 读懂它们。"
      milestone="计划于 P2 开放"
      items={[
        {
          title: "导入与阅读",
          text: "EPUB、MOBI、TXT、DOCX、PDF，选中文字即可向 Agent 提问。",
        },
        {
          title: "人物与文风",
          text: "抽取人物关系，学习情节节奏与文风，写入项目共享记忆。",
        },
        { title: "按项目组织", text: "项目 → 文件 → 会话，与工作区保持同步。" },
      ]}
    />
  );
}

export function GraphView() {
  return (
    <Coming
      Icon={Waypoints}
      title="关系图谱"
      lead="人物与事件的脉络，都有出处，也都能被追问。"
      milestone="计划于 P2 开放"
      items={[
        {
          title: "有来源的图谱",
          text: "每个节点和关系都指向原文段落，随章节回放，不会提前剧透。",
        },
        {
          title: "采访节点",
          text: "点击人物，由掌握全部设定的 Agent 扮演他，回答只限于此刻他知道的事。",
        },
        {
          title: "推演",
          text: "选定人物与时间点，推演剧情走向；推演结果不会自动并入正史。",
        },
      ]}
    />
  );
}
