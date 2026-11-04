import { describe, expect, it } from "vitest";
import { layoutGraph, WORLD } from "./layout";

const ids = ["裴照", "老周", "苏晚", "阿福", "刘伯", "高敏", "段小乙"];
const links = [
  { source: "裴照", target: "老周" },
  { source: "裴照", target: "苏晚" },
  { source: "苏晚", target: "阿福" },
  { source: "刘伯", target: "高敏" },
];

describe("layoutGraph", () => {
  it("同样的输入得到同样的位置（拖时间滑块时不乱跳）", () => {
    expect([...layoutGraph(ids, links)]).toEqual([...layoutGraph(ids, links)]);
  });

  it("所有节点都在画布范围内，且互不重叠", () => {
    const positions = [...layoutGraph(ids, links).values()];
    for (const p of positions) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(WORLD.width);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(WORLD.height);
    }
    for (let i = 0; i < positions.length; i += 1)
      for (let j = i + 1; j < positions.length; j += 1) {
        const a = positions[i] as { x: number; y: number };
        const b = positions[j] as { x: number; y: number };
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(60);
      }
  });

  it("有连线的人比没连线的人靠得更近", () => {
    const map = layoutGraph(ids, links);
    const d = (a: string, b: string) => {
      const p = map.get(a) as { x: number; y: number };
      const q = map.get(b) as { x: number; y: number };
      return Math.hypot(p.x - q.x, p.y - q.y);
    };
    expect(d("裴照", "老周")).toBeLessThan(d("裴照", "高敏"));
  });

  it("空图、单节点、重复与未知端点都不崩", () => {
    expect(layoutGraph([], []).size).toBe(0);
    expect(layoutGraph(["甲"], []).get("甲")).toEqual({ x: 500, y: 320 });
    expect(
      layoutGraph(
        ["甲", "乙"],
        [
          { source: "甲", target: "甲" },
          { source: "甲", target: "不存在" },
        ],
      ).size,
    ).toBe(2);
  });
});
