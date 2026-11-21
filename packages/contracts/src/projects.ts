export type ProjectKind = "novel" | "academic";

export const DEFAULT_PROJECT_KIND: ProjectKind = "novel";

export function isProjectKind(value: unknown): value is ProjectKind {
  return value === "novel" || value === "academic";
}
