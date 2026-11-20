// 由 docs/design/logo-v4 的 SVG 生成应用图标：build/icon.ico（Windows）与 build/icon.png（1024）。
// 24px 及以下用小尺寸加粗版（无拖尾），其余用标准版。用法：node scripts/build-icons.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logo = path.join(root, "docs", "design", "logo-v4");
const out = path.join(root, "build");
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(svgFile, size) {
  await page.setViewportSize({ width: size, height: size });
  // 内联 SVG：setContent 的页面是 about:blank，不能加载 file:// 图片
  const svg = await fs.readFile(path.join(logo, svgFile), "utf8");
  await page.setContent(
    `<html><head><style>body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`,
  );
  return page.screenshot({
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
}

const pngs = [];
for (const size of ICO_SIZES)
  pngs.push({
    size,
    data: await render(
      size <= 24 ? "icon-cinnabar-small.svg" : "icon-cinnabar.svg",
      size,
    ),
  });
const big = await render("icon-cinnabar.svg", 1024);
await browser.close();

// ICO：文件头 + 目录项 + PNG 数据（Vista 起支持 PNG 压缩的图标项）
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach(({ size, data }, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(size >= 256 ? 0 : size, e);
  header.writeUInt8(size >= 256 ? 0 : size, e + 1);
  header.writeUInt8(0, e + 2);
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(data.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += data.length;
});
await fs.mkdir(out, { recursive: true });
await fs.writeFile(
  path.join(out, "icon.ico"),
  Buffer.concat([header, ...pngs.map((p) => p.data)]),
);
await fs.writeFile(path.join(out, "icon.png"), big);
console.log(
  `build/icon.ico（${ICO_SIZES.join("、")}）与 build/icon.png（1024）已生成`,
);
