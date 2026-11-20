// 文枢标志 v4：生成全部矢量文件。字形为手绘贝塞尔轮廓；字标文字已转为轮廓。
// 依赖不在项目里：仓库根目录 npm i --no-save fontkit wawoff2 后，于本目录运行 node build.mjs
import * as fontkit from "fontkit";
import fs from "node:fs";
import { decompress } from "wawoff2";
import "./glyph.js";
const { wen, seal: sealPath } = globalThis.WenGlyph;

const OUT = process.argv[2] ?? "../";
const NM = process.argv[3] ?? "../../../../node_modules/@fontsource-variable/";
const C = { paper: "#FFFDF8", ink: "#1E1C19", red: "#C2603A", inkD: "#ECE7DC", redD: "#E08A66", bgD: "#171614", line: "#E4DDCF" };

const SEAL = sealPath(8, 8, 104, 104, [4, -10, 4, 4]); // 小圆角 + 右上切角
const G = wen();
const BOLD = 2.6; // 小尺寸版：轮廓外扩描边加粗，并去掉拖尾
let uid = 0;
const nid = (p) => `wh-${p}-${++uid}`;

// 拖尾渐变：从 x 处完全透明，到光标处达到 peak
function trailGrad(id, t, color, from, to) {
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${t.x}" y1="0" x2="${t.x + t.w}" y2="0">` +
    `<stop offset="0" stop-color="${color}" stop-opacity="${from}"/><stop offset="1" stop-color="${color}" stop-opacity="${to}"/></linearGradient>`;
}
const trailRect = (t, fill) => `<rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" fill="${fill}"/>`;

// 白文印：字和光标是真透明镂空；拖尾是渐变的半镂空。caret 指定时光标另行着色（墨印用）
function seal(fill, { caret, small = false } = {}) {
  const m = nid("cut"), gr = nid("trail"), t = G.trail;
  const cut = caret ? G.body : G.body + G.caret;
  const bold = small ? ` stroke="#000" stroke-width="${BOLD}" stroke-linejoin="round"` : "";
  let defs = `<mask id="${m}" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120"><rect width="120" height="120" fill="#fff"/>`;
  if (!small && !caret) defs += trailRect(t, `url(#${gr})`);
  defs += `<path d="${cut}" fill="#000"${bold}/></mask>`;
  if (!small && !caret) defs += trailGrad(gr, t, "#000", 0, t.peak);
  let body = `<defs>${defs}</defs><path d="${SEAL}" fill="${fill}" mask="url(#${m})"/>`;
  if (caret) {
    if (!small) { const g2 = nid("trail"); body += `<defs>${trailGrad(g2, t, caret, 0, 0.55)}</defs>` + trailRect(t, `url(#${g2})`); }
    body += `<path d="${G.caret}" fill="${caret}"${small ? ` stroke="${caret}" stroke-width="${BOLD}" stroke-linejoin="round"` : ""}/>`;
  }
  return body;
}
// 无框：墨字 + 朱砂光标与拖尾
function bare(ink, red, { small = false } = {}) {
  const gr = nid("trail"), t = G.trail, b = (c) => small ? ` stroke="${c}" stroke-width="${BOLD}" stroke-linejoin="round"` : "";
  return (small ? "" : `<defs>${trailGrad(gr, t, red, 0, 0.5)}</defs>` + trailRect(t, `url(#${gr})`)) +
    `<path d="${G.body}" fill="${ink}"${b(ink)}/><path d="${G.caret}" fill="${red}"${b(red)}/>`;
}
const svg = (vb, w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}" role="img" aria-label="文枢 WordHub">\n${body}\n</svg>\n`;
const mark = (body) => svg("8 8 104 104", 104, 104, body);

// ── 字标轮廓
const ttf = async (p) => fontkit.create(Buffer.from(await decompress(fs.readFileSync(NM + p))));
const font = async (p, wght) => (await ttf(p)).getVariation({ wght });
function run(f, text, tracking = 0) {
  const k = 1000 / f.unitsPerEm, lay = f.layout(text);
  let x = 0, d = "", b = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9 };
  lay.glyphs.forEach((g, i) => {
    d += g.path.scale(k, -k).translate(x, 0).toSVG();
    const bb = g.path.bbox;
    b.minX = Math.min(b.minX, x + bb.minX * k); b.maxX = Math.max(b.maxX, x + bb.maxX * k);
    b.minY = Math.min(b.minY, -bb.maxY * k); b.maxY = Math.max(b.maxY, -bb.minY * k);
    x += lay.positions[i].xAdvance * k + (i < lay.glyphs.length - 1 ? tracking : 0);
  });
  return { d, b };
}
const ZW = 600, EW = 450, ZH_GAP = 1080;
const wenT = run(await font("noto-serif-sc/files/noto-serif-sc-118-wght-normal.woff2", ZW), "文");
const shuT = run(await font("noto-serif-sc/files/noto-serif-sc-102-wght-normal.woff2", ZW), "枢");
const en = run(await font("source-serif-4/files/source-serif-4-latin-wght-normal.woff2", EW), "WordHub", 130);
const zhB = { minX: wenT.b.minX, maxX: ZH_GAP + shuT.b.maxX, minY: Math.min(wenT.b.minY, shuT.b.minY), maxY: Math.max(wenT.b.maxY, shuT.b.maxY) };
const r3 = (n) => Math.round(n * 1000) / 1000;
const tf = (d, s, dx, dy) => d.replace(/(-?\d*\.?\d+(?:e-?\d+)?)\s*,?\s*(-?\d*\.?\d+(?:e-?\d+)?)/g, (m, a, b) => `${r3(+a * s + dx)} ${r3(+b * s + dy)}`);
function wordBlock(H) { // 中文墨迹顶 = 0，英文基线 = H，中英文墨迹左右对齐
  const zhW = zhB.maxX - zhB.minX, enW = en.b.maxX - en.b.minX;
  const sz = 0.64 * H / (zhB.maxY - zhB.minY), se = (zhW * sz) / enW;
  const zh = tf(wenT.d, sz, -zhB.minX * sz, -zhB.minY * sz) + tf(shuT.d, sz, (ZH_GAP - zhB.minX) * sz, -zhB.minY * sz);
  return { w: zhW * sz, d: zh + tf(en.d, se, -en.b.minX * se, H) };
}
function lockup(sealBody, ink, bg) {
  const pad = 24, H = 104, gap = 32, wb = wordBlock(H);
  const W = pad + 104 + gap + wb.w + pad, Ht = H + pad * 2;
  return svg(`0 0 ${r3(W)} ${Ht}`, r3(W), Ht,
    (bg ? `<rect width="${r3(W)}" height="${Ht}" fill="${bg}"/>` : "") +
    `<g transform="translate(${pad - 8} ${pad - 8})">${sealBody}</g>` +
    `<path transform="translate(${pad + 104 + gap} ${pad})" fill="${ink}" d="${wb.d}"/>`);
}
function stacked(sealBody, ink) {
  const pad = 24, H = 88, gap = 34, wb = wordBlock(H);
  const W = Math.max(104, wb.w) + pad * 2, Ht = pad + 104 + gap + H + pad;
  return svg(`0 0 ${r3(W)} ${Ht}`, r3(W), Ht,
    `<g transform="translate(${r3(W / 2 - 60)} ${pad - 8})">${sealBody}</g>` +
    `<path transform="translate(${r3(W / 2 - wb.w / 2)} ${pad + 104 + gap})" fill="${ink}" d="${wb.d}"/>`);
}
// 应用图标：1024，不透明。字形墨迹中心约 (62, 60)
function icon({ bg, ink, caret, trail, border, small = false }) {
  const S = 1024, k = small ? 7.6 : 7.0, t = G.trail;
  const tr = `translate(${r3(S / 2 - 62 * k)} ${r3(S / 2 - 60 * k)}) scale(${k})`;
  const gr = nid("itrail"), b = (c) => small ? ` stroke="${c}" stroke-width="${BOLD}" stroke-linejoin="round"` : "";
  return svg(`0 0 ${S} ${S}`, S, S,
    `<rect x="${border ? 4 : 0}" y="${border ? 4 : 0}" width="${border ? S - 8 : S}" height="${border ? S - 8 : S}" rx="${border ? 224 : 228}" fill="${bg}"${border ? ` stroke="${border}" stroke-width="8"` : ""}/>` +
    `<g transform="${tr}">` + (small ? "" : `<defs>${trailGrad(gr, t, trail, 0, trail === C.paper ? t.peak : 0.55)}</defs>` + trailRect(t, `url(#${gr})`)) +
    `<path d="${G.body}" fill="${ink}"${b(ink)}/><path d="${G.caret}" fill="${caret}"${b(caret)}/></g>`);
}

const files = {
  "seal.svg": mark(seal(C.red)),
  "seal-dark.svg": mark(seal(C.redD)),
  "seal-ink.svg": mark(seal(C.ink, { caret: C.red })),
  "seal-mono.svg": mark(seal(C.ink)),
  "seal-small.svg": mark(seal(C.red, { small: true })),
  "seal-dark-small.svg": mark(seal(C.redD, { small: true })),
  "wen.svg": mark(bare(C.ink, C.red)),
  "wen-dark.svg": mark(bare(C.inkD, C.redD)),
  "lockup.svg": lockup(seal(C.red), C.ink),
  "lockup-dark.svg": lockup(seal(C.redD), C.inkD, C.bgD),
  "lockup-stacked.svg": stacked(seal(C.red), C.ink),
  "icon-cinnabar.svg": icon({ bg: C.red, ink: C.paper, caret: C.paper, trail: C.paper }),
  "icon-ink.svg": icon({ bg: C.ink, ink: C.inkD, caret: C.redD, trail: C.redD }),
  "icon-paper.svg": icon({ bg: C.paper, ink: C.ink, caret: C.red, trail: C.red, border: C.line }),
  "icon-cinnabar-small.svg": icon({ bg: C.red, ink: C.paper, caret: C.paper, small: true }),
  "icon-ink-small.svg": icon({ bg: C.ink, ink: C.inkD, caret: C.redD, small: true }),
};
for (const [n, s] of Object.entries(files)) fs.writeFileSync(OUT + n, s);
console.log(Object.keys(files).join(" "));
