import type { ResolvedTheme, ThemePreference } from "@wordhub/contracts";

export type ReadingFont = "serif" | "literary";
export type Prefs = { theme: ThemePreference; reading: ReadingFont };

export const PREFS_KEY = "wordhub.prefs";

export function loadPrefs(): Prefs {
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

/** 解析主题偏好为实际主题，并同步窗口标题栏。 */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system")
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  return preference;
}
