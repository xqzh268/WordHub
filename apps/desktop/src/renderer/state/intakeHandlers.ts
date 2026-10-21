import type { Ctx } from "./context";
import type { RunMessage } from "./messages";
import type { ChatItem } from "./types";
import { uid } from "./util";

/** 处理本组消息；识别并处理返回 true，否则返回 false 交给下一组。 */
export function handleIntake(
  { get, patchItems }: Ctx,
  message: RunMessage,
): boolean {
  switch (message.type) {
    case "intake.question":
      if (message.intakeId && message.questionId && message.key) {
        patchItems(get().activeSessionId, (items) => {
          const existing = items.find(
            (item): item is Extract<ChatItem, { kind: "question" }> =>
              item.kind === "question" &&
              item.questionId === message.questionId,
          );
          const next: Extract<ChatItem, { kind: "question" }> = {
            kind: "question",
            id: message.questionId!,
            at: Date.now(),
            intakeId: message.intakeId!,
            questionId: message.questionId!,
            key: message.key!,
            level: message.level === 1 ? 1 : 2,
            prompt: message.prompt ?? "请补充纲领信息。",
            required: message.required !== false,
            options: Array.isArray(message.options) ? message.options : [],
            ...(existing?.value !== undefined ? { value: existing.value } : {}),
            resolved: existing?.resolved ?? false,
          };
          if (existing)
            return items.map((item) => (item.id === existing.id ? next : item));
          return [...items, next];
        });
      }
      break;
    case "intake.answer":
      if (message.questionId)
        patchItems(get().activeSessionId, (items) =>
          items.map((item) =>
            item.kind === "question" && item.questionId === message.questionId
              ? { ...item, value: message.value ?? "", resolved: true }
              : item,
          ),
        );
      break;
    case "intake.reset":
      if (message.intakeId && (message.fromKey ?? message.key))
        patchItems(get().activeSessionId, (items) =>
          items.map((item) => {
            const order = [
              "premise",
              "protagonist",
              "conflict",
              "world",
              "viewpointTone",
              "theme",
              "audience",
              "chapterCount",
              "mustInclude",
              "forbidden",
              "confirm",
            ];
            const fromIndex = order.indexOf(message.fromKey ?? message.key!);
            return item.kind === "question" &&
              item.intakeId === message.intakeId &&
              fromIndex >= 0 &&
              order.indexOf(item.key) >= fromIndex
              ? { ...item, value: undefined, resolved: false }
              : item;
          }),
        );
      break;
    case "intake.confirmed":
      if (message.intakeId)
        patchItems(get().activeSessionId, (items) =>
          items.map((item) =>
            item.kind === "question" && item.intakeId === message.intakeId
              ? { ...item, resolved: true }
              : item,
          ),
        );
      break;
    case "intake.artifacts.created":
      patchItems(get().activeSessionId, (items) => [
        ...items,
        {
          kind: "notice",
          id: uid("intake-artifacts"),
          at: Date.now(),
          text: "纲领已确认，人物档案、大纲、设定词典、文风基准和写作计划已写入项目。",
        },
      ]);
      break;
    case "editor.check": {
      const metrics = message.metrics ?? {};
      const violations = Array.isArray(message.violations)
        ? message.violations.flatMap((item) =>
            typeof item.message === "string" ? [item.message] : [],
          )
        : [];
      patchItems(get().activeSessionId, (items) => [
        ...items,
        {
          kind: "notice",
          id: uid("editor-check"),
          at: Date.now(),
          text:
            message.ok === true
              ? `编辑检查通过：${Number(metrics.wordCount ?? 0)}字，对话占比${(Number(metrics.dialogueRatio ?? 0) * 100).toFixed(1)}%。`
              : `编辑检查发现${violations.length}项：${violations.join("；")}`,
          ...(message.ok === true ? {} : { tone: "warn" as const }),
        },
      ]);
      break;
    }
    default:
      return false;
  }
  return true;
}
