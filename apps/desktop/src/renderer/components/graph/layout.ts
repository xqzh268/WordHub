export type Point = { x: number; y: number };

export const WORLD = { width: 1000, height: 640 } as const;

/** 小型确定性力导向布局：同样的输入永远得到同样的位置，时间滑块拖动时节点不会乱跳。 */
export function layoutGraph(
  ids: readonly string[],
  links: ReadonlyArray<{ source: string; target: string }>,
  size: { width: number; height: number } = WORLD,
): Map<string, Point> {
  const count = ids.length;
  const result = new Map<string, Point>();
  if (count === 0) return result;
  const cx = size.width / 2;
  const cy = size.height / 2;
  if (count === 1) {
    result.set(ids[0] as string, { x: cx, y: cy });
    return result;
  }
  const index = new Map(ids.map((id, i) => [id, i]));
  // 初始：按出现顺序排在椭圆上（确定、且相邻的人大致相邻）
  const x: number[] = [];
  const y: number[] = [];
  ids.forEach((_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    x.push(cx + Math.cos(angle) * size.width * 0.32);
    y.push(cy + Math.sin(angle) * size.height * 0.32);
  });
  const pairs = links
    .map((link) => [index.get(link.source), index.get(link.target)] as const)
    .filter(
      (pair): pair is readonly [number, number] =>
        pair[0] !== undefined && pair[1] !== undefined && pair[0] !== pair[1],
    );
  const area = size.width * size.height;
  const ideal = Math.sqrt(area / count) * 0.8;
  const margin = 70;
  let temperature = size.width / 8;
  for (let step = 0; step < 300; step += 1) {
    const dx = new Array<number>(count).fill(0);
    const dy = new Array<number>(count).fill(0);
    for (let i = 0; i < count; i += 1)
      for (let j = i + 1; j < count; j += 1) {
        let vx = (x[i] as number) - (x[j] as number);
        let vy = (y[i] as number) - (y[j] as number);
        let dist = Math.hypot(vx, vy);
        if (dist < 0.01) {
          // 完全重合时按下标错开，保持确定
          vx = 0.01 * (i - j);
          vy = 0.01;
          dist = Math.hypot(vx, vy);
        }
        const force = (ideal * ideal) / dist;
        dx[i] = (dx[i] as number) + (vx / dist) * force;
        dy[i] = (dy[i] as number) + (vy / dist) * force;
        dx[j] = (dx[j] as number) - (vx / dist) * force;
        dy[j] = (dy[j] as number) - (vy / dist) * force;
      }
    for (const [a, b] of pairs) {
      const vx = (x[a] as number) - (x[b] as number);
      const vy = (y[a] as number) - (y[b] as number);
      const dist = Math.max(Math.hypot(vx, vy), 0.01);
      const force = (dist * dist) / ideal;
      dx[a] = (dx[a] as number) - (vx / dist) * force;
      dy[a] = (dy[a] as number) - (vy / dist) * force;
      dx[b] = (dx[b] as number) + (vx / dist) * force;
      dy[b] = (dy[b] as number) + (vy / dist) * force;
    }
    for (let i = 0; i < count; i += 1) {
      // 轻微向中心收拢，避免没有连线的孤点飘到边缘
      dx[i] = (dx[i] as number) + (cx - (x[i] as number)) * 0.05;
      dy[i] = (dy[i] as number) + (cy - (y[i] as number)) * 0.05;
      const length = Math.max(
        Math.hypot(dx[i] as number, dy[i] as number),
        0.01,
      );
      const move = Math.min(length, temperature);
      x[i] = Math.min(
        size.width - margin,
        Math.max(
          margin,
          (x[i] as number) + ((dx[i] as number) / length) * move,
        ),
      );
      y[i] = Math.min(
        size.height - margin,
        Math.max(
          margin,
          (y[i] as number) + ((dy[i] as number) / length) * move,
        ),
      );
    }
    temperature *= 0.97;
  }
  ids.forEach((id, i) => {
    result.set(id, {
      x: Math.round(x[i] as number),
      y: Math.round(y[i] as number),
    });
  });
  return result;
}
