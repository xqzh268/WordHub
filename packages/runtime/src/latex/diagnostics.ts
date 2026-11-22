import { lstat } from "node:fs/promises";
import path from "node:path";
import type { LatexDiagnosticPayload } from "@wordhub/contracts";
import { safeProjectTarget } from "@wordhub/store";
import {
  isLatexSourceFile,
  LATEX_FILE_READ_LIMIT,
  normalizeLatexPath,
} from "./files.js";

const MAX_DIAGNOSTICS = 100;
const MAX_MESSAGE_LENGTH = 2000;
const HEADER = /^(error|warning):[ \t]*(.*)$/u;
const LOCATION = /^(.+?):(\d+):[ \t]*(.*)$/u;
const TRANSCRIPT = /^something bad happened inside \w+; its output follows:$/iu;
const ENGINE_FAILURE = /^the \w+ engine had an unrecoverable error$/iu;

interface TectonicDiagnostic {
  message: string;
  file?: string;
  line?: number;
}

async function readableSource(
  projectRoot: string,
  printedPath: string,
): Promise<string | undefined> {
  const file = printedPath.trim().replaceAll("\\", "/");
  if (file.split("/").includes("..")) return undefined;
  const relative = path.isAbsolute(file)
    ? path.relative(projectRoot, file)
    : file.replace(/^(?:\.\/)+/u, "");
  try {
    let source = normalizeLatexPath(relative);
    if (source.toLowerCase().split("/").includes("node_modules"))
      return undefined;
    if (!path.posix.extname(source)) {
      // Tectonic can report the literal \input{chapter} argument, without .tex.
      // Only infer the extension when the name itself does not exist.
      const exact = await safeProjectTarget(projectRoot, source);
      const exists = await lstat(exact).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      if (exists) return undefined;
      source += ".tex";
    }
    if (!isLatexSourceFile(source)) return undefined;
    const target = await safeProjectTarget(projectRoot, source);
    const info = await lstat(target);
    if (info.isFile() && info.size <= LATEX_FILE_READ_LIMIT) return source;
  } catch {
    // Bundle inputs, deleted files and rejected paths remain plain diagnostics.
  }
  return undefined;
}

/** Parse Tectonic's console diagnostics, excluding the enclosed TeX transcript. */
export async function parseLatexDiagnostics(
  streams: readonly string[],
  projectRoot: string,
): Promise<LatexDiagnosticPayload[]> {
  const groups = {
    error: new Map<string, TectonicDiagnostic>(),
    warning: new Map<string, TectonicDiagnostic>(),
  };
  let engineFailure: string | undefined;
  for (const stream of streams) {
    const lines = stream.split(/\r?\n/u);
    let transcriptSeparators = 0;
    for (const [index, entry] of lines.entries()) {
      if (transcriptSeparators) {
        if (/^={20,}$/u.test(entry)) transcriptSeparators--;
        continue;
      }
      const header = HEADER.exec(entry);
      if (!header) continue;
      const [, level, body = ""] = header;
      if (TRANSCRIPT.test(body)) {
        transcriptSeparators = 2;
        continue;
      }
      if (level === "error" && ENGINE_FAILURE.test(body)) {
        engineFailure = body;
        continue;
      }
      // Absolute-read notifications already have a dedicated field in the result.
      if (/^accessing absolute path\b/iu.test(body)) continue;
      const group = level === "error" ? groups.error : groups.warning;
      if (group.size >= MAX_DIAGNOSTICS) continue;
      const location = LOCATION.exec(body);
      const line = Number(location?.[2]);
      // Tectonic puts some messages (e.g. invalid UTF-8) on the next line.
      const continuation = lines[index + 1]?.trim() ?? "";
      const message = (
        location
          ? location[3]?.trim() ||
            (/^(?:note|warning|error|caused by):/u.test(continuation)
              ? ""
              : continuation)
          : body.trim()
      ).slice(0, MAX_MESSAGE_LENGTH);
      if (!message) continue;
      const file = location?.[1];
      const validLine =
        Number.isSafeInteger(line) && line > 0 ? line : undefined;
      const key = JSON.stringify([file, validLine, message]);
      group.set(key, { message, file, line: validLine });
    }
  }
  if (engineFailure && groups.error.size === 0)
    groups.error.set(engineFailure, { message: engineFailure });

  const results: LatexDiagnosticPayload[] = [];
  const sourcePaths = new Map<string, string | undefined>();
  const seen = new Set<string>();
  for (const severity of ["error", "warning"] as const) {
    for (const { message, file, line } of groups[severity].values()) {
      if (file && line && !sourcePaths.has(file))
        sourcePaths.set(file, await readableSource(projectRoot, file));
      const relativePath = file && sourcePaths.get(file);
      const location =
        relativePath && line ? { relativePath, line } : undefined;
      const key = JSON.stringify([severity, message, location]);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ severity, message, ...(location ? { location } : {}) });
      if (results.length === MAX_DIAGNOSTICS) return results;
    }
  }
  return results;
}
