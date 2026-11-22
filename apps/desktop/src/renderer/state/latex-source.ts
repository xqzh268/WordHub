import type { LatexFileContentPayload } from "@wordhub/contracts";
import { create } from "zustand";
import { cleanIpcError } from "../lib/errors";

interface SourceDocument {
  baseline: string;
  hash: string;
  text: string;
  lineSeparator: string;
  bom: string;
  version: number;
}

interface SourceBuffer {
  document?: SourceDocument;
  operation?: "loading" | "saving";
  conflict?: boolean;
  error?: string;
}

const openSources = new Set<string>();
const useSourceBuffers = create<ReadonlyMap<string, SourceBuffer>>(
  () => new Map(),
);

export function isSourceDirty(buffer: SourceBuffer | undefined): boolean {
  return buffer?.document?.text !== buffer?.document?.baseline;
}

function updateBuffer(key: string, buffer: SourceBuffer) {
  useSourceBuffers.setState((current) => {
    const next = new Map(current);
    if (
      openSources.has(key) ||
      buffer.operation ||
      buffer.conflict ||
      isSourceDirty(buffer)
    ) {
      next.set(key, buffer);
    } else {
      next.delete(key);
    }
    return next;
  }, true);
}

function readDocument(file: LatexFileContentPayload, version: number) {
  const bom = file.content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = file.content.slice(bom.length);
  const baseline = source.replace(/\r\n?/gu, "\n");
  return {
    baseline,
    hash: file.contentHash,
    text: baseline,
    lineSeparator: source.match(/\r\n|\r|\n/u)?.[0] ?? "\n",
    bom,
    version,
  } satisfies SourceDocument;
}

export function useSourceBuffer(key: string) {
  return useSourceBuffers((buffers) => buffers.get(key));
}

export function attachSource(key: string, projectId: string, path: string) {
  openSources.add(key);
  if (!useSourceBuffers.getState().get(key)) {
    void loadSource(key, projectId, path);
  }
  return () => {
    openSources.delete(key);
    const buffer = useSourceBuffers.getState().get(key);
    if (buffer) updateBuffer(key, buffer);
  };
}

export async function loadSource(key: string, projectId: string, path: string) {
  const current = useSourceBuffers.getState().get(key);
  if (current?.operation) return;
  updateBuffer(key, { ...current, operation: "loading", error: undefined });
  try {
    const file = await window.wordhub.invoke("latex.readFile", {
      projectId,
      path,
    });
    updateBuffer(key, {
      document: readDocument(file, (current?.document?.version ?? 0) + 1),
    });
  } catch (cause) {
    updateBuffer(key, { ...current, error: cleanIpcError(cause) });
  }
}

export function editSource(key: string, text: string) {
  const current = useSourceBuffers.getState().get(key);
  if (!current?.document || current.operation === "loading") return;
  updateBuffer(key, { ...current, document: { ...current.document, text } });
}

export async function saveSource(key: string, projectId: string, path: string) {
  const current = useSourceBuffers.getState().get(key);
  if (
    !current?.document ||
    current.operation ||
    current.conflict ||
    !isSourceDirty(current)
  )
    return;

  const { bom, lineSeparator, text, hash, version } = current.document;
  updateBuffer(key, { ...current, operation: "saving", error: undefined });
  try {
    const result = await window.wordhub.invoke("latex.writeFile", {
      projectId,
      path,
      content: bom + text.replaceAll("\n", lineSeparator),
      expectedHash: hash,
    });
    // 编辑或切换文件期间，返回值只更新该文件的保存基线。
    const latest = useSourceBuffers.getState().get(key);
    if (result.status === "conflict") {
      updateBuffer(key, { ...latest, operation: undefined, conflict: true });
      return;
    }
    updateBuffer(key, {
      document: {
        ...readDocument(result.file, version),
        text: latest?.document?.text ?? text,
      },
    });
  } catch (cause) {
    const latest = useSourceBuffers.getState().get(key);
    updateBuffer(key, {
      ...latest,
      operation: undefined,
      error: cleanIpcError(cause),
    });
  }
}
