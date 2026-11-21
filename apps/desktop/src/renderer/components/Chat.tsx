import { Feather } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { useWorkbench } from "../state/store";
import { Entry } from "./chat/Entry";
import { Composer } from "./Composer";

const enter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const },
};

export function ChatPane() {
  // 自建 Agent 登记后重新渲染，历史消息里的名字和头像才能对上
  useWorkbench((s) => s.customAgents);
  const session = useWorkbench((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId),
  );
  const items = session?.items ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const last = items[items.length - 1];
  const signal = `${items.length}:${last?.kind === "agent" ? last.text.length + last.tools.length : 0}`;
  const send = useWorkbench((s) => s.send);
  const project = useWorkbench((s) => s.project);
  const activeRunId = useWorkbench((s) => s.activeRunId);
  const usage = items.reduce(
    (sum, item) =>
      item.kind === "agent" && item.usage
        ? {
            input: sum.input + item.usage.input,
            output: sum.output + item.usage.output,
            cost: sum.cost + (item.usage.cost ?? 0),
          }
        : sum,
    { input: 0, output: 0, cost: 0 },
  );

  useEffect(() => {
    const node = scroller.current;
    if (node && stick.current)
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [signal, session?.id]);

  return (
    <section className="chat grain" aria-label="Agent 群聊">
      <div
        className="chat-scroll selectable"
        ref={scroller}
        data-testid="chat-scroll"
        onScroll={(event) => {
          const node = event.currentTarget;
          stick.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        {items.length === 0 ? (
          <EmptyChat />
        ) : (
          <ol className="timeline">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <motion.li
                  key={item.id}
                  className={`entry entry-${item.kind}`}
                  {...enter}
                >
                  <Entry item={item} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </div>
      {usage.input + usage.output > 0 && (
        <div className="usage-summary" data-testid="session-usage">
          本会话用量：输入{usage.input} · 输出{usage.output} token · $
          {usage.cost.toFixed(6)}
        </div>
      )}
      {project.folder && !activeRunId && (
        <button
          className="review-shortcut"
          data-testid="request-review"
          onClick={() => void send("请评审当前章节的一致性")}
        >
          请评审当前章节
        </button>
      )}
      <Composer />
    </section>
  );
}

const STARTERS = [
  "写一部唐代悬疑短篇，主角是个不良人",
  "为这本书建立人物档案",
  "帮我梳理第三章的节奏",
];

function EmptyChat() {
  const setComposer = useWorkbench((s) => s.setComposer);
  return (
    <div className="empty-chat" data-testid="empty-chat">
      <div className="empty-seal">
        <Feather size={26} strokeWidth={1.25} aria-hidden="true" />
      </div>
      <h2>从一个念头开始</h2>
      <p>
        告诉纲领你想写什么。它会先问清几件必要的事，再和写手、编辑、评审一起把故事一章章写出来。
      </p>
      <div className="starters">
        {STARTERS.map((text) => (
          <button
            key={text}
            className="starter"
            onClick={() => setComposer(text)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
