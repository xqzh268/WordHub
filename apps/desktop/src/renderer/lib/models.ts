/** 换模型时尽量沿用原思考强度；不支持就取接近的高档，而不是退到列表第一项（常是 off）。 */
export function pickReasoning(supported: string[], current: string): string {
  if (supported.includes(current) || supported.length === 0) return current;
  return (
    ["high", "medium", "low"].find((level) => supported.includes(level)) ??
    supported[0] ??
    current
  );
}

/** 侧栏紧凑显示：去掉常见前缀，如 deepseek-v4-pro → v4-pro。 */
export const shortModel = (id: string): string => id.replace(/^deepseek-/u, "");
