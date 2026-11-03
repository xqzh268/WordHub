import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import type { CommandPayloads } from "@wordhub/contracts";
import { cleanIpcError } from "../lib/errors";

type Format = CommandPayloads["export.run"]["format"];
type Scope = CommandPayloads["export.run"]["scope"];

const FORMATS: Array<{ id: Format; label: string }> = [
  { id: "docx", label: "Word（.docx）" },
  { id: "txt-utf8", label: "文本 UTF-8" },
  { id: "txt-gb18030", label: "文本 GB18030" },
];

type Prefs = {
  body: string;
  heading: string;
  sizePt: string;
  spacing: string;
};
const DEFAULT_PREFS: Prefs = {
  body: "宋体",
  heading: "楷体",
  sizePt: "12",
  spacing: "1.5",
};
const STORAGE_KEY = "wordhub.export.prefs";

function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw
      ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) }
      : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** 导出当前章或全书。字体可选预设、本机已安装字体，也可手填字体名。 */
export function ExportPanel({
  activeChapter,
  disabled,
}: {
  activeChapter: string | null;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("chapter");
  const [format, setFormat] = useState<Format>("docx");
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [fonts, setFonts] = useState<string[]>([]);
  const [fontsState, setFontsState] = useState<"idle" | "loading" | "done">(
    "idle",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  useEffect(() => {
    if (!open || fontsState !== "idle" || !window.wordhub) return;
    setFontsState("loading");
    void window.wordhub
      .invoke("export.fonts", undefined)
      .then((result) =>
        setFonts([...new Set([...result.presets, ...result.installed])]),
      )
      .catch(() => undefined)
      .finally(() => setFontsState("done"));
  }, [open, fontsState]);

  const update = (patch: Partial<Prefs>) =>
    setPrefs((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 无法持久化时只在本次有效
      }
      return next;
    });

  const run = async () => {
    if (!window.wordhub) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.wordhub.invoke("export.run", {
        scope,
        chapterPath:
          scope === "chapter" ? (activeChapter ?? undefined) : undefined,
        format,
        fonts: { body: prefs.body.trim(), heading: prefs.heading.trim() },
        bodySizePt: Number(prefs.sizePt),
        lineSpacing: Number(prefs.spacing),
      });
      if (result.canceled) setMessage(null);
      else
        setMessage({
          ok: true,
          text: `已导出 ${result.chapters} 章（${Math.max(1, Math.round((result.bytes ?? 0) / 1024))} KB）：${result.path}`,
        });
    } catch (error) {
      setMessage({
        ok: false,
        text: cleanIpcError(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const isDocx = format === "docx";
  return (
    <div className="export-wrap">
      <button
        type="button"
        className="btn finalize-btn"
        data-testid="export-open"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="导出为 Word 或纯文本"
      >
        <Download size={13} strokeWidth={1.5} /> 导出
      </button>
      {open && (
        <div
          className="export-panel"
          role="dialog"
          aria-label="导出"
          data-testid="export-panel"
        >
          <label>
            <span>范围</span>
            <select
              className="text-input"
              value={scope}
              onChange={(event) => setScope(event.target.value as Scope)}
              aria-label="导出范围"
            >
              <option value="chapter" disabled={!activeChapter}>
                当前章
              </option>
              <option value="book">全书</option>
            </select>
          </label>
          <label>
            <span>格式</span>
            <select
              className="text-input"
              value={format}
              onChange={(event) => setFormat(event.target.value as Format)}
              aria-label="导出格式"
            >
              {FORMATS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {isDocx && (
            <>
              <label>
                <span>正文字体</span>
                <input
                  className="text-input"
                  list="export-fonts"
                  value={prefs.body}
                  onChange={(event) => update({ body: event.target.value })}
                  aria-label="正文字体"
                />
              </label>
              <label>
                <span>标题字体</span>
                <input
                  className="text-input"
                  list="export-fonts"
                  value={prefs.heading}
                  onChange={(event) => update({ heading: event.target.value })}
                  aria-label="标题字体"
                />
              </label>
              <datalist id="export-fonts">
                {fonts.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <label>
                <span>字号（磅）</span>
                <input
                  className="text-input"
                  inputMode="decimal"
                  value={prefs.sizePt}
                  onChange={(event) => update({ sizePt: event.target.value })}
                  aria-label="正文字号"
                />
              </label>
              <label>
                <span>行距（倍）</span>
                <input
                  className="text-input"
                  inputMode="decimal"
                  value={prefs.spacing}
                  onChange={(event) => update({ spacing: event.target.value })}
                  aria-label="行距"
                />
              </label>
              <p className="export-note">
                {fontsState === "loading"
                  ? "正在读取本机字体…"
                  : fonts.length > 5
                    ? `可从本机已安装的 ${fonts.length} 个字体中选择，也可直接输入字体名。`
                    : "未能读取本机字体列表，可直接输入字体名。"}
              </p>
              <p className="export-note">
                字体只写入字体名，不嵌入文件；对方电脑没有该字体时，Word
                会自动改用相近字体。
              </p>
            </>
          )}
          {!isDocx && (
            <p className="export-note">
              {format === "txt-gb18030"
                ? "GB18030 适合只认旧编码的老软件和阅读器；现代软件请用 UTF-8。段首空两个全角空格，换行为 CRLF。"
                : "段首空两个全角空格，换行为 CRLF。"}
            </p>
          )}
          <div className="export-actions">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="export-run"
              disabled={busy || (scope === "chapter" && !activeChapter)}
              onClick={() => void run()}
            >
              {busy ? "导出中…" : "选择保存位置并导出"}
            </button>
          </div>
          {message && (
            <p
              className={`export-message ${message.ok ? "ok" : "bad"}`}
              role={message.ok ? "status" : "alert"}
              data-testid="export-message"
            >
              {message.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
