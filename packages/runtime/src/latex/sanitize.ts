import path from "node:path";
import type { LatexCompileResult } from "./compiler.js";

/** 交给 Agent / 模型的编译输出。永远不含项目外文件的内容，也不含日志文件路径。 */
export interface AgentCompileOutput {
  status: LatexCompileResult["status"];
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
  missingTool?: string;
  /** 已过滤的输出文本。 */
  output: string;
  /** 编译读取了项目外的绝对路径；此时 output 整体被屏蔽。 */
  readOutsideProject: boolean;
  /** 仅路径，供用户界面提示。 */
  outsidePaths: string[];
}

const ABSOLUTE_PATH_LINE = /accessing absolute path/i;
const ABSOLUTE_PATH_VALUE =
  /accessing absolute path\s*[`'"“]?(.+?)[`'"”]?\s*$/i;

const inside = (root: string, target: string): boolean => {
  const fold = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const relative = path.relative(
    fold(path.resolve(root)),
    fold(path.resolve(target)),
  );
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};

/** 从完整输出里找出“项目外的绝对路径读取”。同一路径只报一次，保持出现顺序。 */
export function findOutsidePaths(
  output: string,
  projectRoot: string,
): string[] {
  const found: string[] = [];
  for (const line of output.split(/\r?\n/u)) {
    if (!ABSOLUTE_PATH_LINE.test(line)) continue;
    const value = ABSOLUTE_PATH_VALUE.exec(line)?.[1]?.trim();
    // 位于项目内的绝对路径不算越界；无法解析的一律保守地按越界上报。
    if (value && path.isAbsolute(value) && inside(projectRoot, value)) continue;
    const shown = value || "（无法解析的绝对路径）";
    if (!found.includes(shown)) found.push(shown);
  }
  return found;
}

/**
 * 规则：
 * 1. 删除所有含 “accessing absolute path” 的行。
 * 2. 出现项目外读取时，其余输出整体屏蔽——TeX 报错上下文可能回显被读文件的内容，
 *    无法可靠地逐行区分；只保留状态、退出码和路径列表。
 * 3. 项目根目录的绝对路径替换为 <project>，避免泄露用户目录结构。
 * 4. 不返回 pdf/log/synctex 的文件路径。
 */
export function sanitizeCompileOutputForAgent(
  result: Pick<
    LatexCompileResult,
    | "status"
    | "stdout"
    | "stderr"
    | "truncated"
    | "exitCode"
    | "durationMs"
    | "missingTool"
  >,
  projectRoot: string,
): AgentCompileOutput {
  const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const outsidePaths = findOutsidePaths(combined, projectRoot);
  const readOutsideProject = outsidePaths.length > 0;
  const base = {
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    truncated: result.truncated,
    ...(result.missingTool ? { missingTool: result.missingTool } : {}),
    readOutsideProject,
    outsidePaths,
  };
  if (readOutsideProject)
    return {
      ...base,
      output:
        "[编译输出已隐藏：此次编译读取了项目外的文件，请在界面中查看详情]",
    };
  const root = path.resolve(projectRoot);
  const variants = [root, root.replaceAll("\\", "/")];
  let output = combined
    .split(/\r?\n/u)
    .filter((line) => !ABSOLUTE_PATH_LINE.test(line))
    .join("\n");
  for (const variant of variants)
    output = output.split(variant).join("<project>");
  return { ...base, output };
}
