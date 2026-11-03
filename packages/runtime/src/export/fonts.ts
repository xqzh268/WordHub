import { execFile } from "node:child_process";

/** 中文小说常用字体，永远可选；是否真的装在对方电脑上由 Word 决定（会按系统规则回退）。 */
export const PRESET_FONTS = ["宋体", "楷体", "黑体", "仿宋", "微软雅黑"];

const run = (command: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: 15000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

/** 去重、去空、按码点排序（不依赖区域设置，各机器结果一致）；以 @ 开头的是竖排变体，不列出。 */
export function normalizeFontNames(names: string[]): string[] {
  return [
    ...new Set(
      names
        .map((name) => name.trim())
        .filter((name) => name && !name.startsWith("@") && name.length <= 80),
    ),
  ].sort();
}

/**
 * 列出本机已安装的字体族。Windows 用 .NET 的 InstalledFontCollection（名称按系统界面语言，如“宋体”）；
 * Linux/macOS 用 fc-list。任何一步失败都返回空数组，界面仍能用预设字体或手填字体名。
 */
export async function listInstalledFonts(): Promise<string[]> {
  try {
    if (process.platform === "win32") {
      const script =
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;" +
        "Add-Type -AssemblyName System.Drawing;" +
        "(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }";
      const out = await run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
      ]);
      return normalizeFontNames(out.split(/\r?\n/u));
    }
    const out = await run("fc-list", [":", "family"]);
    // 每行可能是“宋体,SimSun”这样的多名称，取每个名称
    return normalizeFontNames(out.split(/\r?\n/u).flatMap((l) => l.split(",")));
  } catch {
    return [];
  }
}
