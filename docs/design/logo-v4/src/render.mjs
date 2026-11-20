// 用 Chromium 把 HTML 设计稿渲染成 PNG：node render.mjs <in.html> <out.png> [width] [height] [scale]
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";
const [, , input, output, w = "1600", h = "1000", s = "1"] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +s });
await page.goto(pathToFileURL(path.resolve(input)).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: output, fullPage: true });
await browser.close();
