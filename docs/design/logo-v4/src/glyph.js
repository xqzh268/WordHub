// 文枢标志 v4 几何：120 网格。普通脚本，浏览器与 node 共用。
(function (root) {
  // 圆角矩形，四角各自半径 [左上, 右上, 右下, 左下]；负数表示 45° 切角
  function seal(x, y, w, h, r) {
    const c = (rad, x0, y0, x1, y1) => rad > 0 ? `A${rad} ${rad} 0 0 1 ${x1} ${y1}` : `L${x1} ${y1}`;
    const [a, b, cc, d] = r.map(Math.abs), [A, B, CC, D] = r;
    return `M${x + a} ${y}H${x + w - b}` + c(B, 0, 0, x + w, y + b) + `V${y + h - cc}` + c(CC, 0, 0, x + w - cc, y + h) +
      `H${x + d}` + c(D, 0, 0, x, y + h - d) + `V${y + a}` + c(A, 0, 0, x + a, y) + "Z";
  }
  // 手绘轮廓（字体设计的做法）：横画水平、宋体三角收笔；撇长锋出尖；捺由细渐粗、平收出锋
  const DEF = {
    caret: { x: 57, y: 17, w: 7, h: 18 },
    trail: { x: 24, peak: 0.4 },       // 拖尾：左端透明，到光标处不透明度 0.4
    // 横：水平，粗 5；收笔为宋体的三角“鳞”——顶边在末端凹弧上挑成尖，再斜切落到底边
    bar: 'M21 42H87C90 41.4 93 39.6 95.2 37.4L100.6 43.6C101.1 44.2 100.9 45.2 100 45.7C98.8 46.5 97.2 47 95.4 47H21Z',
    pie: 'M71.5 44H81.5C81.5 70 68 92 19 103.8C58 90 71.5 72 71.5 44Z',
    na: 'M39.5 44H46C48 64 62 81.5 84 90.4C92 93.6 98.5 96.4 106.5 98.8C98 100.4 90 101.6 82 101.4C74 101.2 43 84 39.5 44Z',
  };
  function wen(o = {}) {
    const g = Object.assign({}, DEF, o), c = g.caret;
    return {
      caret: `M${c.x} ${c.y}h${c.w}v${c.h}h${-c.w}Z`,
      trail: { x: g.trail.x, y: c.y, w: c.x - g.trail.x, h: c.h, peak: g.trail.peak },
      body: g.bar + g.pie + g.na,
    };
  }
  root.WenGlyph = { wen, seal, DEF };
})(typeof window !== "undefined" ? window : globalThis);
